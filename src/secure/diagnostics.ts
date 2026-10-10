import type { App } from 'obsidian';

const PATH = '.apex-protected-diagnostics.json';
let queue = Promise.resolve();

/** Bounded local diagnostics. Never serialize request arguments, messages or payloads. */
export function recordDiagnostic(app: App, stage: string, error: unknown): Promise<void> {
  const e = error instanceof Error ? error as Error & { code?: string } : null;
  const entry = {
    time: new Date().toISOString(), stage,
    name: e?.name ?? 'UnknownError', code: e?.code ?? null,
    frames: (e?.stack ?? '').split('\n').filter(line => /^\s+at /.test(line)).slice(0, 8),
  };
  console.error('[Apex protected]', entry);
  queue = queue.catch(() => {}).then(async () => {
    let entries: unknown[] = [];
    try {
      if (await app.vault.adapter.exists(PATH)) {
        const text = await app.vault.adapter.read(PATH);
        if (text.length < 32768) { const parsed = JSON.parse(text); if (Array.isArray(parsed)) entries = parsed; }
      }
    } catch { /* A damaged diagnostic must not block recovery. */ }
    await app.vault.adapter.write(PATH, JSON.stringify([...entries.slice(-19), entry], null, 2));
  }).catch(() => { /* The original operation still reports its own failure. */ });
  return queue;
}
