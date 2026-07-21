// rules.js — das "mitlernende" Gedächtnis der App (reine Logik, unit-getestet).
//
// Eine Regel sammelt pro Produkt ALLE bisher bestätigten Zuordnungen als
// Häufigkeits-Statistik statt nur der letzten:
//   { key, name, categoryStats: {catId: n}, splitStats: {splitKey: n},
//     count, updatedAt }
// splitKey-Kodierung: 'shared' (gleichmäßig geteilt) | '<personId>' (100 %)
// | 'p1=70|p2=30' (freie Prozente).
//
// Vorauswahl = häufigste Zuordnung; die Verteilung wird der UI als Begründung
// angezeigt ("81 % nur Tom · 19 % geteilt (16×)") und der KI in den Prompt
// gegeben. Matching ist UNSCHARF (Zeichen-Bigramm-Ähnlichkeit): "Puddingprotein"
// trifft auch die Regel "Proteinpudding" — nicht nur den 1:1-Wortlaut.

import { MAX_RULES } from './config.js';
import { evenSplit, isEvenSplit, normalizeSplit } from './receipt.js';

// Produktnamen normalisieren: Kleinbuchstaben, Satzzeichen raus, Whitespace
// kollabieren ("BIO JOGHURT 3,8%" ≙ "Bio Joghurt 3.8%").
export function normalizeKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[.,;:!*%€]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Unscharfes Matching ──────────────────────────────────────────────────────
// Dice-Koeffizient über Zeichen-Bigramme (ohne Leerzeichen) — robust gegen
// vertauschte Wortteile, Zusätze und Tippvarianten auf Bons.
export function nameSimilarity(a, b) {
  const ka = normalizeKey(a).replace(/\s+/g, '');
  const kb = normalizeKey(b).replace(/\s+/g, '');
  if (!ka || !kb) return 0;
  if (ka === kb) return 1;
  if (ka.length < 3 || kb.length < 3) return 0;
  const grams = (s) => {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) || 0) + 1);
    }
    return m;
  };
  const ga = grams(ka);
  const gb = grams(kb);
  let shared = 0;
  ga.forEach((n, g) => { if (gb.has(g)) shared += Math.min(n, gb.get(g)); });
  return (2 * shared) / (ka.length - 1 + kb.length - 1);
}

// Schwelle kalibriert per Unit-Test: Wortdreher/Zusätze matchen, verschiedene
// Produkte ("Vollmilch" vs. "Milchreis") nicht.
export const MATCH_THRESHOLD = 0.72;

export function matchRule(rules, name) {
  const key = normalizeKey(name);
  if (!key) return null;
  const exact = rules.find((r) => r.key === key);
  if (exact) return exact;
  let best = null;
  let bestScore = 0;
  rules.forEach((r) => {
    const s = nameSimilarity(key, r.key);
    if (s > bestScore) { best = r; bestScore = s; }
  });
  return bestScore >= MATCH_THRESHOLD ? best : null;
}

// ── Split-Kodierung ──────────────────────────────────────────────────────────
export function splitKeyOf(split, personIds) {
  const s = normalizeSplit(split, personIds);
  if (isEvenSplit(s, personIds)) return 'shared';
  const solo = personIds.find((pid) => (s[pid] || 0) === 100);
  if (solo) return solo;
  return personIds.map((pid) => `${pid}=${s[pid] || 0}`).join('|');
}

export function splitFromKey(key, personIds) {
  if (key === 'shared') return evenSplit(personIds);
  if (personIds.includes(key)) {
    return Object.fromEntries(personIds.map((pid) => [pid, pid === key ? 100 : 0]));
  }
  const out = {};
  String(key).split('|').forEach((part) => {
    const [pid, pct] = part.split('=');
    out[pid] = parseInt(pct) || 0;
  });
  return normalizeSplit(out, personIds);
}

// ── Migration alter Regeln (v0.4: {split, categoryId, count}) ────────────────
export function normalizeRules(raw, personIds) {
  return (raw || []).map((r) => {
    if (r.splitStats) return r;
    const count = r.count || 1;
    return {
      key: r.key || normalizeKey(r.name),
      name: r.name,
      categoryStats: { [r.categoryId]: count },
      splitStats: { [splitKeyOf(r.split || {}, personIds)]: count },
      count,
      updatedAt: r.updatedAt || 0,
    };
  });
}

// ── Vorhersage & Begründung ──────────────────────────────────────────────────
// Häufigste Kategorie + häufigster Split, mit Konfidenz (Anteil des Siegers).
export function predictRule(rule, personIds) {
  const splits = Object.entries(rule.splitStats || {}).sort((a, b) => b[1] - a[1]);
  if (!splits.length) return null;
  const total = splits.reduce((a, [, n]) => a + n, 0);
  const cats = Object.entries(rule.categoryStats || {}).sort((a, b) => b[1] - a[1]);
  return {
    categoryId: cats[0]?.[0],
    split: splitFromKey(splits[0][0], personIds),
    splitKey: splits[0][0],
    confidencePct: Math.round((splits[0][1] / total) * 100),
    total,
  };
}

