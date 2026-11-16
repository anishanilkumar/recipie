import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { assess, ingredientState, type Verdict } from "../cookable";
import { Lid } from "../components/Lid";
import { PhotoPanel, RecipePhoto } from "../components/RecipePhoto";
import { usePhotos } from "../photos";
import { Qty } from "../components/Qty";
import { StepIngredients } from "../components/StepIngredients";
import { deleteLocal, markOpened, saveLocal } from "../db";
import { clock, minutes } from "../format";
import { usePantry, useRecipe } from "../hooks";
import { getRecipeShare, setRecipeShare, type RecipeShareState } from "../recipeShare";
import { HttpError, syncNow, syncSoon } from "../sync";
import type { Ingredient, RecipeDoc } from "../types";

export function RecipeView() {
  const { id } = useParams();
  const recipe = useRecipe(id);
  const pantry = usePantry();
  const navigate = useNavigate();
  const [servings, setServings] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const photos = usePhotos();
  // The list's "Recent" order is by when a recipe was last opened here.
  useEffect(() => {
    if (id) void markOpened(id);
  }, [id]);

  const stock = pantry?.stock ?? null;
  const verdict = useMemo(() => (recipe ? assess(recipe.doc, stock) : null), [recipe, stock]);

  if (recipe === undefined) return null;
  if (recipe === null || recipe.deleted || !verdict) {
    return (
      <div className="page">
        <BackLink />
        <div className="empty">
          <p className="empty-title">This recipe isn't here.</p>
          <p>It may have been deleted on another device.</p>
          <Link className="btn" to="/">Back to all recipes</Link>
        </div>
      </div>
    );
  }

  const d = recipe.doc;
  const base = d.servings ?? null;
  const serves = servings ?? base;
  const remove = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 4000);
      return;
    }
    await deleteLocal(recipe.id);
    syncSoon();
    navigate("/", { replace: true });
  };

  // Put away, or brought back: an ordinary edit, so it syncs and works offline.
  const toggleArchive = async () => {
    await saveLocal(recipe.id, { ...d, archived: !d.archived });
    syncSoon();
  };

  return (
    <div className="page page-recipe">
      {/* The summary column on desktop. On a phone it dissolves
          (display: contents) and its children flow in the page as before,
          with the Edit/Delete row moved to the end by CSS order. */}
      <aside className="recipe-side">
      <BackLink />

      {d.archived ? (
        <p className="archived-note">
          Archived: off the recipe list and out of suggestions.{" "}
          <button className="link-btn" onClick={() => void toggleArchive()}>Bring it back</button>
        </p>
      ) : null}

      {recipe ? <RecipePhoto recipeId={recipe.id} photos={photos[recipe.id]} /> : null}

      <header className="recipe-head">
        <h1 className="recipe-title">{d.title}</h1>
        {d.description ? <p className="recipe-desc">{d.description}</p> : null}
        <p className="recipe-facts">
          {d.prep_minutes ? <span>Prep {minutes(d.prep_minutes)}</span> : null}
          {d.cook_minutes ? <span>Cook {minutes(d.cook_minutes)}</span> : null}
          {(d.tags ?? []).map((t) => (
            <span key={t} className="tag">{t}</span>
          ))}
        </p>
      </header>

      <Verdict verdict={verdict} />

      {d.prep_ahead?.note ? (
        <p className="prep-ahead">
          <span className="label">Ahead</span> {d.prep_ahead.note}
          {d.prep_ahead.hours_before ? <span className="stamp">, {d.prep_ahead.hours_before} h before</span> : null}
        </p>
      ) : null}

      <Link to={`/r/${recipe.id}/cook${serves && serves !== base ? `?serves=${serves}` : ""}`} className="btn btn-primary btn-cook">
        Start cooking
      </Link>

      <footer className="recipe-actions">
        <Link to={`/r/${recipe.id}/edit`} className="btn">Edit</Link>
        <button className="btn" aria-expanded={sharing} onClick={() => { setSharing((x) => !x); setPhotoOpen(false); }}>Share</button>
        <button className="btn btn-quiet" onClick={() => void toggleArchive()}>{d.archived ? "Unarchive" : "Archive"}</button>
        <button className="btn" aria-expanded={photoOpen} onClick={() => { setPhotoOpen((x) => !x); setSharing(false); }}>Photo</button>
        <button className={`btn ${confirmDelete ? "btn-danger" : "btn-quiet"}`} onClick={remove}>
          {confirmDelete ? "Tap again to delete" : "Delete"}
        </button>
        {sharing ? <SharePanel recipeId={recipe.id} title={d.title} /> : null}
        {photoOpen ? <PhotoPanel recipeId={recipe.id} title={d.title} photos={photos[recipe.id]} /> : null}
      </footer>
      </aside>

      <RecipeCols doc={d} stock={stock} serves={serves} onServes={setServings} />
    </div>
  );
}

