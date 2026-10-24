import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CookView } from "../components/CookView";
import { NumText } from "../components/NumText";
import { Qty } from "../components/Qty";
import { StepIngredients } from "../components/StepIngredients";
import { dishStatus, setVisitorName, useSharedEvent, useVisitorName, type Op, type SharePhase } from "../events";
import { ago, amount, bulk, clock } from "../format";
import type { Day, Dish, DishStatus, EventNote, SharedEvent, ShoppingLine } from "../types";
import { newId } from "../types";

// The page a share link opens: /e/<readable>-<secret>. No login, no recipe
// book: everything comes with the event (events.ts). Volunteers tick off the
// shopping, add what's missing, leave notes and mark dishes done; only the
// household changes the menu.

type Tab = "menu" | "shopping" | "notes";

export function EventShare() {
  const { slug = "" } = useParams();
  const { event, phase, pending, notice, send } = useSharedEvent(slug);
  const [tab, setTab] = useState<Tab>(() => (sessionGet("tab") as Tab) || "menu");
  usePrivatePage(event?.doc.title);

  if (!event) return <Missing phase={phase} />;
  const d = event.doc;
  const choose = (t: Tab) => {
    setTab(t);
    sessionSet("tab", t);
  };
  const lines = event.shopping;
  const left = lines.filter((l) => !l.checked && !l.optional).length + event.items.filter((i) => !i.checked).length;
  const board = event.notes.filter((n) => n.target === "event");

  return (
    <div className="page page-share">
      <header className="topbar">
        <span className="wordmark">Recipie</span>
        <SharePill phase={phase} pending={pending} />
      </header>

      <header className="share-head">
        <h1 className="recipe-title">{d.title}</h1>
        {d.description ? <p className="recipe-desc">{d.description}</p> : null}
        <p className="recipe-facts">
          {d.days.map((day) => (
            <span key={day.id}>{dayLine(day)}</span>
          ))}
        </p>
        {d.dietary_notes ? <p className="diet">{d.dietary_notes}</p> : null}
        <NameBar />
        {notice ? <p className="form-error" role="alert">{notice}</p> : null}
      </header>

      <nav className="tabs" aria-label="Sections">
        {([["menu", "Menu", null], ["shopping", "Shopping", left], ["notes", "Notes", board.length]] as const).map(([t, label, n]) => (
          <button key={t} className="tab" aria-pressed={tab === t} onClick={() => choose(t)}>
            {label}
            {n ? <span className="tab-n">{n}</span> : null}
          </button>
        ))}
      </nav>

      <section className={`instrument share-panel share-menu${tab === "menu" ? " is-shown" : ""}`} aria-labelledby="menu-h">
        <h2 id="menu-h" className="panel-h">Menu</h2>
        {d.days.map((day) => (
          <MenuDay key={day.id} day={day} event={event} slug={slug} send={send} />
        ))}
      </section>

      <section className={`instrument share-panel share-shopping${tab === "shopping" ? " is-shown" : ""}`} aria-labelledby="shop-h">
        <Shopping event={event} send={send} left={left} />
      </section>

      <section className={`instrument share-panel share-notes${tab === "notes" ? " is-shown" : ""}`} aria-labelledby="notes-h">
        <h2 id="notes-h" className="panel-h">Notes for everyone</h2>
        <Thread notes={board} target="event" send={send} placeholder="Doors open at 12. Tubs are under the sink." />
      </section>
    </div>
  );
}

function dayLine(day: Day): string {
  return [day.label, day.date ? shortDate(day.date) : "", day.headcount ? `for ${day.headcount}` : ""].filter(Boolean).join(" · ");
}

