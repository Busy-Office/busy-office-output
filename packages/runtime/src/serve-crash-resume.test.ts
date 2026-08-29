/**
 * GAP-11 DoD (docs/GAP-REGISTER.md, ROADMAP Stage 4 gap register): "crash-
 * resume test green in serve mode". The embedded module already had this
 * proof (embed/create-output.test.ts); the HTTP path — `serve()`'s
 * `createIngressServer`, the PRIMARY demo topology — provably did not: it
 * minted via the pre-outbox `getOrCreateByResolutionKey`, so a crash
 * mid-composition stranded a permanently-DRAFT registry row with no
 * `composition_outbox` entry, invisible to `resumeStrandedCompositions`.
 *
 * Driven through the REAL HTTP server + a real `fetch`, never through
 * `createOutput()`. The crash is simulated by a renderer whose `render`
 * never settles: the POST is fired, the test waits until the transactional
 * mint has committed (outbox row visible), then tears the process's stores
 * and server down with composition still "in flight" — the dangling
 * promise never resolves, exactly like a process that died there. Restart
 * = the actual `serve()` entry point against the same on-disk files, whose
 * startup sweep (`server.resumed`) must finish the work.
 */
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Renderer } from '@busy-office/output-schema';
import { createIngressServer } from './server.js';
import { createRuntimeDeps, serve, type RuntimeDeps } from './index.js';
import { createSqliteRegistryStore } from './registry/sqlite-registry-store.js';
import { resumeStrandedCompositions } from './composition.js';
import { sampleBusinessEventKey, validPurchaseOrder, withBusinessEvent } from './fixtures.js';

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

const savedEnv: Record<string, string | undefined> = {};
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined && existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

/** Same helper as embed/create-output.test.ts — every artifact file under
 * an FsArchiveStore root, excluding `.meta.json` sidecars. */
function listArchivedArtifactFiles(archiveDir: string): string[] {
  if (!existsSync(archiveDir)) return [];
  const files: string[] = [];
  for (const shard of readdirSync(archiveDir)) {
    for (const name of readdirSync(join(archiveDir, shard))) {
      if (!name.endsWith('.meta.json')) files.push(join(shard, name));
    }
  }
  return files;
}

/** A renderer that never settles — composition hangs forever after the
 * mint has committed, which is indistinguishable (from the registry's point
 * of view) from the process dying right there. */
function hangingRenderer(real: Renderer): Renderer {
  return { id: real.id, version: real.version, accepts: real.accepts, render: () => new Promise<never>(() => {}) };
}

async function listenOn(server: ReturnType<typeof createIngressServer>): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

function postEvent(baseUrl: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 10));
  }
}

/**
 * Phase 1 of every test below: POST through the real HTTP server with a
 * hanging renderer, wait for the mint to commit, then "crash". Returns the
 * stranded docId. Asserts the exact pre-fix failure mode is now impossible:
 * the row IS in the outbox.
 */
async function crashMidCompositionOverHttp(deps: RuntimeDeps, archiveDir: string, businessObjectId: string) {
  const server = createIngressServer({
    registryStore: deps.registryStore,
    composition: { ...deps.composition, renderer: hangingRenderer(deps.composition.renderer) },
  });
  const baseUrl = await listenOn(server);

  const businessEvent = sampleBusinessEventKey({ businessObjectId });
  const payload = withBusinessEvent(validPurchaseOrder(), businessEvent);
  // Fire and do NOT await — the response can never arrive.
  const inflight = postEvent(baseUrl, payload).catch(() => undefined);

  await waitFor(() => deps.registryStore.listOutboxEntries().length === 1);
  const [entry] = deps.registryStore.listOutboxEntries();
  const docId = entry.docId;

  // Registry state exactly as a real crash leaves it: DRAFT, no archiveRef,
  // no bytes on disk — but, unlike before GAP-11, the outbox knows.
  expect(deps.registryStore.getByDocId(docId)?.state).toBe('DRAFT');
  expect(deps.registryStore.getByDocId(docId)?.archiveRef).toBeNull();
  expect(listArchivedArtifactFiles(archiveDir)).toEqual([]);
  expect(deps.registryStore.getOutboxEntry(docId)).toBeDefined();

  // --- "Crash": drop the connection and every store while composition hangs.
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await inflight;
  deps.deliveryQueue.close();
  deps.registryStore.close();

  return { docId, businessEvent, payload };
}

