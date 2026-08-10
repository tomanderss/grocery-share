import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  costUsd, formatCost, formatUsd, totalApiCostUsd, MODEL_PRICES,
  remainingCreditUsd, avgAnalysisCostUsd, estimateReceiptsLeft,
  reconcileCredit, calibratedUsd, costFactor,
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

describe('Guthaben manuell korrigieren', () => {
  test('costFactor: Default 1, ungültige Werte fallen darauf zurück', () => {
    assert.equal(costFactor(null), 1);
    assert.equal(costFactor({}), 1);
    assert.equal(costFactor({ costFactor: 0 }), 1);
    assert.equal(costFactor({ costFactor: -2 }), 1);
    assert.equal(costFactor({ costFactor: 1.5 }), 1.5);
  });

  test('remainingCreditUsd rechnet den Kalibrierfaktor mit ein', () => {
    assert.equal(remainingCreditUsd({ anchorUsd: 5, spentUsd: 1, costFactor: 2 }), 3);
    assert.equal(calibratedUsd(0.04, { costFactor: 1.5 }), 0.06);
    assert.equal(calibratedUsd(0.04, null), 0.04);
  });

  test('Korrektur führt exakt auf den eingetragenen Stand zurück', () => {
    // Anker 5 $, laut Listenpreisen 1 $ verbraucht — echt sind aber nur noch 3 $ da
    const credit = { anchorUsd: 5, anchorAt: 1, spentUsd: 1, costFactor: 1 };
    const res = reconcileCredit(credit, 3, 42);
    assert.equal(res.mode, 'factor');
    assert.equal(res.factor, 2);                       // doppelt so teuer wie geschätzt
    assert.equal(remainingCreditUsd(res.credit), 3);   // exakt der eingetragene Wert
    assert.equal(res.credit.spentUsd, 1);              // Rohwert bleibt erhalten
    assert.equal(res.credit.correctedAt, 42);
    // alte Bons werden mit demselben Faktor nachgerechnet
    assert.equal(calibratedUsd(0.05, res.credit), 0.1);
  });

  test('mehrfaches Korrigieren kompoundiert nicht (Rohwerte bleiben Basis)', () => {
    let credit = { anchorUsd: 5, anchorAt: 1, spentUsd: 1, costFactor: 1 };
    credit = reconcileCredit(credit, 3, 2).credit;     // Faktor 2
    credit = reconcileCredit(credit, 4.5, 3).credit;   // jetzt: echt 0,50 verbraucht
    assert.equal(credit.costFactor, 0.5);              // aus dem ROHwert 1, nicht aus 2
    assert.equal(remainingCreditUsd(credit), 4.5);
  });

  test('Aufladung oder nichts verbraucht → Anker neu setzen statt Faktor', () => {
    // Guthaben gestiegen (aufgeladen)
    const up = reconcileCredit({ anchorUsd: 5, spentUsd: 1, costFactor: 1 }, 20, 7);
    assert.equal(up.mode, 'anchor');
    assert.equal(up.credit.anchorUsd, 20);
    assert.equal(up.credit.spentUsd, 0);
    assert.equal(remainingCreditUsd(up.credit), 20);
    // noch nichts verbraucht → nichts nachzurechnen
    const fresh = reconcileCredit({ anchorUsd: 5, spentUsd: 0, costFactor: 1 }, 4, 7);
    assert.equal(fresh.mode, 'anchor');
    assert.equal(remainingCreditUsd(fresh.credit), 4);
    // gar kein Anker gesetzt
    assert.equal(reconcileCredit(null, 10, 7).mode, 'anchor');
  });

  test('unsinnige Eingabe wird abgelehnt', () => {
    assert.equal(reconcileCredit({ anchorUsd: 5, spentUsd: 1 }, 'quatsch'), null);
    assert.equal(reconcileCredit({ anchorUsd: 5, spentUsd: 1 }, NaN), null);
  });
});
