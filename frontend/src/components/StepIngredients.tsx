import { amount, scaled } from "../format";
import { stepIngredients } from "../steps";
import type { Ingredient, Step } from "../types";

// The measurements a step needs, scaled to the servings being cooked.
export function StepIngredients({ step, ingredients, factor, size = "md" }: {
  step: Step;
  ingredients: Ingredient[];
  factor: number;
  size?: "md" | "lg";
}) {
  const { items } = stepIngredients(step, ingredients);
  if (!items.length) return null;
  return (
    <ul className={`step-ings step-ings-${size}`} aria-label="For this step">
      {items.map((i) => {
        const qty = [amount(scaled(i.amount, factor)), i.unit].filter(Boolean).join(" ");
        return (
          <li key={i.id}>
            {qty ? <span className="step-ing-qty">{qty}</span> : null}
            <span className="step-ing-name">{i.name}</span>
          </li>
        );
      })}
    </ul>
  );
}
