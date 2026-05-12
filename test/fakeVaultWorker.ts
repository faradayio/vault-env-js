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
  console.log("starting fake Vault with", options);
  const { token, port, secrets, acceptAnyToken, failFirstRequests } = options;
  let requestCount = 0;

  return createServer(function responder(req, res) {
    console.log(`received request at ${req.url}`);
    if (req.url == null)
      throw new Error("expected Vault request to include a URL");

    // If configured to fail first N requests, return 503 early.
    if (failFirstRequests !== undefined && requestCount < failFirstRequests) {
      requestCount++;
      res.writeHead(503);
      res.end("simulated transient failure (request " + requestCount + ")");
      return;
    }
    requestCount++;

    let key = req.url.slice(1);
    const version = key.slice(0, 2);
    key = key.slice(3);
    if (version !== "v1") {
      res.writeHead(500);
      res.end("invalid api version " + version);
    } else if (req.method !== "GET") {
      res.writeHead(404);
      res.end("only get method is allowed");
    } else if (acceptAnyToken) {
      // Proxy mode: assert no X-Vault-Token header is present.
      if (req.headers["x-vault-token"] !== undefined) {
        res.writeHead(400);
        res.end(
          "proxy mode: expected no X-Vault-Token header but got: " +
            req.headers["x-vault-token"]
        );
      } else if (typeof secrets[key] === "undefined") {
        res.writeHead(404);
        res.end("key not found " + key);
      } else {
        res.writeHead(200);
        res.end(JSON.stringify({ data: secrets[key] }));
        delete secrets[key];
      }
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
