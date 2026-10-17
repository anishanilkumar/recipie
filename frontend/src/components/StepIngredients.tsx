import { Qty } from "./Qty";
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
        return (
          <li key={i.id}>
            <Qty ing={i} factor={factor} className="step-ing-qty" />
            <span className="step-ing-name">{i.name}</span>
          </li>
        );
      })}
    </ul>
  );
}
