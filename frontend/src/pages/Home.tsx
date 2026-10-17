import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { reason, STATUS_LABEL, type Status } from "../cookable";
import { Lid } from "../components/Lid";
import { SyncPill } from "../components/SyncPill";
import { ago, minutes } from "../format";
import { usePantry, useRecipes } from "../hooks";

type Filter = "all" | Status;

export function Home() {
  const recipes = useRecipes();
  const pantry = usePantry();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>(() => (localStorageGet("filter") as Filter) || "all");

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, ready: 0, almost: 0, no: 0, unknown: 0 };
    for (const r of recipes ?? []) {
      c.all++;
      c[r.verdict.status]++;
    }
    return c;
  }, [recipes]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (recipes ?? []).filter(({ recipe, verdict }) => {
      if (filter !== "all" && verdict.status !== filter) return false;
      if (!q) return true;
      const d = recipe.doc;
      return [d.title, ...(d.tags ?? []), ...d.ingredients.map((i) => i.name)].some((s) => s.toLowerCase().includes(q));
    });
  }, [recipes, filter, query]);

  const choose = (f: Filter) => {
    setFilter(f);
    localStorageSet("filter", f);
  };

  return (
    <div className="page">
      <header className="topbar">
        <h1 className="wordmark">Recipie</h1>
        <SyncPill />
      </header>

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

      <label className="search">
        <span className="visually-hidden">Search recipes</span>
        <input
          type="search"
          placeholder="Search by name, tag or ingredient"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

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
          <button className="btn" onClick={() => { setQuery(""); choose("all"); }}>
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
                    <span className="row-title">{d.title}</span>
                    <span className={`row-why why-${verdict.status}`}>{reason(verdict)}</span>
                  </span>
                  <span className="row-meta">
                    {time ? minutes(time) : null}
                    {recipe.dirty ? <span className="unsent" title="Not synced yet">unsent</span> : null}
                  </span>
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
