// models.js — Modell-Katalog. Die App fragt die verfügbaren Claude-Modelle
// direkt bei der API ab (GET /v1/models, Abruf in claude.js), damit ein neu
// erschienenes Modell OHNE App-Update auswählbar ist. Diese Datei enthält nur
// die reine Auswertung des Katalogs (unit-getestet), kein Netz.
//
// Wichtig: die Models-API liefert KEINE Preise. Die kommen aus der Tabelle in
// cost.js; für unbekannte Modelle wird über die Modell-Linie (opus/sonnet/…)
// geschätzt und in der UI als Schätzung gekennzeichnet.

// Wie lange ein abgerufener Katalog als frisch gilt (danach im Hintergrund neu).
export const MODELS_TTL_MS = 24 * 60 * 60 * 1000;

// Ein Bon ist ein Foto oder PDF — Modelle ohne Bild- UND PDF-Eingabe können die
// Analyse gar nicht leisten und gehören nicht in die Auswahl. Ebenso wenig
// zurückgezogene Modelle (`retired`), die nur noch im Katalog stehen.
export function usableModels(data) {
  return (Array.isArray(data) ? data : [])
    .filter((m) => m && typeof m.id === 'string' && m.id)
    .filter((m) => m.lifecycle !== 'retired')
    .filter((m) => m.capabilities?.image_input?.supported !== false)
    .filter((m) => m.capabilities?.pdf_input?.supported !== false)
    .map((m) => ({
      id: m.id,
      name: m.display_name || m.id,
      line: m.line || null,
      createdAt: m.created_at || '',
      deprecated: m.lifecycle === 'deprecated',
    }));
}

// Neueste zuerst — so steht das aktuellste Modell oben in der Auswahl.
// Veraltete Modelle rutschen ans Ende, egal wie neu sie sind.
export function sortModels(models) {
  return [...models].sort((a, b) => {
    if (!!a.deprecated !== !!b.deprecated) return a.deprecated ? 1 : -1;
    return String(b.createdAt).localeCompare(String(a.createdAt));
  });
}

// Abgerufenen Katalog über die eingebaute Liste legen. Die eingebauten Modelle
// bleiben als Rückfallebene erhalten (offline, ohne Key, API-Fehler); der
// Katalog gewinnt bei Namen und Reihenfolge.
export function mergeModels(builtin, fetched) {
  const out = sortModels(usableModels(fetched));
  const have = new Set(out.map((m) => m.id));
  (builtin || []).forEach((b) => {
    if (!have.has(b.id)) out.push({ id: b.id, name: b.name, line: b.line || null, createdAt: '', deprecated: false });
  });
  return out;
}

// Ist der gespeicherte Katalog noch frisch?
export function catalogIsFresh(catalog, now = Date.now()) {
  return !!catalog?.fetchedAt && (now - catalog.fetchedAt) < MODELS_TTL_MS;
}
