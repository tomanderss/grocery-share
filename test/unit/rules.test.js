import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeKey, nameSimilarity, MATCH_THRESHOLD, matchRule,
  splitKeyOf, splitFromKey, normalizeRules, predictRule, ruleDistributionLabel,
  applyRules, learnFromReceipt, rulesForPrompt,
} from '../../js/rules.js';

const PERSONS = [{ id: 'p1', name: 'Tom' }, { id: 'p2', name: 'Tara' }];
const PIDS = ['p1', 'p2'];
const CATS = [{ id: 'einkaufen', name: 'Einkaufen' }, { id: 'getraenke', name: 'Getränke' }];

const receiptWith = (...items) => ({ items });
const item = (name, split, categoryId = 'einkaufen', kind = 'normal') => ({ name, split, categoryId, kind });

describe('normalizeKey', () => {
  test('vereinheitlicht Groß/Klein, Satzzeichen und Whitespace', () => {
    assert.equal(normalizeKey('BIO JOGHURT 3,8%'), 'bio joghurt 3 8');
    assert.equal(normalizeKey('  Bio  Joghurt 3.8% '), 'bio joghurt 3 8');
    assert.equal(normalizeKey(''), '');
    assert.equal(normalizeKey(null), '');
  });
});

describe('unscharfes Matching', () => {
  test('Wortdreher und Varianten liegen über der Schwelle', () => {
    assert.ok(nameSimilarity('Proteinpudding', 'Puddingprotein') >= MATCH_THRESHOLD);
    assert.ok(nameSimilarity('Proteinpudding Schoko', 'PROTEINPUDDING') >= MATCH_THRESHOLD);
    assert.ok(nameSimilarity('Bio-Joghurt 3,8%', 'BIO JOGHURT') >= MATCH_THRESHOLD);
  });

  test('verschiedene Produkte bleiben unter der Schwelle', () => {
    assert.ok(nameSimilarity('Vollmilch', 'Milchreis') < MATCH_THRESHOLD);
    assert.ok(nameSimilarity('Duschgel', 'Zahnpasta') < MATCH_THRESHOLD);
    assert.ok(nameSimilarity('Cola', 'Brot') < MATCH_THRESHOLD);
  });

  test('matchRule: exakt gewinnt, sonst bester Fuzzy-Treffer', () => {
    const rules = [
      { key: 'proteinpudding', name: 'Proteinpudding' },
      { key: 'protein riegel', name: 'Protein Riegel' },
    ];
    assert.equal(matchRule(rules, 'PROTEINPUDDING').key, 'proteinpudding');
    assert.equal(matchRule(rules, 'Puddingprotein 200g')?.key, 'proteinpudding');
    assert.equal(matchRule(rules, 'Katzenstreu'), null);
    assert.equal(matchRule(rules, ''), null);
  });
});

describe('Split-Kodierung', () => {
  test('splitKeyOf: shared / solo / frei', () => {
    assert.equal(splitKeyOf({ p1: 50, p2: 50 }, PIDS), 'shared');
    assert.equal(splitKeyOf({ p1: 100, p2: 0 }, PIDS), 'p1');
    assert.equal(splitKeyOf({ p1: 70, p2: 30 }, PIDS), 'p1=70|p2=30');
  });

  test('splitFromKey ist die Umkehrung', () => {
    assert.deepEqual(splitFromKey('shared', PIDS), { p1: 50, p2: 50 });
    assert.deepEqual(splitFromKey('p2', PIDS), { p1: 0, p2: 100 });
    assert.deepEqual(splitFromKey('p1=70|p2=30', PIDS), { p1: 70, p2: 30 });
  });
});

