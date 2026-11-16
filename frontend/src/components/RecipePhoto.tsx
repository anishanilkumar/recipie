import { useEffect, useRef, useState } from "react";
import {
  chooseWebPhoto, photoUrl, removePhoto, searchPhotos, shown,
  type Candidate, type Credit, type RecipePhotos,
} from "../photos";
import { HttpError, syncNow } from "../sync";

/** The list's square: the recipe's photo, or its first letter engraved. */
export function Thumb({ recipeId, title, photos }: { recipeId: string; title: string; photos?: RecipePhotos }) {
  const s = shown(photos);
  const [broken, setBroken] = useState(false);
  if (s && !broken) {
    return (
      <img className="row-thumb" src={photoUrl(recipeId, s.kind, s.slot, "thumb")} alt="" loading="lazy"
        onError={() => setBroken(true)} />
    );
  }
  const letter = [...title.trim()][0]?.toUpperCase() ?? "·";
  return <span className="row-thumb row-thumb-blank" aria-hidden="true">{letter}</span>;
}

/** The recipe page's photo, with whose it is. Nothing when there's none. */
export function RecipePhoto({ recipeId, photos }: { recipeId: string; photos?: RecipePhotos }) {
  const s = shown(photos);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [s?.slot.v]);
  if (!s || broken) return null;
  return (
    <figure className="recipe-photo">
      <img src={photoUrl(recipeId, s.kind, s.slot)} alt="" onError={() => setBroken(true)} />
      <figcaption>
        {s.kind === "own" ? (
          <span>Cooked here, {new Date(s.slot.v).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span>
        ) : (
          <>
            <span className="photo-standin">Stand-in</span> <CreditLine credit={s.slot.credit} />
          </>
        )}
      </figcaption>
    </figure>
  );
}

/** "“Egg Puffs” by Ranjitha, CC BY-NC-ND 2.0, via Openverse", each part linked. */
export function CreditLine({ credit }: { credit?: Credit }) {
  if (!credit) return null;
  const link = (href: string, text: string) =>
    href ? <a href={href} target="_blank" rel="noreferrer">{text}</a> : <>{text}</>;
  return (
    <span className="photo-credit">
      {link(credit.landing_url, credit.title ? `“${credit.title}”` : "Photo")}
      {credit.creator ? <> by {link(credit.creator_url, credit.creator)}</> : null}
      {credit.licence ? <>, {link(credit.licence_url, credit.licence)}</> : null}
      {credit.source ? <>, from {credit.source.replace(/_/g, " ")}</> : null}
      {credit.via ? <> via {credit.via}</> : null}
    </span>
  );
}

/** Find a stand-in, or take a photo away. Online only. */
export function PhotoPanel({ recipeId, photos }: { recipeId: string; photos?: RecipePhotos }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Candidate[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  // Some pictures Openverse lists no longer load; they're left out rather than shown blank.
  const [dead, setDead] = useState<Set<string>>(new Set());
  const panel = useRef<HTMLElement>(null);
  useEffect(() => { panel.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [results, error]);

  const fail = (e: unknown) => {
    if (e instanceof HttpError) {
      if (e.status === 401) setError("Signed out. Sign in and try again.");
      else setError(typeof e.detail === "string" ? e.detail : "The server wouldn't do that.");
    } else setError("No connection. Photos need the server; try again when you're online.");
  };

  const search = async (q: string) => {
    setBusy("search");
    setError("");
    try {
      // A recipe made a moment ago must reach the server before it can have a photo.
      await syncNow();
      const res = await searchPhotos(recipeId, q);
      setQuery(res.query);
      setResults(res.results);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const choose = async (c: Candidate) => {
    setBusy(c.id);
    setError("");
    try {
      await chooseWebPhoto(recipeId, c.id);
      setResults(null);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const drop = async (kind: "own" | "web") => {
    setBusy(kind);
    setError("");
    try {
      await removePhoto(recipeId, kind);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="recipe-photo-panel" aria-label="Photo" ref={panel}>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <p className="edit-help">
        The photo you take for the food log after cooking (Friday, “Photograph the plate”) becomes this recipe's
        photo. Until then, a stand-in from the web can show, with its credit.
      </p>
      <form className="photo-search" onSubmit={(e) => { e.preventDefault(); void search(query); }}>
        <label className="visually-hidden" htmlFor="photo-q">Search pictures</label>
        <input id="photo-q" type="search" placeholder="Search pictures (the title if empty)" value={query}
          onChange={(e) => setQuery(e.target.value)} />
        <button className="btn btn-primary" disabled={busy !== null}>
          {busy === "search" ? "Looking, can take a while…" : photos?.web ? "Find another stand-in" : "Find a stand-in"}
        </button>
      </form>
      {results ? (
        results.length ? (
          <ul className="photo-grid">
            {results.filter((c) => !dead.has(c.id)).map((c) => (
              <li key={c.id}>
                <button type="button" className="photo-pick" disabled={busy !== null} onClick={() => void choose(c)}
                  aria-label={`Use “${c.credit.title || "this picture"}” by ${c.credit.creator || "unknown"}`}>
                  <img src={c.thumb} alt="" loading="lazy" referrerPolicy="no-referrer"
                    onError={() => setDead((d) => new Set(d).add(c.id))} />
                  {busy === c.id ? <span className="photo-pick-busy">Saving…</span> : null}
                </button>
                <p className="photo-pick-credit">
                  {c.credit.creator || "Unknown"} · {c.credit.licence || "licence unknown"}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="edit-help">Nothing found. Try fewer or other words, like the dish's plain name.</p>
        )
      ) : null}
      {photos?.web || photos?.own ? (
        <div className="share-actions">
          {photos?.web ? (
            <button type="button" className="btn btn-quiet" disabled={busy !== null} onClick={() => void drop("web")}>
              Remove stand-in
            </button>
          ) : null}
          {photos?.own ? (
            <button type="button" className="btn btn-quiet" disabled={busy !== null} onClick={() => void drop("own")}>
              Remove plate photo
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
