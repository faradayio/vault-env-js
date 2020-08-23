#!/usr/bin/env node
import prepare from "./prepare";

const newEnv = prepare({
  silent: true,
  dryrun: true,
});

for (const key in newEnv) {
  console.log("export " + key + "=" + newEnv[key]);
}
