import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { changeBookLink, listBookLinks, makeBookLink, removeBookLink, type BookLink } from "../bookShare";
import { HttpError } from "../sync";

// Sharing the whole book: one link per friend (backend/recipie/books.py).
// Online only: the links live on the server.
export function BookLinks() {
  const [links, setLinks] = useState<BookLink[] | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const fail = (e: unknown) => {
    if (e instanceof HttpError) {
      if (e.status === 401) setError("Signed out. Sign in and try again.");
      else setError(typeof e.detail === "string" ? e.detail : "The server wouldn't do that.");
    } else setError("No connection. Links live on the server; try again when you're online.");
  };

  useEffect(() => { listBookLinks().then(setLinks, fail); }, []);

  const make = async () => {
    setBusy(true);
    setError("");
    try {
      const made = await makeBookLink(name.trim());
      setLinks((l) => [...(l ?? []), made]);
      setName("");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const replace = (link: BookLink | null, id: string) =>
    setLinks((l) => (l ?? []).flatMap((x) => (x.id !== id ? [x] : link ? [link] : [])));

  return (
    <div className="page page-events">
      <header className="topbar">
        <nav className="back"><Link to="/">Recipes</Link></nav>
        <h1 className="wordmark">Share</h1>
      </header>

      <section className="recipe-share book-links-intro">
        <p className="edit-help">
          Give a friend a link to the whole book. It opens without a login and shows every recipe that isn't
          archived, with photos; they can read and cook from them, not change anything. New recipes and edits
          show on it by themselves. Each friend gets their own link, so you can stop one without the others.
        </p>
        <form className="photo-search" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void make(); }}>
          <label className="visually-hidden" htmlFor="book-friend">Who it's for</label>
          <input id="book-friend" placeholder="Who it's for, e.g. Rahul" value={name} maxLength={60}
            onChange={(e) => setName(e.target.value)} />
          <button className="btn btn-primary" disabled={busy || !name.trim()}>{busy ? "Making…" : "Make a link"}</button>
        </form>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </section>

      {links?.length ? (
        <ul className="tray">
          {links.map((l) => <LinkRow key={l.id} link={l} onChange={(x) => replace(x, l.id)} onError={fail} />)}
        </ul>
      ) : links ? (
        <p className="edit-help book-links-none">No links yet.</p>
      ) : null}
    </div>
  );
}

function LinkRow({ link, onChange, onError }: {
  link: BookLink; onChange: (l: BookLink | null) => void; onError: (e: unknown) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<"rotate" | "remove" | null>(null);

  const act = async (f: () => Promise<BookLink | null>) => {
    setBusy(true);
    try {
      onChange(await f());
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  // Destructive keys ask once more, the way Delete does on a recipe.
  const twice = (what: "rotate" | "remove", then: () => void) => {
    if (confirm !== what) {
      setConfirm(what);
      setTimeout(() => setConfirm(null), 4000);
      return;
    }
    setConfirm(null);
    then();
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* no clipboard: the link is on screen to copy by hand */ }
  };
  const send = async () => {
    try {
      await navigator.share({ title: "Recipes", url: link.url });
    } catch { /* closed without sending */ }
  };

  return (
    <li className="book-link">
      <p className="row-title">
        {link.name}
        {!link.enabled ? <span className="archived-mark"> off</span> : null}
      </p>
      {link.enabled ? (
        <>
          <p className="share-url"><a href={link.url} target="_blank" rel="noreferrer">{link.url}</a></p>
          <div className="share-actions">
            {"share" in navigator ? <button type="button" className="btn btn-primary" onClick={() => void send()}>Send</button> : null}
            <button type="button" className={`btn${"share" in navigator ? "" : " btn-primary"}`} onClick={() => void copy()}>
              {copied ? "Copied" : "Copy link"}
            </button>
            <button type="button" className={`btn ${confirm === "rotate" ? "btn-danger" : ""}`} disabled={busy}
              onClick={() => twice("rotate", () => void act(() => changeBookLink(link.id, { rotate: true })))}>
              {confirm === "rotate" ? "Old link stops. Sure?" : "New link"}
            </button>
            <button type="button" className="btn btn-quiet" disabled={busy}
              onClick={() => void act(() => changeBookLink(link.id, { enabled: false }))}>
              Switch off
            </button>
          </div>
        </>
      ) : (
        <div className="share-actions">
          <button type="button" className="btn" disabled={busy}
            onClick={() => void act(() => changeBookLink(link.id, { enabled: true }))}>
            Switch on
          </button>
          <button type="button" className={`btn ${confirm === "remove" ? "btn-danger" : "btn-quiet"}`} disabled={busy}
            onClick={() => twice("remove", () => void act(async () => { await removeBookLink(link.id); return null; }))}>
            {confirm === "remove" ? "Tap again to remove" : "Remove"}
          </button>
        </div>
      )}
    </li>
  );
}
