import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Recipie",
        short_name: "Recipie",
        description: "Our recipes, and whether we can cook them tonight.",
        theme_color: "#0a0e14",
        background_color: "#0a0e14",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // Every in-app route is the SPA shell, offline too. /auth and /api must
        // reach the server: a cached index.html in place of the login redirect
        // would make signing in impossible.
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/auth\//, /^\/api\//],
      },
    }),
  ],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8770",
      "/auth": "http://127.0.0.1:8770",
    },
  },
  test: {
    environment: "node",
  },
});
