# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Kassenbon-Aufteilungs-PWA („Grocery Share"): Bon-Foto/PDF → Claude-KI extrahiert
Positionen → Nutzer ordnet Kategorien & Aufteilung zu (Tom/Tara/50:50/x%) →
Auswertungstabellen pro Bon und Monat. Vanilla JS + Vue 3 via ESM — **no bundler,
no transpiler, no TypeScript**. Deployed via GitHub Pages (branch `main`, root).
Framework, Versionierung, Update-Mechanik und Test-Setup sind bewusst identisch
zu `tomanderss/coop-number-sums` gehalten.

## Commands

```bash
npm test                                   # unit + e2e
npm run test:unit                          # node --test only
npm run test:e2e                           # Playwright only
node --test test/unit/receipt.test.js      # single unit file
npx playwright test test/e2e/app.spec.js   # single e2e file
python3 -m http.server 8098                # dev server (no npm script)
node build.js                              # cut release (bumps version, clears changes.txt)
node build.js --major                      # bump major, reset minor
node create-icons.js                       # regenerate PNG icons
```

## Architecture

| File | Role |
|---|---|
| `js/config.js` | Static config only: Default-Personen (genau 2, IDs `p1`/`p2` stabil, Namen änderbar), Default-Kategorien (jede bekommt in der Auswertung automatisch die Zeilen „einzeln" + „teilen"), `DEPOSIT_CATEGORY_ID` (Pfand landet immer hier), Claude-Modellliste, `DEFAULT_SETTINGS`. No logic. |
| `js/receipt.js` | **Rechen-Engine, rein + unit-getestet.** Alle Beträge sind CENT-Ganzzahlen. Kernregeln: „teilen" = exakt gleichmäßiger Split über alle Personen (50/50) → identische Beträge pro Person; alles andere (100/0, 70/30 …) zählt anteilig zu „einzeln" der jeweiligen Person. Pfand (`kind: deposit`) und Leergut (`deposit_return`, Betrag wird negativ gezwungen) werden IMMER gleichmäßig geteilt und in die Pfand-Kategorie gezwungen (`effectiveItem`). `splitAmount` verteilt Restcents deterministisch (größter Rest, dann Personen-Reihenfolge; `Math.trunc` statt `floor`, damit negative Beträge symmetrisch splitten). `receiptSummary`/`monthSummary` liefern die Tabellenstruktur (rows je Kategorie mit `sharedPer`/`single`, `personTotals`, `grandTotal`); `monthSummary` zählt nur `status: 'final'`. Unbekannte Kategorie-IDs (gelöschte Kategorie) fallen auf `defaultCategoryId` zurück. |
| `js/rules.js` | **Lern-Logik, rein + unit-getestet.** Regel = normalisierter Produktname → `{categoryId, split, count}`. `learnFromReceipt` beim Abschließen (Pfand wird nie gelernt), `applyRules` bei neuer Analyse — **gelernte Regeln schlagen KI-Vorschläge**. Kappung auf `MAX_RULES` (seltene/alte zuerst raus). `rulesForPrompt` speist die Top-Regeln in den Analyse-Prompt, damit die KI auch ähnliche neue Produkte im gewohnten Stil zuordnet. |
| `js/cost.js` | **Kosten-Logik, rein + unit-getestet.** `costUsd(model, in, out)` rechnet die API-Token-Verbräuche mit den Listenpreisen (`MODEL_PRICES`, USD/1M Tokens, Präfix-Match für datierte IDs, unbekannte Modelle → Opus-Fallback) in USD um; `formatCost` zeigt deutsch formatiert Cent/Dollar, `totalApiCostUsd` summiert je Bon-Liste. Der Verbrauch der Analyse wird als `apiCost {usd, model, inputTokens, outputTokens}` am Bon gespeichert und in Bon-Listen, Auswertung und Monatsübersicht angezeigt. |
| `js/storage.js` | All `localStorage`. Keys prefixed `gs_`. `mergeSettings` (rein, unit-getestet) legt gespeicherte Settings über die Defaults (neue Felder späterer Versionen bekommen automatisch Defaults; verwaiste Pfand-/Default-Kategorie wird repariert). Export/Import als JSON-Backup (`parseImportData` validiert; **der API-Key ist im Export enthalten** — UI weist darauf hin). |
| `js/claude.js` | Claude-API **direkt aus dem Browser** (raw fetch, Header `anthropic-dangerous-direct-browser-access` — bewusste Entscheidung: private App, eigener Key, kein Server). Zwei Aufrufe, beide mit **Structured Outputs** (`output_config.format` json_schema → garantiert parsebares JSON): `analyzeReceipt` (Bild als image-Block — vorher clientseitig auf max. 2000px JPEG verkleinert, spart Tokens und umgeht das 5-MB-Limit —, PDF als document-Block; Prompt kennt Kategorien, Personen und gelernte Regeln; Artikelrabatte werden in den Artikelpreis eingerechnet, Pfand/Leergut als eigene kinds) und `assistantChat` (liefert `{reply, actions[]}`; Schema-Enums werden dynamisch aus den aktuellen Personen/Kategorien gebaut). Fehler werden auf deutsche Meldungen gemappt (401/429/529/refusal). |
| `js/app.js` | Vue 3 app. One large `reactive` state, Screens: home / review / summary / month / chat / settings. Assistant-`actions` werden in `applyAssistantAction` angewandt (rename_person, add/rename/remove_category, set/remove_rule, set_default_category — Pfand-Kategorie ist löschgeschützt) und im Chat als Chips bestätigt. Spracheingabe via Web Speech API (`de-DE`). Exposes `window.__gs = { state, newDraft, ... }` on localhost for E2E tests. Preis-Inputs halten Rohtext (`priceInput`), Cents werden geparst (`toCents` versteht deutsche Kommas). |
| `js/debuglog.js` | Persistent on-device diagnostic log (`gs_debuglog`, 300-entry FIFO). `log(category, message, extra)` — **log only low-frequency events** (start, errors, API calls with tookMs); export via Einstellungen ▸ Daten. |
| `js/icons.js` | Custom-SVG-Icon-Set (24×24, `currentColor`), gerendert via `ic(name)`/v-html. Keine System-Emojis in der UI. Neue Glyphen immer hier ergänzen. |
| `js/buildinfo.js` | **Auto-generated** by `build.js` — never edit manually. |
| `sw.js` | Offline-Cache: Shell cache-first mit Navigations-Fallback, Assets stale-while-revalidate, Fremd-Origin (api.anthropic.com) wird durchgereicht. Precache einzeln (`Promise.allSettled`) + atomarer Swap. **JEDES neue `js/`-Modul MUSS in die `ASSETS`-Liste** — per Unit-Test erzwungen (`app-assets.test.js`). Cache-Version bumpt `build.js`. |