// Menschenlesbare Verteilung für die UI: "81 % nur Tom · 19 % geteilt (16×)".
export function ruleDistributionLabel(rule, persons) {
  const entries = Object.entries(rule.splitStats || {}).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((a, [, n]) => a + n, 0);
  if (!total) return '';
  const keyLabel = (key) => {
    if (key === 'shared') return 'geteilt';
    const solo = persons.find((p) => p.id === key);
    if (solo) return `nur ${solo.name}`;
    return String(key).split('|')
      .filter((part) => (parseInt(part.split('=')[1]) || 0) > 0)
      .map((part) => {
        const [pid, pct] = part.split('=');
        return `${persons.find((p) => p.id === pid)?.name || pid} ${pct}%`;
      })
      .join('/');
  };
  const parts = entries.slice(0, 3)
    .map(([k, n]) => `${Math.round((n / total) * 100)} % ${keyLabel(k)}`);
  return `${parts.join(' · ')} (${total}×)`;
}

// ── Anwenden & Lernen ────────────────────────────────────────────────────────
// Regeln auf frisch analysierte Positionen anwenden: die häufigste Zuordnung
// wird vorausgewählt, ruleInfo trägt die Begründung in die UI. Pfand ist
// zwangsgeregelt und wird nie überschrieben.
export function applyRules(items, rules, personIds, persons) {
  return items.map((item) => {
    if (item.kind === 'deposit' || item.kind === 'deposit_return') return item;
    const rule = matchRule(rules, item.name);
    if (!rule) return item;
    const pred = predictRule(rule, personIds);
    if (!pred) return item;
    return {
      ...item,
      categoryId: pred.categoryId || item.categoryId,
      split: pred.split,
      fromRule: true,
      ruleInfo: {
        matchedName: rule.name,
        exact: normalizeKey(item.name) === rule.key,
        confidencePct: pred.confidencePct,
        label: ruleDistributionLabel(rule, persons),
      },
    };
  });
}

// Beim Abschließen eines Bons lernen: jede bestätigte Nicht-Pfand-Position
// erhöht den Zähler ihrer Zuordnung — auch bei nur ÄHNLICHEM Namen wird die
// bestehende Regel fortgeschrieben (kein Duplikat je Schreibvariante).
export function learnFromReceipt(rules, receipt, now, personIds, maxRules = MAX_RULES) {
  let out = rules.map((r) => ({
    ...r,
    splitStats: { ...r.splitStats },
    categoryStats: { ...r.categoryStats },
  }));
  (receipt.items || []).forEach((item) => {
    if (item.kind === 'deposit' || item.kind === 'deposit_return') return;
    const key = normalizeKey(item.name);
    if (!key) return;
    const splitKey = splitKeyOf(item.split, personIds);
    const rule = out.find((r) => r.key === key) || matchRule(out, item.name);
    if (rule) {
      rule.splitStats[splitKey] = (rule.splitStats[splitKey] || 0) + 1;
      rule.categoryStats[item.categoryId] = (rule.categoryStats[item.categoryId] || 0) + 1;
      rule.count = (rule.count || 0) + 1;
      rule.updatedAt = now;
    } else {
      out.push({
        key,
        name: item.name,
        categoryStats: { [item.categoryId]: 1 },
        splitStats: { [splitKey]: 1 },
        count: 1,
        updatedAt: now,
      });
    }
  });
  if (out.length > maxRules) {
    out = out
      .sort((a, b) => (b.count - a.count) || (b.updatedAt - a.updatedAt))
      .slice(0, maxRules);
  }
  return out;
}

// Kompakte Regel-Liste für den KI-Prompt (die häufigsten zuerst) — inklusive
// der Verteilung, damit die KI auch ähnliche neue Produkte im Stil der
// bisherigen Gewohnheiten zuordnet.
export function rulesForPrompt(rules, persons, categories, limit = 120) {
  const catName = (id) => categories.find((c) => c.id === id)?.name || id;
  const personIds = persons.map((p) => p.id);
  return [...rules]
    .sort((a, b) => (b.count - a.count) || (b.updatedAt - a.updatedAt))
    .slice(0, limit)
    .map((r) => {
      const pred = predictRule(r, personIds);
      if (!pred) return null;
      return `${r.name} → ${catName(pred.categoryId)}, bisher ${ruleDistributionLabel(r, persons)}`;
    })
    .filter(Boolean);
}
