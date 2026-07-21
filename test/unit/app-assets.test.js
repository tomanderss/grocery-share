import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Struktur-Tests (analog coop-number-sums): Offline-Cache vollständig, Icons
// vorhanden, Konfiguration konsistent.
const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

describe('Service-Worker-Precache', () => {
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');

  test('JEDES js/-Modul steht in der ASSETS-Liste (sonst offline nicht ladbar)', () => {
    const modules = readdirSync(join(root, 'js')).filter((f) => f.endsWith('.js'));
    for (const m of modules) {
      assert.ok(sw.includes(`./js/${m}`), `js/${m} fehlt in sw.js ASSETS`);
    }
  });

  test('Shell, Styles, Manifest und Icons sind im Precache', () => {
    for (const a of ['./index.html', './css/styles.css', './manifest.json', './icons/icon-192.png', './icons/icon-512.png']) {
      assert.ok(sw.includes(a), `${a} fehlt in sw.js ASSETS`);
    }
  });

  test('Cache-Name trägt die aktuelle Version aus .release-counter', () => {
    const version = readFileSync(join(root, '.release-counter'), 'utf8').trim();
    assert.ok(sw.includes(`grocery-share-v${version}`), `sw.js Cache-Name passt nicht zu v${version}`);
  });
});

describe('Icons & Manifest', () => {
  test('generierte Icons existieren', () => {
    for (const f of ['icon-192.png', 'icon-512.png']) {
      assert.ok(existsSync(join(root, 'icons', f)), `icons/${f} fehlt — node create-icons.js ausführen`);
    }
  });

  test('manifest.json ist valide und verweist auf existierende Icons', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
    assert.equal(manifest.name, 'Grocery Share');
    for (const icon of manifest.icons) {
      assert.ok(existsSync(join(root, icon.src)), `${icon.src} fehlt`);
    }
  });
});

describe('Konfiguration', () => {
  test('Default-Kategorien enthalten die Pfand-Kategorie', async () => {
    const { DEFAULT_CATEGORIES, DEPOSIT_CATEGORY_ID, DEFAULT_SETTINGS } = await import('../../js/config.js');
    assert.ok(DEFAULT_CATEGORIES.some((c) => c.id === DEPOSIT_CATEGORY_ID));
    assert.ok(DEFAULT_CATEGORIES.some((c) => c.id === DEFAULT_SETTINGS.defaultCategoryId));
    assert.equal(DEFAULT_SETTINGS.persons.length, 2);
  });

  test('alle Kategorie-Icons existieren im Icon-Set', async () => {
    const { DEFAULT_CATEGORIES } = await import('../../js/config.js');
    const { hasIcon } = await import('../../js/icons.js');
    for (const c of DEFAULT_CATEGORIES) {
      assert.ok(hasIcon(c.icon), `Icon '${c.icon}' (Kategorie ${c.id}) fehlt in icons.js`);
    }
  });
});
