import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { assess, ingredientState, type Verdict } from "../cookable";
import { Lid } from "../components/Lid";
import { Qty } from "../components/Qty";
import { StepIngredients } from "../components/StepIngredients";
import { deleteLocal } from "../db";
import { clock, minutes } from "../format";
import { usePantry, useRecipe } from "../hooks";
import { syncSoon } from "../sync";
import type { Ingredient } from "../types";

export function RecipeView() {
  const { id } = useParams();
  const recipe = useRecipe(id);
  const pantry = usePantry();
  const navigate = useNavigate();
  const [servings, setServings] = useState<number | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);

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
  const factor = base && serves ? serves / base : 1;
  const groups = groupBy(d.ingredients);

  const toggle = (iid: string) =>
    setTicked((s) => {
      const n = new Set(s);
      if (n.has(iid)) n.delete(iid);
      else n.add(iid);
      return n;
    });

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

  return (
    <div className="page page-recipe">
      {/* The summary column on desktop. On a phone it dissolves
          (display: contents) and its children flow in the page as before,
          with the Edit/Delete row moved to the end by CSS order. */}
      <aside className="recipe-side">
      <BackLink />

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

      <Link to={`/r/${recipe.id}/cook${serves && serves !== base ? `?serves=${serves}` : ""}`} className="btn btn-primary btn-cook">
        Start cooking
      </Link>

      <footer className="recipe-actions">
        <Link to={`/r/${recipe.id}/edit`} className="btn">Edit</Link>
        <button className={`btn ${confirmDelete ? "btn-danger" : "btn-quiet"}`} onClick={remove}>
          {confirmDelete ? "Tap again to delete" : "Delete"}
        </button>
      </footer>
      </aside>

      <div className="recipe-cols">
        <section className="ingredients" aria-labelledby="ing-h">
          <div className="section-head">
            <h2 id="ing-h">Ingredients</h2>
            {base ? (
              <div className="stepper" aria-label="Servings">
                <button onClick={() => setServings(Math.max(1, (serves ?? 1) - 1))} aria-label="Fewer servings">−</button>
                <span>
                  <strong>{serves}</strong> {serves === 1 ? "serving" : "servings"}
                </span>
                <button onClick={() => setServings((serves ?? 1) + 1)} aria-label="More servings">+</button>
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

    </div>
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
