// cost.js — reine Kosten-Logik für Claude-API-Aufrufe (unit-getestet).
// Die API meldet pro Aufruf input_tokens/output_tokens zurück; daraus wird mit
// den Listenpreisen (USD pro 1 Mio Tokens) der Verbrauch berechnet und am Bon
// gespeichert. Preise: platform.claude.com/docs → Pricing (Stand 07/2026).

export const MODEL_PRICES = {
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

// Fallback, wenn ein (neues) Modell nicht in der Tabelle steht — lieber leicht
// überschätzen als 0 anzeigen.
const FALLBACK_PRICE = { input: 5, output: 25 };

export function costUsd(model, inputTokens, outputTokens) {
  const key = Object.keys(MODEL_PRICES).find((id) => String(model || '').startsWith(id));
  const p = key ? MODEL_PRICES[key] : FALLBACK_PRICE;
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

// Summe der gespeicherten KI-Kosten einer Bon-Liste.
export function totalApiCostUsd(receipts) {
  return receipts.reduce((a, r) => a + (r.apiCost?.usd || 0), 0);
}
