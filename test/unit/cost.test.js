import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  costUsd, formatCost, formatUsd, totalApiCostUsd, MODEL_PRICES,
  remainingCreditUsd, avgAnalysisCostUsd, estimateReceiptsLeft,
} from '../../js/cost.js';

describe('costUsd', () => {
  test('rechnet mit den Listenpreisen pro 1 Mio Tokens', () => {
    // Opus 4.8: $5 in / $25 out → 2000 in + 1000 out = 0,01 + 0,025 = 0,035 $
    assert.equal(costUsd('claude-opus-4-8', 2000, 1000), 0.035);
    // Haiku: $1 / $5
    assert.equal(costUsd('claude-haiku-4-5', 1000, 1000), 0.000006 * 1000);
  });

  test('matcht auch datierte Modell-IDs per Präfix', () => {
    assert.equal(
      costUsd('claude-haiku-4-5-20251001', 1e6, 0),
      MODEL_PRICES['claude-haiku-4-5'].input
    );
  });

  test('unbekanntes Modell fällt auf Opus-Preise zurück (nie 0 anzeigen)', () => {
    assert.equal(costUsd('claude-zukunft-9', 1e6, 0), 5);
  });

  test('fehlende Tokens → 0', () => {
    assert.equal(costUsd('claude-opus-4-8', 0, 0), 0);
    assert.equal(costUsd('claude-opus-4-8', undefined, undefined), 0);
  });
});

describe('formatCost', () => {
  test('unter 1 $ in Cent, deutsch formatiert', () => {
    assert.equal(formatCost(0.012), '≈ 1,2 ¢');
    assert.equal(formatCost(0.0004), '≈ <0,1 ¢');
  });
  test('ab 1 $ in Dollar', () => {
    assert.equal(formatCost(1.234), '≈ 1,23 $');
  });
  test('0/leer → leerer String', () => {
    assert.equal(formatCost(0), '');
    assert.equal(formatCost(undefined), '');
  });
});

describe('totalApiCostUsd', () => {
  test('summiert nur Bons mit apiCost', () => {
    const receipts = [
      { apiCost: { usd: 0.02 } },
      { apiCost: null },
      {},
      { apiCost: { usd: 0.005 } },
    ];
    assert.equal(totalApiCostUsd(receipts), 0.025);
  });
});

describe('Guthaben-Tracking', () => {
  test('remainingCreditUsd: Anker minus Verbrauch, null ohne Anker', () => {
    assert.equal(remainingCreditUsd({ anchorUsd: 5, spentUsd: 1.25 }), 3.75);
    assert.equal(remainingCreditUsd({ anchorUsd: null, spentUsd: 3 }), null);
    assert.equal(remainingCreditUsd(null), null);
    // kann durch Schätzfehler negativ werden — wird nicht geklemmt
    assert.equal(remainingCreditUsd({ anchorUsd: 1, spentUsd: 1.5 }), -0.5);
  });

  test('formatUsd formatiert deutsch in Dollar', () => {
    assert.equal(formatUsd(4.821), '4,82 $');
    assert.equal(formatUsd(0), '0,00 $');
    assert.equal(formatUsd(-0.5), '-0,50 $');
  });

  test('avgAnalysisCostUsd mittelt die letzten n Analysen (neueste zuerst)', () => {
    const receipts = [
      { createdAt: 1, apiCost: { usd: 0.10 } },  // alt — fällt bei n=2 raus
      { createdAt: 3, apiCost: { usd: 0.02 } },
      { createdAt: 2, apiCost: { usd: 0.04 } },
      { createdAt: 4, apiCost: null },           // manuell erfasst — zählt nicht
      { createdAt: 5 },
    ];
    assert.equal(avgAnalysisCostUsd(receipts, 2), 0.03);
    assert.equal(avgAnalysisCostUsd([], 10), 0);
  });

  test('estimateReceiptsLeft: Restguthaben / Durchschnitt, abgerundet, nie negativ', () => {
    assert.equal(estimateReceiptsLeft(1, 0.03), 33);
    assert.equal(estimateReceiptsLeft(-0.5, 0.03), 0);
    assert.equal(estimateReceiptsLeft(1, 0), null);   // keine Analyse-Basis
    assert.equal(estimateReceiptsLeft(null, 0.03), null); // kein Anker
  });
});
