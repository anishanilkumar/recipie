const FRACTIONS: [number, string][] = [
  [1 / 8, "⅛"], [1 / 4, "¼"], [1 / 3, "⅓"], [1 / 2, "½"], [2 / 3, "⅔"], [3 / 4, "¾"],
];

/** 1.5 -> "1½", 0.333 -> "⅓", 250 -> "250", 2.4 -> "2.4". */
export function amount(n: number | null | undefined): string {
  if (n == null) return "";
  const whole = Math.floor(n);
  const frac = n - whole;
  if (frac < 0.04) return String(whole);
  if (frac > 0.96) return String(whole + 1);
  for (const [v, glyph] of FRACTIONS) {
    if (Math.abs(frac - v) < 0.04) return whole ? `${whole}${glyph}` : glyph;
  }
  return n >= 10 ? String(Math.round(n)) : String(Math.round(n * 10) / 10);
}

export function scaled(n: number | null | undefined, factor: number): number | null {
  return n == null ? null : n * factor;
}

export function minutes(total: number | null | undefined): string {
  if (!total) return "";
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** "70 g" and "5 tbsp" for an ingredient, both scaled; either may be empty. */
export function measures(
  ing: { amount?: number | null; unit?: string; alt_amount?: number | null; alt_unit?: string },
  factor: number,
): { main: string; alt: string } {
  const join = (n: number | null | undefined, unit?: string) => [amount(scaled(n, factor)), n != null ? unit : ""].filter(Boolean).join(" ");
  return { main: join(ing.amount, ing.unit), alt: join(ing.alt_amount, ing.alt_unit) };
}

/** A shopping quantity: 2500 g -> "2½ kg", 1500 ml -> "1½ l", 30 -> "30". */
export function bulk(n: number | null | undefined, unit: string): string {
  if (n == null) return "";
  const u = unit.trim();
  if (u === "g" && n >= 1000) return `${amount(n / 1000)} kg`;
  if (u === "ml" && n >= 1000) return `${amount(n / 1000)} l`;
  return [amount(n), u].filter(Boolean).join(" ");
}
