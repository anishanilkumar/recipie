import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { productIds } from "../cookable";
import { NumText } from "../components/NumText";
import { saveLocal } from "../db";
import { stepIngredients } from "../steps";
import { usePantry, useRecipe } from "../hooks";
import { syncSoon } from "../sync";
import type { Ingredient, PantryProduct, RecipeDoc, Role, Step } from "../types";
import { newId } from "../types";

const EMPTY: RecipeDoc = { title: "", ingredients: [], steps: [], tags: [] };

const ROLES: { value: Role; label: string; hint: string }[] = [
  { value: "main", label: "Main", hint: "Can't make it without this" },
  { value: "minor", label: "Minor", hint: "Can work around it" },
  { value: "optional", label: "Optional", hint: "Never counts" },
];

export function Edit() {
  const { id } = useParams();
  const existing = useRecipe(id);
  const navigate = useNavigate();
  const [doc, setDoc] = useState<RecipeDoc | null>(id ? null : EMPTY);
  const [tagText, setTagText] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (id && existing && doc === null) {
      setDoc(structuredClone(existing.doc));
      setTagText((existing.doc.tags ?? []).join(", "));
    }
  }, [id, existing, doc]);

  if (id && existing === null) {
    return (
      <div className="page">
        <div className="empty">
          <p className="empty-title">This recipe isn't here.</p>
          <Link className="btn" to="/">Back to all recipes</Link>
        </div>
      </div>
    );
  }
  if (!doc) return null;

  const patch = (p: Partial<RecipeDoc>) => setDoc({ ...doc, ...p });
  const setIng = (i: number, p: Partial<Ingredient>) =>
    patch({ ingredients: doc.ingredients.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const setStep = (i: number, p: Partial<Step>) =>
    patch({ steps: doc.steps.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const move = <T,>(list: T[], i: number, by: number): T[] => {
    const j = i + by;
    if (j < 0 || j >= list.length) return list;
    const out = [...list];
    [out[i], out[j]] = [out[j], out[i]];
    return out;
  };

  const save = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    const kept = new Set(doc.ingredients.filter((i) => i.name.trim()).map((i) => i.id));
    const clean: RecipeDoc = {
      ...doc,
      title: doc.title.trim(),
      tags: tagText.split(",").map((t) => t.trim()).filter(Boolean),
      ingredients: doc.ingredients.filter((i) => i.name.trim()).map((i) => ({ ...i, name: i.name.trim() })),
      steps: doc.steps.filter((s) => s.text.trim()).map((s) => ({
        ...s,
        text: s.text.trim(),
        // An ingredient deleted in this edit can't stay referenced: the
        // server rejects a step pointing at an ingredient that isn't there.
        ingredient_ids: (s.ingredient_ids ?? []).filter((id) => kept.has(id)),
      })),
    };
    if (!clean.title) {
      setError("Give the recipe a name.");
      return;
    }
    const saved = await saveLocal(id ?? null, clean);
    syncSoon();
    navigate(`/r/${saved}`, { replace: true });
  };

  return (
    <form className="page page-edit" onSubmit={save}>
      {/* Three columns on desktop, each scrolling on its own; on a phone the
          wrappers dissolve (display: contents) into one column. */}
      <div className="edit-col edit-col-details">
      <nav className="back">
        <Link to={id ? `/r/${id}` : "/"}>Cancel</Link>
      </nav>
      <h1 className="edit-h">{id ? "Edit recipe" : "New recipe"}</h1>

      <label className="field">
        <span>Name</span>
        <input value={doc.title} onChange={(e) => patch({ title: e.target.value })} placeholder="Nadan chicken curry" autoFocus={!id} />
      </label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}

      <label className="field">
        <span>Short description</span>
        <textarea rows={2} value={doc.description ?? ""} onChange={(e) => patch({ description: e.target.value })} />
      </label>

      <div className="field-row">
        <NumberField label="Servings" value={doc.servings} onChange={(v) => patch({ servings: v })} />
        <NumberField label="Prep, min" value={doc.prep_minutes} onChange={(v) => patch({ prep_minutes: v })} />
        <NumberField label="Cook, min" value={doc.cook_minutes} onChange={(v) => patch({ cook_minutes: v })} />
      </div>

      <label className="field">
        <span>Tags, separated by commas</span>
        <input value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="kerala, weeknight" />
      </label>
      </div>

      <div className="edit-col edit-col-ings">
      <h2 className="edit-sub">Ingredients</h2>
      <p className="edit-help">
        Main ingredients decide whether a recipe can be cooked at all. Link each one to the pantry so Recipie can check.
      </p>
      <ol className="edit-list">
        {doc.ingredients.map((ing, i) => (
          <li key={ing.id} className={`edit-ing role-${ing.role ?? "minor"}`}>
            <div className="edit-ing-line">
              <NumText className="in-amount" aria-label="Amount" placeholder="Qty"
                value={ing.amount} onValue={(v) => setIng(i, { amount: v })} />
              <input className="in-unit" aria-label="Unit" placeholder="unit"
                value={ing.unit ?? ""} onChange={(e) => setIng(i, { unit: e.target.value })} />
              <input className="in-name" aria-label="Ingredient" placeholder="Ingredient"
                value={ing.name} onChange={(e) => setIng(i, { name: e.target.value })} />
            </div>
            <div className="edit-ing-alt">
              <span>Also as</span>
              <NumText className="in-amount" aria-label="Kitchen measure amount" placeholder="Qty"
                value={ing.alt_amount} onValue={(v) => setIng(i, { alt_amount: v })} />
              <input className="in-unit" aria-label="Kitchen measure unit" placeholder="tsp, tbsp, cup"
                value={ing.alt_unit ?? ""} onChange={(e) => setIng(i, { alt_unit: e.target.value })} />
            </div>
            <div className="roles" role="radiogroup" aria-label="How much it matters">
              {ROLES.map((r) => (
                <button type="button" key={r.value} role="radio" title={r.hint}
                  aria-checked={(ing.role ?? "minor") === r.value}
                  className={`role role-${r.value}`} onClick={() => setIng(i, { role: r.value })}>
                  {r.label}
                </button>
              ))}
            </div>
            <PantryLinks ids={productIds(ing)} suggest={ing.name}
              onChange={(ids) => setIng(i, { grocy_product_ids: ids, grocy_product_id: undefined })} />
            <Substitutes ing={ing} onChange={(subs) => setIng(i, { substitutes: subs })} />
            <div className="edit-ing-more">
              <input aria-label="Note" placeholder="Note, e.g. thinly sliced" value={ing.note ?? ""}
                onChange={(e) => setIng(i, { note: e.target.value })} />
              <input aria-label="Group" placeholder="Group, e.g. For the masala" value={ing.group ?? ""}
                onChange={(e) => setIng(i, { group: e.target.value })} />
            </div>
            <RowTools
              onUp={() => patch({ ingredients: move(doc.ingredients, i, -1) })}
              onDown={() => patch({ ingredients: move(doc.ingredients, i, 1) })}
              onRemove={() => patch({ ingredients: doc.ingredients.filter((_, j) => j !== i) })}
            />
          </li>
        ))}
      </ol>
      <button type="button" className="btn btn-add"
        onClick={() => patch({ ingredients: [...doc.ingredients, { id: newId(), name: "", role: "minor" }] })}>
        Add ingredient
      </button>
      </div>

      <div className="edit-col edit-col-method">
      <h2 className="edit-sub">Method</h2>
      <ol className="edit-list edit-steps">
        {doc.steps.map((s, i) => (
          <li key={s.id}>
            <textarea rows={3} aria-label={`Step ${i + 1}`} value={s.text} onChange={(e) => setStep(i, { text: e.target.value })} />
            <StepUses step={s} ingredients={doc.ingredients} onChange={(ids) => setStep(i, { ingredient_ids: ids })} />
            <label className="timer-field">
              <span>Timer, min</span>
              <NumText value={s.timer_seconds ? s.timer_seconds / 60 : null}
                onValue={(m) => setStep(i, { timer_seconds: m ? Math.round(m * 60) : null })} />
            </label>
            <RowTools
              onUp={() => patch({ steps: move(doc.steps, i, -1) })}
              onDown={() => patch({ steps: move(doc.steps, i, 1) })}
              onRemove={() => patch({ steps: doc.steps.filter((_, j) => j !== i) })}
            />
          </li>
        ))}
      </ol>
      <button type="button" className="btn btn-add" onClick={() => patch({ steps: [...doc.steps, { id: newId(), text: "" }] })}>
        Add step
      </button>

      <label className="field">
        <span>Notes</span>
        <textarea rows={3} value={doc.notes ?? ""} onChange={(e) => patch({ notes: e.target.value })} />
      </label>
      <label className="field">
        <span>Source</span>
        <input value={doc.source ?? ""} onChange={(e) => patch({ source: e.target.value })} placeholder="Amma, or a link" />
      </label>
      </div>

      <div className="save-bar">
        <button type="submit" className="btn btn-primary">Save recipe</button>
      </div>
    </form>
  );
}

function NumberField({ label, value, onChange }: { label: string; value?: number | null; onChange: (v: number | null) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <NumText value={value} onValue={(n) => onChange(n == null ? null : Math.round(n))} />
    </label>
  );
}

function RowTools({ onUp, onDown, onRemove }: { onUp: () => void; onDown: () => void; onRemove: () => void }) {
  return (
    <div className="row-tools">
      <button type="button" onClick={onUp} aria-label="Move up">↑</button>
      <button type="button" onClick={onDown} aria-label="Move down">↓</button>
      <button type="button" onClick={onRemove} className="row-remove">Remove</button>
    </div>
  );
}

function Substitutes({ ing, onChange }: { ing: Ingredient; onChange: (s: Ingredient["substitutes"]) => void }) {
  const subs = ing.substitutes ?? [];
  return (
    <div className="subs">
      {subs.map((s, k) => (
        <div key={k} className="sub">
          <span className="sub-or">or</span>
          <input aria-label="Substitute" value={s.name} placeholder="Substitute"
            onChange={(e) => onChange(subs.map((x, j) => (j === k ? { ...x, name: e.target.value } : x)))} />
          <PantryLinks ids={productIds(s)} suggest={s.name} compact
            onChange={(ids) => onChange(subs.map((x, j) => (j === k ? { ...x, grocy_product_ids: ids, grocy_product_id: undefined } : x)))} />
          <button type="button" className="row-remove" onClick={() => onChange(subs.filter((_, j) => j !== k))}>Remove</button>
        </div>
      ))}
      <button type="button" className="link-btn" onClick={() => onChange([...subs, { name: "" }])}>
        Add a substitute
      </button>
    </div>
  );
}

/**
 * Which ingredients a step uses, as tappable chips. Until any is chosen the
 * guess from the step's wording is shown preselected, so tapping one turns the
 * guess into an explicit list.
 */
function StepUses({ step, ingredients, onChange }: {
  step: Step;
  ingredients: Ingredient[];
  onChange: (ids: string[]) => void;
}) {
  const named = ingredients.filter((i) => i.name.trim());
  if (!named.length) return null;
  const { items, guessed } = stepIngredients(step, named);
  const chosen = new Set(items.map((i) => i.id));
  const toggle = (id: string) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(named.filter((i) => next.has(i.id)).map((i) => i.id));
  };
  return (
    <div className="step-uses">
      <span className="step-uses-label">{guessed && items.length ? "Uses (guessed, tap to correct)" : "Uses"}</span>
      <div className="step-uses-chips">
        {named.map((i) => (
          <button type="button" key={i.id} aria-pressed={chosen.has(i.id)} className="use-chip" onClick={() => toggle(i.id)}>
            {i.name}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The Grocy products an ingredient is checked against. Usually one per pack
 * size ("White Onions, 2 kg" and "5 kg"): any one in stock counts. Works
 * offline from the cached product list.
 */
function PantryLinks({ ids, onChange, suggest, compact }: {
  ids: number[];
  onChange: (ids: number[]) => void;
  suggest: string;
  compact?: boolean;
}) {
  const pantry = usePantry();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const products = pantry?.products ?? [];
  const stock = pantry?.stock ?? {};
  const inStock = (id: number) => (stock[String(id)] ?? 0) > 0;
  const nameOf = (id: number) => products.find((p) => p.id === id)?.name ?? `Pantry item #${id}`;

  const hits = useMemo(() => {
    // "Onions" should find "White Onions, 2 kg"; "Potato" should find
    // "Potatoes, 5 kg". Match every word, ignoring a plural s and anything
    // after a comma in the ingredient name ("Curry leaves, fresh").
    const source = q || suggest.split(",")[0];
    const words = source.toLowerCase().split(/\s+/).filter(Boolean).map((w) => w.replace(/(es|s)$/, ""));
    if (!words.length) return [] as PantryProduct[];
    return products
      .filter((p) => !ids.includes(p.id) && words.every((w) => p.name.toLowerCase().includes(w)))
      .sort((a, b) => Number(inStock(b.id)) - Number(inStock(a.id)) || a.name.localeCompare(b.name))
      .slice(0, 10);
  }, [q, suggest, products, ids, stock]);

  return (
    <div className={`pantry-links ${compact ? "compact" : ""}`}>
      {ids.map((id) => (
        <span key={id} className="pantry-chip">
          <span className={`dot ${inStock(id) ? "dot-have" : "dot-out"}`} aria-hidden="true" />
          {nameOf(id)}
          <button type="button" aria-label={`Unlink ${nameOf(id)}`} onClick={() => onChange(ids.filter((x) => x !== id))}>×</button>
        </span>
      ))}
      {open ? (
        <div className="pantry-pick">
          <input autoFocus placeholder={suggest ? `Search, e.g. ${suggest.split(",")[0]}` : "Search the pantry"} value={q} onChange={(e) => setQ(e.target.value)} />
          <ul>
            {hits.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => onChange([...ids, p.id])}>
                  <span className={`dot ${inStock(p.id) ? "dot-have" : "dot-out"}`} aria-hidden="true" />
                  {p.name}
                </button>
              </li>
            ))}
            {!hits.length ? <li className="pantry-none">{products.length ? "No other pantry item matches." : "No pantry list yet. Sync while online first."}</li> : null}
          </ul>
          <div className="pantry-pick-actions">
            <button type="button" className="link-btn" onClick={() => { setOpen(false); setQ(""); }}>Done</button>
          </div>
        </div>
      ) : (
        <button type="button" className="pantry-link" onClick={() => setOpen(true)}>
          {ids.length ? "Add another pack size" : "Link to pantry"}
        </button>
      )}
    </div>
  );
}
