// rules.js — das "mitlernende" Gedächtnis der App (reine Logik, unit-getestet).
// Eine Regel merkt sich pro Produkt (normalisierter Name), welche Kategorie und
// welche Aufteilung der Nutzer zuletzt bestätigt hat:
//   { key, name, categoryId, split: {p1: 70, p2: 30}, count, updatedAt }
//
// Anwendung: beim Analysieren eines neuen Bons gewinnt IMMER die gelernte Regel
// über den KI-Vorschlag (der Nutzer hat sie ja explizit bestätigt). Beim
// Abschließen eines Bons werden alle Nicht-Pfand-Positionen eingelernt.

import { MAX_RULES } from './config.js';

// Produktnamen normalisieren: Kassenbons schreiben denselben Artikel mal
// "BIO JOGHURT 3,8%", mal "Bio Joghurt 3.8%" — Kleinbuchstaben, Satzzeichen
// raus, Whitespace kollabieren.
export function normalizeKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[.,;:!*%€]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchRule(rules, name) {
  const key = normalizeKey(name);
  if (!key) return null;
  return rules.find((r) => r.key === key) || null;
}

// Regeln auf frisch analysierte Positionen anwenden. Positionen ohne Regel
// behalten ihren (KI-)Vorschlag. Pfand-Positionen sind zwangsgeregelt und
// werden nie überschrieben.
export function applyRules(items, rules) {
  return items.map((item) => {
    if (item.kind === 'deposit' || item.kind === 'deposit_return') return item;
    const rule = matchRule(rules, item.name);
    if (!rule) return item;
    return {
      ...item,
      categoryId: rule.categoryId,
      split: { ...rule.split },
      fromRule: true,
    };
  });
}

// Beim Abschließen eines Bons lernen: jede Nicht-Pfand-Position wird als Regel
// gespeichert/aktualisiert. `now` wird hereingereicht (deterministisch testbar).
export function learnFromReceipt(rules, receipt, now, maxRules = MAX_RULES) {
  let out = [...rules];
  (receipt.items || []).forEach((item) => {
    if (item.kind === 'deposit' || item.kind === 'deposit_return') return;
    const key = normalizeKey(item.name);
    if (!key) return;
    const idx = out.findIndex((r) => r.key === key);
    const rule = {
      key,
      name: item.name,
      categoryId: item.categoryId,
      split: { ...item.split },
      count: idx >= 0 ? (out[idx].count || 0) + 1 : 1,
      updatedAt: now,
    };
    if (idx >= 0) out[idx] = rule; else out.push(rule);
  });
  if (out.length > maxRules) {
    // Selten benutzte und alte Regeln zuerst verwerfen.
    out = out
      .sort((a, b) => (b.count - a.count) || (b.updatedAt - a.updatedAt))
      .slice(0, maxRules);
  }
  return out;
}

// Kompakte Regel-Liste für den KI-Prompt (die häufigsten zuerst), damit die KI
// auch ÄHNLICHE neue Produkte im Sinne der bisherigen Gewohnheiten zuordnet.
export function rulesForPrompt(rules, persons, categories, limit = 120) {
  const catName = (id) => categories.find((c) => c.id === id)?.name || id;
  return [...rules]
    .sort((a, b) => (b.count - a.count) || (b.updatedAt - a.updatedAt))
    .slice(0, limit)
    .map((r) => {
      const parts = persons
        .filter((p) => (r.split[p.id] || 0) > 0)
        .map((p) => `${p.name} ${r.split[p.id]}%`)
        .join(' / ');
      return `${r.name} → ${catName(r.categoryId)}, ${parts}`;
    });
}
