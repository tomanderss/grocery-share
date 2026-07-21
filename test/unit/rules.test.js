import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeKey, matchRule, applyRules, learnFromReceipt, rulesForPrompt } from '../../js/rules.js';

const PERSONS = [{ id: 'p1', name: 'Tom' }, { id: 'p2', name: 'Tara' }];
const CATS = [{ id: 'einkaufen', name: 'Einkaufen' }, { id: 'getraenke', name: 'Getränke' }];

describe('normalizeKey', () => {
  test('vereinheitlicht Groß/Klein, Satzzeichen und Whitespace', () => {
    assert.equal(normalizeKey('BIO JOGHURT 3,8%'), 'bio joghurt 3 8');
    assert.equal(normalizeKey('  Bio  Joghurt 3.8% '), 'bio joghurt 3 8');
    assert.equal(normalizeKey(''), '');
    assert.equal(normalizeKey(null), '');
  });
});

describe('learnFromReceipt / matchRule / applyRules', () => {
  const receipt = {
    items: [
      { name: 'Milka Schoko', categoryId: 'einkaufen', split: { p1: 0, p2: 100 }, kind: 'normal' },
      { name: 'Cola Zero', categoryId: 'getraenke', split: { p1: 100, p2: 0 }, kind: 'normal' },
      { name: 'PFAND', categoryId: 'einkaufen', split: { p1: 50, p2: 50 }, kind: 'deposit' },
    ],
  };

  test('lernt Nicht-Pfand-Positionen als Regeln', () => {
    const rules = learnFromReceipt([], receipt, 1000);
    assert.equal(rules.length, 2); // Pfand wird nicht gelernt
    const milka = matchRule(rules, 'MILKA schoko');
    assert.deepEqual(milka.split, { p1: 0, p2: 100 });
    assert.equal(milka.categoryId, 'einkaufen');
    assert.equal(milka.count, 1);
  });

  test('erneutes Lernen aktualisiert die Regel und zählt hoch', () => {
    let rules = learnFromReceipt([], receipt, 1000);
    const updated = {
      items: [{ name: 'Milka Schoko', categoryId: 'einkaufen', split: { p1: 50, p2: 50 }, kind: 'normal' }],
    };
    rules = learnFromReceipt(rules, updated, 2000);
    const milka = matchRule(rules, 'Milka Schoko');
    assert.deepEqual(milka.split, { p1: 50, p2: 50 });
    assert.equal(milka.count, 2);
    assert.equal(rules.length, 2);
  });

  test('applyRules überschreibt KI-Vorschläge, lässt Pfand unangetastet', () => {
    const rules = learnFromReceipt([], receipt, 1000);
    const fresh = [
      { name: 'milka schoko', categoryId: 'getraenke', split: { p1: 50, p2: 50 }, kind: 'normal' },
      { name: 'PFAND', categoryId: 'getraenke', split: { p1: 100, p2: 0 }, kind: 'deposit' },
      { name: 'Neues Produkt', categoryId: 'einkaufen', split: { p1: 50, p2: 50 }, kind: 'normal' },
    ];
    const out = applyRules(fresh, rules);
    assert.equal(out[0].categoryId, 'einkaufen');
    assert.deepEqual(out[0].split, { p1: 0, p2: 100 });
    assert.equal(out[0].fromRule, true);
    // Pfand bleibt wie es war (Zwangsregeln greifen später in receipt.js)
    assert.equal(out[1].categoryId, 'getraenke');
    assert.equal(out[1].fromRule, undefined);
    // Unbekanntes bleibt beim Vorschlag
    assert.equal(out[2].fromRule, undefined);
  });

  test('Regel-Limit verwirft seltene/alte Regeln zuerst', () => {
    let rules = [];
    for (let i = 0; i < 10; i++) {
      rules = learnFromReceipt(rules, { items: [{ name: `Produkt ${i}`, categoryId: 'einkaufen', split: { p1: 50, p2: 50 }, kind: 'normal' }] }, i, 5);
    }
    assert.equal(rules.length, 5);
    // Die zuletzt gelernten überleben
    assert.ok(matchRule(rules, 'Produkt 9'));
    assert.equal(matchRule(rules, 'Produkt 0'), null);
  });
});

describe('rulesForPrompt', () => {
  test('liefert kompakte, menschenlesbare Zeilen', () => {
    const rules = learnFromReceipt([], {
      items: [{ name: 'Cola Zero', categoryId: 'getraenke', split: { p1: 100, p2: 0 }, kind: 'normal' }],
    }, 1000);
    const lines = rulesForPrompt(rules, PERSONS, CATS);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /Cola Zero → Getränke, Tom 100%/);
  });
});