describe('Statistik: lernen, vorhersagen, begründen', () => {
  test('mehrere Beobachtungen ergeben eine Wahrscheinlichkeits-Vorauswahl', () => {
    let rules = [];
    // 3× nur Tom, 1× geteilt
    for (let i = 0; i < 3; i++) {
      rules = learnFromReceipt(rules, receiptWith(item('Proteinpudding', { p1: 100, p2: 0 })), i, PIDS);
    }
    rules = learnFromReceipt(rules, receiptWith(item('Proteinpudding', { p1: 50, p2: 50 })), 9, PIDS);
    assert.equal(rules.length, 1);
    const pred = predictRule(rules[0], PIDS);
    assert.deepEqual(pred.split, { p1: 100, p2: 0 });
    assert.equal(pred.confidencePct, 75);
    assert.equal(pred.total, 4);
    assert.equal(pred.categoryId, 'einkaufen');
    assert.equal(ruleDistributionLabel(rules[0], PERSONS), '75 % nur Tom · 25 % geteilt (4×)');
  });

  test('ähnliche Schreibweisen schreiben DIESELBE Regel fort (kein Duplikat)', () => {
    let rules = learnFromReceipt([], receiptWith(item('Proteinpudding', { p1: 100, p2: 0 })), 1, PIDS);
    rules = learnFromReceipt(rules, receiptWith(item('PUDDINGPROTEIN 200G', { p1: 100, p2: 0 })), 2, PIDS);
    assert.equal(rules.length, 1);
    assert.equal(rules[0].count, 2);
  });

  test('Pfand wird nie gelernt', () => {
    const rules = learnFromReceipt([], receiptWith(item('PFAND', { p1: 50, p2: 50 }, 'einkaufen', 'deposit')), 1, PIDS);
    assert.equal(rules.length, 0);
  });

  test('Regel-Limit verwirft seltene/alte Regeln zuerst', () => {
    // Bewusst UNÄHNLICHE Namen — ähnliche würden (korrekt) zu einer Regel verschmelzen.
    const names = ['Apfelmus', 'Bananen', 'Waschpulver', 'Zahnbürste', 'Katzenfutter',
      'Olivenöl', 'Räucherlachs', 'Spülschwamm', 'Gurken', 'Erdnussbutter'];
    let rules = [];
    names.forEach((name, i) => {
      rules = learnFromReceipt(rules, receiptWith(item(name, { p1: 50, p2: 50 })), i, PIDS, 5);
    });
    assert.equal(rules.length, 5);
    assert.ok(matchRule(rules, 'Erdnussbutter'));
  });
});

describe('applyRules', () => {
  const rules = [{
    key: 'proteinpudding', name: 'Proteinpudding',
    categoryStats: { einkaufen: 8 },
    splitStats: { p1: 7, shared: 1 },
    count: 8, updatedAt: 1,
  }];

  test('setzt häufigste Zuordnung + ruleInfo als Begründung', () => {
    const out = applyRules([
      { name: 'Puddingprotein', categoryId: 'getraenke', split: { p1: 50, p2: 50 }, kind: 'normal' },
    ], rules, PIDS, PERSONS);
    assert.equal(out[0].categoryId, 'einkaufen');
    assert.deepEqual(out[0].split, { p1: 100, p2: 0 });
    assert.equal(out[0].fromRule, true);
    assert.equal(out[0].ruleInfo.exact, false);
    assert.equal(out[0].ruleInfo.matchedName, 'Proteinpudding');
    assert.equal(out[0].ruleInfo.confidencePct, 88);
    assert.match(out[0].ruleInfo.label, /88 % nur Tom · 13 % geteilt \(8×\)/);
  });

  test('lässt Pfand und Unbekanntes unangetastet', () => {
    const out = applyRules([
      { name: 'PFAND', categoryId: 'getraenke', split: { p1: 100, p2: 0 }, kind: 'deposit' },
      { name: 'Katzenstreu', categoryId: 'einkaufen', split: { p1: 50, p2: 50 }, kind: 'normal' },
    ], rules, PIDS, PERSONS);
    assert.equal(out[0].fromRule, undefined);
    assert.equal(out[1].fromRule, undefined);
  });
});

describe('Migration alter Regeln', () => {
  test('v0.4-Form {split, categoryId, count} wird zur Statistik-Form', () => {
    const old = [{ key: 'cola', name: 'Cola', categoryId: 'getraenke', split: { p1: 100, p2: 0 }, count: 4, updatedAt: 7 }];
    const migrated = normalizeRules(old, PIDS);
    assert.deepEqual(migrated[0].splitStats, { p1: 4 });
    assert.deepEqual(migrated[0].categoryStats, { getraenke: 4 });
    const pred = predictRule(migrated[0], PIDS);
    assert.deepEqual(pred.split, { p1: 100, p2: 0 });
    // neue Form bleibt unverändert
    assert.equal(normalizeRules(migrated, PIDS)[0], migrated[0]);
  });
});

describe('rulesForPrompt', () => {
  test('liefert Zeilen mit Verteilung', () => {
    const rules = learnFromReceipt([], receiptWith(item('Cola Zero', { p1: 100, p2: 0 }, 'getraenke')), 1, PIDS);
    const lines = rulesForPrompt(rules, PERSONS, CATS);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /Cola Zero → Getränke, bisher 100 % nur Tom \(1×\)/);
  });
});
