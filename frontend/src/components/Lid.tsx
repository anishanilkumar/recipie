import { useEffect, useRef, useState } from "react";
import { STATUS_LABEL, type Verdict } from "../cookable";

// The cookability badge: an enamel pot lid in the status colour. What's on the
// lid is information, not decoration: a tick, the number of things missing,
// a cross, or a question mark.
export function Lid({ verdict, size = "md" }: { verdict: Verdict; size?: "md" | "lg" }) {
  const { status } = verdict;
  const missingCount = verdict.problems;
  const mark =
    status === "ready" ? <Tick /> : status === "almost" ? <span className="lid-num">{missingCount || 1}</span> : status === "no" ? <Cross /> : <span className="lid-num">?</span>;

  // Rattle when the status changes under you (a sync brought new stock), the
  // way a lid jumps when a pot comes to the boil. Not on first render.
  const prev = useRef(status);
  const [rattle, setRattle] = useState(false);
  useEffect(() => {
    if (prev.current !== status) {
      prev.current = status;
      setRattle(true);
      const t = setTimeout(() => setRattle(false), 700);
      return () => clearTimeout(t);
    }
  }, [status]);

  const label =
    status === "almost" ? `${STATUS_LABEL.almost}: ${missingCount || 1} to sort out` : STATUS_LABEL[status];

  return (
    <span className={`lid lid-${status} lid-${size}${rattle ? " lid-rattle" : ""}`} role="img" aria-label={label} title={label}>
      {mark}
    </span>
  );
}

function Tick() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Cross() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" />
    </svg>
  );
}