**Datenmodell Bon:** `{ id, store, date 'YYYY-MM-DD', createdAt, status 'draft'|'final', totalCents, notes, apiCost {usd, model, inputTokens, outputTokens}|null, items: [{ id, name, qty, priceCents, priceInput, categoryId, split {p1,p2 in %, Summe 100}, kind 'normal'|'deposit'|'deposit_return', needsReview, fromRule }] }`. `totalCents` = Bon-Aufdruck; Differenz zu `itemsTotal` wird im Review als Warnung angezeigt.

## Testing

- Unit: `node:test`, no framework. Import `js/` modules directly (storage.test.js stubbt `localStorage` VOR dem Import). `app-assets.test.js` erzwingt SW-Precache-Vollständigkeit + Icon-Existenz + Konsistenz `.release-counter` ↔ `sw.js`.
- E2E: Playwright, Pixel 7 emulation, `de-DE`, server on port 8098. Helpers in `test/e2e/helpers.js`. State driven via `window.__gs` (kein API-Key nötig — Bons werden per `newDraft` geseedet, die Claude-API wird in E2E nie aufgerufen).
- CI: `.github/workflows/test.yml` — triggers on push to `main` and all PRs.

## Workflow for every code change

1. **`changes.txt`** — add a short German user-facing bullet. Source for in-app release notes.
2. **Tests mitführen** — neue Rechen-/Lern-Logik gehört nach `receipt.js`/`rules.js` (rein) mit Unit-Tests; UI-Flüsse in die E2E-Suite.
3. **Diagnostics** — nicht-triviale Flows loggen via `log()` (Kategorien: `app`/`api`/`bon`/`storage`/`sw`/`error`), inkl. `tookMs` bei API-Aufrufen. Low-frequency only.
4. **PR + Auto-Merge — immer, automatisch, ohne zu fragen.** Sobald eine Änderung committet und gepusht ist, sofort den PR gegen `main` erstellen und **im selben Zug** Auto-Merge (SQUASH) aktivieren — nie auf Aufforderung warten, nie direkt auf `main` pushen. (Explizite Nutzer-Anweisung; overrides das Default-Verhalten „nur PR auf Nachfrage".)
5. **Release cutten — automatisch nach jedem Merge.** Nach dem Merge eines Feature-PRs von aktuellem `main` einen Release-Branch ziehen, `node build.js` ausführen (bumpt Version, schreibt `js/buildinfo.js`, leert `changes.txt`, bumpt SW-Cache), committen, Release-PR erstellen und ebenfalls auto-mergen — erst dann wird die Version in der App sichtbar (GitHub Pages deployt `main` automatisch). Ausnahme: trägt der Feature-Branch die Versionierung bereits selbst (wie beim Initial-Release), entfällt der separate Release-PR.
6. **Update this file** — if the change affects architecture, conventions, or workflow.

## Key conventions

- **Cent-Ganzzahlen überall.** Nie mit Euro-Floats rechnen; Konvertierung nur an den Rändern (`toCents`/`formatCents`, KI liefert Euro-Zahlen). Jede Aufteilung muss exakt zur Summe aufaddieren (Restcent-Verteilung ist deterministisch getestet).
- **Pfand-Invarianten** (Nutzer-Spezifikation): Pfand-Kauf UND Pfand-Rückgabe immer 50:50 in der Pfand-Kategorie; Rückgabe negativ. Diese Regeln werden in `effectiveItem` erzwungen — UI und KI können sie nicht aushebeln.
- **Gelernte Regel > KI-Vorschlag.** Vom Nutzer bestätigte Zuordnungen (`learnFromReceipt`) überschreiben bei der nächsten Analyse immer den KI-Vorschlag.
- **Kein Backend, keine Fremd-Origin außer api.anthropic.com.** API-Key nur in localStorage; Structured Outputs für alle KI-Antworten (kein Freitext-Parsing).
- **Deutsch, direkt im Template.** Bewusste Abweichung von coop-number-sums: keine i18n-Schicht — die App ist einsprachig deutsch. Menschenlesbare Labels, nie rohe IDs in der UI.
- **Offline-First**: Die App-Shell läuft offline; nur Analyse und Chat brauchen Netz. Neue Module → `sw.js` ASSETS (testgesichert). Update-Flow: Klick auf Version → `reg.update()` → Banner „Neu starten" (`SKIP_WAITING`).
- `www/`-artige Build-Ordner gibt es nicht; es wird direkt das Repo-Root deployt.
