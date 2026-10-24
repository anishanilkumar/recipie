// Events: the household's editor, and the page a share link opens.
//
// Unlike recipes, events don't live in IndexedDB. The share page is for
// people with no account and no recipe book in this browser, so it talks to
// the server directly. It still has to survive a shop with one bar of signal:
//  - the last copy of the event is kept in localStorage, so the page opens
//    offline;
//  - every tick, added item, note and "done" goes into an outbox first and
//    shows at once (applyOp), then is sent in order when there's a connection.
//    Items and notes get their ids here, so one added offline can be ticked
//    before it reaches the server, and a resend after a dropped reply lands
//    once.
//  - while the page is open it asks every few seconds whether anything
//    changed (one number, `version`), so two people shopping see each other's
//    ticks.

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { api, HttpError } from "./sync";
import type {
  Dish, DishStatus, EventDoc, EventSummary, OwnedEvent, SharedEvent,
} from "./types";

// --- the household's side ------------------------------------------------------

export const listEvents = () => api<{ events: EventSummary[] }>("/api/events").then((r) => r.events);
export const getEvent = (id: string) => api<OwnedEvent>(`/api/events/${id}`);
export const createEvent = (doc: EventDoc) =>
  api<OwnedEvent>("/api/events", { method: "POST", body: JSON.stringify(doc) });
export const updateEvent = (id: string, baseRev: number, doc: EventDoc) =>
  api<OwnedEvent>(`/api/events/${id}`, { method: "PUT", body: JSON.stringify({ base_rev: baseRev, doc }) });
export const deleteEvent = (id: string) => api<{ ok: true }>(`/api/events/${id}`, { method: "DELETE" });
export const shareEvent = (id: string, body: { enabled?: boolean; rotate?: boolean; name?: string }) =>
  api<OwnedEvent>(`/api/events/${id}/share`, { method: "POST", body: JSON.stringify(body) });
export const deleteNote = (id: string, noteId: string) =>
  api<{ ok: true }>(`/api/events/${id}/notes/${noteId}`, { method: "DELETE" });

/** A visitor's "done" wins over the menu's until the household changes that dish (events.py). */
export function dishStatus(view: { dish_status: SharedEvent["dish_status"] }, dish: Dish): DishStatus {
  return view.dish_status[dish.id]?.status ?? dish.status ?? "todo";
}

// --- the share link ------------------------------------------------------------

export type Op =
  | { kind: "check"; key?: string; item_id?: string; checked: boolean }
  | { kind: "add"; id: string; name: string; amount: number | null; unit: string }
  | { kind: "remove"; id: string }
  | { kind: "note"; id: string; target: string; text: string }
  | { kind: "dish"; dish_id: string; status: DishStatus };

export type Queued = Op & { by: string; at: string };

/** The event as it will be once `op` reaches the server. Pure. */
export function applyOp(v: SharedEvent, op: Queued): SharedEvent {
  switch (op.kind) {
    case "check":
      if (op.item_id) {
        return { ...v, items: v.items.map((i) => (i.id === op.item_id ? { ...i, checked: op.checked, checked_by: op.checked ? op.by : "" } : i)) };
      }
      return { ...v, shopping: v.shopping.map((l) => (l.key === op.key ? { ...l, checked: op.checked, checked_by: op.checked ? op.by : "" } : l)) };
    case "add":
      if (v.items.some((i) => i.id === op.id)) return v;
      return { ...v, items: [...v.items, {
        id: op.id, name: op.name, amount: op.amount, unit: op.unit,
        checked: false, checked_by: "", added_by: op.by, at: op.at,
      }] };
    case "remove":
      return { ...v, items: v.items.filter((i) => i.id !== op.id) };
    case "note":
      if (v.notes.some((n) => n.id === op.id)) return v;
      return { ...v, notes: [...v.notes, { id: op.id, target: op.target, author: op.by, text: op.text, at: op.at }] };
    case "dish":
      return { ...v, dish_status: { ...v.dish_status, [op.dish_id]: { status: op.status, by: op.by, at: op.at } } };
  }
}

function request(slug: string, op: Queued): Promise<unknown> {
  const base = `/api/share/${encodeURIComponent(slug)}`;
  const post = (path: string, body: object) => api(`${base}${path}`, { method: "POST", body: JSON.stringify({ ...body, by: op.by }) });
  switch (op.kind) {
    case "check": return post("/check", { key: op.key, item_id: op.item_id, checked: op.checked });
    case "add": return post("/items", { id: op.id, name: op.name, amount: op.amount, unit: op.unit });
    case "remove": return api(`${base}/items/${op.id}`, { method: "DELETE" });
    case "note": return post("/notes", { id: op.id, target: op.target, text: op.text });
    case "dish": return post(`/dish/${op.dish_id}`, { status: op.status });
  }
}

