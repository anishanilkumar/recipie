// A recipe's photos (backend/recipie/photos.py): "own", a photo of the plate
// sent by Friday after cooking, and "web", a stand-in picked from an image
// search, with its credit. Own is shown when there is one.
//
// Which photos exist comes with every sync (/api/photos, kept in kv). The
// pictures themselves are cached by the service worker as they're seen; a
// new photo has a new ?v=, so a cached one is never stale.

import { useLiveQuery } from "dexie-react-hooks";
import { getKV, setKV } from "./db";
import { api } from "./sync";

export interface Credit {
  title: string;
  creator: string;
  creator_url: string;
  /** "CC BY-NC-ND 2.0", "CC0", "Public domain". */
  licence: string;
  licence_url: string;
  /** The picture's own page (Flickr, Wikimedia Commons). */
  landing_url: string;
  source: string;
  via: string;
}

export interface PhotoSlot {
  v: number;
  credit?: Credit;
}

export interface RecipePhotos {
  own?: PhotoSlot;
  web?: PhotoSlot;
}

export type Kind = "own" | "web";

export const PHOTOS_KEY = "photos";

export async function refreshPhotos(): Promise<void> {
  const { photos } = await api<{ photos: Record<string, RecipePhotos> }>("/api/photos");
  await setKV(PHOTOS_KEY, photos);
}

export function usePhotos(): Record<string, RecipePhotos> {
  return useLiveQuery(async () => (await getKV<Record<string, RecipePhotos>>(PHOTOS_KEY)) ?? {}, []) ?? {};
}

/** The photo to show: the plate photo, or else the stand-in. */
export function shown(p: RecipePhotos | undefined): { kind: Kind; slot: PhotoSlot } | null {
  if (p?.own) return { kind: "own", slot: p.own };
  if (p?.web) return { kind: "web", slot: p.web };
  return null;
}

export function photoUrl(recipeId: string, kind: Kind, slot: PhotoSlot, size: "full" | "thumb" = "full"): string {
  return `/api/photos/${encodeURIComponent(recipeId)}/${kind}/${size}?v=${slot.v}`;
}

// --- the web stand-in: the search runs here, not on the server -----------------
//
// Openverse sits behind a Cloudflare check that turns away data centres, the
// server included, so the app asks it directly (as openverse.org itself does)
// and sends the chosen picture's thumbnail and Openverse's record of it.
// The server makes the credit from that record (photos.py, credit_from).

const OPENVERSE = "https://api.openverse.org/v1";

/** Openverse's record of a picture, as its API sends it. */
export interface OpenverseRecord {
  id: string;
  title?: string;
  creator?: string;
  creator_url?: string;
  license?: string;
  license_version?: string;
  license_url?: string;
  foreign_landing_url?: string;
  source?: string;
  thumbnail?: string;
}

export interface Candidate {
  id: string;
  thumb: string;
  record: OpenverseRecord;
  /** "s4's world", for the grid. */
  creator: string;
  /** "CC BY-NC-ND 2.0". */
  licence: string;
}

export class SearchError extends Error {}

/** Openverse's licence code as people write it: "by-nc-nd", "2.0" -> "CC BY-NC-ND 2.0". Mirrors photos.py. */
export function licenceLabel(code = "", version = ""): string {
  const c = code.toLowerCase();
  if (c === "cc0") return "CC0";
  if (c === "pdm" || c === "publicdomain") return "Public domain";
  if (!c) return "";
  return `CC ${c.toUpperCase()} ${version}`.trim();
}

const SKIP = new Set(["for", "with", "and", "the", "a", "of"]);

/**
 * What to search for a recipe's title, most specific first:
 * "Kerala Egg Puffs (24)" -> ["kerala egg puffs", "egg puffs", "puffs"].
 */
export function searchTerms(title: string): string[] {
  const t = title.toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^\p{L}\p{N}\s'-]/gu, " ");
  const words = t.split(/\s+/).filter((w) => w && !/^\d+$/.test(w) && !SKIP.has(w));
  const terms = words.map((_, i) => words.slice(i).join(" "));
  return terms.length ? terms.slice(0, 3) : [title.trim().toLowerCase()];
}

async function openverse(q: string): Promise<Candidate[]> {
  let res: Response;
  try {
    res = await fetch(`${OPENVERSE}/images/?q=${encodeURIComponent(q)}&page_size=18&mature=false`, {
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
  } catch {
    throw new SearchError("No connection. The picture search needs the internet.");
  }
  if (res.status === 429) throw new SearchError("The picture search is busy. Try again in a minute.");
  if (!res.ok) throw new SearchError(`The picture search said ${res.status}.`);
  const data = (await res.json()) as { results?: OpenverseRecord[] };
  return (data.results ?? [])
    .filter((r) => /^[0-9a-f-]{36}$/.test(r.id) && r.license)
    .map((r) => ({
      id: r.id,
      thumb: `${OPENVERSE}/images/${r.id}/thumb/`,
      record: r,
      creator: r.creator ?? "",
      licence: licenceLabel(r.license, r.license_version),
    }));
}

/** The person's own words, or the title shortened until something turns up. */
export async function searchPhotos(title: string, q = ""): Promise<{ query: string; results: Candidate[] }> {
  if (q.trim()) return { query: q.trim(), results: await openverse(q.trim()) };
  let last = { query: "", results: [] as Candidate[] };
  for (const term of searchTerms(title)) {
    last = { query: term, results: await openverse(term) };
    if (last.results.length >= 4) break;
  }
  return last;
}

function base64(bytes: ArrayBuffer): string {
  const b = new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function chooseWebPhoto(recipeId: string, c: Candidate): Promise<void> {
  let image: string;
  try {
    const res = await fetch(c.thumb, { credentials: "omit", referrerPolicy: "no-referrer" });
    if (!res.ok) throw new SearchError(`That picture didn't download (${res.status}).`);
    image = base64(await res.arrayBuffer());
  } catch (e) {
    throw e instanceof SearchError ? e : new SearchError("No connection. The picture didn't download.");
  }
  await api(`/api/recipes/${encodeURIComponent(recipeId)}/photo/web`, {
    method: "POST",
    body: JSON.stringify({ id: c.id, record: c.record, image }),
  });
  await refreshPhotos();
}

export async function removePhoto(recipeId: string, kind: Kind): Promise<void> {
  await api(`/api/recipes/${encodeURIComponent(recipeId)}/photo/${kind}`, { method: "DELETE" });
  await refreshPhotos();
}
