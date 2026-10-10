// .apex-development/src/secure/worker.mjs
var import_node_worker_threads = require("node:worker_threads");

// .apex-development/src/secure/format.mjs
var import_node_crypto = require("node:crypto");
var subtle = import_node_crypto.webcrypto.subtle;
var utf8 = new TextEncoder();
var decoder = new TextDecoder("utf-8", { fatal: true });
var FORMAT = "apex-protected";
var VERSION = 1;
var ITERATIONS = 6e5;
var MAX_NOTE_BYTES = 4 * 1024 * 1024;
var MAX_ASSET_BYTES = 32 * 1024 * 1024;
var MAX_CONTAINER_BYTES = 12 * 1024 * 1024;
var uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
var allowedKinds = /* @__PURE__ */ new Set(["info", "table", "text"]);
var encode = (b) => Buffer.from(b).toString("base64");
function decode(s, max = MAX_CONTAINER_BYTES) {
  if (typeof s !== "string" || s.length % 4 || s.length > Math.ceil(max / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw Error("\u65E0\u6548\u7684\u52A0\u5BC6\u6570\u636E\u7F16\u7801");
  return new Uint8Array(Buffer.from(s, "base64"));
}
var bytes = (s) => utf8.encode(s);
var rand = (n) => import_node_crypto.webcrypto.getRandomValues(new Uint8Array(n));
var id = () => (0, import_node_crypto.randomUUID)();
var newDomain = () => ({ salt: encode(rand(32)), iterations: ITERATIONS });
function checkDomain(d) {
  if (!d || !Number.isInteger(d.iterations) || d.iterations < ITERATIONS || d.iterations > 2e6 || decode(d.salt, 32).length !== 32) throw Error("\u4E0D\u652F\u6301\u7684\u53E3\u4EE4\u6D3E\u751F\u53C2\u6570");
}
async function deriveRoot(password, domain) {
  checkDomain(domain);
  if (typeof password !== "string" || password.length > 1024) throw Error("\u53E3\u4EE4\u683C\u5F0F\u9519\u8BEF");
  const input = bytes(password);
  const material = await subtle.importKey("raw", input, "PBKDF2", false, ["deriveBits"]);
  input.fill(0);
  const raw = await subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: decode(domain.salt), iterations: domain.iterations }, material, 256);
  const root = await subtle.importKey("raw", raw, "HKDF", false, ["deriveKey"]);
  new Uint8Array(raw).fill(0);
  return root;
}
async function purpose(root, fileId, label) {
  return subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: bytes(fileId), info: bytes("apex-protected/v1/" + label) }, root, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