export type SharePhase = "loading" | "live" | "offline" | "gone";

interface ShareState {
  server: SharedEvent | null;
  queue: Queued[];
  phase: SharePhase;
  /** Why the last change didn't go through, in words for the visitor. */
  notice: string;
}

function read<T>(key: string): T | null {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { /* private mode or full: the page still works, just not offline */ }
}

class Share {
  state: ShareState;
  private listeners = new Set<() => void>();
  private flushing = false;

  constructor(private slug: string) {
    const server = read<SharedEvent>(this.snapKey);
    this.state = { server, queue: read<Queued[]>(this.queueKey) ?? [], phase: "loading", notice: "" };
  }

  private get snapKey() { return `recipie.share.${this.slug}`; }
  private get queueKey() { return `recipie.outbox.${this.slug}`; }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  };

  private set(patch: Partial<ShareState>) {
    this.state = { ...this.state, ...patch };
    if ("server" in patch) write(this.snapKey, this.state.server);
    if ("queue" in patch) write(this.queueKey, this.state.queue.length ? this.state.queue : null);
    this.listeners.forEach((l) => l());
  }

  async refresh(): Promise<void> {
    const since = this.state.server?.version ?? 0;
    try {
      const r = await api<SharedEvent | { version: number; unchanged: true }>(
        `/api/share/${encodeURIComponent(this.slug)}?since=${since}`,
      );
      if ("unchanged" in r) this.set({ phase: "live" });
      else this.set({ server: r, phase: "live" });
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) {
        // Switched off, rotated or deleted: forget it, and anything unsent.
        this.set({ server: null, queue: [], phase: "gone" });
      } else {
        this.set({ phase: "offline" });
      }
    }
  }

  send(op: Op, by: string) {
    this.set({ queue: [...this.state.queue, { ...op, by, at: new Date().toISOString() }], notice: "" });
    void this.flush();
  }

  async flush(): Promise<void> {
    if (this.flushing || !this.state.queue.length) return;
    this.flushing = true;
    let sent = false;
    try {
      while (this.state.queue.length) {
        const [op, ...rest] = this.state.queue;
        try {
          await request(this.slug, op);
        } catch (e) {
          // No answer at all: keep it, and try again when we're back online.
          if (!(e instanceof HttpError)) {
            this.set({ phase: "offline" });
            return;
          }
          // The server answered no (the item's gone, the list is full). It
          // won't change its mind, so drop it and say why.
          this.set({ notice: e.message === `HTTP ${e.status}` ? "A change couldn't be saved." : e.message });
        }
        sent = true;
        this.set({ queue: rest });
      }
    } finally {
      this.flushing = false;
      if (sent) await this.refresh();
    }
  }
}

const shares = new Map<string, Share>();

function share(slug: string): Share {
  let s = shares.get(slug);
  if (!s) shares.set(slug, (s = new Share(slug)));
  return s;
}

const POLL_MS = 8000;

/** The shared event with this visitor's unsent changes already applied. */
export function useSharedEvent(slug: string) {
  const s = share(slug);
  const st = useSyncExternalStore(s.subscribe, () => s.state);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      void s.flush().then(() => s.refresh());
    };
    tick();
    const t = setInterval(tick, POLL_MS);
    window.addEventListener("online", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(t);
      window.removeEventListener("online", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [s]);

  const event = useMemo(() => (st.server ? st.queue.reduce(applyOp, st.server) : null), [st.server, st.queue]);
  return {
    event,
    phase: st.phase,
    pending: st.queue.length,
    notice: st.notice,
    send: (op: Op) => s.send(op, visitorName()),
  };
}

// --- who's ticking -------------------------------------------------------------

const NAME_KEY = "recipie.name";
const nameListeners = new Set<() => void>();

export function visitorName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setVisitorName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name.trim().slice(0, 40));
  } catch { /* not remembered; ticks just go unsigned */ }
  nameListeners.forEach((l) => l());
}

export function useVisitorName(): string {
  return useSyncExternalStore((l) => {
    nameListeners.add(l);
    return () => void nameListeners.delete(l);
  }, visitorName);
}
