// Moves changes between IndexedDB and the server.
//
// Push first, then pull:
//  1. Every dirty recipe goes up with the rev it was based on.
//     - accepted: it's clean, at the server's new rev (unless it was edited
//       again while the request was in flight — then it stays dirty, rebased).
//     - conflict: someone (usually Claude) changed it meanwhile. The server's
//       version wins the original id, and the local edit is kept as a copy
//       titled "… (my edit)", so nothing typed in the kitchen is ever lost.
//  2. Pull everything after our cursor. A recipe still dirty locally is left
//     alone; its push will settle it.
//  3. Refresh the pantry snapshot, which the badges are computed from.

import { useSyncExternalStore } from "react";
import { db, getKV, PANTRY_KEY, setKV } from "./db";
import type { LocalRecipe, PantrySnapshot, ServerRow } from "./types";
import { newId } from "./types";

export type SyncPhase = "idle" | "syncing" | "offline" | "signed-out" | "error";

interface SyncState {
  phase: SyncPhase;
  lastSyncedAt: string | null;
  pending: number;
  message?: string;
}

let state: SyncState = { phase: "idle", lastSyncedAt: null, pending: 0 };
const listeners = new Set<() => void>();

function set(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export class HttpError extends Error {
  /** The server's `detail`, when it sent one: a sentence, or an object (409s). */
  constructor(public status: number, public detail?: unknown) {
    super(typeof detail === "string" ? detail : `HTTP ${status}`);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-Recipie": "1", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail: unknown;
    try {
      detail = ((await res.json()) as { detail?: unknown }).detail;
    } catch { /* not JSON: nginx's own error page */ }
    throw new HttpError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

function fromServer(row: ServerRow): LocalRecipe {
  return {
    id: row.id,
    rev: row.rev,
    deleted: row.deleted,
    updated_at: row.updated_at,
    updated_by: row.updated_by,
    doc: row.doc,
    dirty: 0,
    localVersion: 0,
  };
}

interface PushResult {
  id: string;
  status: "ok" | "conflict" | "invalid";
  row: ServerRow | null;
}

/** Returns true when a conflict left a "(my edit)" copy that still needs sending. */
async function push(): Promise<boolean> {
  const dirty = await db.recipes.where("dirty").equals(1).toArray();
  if (!dirty.length) return false;
  let copies = false;
  const sent = new Map(dirty.map((r) => [r.id, r.localVersion]));
  const { results } = await api<{ results: PushResult[] }>("/api/sync", {
    method: "POST",
    body: JSON.stringify({
      changes: dirty.map((r) => ({ id: r.id, base_rev: r.rev, deleted: r.deleted, doc: r.deleted ? null : r.doc })),
    }),
  });

  await db.transaction("rw", db.recipes, async () => {
    for (const res of results) {
      const local = await db.recipes.get(res.id);
      if (!local) continue;
      const editedSince = local.localVersion !== sent.get(res.id);

      if (res.status === "ok") {
        if (!res.row || res.row.deleted) {
          if (!editedSince) await db.recipes.delete(res.id);
          else await db.recipes.update(res.id, { rev: res.row?.rev ?? 0 });
        } else if (editedSince) {
          await db.recipes.update(res.id, { rev: res.row.rev });
        } else {
          await db.recipes.put(fromServer(res.row));
        }
      } else if (res.status === "conflict" && res.row) {
        if (!local.deleted) {
          copies = true;
          await db.recipes.put({
            ...local,
            id: newId(),
            rev: 0,
            dirty: 1,
            doc: { ...local.doc, title: `${local.doc.title} (my edit)` },
          });
        }
        await db.recipes.put(fromServer(res.row));
      } else if (res.status === "invalid") {
        // The server will never accept it as is. Keep it locally, marked, and
        // stop resending it every sync.
        console.warn("[recipie] server rejected recipe", res.id, res);
        await db.recipes.update(res.id, { dirty: 0 });
      }
    }
  });
  return copies;
}

async function pull(): Promise<void> {
  let cursor = (await getKV<number>("cursor")) ?? 0;
  for (;;) {
    const page = await api<{ cursor: number; more: boolean; changes: ServerRow[] }>(`/api/sync?since=${cursor}`);
    await db.transaction("rw", db.recipes, db.kv, async () => {
      for (const row of page.changes) {
        const local = await db.recipes.get(row.id);
        if (local?.dirty) continue;
        if (row.deleted) await db.recipes.delete(row.id);
        else await db.recipes.put(fromServer(row));
      }
      await setKV("cursor", page.cursor);
    });
    cursor = page.cursor;
    if (!page.more) break;
  }
}

async function refreshPantry(): Promise<void> {
  const snap = await api<PantrySnapshot>("/api/pantry");
  const previous = await getKV<PantrySnapshot>(PANTRY_KEY);
  // Grocy down and the server has nothing either: keep our older snapshot.
  if (snap.stock == null && previous?.stock != null) {
    await setKV(PANTRY_KEY, { ...previous, stale: true });
    return;
  }
  await setKV(PANTRY_KEY, snap);
}

let running: Promise<void> | null = null;
let again = false;

export function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await runOnce();
    } while (again);
  })().finally(() => {
    running = null;
  });
  return running;
}

async function runOnce(): Promise<void> {
  if (!navigator.onLine) {
    set({ phase: "offline", pending: await db.recipes.where("dirty").equals(1).count() });
    return;
  }
  set({ phase: "syncing" });
  try {
    if (await push()) await push();
    await pull();
    await refreshPantry();
    await setKV("me", await api<{ username: string; demo: boolean }>("/api/me"));
    const now = new Date().toISOString();
    await setKV("lastSyncedAt", now);
    set({ phase: "idle", lastSyncedAt: now, message: undefined });
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) set({ phase: "signed-out" });
    else if (e instanceof TypeError) set({ phase: "offline" });
    else set({ phase: "error", message: String(e) });
  } finally {
    set({ pending: await db.recipes.where("dirty").equals(1).count() });
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;

/** Sync shortly after a local edit, coalescing a burst of edits into one request. */
export function syncSoon(): void {
  clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), 800);
  void db.recipes.where("dirty").equals(1).count().then((pending) => set({ pending }));
}

export async function startSync(): Promise<void> {
  set({ lastSyncedAt: (await getKV<string>("lastSyncedAt")) ?? null });
  window.addEventListener("online", () => void syncNow());
  window.addEventListener("offline", () => set({ phase: "offline" }));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void syncNow();
  });
  // Picks up recipes Claude saved while the app sat open on the counter.
  setInterval(() => {
    if (document.visibilityState === "visible") void syncNow();
  }, 60_000);
  await syncNow();
}
