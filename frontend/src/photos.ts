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

// --- changing them: online only, like a share link -------------------------------

export interface Candidate {
  id: string;
  thumb: string;
  width: number | null;
  height: number | null;
  credit: Credit;
}

export const searchPhotos = (recipeId: string, q = "") =>
  api<{ query: string; results: Candidate[] }>(
    `/api/recipes/${encodeURIComponent(recipeId)}/photo/search${q ? `?q=${encodeURIComponent(q)}` : ""}`,
  );

export async function chooseWebPhoto(recipeId: string, id: string): Promise<void> {
  await api(`/api/recipes/${encodeURIComponent(recipeId)}/photo/web`, { method: "POST", body: JSON.stringify({ id }) });
  await refreshPhotos();
}

export async function removePhoto(recipeId: string, kind: Kind): Promise<void> {
  await api(`/api/recipes/${encodeURIComponent(recipeId)}/photo/${kind}`, { method: "DELETE" });
  await refreshPhotos();
}
