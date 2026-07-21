// Shared helpers für die Playwright-E2E-Suite. Die App exponiert auf
// localhost/127.0.0.1 den Debug-Hook window.__gs = { state, newDraft, ... }
// (js/app.js), sodass Tests den vollen Vue-State treiben können.

export async function gotoApp(page) {
  await page.goto('/');
  await page.waitForSelector('#splash', { state: 'detached', timeout: 10000 });
  // Nach einem Versionssprung liegt das „Was ist neu"-Modal über Home.
  const modal = page.locator('.modal-bg .btn-primary');
  if (await modal.isVisible().catch(() => false)) await modal.click();
  await page.waitForSelector('.screen.home');
  await page.waitForFunction(() => !!window.__gs);
}

// Legt per Debug-Hook einen Bon mit Positionen an und öffnet ihn im Review.
export async function seedReceipt(page, receipt) {
  await page.evaluate((r) => {
    const draft = window.__gs.newDraft(r);
    window.__gs.state.currentId = draft.id;
    window.__gs.state.screen = 'review';
  }, receipt);
  await page.waitForSelector('.screen.review');
}

export const item = (over = {}) => ({
  id: `pos_${Math.random().toString(36).slice(2, 8)}`,
  name: 'Testartikel', qty: 1, priceCents: 100, priceInput: '1,00',
  categoryId: 'einkaufen', split: { p1: 50, p2: 50 }, kind: 'normal',
  needsReview: false, ...over,
});
