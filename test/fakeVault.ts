import { Worker } from "worker_threads";
import { V1Secret, V2Secret } from '../prepare';

/** Options for our fake Vault server. */
export interface FakeVaultOptions {
  /** The Vault token to expect. */
  token: string;
  /** The port to listen on. */
  port: number;
  /** The secrets to serve. */
  secrets: V1Secret | V2Secret;
}

/**
 * A fake Vault server.
 *
 * This runs in a separate thread using a NodeJS worker thread, because the
 * `vault-env` library we want to test includes blocking code that would prevent
 * our fake HTTP server from responding to requests.
 */
export class FakeVaultServer {
  /** Our background worker. */
  private worker: Worker;
  /**
   * Call this function when we're listening for requests.
   *
   * We use `!` to tell TypeScript that this is actually initialized in the
   * constructor, even if TypeScript can't prove that.
   */
  private resolveReady!: () => void;
  /** A promise that will resolve when `resolveReady` is called. */
  private ready: Promise<void>;
  /** The most recent error we've seen. */
  private error: Error | undefined;

  /** Create a new Vault server. */
  constructor(options: FakeVaultOptions) {
    this.ready = new Promise((resolve) => {
      this.resolveReady = resolve;
    });

    this.worker = new Worker("./test/runWorker.js", {
      workerData: {
        path: "fakeVaultWorker.ts",
        options,
      },
    });
    this.worker.addListener("error", (error) => {
      console.log("FakeVaulServer error:", error);
      this.error = error;
    });
    this.worker.addListener("message", (value: string) => {
      if (value === "ready") {
        // Our background worker notified us that it has finished starting up.
        this.resolveReady();
      }
    });
  }

  /** Wait until the server is ready to respond to requests. */
  waitUntilReady(): Promise<void> {
    return this.ready;
  }

  /** Shut down the server, throwing any background errors. */
  async close(): Promise<void> {
    await this.worker.terminate();
    if (this.error != null) throw this.error;
  }
}
