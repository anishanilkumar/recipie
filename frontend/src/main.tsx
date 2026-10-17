import "@fontsource-variable/bricolage-grotesque";
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "./styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import { Cook } from "./pages/Cook";
import { Edit } from "./pages/Edit";
import { Home } from "./pages/Home";
import { RecipeView } from "./pages/RecipeView";
import { startSync } from "./sync";

const router = createBrowserRouter([
  { path: "/", element: <Home /> },
  { path: "/new", element: <Edit /> },
  { path: "/r/:id", element: <RecipeView /> },
  { path: "/r/:id/edit", element: <Edit /> },
  { path: "/r/:id/cook", element: <Cook /> },
]);

registerSW({ immediate: true });
void startSync();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
