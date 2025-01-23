import findRoot from "find-root";
import request, { Response } from "sync-request";
import asyncRequest, { ResponsePromise } from "then-request";
import { readFileSync as readFile } from "fs";
import { inspect } from "util";
import { EventEmitter } from "events";
import parseSecretfile, { SecretSource } from "./parseSecretfile";

function plural(n: number): string {
  return n === 1 ? "" : "s";
}

/**
 * The key→value mappings associated with a secret in Vault.
 */
type SecretData = Record<string, unknown>;

/**
 * Vault gives us "leases" on secrets, which expire at a specified time.
 *
 * A `Lease` contains the secret data and information about when that lease
 * expires.
 */
interface Lease {
  data: SecretData;
  ttl?: number;
  lease_duration?: number;
}

/** Fetch a lease response and parse it. */
function parseLeaseResponse(response: Response | ResponsePromise): Lease {
  const parsed = JSON.parse(response.getBody().toString());

  // v2 keys look a bit different than v1
  if (parsed.data.data) {
    return parsed.data;
  }

  return parsed;
}

function formatText(text: string, before: number, after: number): string {
  return process.stdout.isTTY
    ? "\u001b[" + before + "m" + text + "\u001b[" + after + "m"
    : text;
}
function bold(text: string): string {
  return formatText(text, 1, 22);
}
function green(text: string): string {
  return formatText(text, 32, 39);
}
function red(text: string): string {
  return formatText(text, 31, 39);
}
function blue(text: string): string {
  return formatText(text, 34, 39);
}

const logPrefix = bold("vault-env: ");

/** Vault initialization options. */
export interface Options {
  VAULT_ADDR?: string;
  VAULT_TOKEN?: string;
  VAULT_API_VERSION?: string;
  VAULT_ENV_PATH?: string;
  VAULT_SECRETS?: Record<string, SecretSource>;
  VAULT_APPROLE_ID?: string;
  VAULT_APPROLE_SECRET_ID?: string;
  VAULT_APPROLE_NAME?: string;
  silent?: boolean;
  autoRotate?: boolean;
  local?: boolean;
  dryrun?: boolean;
}

// We have historically supported two entirely different return values, so we
// need to overload our exported type below.

export type V1Secret = Record<string, Record<string, string>>;
export type V2Secret = {
  [key: string]: V1Secret
};

/**
 * Configure this library to fetch secrets from Vault.
 *
 * @returns When `autoRotate` is set, this returns an `EventEmitter`.
 */
export default function prepare(
  options: Options & { autoRotate: true }
): EventEmitter;

/**
 * Configure this library to fetch secrets from Vault.
 *
 * @returns When `autoRotate` is not set, this returns a mapping from secret
 * names to values.
 */
export default function prepare(
  options?: Options & { autoRotate?: false }
): Record<string, string>;

/** Configure this library to fetch secrets from Vault. */
export default function prepare(
  options: Options
): EventEmitter | Record<string, string>;

