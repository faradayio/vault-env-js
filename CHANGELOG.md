# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [6.0.0-beta.1] 2020-08-23

## Changed

- Upgrade to TypeScript 4.

## [5.0.0-alpha.1] 2020-08-23

### Changed

- All `Secretfile` entries must now have the form `VAR_NAME path/to/secret:key`. We no longer support values which are missing `:key`, or which have or nested `:key1:key1`.
- The return type of `parseSecretfile` has changed.
- The `VAULT_SECRETS` option now has type `Record<string, { vaultPath: string, vaultProp: string }>`.
- The code has been ported to TypeScript.
- All dependencies have been updated.