/** Ingredients (with the servings stepper and ticks) and the method. Also the
 *  body of a shared recipe's page, where there's no pantry (stock is null). */
export function RecipeCols({ doc: d, stock, serves, onServes }: {
  doc: RecipeDoc;
  stock: Record<string, number> | null;
  serves: number | null;
  onServes: (n: number) => void;
}) {
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const base = d.servings ?? null;
  const factor = base && serves ? serves / base : 1;
  const groups = groupBy(d.ingredients);

  const toggle = (iid: string) =>
    setTicked((s) => {
      const n = new Set(s);
      if (n.has(iid)) n.delete(iid);
      else n.add(iid);
      return n;
    });

  return (
    <div className="recipe-cols">
        <section className="ingredients" aria-labelledby="ing-h">
          <div className="section-head">
            <h2 id="ing-h">Ingredients</h2>
            {base ? (
              <div className="stepper" aria-label="Servings">
                <button onClick={() => onServes(Math.max(1, (serves ?? 1) - 1))} aria-label="Fewer servings">−</button>
                <span>
                  <strong>{serves}</strong> {serves === 1 ? "serving" : "servings"}
                </span>
                <button onClick={() => onServes((serves ?? 1) + 1)} aria-label="More servings">+</button>
              </div>
            ) : null}
          </div>
          {groups.map(([group, items]) => (
            <div key={group || "_"} className="ing-group">
              {group ? <h3>{group}</h3> : null}
              <ul className="ing-list">
                {items.map((ing) => (
                  <IngredientRow
                    key={ing.id}
                    ing={ing}
                    factor={factor}
                    stock={stock}
                    ticked={ticked.has(ing.id)}
                    onToggle={() => toggle(ing.id)}
                  />
                ))}
              </ul>
            </div>
          ))}
        </section>

        <section className="method" aria-labelledby="method-h">
          <h2 id="method-h">Method</h2>
          <ol className="steps">
            {d.steps.map((s) => (
              <li key={s.id}>
                <p>{s.text}</p>
                <StepIngredients step={s} ingredients={d.ingredients} factor={factor} />
                {s.timer_seconds ? <span className="timer-chip">{clock(s.timer_seconds)}</span> : null}
              </li>
            ))}
          </ol>
          {d.notes ? (
            <>
              <h2>Notes</h2>
              <p className="notes">{d.notes}</p>
            </>
          ) : null}
          {d.source ? <p className="source">From {linkify(d.source)}</p> : null}
        </section>
    </div>
  );
}

/** The recipe's share link: made here, copied, replaced or switched off. */
function SharePanel({ recipeId, title }: { recipeId: string; title: string }) {
  const [share, setShare] = useState<RecipeShareState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  // The panel opens under the buttons, often below the fold: bring it into view.
  const panel = useRef<HTMLElement>(null);
  useEffect(() => { panel.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [share, error]);

  const fail = (e: unknown) => {
    if (e instanceof HttpError) {
      if (e.status === 401) setError("Signed out. Sign in and try again.");
      else setError(typeof e.detail === "string" ? e.detail : "The server wouldn't do that.");
    } else setError("No connection. A link needs the server; try again when you're online.");
  };

  useEffect(() => {
    let cancelled = false;
    getRecipeShare(recipeId).then((s) => { if (!cancelled) setShare(s); }, (e) => { if (!cancelled) fail(e); });
    return () => { cancelled = true; };
  }, [recipeId]);

  const act = async (body: Parameters<typeof setRecipeShare>[1]) => {
    setBusy(true);
    setError("");
    try {
      // A recipe made or edited a moment ago should be on the server first,
      // so the link shows what's on this screen.
      if (body.enabled !== false) await syncNow();
      setShare(await setRecipeShare(recipeId, body));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* no clipboard (http, old browser): the link is on screen to copy by hand */ }
  };

  const send = async (url: string) => {
    try {
      await navigator.share({ title, url });
    } catch { /* closed without sending */ }
  };

  return (
    <section className="recipe-share" aria-label="Share link" ref={panel}>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {share?.enabled && share.url ? (
        <>
          <p className="share-url"><a href={share.url} target="_blank" rel="noreferrer">{share.url}</a></p>
          <p className="edit-help">Anyone with this link can read this recipe and cook from it, no sign-in needed.
            They can't change it.</p>
          <div className="share-actions">
            {"share" in navigator ? (
              <button type="button" className="btn btn-primary" onClick={() => void send(share.url!)}>Send</button>
            ) : null}
            <button type="button" className={`btn${"share" in navigator ? "" : " btn-primary"}`} onClick={() => void copy(share.url!)}>
              {copied ? "Copied" : "Copy link"}
            </button>
            <button type="button" className={`btn ${confirmRotate ? "btn-danger" : ""}`} disabled={busy}
              onClick={() => {
                if (!confirmRotate) {
                  setConfirmRotate(true);
                  setTimeout(() => setConfirmRotate(false), 4000);
                  return;
                }
                setConfirmRotate(false);
                void act({ rotate: true });
              }}>
              {confirmRotate ? "Old link stops. Sure?" : "New link"}
            </button>
            <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void act({ enabled: false })}>
              Switch off
            </button>
          </div>
        </>
      ) : share ? (
        <>
          <p className="edit-help">Make a link to send this recipe to someone. It opens without a login; they can read
            it and cook from it, not change it. You can switch it off later.</p>
          <div className="share-actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void act({ enabled: true })}>
              {busy ? "Making…" : "Make a link"}
            </button>
          </div>
        </>
      ) : !error ? (
        <p className="edit-help">Checking…</p>
      ) : null}
    </section>
  );
}

