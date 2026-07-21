import { test, expect } from '@playwright/test';
import { gotoApp, seedReceipt, item } from './helpers.js';

test.describe('Grundgerüst', () => {
  test('App startet, Home zeigt Upload und Kacheln', async ({ page }) => {
    await gotoApp(page);
    await expect(page.locator('.app-title')).toHaveText('Grocery Share');
    await expect(page.locator('.upload-btn')).toContainText('Bon fotografieren');
    await expect(page.locator('.tile').first()).toContainText('Monats');
  });

  test('Einstellungen: Personen umbenennen wirkt sofort', async ({ page }) => {
    await gotoApp(page);
    await page.locator('.home-head .iconbtn').click();
    await page.locator('.acc-head', { hasText: 'Personen' }).click();
    const input = page.locator('.acc-body input').first();
    await input.fill('Thomas');
    await input.blur();
    await page.locator('.topbar .iconbtn').click(); // zurück
    await expect(page.locator('.app-sub')).toContainText('Thomas');
  });
});

test.describe('Bon-Workflow (manuell)', () => {
  test('Bon anlegen, Positionen zuordnen, abschließen → korrekte Tabelle', async ({ page }) => {
    await gotoApp(page);
    await seedReceipt(page, {
      store: 'REWE', date: '2026-07-20', totalCents: 2200,
      items: [
        item({ name: 'Brot', priceCents: 300, priceInput: '3,00' }),
        item({ name: 'Chips', priceCents: 400, priceInput: '4,00', split: { p1: 100, p2: 0 } }),
        item({ name: 'Wein', priceCents: 1000, priceInput: '10,00', categoryId: 'getraenke', split: { p1: 70, p2: 30 } }),
        item({ name: 'Pfand', priceCents: 500, priceInput: '5,00', kind: 'deposit' }),
      ],
    });

    // Plausibilitätsprüfung: Positionen == Bon-Gesamtbetrag
    await expect(page.locator('.meta-check')).toContainText('stimmen');

    await page.locator('.review-actions .btn-primary').click();
    await page.waitForSelector('.screen.summary');

    const table = page.locator('.sum-table');
    // Einkaufen teilen: Brot 3,00 + Pfand 5,00 = 8,00 → 4,00 je Person
    await expect(table).toContainText('Einkaufen teilen');
    // Einzeln-Zeilen vorhanden
    await expect(table).toContainText('Einkaufen einzeln');
    await expect(table).toContainText('Getränke einzeln');
    // Zwischensummen je Kategorie
    await expect(table).toContainText('Einkaufen gesamt');
    await expect(table).toContainText('Getränke gesamt');
    // Personensummen: Tom 4,00 + 4,00 + 7,00 = 15,00 / Tara 4,00 + 3,00 = 7,00
    const foot = table.locator('tfoot td.num');
    await expect(foot.nth(0)).toHaveText('15,00 €');
    await expect(foot.nth(1)).toHaveText('7,00 €');

    // Bearbeiten eines ausgewerteten Bons = kostenloses lokales Speichern
    await page.locator('.sum-actions .btn', { hasText: 'Bearbeiten' }).click();
    await page.waitForSelector('.screen.review');
    await expect(page.locator('.review-actions .btn-primary')).toContainText('Änderungen speichern');
    await expect(page.locator('.save-hint')).toContainText('kostenlos');
    await expect(page.locator('.reanalyze')).toContainText('kostenpflichtig');
    await page.locator('.review-actions .btn-primary').click();
    await page.waitForSelector('.screen.summary');
  });

  test('Sonstiges listet die Artikelnamen, Rabatt und Regel-Begründung sichtbar', async ({ page }) => {
    await gotoApp(page);
    await seedReceipt(page, {
      store: 'REWE',
      items: [
        item({ name: 'Blumenstrauß', priceCents: 499, priceInput: '4,99', categoryId: 'sonstiges', split: { p1: 100, p2: 0 } }),
        item({
          name: 'Booster', priceCents: 39, priceInput: '0,39', discountCents: 10,
          ruleInfo: { matchedName: 'Booster Drink', exact: false, confidencePct: 81, label: '81 % nur Tom · 19 % geteilt (16×)' },
          fromRule: true, split: { p1: 100, p2: 0 },
        }),
      ],
    });
    // Review: Rabatt-Chip + Regel-Begründung
    await expect(page.locator('.chip-good', { hasText: 'Rabatt' })).toContainText('inkl. 0,10 € Rabatt');
    await expect(page.locator('.rule-hint')).toContainText('81 % nur Tom');
    await expect(page.locator('.rule-hint')).toContainText('erkannt als „Booster Drink“');
    // Auswertung: Sonstiges mit Artikelnamen in Klammern
    await page.locator('.review-actions .btn-primary').click();
    await page.waitForSelector('.screen.summary');
    await expect(page.locator('.sum-table')).toContainText('Sonstiges gesamt');
    await expect(page.locator('.cat-items')).toContainText('Blumenstrauß');
  });

  test('Verwerfen stellt den Bon beim Bearbeiten unverändert wieder her', async ({ page }) => {
    await gotoApp(page);
    await seedReceipt(page, {
      store: 'REWE',
      items: [item({ name: 'Brot', priceCents: 300, priceInput: '3,00' })],
    });
    await page.locator('.review-actions .btn-primary').click();
    await page.waitForSelector('.screen.summary');

    // Bearbeiten öffnen: Verwerfen stellt hier den alten Stand wieder her
    await page.locator('.sum-actions .btn', { hasText: 'Bearbeiten' }).click();
    await page.waitForSelector('.screen.review');
    const discard = page.locator('.review-actions .btn', { hasText: 'Verwerfen' });
    await expect(discard).toBeVisible();

    // Preis ändern, dann verwerfen (mit Bestätigung)
    await page.locator('.item-price').first().fill('9,99');
    await page.locator('.item-price').first().dispatchEvent('change');
    await discard.click();
    await page.locator('.modal .btn-danger').click();

    // Zurück in der Auswertung mit dem ALTEN Stand, Bon wieder final
    await page.waitForSelector('.screen.summary');
    await expect(page.locator('.sum-total')).toHaveText('3,00 €');
    const status = await page.evaluate(() => {
      const r = window.__gs.state.receipts[0];
      return { status: r.status, backup: 'editBackup' in r };
    });
    expect(status).toEqual({ status: 'final', backup: false });
  });

  test('Verwerfen bei neuem Entwurf löscht ihn (Löschen-Button gibt es dort nicht)', async ({ page }) => {
    await gotoApp(page);
    await seedReceipt(page, {
      store: 'REWE',
      items: [item({ name: 'Brot', priceCents: 300, priceInput: '3,00' })],
    });
    // Entwurf: Verwerfen sichtbar, separates Löschen nicht (wäre identisch)
    await expect(page.locator('.review-actions .btn', { hasText: 'Verwerfen' })).toBeVisible();
    await expect(page.locator('.review-actions .btn', { hasText: 'Löschen' })).toHaveCount(0);

    await page.locator('.review-actions .btn', { hasText: 'Verwerfen' }).click();
    await page.locator('.modal .btn-danger').click();
    await page.waitForSelector('.screen.home');
    const count = await page.evaluate(() => window.__gs.state.receipts.length);
    expect(count).toBe(0);
  });

  test('Differenz-Warnung bei abweichendem Gesamtbetrag', async ({ page }) => {
    await gotoApp(page);
    await seedReceipt(page, {
      store: 'EDEKA', totalCents: 999,
      items: [item({ name: 'Brot', priceCents: 300, priceInput: '3,00' })],
    });
    await expect(page.locator('.meta-check')).toContainText('Differenz');
  });

  test('Pfand-Position zeigt Zwangsregel-Hinweis', async ({ page }) => {
    await gotoApp(page);
    await seedReceipt(page, {
      store: 'REWE',
      items: [item({ name: 'PFAND', priceCents: 25, priceInput: '0,25', kind: 'deposit' })],
    });
    await expect(page.locator('.item-card .chip-accent')).toContainText('immer gleichmäßig');
  });
});

