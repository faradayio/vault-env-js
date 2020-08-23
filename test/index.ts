import assert = require("assert");
import { writeFileSync as writeFile } from "fs";
import { fileSync as tmpFile } from "tmp";
import { SecretSource } from "../parseSecretfile";
import prepare, { Options } from "../prepare";
import { FakeVaultServer } from "./fakeVault";

const TEST_PORT = 39582;
const TEST_TOKEN = "test-token-1";
process.env.SAMPLE = "hello";

interface TestOptions {
  secretfile?: string;
  secrets: Record<string, Record<string, string>>;
  expected?: Record<string, string>;
  overrides?: Record<string, string>;
  throws?: RegExp;
  local?: boolean;
  secretdata?: Record<string, SecretSource>;
}

/** Create a test case. */
function test(name: string, options: TestOptions) {
  const secretfile = options.secretfile;
  const secretdata = options.secretdata;
  const secrets = options.secrets;
  const expected = options.expected;
  const overrides = options.overrides;
  const throws = options.throws;
  const local = options.local;
  const secretfilePath = tmpFile().name;

  function doIt() {
    for (const key in overrides) {
      process.env[key] = overrides[key];
    }
    const opts: Options & { autoRotate: false } = {
      VAULT_ADDR: `http://127.0.0.1:${TEST_PORT}`,
      VAULT_TOKEN: TEST_TOKEN,
      silent: false,
      local: local,
      autoRotate: false,
    };
    if (secretfile) {
      opts.VAULT_ENV_PATH = secretfilePath;
    } else {
      opts.VAULT_SECRETS = secretdata;
    }
    return prepare(opts);
  }
  function cleanup() {
    for (const key in expected) {
      delete process.env[key];
    }
  }

  it(name, async () => {
    if (secretfile) writeFile(secretfilePath, secretfile);
    const vaultServer = new FakeVaultServer({
      token: TEST_TOKEN,
      port: TEST_PORT,
      secrets,
    });
    await vaultServer.waitUntilReady();
    try {
      if (throws) {
        assert.throws(doIt, throws);
      } else {
        const mySecret = doIt();
        for (const key in expected) {
          if (!options.local) {
            assert.strictEqual(
              process.env[key],
              expected[key],
              `${key} should match`
            );
          } else {
            assert.notEqual(
              process.env[key],
              expected[key],
              `${key} should not match`
            );
            assert.strictEqual(
              mySecret[key],
              expected[key],
              `${key} should match`
            );
          }
        }
      }
    } finally {
      cleanup();
      await vaultServer.close();
    }
  });
}

test("one env var", {
  secretfile: "thing secret/thing:url",
  secrets: {
    "secret/thing": {
      url: "hellooooo",
    },
  },
  expected: {
    thing: "hellooooo",
  },
});

test("override env var", {
  secretfile: "thing secret/thing:url",
  secrets: {},
  expected: {
    thing: "hellooooo",
  },
  overrides: {
    thing: "hellooooo",
  },
});

test("two env vars", {
  secretfile: "thing1 secret/thing:url1\nthing2 secret/thing:url2",
  secrets: {
    "secret/thing": {
      url1: "hellooooo",
      url2: "goodbyeeee",
    },
  },
  expected: {
    thing1: "hellooooo",
    thing2: "goodbyeeee",
  },
});

test("one invalid env var", {
  secretfile: "2 secret/thing:url1",
  secrets: {},
  throws: /Error parsing Secretfile:\nInvalid line 1: 2 secret\/thing:url1/,
});

test("two invalid env vars", {
  secretfile: "2 secret/thing:url1\n3 boop:thing",
  secrets: {},
  throws: /Error parsing Secretfile:\nInvalid line 1: 2 secret\/thing:url1\nInvalid line 2: 3 boop:thing/,
});

test("missing secret", {
  secretfile: "boop secret/thing:url",
  secrets: {},
  throws: /key not found/,
});

test("missing environment variable secret", {
  secretfile: "boop secret/$MISSING_VAR:url",
  secrets: {},
  throws: /Error parsing Secretfile:\nMissing from environment: MISSING_VAR for line 1 boop secret\/\$MISSING_VAR:url/,
});

test("one invalid secret path", {
  secretfile: "thing secret/thing",
  secrets: {},
  throws: /Error parsing Secretfile/,
});

test("two invalid secret paths", {
  secretfile: "thing secrets/thing\nstuff secrets/stuff",
  secrets: {},
  throws: /Error parsing Secretfile/,
});

test("multiple secrets from one path", {
  secretfile: "one secrets/test:one\ntwo secrets/test:two",
  secrets: {
    "secrets/test": { one: "one", two: "two" },
  },
  expected: {
    one: "one",
    two: "two",
  },
});

test("env substitution", {
  secretfile: "one secrets/$SAMPLE:one\ntwo secrets/${SAMPLE}:two",
  secrets: {
    "secrets/hello": { one: "one", two: "two" },
  },
  expected: {
    one: "one",
    two: "two",
  },
});

test("one var local only", {
  secretfile: "thing secret/thing:url",
  secrets: {
    "secret/thing": {
      url: "hellooooo",
    },
  },
  expected: {
    thing: "hellooooo",
  },
  local: true,
});

test("two vars local only", {
  secretfile: "thing1 secret/thing:url1\nthing2 secret/thing:url2",
  secrets: {
    "secret/thing": {
      url1: "hellooooo",
      url2: "goodbyeeee",
    },
  },
  expected: {
    thing1: "hellooooo",
    thing2: "goodbyeeee",
  },
  local: true,
});

test("passing in data", {
  secretdata: {
    thing1: { vaultPath: "secret/thing", vaultProp: "url1" },
    thing2: { vaultPath: "secret/thing", vaultProp: "url2" },
  },
  secrets: {
    "secret/thing": {
      url1: "hellooooo",
      url2: "goodbyeeee",
    },
  },
  expected: {
    thing1: "hellooooo",
    thing2: "goodbyeeee",
  },
  local: true,
});
