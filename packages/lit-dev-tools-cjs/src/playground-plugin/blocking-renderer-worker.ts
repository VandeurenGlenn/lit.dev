/**
 * @license
 * Copyright 2020 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {isMainThread, parentPort} from 'worker_threads';
import {Renderer} from './renderer.js';
import {
  WorkerMessage,
  HandshakeMessage,
  Render,
  Shutdown,
} from './blocking-renderer.js';

if (isMainThread || !parentPort) {
  throw new Error('BlockingRenderer worker must be spawned in a worker thread');
}

const rendererPromise = Renderer.start();
// const encoder = new TextEncoder();
let shuttingDown = false;

let sharedDataResolve: (value: HandshakeMessage) => void;
let sharedDataPromise = new Promise<HandshakeMessage>((resolve) => {
  sharedDataResolve = resolve;
});

const unreachable = (_x: never, msg: string) => new Error(msg);

parentPort.on('message', (msg: WorkerMessage) => {
  switch (msg.type) {
    case 'handshake':
      return onHandshake(msg);
    case 'render':
      return onRender(msg);
    case 'shutdown':
      return onShutdown(msg);
    default:
      throw unreachable(
        msg,
        `Unknown or missing message type: ${(msg as WorkerMessage).type}`
      );
  }
});

const onHandshake = (msg: HandshakeMessage) => {
  sharedDataResolve(msg);
  msg.port.start();
  msg.port.on('message', (msg: Render) => {
    return onRender(msg);
  });
};

const onRender = async (msg: Render) => {
  console.log(`rendering ${msg.code.slice(0, 20)}`);
  console.time(`rendered ${msg.code.slice(0, 20)}`);
  const renderer = await rendererPromise;
  const {html} = await renderer.render(msg.lang, msg.code);
  const shared = await sharedDataPromise;
  // const length = html.length;
  // if (length > shared.htmlBuffer.length) {
  //   throw new Error(
  //     `Shared HTML buffer was too short ` +
  //       `(${shared.htmlBuffer.length} < ${html.length} bytes)`
  //   );
  // }
  // shared.htmlBufferLength[0] = length;
  // encoder.encodeInto(html, shared.htmlBuffer);
  shared.port.postMessage(html);
  Atomics.notify(shared.notify, 0);
  console.timeEnd(`rendered ${msg.code.slice(0, 20)}`);
};

const onShutdown = async (_msg: Shutdown) => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  const renderer = await rendererPromise;
  await renderer.stop();
  process.exit(0);
};
