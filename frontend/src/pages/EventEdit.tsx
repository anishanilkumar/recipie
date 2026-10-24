import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { NumText } from "../components/NumText";
import { createEvent, deleteEvent, deleteNote, getEvent, shareEvent, updateEvent } from "../events";
import { amount, bulk } from "../format";
import { useRecipes } from "../hooks";
import { HttpError } from "../sync";
import type { Day, Dish, DishStatus, EventDoc, EventItem, OwnedEvent } from "../types";
import { newId } from "../types";

const newDay = (n: number): Day => ({ id: newId(), label: `Day ${n}`, dishes: [] });
const newDish = (): Dish => ({ id: newId(), name: "", status: "todo", extra_ingredients: [] });

const STATUS: { value: DishStatus; label: string }[] = [
  { value: "todo", label: "To cook" },
  { value: "already_made", label: "Made ahead" },
  { value: "done", label: "Done" },
];

function message(e: unknown): string {
  if (e instanceof HttpError) {
    if (e.status === 401) return "Signed out. Sign in and try again.";
    if (e.status === 409) return "Someone (perhaps Claude) changed this event since you opened it. Reload to see their version.";
    if (typeof e.detail === "string") return e.detail;
    if (e.status === 422) return "Something in the menu isn't valid. Check every dish and day has a name.";
  }
  return "Couldn't reach the server. Your edits are still here; try again.";
}

