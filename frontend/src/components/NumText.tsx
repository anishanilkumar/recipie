import { useState } from "react";

/** A number input that keeps what was typed ("1.", "1/2") and reports the parsed value. */
export function NumText({ value, onValue, ...rest }: {
  value?: number | null;
  onValue: (v: number | null) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const [text, setText] = useState(value == null ? "" : String(value));
  return (
    <input {...rest} inputMode="decimal" value={text}
      onChange={(e) => { setText(e.target.value); onValue(parseNum(e.target.value)); }} />
  );
}

export function parseNum(s: string): number | null {
  const t = s.trim().replace(",", ".");
  if (!t) return null;
  const frac = t.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
