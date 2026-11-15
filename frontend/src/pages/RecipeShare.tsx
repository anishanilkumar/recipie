import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { CookView } from "../components/CookView";
import { minutes } from "../format";
import { useSharedRecipe, type SharedPhase } from "../recipeShare";
import { usePrivatePage } from "./EventShare";
import { RecipeCols } from "./RecipeView";

// The page a recipe's share link opens: /s/<title>-<secret>. No login and no
// pantry: the recipe, a servings stepper, and cook mode. Read only.

export function SharedRecipe() {
  const { slug = "" } = useParams();
  const { recipe, phase } = useSharedRecipe(slug);
  const [servings, setServings] = useState<number | null>(null);
  usePrivatePage(recipe?.doc.title);

  if (!recipe) return <Missing phase={phase} />;
  const d = recipe.doc;
  const base = d.servings ?? null;
  const serves = servings ?? base;

  return (
    <div className="page page-recipe">
      <aside className="recipe-side">
        <header className="topbar">
          <span className="wordmark">Recipie</span>
          {phase === "offline" ? (
            <span className="pill">
              <span className="pill-dot pill-dot-offline" aria-hidden="true" />
              Offline copy
            </span>
          ) : null}
        </header>

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

        <Link to={`/s/${slug}/cook${serves && serves !== base ? `?serves=${serves}` : ""}`} className="btn btn-primary btn-cook">
          Start cooking
        </Link>
      </aside>

      <RecipeCols doc={d} stock={null} serves={serves} onServes={setServings} />
    </div>
  );
}

export function SharedRecipeCook() {
  const { slug = "" } = useParams();
  const [params] = useSearchParams();
  const { recipe } = useSharedRecipe(slug);
  usePrivatePage(recipe?.doc.title);
  if (!recipe) return null;
  const base = recipe.doc.servings ?? null;
  const serves = Number(params.get("serves")) || base;
  const factor = base && serves ? serves / base : 1;
  return <CookView doc={recipe.doc} factor={factor} backTo={`/s/${slug}`} />;
}

function Missing({ phase }: { phase: SharedPhase }) {
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
            <p>The recipe will show as soon as there is one.</p>
          </>
        ) : (
          <p className="empty-title">Opening the recipe…</p>
        )}
      </div>
    </div>
  );
}
