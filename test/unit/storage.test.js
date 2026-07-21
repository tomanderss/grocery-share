import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// storage.js importiert debuglog.js (localStorage) — für Node einen Mini-Stub
// bereitstellen, BEVOR das Modul lädt.
globalThis.localStorage = {
  _data: {},
  getItem(k) { return this._data[k] ?? null; },
  setItem(k, v) { this._data[k] = String(v); },
  removeItem(k) { delete this._data[k]; },
};

const { mergeSettings, parseImportData, collectExportData, newId } = await import('../../js/storage.js');
const { DEFAULT_SETTINGS } = await import('../../js/config.js');

describe('mergeSettings', () => {
  test('null → komplette Defaults', () => {
    const s = mergeSettings(null);
    assert.equal(s.model, DEFAULT_SETTINGS.model);
    assert.equal(s.persons.length, 2);
    assert.equal(s.depositCategoryId, 'einkaufen');
  });

  test('gespeicherte Werte gewinnen, neue Felder bekommen Defaults', () => {
    const s = mergeSettings({ apiKey: 'sk-test', persons: [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }] });
    assert.equal(s.apiKey, 'sk-test');
    assert.equal(s.persons[0].name, 'A');
    assert.equal(s.theme, DEFAULT_SETTINGS.theme);
  });

  test('kaputte Personen/Kategorien fallen auf Defaults zurück', () => {
    const s = mergeSettings({ persons: [], categories: 'quatsch' });
    assert.equal(s.persons.length, 2);
    assert.ok(s.categories.length >= 1);
  });

  test('verwaiste Pfand-/Default-Kategorie zeigt auf erste Kategorie', () => {
    const s = mergeSettings({
      categories: [{ id: 'nur-eine', name: 'Nur eine' }],
      depositCategoryId: 'einkaufen',
      defaultCategoryId: 'einkaufen',
    });
    assert.equal(s.depositCategoryId, 'nur-eine');
    assert.equal(s.defaultCategoryId, 'nur-eine');
  });
});

describe('Export / Import', () => {
  test('Roundtrip erhält Bons, Regeln und Einstellungen', () => {
    const settings = mergeSettings({ apiKey: 'sk-x' });
    const receipts = [{ id: 'bon_1', items: [] }];
    const rules = [{ key: 'cola', name: 'Cola', categoryId: 'einkaufen', split: { p1: 50, p2: 50 }, count: 1, updatedAt: 1 }];
    const parsed = parseImportData(JSON.stringify(collectExportData(settings, receipts, rules)));
    assert.equal(parsed.settings.apiKey, 'sk-x');
    assert.equal(parsed.receipts.length, 1);
    assert.equal(parsed.rules.length, 1);
  });

  test('fremdes JSON wird abgelehnt', () => {
    assert.throws(() => parseImportData('{"app":"andere-app"}'), /gültige/);
    assert.throws(() => parseImportData('kein json'));
  });
});

describe('newId', () => {
  test('erzeugt eindeutige, geprefixte IDs', () => {
    const a = newId('bon');
    const b = newId('bon');
    assert.match(a, /^bon_/);
    assert.notEqual(a, b);
  });
});
