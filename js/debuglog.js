// debuglog.js — persistentes On-Device-Diagnoseprotokoll (localStorage
// 'gs_debuglog', 300-Einträge-FIFO). Übernommen aus coop-number-sums: nur
// NIEDERFREQUENTE Ereignisse loggen (Start, Fehler, API-Aufrufe mit tookMs,
// Lifecycle) — log() schreibt synchron in localStorage.

const KEY = 'gs_debuglog';
const MAX = 300;

export function log(category, message, extra) {
  try {
    const entries = JSON.parse(localStorage.getItem(KEY)) || [];
    entries.push({ ts: Date.now(), category, message, extra });
    while (entries.length > MAX) entries.shift();
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch (e) { /* Quota/Privacy-Mode: Diagnose ist optional */ }
}

export function getEntries() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}

export function clearLog() {
  try { localStorage.removeItem(KEY); } catch {}
}

export function exportLogText(build) {
  const head = `Grocery Share v${build} — Diagnoseprotokoll\n${navigator.userAgent}\n\n`;
  const lines = getEntries().map((e) => {
    const t = new Date(e.ts).toISOString();
    const extra = e.extra ? ` ${JSON.stringify(e.extra)}` : '';
    return `${t} [${e.category}] ${e.message}${extra}`;
  });
  return head + lines.join('\n');
}
