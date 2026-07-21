// storage.js — alles rund um localStorage. Keys mit Präfix 'gs_'. Enthält
// außerdem die reinen Merge-/Import-Helfer (unit-getestet). Kein UI-Code.
//
// Keys:
//   gs_settings   — Einstellungen (API-Key, Modell, Personen, Kategorien, Theme)
//   gs_receipts   — alle Bons (Array)
//   gs_rules      — gelernte Zuordnungs-Regeln
//   gs_chat       — Verlauf des KI-Assistenten (nur Anzeige, gekappt)
//   gs_debuglog   — Diagnoseprotokoll (siehe debuglog.js)

import { DEFAULT_SETTINGS } from './config.js';
import { log } from './debuglog.js';

const K = {
  settings: 'gs_settings',
  receipts: 'gs_receipts',
  rules: 'gs_rules',
  chat: 'gs_chat',
  credit: 'gs_credit',
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    log('storage', `read failed: ${key}`, { message: e?.message });
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    log('storage', `write failed: ${key}`, { message: e?.message });
  }
}

// ── Settings ──────────────────────────────────────────────────────────────────
// Reiner Merge: gespeicherte Einstellungen über die Defaults legen, damit neue
// Felder späterer Versionen automatisch ihre Defaults bekommen (unit-getestet).
export function mergeSettings(stored, defaults = DEFAULT_SETTINGS) {
  const s = { ...defaults, ...(stored || {}) };
  if (!Array.isArray(s.persons) || s.persons.length < 2) s.persons = defaults.persons;
  if (!Array.isArray(s.categories) || !s.categories.length) s.categories = defaults.categories;
  // Pfand-/Default-Kategorie müssen existieren, sonst auf erste Kategorie zeigen.
  if (!s.categories.some((c) => c.id === s.depositCategoryId)) s.depositCategoryId = s.categories[0].id;
  if (!s.categories.some((c) => c.id === s.defaultCategoryId)) s.defaultCategoryId = s.categories[0].id;
  return s;
}

export function loadSettings() { return mergeSettings(read(K.settings, null)); }
export function saveSettings(settings) { write(K.settings, settings); }

// ── Bons ──────────────────────────────────────────────────────────────────────
export function loadReceipts() { return read(K.receipts, []); }
export function saveReceipts(receipts) { write(K.receipts, receipts); }

// ── Regeln ────────────────────────────────────────────────────────────────────
export function loadRules() { return read(K.rules, []); }
export function saveRules(rules) { write(K.rules, rules); }

// ── Chat ──────────────────────────────────────────────────────────────────────
export function loadChat() { return read(K.chat, []); }
export function saveChat(messages) { write(K.chat, messages.slice(-60)); }

// ── Guthaben-Anker ────────────────────────────────────────────────────────────
// { anchorUsd: number|null, anchorAt: ts, spentUsd: number } — anchorUsd ist der
// vom Nutzer eingetragene Console-Guthabenstand, spentUsd der seitdem von der
// App verursachte Verbrauch (Analysen + Chat). Rechnen in js/cost.js.
export function loadCredit() { return read(K.credit, { anchorUsd: null, anchorAt: 0, spentUsd: 0 }); }
export function saveCredit(credit) { write(K.credit, credit); }

// ── Backup / Export / Import ─────────────────────────────────────────────────
// Der API-Key bleibt bewusst IM Export (persönliches Backup fürs eigene Gerät);
// wer das Backup teilt, sollte das wissen — die UI weist darauf hin.
export function collectExportData(settings, receipts, rules, credit = null) {
  return {
    app: 'grocery-share',
    schema: 1,
    exportedAt: new Date().toISOString(),
    settings,
    receipts,
    rules,
    credit,
  };
}

// Reiner Import-Validator/Normalisierer (unit-getestet). Wirft bei kaputten
// Daten, statt still Müll zu übernehmen.
export function parseImportData(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (!data || data.app !== 'grocery-share') {
    throw new Error('Keine gültige Grocery-Share-Sicherung.');
  }
  return {
    settings: mergeSettings(data.settings),
    receipts: Array.isArray(data.receipts) ? data.receipts : [],
    rules: Array.isArray(data.rules) ? data.rules : [],
    credit: data.credit && typeof data.credit === 'object'
      ? { anchorUsd: data.credit.anchorUsd ?? null, anchorAt: data.credit.anchorAt || 0, spentUsd: data.credit.spentUsd || 0 }
      : { anchorUsd: null, anchorAt: 0, spentUsd: 0 },
  };
}

export function applyImport(data) {
  saveSettings(data.settings);
  saveReceipts(data.receipts);
  saveRules(data.rules);
  saveCredit(data.credit);
  log('storage', 'import applied', { receipts: data.receipts.length, rules: data.rules.length });
}

// Eindeutige IDs für Bons/Positionen (kein uuid-Paket nötig).
export function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
