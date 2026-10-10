// Test harness only. Obsidian's renderer cannot create Node worker_threads.
import { parentPort } from 'node:worker_threads';
import { receive } from './worker.mjs';
parentPort.on('message', request => receive(request, result => parentPort.postMessage(result)));
