// The whole book, shared with a friend: /b/<name>-<secret> (backend/recipie/books.py).
//
// Each friend has a link of their own, made on the household's Share page
// (/share). Whoever opens one has no account and no recipe book in this
// browser, so the page asks the server for the book and keeps the last copy
// in localStorage: once opened, it opens again with no signal. Photos come
// through the link too, and the service worker keeps them as they're seen.

import { useEffect, useState } from "react";
import { tagKey } from "./browse";
import type { Kind, PhotoSlot, RecipePhotos } from "./photos";
import { api, HttpError } from "./sync";
import type { RecipeDoc } from "./types";

export interface BookLink {
  id: string;
  name: string;
  enabled: boolean;
  slug: string;
  url: string;
  created_at: string;
}

export interface BookRecipe {
  id: string;
  updated_at: string;
  doc: RecipeDoc;
}

export interface SharedBook {
  slug: string;
  recipes: BookRecipe[];
  categories: string[];
  photos: Record<string, RecipePhotos>;
}

// --- the household's side ------------------------------------------------------

export const listBookLinks = () => api<{ links: BookLink[] }>("/api/book-links").then((r) => r.links);
export const makeBookLink = (name: string) =>
  api<BookLink>("/api/book-links", { method: "POST", body: JSON.stringify({ name }) });
export const changeBookLink = (id: string, body: { enabled?: boolean; rotate?: boolean; name?: string }) =>
  api<BookLink>(`/api/book-links/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify(body) });
export const removeBookLink = (id: string) =>
  api<{ ok: true }>(`/api/book-links/${encodeURIComponent(id)}`, { method: "DELETE" });

// --- the link ------------------------------------------------------------------

export type BookPhase = "loading" | "live" | "offline" | "gone";

/** A photo of a recipe in the book, through the link (the household's /api/photos needs a login). */
export const bookPhotoUrl = (slug: string) =>
  (recipeId: string, kind: Kind, slot: PhotoSlot, size: "full" | "thumb" = "full") =>
    `/api/book/${encodeURIComponent(slug)}/photos/${encodeURIComponent(recipeId)}/${kind}/${size}?v=${slot.v}`;

const key = (slug: string) => `recipie.book.${slug}`;

function cached(slug: string): SharedBook | null {
  try {
    const s = localStorage.getItem(key(slug));
    return s ? (JSON.parse(s) as SharedBook) : null;
  } catch {
    return null;
  }
}

function keep(slug: string, value: SharedBook | null) {
  try {
    if (value) localStorage.setItem(key(slug), JSON.stringify(value));
    else localStorage.removeItem(key(slug));
  } catch { /* private mode or full: the page still works, just not offline */ }
}

export function useSharedBook(slug: string): { book: SharedBook | null; phase: BookPhase } {
  const [state, setState] = useState<{ book: SharedBook | null; phase: BookPhase }>(
    () => ({ book: cached(slug), phase: "loading" }),
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const book = await api<SharedBook>(`/api/book/${encodeURIComponent(slug)}`);
        keep(slug, book);
        if (!cancelled) setState({ book, phase: "live" });
      } catch (e) {
        if (cancelled) return;
        if (e instanceof HttpError && e.status === 404) {
          // Switched off or replaced: forget the copy too.
          keep(slug, null);
          setState({ book: null, phase: "gone" });
        } else {
          setState((s) => ({ ...s, phase: "offline" }));
        }
      }
    };
    void load();
    window.addEventListener("online", load);
    document.addEventListener("visibilitychange", load);
    return () => {
      cancelled = true;
      window.removeEventListener("online", load);
      document.removeEventListener("visibilitychange", load);
    };
  }, [slug]);

  return state;
}

/** What the friend's list shows: matching the search and the category, A–Z (the server sends them in order). */
export function bookMatches(recipes: BookRecipe[], query: string, category: string | null): BookRecipe[] {
  const q = query.trim().toLowerCase();
  return recipes.filter(({ doc: d }) => {
    if (category && !(d.tags ?? []).some((t) => tagKey(t) === category)) return false;
    if (!q) return true;
    return [d.title, ...(d.tags ?? []), ...d.ingredients.map((i) => i.name)].some((s) => s.toLowerCase().includes(q));
  });
}
