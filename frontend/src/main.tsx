import "./styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import { Cook } from "./pages/Cook";
import { Edit } from "./pages/Edit";
import { EventEdit } from "./pages/EventEdit";
import { Events } from "./pages/Events";
import { EventShare, SharedCook, SharedDish } from "./pages/EventShare";
import { Home } from "./pages/Home";
import { RecipeView } from "./pages/RecipeView";
import { startSync } from "./sync";

const router = createBrowserRouter([
  { path: "/", element: <Home /> },
  { path: "/new", element: <Edit /> },
  { path: "/r/:id", element: <RecipeView /> },
  { path: "/r/:id/edit", element: <Edit /> },
  { path: "/r/:id/cook", element: <Cook /> },
  { path: "/events", element: <Events /> },
  { path: "/events/new", element: <EventEdit /> },
  { path: "/events/:id/edit", element: <EventEdit /> },
  // A share link: no login, no recipe book of its own.
  { path: "/e/:slug", element: <EventShare /> },
  { path: "/e/:slug/d/:dishId", element: <SharedDish /> },
  { path: "/e/:slug/d/:dishId/cook", element: <SharedCook /> },
]);

registerSW({ immediate: true });
// Someone opening a share link has no account: syncing the recipe book would
// only meet 401s. Their page talks to /api/share itself (events.ts).
if (!location.pathname.startsWith("/e/")) void startSync();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