var importAes = (raw) => subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
function aad(e, label) {
  return bytes(JSON.stringify([FORMAT, VERSION, e.id, e.domain.salt, e.domain.iterations, label]));
}
async function seal(key, raw, additionalData) {
  const nonce = rand(12);
  const ciphertext = await subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData, tagLength: 128 }, key, raw);
  return { nonce: encode(nonce), ciphertext: encode(ciphertext) };
}
async function unseal(key, box, additionalData, max = MAX_CONTAINER_BYTES) {
  if (!box || decode(box.nonce, 12).length !== 12) throw Error("\u5BC6\u6587 nonce \u65E0\u6548");
  try {
    return new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: decode(box.nonce), additionalData, tagLength: 128 }, key, decode(box.ciphertext, max)));
  } catch {
    throw Error("\u5BC6\u7801\u9519\u8BEF\u6216\u52A0\u5BC6\u6587\u4EF6\u635F\u574F\uFF0C\u539F\u6587\u4EF6\u672A\u66F4\u6539");
  }
}
function parseEnvelope(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_CONTAINER_BYTES) throw Error("\u52A0\u5BC6\u5468\u8BB0\u8D85\u8FC7\u5927\u5C0F\u9650\u5236");
  const e = JSON.parse(text);
  if (e.format !== FORMAT || e.version !== VERSION || !uuidPattern.test(e.id) || !Array.isArray(e.blocks) || !e.blocks.length || e.blocks.length > 512) throw Error("\u4E0D\u652F\u6301\u7684\u52A0\u5BC6\u5468\u8BB0\u683C\u5F0F");
  checkDomain(e.domain);
  const seen = /* @__PURE__ */ new Set();
  for (const b of e.blocks) {
    if (!uuidPattern.test(b.id) || seen.has(b.id) || !allowedKinds.has(b.kind)) throw Error("\u5206\u533A\u6E05\u5355\u4E0D\u5408\u6CD5");
    seen.add(b.id);
    for (const box of [b.key, b.data]) if (!box || decode(box.nonce, 12).length !== 12 || decode(box.ciphertext).length < 16) throw Error("\u52A0\u5BC6\u5757\u4E0D\u5B8C\u6574");
  }
  if (e.blocks[0].kind !== "info" || e.blocks.slice(1).some((b) => b.kind === "info")) throw Error("\u6587\u6863\u4FE1\u606F\u5757\u4E0D\u5408\u6CD5");
  return e;
}
var stringify = (e) => JSON.stringify(e) + "\n";
async function verify(e, root) {
  const m = JSON.parse(decoder.decode(await unseal(await purpose(root, e.id, "manifest"), e.manifest, aad(e, "manifest"))));
  if (JSON.stringify(m) !== JSON.stringify(e.blocks.map((b) => [b.id, b.kind]))) throw Error("\u5206\u533A\u6E05\u5355\u8BA4\u8BC1\u5931\u8D25");
}
async function sign(e, root) {
  e.manifest = await seal(await purpose(root, e.id, "manifest"), bytes(JSON.stringify(e.blocks.map((b) => [b.id, b.kind]))), aad(e, "manifest"));
}
function splitMarkdown(markdown) {
  if (Buffer.byteLength(markdown) > MAX_NOTE_BYTES) throw Error("\u5468\u8BB0\u8D85\u8FC7 4 MiB\uFF0C\u8BF7\u5148\u62C6\u5206");
  const starts = [];
  let offset = 0, fence = "", width = 0, front = false;
  for (const [i, line] of markdown.split(/(?<=\n)/).entries()) {
    const plain = line.replace(/\r?\n$/, "");
    if (i === 0 && plain.replace(/^\uFEFF/, "") === "---") {
      front = true;
      offset += line.length;
      continue;
    }
    if (front) {
      if (/^(---|\.\.\.)\s*$/.test(plain)) front = false;
      offset += line.length;
      continue;
    }
    const f = plain.match(/^ {0,3}(`{3,}|~{3,})/);
    if (f) {
      if (!fence) {
        fence = f[1][0];
        width = f[1].length;
      } else if (f[1][0] === fence && f[1].length >= width) fence = "";
    } else if (!fence && /^##\s+\S/.test(plain)) starts.push(offset);
    offset += line.length;
  }
  if (front || fence) throw Error("\u672A\u95ED\u5408\u7684 frontmatter \u6216\u4EE3\u7801\u5757\uFF0C\u8BF7\u5148\u4FEE\u6B63");
  const chunks = [{ kind: "info", raw: markdown.slice(0, starts[0] ?? markdown.length) }];
  for (let i = 0; i < starts.length; i++) {
    const raw = markdown.slice(starts[i], starts[i + 1] ?? markdown.length);
    chunks.push({ kind: /^\s*\|.+\|\s*$/m.test(raw) ? "table" : "text", raw });
  }
  return chunks;
}
async function createNote(markdown, title, password, domain = newDomain(), definitions = [], assetRefs = []) {
  if (password.length < 10) throw Error("\u8BF7\u4F7F\u7528\u81F3\u5C11 10 \u4E2A\u5B57\u7B26\u7684\u53E3\u4EE4");
  const root = await deriveRoot(password, domain);
  return createWithRoot(markdown, title, root, domain, definitions, assetRefs);
}
async function createWithRoot(markdown, title, root, domain, definitions = [], assetRefs = [], fileId = id()) {
  const e = { format: FORMAT, version: VERSION, id: fileId, domain, blocks: [], manifest: null };
  const chunks = splitMarkdown(markdown);
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i], blockId = id(), rawKey = rand(32), key = await importAes(rawKey);
    const payload = { raw: chunk.raw, ...i === 0 ? { title } : {}, definition: definitions[i - 1] ?? null, assets: assetRefs.filter((a) => chunk.raw.includes(a.link)) };
    const keyBox = await seal(await purpose(root, e.id, "wrap/" + blockId), rawKey, aad(e, "key/" + blockId + "/" + chunk.kind));
    rawKey.fill(0);
    const data = await seal(key, bytes(JSON.stringify(payload)), aad(e, "data/" + blockId + "/" + chunk.kind));
    e.blocks.push({ id: blockId, kind: chunk.kind, key: keyBox, data });
  }
  await sign(e, root);
  return e;
}
async function openBlock(e, root, blockId) {
  await verify(e, root);
  const b = e.blocks.find((b2) => b2.id === blockId);
  if (!b) throw Error("\u5206\u533A\u4E0D\u5B58\u5728");
  const rawKey = await unseal(await purpose(root, e.id, "wrap/" + b.id), b.key, aad(e, "key/" + b.id + "/" + b.kind), 48);
  if (rawKey.length !== 32) throw Error("\u5185\u5BB9\u5BC6\u94A5\u4E0D\u5408\u6CD5");
  const key = await importAes(rawKey);
  rawKey.fill(0);
  const raw = await unseal(key, b.data, aad(e, "data/" + b.id + "/" + b.kind));
  const payload = JSON.parse(decoder.decode(raw));
  raw.fill(0);
  if (typeof payload.raw !== "string" || !Array.isArray(payload.assets)) throw Error("\u5206\u533A\u5185\u5BB9\u683C\u5F0F\u9519\u8BEF");
  return { payload, key };
}
async function replaceBlock(e, blockId, key, payload) {
  if (Buffer.byteLength(payload.raw) > MAX_NOTE_BYTES) throw Error("\u5206\u533A\u8FC7\u5927");
  const b = e.blocks.find((b2) => b2.id === blockId);
  if (!b) throw Error("\u5206\u533A\u4E0D\u5B58\u5728");
  const next = structuredClone(e);
  next.blocks.find((b2) => b2.id === blockId).data = await seal(key, bytes(JSON.stringify(payload)), aad(e, "data/" + b.id + "/" + b.kind));
  return next;
}
async function openAll(e, root) {
  await verify(e, root);
  const payloads = [];
  for (const block of e.blocks) payloads.push((await openBlock(e, root, block.id)).payload);
  return { markdown: payloads.map((p) => p.raw).join(""), title: payloads[0].title, payloads };
}
async function encryptAsset(input) {
  if (input.byteLength > MAX_ASSET_BYTES) throw Error("\u9996\u7248\u9644\u4EF6\u4E0A\u9650 32 MiB");
  const assetId = id(), rawKey = rand(32), key = await importAes(rawKey);
  const asset = { format: "apex-asset", version: VERSION, id: assetId, data: await seal(key, input, bytes("apex-asset/v1/" + assetId)) };
  const secret = encode(rawKey);
  rawKey.fill(0);
  return { asset, key: secret };
}
async function decryptAsset(asset, ref) {
  if (asset.format !== "apex-asset" || asset.version !== VERSION || asset.id !== ref.id || !uuidPattern.test(asset.id)) throw Error("\u9644\u4EF6\u8EAB\u4EFD\u4E0D\u5339\u914D");
  const raw = decode(ref.key, 32);
  if (raw.length !== 32) throw Error("\u9644\u4EF6\u5BC6\u94A5\u65E0\u6548");
  const key = await importAes(raw);
  raw.fill(0);
  return unseal(key, asset.data, bytes("apex-asset/v1/" + asset.id), MAX_ASSET_BYTES + 16);
}
async function sha256(input) {
  return encode(await subtle.digest("SHA-256", typeof input === "string" ? bytes(input) : input));
}

// .apex-development/src/secure/worker.mjs
var tokens = /* @__PURE__ */ new Map();
var chain = Promise.resolve();
import_node_worker_threads.parentPort.on("message", (request) => {
  chain = chain.then(async () => {
    try {
      import_node_worker_threads.parentPort.postMessage({ id: request.id, result: await run(request.op, request.args) });
    } catch (error) {
      import_node_worker_threads.parentPort.postMessage({ id: request.id, error: error.message || "\u52A0\u5BC6\u64CD\u4F5C\u5931\u8D25" });
    }
  });
});
async function run(op, a) {
  if (op === "create") return stringify(await createNote(a.markdown, a.title, a.password, a.domain, a.definitions, a.assets));
  if (op === "domain") return newDomain();
  if (op === "hash") return sha256(a.value);
  if (op === "asset-encrypt") return encryptAsset(new Uint8Array(a.bytes));
  if (op === "asset-decrypt") return decryptAsset(a.asset, a.ref);
  if (op === "drop") {
    tokens.delete(a.token);
    return true;
  }
  if (op === "clear") {
    tokens.clear();
    return true;
  }
  if (op === "check-password") {
    const e = parseEnvelope(a.text), root = await deriveRoot(a.password, e.domain);
    await openBlock(e, root, e.blocks[0].id);
    return true;
  }
  if (op === "unlock") {
    const e = parseEnvelope(a.text), root = await deriveRoot(a.password, e.domain);
    const { payload, key } = await openBlock(e, root, a.blockId), token = id();
    tokens.set(token, { key, fileId: e.id, blockId: a.blockId });
    return { payload, token };
  }
  if (op === "save-block") {
    const e = parseEnvelope(a.text), handle = tokens.get(a.token);
    if (!handle || handle.fileId !== e.id) throw Error("\u89E3\u9501\u4F1A\u8BDD\u5DF2\u8FC7\u671F");
    return stringify(await replaceBlock(e, handle.blockId, handle.key, a.payload));
  }
  if (op === "open-all") {
    const e = parseEnvelope(a.text);
    let root;
    const cached = tokens.get(a.domainToken);
    if (cached && cached.domain === JSON.stringify(e.domain)) root = cached.root;
    else root = await deriveRoot(a.password, e.domain);
    const opened = await openAll(e, root), token = id();
    tokens.set(token, { root, domain: JSON.stringify(e.domain), fileId: e.id });
    return { ...opened, token };
  }
  if (op === "save-all") {
    const e = parseEnvelope(a.text), handle = tokens.get(a.token);
    if (!handle || handle.fileId !== e.id) throw Error("\u6574\u7BC7\u4F1A\u8BDD\u5DF2\u8FC7\u671F");
    return stringify(await createWithRoot(a.markdown, a.title, handle.root, e.domain, a.definitions, a.assets, e.id));
  }
  throw Error("\u672A\u77E5\u52A0\u5BC6\u64CD\u4F5C");
}
