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

// Freie Slider-Werte (beliebige Summen, z.B. 60/60/30) proportional auf exakt
// 100 % skalieren — für den Prozent-Editor mit einem Slider je Person.
// Rundung per größtem Rest, deterministisch (Personen-Reihenfolge als Tiebreak).
export function proportionalSplit(raw, personIds) {
  const vals = personIds.map((pid) => Math.max(0, Number(raw?.[pid]) || 0));
  const sum = vals.reduce((a, b) => a + b, 0);
  if (sum <= 0) return evenSplit(personIds);
  const exact = vals.map((v) => (v / sum) * 100);
  const out = {};
  let assigned = 0;
  personIds.forEach((pid, i) => { out[pid] = Math.floor(exact[i]); assigned += out[pid]; });
  let rest = 100 - assigned;
  const order = personIds
    .map((pid, i) => ({ pid, frac: exact[i] - Math.floor(exact[i]) }))
    .sort((a, b) => b.frac - a.frac || personIds.indexOf(a.pid) - personIds.indexOf(b.pid));
  for (let i = 0; rest > 0; i++, rest--) out[order[i % order.length].pid] += 1;
  return out;
}

// Slider-Bewegung im Prozent-Editor: eine Person wird auf `value` gesetzt,
// GESPERRTE Personen (locked[pid]) behalten ihren Wert, die übrigen OFFENEN
// teilen sich den Rest zu 100 proportional zu ihren bisherigen Werten (standen
// alle Offenen auf 0, gleichmäßig). Der bewegte Wert wird geklemmt, damit die
// gesperrten Werte immer Platz haben; sind ALLE übrigen gesperrt, nimmt der
// bewegte Regler zwangsweise exakt den Rest. So summieren die Regler nach jeder
// Bewegung sichtbar auf exakt 100 % — bei 2 Personen springt der andere Regler
// direkt auf das Komplement (20 → 80). Rundung per größtem Rest, deterministisch.
export function rebalanceSplit(pcts, changedPid, value, personIds, locked = {}) {
  if (!personIds.includes(changedPid)) return proportionalSplit(pcts, personIds);
  const lockedIds = personIds.filter((pid) => pid !== changedPid && locked[pid]);
  const lockedSum = lockedIds.reduce((a, pid) => a + Math.max(0, Math.round(Number(pcts?.[pid]) || 0)), 0);
  const others = personIds.filter((pid) => pid !== changedPid && !locked[pid]);
  const out = {};
  lockedIds.forEach((pid) => { out[pid] = Math.max(0, Math.round(Number(pcts?.[pid]) || 0)); });
  if (!others.length) {
    out[changedPid] = Math.max(0, 100 - lockedSum); // letzter offener Regler = Rest
    return out;
  }
  const v = Math.min(Math.max(0, 100 - lockedSum), Math.max(0, Math.round(Number(value) || 0)));
  out[changedPid] = v;
  const rest = 100 - lockedSum - v;
  const prev = others.map((pid) => Math.max(0, Number(pcts?.[pid]) || 0));
  const prevSum = prev.reduce((a, b) => a + b, 0);
  const weights = prevSum > 0 ? prev : others.map(() => 1);
  const wSum = prevSum > 0 ? prevSum : others.length;
  const exact = weights.map((w) => (rest * w) / wSum);
  let assigned = 0;
  others.forEach((pid, i) => { out[pid] = Math.floor(exact[i]); assigned += out[pid]; });
  const order = others
    .map((pid, i) => ({ pid, frac: exact[i] - Math.floor(exact[i]), i }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let i = 0; assigned < rest; i++, assigned++) out[order[i % order.length].pid] += 1;
  return out;
}

// Betrag EXAKT gleichmäßig auf alle Beteiligten — ohne Umweg über Prozente.
// Nötig, weil evenSplit bei 3 Personen 34/33/33 liefert: 9,00 € würden darüber
// zu 3,06/2,97/2,97 statt 3,00/3,00/3,00. "teilen" verspricht aber identische
// Beträge, also wird hier direkt durch die Köpfe geteilt (Restcents
// deterministisch an die vorderen Personen, Vorzeichen folgt dem Betrag).
export function splitEvenly(amountCents, personIds) {
  const total = Math.round(amountCents) || 0;
  const n = personIds.length;
  if (!n) return {};
  const base = Math.trunc(total / n);
  const rest = total - base * n;
  const step = rest >= 0 ? 1 : -1;
  const out = {};
  personIds.forEach((pid, i) => { out[pid] = base + (i < Math.abs(rest) ? step : 0); });
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

// ── Beteiligte eines Bons ────────────────────────────────────────────────────
// Personen können als GAST geführt werden (`person.optional`). Gäste zählen nur
// bei Bons mit, die sie ausdrücklich führen (`receipt.participantIds`) — sonst
// würde ein einmal angelegter Gast jede spätere Abrechnung mit einer leeren
// Spalte aufblähen. Ohne `participantIds` (Altbestand) gilt die feste Besetzung.
export function receiptPersonIds(receipt, settings) {
  const persons = settings?.persons || [];
  const all = persons.map((p) => p.id);
  if (!all.length) return [];
  const listed = Array.isArray(receipt?.participantIds)
    ? receipt.participantIds.filter((pid) => all.includes(pid))
    : null;
  // Reihenfolge immer aus den Einstellungen — die Restcent-Verteilung hängt daran.
  if (listed && listed.length) return all.filter((pid) => listed.includes(pid));
  const fixed = persons.filter((p) => !p.optional).map((p) => p.id);
  return fixed.length ? fixed : all;
}

// Die feste Besetzung (alle Nicht-Gäste) — Startbesetzung jedes neuen Bons.
export function defaultParticipantIds(settings) {
  return receiptPersonIds(null, settings);
}

// Besetzung eines Bons ändern: gleichmäßig geteilte Positionen bleiben
// gleichmäßig geteilt (jetzt über die neue Runde), alles andere wird nur auf
// die neue Besetzung normalisiert — ein hinzukommender Gast startet dort bei 0 %.
export function reassignSplits(items, oldIds, newIds) {
  return (items || []).map((item) => ({
    ...item,
    split: isEvenSplit(item.split, oldIds) ? evenSplit(newIds) : normalizeSplit(item.split, newIds),
  }));
}

// ── Effektive Position ────────────────────────────────────────────────────────
// Wendet die Pfand-Zwangsregeln an: Pfand & Leergut → gleichmäßiger Split über
// alle Personen + Pfand-Kategorie. Rückgabe-Beträge werden negativ gezwungen.
export function effectiveItem(item, settings, personIds = defaultParticipantIds(settings)) {
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
  const personIds = receiptPersonIds(receipt, settings);
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
    const item = effectiveItem(raw, settings, personIds);
    const row = byCat.get(byCat.has(item.categoryId) ? item.categoryId : fallbackId);
    if (!row) return;
    grandTotal += item.priceCents;
    const name = String(item.name || '').trim();
    if (name && !row.itemNames.includes(name)) row.itemNames.push(name);
    const even = isEvenSplit(item.split, personIds);
    const shares = even
      ? splitEvenly(item.priceCents, personIds)
      : splitAmount(item.priceCents, item.split, personIds);
    personIds.forEach((pid) => { personTotals[pid] += shares[pid]; });
    if (even) {
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
  return { rows, personTotals, sharedGrandPer, grandTotal, personIds };
}

// Summe der Positionsbeträge (zur Plausibilitätsprüfung gegen den Bon-Gesamtbetrag).
export function itemsTotal(receipt, settings) {
  const personIds = receiptPersonIds(receipt, settings);
  return (receipt.items || []).reduce(
    (a, raw) => a + effectiveItem(raw, settings, personIds).priceCents, 0
  );
}

// ── Monats-Übersicht ──────────────────────────────────────────────────────────
// Aggregiert alle FINALEN Bons eines Monats ('YYYY-MM') zu derselben
// Tabellenstruktur wie receiptSummary.
export function monthSummary(receipts, settings, yearMonth) {
  const list = receipts.filter(
    (r) => r.status === 'final' && (r.date || '').startsWith(yearMonth)
  );
  // Spalten = nur Personen, die diesen Monat auch wirklich beteiligt waren.
  // Ein Gast, der einmal dabei war, taucht im Monat auf, in allen anderen nicht.
  const order = (settings.persons || []).map((p) => p.id);
  const involved = new Set();
  list.forEach((r) => receiptPersonIds(r, settings).forEach((pid) => involved.add(pid)));
  const seen = order.filter((pid) => involved.has(pid));
  const personIds = seen.length ? seen : defaultParticipantIds(settings);

  const zero = () => Object.fromEntries(personIds.map((pid) => [pid, 0]));
  const byCat = new Map();
  (settings.categories || []).forEach((c) => byCat.set(c.id, {
    categoryId: c.id,
    name: c.name,
    sharedTotal: 0,
    sharedPer: zero(),
    single: zero(),
    total: 0,
    itemNames: [],
  }));
  const personTotals = zero();
  let grandTotal = 0;

  // JEDER Bon wird mit SEINER Besetzung ausgewertet und erst danach aufaddiert —
  // sonst würde ein 50:50-Bon in einem Monat mit Gast fälschlich als "einzeln"
  // gelten, weil der Gast dort 0 % hätte.
  list.forEach((r) => {
    const s = receiptSummary(r, settings);
    grandTotal += s.grandTotal;
    personIds.forEach((pid) => { personTotals[pid] += s.personTotals[pid] || 0; });
    s.rows.forEach((row) => {
      const target = byCat.get(row.categoryId);
      if (!target) return;
      target.sharedTotal += row.sharedTotal;
      target.total += row.total;
      personIds.forEach((pid) => {
        target.sharedPer[pid] += row.sharedPer[pid] || 0;
        target.single[pid] += row.single[pid] || 0;
      });
      row.itemNames.forEach((n) => { if (!target.itemNames.includes(n)) target.itemNames.push(n); });
    });
  });

  const rows = [...byCat.values()].filter(
    (r) => r.total !== 0 || r.sharedTotal !== 0 || personIds.some((pid) => r.single[pid] !== 0)
  );
  const sharedGrandPer = Object.fromEntries(
    personIds.map((pid) => [pid, rows.reduce((a, r) => a + r.sharedPer[pid], 0)])
  );
  return { rows, personTotals, sharedGrandPer, grandTotal, personIds, receiptCount: list.length };
}

// Monatsschlüssel eines Bons ('YYYY-MM'); fällt auf createdAt zurück.
export function receiptMonth(receipt) {
  if (/^\d{4}-\d{2}/.test(receipt.date || '')) return receipt.date.slice(0, 7);
  return new Date(receipt.createdAt || Date.now()).toISOString().slice(0, 7);
}
