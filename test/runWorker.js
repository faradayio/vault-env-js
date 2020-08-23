/* eslint-disable no-undef */
/* eslint-disable @typescript-eslint/no-var-requires */

// A JavaScript-only loader that exists to register ts-node inside a NodeJS
// worker thread, and then to transfer control to the TypeScript code we want to
// run. See https://wanago.io/2019/05/06/node-js-typescript-12-worker-threads/

const path = require("path");
const { workerData } = require("worker_threads");

// Enable loading *.ts files as though they were *.js.
require("ts-node").register();

const fakeVault = require(path.resolve(__dirname, workerData.path)).default;
fakeVault(workerData.options);
