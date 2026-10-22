// cost.js — reine Kosten-Logik für Claude-API-Aufrufe (unit-getestet).
// Die API meldet pro Aufruf input_tokens/output_tokens zurück; daraus wird mit
// den Listenpreisen (USD pro 1 Mio Tokens) der Verbrauch berechnet und am Bon
// gespeichert. Preise: platform.claude.com/docs → Pricing (Stand 07/2026).

export const MODEL_PRICES = {
  'claude-fable-5': { input: 10, output: 50 },
  'claude-mythos-5': { input: 10, output: 50 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

// Die Models-API liefert KEINE Preise, aber die Modell-Linie. Erscheint ein
// neues Modell, wird über seine Linie geschätzt — besser als 0 oder gar keine
// Auswahl, und in der UI klar als Schätzung ausgewiesen.
export const LINE_PRICES = {
  fable: { input: 10, output: 50 },
  mythos: { input: 10, output: 50 },
  opus: { input: 5, output: 25 },
  sonnet: { input: 3, output: 15 },
  haiku: { input: 1, output: 5 },
};

// Fallback, wenn weder Modell noch Linie bekannt sind — lieber leicht
// überschätzen als 0 anzeigen.
const FALLBACK_PRICE = { input: 5, output: 25 };

// Preis eines Modells inkl. Herkunft: exact = aus der Tabelle, estimated = über
// die Linie oder den Fallback geraten.
export function priceFor(model, line = null) {
  // Nur exakte IDs oder datierte Schnappschüsse (…-20251001) zählen als Treffer.
  // Ein reiner startsWith würde "claude-opus-5-5" den Preis von "claude-opus-5"
  // geben — eine andere Modellversion, nicht derselbe Preis.
  const id = String(model || '');
  const key = Object.keys(MODEL_PRICES).find((k) => id === k || /^-\d{8}$/.test(id.slice(k.length)) && id.startsWith(k));
  if (key) return { ...MODEL_PRICES[key], estimated: false };
  if (line && LINE_PRICES[line]) return { ...LINE_PRICES[line], estimated: true };
  return { ...FALLBACK_PRICE, estimated: true };
}

export function costUsd(model, inputTokens, outputTokens, line = null) {
  const p = priceFor(model, line);
  const usd = ((inputTokens || 0) * p.input + (outputTokens || 0) * p.output) / 1e6;
  return Math.round(usd * 1e6) / 1e6; // auf Mikro-Dollar runden (stabil testbar)
}

// Deutsch formatiert: unter 1 $ in US-Cent ("≈ 1,2 ¢"), darüber in Dollar.
export function formatCost(usd) {
  if (!usd || usd <= 0) return '';
  if (usd < 0.995) {
    const cents = usd * 100;
    const shown = cents < 0.1 ? '<0,1' : (Math.round(cents * 10) / 10).toLocaleString('de-DE');
    return `≈ ${shown} ¢`;
  }
  return `≈ ${(Math.round(usd * 100) / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 })} $`;
}

// Summe der gespeicherten KI-Kosten einer Bon-Liste (roh, ohne Kalibrierung —
// die legt die UI per calibratedUsd darüber).
export function totalApiCostUsd(receipts) {
  return receipts.reduce((a, r) => a + (r.apiCost?.usd || 0), 0);
}

// Immer in Dollar formatieren (fürs Guthaben; kann durch Schätzfehler auch
// leicht negativ werden — dann mit Minus anzeigen statt zu lügen).
export function formatUsd(usd) {
  const v = Math.round((usd || 0) * 100) / 100;
  return `${v.toLocaleString('de-DE', { minimumFractionDigits: 2 })} $`;
}

// ── Guthaben-Tracking ────────────────────────────────────────────────────────
// Die Anthropic-API bietet KEINE Guthaben-Abfrage — der Nutzer trägt seinen
// Stand aus der Console als Anker ein
// ({ anchorUsd, anchorAt, spentUsd, costFactor }), die App zieht ab dann jeden
// KI-Aufruf ab. `spentUsd` sammelt IMMER die rohen Listenpreis-Beträge; die
// Abweichung zur echten Abrechnung steckt in `costFactor` (siehe
// reconcileCredit). So bleibt die Korrektur verlustfrei und wiederholbar.
export function costFactor(credit) {
  const f = Number(credit?.costFactor);
  return isFinite(f) && f > 0 ? f : 1;
}

// Kalibrierter Betrag zu einem rohen Listenpreis-Wert (für Anzeige & Schätzung).
export function calibratedUsd(rawUsd, credit) {
  return (rawUsd || 0) * costFactor(credit);
}

export function remainingCreditUsd(credit) {
  if (!credit || credit.anchorUsd == null) return null;
  return credit.anchorUsd - (credit.spentUsd || 0) * costFactor(credit);
}

// Manuelle Korrektur: der Nutzer trägt das TATSÄCHLICHE Restguthaben ein
// (Stand aus der Console). Daraus wird rückwärts gerechnet, wie stark die
// Listenpreis-Schätzung danebenlag, und der Faktor auf ALLE bisherigen und
// künftigen Beträge angewandt — die Summe der Bon-Kosten führt damit exakt auf
// den eingetragenen Wert zurück.
//
// Zwei Fälle:
//   'factor' — seit dem Anker wurde etwas verbraucht → Kalibrierfaktor neu
//              bestimmen (die alten Bon-Beträge verschieben sich mit).
//   'anchor' — nichts verbraucht, oder das Guthaben ist GESTIEGEN (Aufladung):
//              dann ist nichts falsch gerechnet, der Anker wird neu gesetzt.
export function reconcileCredit(credit, actualRemainingUsd, now = Date.now()) {
  const actual = Number(actualRemainingUsd);
  if (!isFinite(actual)) return null;
  const rawSpent = credit?.spentUsd || 0;
  const anchor = credit?.anchorUsd;
  const actualSpent = anchor == null ? 0 : anchor - actual;

  // Kein Anker, nichts verbraucht, oder aufgeladen → Anker neu setzen.
  if (anchor == null || rawSpent <= 0 || actualSpent <= 0) {
    return {
      mode: 'anchor',
      factor: costFactor(credit),
      credit: { anchorUsd: actual, anchorAt: now, spentUsd: 0, costFactor: costFactor(credit) },
    };
  }

  const factor = actualSpent / rawSpent;
  return {
    mode: 'factor',
    factor,
    credit: { ...credit, anchorUsd: anchor, spentUsd: rawSpent, costFactor: factor, correctedAt: now },
  };
}

// Durchschnittskosten der letzten n Bon-Analysen (nach createdAt, neueste zuerst).
export function avgAnalysisCostUsd(receipts, n = 10) {
  const costs = receipts
    .filter((r) => (r.apiCost?.usd || 0) > 0)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, n)
    .map((r) => r.apiCost.usd);
  if (!costs.length) return 0;
  return costs.reduce((a, c) => a + c, 0) / costs.length;
}

// Wie viele Bons das Restguthaben ungefähr noch abdeckt. null = keine Basis
// für eine Schätzung (noch keine Analyse oder kein Anker gesetzt).
export function estimateReceiptsLeft(remainingUsd, avgUsd) {
  if (remainingUsd == null || !avgUsd || avgUsd <= 0) return null;
  return Math.max(0, Math.floor(remainingUsd / avgUsd));
}

// ── Kostenprognose je Modell ─────────────────────────────────────────────────
// Was ein Bon mit Modell X ungefähr kosten würde. Basis sind die tatsächlich
// gemessenen Token-Verbräuche der bisherigen Analysen (am Bon gespeichert):
// bevorzugt die Historie DIESES Modells, sonst der Schnitt über alle — der
// Token-Bedarf hängt vor allem am Bon, nicht am Modell.
export function avgUsageFor(receipts, modelId = null, n = 10) {
  const all = (receipts || [])
    .filter((r) => r.apiCost && (r.apiCost.inputTokens || r.apiCost.outputTokens))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const own = modelId ? all.filter((r) => String(r.apiCost.model || '').startsWith(modelId)) : [];
  const pick = own.length ? own.slice(0, n) : all.slice(0, n);
  if (!pick.length) return null;
  const sum = pick.reduce((a, r) => ({
    inputTokens: a.inputTokens + (r.apiCost.inputTokens || 0),
    outputTokens: a.outputTokens + (r.apiCost.outputTokens || 0),
  }), { inputTokens: 0, outputTokens: 0 });
  return {
    inputTokens: Math.round(sum.inputTokens / pick.length),
    outputTokens: Math.round(sum.outputTokens / pick.length),
    count: pick.length,
    basis: own.length ? 'model' : 'overall',
  };
}

// Prognose für ein Modell. null = noch keine Analyse als Basis vorhanden.
// `credit` bringt die gelernte Kalibrierung mit ein (siehe reconcileCredit).
export function predictReceiptCostUsd(model, receipts, credit = null, line = null) {
  const usage = avgUsageFor(receipts, model.id || model);
  if (!usage) return null;
  const raw = costUsd(model.id || model, usage.inputTokens, usage.outputTokens, line ?? model.line ?? null);
  return {
    usd: calibratedUsd(raw, credit),
    basis: usage.basis,
    count: usage.count,
    estimated: priceFor(model.id || model, line ?? model.line ?? null).estimated,
  };
}
