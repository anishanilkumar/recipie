import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { categoryChoices, hasTag, isNew, sortRecipes, type Sort } from "../browse";
import { reason, STATUS_LABEL, type Status } from "../cookable";
import { Lid } from "../components/Lid";
import { Thumb } from "../components/RecipePhoto";
import { usePhotos } from "../photos";
import { SyncPill } from "../components/SyncPill";
import { HttpError, saveCategories } from "../sync";
import { ago, minutes } from "../format";
import { useArrived, useCategories, useMe, useOpened, usePantry, useRecipeEvents, useRecipes } from "../hooks";

type Filter = "all" | Status;

export function Home() {
  const recipes = useRecipes();
  const pantry = usePantry();
  const me = useMe();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>(() => (localStorageGet("filter") as Filter) || "all");
  const [sort, setSort] = useState<Sort>(() => (localStorageGet("sort") === "az" ? "az" : "recent"));
  const [tag, setTag] = useState<string | null>(() => localStorageGet("tag") || null);
  const opened = useOpened();
  const arrived = useArrived();
  const photos = usePhotos();
  const byRecipe = useRecipeEvents();
  // Big-batch recipes made for an event ("Rajma (30)") crowd out the everyday
  // ones; this takes them off the list, and out of the counts, until wanted.
  const [hideEvents, setHideEvents] = useState(() => localStorageGet("hideEvents") === "1");
  // Archived recipes are off the list, and out of the counts, until asked for.
  const [showArchived, setShowArchived] = useState(() => localStorageGet("showArchived") === "1");
  const archivedCount = useMemo(() => (recipes ?? []).filter(({ recipe }) => recipe.doc.archived).length, [recipes]);
  const eventCount = useMemo(() => (recipes ?? []).filter(({ recipe }) => byRecipe.has(recipe.id)).length, [recipes, byRecipe]);
  const listable = useMemo(
    () => (recipes ?? []).filter(({ recipe }) =>
      !(hideEvents && byRecipe.has(recipe.id)) && (showArchived || !recipe.doc.archived)),
    [recipes, hideEvents, byRecipe, showArchived],
  );
  const categories = useCategories();
  const [editingCategories, setEditingCategories] = useState(false);
  const tags = useMemo(() => categoryChoices(listable.map((r) => r.recipe), categories), [listable, categories]);
  // A remembered tag nobody uses any more (renamed, or its recipes hidden) shouldn't empty the list.
  const activeTag = tag && tags.some((t) => t.key === tag) ? tag : null;
  // The tag narrows the counts too: "ready tonight" among the desserts.
  const visible = useMemo(
    () => listable.filter(({ recipe }) => !activeTag || hasTag(recipe, activeTag)),
    [listable, activeTag],
  );

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, ready: 0, almost: 0, no: 0, unknown: 0 };
    for (const r of visible) {
      c.all++;
      c[r.verdict.status]++;
    }
    return c;
  }, [visible]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = visible.filter(({ recipe, verdict }) => {
      if (filter !== "all" && verdict.status !== filter) return false;
      if (!q) return true;
      const d = recipe.doc;
      return [d.title, ...(d.tags ?? []), ...d.ingredients.map((i) => i.name)].some((s) => s.toLowerCase().includes(q));
    });
    return sortRecipes(matched, sort, opened ?? {}, arrived ?? {});
  }, [visible, filter, query, sort, opened, arrived]);

  const choose = (f: Filter) => {
    setFilter(f);
    localStorageSet("filter", f);
  };
  const chooseTag = (t: string | null) => {
    setTag(t);
    localStorageSet("tag", t ?? "");
  };
  const chooseSort = (s: Sort) => {
    setSort(s);
    localStorageSet("sort", s);
  };
  const toggleArchived = (show: boolean) => {
    setShowArchived(show);
    localStorageSet("showArchived", show ? "1" : "0");
  };
  const toggleEvents = (hide: boolean) => {
    setHideEvents(hide);
    localStorageSet("hideEvents", hide ? "1" : "0");
  };

  return (
    <div className="page page-home">
      <header className="topbar">
        <h1 className="wordmark">Recipie</h1>
        <span className="topbar-end">
          <Link to="/events" className="pill">Events</Link>
          {me?.demo ? null : <Link to="/share" className="pill">Share</Link>}
          <SyncPill />
        </span>
      </header>

      {me?.demo ? (
        <p className="demo-note">
          A demo with a made-up pantry. Open a recipe, start cooking, or edit one: anything you change stays in
          this browser and nobody else sees it.{" "}
          <a href="https://github.com/anishanilkumar/recipie">Source on GitHub</a>
        </p>
      ) : null}

      {/* The one number this screen exists to show, the way a Jarvis tile does:
          how many recipes can be cooked right now. The three readouts are
          also the filters. */}
      <section className="instrument tonight" aria-label="What can we cook tonight">
        <div className="tonight-top">
          <button className={`tonight-hero filter-ready${filter === "ready" ? " is-on" : ""}`}
            aria-pressed={filter === "ready"} onClick={() => choose(filter === "ready" ? "all" : "ready")}>
            <span className="label">Ready tonight</span>
            <span className="hero">{counts.ready}</span>
          </button>
          <div className="tonight-side">
            {(["almost", "no"] as const).map((f) => (
              <button key={f} className={`tonight-readout filter-${f}${filter === f ? " is-on" : ""}`}
                aria-pressed={filter === f} onClick={() => choose(filter === f ? "all" : f)}>
                <span className="label">{STATUS_LABEL[f]}</span>
                <span className="readout">{counts[f]}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="tonight-foot">
          <span className="stamp">
            {pantry?.fetched_at
              ? `Pantry checked ${ago(pantry.fetched_at)}${pantry.stale ? ", Grocy didn't answer" : ""}`
              : "Pantry not checked yet"}
          </span>
          {filter !== "all" ? (
            <button className="link-btn" onClick={() => choose("all")}>Show all {counts.all}</button>
          ) : (
            <span className="stamp">{counts.all} recipes</span>
          )}
        </div>
      </section>

      <div className="search">
        <label>
          <span className="visually-hidden">Search recipes</span>
          <input
            type="search"
            placeholder="Search by name, tag or ingredient"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="tag-strip" role="group" aria-label="Show one category">
          {tags.map((t) => (
            <button key={t.key} className={`tag-chip${activeTag === t.key ? " is-on" : ""}`}
              aria-pressed={activeTag === t.key} onClick={() => chooseTag(activeTag === t.key ? null : t.key)}>
              {t.label}
              <span className="tag-chip-n">{t.count}</span>
            </button>
          ))}
          <button className="tag-chip tag-chip-edit" aria-expanded={editingCategories}
            onClick={() => setEditingCategories((x) => !x)}>
            {editingCategories ? "Done" : "Edit"}
          </button>
        </div>
        {editingCategories ? <CategoriesEditor categories={categories} onDone={() => setEditingCategories(false)} /> : null}
        <div className="search-tools">
          <span className="sort-switch" role="group" aria-label="Order">
            {(["recent", "az"] as const).map((s) => (
              <button key={s} className={`link-btn${sort === s ? " is-on" : ""}`} aria-pressed={sort === s} onClick={() => chooseSort(s)}>
                {s === "recent" ? "Recent" : "A–Z"}
              </button>
            ))}
          </span>
          {archivedCount ? (
            <button className="link-btn search-tool" aria-pressed={showArchived} onClick={() => toggleArchived(!showArchived)}>
              {showArchived ? "Hide archived" : `Show ${archivedCount} archived`}
            </button>
          ) : null}
          {eventCount ? (
            <button className="link-btn search-tool" aria-pressed={hideEvents} onClick={() => toggleEvents(!hideEvents)}>
              {hideEvents
                ? `Show ${eventCount} event ${eventCount === 1 ? "recipe" : "recipes"}`
                : `Hide ${eventCount} event ${eventCount === 1 ? "recipe" : "recipes"}`}
            </button>
          ) : null}
        </div>
      </div>

      {recipes === undefined ? null : recipes.length === 0 ? (
        <div className="empty">
          <p className="empty-title">No recipes yet.</p>
          <p>Ask Claude to save one to Recipie, or write your own.</p>
          <Link className="btn btn-primary" to="/new">
            Add a recipe
          </Link>
        </div>
      ) : shown.length === 0 ? (
        <div className="empty">
          <p className="empty-title">Nothing matches.</p>
          <button className="btn" onClick={() => { setQuery(""); choose("all"); chooseTag(null); toggleEvents(false); }}>
            Show all recipes
          </button>
        </div>
      ) : (
        <ul className="tray">
          {shown.map(({ recipe, verdict }) => {
            const d = recipe.doc;
            const time = (d.prep_minutes ?? 0) + (d.cook_minutes ?? 0);
            return (
              <li key={recipe.id}>
                <Link to={`/r/${recipe.id}`} className="row">
                  <Lid verdict={verdict} />
                  <span className="row-body">
                    <span className="row-title">
                      {isNew(recipe.id, opened ?? {}, arrived ?? {}) ? <span className="row-new">New</span> : null}
                      {d.title}
                    </span>
                    <span className={`row-why why-${verdict.status}`}>{reason(verdict)}</span>
                    {byRecipe.has(recipe.id) ? (
                      <span className="row-events">{byRecipe.get(recipe.id)!.map((e) => e.title).join(" · ")}</span>
                    ) : null}
                  </span>
                  <span className="row-meta">
                    {time ? minutes(time) : null}
                    {recipe.dirty ? <span className="unsent" title="Not synced yet">unsent</span> : null}
                    {d.archived ? <span className="archived-mark">archived</span> : null}
                  </span>
                  <Thumb recipeId={recipe.id} title={d.title} photos={photos[recipe.id]} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <Link to="/new" className="fab" aria-label="Add a recipe">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
        </svg>
      </Link>
    </div>
  );
}

/** The household's category row, as one line of names. Saved for every device; online only. */
function CategoriesEditor({ categories, onDone }: { categories: string[]; onDone: () => void }) {
  const [text, setText] = useState(categories.join(", "));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await saveCategories(text.split(",").map((t) => t.trim()).filter(Boolean));
      onDone();
    } catch (e) {
      setError(e instanceof HttpError ? (typeof e.detail === "string" ? e.detail : "The server wouldn't save that.")
        : "No connection. Categories are saved on the server; try again when you're online.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="categories-edit" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label className="field">
        <span>Categories, in order, separated by commas</span>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Baking, Rice cooker, Curry" />
      </label>
      <p className="edit-help">A recipe is in a category when it has the tag of the same name; the editor has a button for each.</p>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save categories"}</button>
    </form>
  );
}

function localStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(`recipie.${key}`);
  } catch {
    return null;
  }
}

function localStorageSet(key: string, value: string) {
  try {
    localStorage.setItem(`recipie.${key}`, value);
  } catch {
    /* private mode: the filter just isn't remembered */
  }
}
