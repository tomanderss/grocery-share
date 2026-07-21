# Grocery Share

Kassenbons fotografieren, per Claude-KI analysieren und die Kosten fair zwischen
zwei Personen (Standard: Tom & Tara) aufteilen — als Progressive Web App (PWA),
aufgebaut wie [coop-number-sums](https://github.com/tomanderss/coop-number-sums)
(Vanilla + Vue 3 via ESM, kein Build-Tooling, gleiche Versionierungs- und
Deploy-Mechanik).

## Was die App macht

1. **Bon hochladen** — Foto (JPG/PNG) oder PDF von REWE, EDEKA, Rossmann, ALDI, …
2. **KI-Analyse** — Claude liest alle Positionen aus: Artikel, Preise,
   Artikelrabatte (werden in den Artikelpreis eingerechnet), Pfand und Leergut.
3. **Zuordnen** — jede Position bekommt Kategorie und Aufteilung
   (nur Tom / 50:50 / nur Tara / beliebige Prozente wie 70/30).
   Gelernte Regeln aus früheren Bons werden automatisch angewandt.
4. **Auswertung** — Tabelle pro Bon und pro Monat: je Kategorie die Zeilen
   **einzeln** (Anteile, die nur eine Person trägt) und **teilen**
   (exakt 50:50 geteilte Beträge, pro Person identisch), plus Gesamtsummen
   pro Person. Als Tabelle kopierbar (Excel/Numbers).

### Aufteilungs-Regeln

- **teilen** = exakt 50:50. 35 € gemeinsame Lebensmittel → 17,50 € pro Person.
- **einzeln** = alles andere: 100/0 oder z.B. 70/30 — die Anteile wandern in
  die einzeln-Spalte der jeweiligen Person.
- **Pfand-Kauf** (z.B. Dosenpalette): immer 50:50, Kategorie Einkaufen —
  egal wer die Getränke trinkt (beide bekommen das Pfand später zurück).
- **Pfand-Rückgabe / Leergut**: negativer Betrag, immer 50:50, Kategorie
  Einkaufen — 20 € Leergut = 10 € Gutschrift pro Person.
- **Artikelrabatte** stecken im Artikelpreis und folgen dessen Aufteilung.

### KI-Assistent

Eingebauter Chat (Text + Spracheingabe), der die App **live umkonfiguriert**:
Personen umbenennen, Kategorien anlegen/ändern, Zuordnungs-Regeln setzen
(„Milka gehört ab jetzt Tara", „Kaffee teilen wir 70/30"). Außerdem lernt die
App bei jedem abgeschlossenen Bon automatisch mit.

## Einrichtung

Die App braucht einen eigenen **Anthropic-API-Key** (console.anthropic.com →
API Keys). Der Key wird in den Einstellungen hinterlegt, nur lokal auf dem
Gerät gespeichert und direkt an api.anthropic.com geschickt — es gibt keinen
eigenen Server. Eine Bon-Analyse kostet je nach Modell wenige Cent.

Alle Daten (Bons, Regeln, Einstellungen) liegen ausschließlich lokal auf dem
Gerät (localStorage), mit Export/Import als JSON-Sicherung.

## Lokal testen (iPhone im selben WLAN)

Doppelklick auf **`start-server.bat`** → die angezeigte `http://<IP>:8080`-Adresse
im iPhone-Safari öffnen → *Teilen → Zum Home-Bildschirm*. (Benötigt Python.)

## Deployment via GitHub Pages

Einmalige Einrichtung: **Settings → Pages → Source: `main` / `(root)`** →
Speichern. Die App liegt danach unter
`https://<user>.github.io/grocery-share/`.

Jeder weitere Release: **`build.bat`** (bzw. `node build.js` + Commit + Push) —
generiert Version & Changelog, bumpt den Service-Worker-Cache. GitHub Pages
deployt automatisch.

### Versionierung

`build.js` erhöht die Version in `.release-counter` (Minor +1; `--major` für
Major-Sprung), übernimmt die Zeilen aus `changes.txt` in den Changelog
(`js/buildinfo.js`) und leert `changes.txt`. Die neue Version erscheint in der
App im „Was ist neu"-Popup; Update-Prüfung per Klick auf die Versionsnummer.

### Icons neu erzeugen

`node create-icons.js` (erzeugt `icons/icon-192/512/1024.png`, ohne Abhängigkeiten).

## Tests

```bash
npm ci
npx playwright install --with-deps chromium
npm test              # Unit (node --test) + E2E (Playwright)
```

CI: `.github/workflows/test.yml` läuft bei jedem Push auf `main` und für PRs.

## Projektstruktur

```
index.html            Splashscreen + App-Mount
manifest.json         PWA-Manifest
sw.js                 Service Worker (Offline-Cache, Version via build.js)
build.js / build.bat  Versionierung & Deploy
create-icons.js       Icon-Generator (PNG ohne Abhängigkeiten)
css/styles.css        Styles (Dark default + Light)
js/
  config.js           Personen-, Kategorien-, Modell-Defaults
  receipt.js          Rechen-Engine (Cent-genau, unit-getestet)
  rules.js            Lern-Logik Produkt → Zuordnung (unit-getestet)
  storage.js          localStorage + Export/Import (unit-getestet)
  claude.js           Claude-API (Bon-Analyse + Assistent, Structured Outputs)
  debuglog.js         Diagnoseprotokoll
  icons.js            SVG-Icon-Set
  buildinfo.js        Auto-generiert: Version + Changelog
  app.js              Vue-App (Screens, Workflow)
```
