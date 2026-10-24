import { useParams, useSearchParams } from "react-router-dom";
import { CookView } from "../components/CookView";
import { useRecipe } from "../hooks";

export function Cook() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const recipe = useRecipe(id);
  if (!recipe) return null;
  const base = recipe.doc.servings ?? null;
  const serves = Number(params.get("serves")) || base;
  const factor = base && serves ? serves / base : 1;
  return <CookView doc={recipe.doc} factor={factor} backTo={`/r/${recipe.id}`} />;
}