export default function prepare(
  options: Options = {}
): EventEmitter | Record<string, string> {
  const VAULT_ADDR = (
    options.VAULT_ADDR ||
    process.env.VAULT_ADDR ||
    "http://127.0.0.1:8200"
  ).replace(/([^/])$/, "$1/");

  let VAULT_TOKEN = options.VAULT_TOKEN || process.env.VAULT_TOKEN;
  const VAULT_APPROLE_ID = options.VAULT_APPROLE_ID || process.env.VAULT_APPROLE_ID;
  const VAULT_APPROLE_SECRET_ID = options.VAULT_APPROLE_SECRET_ID || process.env.VAULT_APPROLE_SECRET_ID;
  const VAULT_APPROLE_NAME = options.VAULT_APPROLE_NAME || process.env.VAULT_APPROLE_NAME;
  const VAULT_API_VERSION = options.VAULT_API_VERSION || process.env.VAULT_API_VERSION || "v1";
  const VAULT_ENV_PATH = options.VAULT_ENV_PATH || process.env.VAULT_ENV_PATH || findRoot(process.argv[1] || process.cwd()) + "/Secretfile";
  const ORIGINAL_SECRETS = options.VAULT_SECRETS ?? parseSecretfile(readFile(VAULT_ENV_PATH, "utf8"));
  const varsWritten: Record<string, string> = {};
  const emitter = new EventEmitter();
  const secretsByPath: Record<string, Record<string, string>> = {};
  let secretCount = 0;

  Object.keys(ORIGINAL_SECRETS).forEach(function (key) {
    if (typeof process.env[key] === "undefined") {
      const { vaultPath, vaultProp } = ORIGINAL_SECRETS[key];
      secretsByPath[vaultPath] = secretsByPath[vaultPath] ?? {};
      secretsByPath[vaultPath][key] = vaultProp;
      secretCount++;
    } else if (!options.silent) {
      console.log(logPrefix + key + " already in environment " + blue("✓"));
    }
  });

  if (!VAULT_TOKEN && VAULT_APPROLE_NAME && VAULT_APPROLE_ID && VAULT_APPROLE_SECRET_ID) {
    try {
      const fullUrl = `${VAULT_ADDR}${VAULT_API_VERSION}/auth/${VAULT_APPROLE_NAME}/login`;
      const approleResult = request("POST", fullUrl, {
        json: {
          role_id: VAULT_APPROLE_ID,
          secret_id: VAULT_APPROLE_SECRET_ID,
        }
      });

      const body = approleResult.getBody().toString();
      const result = JSON.parse(body);

      if (result && result.auth) {
        VAULT_TOKEN = result.auth.client_token;
        process.env.VAULT_TOKEN = VAULT_TOKEN;
      } else {
        throw new Error(`Unable to login with approle details`);
      }
    } catch (ex) {
      console.log('Error logging in with approle details');
      console.log(ex);
      throw new Error(ex);
    }
  }

  if (secretCount && !VAULT_TOKEN && (!VAULT_APPROLE_NAME || !VAULT_APPROLE_ID || !VAULT_APPROLE_SECRET_ID)) {
    throw new Error("Expected VAULT_TOKEN or VAULT_APPROLE_NAME, VAULT_APPROLE_ID, and VAULT_APPROLE_SECRET_ID to be set");
  }

  !options.silent &&
    secretCount &&
    console.log(
      logPrefix +
        "fetching " +
        secretCount +
        " secret" +
        plural(secretCount) +
        " from " +
        VAULT_ADDR
    );

  class RetryAuthFailure extends Error {}

  function checkStatusCode(response: Response) {
    if (response.statusCode == 403) {
      throw new RetryAuthFailure(
        "vault responded with 403 access denied when i tried to rotate, giving up"
      );
    } else {
      return response;
    }
  }

  function getNewLease(vaultPath: string, sync: boolean) {
    const fullUrl = VAULT_ADDR + VAULT_API_VERSION + "/" + vaultPath;
    if (sync) {
      const response = request("GET", fullUrl, {
        headers: {
          "X-Vault-Token": VAULT_TOKEN,
        },
      });

      try {
        onLease(vaultPath, parseLeaseResponse(checkStatusCode(response)));
      } catch (e) {
        console.error(e.message);
        if (!(e instanceof RetryAuthFailure)) {
          throw e;
        }
      }
    } else {
      const response = asyncRequest("GET", fullUrl, {
        headers: {
          "X-Vault-Token": VAULT_TOKEN,
        },
      });
      !options.silent &&
        console.log(
          logPrefix +
            "rotating lease for " +
            Object.keys(secretsByPath[vaultPath]).join(", ")
        );
      Promise.resolve(response)
        .then(checkStatusCode)
        .then(parseLeaseResponse)
        .then(onLease.bind(null, vaultPath))
        .catch(function retry(err: { stack?: string }) {
          console.error(
            logPrefix + "ERROR trying to rotate lease " + vaultPath
          );
          console.error(logPrefix + (err && err.stack ? err.stack : err));
          if (!(err instanceof RetryAuthFailure)) {
            console.error("retrying in 1s");
            setTimeout(getNewLease.bind(null, vaultPath), 1000);
          }
        });
    }
  }

  function onLease(vaultPath: string, lease: Lease) {
    const secretsByName = secretsByPath[vaultPath];
    const previousValues: Record<string, string | undefined> = {};
    for (const secretName in secretsByName) {
      const keyPath = secretsByName[secretName];
      const data = lease.data[keyPath];
      if (typeof data !== "string" && typeof data !== "number") {
        throw new Error(
          "Unexpected " +
            typeof data +
            " " +
            inspect(data) +
            " for " +
            vaultPath +
            ":" +
            secretsByName[secretName]
        );
      }
      if (options.autoRotate) {
        previousValues[secretName] = process.env[secretName];
      }
      if (!options.local) {
        process.env[secretName] = String(data);
      }
      varsWritten[secretName] = String(data);
    }
    if (!options.dryrun) {
      Object.keys(secretsByName).forEach(function (secretName) {
        if (process.env[secretName] !== previousValues[secretName]) {
          emitter.emit(
            secretName,
            process.env[secretName],
            previousValues[secretName]
          );
        }
      });
    }
    if (options.autoRotate) {
      const ttl = lease.ttl || lease.lease_duration;
      if (!ttl) {
        const keys = Object.keys(secretsByName).join(", ");
        console.error(
          `${logPrefix}Refusing to refresh vault lease no lease duration for ${keys} at ${vaultPath}`
        );
      } else {
        setTimeout(getNewLease.bind(null, vaultPath), (ttl / 2) * 1000);
      }
    }
  }

  Object.keys(secretsByPath).forEach(function (vaultPath) {
    const secretsByName = secretsByPath[vaultPath];
    const names = Object.keys(secretsByName);
    !options.silent &&
      process.stdout.write(
        logPrefix + "loading " + names.join(", ") + " from " + vaultPath
      );
    try {
      getNewLease(vaultPath, true);
      !options.silent && process.stdout.write(" " + green("✓") + "\n");
    } catch (err) {
      !options.silent && process.stdout.write(" " + red("✕") + "\n");
      throw err;
    }
  });

  return options.autoRotate ? emitter : varsWritten;
}