function Verdict({ verdict }: { verdict: Verdict }) {
  const lower = (s: string) => s.toLowerCase();
  let headline: string;
  let detail: string | null = null;
  switch (verdict.status) {
    case "ready":
      headline = "You can cook this tonight.";
      if (verdict.swaps.length) detail = verdict.swaps.map((s) => `Use ${lower(s.use)} for the ${lower(s.ingredient)}.`).join(" ");
      break;
    case "almost":
      headline = "Almost. A small gap or two.";
      detail = [
        verdict.missing.length ? `Out of ${lower(verdict.missing.join(" and "))}.` : "",
        ...verdict.swaps.map((s) => `Use ${lower(s.use)} for the ${lower(s.ingredient)}.`),
      ].filter(Boolean).join(" ");
      break;
    case "no":
      headline = "Not tonight.";
      detail = verdict.missing_main.length
        ? `There's no ${lower(verdict.missing_main.join(" or "))}.`
        : `Out of ${lower(verdict.missing.join(", "))}.`;
      break;
    default:
      headline = "Can't tell yet.";
      detail = verdict.untracked_main.length
        ? `${verdict.untracked_main.join(", ")} isn't linked to the pantry. Edit the recipe to link it.`
        : "The pantry hasn't been checked. It will be on the next sync.";
  }
  return (
    <div className={`verdict verdict-${verdict.status}`} aria-live="polite">
      <span className="verdict-lid">
        <Lid verdict={verdict} size="lg" />
      </span>
      <div>
        <span className="label">Pantry check</span>
        <p className="verdict-head">{headline}</p>
        {detail ? <p className="verdict-detail">{detail}</p> : null}
      </div>
    </div>
  );
}

function IngredientRow({
  ing, factor, stock, ticked, onToggle,
}: {
  ing: Ingredient;
  factor: number;
  stock: Record<string, number> | null;
  ticked: boolean;
  onToggle: () => void;
}) {
  const st = stock ? ingredientState(ing, stock) : null;
  const role = ing.role ?? "minor";
  let flag: { text: string; tone: string } | null = null;
  if (st?.state === "missing") flag = { text: role === "optional" ? "out, optional" : "out", tone: role === "main" ? "no" : role === "optional" ? "quiet" : "almost" };
  else if (st?.state === "swap") flag = { text: `use ${st.use?.toLowerCase()}`, tone: "swap" };

  return (
    <li className={`ing ing-${role}${ticked ? " ing-ticked" : ""}`}>
      <button className="ing-tick" onClick={onToggle} aria-pressed={ticked}>
        <span className="ing-box" aria-hidden="true" />
        <span className="ing-text">
          <Qty ing={ing} factor={factor} />
          <span className="ing-name">{ing.name}</span>
          {ing.note ? <span className="ing-note">, {ing.note}</span> : null}
          {role === "optional" ? <span className="ing-note"> (optional)</span> : null}
        </span>
      </button>
      {flag ? <span className={`flag flag-${flag.tone}`}>{flag.text}</span> : null}
    </li>
  );
}

function groupBy(items: Ingredient[]): [string, Ingredient[]][] {
  const map = new Map<string, Ingredient[]>();
  for (const i of items) {
    const g = i.group ?? "";
    map.set(g, [...(map.get(g) ?? []), i]);
  }
  return [...map.entries()];
}

function linkify(source: string) {
  if (/^https?:\/\//.test(source)) {
    let host = source;
    try {
      host = new URL(source).hostname.replace(/^www\./, "");
    } catch { /* show as typed */ }
    return <a href={source} target="_blank" rel="noreferrer noopener">{host}</a>;
  }
  return source;
}

function BackLink() {
  return (
    <nav className="back">
      <Link to="/">All recipes</Link>
    </nav>
  );
}
