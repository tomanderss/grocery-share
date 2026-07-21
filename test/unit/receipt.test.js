import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  toCents, formatCents, evenSplit, isEvenSplit, normalizeSplit, splitAmount,
  effectiveItem, receiptSummary, itemsTotal, monthSummary, receiptMonth,
} from '../../js/receipt.js';

const SETTINGS = {
  persons: [{ id: 'p1', name: 'Tom' }, { id: 'p2', name: 'Tara' }],
  categories: [
    { id: 'einkaufen', name: 'Einkaufen' },
    { id: 'getraenke', name: 'Getränke' },
    { id: 'drogerie', name: 'Drogerie' },
    { id: 'sonstiges', name: 'Sonstiges' },
  ],
  depositCategoryId: 'einkaufen',
  defaultCategoryId: 'einkaufen',
};

const item = (over = {}) => ({
  id: 'i1', name: 'Test', qty: 1, priceCents: 100,
  categoryId: 'einkaufen', split: { p1: 50, p2: 50 }, kind: 'normal', ...over,
});

describe('Geld-Helfer', () => {
  test('toCents parst Euro-Zahlen und deutsche Komma-Strings', () => {
    assert.equal(toCents(1.29), 129);
    assert.equal(toCents('1,29'), 129);
    assert.equal(toCents('-0,25'), -25);
    assert.equal(toCents(''), 0);
    assert.equal(toCents('abc'), 0);
    assert.equal(toCents(35), 3500);
  });

  test('formatCents formatiert deutsch, mit Vorzeichen-Option', () => {
    assert.equal(formatCents(129), '1,29 €');
    assert.equal(formatCents(-25), '-0,25 €');
    assert.equal(formatCents(5), '0,05 €');
    assert.equal(formatCents(129, { sign: true }), '+1,29 €');
  });
});

describe('Splits', () => {
  test('evenSplit für zwei Personen ist 50/50', () => {
    assert.deepEqual(evenSplit(['p1', 'p2']), { p1: 50, p2: 50 });
  });

  test('isEvenSplit erkennt exakt gleichmäßige Aufteilung', () => {
    assert.equal(isEvenSplit({ p1: 50, p2: 50 }, ['p1', 'p2']), true);
    assert.equal(isEvenSplit({ p1: 70, p2: 30 }, ['p1', 'p2']), false);
    assert.equal(isEvenSplit({ p1: 100, p2: 0 }, ['p1', 'p2']), false);
    assert.equal(isEvenSplit(null, ['p1', 'p2']), false);
  });

  test('normalizeSplit füllt fehlende Personen und zwingt Summe 100', () => {
    // Fehlende Person bekommt den Rest — nicht die vorhandene aufgerundet
    assert.deepEqual(normalizeSplit({ p1: 70 }, ['p1', 'p2']), { p1: 70, p2: 30 });
    assert.deepEqual(normalizeSplit({ p1: 70, p2: 0 }, ['p1', 'p2']), { p1: 100, p2: 0 });
    assert.deepEqual(normalizeSplit({ p1: 60, p2: 60 }, ['p1', 'p2']), { p1: 40, p2: 60 });
    assert.deepEqual(normalizeSplit({}, ['p1', 'p2']), { p1: 50, p2: 50 });
    assert.deepEqual(normalizeSplit(null, ['p1', 'p2']), { p1: 50, p2: 50 });
  });

  test('splitAmount teilt auf den Cent genau auf', () => {
    assert.deepEqual(splitAmount(100, { p1: 50, p2: 50 }, ['p1', 'p2']), { p1: 50, p2: 50 });
    // 1,01 € 50/50 → Restcent geht deterministisch an die erste Person
    const odd = splitAmount(101, { p1: 50, p2: 50 }, ['p1', 'p2']);
    assert.equal(odd.p1 + odd.p2, 101);
    assert.deepEqual(odd, { p1: 51, p2: 50 });
    // 70/30
    assert.deepEqual(splitAmount(1000, { p1: 70, p2: 30 }, ['p1', 'p2']), { p1: 700, p2: 300 });
    // 100/0
    assert.deepEqual(splitAmount(999, { p1: 100, p2: 0 }, ['p1', 'p2']), { p1: 999, p2: 0 });
  });

  test('splitAmount bleibt bei negativen Beträgen (Pfand-Rückgabe) exakt', () => {
    assert.deepEqual(splitAmount(-2000, { p1: 50, p2: 50 }, ['p1', 'p2']), { p1: -1000, p2: -1000 });
    const odd = splitAmount(-101, { p1: 50, p2: 50 }, ['p1', 'p2']);
    assert.equal(odd.p1 + odd.p2, -101);
  });
});

