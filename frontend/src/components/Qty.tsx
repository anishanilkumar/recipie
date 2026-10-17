import { measures } from "../format";
import type { Ingredient } from "../types";

// "70 g (5 tbsp)": the weight, and the measure you'd actually scoop or count.
export function Qty({ ing, factor, className = "ing-qty" }: { ing: Ingredient; factor: number; className?: string }) {
  const { main, alt } = measures(ing, factor);
  if (!main && !alt) return null;
  return (
    <span className={className}>
      {main || alt}
      {main && alt ? <span className="qty-alt"> ({alt})</span> : null}
    </span>
  );
}
