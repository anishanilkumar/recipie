import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { clock } from "../format";
import { startTimer, stopTimer, useTimers } from "../timers";
import type { RecipeDoc } from "../types";
import { Qty } from "./Qty";
import { StepIngredients } from "./StepIngredients";

// One step at a time, big enough to read from across the counter. Used for a
// recipe in the book (pages/Cook.tsx) and for a dish on a shared event menu,
// where the recipe came with the event and isn't in this browser's book.
export function CookView({ doc: d, factor, backTo }: { doc: RecipeDoc; factor: number; backTo: string }) {
  const [index, setIndex] = useState(0);
  const [showIngredients, setShowIngredients] = useState(false);
  // Reading ahead without moving: the current step, its position and any
  // running timers stay exactly as they are.
  const [peek, setPeek] = useState(false);
  useEffect(() => setPeek(false), [index]);
  const timers = useTimers();
  useWakeLock();

  const steps = d.steps;
  const last = steps.length - 1;
  const go = (n: number) => setIndex(Math.min(Math.max(n, 0), Math.max(last, 0)));

  // Swipe between steps; hands are rarely clean enough for small buttons.
  const touch = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => (touch.current = e.touches[0].clientX);
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touch.current == null) return;
    const dx = e.changedTouches[0].clientX - touch.current;
    touch.current = null;
    if (Math.abs(dx) > 60) go(index + (dx < 0 ? 1 : -1));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") go(index + 1);
      if (e.key === "ArrowLeft") go(index - 1);
      if (e.key === "ArrowDown") setPeek(true);
      if (e.key === "ArrowUp") setPeek(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const step = steps[index];
  const next = steps[index + 1];

  return (
    <div className="cook" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <header className="cook-top">
        <Link to={backTo} className="cook-close">Done</Link>
        <span className="cook-name">{d.title}</span>
        <button className="cook-ing-toggle" onClick={() => setShowIngredients((s) => !s)} aria-expanded={showIngredients}>
          {showIngredients ? "Steps" : "Ingredients"}
        </button>
      </header>

      <div className="cook-progress" aria-hidden="true">
        {steps.map((s, i) => (
          <span key={s.id} className={i < index ? "done" : i === index ? "now" : ""} />
        ))}
      </div>

      {showIngredients ? (
        <ul className="cook-ings">
          {d.ingredients.map((i) => (
            <li key={i.id}>
              <Qty ing={i} factor={factor} /> {i.name}
              {i.note ? <span className="ing-note">, {i.note}</span> : null}
            </li>
          ))}
        </ul>
      ) : step ? (
        <main className="cook-step" key={step.id}>
          <p className="cook-count">
            Step {index + 1} of {steps.length}
          </p>
          <p className={`cook-text cook-text-${textSize(step.text)}`}>{step.text}</p>
          <StepIngredients step={step} ingredients={d.ingredients} factor={factor} size="lg" />
          {step.timer_seconds && !timers.some((t) => t.id === step.id) ? (
            <button className="btn btn-timer" onClick={() => startTimer(step.id, `Step ${index + 1}`, step.timer_seconds!)}>
              Start {clock(step.timer_seconds)} timer
            </button>
          ) : null}
          {next ? (
            <section className={`peek${peek ? " is-open" : ""}`} aria-label="Next step">
              <button className="peek-toggle" aria-expanded={peek} onClick={() => setPeek((p) => !p)}>
                <span className="label">Next up: step {index + 2}</span>
                <span className="peek-line">{peek ? "Hide" : next.text}</span>
              </button>
              {peek ? (
                <div className="peek-body">
                  <p>{next.text}</p>
                  <StepIngredients step={next} ingredients={d.ingredients} factor={factor} />
                  {next.timer_seconds ? <span className="timer-chip">{clock(next.timer_seconds)}</span> : null}
                </div>
              ) : null}
            </section>
          ) : null}
        </main>
      ) : (
        <main className="cook-step">
          <p className="cook-text">This recipe has no steps yet.</p>
        </main>
      )}

      {timers.length ? (
        <div className="timer-tray" role="status">
          {timers.map((t) => {
            const left = (t.endsAt - Date.now()) / 1000;
            return (
              <button key={t.id} className={`timer ${t.done ? "timer-done" : ""}`} onClick={() => stopTimer(t.id)}>
                <span className="timer-label">{t.label}</span>
                <span className="timer-time">{t.done ? "Done" : clock(left)}</span>
                <span className="timer-x">{t.done ? "Dismiss" : "Stop"}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      <nav className="cook-nav">
        <button className="btn" onClick={() => go(index - 1)} disabled={index === 0}>
          Back
        </button>
        {index < last ? (
          <button className="btn btn-primary" onClick={() => go(index + 1)}>
            Next step
          </button>
        ) : (
          <Link className="btn btn-primary" to={backTo}>
            Finish
          </Link>
        )}
      </nav>
    </div>
  );
}

/** Long steps get smaller type so a whole step still fits one screen. */
function textSize(text: string): "short" | "medium" | "long" {
  if (text.length > 300) return "long";
  if (text.length > 160) return "medium";
  return "short";
}

/** Keep the screen on while cooking. */
function useWakeLock() {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        if (document.visibilityState === "visible" && "wakeLock" in navigator) {
          lock = await navigator.wakeLock.request("screen");
          if (cancelled) void lock.release();
        }
      } catch { /* denied or unsupported: the screen just dims as usual */ }
    };
    void acquire();
    // The lock is dropped whenever the page is hidden; take it back on return.
    const onVis = () => void acquire();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      void lock?.release();
    };
  }, []);
}
