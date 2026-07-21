// receipt.js — reine Rechen-Engine für die Kostenaufteilung. Keine UI, kein
// Storage, keine API — komplett unit-getestet. Alle Beträge sind CENT-Ganzzahlen
// (nie Floats), damit die Aufteilung auf den Cent genau aufgeht.
//
// Datenmodell eines Bons:
//   { id, store, date: 'YYYY-MM-DD', createdAt, status: 'draft'|'final',
//     items: [{ id, name, qty, priceCents, categoryId,
//               split: { p1: 50, p2: 50 },      // Prozent je Person, Summe 100
//               kind: 'normal'|'deposit'|'deposit_return' }] }
//
// Regeln (siehe README/CLAUDE.md):
// - "teilen"  = Position ist exakt gleichmäßig auf ALLE Personen verteilt
//               (bei 2 Personen: 50/50). Die Teilen-Summe ist pro Person identisch.
// - "einzeln" = alles andere (100/0, 70/30, ...): jeder Anteil wandert in die
//               einzeln-Spalte der jeweiligen Person.
// - Pfand-Kauf und Pfand-Rückgabe (kind deposit/deposit_return) werden IMMER
//   gleichmäßig geteilt und zählen zur Pfand-Kategorie (Einkaufen) — die
//   Rückgabe als negativer Betrag.
// - Artikelrabatte sind bereits im priceCents der Position eingerechnet und
//   folgen damit automatisch deren Aufteilung.

