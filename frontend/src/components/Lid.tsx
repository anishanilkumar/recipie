import { useEffect, useRef, useState } from "react";
import { STATUS_LABEL, type Verdict } from "../cookable";

// The cookability badge: an engraved dial in the Jarvis style, its ring lit
// in the status colour. What sits in the middle is information, not
// decoration: a tick, the number of things to sort out, a cross, or a
// question mark.
const TICKS = Array.from({ length: 24 }, (_, i) => i);

export function Lid({ verdict, size = "md" }: { verdict: Verdict; size?: "md" | "lg" }) {
  const { status } = verdict;
  const count = verdict.problems || 1;
  const mark =
    status === "ready" ? <Tick /> : status === "almost" ? <span className="lid-num">{count}</span> : status === "no" ? <Cross /> : <span className="lid-num">?</span>;

  // Flash once when the status changes under you (a sync brought new stock).
  // Like the panel, nothing on this screen moves unless something changed.
  const prev = useRef(status);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (prev.current !== status) {
      prev.current = status;
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 900);
      return () => clearTimeout(t);
    }
  }, [status]);

  const label = status === "almost" ? `${STATUS_LABEL.almost}: ${count} to sort out` : STATUS_LABEL[status];

  return (
    <span className={`lid lid-${status} lid-${size}${flash ? " lid-flash" : ""}`} role="img" aria-label={label} title={label}>
      <svg className="lid-dial" viewBox="0 0 100 100" aria-hidden="true">
        {TICKS.map((i) => (
          <line key={i} className={i % 6 === 0 ? "lid-tick major" : "lid-tick"} x1="50" y1="3" x2="50" y2={i % 6 === 0 ? 11 : 8}
            transform={`rotate(${i * 15} 50 50)`} />
        ))}
        <circle className="lid-ring" cx="50" cy="50" r="36" />
      </svg>
      <span className="lid-mark">{mark}</span>
    </span>
  );
}

function Tick() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square" />
    </svg>
  );
}

function Cross() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square" />
    </svg>
  );
}
