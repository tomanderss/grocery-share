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
    // Personensummen: Tom 4,00 + 4,00 + 7,00 = 15,00 / Tara 4,00 + 3,00 = 7,00
    const foot = table.locator('tfoot td.num');
    await expect(foot.nth(0)).toHaveText('15,00 €');
    await expect(foot.nth(1)).toHaveText('7,00 €');
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
    await expect(page.locator('.item-card .chip-accent')).toContainText('immer 50:50');
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

test.describe('Persistenz', () => {
  test('Bons überleben einen Reload', async ({ page }) => {
    await gotoApp(page);
    await seedReceipt(page, { store: 'ALDI', items: [item({ name: 'Milch', priceCents: 119, priceInput: '1,19' })] });
    await page.reload();
    await page.waitForSelector('.screen.home');
    await expect(page.locator('.receipt-row').first()).toContainText('ALDI');
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
