import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { bookMatches, bookPhotoUrl, useSharedBook, type BookPhase } from "../bookShare";
import { tagKey } from "../browse";
import { CookView } from "../components/CookView";
import { RecipePhoto, Thumb } from "../components/RecipePhoto";
import { minutes } from "../format";
import { timingFacts } from "../timing";
import { usePrivatePage } from "./EventShare";
import { RecipeCols } from "./RecipeView";

// What a friend's link to the whole book opens: /b/<name>-<secret>. No login
// and no pantry: every recipe that isn't archived, with its photo, a search
// and the household's categories; each recipe with a servings stepper and
// cook mode. Read only.

export function SharedBook() {
  const { slug = "" } = useParams();
  const { book, phase } = useSharedBook(slug);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(() => sessionGet(`book.${slug}.tag`));
  usePrivatePage("Recipes");

  const recipes = useMemo(() => book?.recipes ?? [], [book]);
  const chips = useMemo(
    () => (book?.categories ?? [])
      .map((label) => {
        const key = tagKey(label);
        return { key, label, count: recipes.filter((r) => (r.doc.tags ?? []).some((t) => tagKey(t) === key)).length };
      })
      // A friend can't add recipes, so an empty category is only noise.
      .filter((c) => c.count > 0),
    [book, recipes],
  );
  const active = category && chips.some((c) => c.key === category) ? category : null;
  const shown = useMemo(() => bookMatches(recipes, query, active), [recipes, query, active]);

  if (!book) return <Missing phase={phase} what="recipes" />;
  const choose = (k: string | null) => {
    setCategory(k);
    sessionSet(`book.${slug}.tag`, k ?? "");
  };
  const src = bookPhotoUrl(slug);

  return (
    <div className="page page-home">
      <header className="topbar">
        <h1 className="wordmark">Recipie</h1>
        <span className="topbar-end">
          {phase === "offline" ? <OfflinePill /> : <span className="stamp">{recipes.length} recipes</span>}
        </span>
      </header>

      <div className="search">
        <label>
          <span className="visually-hidden">Search recipes</span>
          <input type="search" placeholder="Search by name, tag or ingredient" value={query}
            onChange={(e) => setQuery(e.target.value)} />
        </label>
        {chips.length ? (
          <div className="tag-strip" role="group" aria-label="Show one category">
            {chips.map((t) => (
              <button key={t.key} className={`tag-chip${active === t.key ? " is-on" : ""}`}
                aria-pressed={active === t.key} onClick={() => choose(active === t.key ? null : t.key)}>
                {t.label}
                <span className="tag-chip-n">{t.count}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {recipes.length === 0 ? (
        <div className="empty"><p className="empty-title">No recipes here yet.</p></div>
      ) : shown.length === 0 ? (
        <div className="empty">
          <p className="empty-title">Nothing matches.</p>
          <button className="btn" onClick={() => { setQuery(""); choose(null); }}>Show all recipes</button>
        </div>
      ) : (
        <ul className="tray">
          {shown.map(({ id, doc: d }) => {
            const time = (d.prep_minutes ?? 0) + (d.cook_minutes ?? 0);
            return (
              <li key={id}>
                <Link to={`/b/${slug}/r/${id}`} className="row">
                  <span className="row-body">
                    <span className="row-title">{d.title}</span>
                    {d.tags?.length ? <span className="row-why">{d.tags.join(" · ")}</span> : null}
                  </span>
                  <span className="row-meta">{time ? minutes(time) : null}</span>
                  <Thumb recipeId={id} title={d.title} photos={book.photos[id]} src={src} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function SharedBookRecipe() {
  const { slug = "", id = "" } = useParams();
  const { book, phase } = useSharedBook(slug);
  const [servings, setServings] = useState<number | null>(null);
  const recipe = book?.recipes.find((r) => r.id === id);
  usePrivatePage(recipe?.doc.title);

  if (!book) return <Missing phase={phase} what="recipe" />;
  if (!recipe) {
    return (
      <div className="page">
        <nav className="back"><Link to={`/b/${slug}`}>All recipes</Link></nav>
        <div className="empty">
          <p className="empty-title">This recipe isn't in the book any more.</p>
          <Link className="btn" to={`/b/${slug}`}>Back to all recipes</Link>
        </div>
      </div>
    );
  }
  const d = recipe.doc;
  const base = d.servings ?? null;
  const serves = servings ?? base;

  return (
    <div className="page page-recipe">
      <aside className="recipe-side">
        <header className="topbar">
          <nav className="back"><Link to={`/b/${slug}`}>All recipes</Link></nav>
          {phase === "offline" ? <OfflinePill /> : null}
        </header>

        <RecipePhoto recipeId={recipe.id} photos={book.photos[recipe.id]} src={bookPhotoUrl(slug)} />

        <header className="recipe-head">
          <h1 className="recipe-title">{d.title}</h1>
          {d.description ? <p className="recipe-desc">{d.description}</p> : null}
          <p className="recipe-facts">
            {d.prep_minutes ? <span>Prep {minutes(d.prep_minutes)}</span> : null}
            {d.cook_minutes ? <span>Cook {minutes(d.cook_minutes)}</span> : null}
            {timingFacts(d.steps).map((f) => <span key={f}>{f}</span>)}
            {(d.tags ?? []).map((t) => <span key={t} className="tag">{t}</span>)}
          </p>
        </header>

        {d.prep_ahead?.note ? (
          <p className="prep-ahead">
            <span className="label">Ahead</span> {d.prep_ahead.note}
            {d.prep_ahead.hours_before ? <span className="stamp">, {d.prep_ahead.hours_before} h before</span> : null}
          </p>
        ) : null}

        <Link to={`/b/${slug}/r/${recipe.id}/cook${serves && serves !== base ? `?serves=${serves}` : ""}`}
          className="btn btn-primary btn-cook">
          Start cooking
        </Link>
      </aside>

      <RecipeCols doc={d} stock={null} serves={serves} onServes={setServings} />
    </div>
  );
}

export function SharedBookCook() {
  const { slug = "", id = "" } = useParams();
  const [params] = useSearchParams();
  const { book } = useSharedBook(slug);
  const recipe = book?.recipes.find((r) => r.id === id);
  usePrivatePage(recipe?.doc.title);
  if (!recipe) return null;
  const base = recipe.doc.servings ?? null;
  const serves = Number(params.get("serves")) || base;
  const factor = base && serves ? serves / base : 1;
  return <CookView doc={recipe.doc} factor={factor} backTo={`/b/${slug}/r/${id}`} />;
}

function OfflinePill() {
  return (
    <span className="pill">
      <span className="pill-dot pill-dot-offline" aria-hidden="true" />
      Offline copy
    </span>
  );
}

function Missing({ phase, what }: { phase: BookPhase; what: "recipes" | "recipe" }) {
  return (
    <div className="page">
      <div className="empty">
        {phase === "gone" ? (
          <>
            <p className="empty-title">This link doesn't open anything.</p>
            <p>It may have been switched off or replaced. Ask whoever sent it for a new one.</p>
          </>
        ) : phase === "offline" ? (
          <>
            <p className="empty-title">No connection.</p>
            <p>The recipes will show as soon as there is one.</p>
          </>
        ) : (
          <p className="empty-title">Opening the {what}…</p>
        )}
      </div>
    </div>
  );
}

function sessionGet(key: string): string | null {
  try {
    return sessionStorage.getItem(`recipie.${key}`) || null;
  } catch {
    return null;
  }
}

function sessionSet(key: string, value: string) {
  try {
    sessionStorage.setItem(`recipie.${key}`, value);
  } catch { /* private mode: the category just isn't remembered */ }
}