describe('effectiveItem (Pfand-Zwangsregeln)', () => {
  test('Pfand-Kauf wird 50/50 in die Pfand-Kategorie gezwungen', () => {
    const e = effectiveItem(item({ kind: 'deposit', categoryId: 'getraenke', split: { p1: 100, p2: 0 }, priceCents: 25 }), SETTINGS);
    assert.equal(e.categoryId, 'einkaufen');
    assert.deepEqual(e.split, { p1: 50, p2: 50 });
    assert.equal(e.priceCents, 25);
  });

  test('Pfand-Rückgabe wird negativ gezwungen und 50/50 geteilt', () => {
    const e = effectiveItem(item({ kind: 'deposit_return', priceCents: 2000 }), SETTINGS);
    assert.equal(e.priceCents, -2000);
    assert.deepEqual(e.split, { p1: 50, p2: 50 });
    assert.equal(e.categoryId, 'einkaufen');
  });

  test('normale Positionen behalten Kategorie und Split', () => {
    const e = effectiveItem(item({ categoryId: 'drogerie', split: { p1: 70, p2: 30 } }), SETTINGS);
    assert.equal(e.categoryId, 'drogerie');
    assert.deepEqual(e.split, { p1: 70, p2: 30 });
  });
});

describe('receiptSummary — das Beispiel aus der Spezifikation', () => {
  test('35 € geteilt → 17,50 € pro Person in der teilen-Zeile', () => {
    const r = { items: [item({ priceCents: 3500 })] };
    const s = receiptSummary(r, SETTINGS);
    const row = s.rows.find((x) => x.categoryId === 'einkaufen');
    assert.equal(row.sharedTotal, 3500);
    assert.deepEqual(row.sharedPer, { p1: 1750, p2: 1750 });
    assert.deepEqual(s.personTotals, { p1: 1750, p2: 1750 });
  });

  test('gemischter Bon: einzeln, teilen, 70/30, Pfand und Leergut', () => {
    const r = {
      items: [
        item({ id: 'a', name: 'Brot', priceCents: 300, split: { p1: 50, p2: 50 } }),
        item({ id: 'b', name: 'Toms Chips', priceCents: 200, split: { p1: 100, p2: 0 } }),
        item({ id: 'c', name: 'Taras Saft', priceCents: 400, categoryId: 'getraenke', split: { p1: 0, p2: 100 } }),
        item({ id: 'd', name: 'Wein 70/30', priceCents: 1000, categoryId: 'getraenke', split: { p1: 70, p2: 30 } }),
        item({ id: 'e', name: 'Pfand Dosen', priceCents: 600, kind: 'deposit', split: { p1: 0, p2: 100 } }),
        item({ id: 'f', name: 'Leergut', priceCents: -200, kind: 'deposit_return' }),
      ],
    };
    const s = receiptSummary(r, SETTINGS);
    const eink = s.rows.find((x) => x.categoryId === 'einkaufen');
    const getr = s.rows.find((x) => x.categoryId === 'getraenke');

    // Einkaufen teilen: Brot 300 + Pfand 600 - Leergut 200 = 700 → 350 je Person
    assert.equal(eink.sharedTotal, 700);
    assert.deepEqual(eink.sharedPer, { p1: 350, p2: 350 });
    // Einkaufen einzeln: nur Toms Chips
    assert.deepEqual(eink.single, { p1: 200, p2: 0 });
    // Getränke einzeln: Saft komplett Tara, Wein 70/30 → p1 700, p2 300+400
    assert.deepEqual(getr.single, { p1: 700, p2: 700 });
    assert.equal(getr.sharedTotal, 0);
    // Personensummen decken den Gesamtbetrag exakt ab
    assert.equal(s.grandTotal, 300 + 200 + 400 + 1000 + 600 - 200);
    assert.equal(s.personTotals.p1 + s.personTotals.p2, s.grandTotal);
    assert.deepEqual(s.personTotals, { p1: 350 + 200 + 700, p2: 350 + 700 });
  });

  test('unbekannte Kategorie fällt auf die Standard-Kategorie zurück', () => {
    const r = { items: [item({ categoryId: 'geloescht' })] };
    const s = receiptSummary(r, SETTINGS);
    assert.equal(s.rows.length, 1);
    assert.equal(s.rows[0].categoryId, 'einkaufen');
  });

  test('itemsTotal summiert effektive Positionsbeträge', () => {
    const r = { items: [item({ priceCents: 100 }), item({ id: 'i2', priceCents: 2000, kind: 'deposit_return' })] };
    assert.equal(itemsTotal(r, SETTINGS), 100 - 2000);
  });
});

describe('monthSummary', () => {
  const receipts = [
    { status: 'final', date: '2026-07-03', items: [item({ priceCents: 1000 })] },
    { status: 'final', date: '2026-07-21', items: [item({ priceCents: 500, split: { p1: 100, p2: 0 } })] },
    { status: 'draft', date: '2026-07-10', items: [item({ priceCents: 99999 })] }, // Entwürfe zählen nicht
    { status: 'final', date: '2026-06-30', items: [item({ priceCents: 77777 })] }, // anderer Monat
  ];

  test('aggregiert nur finale Bons des Monats', () => {
    const s = monthSummary(receipts, SETTINGS, '2026-07');
    assert.equal(s.receiptCount, 2);
    assert.equal(s.grandTotal, 1500);
    assert.deepEqual(s.personTotals, { p1: 1000, p2: 500 });
  });

  test('receiptMonth nutzt das Datum, sonst createdAt', () => {
    assert.equal(receiptMonth({ date: '2026-07-21' }), '2026-07');
    assert.equal(receiptMonth({ date: '', createdAt: Date.UTC(2026, 0, 15) }), '2026-01');
  });
});