test.describe('Lernen & Monatsübersicht', () => {
  test('Abschließen lernt Regeln; Monatsübersicht aggregiert finale Bons', async ({ page }) => {
    await gotoApp(page);
    await seedReceipt(page, {
      store: 'Rossmann', date: new Date().toISOString().slice(0, 10),
      items: [item({ name: 'Duschgel', priceCents: 250, priceInput: '2,50', categoryId: 'drogerie', split: { p1: 0, p2: 100 } })],
    });
    await page.locator('.review-actions .btn-primary').click();
    await page.waitForSelector('.screen.summary');

    // Regel wurde gelernt
    const ruleCount = await page.evaluate(() => window.__gs.state.rules.length);
    expect(ruleCount).toBe(1);

    // Monatsübersicht zeigt den Bon
    await page.locator('.screen.summary .btn-primary').click();
    await page.locator('.tile', { hasText: 'Monats' }).click();
    await page.waitForSelector('.screen.month');
    await expect(page.locator('.screen.month .sum-table')).toContainText('Drogerie');
    await expect(page.locator('.screen.month')).toContainText('1 abgeschlossene');
  });
});

test.describe('Mehrere Personen', () => {
  test('dritte Person: Split-Buttons, Slider-Editor und Tabellenspalte', async ({ page }) => {
    await gotoApp(page);
    // Lisa in den Einstellungen anlegen
    await page.locator('.home-head .iconbtn').click();
    await page.locator('.acc-head', { hasText: 'Personen' }).click();
    await page.locator('.acc-body input[placeholder="Neue Person …"]').fill('Lisa');
    await page.locator('.acc-body .iconbtn.accent').click();
    await page.locator('.topbar .iconbtn').click();
    await expect(page.locator('.app-sub')).toContainText('Lisa');

    // Bon: Split-Buttons zeigen alle drei Personen + teilen + %
    await seedReceipt(page, {
      store: 'REWE',
      items: [item({ name: 'Pizza', priceCents: 900, priceInput: '9,00', split: { p1: 34, p2: 33 } })],
    });
    const btns = page.locator('.split-btns button');
    await expect(btns).toHaveCount(5);
    await expect(btns.nth(2)).toHaveText('Lisa');
    await expect(btns.nth(3)).toHaveText('teilen');

    // %-Editor hat einen Slider je Person; bewegt man einen, gleichen sich die
    // übrigen sofort SICHTBAR ab (Summe immer 100)
    await btns.nth(4).click();
    await expect(page.locator('.split-slider-row')).toHaveCount(3);
    await page.locator('.split-slider-row input').first().evaluate((el) => {
      el.value = '20';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('.split-slider-row .ssr-head b').first()).toHaveText('20 %');
    const sliderVals = await page.locator('.split-slider-row input').evaluateAll((els) => els.map((el) => Number(el.value)));
    expect(sliderVals[0]).toBe(20);
    expect(sliderVals[1] + sliderVals[2]).toBe(80);

    // Schloss: gesperrter Wert bleibt stehen, der Slider ist deaktiviert
    await page.locator('.ssr-lock').nth(1).click();
    await expect(page.locator('.split-slider-row input').nth(1)).toBeDisabled();
    const lockedVal = await page.locator('.split-slider-row input').nth(1).evaluate((el) => Number(el.value));
    await page.locator('.split-slider-row input').first().evaluate((el) => {
      el.value = '5';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('.split-slider-row .ssr-head b').first()).toHaveText('5 %');
    const afterLock = await page.locator('.split-slider-row input').evaluateAll((els) => els.map((el) => Number(el.value)));
    expect(afterLock[1]).toBe(lockedVal);
    expect(afterLock[0] + afterLock[1] + afterLock[2]).toBe(100);
    await page.locator('.ssr-lock').nth(1).click(); // wieder entsperren
    await page.locator('.modal .btn-primary').click();

    // Auswertung hat drei Personen-Spalten
    await page.locator('.review-actions .btn-primary').click();
    await page.waitForSelector('.screen.summary');
    await expect(page.locator('.sum-table thead th')).toHaveCount(4);
    await expect(page.locator('.sum-table thead')).toContainText('Lisa');
  });
});

test.describe('Original-Dateien', () => {
  const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  test('gespeicherte Bon-Fotos lassen sich im Review und in der Auswertung ansehen', async ({ page }) => {
    await gotoApp(page);
    await seedReceipt(page, {
      store: 'REWE',
      items: [item({ name: 'Brot', priceCents: 300, priceInput: '3,00' })],
    });
    // Foto per Debug-Hook anhängen (wie nach einer echten Analyse)
    await page.evaluate(async (png) => {
      const r = window.__gs.state.receipts.find((x) => x.id === window.__gs.state.currentId);
      await window.__gs.attachments.saveAttachments(r.id, [{ base64: png, mediaType: 'image/png' }]);
      r.attachmentCount = 1;
    }, TINY_PNG);

    // Review: Original-Button öffnet den Viewer mit dem Bild
    await page.locator('.review-meta .btn', { hasText: 'Original ansehen' }).click();
    await expect(page.locator('.viewer-modal img')).toBeVisible();
    await page.locator('.viewer-head .iconbtn').click();

    // Auswertung: Original-Button ebenfalls vorhanden
    await page.locator('.review-actions .btn-primary').click();
    await page.waitForSelector('.screen.summary');
    await page.locator('.sum-actions .btn', { hasText: 'Original' }).click();
    await expect(page.locator('.viewer-modal img')).toBeVisible();
  });
});

test.describe('Persistenz', () => {
  test('Bons überleben einen Reload', async ({ page }) => {
    await gotoApp(page);
    await seedReceipt(page, { store: 'ALDI', items: [item({ name: 'Milch', priceCents: 119, priceInput: '1,19' })] });
    await page.reload();
    await page.waitForSelector('.screen.home');
    await expect(page.locator('.receipt-row').first()).toContainText('ALDI');
  });
});

test.describe('Guthaben', () => {
  test('Guthaben setzen zeigt Karte mit Bon-Schätzung auf der Startseite', async ({ page }) => {
    await gotoApp(page);
    // Zwei analysierte Bons als Schätz-Basis (Ø 0,03 $) seeden
    await seedReceipt(page, { store: 'A', apiCost: { usd: 0.02, model: 'claude-opus-4-8', inputTokens: 1, outputTokens: 1 }, items: [item()] });
    await page.evaluate(() => { window.__gs.state.screen = 'home'; });
    await seedReceipt(page, { store: 'B', apiCost: { usd: 0.04, model: 'claude-opus-4-8', inputTokens: 1, outputTokens: 1 }, items: [item()] });
    await page.evaluate(() => { window.__gs.state.screen = 'home'; });
    // Guthaben über die Einstellungen setzen
    await page.locator('.home-head .iconbtn').click();
    await page.locator('.acc-head', { hasText: 'Claude-KI' }).click();
    await page.locator('.credit-block input').fill('3');
    await page.locator('.credit-block .btn', { hasText: 'Setzen' }).click();
    await page.locator('.topbar .iconbtn').click();
    // Karte: 3 $ Rest, Ø 0,03 $ → ca. 100 Bons
    const card = page.locator('.credit-card');
    await expect(card).toContainText('Guthaben ≈ 3,00 $');
    await expect(card).toContainText('ca. 100 Bons');
    // Überlebt Reload (persistiert)
    await page.reload();
    await page.waitForSelector('.screen.home');
    await expect(page.locator('.credit-card')).toContainText('3,00 $');
  });
});

test.describe('KI-Kosten', () => {
  test('gespeicherte API-Kosten erscheinen in Bon-Liste und Auswertung', async ({ page }) => {
    await gotoApp(page);
    await seedReceipt(page, {
      store: 'REWE',
      apiCost: { usd: 0.012, model: 'claude-opus-4-8', inputTokens: 2000, outputTokens: 80 },
      items: [item({ name: 'Brot', priceCents: 300, priceInput: '3,00' })],
    });
    // Auswertung zeigt Kosten + Tokens
    await page.locator('.review-actions .btn-primary').click();
    await page.waitForSelector('.screen.summary');
    await expect(page.locator('.sum-api')).toContainText('KI-Analyse: ≈ 1,2 ¢');
    await expect(page.locator('.sum-api')).toContainText('Tokens');
    // Bon-Liste auf Home zeigt Kosten
    await page.locator('.screen.summary .btn-primary').click();
    await expect(page.locator('.receipt-row .rr-api').first()).toContainText('KI ≈ 1,2 ¢');
  });
});
