# Bundled fonts

The same faces as the Jarvis household panel, so the two read as one system.
Self-hosted rather than fetched from a CDN: an offline-first app that loses its
typeface when the connection drops is not offline-capable.

All are licensed under the **SIL Open Font License 1.1**, which permits
redistribution alongside this project.

| File | Family | Source |
|---|---|---|
| `archivo-var.woff2` | Archivo (variable, 400–700), Latin subset | https://fonts.google.com/specimen/Archivo |
| `plexmono-400.woff2`, `plexmono-500.woff2` | IBM Plex Mono, Latin subset | https://fonts.google.com/specimen/IBM+Plex+Mono |
| `Manjari-Regular.woff2`, `Manjari-Bold.woff2` | Manjari 2.200, Swathanthra Malayalam Computing | https://gitlab.com/smc/fonts/manjari |

Manjari is declared with a `unicode-range` covering the Malayalam block, so the
browser only downloads it when a recipe actually contains Malayalam.

Full licence text: https://openfontlicense.org/