describe('serve mode: crash between mint and composition-complete on the HTTP path is resumable (GAP-11)', () => {
  it('a real serve() restart against the same files resumes the stranded HTTP mint: exactly one archived artifact, row reaches ORIGINAL, no duplicate on a second resume', async () => {
    const dbPath = join(tempDir('serve-crash-db-'), 'registry.db');
    const archiveDir = tempDir('serve-crash-archive-');
    const outboxDir = tempDir('serve-crash-outbox-');

    const deps1 = createRuntimeDeps(dbPath, archiveDir, outboxDir);
    const { docId, payload } = await crashMidCompositionOverHttp(deps1, archiveDir, 'SERVE-CRASH-0001');

    // --- "Restart": the ACTUAL serve() entry point (port 0, same db file;
    // archive/outbox roots via the env vars serve() honors), whose startup
    // sweep is what recovers the row in the real topology.
    for (const k of ['ARCHIVE_DIR', 'OUTBOX_DIR'] as const) savedEnv[k] = process.env[k];
    process.env.ARCHIVE_DIR = archiveDir;
    process.env.OUTBOX_DIR = outboxDir;
    const server = serve(0, dbPath);
    try {
      const resumed = await server.resumed;
      expect(resumed).toHaveLength(1);
      expect(resumed[0]).toMatchObject({ docId, skipped: false });
      if (resumed[0].skipped) throw new Error('unreachable');
      expect(resumed[0].outcome).toMatchObject({ outcome: 'rendered' });

      // Inspect the same on-disk registry through a separate connection
      // (WAL mode — the same pattern the delivery queue already relies on).
      const registry = createSqliteRegistryStore(dbPath);
      try {
        const row = registry.getByDocId(docId);
        expect(row?.state).toBe('ORIGINAL');
        expect(typeof row?.archiveRef).toBe('string');
        expect(listArchivedArtifactFiles(archiveDir)).toEqual([row?.archiveRef]);
        expect(registry.getOutboxEntry(docId)).toBeUndefined();

        // A replay of the SAME event over HTTP against the restarted server
        // returns the same docId, 200/replayed, and re-renders nothing.
        await new Promise<void>((resolve) => (server.listening ? resolve() : server.once('listening', () => resolve())));
        const { port } = server.address() as AddressInfo;
        const res = await postEvent(`http://127.0.0.1:${port}`, payload);
        const json = await res.json();
        expect(res.status).toBe(200);
        expect(json.docId).toBe(docId);
        expect(json.replayed).toBe(true);
        expect(json.resolutions[0].composition).toBeUndefined();
        expect(listArchivedArtifactFiles(archiveDir)).toEqual([row?.archiveRef]);
      } finally {
        registry.close();
      }
    } finally {
      server.worker.stop();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    // A second resume (another restart) is a no-op: no double render, no
    // duplicate archive file.
    const deps3 = createRuntimeDeps(dbPath, archiveDir, outboxDir);
    try {
      expect(await resumeStrandedCompositions(deps3.composition)).toEqual([]);
      expect(listArchivedArtifactFiles(archiveDir)).toHaveLength(1);
    } finally {
      deps3.deliveryQueue.close();
      deps3.registryStore.close();
    }
  }, 60_000);

  it('a replay over HTTP after the crash self-heals the stranded row even without a startup sweep', async () => {
    const dbPath = join(tempDir('serve-crash2-db-'), 'registry.db');
    const archiveDir = tempDir('serve-crash2-archive-');
    const outboxDir = tempDir('serve-crash2-outbox-');

    const deps1 = createRuntimeDeps(dbPath, archiveDir, outboxDir);
    const { docId, payload } = await crashMidCompositionOverHttp(deps1, archiveDir, 'SERVE-CRASH-0002');

    const deps2 = createRuntimeDeps(dbPath, archiveDir, outboxDir);
    const server = createIngressServer({ registryStore: deps2.registryStore, composition: deps2.composition });
    try {
      const baseUrl = await listenOn(server);
      const res = await postEvent(baseUrl, payload);
      const json = await res.json();
      // Same docId, and honestly `replayed` — but the response carries the
      // real composition outcome because the stranded work was redriven now.
      expect(res.status).toBe(200);
      expect(json.docId).toBe(docId);
      expect(json.replayed).toBe(true);
      expect(json.resolutions[0].composition).toMatchObject({ outcome: 'rendered' });

      const row = deps2.registryStore.getByDocId(docId);
      expect(row?.state).toBe('ORIGINAL');
      expect(listArchivedArtifactFiles(archiveDir)).toEqual([row?.archiveRef]);
      expect(deps2.registryStore.getOutboxEntry(docId)).toBeUndefined();
      expect(await resumeStrandedCompositions(deps2.composition)).toEqual([]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      deps2.deliveryQueue.close();
      deps2.registryStore.close();
    }
  }, 60_000);
});
