import assert from "assert";

const SECRETFILE_PATTERN = /^([a-zA-Z_][a-zA-Z0-9_]+)\s+([^:\s]+):(.+)$/;
const SECRETFILE_COMMENT_PATTERN = /(^#)|(^\s*$)/;
const SECRETFILE_VAR_PATTERN = /\$(?:([a-zA-Z_][a-zA-Z0-9_]*)|\{([a-zA-Z_][a-zA-Z0-9_]*)\})/g;

/** Where to look up a secret. */
export interface SecretSource {
  vaultPath: string;
  vaultProp: string;
}

/**
 * Parse a `Secretfile`, returning the information that we find.
 *
 * @param data The contents of a `Secretfile`.
 * @results A map from environemnt variable names to secret locations in Vault.
 */
export default function parseSecretfile(
  data: string
): Record<string, SecretSource> {
  const errors: string[] = [];
  const secrets: Record<string, SecretSource> = {};

  const lines = data.split("\n");
  for (let i = 0; i < lines.length; ++i) {
    const line = lines[i];
    if (SECRETFILE_COMMENT_PATTERN.test(line)) continue;

    const matches = SECRETFILE_PATTERN.exec(line);
    if (!matches) {
      errors.push(`Invalid line ${i + 1}: ${line}`);
      continue;
    }

    const missingEnvVars = new Set<string>();
    const path = matches[2].replace(
      SECRETFILE_VAR_PATTERN,
      (_, a: string | undefined, b: string | undefined) => {
        const envVarName = a ?? b;
        assert(
          envVarName != null,
          "SECRETFILE_VAR_PATTERN should always match an env var name"
        );
        const envVar = process.env[envVarName];
        if (envVar == null) {
          missingEnvVars.add(envVarName);
          // Replace with a dummy value for now. We'll report the error below.
          return "UNDEFINED";
        }
        return envVar;
      }
    );

    if (missingEnvVars.size > 0) {
      const missing = Array.from(missingEnvVars).join(", ");
      errors.push(
        `Missing from environment: ${missing} for line ${i + 1} ${line}`
      );
      continue;
    }

    const varName = matches[1];
    secrets[varName] = {
      vaultPath: path,
      vaultProp: matches[3],
    };
  }

  if (errors.length > 0) {
    throw new Error(`Error parsing Secretfile:\n${errors.join("\n")}`);
  }

  return secrets;
}
