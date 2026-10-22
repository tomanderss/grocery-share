import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { usableModels, sortModels, mergeModels, catalogIsFresh, MODELS_TTL_MS } from '../../js/models.js';

const api = (over = {}) => ({
  type: 'model',
  id: 'claude-opus-5-5',
  display_name: 'Claude Opus 5.5',
  line: 'opus',
  lifecycle: 'active',
  created_at: '2026-09-21T00:00:00Z',
  capabilities: { image_input: { supported: true }, pdf_input: { supported: true } },
  ...over,
});

const BUILTIN = [
  { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', line: 'opus' },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', line: 'haiku' },
];

describe('Modell-Katalog aus der API', () => {
  test('nimmt nur Modelle, die einen Bon überhaupt lesen können', () => {
    const out = usableModels([
      api(),
      api({ id: 'nur-text', capabilities: { image_input: { supported: false }, pdf_input: { supported: true } } }),
      api({ id: 'kein-pdf', capabilities: { image_input: { supported: true }, pdf_input: { supported: false } } }),
      api({ id: 'alt', lifecycle: 'retired' }),
      api({ id: '' }),
      null,
    ]);
    assert.deepEqual(out.map((m) => m.id), ['claude-opus-5-5']);
    assert.deepEqual(out[0], {
      id: 'claude-opus-5-5', name: 'Claude Opus 5.5', line: 'opus',
      createdAt: '2026-09-21T00:00:00Z', deprecated: false,
    });
  });

  test('veraltete Modelle bleiben wählbar, rutschen aber nach hinten', () => {
    const out = sortModels(usableModels([
      api({ id: 'neu', created_at: '2026-09-01T00:00:00Z' }),
      api({ id: 'alt-aber-neuer', created_at: '2026-10-01T00:00:00Z', lifecycle: 'deprecated' }),
      api({ id: 'neuer', created_at: '2026-09-30T00:00:00Z' }),
    ]));
    assert.deepEqual(out.map((m) => m.id), ['neuer', 'neu', 'alt-aber-neuer']);
    assert.equal(out[2].deprecated, true);
  });

  test('kaputte oder leere Antwort fällt sauber auf die eingebaute Liste zurück', () => {
    assert.deepEqual(usableModels(null), []);
    assert.deepEqual(usableModels('quatsch'), []);
    assert.deepEqual(mergeModels(BUILTIN, null).map((m) => m.id), ['claude-opus-4-8', 'claude-haiku-4-5']);
  });

  test('mergeModels: Katalog gewinnt, eingebaute Extras bleiben erhalten', () => {
    const out = mergeModels(BUILTIN, [api(), api({ id: 'claude-opus-4-8', display_name: 'Claude Opus 4.8 (API)' })]);
    assert.deepEqual(out.map((m) => m.id), ['claude-opus-5-5', 'claude-opus-4-8', 'claude-haiku-4-5']);
    assert.equal(out[1].name, 'Claude Opus 4.8 (API)');  // Name aus dem Katalog
    assert.equal(out[2].name, 'Claude Haiku 4.5');       // nur eingebaut, bleibt drin
  });

  test('catalogIsFresh: einen Tag gültig', () => {
    const now = 1_000_000_000;
    assert.equal(catalogIsFresh({ fetchedAt: now - 1000 }, now), true);
    assert.equal(catalogIsFresh({ fetchedAt: now - MODELS_TTL_MS - 1 }, now), false);
    assert.equal(catalogIsFresh(null, now), false);
    assert.equal(catalogIsFresh({}, now), false);
  });
});
