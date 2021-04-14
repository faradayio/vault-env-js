import { createServer, Server } from "http";
import { parentPort } from "worker_threads";
import { FakeVaultOptions } from "./fakeVault";
import assert from "assert";

/**
 * Run a fake Vault server.
 *
 * This is involved by `FakeVaultServer` in a background worker thread so that
 * it won't get deadlocked when `vault-env` tries to make synchronous HTTP
 * requests.
 */
export default function fakeVault(options: FakeVaultOptions): Server {
  console.log("starting fake Vault with", JSON.stringify(options, null, 2));
  const { token, port, secrets } = options;

  return createServer(function responder(req, res) {
    console.log(`received request at ${req.url}`);
    if (req.url == null)
      throw new Error("expected Vault request to include a URL");
    let key = req.url.slice(1);
    const version = key.slice(0, 2);
    key = key.slice(3);
    if (version !== "v1") {
      res.writeHead(500);
      res.end("invalid api version " + version);
    } else if (req.method !== "GET") {
      res.writeHead(404);
      res.end("only get method is allowed");
    } else if (req.headers["x-vault-token"] !== token) {
      res.writeHead(503);
      res.end("invalid token");
    } else if (typeof secrets[key] === "undefined") {
      res.writeHead(404);
      res.end("key not found " + key);
    } else {
      res.writeHead(200);
      res.end(JSON.stringify({ data: secrets[key] }));
      delete secrets[key];
    }
  }).listen(port, function () {
    // Let our parent process know we're serving.
    assert(parentPort != null, "should always have parentPort in worker");
    parentPort.postMessage("ready");
  });
}
