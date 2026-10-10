import { receive } from './worker.mjs';
self.addEventListener('message', event => receive(event.data, result => self.postMessage(result)));