function shortDate(iso: string): string {
  const t = new Date(`${iso}T12:00:00`);
  return Number.isNaN(t.getTime()) ? iso : t.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

// --- menu ------------------------------------------------------------------

const STATUS: { value: DishStatus; label: string }[] = [
  { value: "todo", label: "To cook" },
  { value: "done", label: "Done" },
  { value: "already_made", label: "Made ahead" },
];

function MenuDay({ day, event, slug, send }: { day: Day; event: SharedEvent; slug: string; send: (op: Op) => void }) {
  return (
    <div className="menu-day">
      <h3 className="menu-day-h">
        <span>{day.label}</span>
        <span className="stamp">{[day.date ? shortDate(day.date) : "", day.headcount ? `for ${day.headcount}` : ""].filter(Boolean).join(" · ")}</span>
      </h3>
      <ul>
        {day.dishes.map((dish) => (
          <MenuDish key={dish.id} dish={dish} event={event} slug={slug} send={send} />
        ))}
      </ul>
    </div>
  );
}

function MenuDish({ dish, event, slug, send }: { dish: Dish; event: SharedEvent; slug: string; send: (op: Op) => void }) {
  const [open, setOpen] = useState(false);
  const status = dishStatus(event, dish);
  const by = event.dish_status[dish.id]?.by;
  const notes = event.notes.filter((n) => n.target === `dish:${dish.id}`);
  const hasRecipe = !!(dish.recipe_id && event.recipes[dish.recipe_id]);
  const set = (s: DishStatus) => send({ kind: "dish", dish_id: dish.id, status: s });

  return (
    <li className={`dish dish-${status}`}>
      <div className="dish-line">
        <button className="ing-tick dish-tick" aria-pressed={status !== "todo"}
          aria-label={status === "todo" ? `Mark ${dish.name} done` : `Mark ${dish.name} to cook`}
          onClick={() => set(status === "todo" ? "done" : "todo")}>
          <span className="ing-box" aria-hidden="true" />
        </button>
        <button className="dish-body" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className="dish-name">{dish.name}</span>
          {dish.description ? <span className="dish-desc">{dish.description}</span> : null}
          <span className="dish-meta">
            {status !== "todo" ? <span className={`flag flag-${status === "done" ? "done" : "quiet"}`}>
              {status === "done" ? "Done" : "Made ahead"}{by ? `, ${by}` : ""}
            </span> : null}
            {dish.assignee ? <span>{dish.assignee}</span> : null}
            {dish.effort ? <span>{dish.effort} effort</span> : null}
            {notes.length ? <span className="dish-notes-n">{notes.length} {notes.length === 1 ? "note" : "notes"}</span> : null}
          </span>
        </button>
        {hasRecipe ? <Link className="link-btn dish-recipe" to={`/e/${slug}/d/${dish.id}`}>Recipe</Link> : null}
      </div>
      {open ? (
        <div className="dish-more">
          <div className="roles" role="radiogroup" aria-label="Status">
            {STATUS.map((s) => (
              <button key={s.value} type="button" role="radio" aria-checked={status === s.value} className="role" onClick={() => set(s.value)}>
                {s.label}
              </button>
            ))}
          </div>
          <Thread notes={notes} target={`dish:${dish.id}`} send={send} placeholder="Used tinned beans, 3 tins." compact />
        </div>
      ) : null}
    </li>
  );
}

// --- shopping --------------------------------------------------------------

function Shopping({ event, send, left }: { event: SharedEvent; send: (op: Op) => void; left: number }) {
  // Still to get first; got sinks to the bottom so the list shrinks as you shop.
  const order = (a: ShoppingLine, b: ShoppingLine) => Number(a.checked) - Number(b.checked);
  const needed = event.shopping.filter((l) => !l.optional).sort(order);
  const optional = event.shopping.filter((l) => l.optional).sort(order);
  const total = needed.length + event.items.length;

  return (
    <>
      <div className="section-head">
        <h2 id="shop-h" className="panel-h">Shopping</h2>
        <span className="stamp">{left ? `${left} of ${total} to get` : total ? "Got everything" : ""}</span>
      </div>
      {event.warnings.length ? (
        <ul className="warnings">
          {event.warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      ) : null}
      {needed.length || event.items.length ? null : <p className="edit-help">Nothing to buy yet.</p>}
      <ul className="ing-list">
        {needed.map((l) => <Line key={l.key} line={l} event={event} send={send} />)}
      </ul>
      {event.items.length ? (
        <>
          <h3 className="list-sub">Added</h3>
          <ul className="ing-list">
            {event.items.map((i) => (
              <li key={i.id} className={`ing share-line${i.checked ? " ing-ticked" : ""}`}>
                <button className="ing-tick" aria-pressed={i.checked}
                  onClick={() => send({ kind: "check", item_id: i.id, checked: !i.checked })}>
                  <span className="ing-box" aria-hidden="true" />
                  <span className="ing-text">
                    {i.amount != null ? <span className="ing-qty">{bulk(i.amount, i.unit)}</span> : null}
                    <span className="ing-name">{i.name}</span>
                    <span className="line-src">
                      {[i.added_by ? `added by ${i.added_by}` : "", i.checked && i.checked_by ? `got by ${i.checked_by}` : ""].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </button>
                <button className="line-x" aria-label={`Remove ${i.name}`} onClick={() => send({ kind: "remove", id: i.id })}>×</button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <AddItem send={send} />
      {optional.length ? (
        <>
          <h3 className="list-sub">If you can</h3>
          <ul className="ing-list">
            {optional.map((l) => <Line key={l.key} line={l} event={event} send={send} />)}
          </ul>
        </>
      ) : null}
    </>
  );
}

function Line({ line, event, send }: { line: ShoppingLine; event: SharedEvent; send: (op: Op) => void }) {
  const [open, setOpen] = useState(false);
  const notes = event.notes.filter((n) => n.target === `item:${line.key}`);
  const qty = bulk(line.amount, line.unit);
  const alt = line.alt_amount != null ? [amount(line.alt_amount), line.alt_unit].filter(Boolean).join(" ") : "";
  return (
    <li className={`ing share-line${line.checked ? " ing-ticked" : ""}`}>
      <button className="ing-tick" aria-pressed={line.checked}
        onClick={() => send({ kind: "check", key: line.key, checked: !line.checked })}>
        <span className="ing-box" aria-hidden="true" />
        <span className="ing-text">
          {qty || alt ? (
            <span className="ing-qty">
              {qty || alt}
              {line.unmeasured && qty ? " +" : ""}
              {qty && alt ? <span className="qty-alt"> ({alt})</span> : null}
            </span>
          ) : null}
          <span className="ing-name">{line.name}</span>
          {!qty && !alt && line.unmeasured ? <span className="ing-note">to taste</span> : null}
          <span className="line-src">
            {sources(line)}
            {line.checked && line.checked_by ? ` · got by ${line.checked_by}` : ""}
          </span>
        </span>
      </button>
      <span className="line-side">
        {line.not_scaled ? <span className="flag flag-almost" title="A day has no headcount or the recipe has no servings">not scaled</span> : null}
        <button className="line-notes" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {notes.length ? `${notes.length} ${notes.length === 1 ? "note" : "notes"}` : "Note"}
        </button>
      </span>
      {open ? (
        <div className="line-thread">
          <Thread notes={notes} target={`item:${line.key}`} send={send} placeholder="The Indian shop had it." compact />
        </div>
      ) : null}
    </li>
  );
}

/** "Cabbage thoran (Day 1, Day 2) · Rajma (Day 1)" */
function sources(line: ShoppingLine): string {
  const byDish = new Map<string, string[]>();
  for (const s of line.sources) byDish.set(s.dish, [...new Set([...(byDish.get(s.dish) ?? []), s.day])]);
  return [...byDish].map(([dish, days]) => `${dish} (${days.join(", ")})`).join(" · ");
}

function AddItem({ send }: { send: (op: Op) => void }) {
  const [name, setName] = useState("");
  const [qty, setQty] = useState<number | null>(null);
  const [unit, setUnit] = useState("");
  // NumText keeps its own text; a new key empties it after adding.
  const [round, setRound] = useState(0);
  const add = (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (!name.trim()) return;
    send({ kind: "add", id: newId(), name: name.trim(), amount: qty, unit: unit.trim() });
    setName("");
    setQty(null);
    setUnit("");
    setRound((r) => r + 1);
  };
  return (
    <form className="add-item" onSubmit={add}>
      <input aria-label="Item" placeholder="Add an item: oat milk" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
      <NumText key={round} aria-label="Quantity" placeholder="Qty" value={qty} onValue={setQty} />
      <input aria-label="Unit" placeholder="unit" value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={40} />
      <button className="btn" type="submit" disabled={!name.trim()}>Add</button>
    </form>
  );
}

// --- notes -----------------------------------------------------------------

function Thread({ notes, target, send, placeholder, compact = false }: {
  notes: EventNote[];
  target: string;
  send: (op: Op) => void;
  placeholder: string;
  compact?: boolean;
}) {
  const [text, setText] = useState("");
  const add = (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (!text.trim()) return;
    send({ kind: "note", id: newId(), target, text: text.trim() });
    setText("");
  };
  return (
    <div className={`thread${compact ? " thread-compact" : ""}`}>
      {notes.length ? (
        <ul className="thread-list">
          {notes.map((n) => (
            <li key={n.id}>
              <p>{n.text}</p>
              <span className="stamp">{[n.author || "Someone", ago(n.at)].join(" · ")}</span>
            </li>
          ))}
        </ul>
      ) : compact ? null : <p className="edit-help">No notes yet.</p>}
      <form className="thread-add" onSubmit={add}>
        <textarea rows={compact ? 1 : 2} aria-label="Add a note" placeholder={placeholder} value={text} maxLength={500}
          onChange={(e) => setText(e.target.value)} />
        <button className="btn" type="submit" disabled={!text.trim()}>Post</button>
      </form>
    </div>
  );
}

// --- who you are, and whether it's reaching anyone --------------------------

function NameBar() {
  const name = useVisitorName();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  if (name && !editing) {
    return (
      <p className="name-bar stamp">
        You're <strong>{name}</strong>{" "}
        <button className="link-btn" onClick={() => { setDraft(name); setEditing(true); }}>Change</button>
      </p>
    );
  }
  return (
    <form className="name-bar name-form" onSubmit={(e) => { e.preventDefault(); setVisitorName(draft); setEditing(false); }}>
      <label className="field">
        <span>Your name, so others see who got what</span>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={40} placeholder="Priya" autoComplete="given-name" />
      </label>
      <button className="btn" type="submit" disabled={!draft.trim()}>Save</button>
    </form>
  );
}

function SharePill({ phase, pending }: { phase: SharePhase; pending: number }) {
  const text = phase === "offline"
    ? pending ? `Offline, ${pending} to send` : "Offline"
    : pending ? `${pending} to send` : phase === "loading" ? "Connecting…" : "Live";
  return (
    <span className="pill" aria-live="polite">
      <span className={`pill-dot pill-dot-${phase === "live" ? "idle" : phase === "offline" ? "offline" : "syncing"}`} aria-hidden="true" />
      {text}
    </span>
  );
}

function Missing({ phase }: { phase: SharePhase }) {
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
            <p>The menu will show as soon as there is one.</p>
          </>
        ) : (
          <p className="empty-title">Opening the menu…</p>
        )}
      </div>
    </div>
  );
}

/** Keep the secret link out of search engines and other sites' logs. */
function usePrivatePage(title?: string) {
  useEffect(() => {
    const metas = [["robots", "noindex, nofollow"], ["referrer", "no-referrer"]].map(([name, content]) => {
      const m = document.createElement("meta");
      m.name = name;
      m.content = content;
      document.head.appendChild(m);
      return m;
    });
    return () => metas.forEach((m) => m.remove());
  }, []);
  useEffect(() => {
    if (!title) return;
    const before = document.title;
    document.title = `${title} · Recipie`;
    return () => void (document.title = before);
  }, [title]);
}

function sessionGet(key: string): string | null {
  try {
    return sessionStorage.getItem(`recipie.${key}`);
  } catch {
    return null;
  }
}

function sessionSet(key: string, value: string) {
  try {
    sessionStorage.setItem(`recipie.${key}`, value);
  } catch { /* the tab just isn't remembered */ }
}

// --- a dish's recipe, from the share link ------------------------------------

function useDish(slug: string, dishId: string) {
  const shared = useSharedEvent(slug);
  return useMemo(() => {
    const event = shared.event;
    if (!event) return { ...shared, found: null };
    for (const day of event.doc.days) {
      const dish = day.dishes.find((x) => x.id === dishId);
      const recipe = dish?.recipe_id ? event.recipes[dish.recipe_id] : undefined;
      if (dish && recipe) {
        const base = recipe.servings ?? null;
        const factor = base && day.headcount ? day.headcount / base : 1;
        return { ...shared, found: { day, dish, recipe, factor, scaled: !!(base && day.headcount) } };
      }
    }
    return { ...shared, found: null };
  }, [shared, dishId]);
}

export function SharedDish() {
  const { slug = "", dishId = "" } = useParams();
  const { event, phase, found, send } = useDish(slug, dishId);
  usePrivatePage(found?.dish.name);
  if (!event) return <Missing phase={phase} />;
  if (!found) {
    return (
      <div className="page">
        <div className="empty">
          <p className="empty-title">This dish isn't on the menu any more.</p>
          <Link className="btn" to={`/e/${slug}`}>Back to the menu</Link>
        </div>
      </div>
    );
  }
  const { day, dish, recipe: d, factor, scaled } = found;
  const notes = event.notes.filter((n) => n.target === `dish:${dish.id}`);
  return (
    <div className="page page-recipe">
      <aside className="recipe-side">
        <nav className="back"><Link to={`/e/${slug}`}>{event.doc.title}</Link></nav>
        <header className="recipe-head">
          <h1 className="recipe-title">{dish.name}</h1>
          {dish.description || d.description ? <p className="recipe-desc">{dish.description || d.description}</p> : null}
          <p className="recipe-facts">
            <span>{dayLine(day)}</span>
            {dish.assignee ? <span>{dish.assignee}</span> : null}
          </p>
        </header>
        {!scaled ? (
          <p className="diet">
            {day.headcount ? "The recipe doesn't say how many it serves" : "No headcount for this day"}, so these are the
            recipe's own amounts{d.servings ? ` (serves ${d.servings})` : ""}.
          </p>
        ) : null}
        <Link to={`/e/${slug}/d/${dish.id}/cook`} className="btn btn-primary btn-cook">Start cooking</Link>
        <section className="dish-thread">
          <h2 className="panel-h">Notes</h2>
          <Thread notes={notes} target={`dish:${dish.id}`} send={send} placeholder="Used tinned beans, 3 tins." compact />
        </section>
      </aside>
      <div className="recipe-cols">
        <section className="ingredients" aria-labelledby="ing-h">
          <div className="section-head">
            <h2 id="ing-h">Ingredients</h2>
            {scaled ? <span className="stamp">for {day.headcount}</span> : null}
          </div>
          <ul className="ing-list">
            {d.ingredients.map((ing) => (
              <li key={ing.id} className={`ing ing-${ing.role ?? "minor"}`}>
                <span className="ing-tick">
                  <span className="ing-text">
                    <Qty ing={ing} factor={factor} />
                    <span className="ing-name">{ing.name}</span>
                    {ing.note ? <span className="ing-note">, {ing.note}</span> : null}
                    {ing.role === "optional" ? <span className="ing-note"> (optional)</span> : null}
                  </span>
                </span>
              </li>
            ))}
          </ul>
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
        </section>
      </div>
    </div>
  );
}

export function SharedCook() {
  const { slug = "", dishId = "" } = useParams();
  const { found } = useDish(slug, dishId);
  usePrivatePage(found?.dish.name);
  if (!found) return null;
  return <CookView doc={found.recipe} factor={found.factor} backTo={`/e/${slug}/d/${dishId}`} />;
}
