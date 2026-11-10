import { parentPort, workerData } from 'node:worker_threads';
import { createSmokeHmrServer } from './smoke-hmr-server.mjs';

if (!parentPort) throw new Error('The HMR server must run in its owned worker.');
const server = await createSmokeHmrServer(workerData.backendPort);
await server.listen();
parentPort.postMessage({ type: 'ready', port: server.httpServer.address().port });
parentPort.once('message', async (message) => {
  if (message.type !== 'close') throw new Error('Unknown HMR worker lifecycle message.');
  await server.close();
  parentPort.close();
});
