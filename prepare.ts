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
  return JSON.parse(response.getBody().toString());
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

/** Block the current thread for `ms` ms (sync — for the initial, synchronous
 *  secret fetch only). */
function sleepSync(ms: number): void {
  // Atomics.wait on a throwaway SharedArrayBuffer is the cleanest way to block
  // synchronously in Node without a busy-loop.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Vault initialization options. */
export interface Options {
  VAULT_ADDR?: string;
  VAULT_TOKEN?: string;
  VAULT_API_VERSION?: string;
  VAULT_ENV_PATH?: string;
  VAULT_SECRETS?: Record<string, SecretSource>;
  silent?: boolean;
  autoRotate?: boolean;
  local?: boolean;
  dryrun?: boolean;
}

// We have historically supported two entirely different return values, so we
// need to overload our exported type below.

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
  const vault_token = options.VAULT_TOKEN || process.env.VAULT_TOKEN;

  if (vault_token) {
    console.log(logPrefix + "VAULT_TOKEN is set, using it");
  } else {
    // Proxy mode: no token. We talk to the in-pod Vault Agent's API-proxy
    // listener, configured with `use_auto_auth_token = "force"` — it injects
    // its auto-auth token on every request, so we send no X-Vault-Token.
    console.log(
      logPrefix +
        "no VAULT_TOKEN — using the Vault Agent API proxy at $VAULT_ADDR " +
        "(default http://127.0.0.1:8201)"
    );
  }

  const VAULT_ADDR = (
    options.VAULT_ADDR ||
    process.env.VAULT_ADDR ||
    (vault_token ? "http://127.0.0.1:8200" : "http://127.0.0.1:8201")
  ).replace(/([^/])$/, "$1/");

  const VAULT_API_VERSION =
    options.VAULT_API_VERSION || process.env.VAULT_API_VERSION || "v1";
  const VAULT_ENV_PATH =
    options.VAULT_ENV_PATH ||
    process.env.VAULT_ENV_PATH ||
    findRoot(process.argv[1] || process.cwd()) + "/Secretfile";
  const ORIGINAL_SECRETS =
    options.VAULT_SECRETS ?? parseSecretfile(readFile(VAULT_ENV_PATH, "utf8"));
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
    const headers: Record<string, string> = {};
    if (vault_token) headers["X-Vault-Token"] = vault_token;
    if (sync) {
      const response = request("GET", fullUrl, {
        headers,
      });
      try {
        onLease(vaultPath, parseLeaseResponse(checkStatusCode(response)));
      } catch (e) {
        if (e instanceof Error) {
          console.error(e.message);
        }
        if (!(e instanceof RetryAuthFailure)) {
          throw e;
        }
      }
    } else {
      const response = asyncRequest("GET", fullUrl, {
        headers,
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

  const MAX_INITIAL_FETCH_ATTEMPTS = 6;
  function isTransient(err: unknown): boolean {
    // A RetryAuthFailure (403) is caught and NOT re-thrown inside getNewLease,
    // so it never reaches here — but guard anyway: a 403 is a real config error.
    if (err instanceof RetryAuthFailure) return false;
    const msg = err instanceof Error ? err.message : String(err);
    // sync-request surfaces connection refusals as ECONNREFUSED etc. in the
    // message; on a 5xx, http-response-object#getBody() throws an Error whose
    // message contains "status code 5xx". 4xx is not retried (real config error).
    return (
      /ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ETIMEDOUT|socket hang ?up/i.test(
        msg
      ) || /status code 5\d\d\b/i.test(msg)
    );
  }

  Object.keys(secretsByPath).forEach(function (vaultPath) {
    const secretsByName = secretsByPath[vaultPath];
    const names = Object.keys(secretsByName);
    !options.silent &&
      process.stdout.write(
        logPrefix + "loading " + names.join(", ") + " from " + vaultPath
      );
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_INITIAL_FETCH_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        const delayMs = 500 * 2 ** (attempt - 1);
        !options.silent &&
          console.error(
            `${logPrefix}initial fetch for ${vaultPath} failed (attempt ${attempt}), retrying in ${delayMs}ms`
          );
        sleepSync(delayMs);
      }
      try {
        getNewLease(vaultPath, true);
        lastErr = undefined;
        break;
      } catch (err) {
        lastErr = err;
        if (!isTransient(err)) break;
      }
    }
    if (lastErr !== undefined) {
      !options.silent && process.stdout.write(" " + red("✕") + "\n");
      throw lastErr;
    }
    !options.silent && process.stdout.write(" " + green("✓") + "\n");
  });

  return options.autoRotate ? emitter : varsWritten;
}
