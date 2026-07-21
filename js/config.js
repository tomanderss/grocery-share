// config.js — statische App-Konfiguration: Standard-Personen, Standard-Kategorien,
// Modell-Auswahl, Defaults. Reine Daten, keine Logik (analog coop-number-sums).

// ─── PERSONEN ────────────────────────────────────────────────────────────────
// Genau zwei Personen; die Namen sind in den Einstellungen (oder per KI-Chat)
// änderbar, die IDs bleiben stabil (Regeln/Bons referenzieren die IDs).
export const DEFAULT_PERSONS = [
  { id: 'p1', name: 'Tom' },
  { id: 'p2', name: 'Tara' },
];

// ─── KATEGORIEN ──────────────────────────────────────────────────────────────
// Jede Kategorie hat automatisch die zwei Auswertungs-Zeilen "einzeln" und
// "teilen". Kategorien sind änderbar/ergänzbar (Einstellungen oder KI-Chat);
// die IDs bleiben stabil. `builtin` schützt vor versehentlichem Löschen der
// Kategorie, auf die die Pfand-Logik zeigt.
// `listItems`: die Auswertung zeigt bei dieser Kategorie zusätzlich die
// Artikelnamen in Klammern (für seltene Sammel-Kategorien wie Sonstiges).
export const DEFAULT_CATEGORIES = [
  { id: 'einkaufen', name: 'Einkaufen', icon: 'cart' },
  { id: 'getraenke', name: 'Getränke', icon: 'bottle' },
  { id: 'drogerie', name: 'Drogerie & Hausrat', icon: 'soap' },
  { id: 'sonstiges', name: 'Sonstiges', icon: 'gift', listItems: true },
];

// Pfand (Kauf UND Rückgabe) wird IMMER 50/50 geteilt und landet in dieser
// Kategorie — unabhängig davon, wem die Getränke gehören (beide bekommen das
// Pfand bei der Rückgabe ja auch gutgeschrieben).
export const DEPOSIT_CATEGORY_ID = 'einkaufen';

// ─── KI ──────────────────────────────────────────────────────────────────────
// Auswahl der Claude-Modelle für Bon-Analyse und Assistent-Chat. Opus 4.8 ist
// der Standard (beste Erkennung von Thermobon-Fotos); Haiku als Spar-Option.
export const CLAUDE_MODELS = [
  { id: 'claude-opus-4-8', name: 'Claude Opus 4.8 (empfohlen)' },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5 (günstiger)' },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5 (am günstigsten)' },
];
export const DEFAULT_MODEL = 'claude-opus-4-8';

// ─── DEFAULTS ────────────────────────────────────────────────────────────────
export const DEFAULT_SETTINGS = {
  apiKey: '',
  model: DEFAULT_MODEL,
  persons: DEFAULT_PERSONS,
  categories: DEFAULT_CATEGORIES,
  depositCategoryId: DEPOSIT_CATEGORY_ID,
  defaultCategoryId: 'einkaufen',
  theme: 'dark', // 'dark' | 'light'
  learningEnabled: true,
};

// Obergrenze gespeicherter Lern-Regeln (Produkt → Zuordnung); älteste/seltenste
// fliegen zuerst raus.
export const MAX_RULES = 600;

// Obergrenze der Chat-Historie, die an die API geschickt wird (Nachrichten).
export const CHAT_HISTORY_LIMIT = 20;
