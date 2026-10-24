// Mirrors backend/recipie/models.py.

export type Role = "main" | "minor" | "optional";

/** Every Grocy product that counts as this item, e.g. each pack size. */
interface PantryLinks {
  grocy_product_ids?: number[];
  /** Recipes saved before October 2026 carry a single id. Read, never written. */
  grocy_product_id?: number | null;
}

export interface Substitute extends PantryLinks {
  name: string;
}

export interface Ingredient extends PantryLinks {
  id: string;
  name: string;
  amount?: number | null;
  unit?: string;
  /** The same quantity in a kitchen measure, shown alongside: "¾ tsp", "9 medium". */
  alt_amount?: number | null;
  alt_unit?: string;
  note?: string;
  group?: string;
  role?: Role;
  substitutes?: Substitute[];
}

export interface Step {
  id: string;
  text: string;
  timer_seconds?: number | null;
  /** Ingredients this step uses; cook mode shows their measurements on the step. */
  ingredient_ids?: string[];
}

export interface RecipeDoc {
  title: string;
  description?: string;
  servings?: number | null;
  prep_minutes?: number | null;
  cook_minutes?: number | null;
  tags?: string[];
  source?: string;
  ingredients: Ingredient[];
  steps: Step[];
  notes?: string;
}

/** A recipe as stored in the browser. */
export interface LocalRecipe {
  id: string;
  /** Server rev this copy is based on (0 = never reached the server). */
  rev: number;
  deleted: boolean;
  updated_at: string;
  updated_by: string;
  doc: RecipeDoc;
  /** 1 while there is a local edit the server has not accepted yet. */
  dirty: 0 | 1;
  /** Bumped on every local edit, so a sync can tell an edit made while it was in flight. */
  localVersion: number;
}

export interface ServerRow {
  id: string;
  rev: number;
  seq: number;
  deleted: boolean;
  updated_at: string;
  updated_by: string;
  doc: RecipeDoc;
}

export interface PantryProduct {
  id: number;
  name: string;
  unit: string;
}

export interface PantrySnapshot {
  fetched_at: string | null;
  stale: boolean;
  error?: string;
  products: PantryProduct[];
  /** JSON object keys are strings: {"12": 3.5}. null = never fetched. */
  stock: Record<string, number> | null;
}

export function newId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

// --- events (backend/recipie/models.py, events.py, shopping.py) ---------------

export type DishStatus = "todo" | "already_made" | "done";

export interface EventItem {
  id: string;
  name: string;
  amount?: number | null;
  unit?: string;
}

export interface Dish {
  id: string;
  name: string;
  description?: string;
  recipe_id?: string | null;
  assignee?: string;
  effort?: string;
  status?: DishStatus;
  extra_ingredients?: EventItem[];
}

export interface Day {
  id: string;
  label: string;
  date?: string;
  headcount?: number | null;
  dishes: Dish[];
}

export interface EventDoc {
  title: string;
  description?: string;
  dietary_notes?: string;
  days: Day[];
  /** Shopping-list keys left off the list (salt, water). */
  hidden_keys?: string[];
}

/** One line of the worked-out shopping list. */
export interface ShoppingLine {
  key: string;
  name: string;
  amount: number | null;
  unit: string;
  alt_amount: number | null;
  alt_unit: string;
  optional: boolean;
  /** Some recipe has it "to taste", so the amount is a floor. */
  unmeasured: boolean;
  not_scaled: boolean;
  sources: { day: string; dish: string; dish_id: string; factor?: number }[];
  checked: boolean;
  checked_by: string;
  hidden: boolean;
}

/** Something a visitor added to the list by hand. */
export interface AddedItem {
  id: string;
  name: string;
  amount: number | null;
  unit: string;
  checked: boolean;
  checked_by: string;
  added_by: string;
  at: string;
}

export interface EventNote {
  id: string;
  /** "event", "dish:<id>" or "item:<shopping key or added item id>". */
  target: string;
  author: string;
  text: string;
  at: string;
}

export interface EventView {
  version: number;
  doc: EventDoc;
  shopping: ShoppingLine[];
  warnings: string[];
  items: AddedItem[];
  notes: EventNote[];
  dish_status: Record<string, { status: DishStatus; by: string; at: string }>;
  slug: string;
}

/** What the share link sees: the linked recipes come along. */
export interface SharedEvent extends EventView {
  recipes: Record<string, RecipeDoc>;
}

/** What the household's editor sees. */
export interface OwnedEvent extends EventView {
  id: string;
  rev: number;
  share_enabled: boolean;
  share_url: string;
  updated_at: string;
  updated_by: string;
}

export interface EventSummary {
  id: string;
  title: string;
  slug: string;
  share_enabled: boolean;
  updated_at: string;
  days: { label: string; date: string; headcount: number | null; dishes: number }[];
}