export function EventEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const recipes = useRecipes();
  const [owned, setOwned] = useState<OwnedEvent | null>(null);
  const [doc, setDoc] = useState<EventDoc | null>(id ? null : { title: "", days: [newDay(1)], hidden_keys: [] });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!id) return;
    getEvent(id).then(
      (ev) => {
        setOwned(ev);
        setDoc(structuredClone(ev.doc));
      },
      (e) => setError(message(e)),
    );
  }, [id]);

  if (!doc) {
    return (
      <div className="page">
        <nav className="back"><Link to="/events">Events</Link></nav>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </div>
    );
  }

  const patch = (p: Partial<EventDoc>) => setDoc({ ...doc, ...p });
  const setDay = (i: number, p: Partial<Day>) => patch({ days: doc.days.map((d, j) => (j === i ? { ...d, ...p } : d)) });
  const setDish = (di: number, xi: number, p: Partial<Dish>) =>
    setDay(di, { dishes: doc.days[di].dishes.map((x, j) => (j === xi ? { ...x, ...p } : x)) });
  const hidden = new Set(doc.hidden_keys ?? []);
  const toggleHidden = (key: string) => {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    patch({ hidden_keys: [...next] });
  };

  const save = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    const clean: EventDoc = {
      ...doc,
      title: doc.title.trim(),
      days: doc.days.filter((d) => d.label.trim()).map((d) => ({
        ...d,
        label: d.label.trim(),
        dishes: d.dishes.filter((x) => x.name.trim()).map((x) => ({
          ...x,
          name: x.name.trim(),
          extra_ingredients: (x.extra_ingredients ?? []).filter((i) => i.name.trim()).map((i) => ({ ...i, name: i.name.trim() })),
        })),
      })),
    };
    if (!clean.title) {
      setError("Give the event a name.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const ev = owned ? await updateEvent(owned.id, owned.rev, clean) : await createEvent(clean);
      setOwned(ev);
      setDoc(structuredClone(ev.doc));
      if (!owned) navigate(`/events/${ev.id}/edit`, { replace: true });
    } catch (err) {
      setError(message(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!owned) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 4000);
      return;
    }
    try {
      await deleteEvent(owned.id);
      navigate("/events", { replace: true });
    } catch (err) {
      setError(message(err));
    }
  };

  return (
    <form className="page page-edit page-event-edit" onSubmit={save}>
      <div className="edit-col edit-col-details">
        <nav className="back"><Link to="/events">Events</Link></nav>
        <h1 className="edit-h">{owned ? "Edit event" : "New event"}</h1>

        <label className="field">
          <span>Name</span>
          <input value={doc.title} onChange={(e) => patch({ title: e.target.value })} placeholder="Lunch Menu – Migrant Kitchen" autoFocus={!id} />
        </label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <label className="field">
          <span>About it</span>
          <textarea rows={2} value={doc.description ?? ""} onChange={(e) => patch({ description: e.target.value })} />
        </label>
        <label className="field">
          <span>Diet and allergens</span>
          <textarea rows={4} value={doc.dietary_notes ?? ""} onChange={(e) => patch({ dietary_notes: e.target.value })}
            placeholder={"All vegetarian, mild spice.\nContains dairy: pulissery."} />
        </label>

        {owned ? <SharePanel owned={owned} onChange={setOwned} onError={(e) => setError(message(e))} /> : (
          <p className="edit-help">Save the event to get a link you can send the cooks. It opens without a login.</p>
        )}
        {owned ? (
          <button type="button" className={`btn ${confirmDelete ? "btn-danger" : "btn-quiet"}`} onClick={remove}>
            {confirmDelete ? "Tap again to delete" : "Delete event"}
          </button>
        ) : null}
      </div>

      <div className="edit-col edit-col-ings">
        <h2 className="edit-sub">Menu</h2>
        <p className="edit-help">
          Link a dish to a recipe and its ingredients go on the shopping list, scaled to the day's headcount. A dish without
          a recipe can list what to buy for it.
        </p>
        <ol className="edit-list">
          {doc.days.map((day, di) => (
            <li key={day.id} className="edit-day">
              <div className="field-row">
                <label className="field">
                  <span>Day</span>
                  <input value={day.label} onChange={(e) => setDay(di, { label: e.target.value })} placeholder="Day 1" />
                </label>
                <label className="field">
                  <span>Date</span>
                  <input type="date" value={day.date ?? ""} onChange={(e) => setDay(di, { date: e.target.value })} />
                </label>
                <label className="field field-narrow">
                  <span>People</span>
                  <NumText value={day.headcount} placeholder="40"
                    onValue={(v) => setDay(di, { headcount: v == null ? null : Math.max(1, Math.round(v)) })} />
                </label>
              </div>
              <ol className="edit-list">
                {day.dishes.map((dish, xi) => (
                  <DishEditor key={dish.id} dish={dish} recipes={recipes?.map((r) => r.recipe) ?? []}
                    visitor={owned?.dish_status[dish.id]}
                    onChange={(p) => setDish(di, xi, p)}
                    onMove={(by) => setDay(di, { dishes: move(day.dishes, xi, by) })}
                    onRemove={() => setDay(di, { dishes: day.dishes.filter((_, j) => j !== xi) })} />
                ))}
              </ol>
              <div className="day-tools">
                <button type="button" className="btn btn-add" onClick={() => setDay(di, { dishes: [...day.dishes, newDish()] })}>
                  Add a dish to {day.label || "this day"}
                </button>
                {doc.days.length > 1 ? (
                  <button type="button" className="row-remove link-btn" onClick={() => patch({ days: doc.days.filter((_, j) => j !== di) })}>
                    Remove day
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
        <button type="button" className="btn btn-add"
          onClick={() => {
            // A new day starts as a copy of the last one's dishes: most
            // multi-day menus repeat with a swap or two.
            const last = doc.days[doc.days.length - 1];
            const day = newDay(doc.days.length + 1);
            day.headcount = last?.headcount ?? null;
            day.dishes = (last?.dishes ?? []).map((x) => ({ ...structuredClone(x), id: newId(), status: x.status === "done" ? "todo" : x.status }));
            patch({ days: [...doc.days, day] });
          }}>
          Add a day
        </button>
      </div>

      <div className="edit-col edit-col-method">
        <h2 className="edit-sub">Shopping list</h2>
        {owned ? (
          <>
            <p className="edit-help">As of the last save. Hide what the kitchen always has, like salt and water.</p>
            {owned.warnings.length ? (
              <ul className="warnings">{owned.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            ) : null}
            <ul className="ing-list">
              {owned.shopping.map((l) => {
                const off = hidden.has(l.key);
                const qty = bulk(l.amount, l.unit);
                const alt = l.alt_amount != null ? [amount(l.alt_amount), l.alt_unit].filter(Boolean).join(" ") : "";
                return (
                  <li key={l.key} className={`ing share-line${off ? " line-hidden" : ""}`}>
                    <span className="ing-tick">
                      <span className="ing-text">
                        {qty || alt ? <span className="ing-qty">{qty || alt}{qty && alt ? <span className="qty-alt"> ({alt})</span> : null}</span> : null}
                        <span className="ing-name">{l.name}</span>
                        {l.optional ? <span className="ing-note"> (optional)</span> : null}
                        {l.checked ? <span className="line-src">got{l.checked_by ? ` by ${l.checked_by}` : ""}</span> : null}
                      </span>
                    </span>
                    <button type="button" className="line-notes" aria-pressed={off} onClick={() => toggleHidden(l.key)}>
                      {off ? "Show" : "Hide"}
                    </button>
                  </li>
                );
              })}
            </ul>
            {owned.items.length ? (
              <>
                <h3 className="list-sub">Added by the cooks</h3>
                <ul className="ing-list">
                  {owned.items.map((i) => (
                    <li key={i.id} className="ing share-line">
                      <span className="ing-tick">
                        <span className="ing-text">
                          {i.amount != null ? <span className="ing-qty">{bulk(i.amount, i.unit)}</span> : null}
                          <span className="ing-name">{i.name}</span>
                          <span className="line-src">
                            {[i.added_by ? `added by ${i.added_by}` : "", i.checked ? `got${i.checked_by ? ` by ${i.checked_by}` : ""}` : ""].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            <h2 className="edit-sub">Notes</h2>
            {owned.notes.length ? (
              <ul className="thread-list">
                {owned.notes.map((n) => (
                  <li key={n.id}>
                    <p>{n.text}</p>
                    <span className="stamp">{[n.author || "Someone", noteWhere(n.target, doc, owned)].filter(Boolean).join(" · ")}</span>
                    <button type="button" className="row-remove link-btn"
                      onClick={() => deleteNote(owned.id, n.id).then(
                        () => setOwned({ ...owned, notes: owned.notes.filter((x) => x.id !== n.id) }),
                        (e) => setError(message(e)),
                      )}>
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="edit-help">Notes the cooks leave on the menu, the list or the board show here.</p>}
          </>
        ) : (
          <p className="edit-help">Worked out from the menu when you save.</p>
        )}
      </div>

      <div className="save-bar">
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : owned ? "Save changes" : "Save event"}</button>
      </div>
    </form>
  );
}

function noteWhere(target: string, doc: EventDoc, owned: OwnedEvent): string {
  if (target === "event") return "board";
  if (target.startsWith("dish:")) {
    const dish = doc.days.flatMap((d) => d.dishes).find((x) => x.id === target.slice(5));
    return dish ? `on ${dish.name}` : "";
  }
  const key = target.slice(5);
  const line = owned.shopping.find((l) => l.key === key) ?? owned.items.find((i) => i.id === key);
  return line ? `on ${line.name}` : "";
}

function move<T>(list: T[], i: number, by: number): T[] {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

function DishEditor({ dish, recipes, visitor, onChange, onMove, onRemove }: {
  dish: Dish;
  visitor?: OwnedEvent["dish_status"][string];
  recipes: { id: string; doc: { title: string; servings?: number | null } }[];
  onChange: (p: Partial<Dish>) => void;
  onMove: (by: number) => void;
  onRemove: () => void;
}) {
  const extras = dish.extra_ingredients ?? [];
  const setExtra = (k: number, p: Partial<EventItem>) => onChange({ extra_ingredients: extras.map((x, j) => (j === k ? { ...x, ...p } : x)) });
  const linked = recipes.find((r) => r.id === dish.recipe_id);
  return (
    <li className={`edit-ing${dish.recipe_id ? " role-main" : ""}`}>
      <label className="field">
        <span>Dish</span>
        <input value={dish.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="Cabbage thoran" />
      </label>
      <label className="field">
        <span>Description</span>
        <input value={dish.description ?? ""} onChange={(e) => onChange({ description: e.target.value })}
          placeholder="stir-fried cabbage and carrot with coconut" />
      </label>
      <label className="field">
        <span>Recipe</span>
        <select className="select" value={dish.recipe_id ?? ""}
          onChange={(e) => {
            const r = recipes.find((x) => x.id === e.target.value);
            onChange({ recipe_id: e.target.value || null, name: dish.name || r?.doc.title || "" });
          }}>
          <option value="">No recipe</option>
          {dish.recipe_id && !linked ? <option value={dish.recipe_id}>(not in this browser's book yet)</option> : null}
          {recipes.map((r) => <option key={r.id} value={r.id}>{r.doc.title}</option>)}
        </select>
      </label>
      {linked && !linked.doc.servings ? (
        <p className="form-error">This recipe doesn't say how many it serves, so its amounts won't be scaled.</p>
      ) : null}
      <div className="field-row">
        <label className="field">
          <span>Who's cooking</span>
          <input value={dish.assignee ?? ""} onChange={(e) => onChange({ assignee: e.target.value })} placeholder="Anish" />
        </label>
        <label className="field">
          <span>Effort</span>
          <input value={dish.effort ?? ""} onChange={(e) => onChange({ effort: e.target.value })} placeholder="low" />
        </label>
      </div>
      <div className="roles" role="radiogroup" aria-label="Status">
        {STATUS.map((s) => (
          <button key={s.value} type="button" role="radio" aria-checked={(dish.status ?? "todo") === s.value} className="role"
            onClick={() => onChange({ status: s.value })}>
            {s.label}
          </button>
        ))}
      </div>
      {visitor && visitor.status !== (dish.status ?? "todo") ? (
        <p className="edit-help">
          On the link: {STATUS.find((s) => s.value === visitor.status)?.label.toLowerCase()}
          {visitor.by ? `, by ${visitor.by}` : ""}. Choosing a status here replaces it.
        </p>
      ) : null}
      <div className="subs">
        {extras.map((x, k) => (
          <div key={x.id} className="sub extra">
            <NumText aria-label="Amount" placeholder="Qty" value={x.amount} onValue={(v) => setExtra(k, { amount: v })} />
            <input aria-label="Unit" placeholder="unit" value={x.unit ?? ""} onChange={(e) => setExtra(k, { unit: e.target.value })} />
            <input aria-label="Ingredient" placeholder="Puff pastry" value={x.name} onChange={(e) => setExtra(k, { name: e.target.value })} />
            <button type="button" className="row-remove" onClick={() => onChange({ extra_ingredients: extras.filter((_, j) => j !== k) })}>Remove</button>
          </div>
        ))}
        <button type="button" className="pantry-link"
          onClick={() => onChange({ extra_ingredients: [...extras, { id: newId(), name: "", unit: "" }] })}>
          {dish.recipe_id ? "Buy something extra for it" : "Add what to buy for it"}
        </button>
      </div>
      <div className="row-tools">
        <button type="button" onClick={() => onMove(-1)} aria-label="Move up">↑</button>
        <button type="button" onClick={() => onMove(1)} aria-label="Move down">↓</button>
        <button type="button" onClick={onRemove} className="row-remove">Remove</button>
      </div>
    </li>
  );
}

function SharePanel({ owned, onChange, onError }: {
  owned: OwnedEvent;
  onChange: (ev: OwnedEvent) => void;
  onError: (e: unknown) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const act = (body: Parameters<typeof shareEvent>[1]) => shareEvent(owned.id, body).then(onChange, onError);
  const readable = owned.slug.slice(0, owned.slug.lastIndexOf("-"));

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(owned.share_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* no clipboard (http, old browser): the link is on screen to copy by hand */ }
  };

  return (
    <section className="share-panel-edit" aria-labelledby="share-h">
      <h2 id="share-h" className="edit-sub">Share link</h2>
      {owned.share_enabled ? (
        <>
          <p className="share-url"><a href={owned.share_url} target="_blank" rel="noreferrer">{owned.share_url}</a></p>
          <p className="edit-help">Anyone with this link can see the menu and recipes, tick off the shopping, add items and
            leave notes. Only you can change the menu.</p>
          <div className="share-actions">
            <button type="button" className="btn btn-primary" onClick={copy}>{copied ? "Copied" : "Copy link"}</button>
            <button type="button" className={`btn ${confirmRotate ? "btn-danger" : ""}`}
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
            <button type="button" className="btn btn-quiet" onClick={() => void act({ enabled: false })}>Switch off</button>
          </div>
          {name === null ? (
            <button type="button" className="link-btn" onClick={() => setName(readable)}>Change the words in the link</button>
          ) : (
            <div className="field-row">
              <label className="field">
                <span>Words in the link</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="mk-lunch" />
              </label>
              <button type="button" className="btn" disabled={!name.trim()}
                onClick={() => void act({ name: name.trim() }).then(() => setName(null))}>
                Use
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="edit-help">The link is switched off: it opens nothing.</p>
          <button type="button" className="btn" onClick={() => void act({ enabled: true })}>Switch on</button>
        </>
      )}
    </section>
  );
}