// ── Geld-Helfer ───────────────────────────────────────────────────────────────
export function toCents(euro) {
  const n = typeof euro === 'string' ? parseFloat(euro.replace(',', '.')) : euro;
  if (!isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function formatCents(cents, { sign = false } = {}) {
  const c = Math.round(cents) || 0;
  const abs = Math.abs(c);
  const s = `${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')} €`;
  if (c < 0) return `-${s}`;
  return sign && c > 0 ? `+${s}` : s;
}

// ── Aufteilung ────────────────────────────────────────────────────────────────
// Gleichmäßiger Split über alle Personen (z.B. {p1:50, p2:50}).
export function evenSplit(personIds) {
  const n = personIds.length;
  const base = Math.floor(100 / n);
  const split = {};
  personIds.forEach((pid, i) => { split[pid] = base + (i < 100 - base * n ? 1 : 0); });
  return split;
}

// Ist der Split exakt gleichmäßig über ALLE Personen? (→ Zeile "teilen")
export function isEvenSplit(split, personIds) {
  if (!split) return false;
  const even = evenSplit(personIds);
  return personIds.every((pid) => (split[pid] || 0) === even[pid]);
}

// Split normalisieren: Summe auf 100 zwingen. Fehlt eine Person im Eingabe-
// Objekt komplett, bekommt SIE den Rest ({p1:70} → {p1:70, p2:30}); sonst
// landet die Differenz bei der ersten Person mit Anteil > 0.
export function normalizeSplit(split, personIds) {
  const out = {};
  personIds.forEach((pid) => { out[pid] = Math.max(0, Math.round(split?.[pid] || 0)); });
  const sum = personIds.reduce((a, pid) => a + out[pid], 0);
  if (sum === 0) return evenSplit(personIds);
  if (sum !== 100) {
    const missing = personIds.find((pid) => !(pid in (split || {})));
    const carrier = (sum < 100 && missing) || personIds.find((pid) => out[pid] > 0) || personIds[0];
    out[carrier] += 100 - sum;
    if (out[carrier] < 0) return evenSplit(personIds); // absurde Eingabe → 50/50
  }
  return out;
}

// Cent-genaue Aufteilung eines Betrags nach Prozent-Split. Rundungs-Restcents
// werden deterministisch in Personen-Reihenfolge verteilt (größter Rest zuerst,
// bei Gleichstand frühere Person) — die Summe der Anteile ist IMMER der Betrag.
export function splitAmount(amountCents, split, personIds) {
  const total = Math.round(amountCents) || 0;
  const raw = personIds.map((pid) => ({ pid, exact: (total * (split[pid] || 0)) / 100 }));
  const out = {};
  let assigned = 0;
  raw.forEach((r) => {
    // trunc statt floor, damit negative Beträge (Pfand-Rückgabe) symmetrisch
    // aufgeteilt werden (-100 → -50/-50, nicht -51/-49).
    out[r.pid] = Math.trunc(r.exact);
    assigned += out[r.pid];
  });
  let rest = total - assigned; // kann negativ sein (bei negativen Beträgen)
  const order = raw
    .map((r) => ({ pid: r.pid, frac: Math.abs(r.exact - Math.trunc(r.exact)) }))
    .sort((a, b) => b.frac - a.frac || personIds.indexOf(a.pid) - personIds.indexOf(b.pid));
  const step = rest > 0 ? 1 : -1;
  for (let i = 0; rest !== 0 && i < order.length * 2; i++) {
    out[order[i % order.length].pid] += step;
    rest -= step;
  }
  return out;
}

// ── Effektive Position ────────────────────────────────────────────────────────
// Wendet die Pfand-Zwangsregeln an: Pfand & Leergut → gleichmäßiger Split über
// alle Personen + Pfand-Kategorie. Rückgabe-Beträge werden negativ gezwungen.
export function effectiveItem(item, settings) {
  const personIds = settings.persons.map((p) => p.id);
  const isDeposit = item.kind === 'deposit' || item.kind === 'deposit_return';
  let priceCents = Math.round(item.priceCents) || 0;
  if (item.kind === 'deposit_return' && priceCents > 0) priceCents = -priceCents;
  return {
    ...item,
    priceCents,
    categoryId: isDeposit ? settings.depositCategoryId : item.categoryId,
    split: isDeposit ? evenSplit(personIds) : normalizeSplit(item.split, personIds),
  };
}

// ── Auswertung eines Bons ─────────────────────────────────────────────────────
// Liefert die Übersichts-Tabelle:
// {
//   rows: [{ categoryId, name, sharedTotal, sharedPer: {pid}, single: {pid}, total }],
//   personTotals: {pid}, sharedGrandPer: {pid}, grandTotal
// }
// sharedPer ist für alle Personen identisch aufgeteilt (Restcent-Verteilung kann
// um 1 Cent differieren — deterministisch).
export function receiptSummary(receipt, settings) {
  const personIds = settings.persons.map((p) => p.id);
  const byCat = new Map();
  settings.categories.forEach((c) => {
    byCat.set(c.id, {
      categoryId: c.id,
      name: c.name,
      sharedTotal: 0,
      sharedPer: Object.fromEntries(personIds.map((pid) => [pid, 0])),
      single: Object.fromEntries(personIds.map((pid) => [pid, 0])),
      total: 0,
      // Artikelnamen der Kategorie (dedupliziert) — die UI zeigt sie z.B. bei
      // "Sonstiges" in Klammern an, damit klar ist, was da drinsteckt.
      itemNames: [],
    });
  });
  // Unbekannte Kategorie-IDs (z.B. gelöschte Kategorie) → Standard-Kategorie
  const fallbackId = byCat.has(settings.defaultCategoryId)
    ? settings.defaultCategoryId
    : settings.categories[0]?.id;

  let grandTotal = 0;
  const personTotals = Object.fromEntries(personIds.map((pid) => [pid, 0]));

  (receipt.items || []).forEach((raw) => {
    const item = effectiveItem(raw, settings);
    const row = byCat.get(byCat.has(item.categoryId) ? item.categoryId : fallbackId);
    if (!row) return;
    grandTotal += item.priceCents;
    const name = String(item.name || '').trim();
    if (name && !row.itemNames.includes(name)) row.itemNames.push(name);
    const shares = splitAmount(item.priceCents, item.split, personIds);
    personIds.forEach((pid) => { personTotals[pid] += shares[pid]; });
    if (isEvenSplit(item.split, personIds)) {
      row.sharedTotal += item.priceCents;
      personIds.forEach((pid) => { row.sharedPer[pid] += shares[pid]; });
    } else {
      personIds.forEach((pid) => { row.single[pid] += shares[pid]; });
    }
    row.total += item.priceCents;
  });

  const rows = [...byCat.values()].filter(
    (r) => r.total !== 0 || r.sharedTotal !== 0 || personIds.some((pid) => r.single[pid] !== 0)
  );
  const sharedGrandPer = Object.fromEntries(
    personIds.map((pid) => [pid, rows.reduce((a, r) => a + r.sharedPer[pid], 0)])
  );
  return { rows, personTotals, sharedGrandPer, grandTotal };
}

// Summe der Positionsbeträge (zur Plausibilitätsprüfung gegen den Bon-Gesamtbetrag).
export function itemsTotal(receipt, settings) {
  return (receipt.items || []).reduce(
    (a, raw) => a + effectiveItem(raw, settings).priceCents, 0
  );
}

// ── Monats-Übersicht ──────────────────────────────────────────────────────────
// Aggregiert alle FINALEN Bons eines Monats ('YYYY-MM') zu derselben
// Tabellenstruktur wie receiptSummary.
export function monthSummary(receipts, settings, yearMonth) {
  const merged = {
    id: `month-${yearMonth}`,
    items: [],
  };
  const list = receipts.filter(
    (r) => r.status === 'final' && (r.date || '').startsWith(yearMonth)
  );
  list.forEach((r) => { merged.items.push(...(r.items || [])); });
  const summary = receiptSummary(merged, settings);
  return { ...summary, receiptCount: list.length };
}

// Monatsschlüssel eines Bons ('YYYY-MM'); fällt auf createdAt zurück.
export function receiptMonth(receipt) {
  if (/^\d{4}-\d{2}/.test(receipt.date || '')) return receipt.date.slice(0, 7);
  return new Date(receipt.createdAt || Date.now()).toISOString().slice(0, 7);
}
