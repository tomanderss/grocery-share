// app.js — die Vue-3-App (ein großes reactive state, Screens: home, review,
// summary, month, chat, settings). Architektur wie coop-number-sums: kein
// Bundler, ESM direkt im Browser, Template als String.

import { createApp, reactive, computed } from './vue.esm-browser.prod.js';
import { CLAUDE_MODELS, CHAT_HISTORY_LIMIT } from './config.js';
import {
  loadSettings, saveSettings, loadReceipts, saveReceipts, loadRules, saveRules,
  loadChat, saveChat, collectExportData, parseImportData, applyImport, newId,
} from './storage.js';
import {
  formatCents, toCents, evenSplit, normalizeSplit, isEvenSplit,
  receiptSummary, monthSummary, itemsTotal, receiptMonth,
} from './receipt.js';
import { applyRules, learnFromReceipt, rulesForPrompt, matchRule, normalizeKey } from './rules.js';
import { analyzeReceipt, assistantChat } from './claude.js';
import { icon } from './icons.js';
import { log, exportLogText, clearLog } from './debuglog.js';
import { BUILD, CHANGELOG } from './buildinfo.js';

// ── Globale Fehlerdiagnose ────────────────────────────────────────────────────
window.addEventListener('error', (e) => log('error', e.message, { src: e.filename, line: e.lineno }));
window.addEventListener('unhandledrejection', (e) => log('error', `unhandled: ${e.reason?.message || e.reason}`));

const state = reactive({
  screen: 'home',
  settings: loadSettings(),
  receipts: loadReceipts(),
  rules: loadRules(),
  chat: loadChat(),
  build: BUILD,
  changelog: CHANGELOG,
  monthKey: new Date().toISOString().slice(0, 7),
  currentId: null,
  analyzing: false,
  analyzeError: '',
  chatInput: '',
  chatBusy: false,
  listening: false,
  toast: null,
  confirmDialog: null,   // { text, onYes }
  splitEditor: null,     // { itemId, p1pct }
  whatsNewOpen: false,
  updateReady: false,
  settingsOpen: { ki: false, personen: false, kategorien: false, regeln: false, daten: false, info: false },
  newCategoryName: '',
});

// ── Persistenz (automatisch bei Änderung) ────────────────────────────────────
function persistReceipts() { saveReceipts(state.receipts); }
function persistSettings() { saveSettings(JSON.parse(JSON.stringify(state.settings))); }
function persistRules() { saveRules(state.rules); }

// ── Helfer ────────────────────────────────────────────────────────────────────
const personIds = () => state.settings.persons.map((p) => p.id);
const personName = (pid) => state.settings.persons.find((p) => p.id === pid)?.name || pid;
const categoryName = (cid) => state.settings.categories.find((c) => c.id === cid)?.name || cid;
const fmt = (c, opts) => formatCents(c, opts);

function toast(text, kind = 'ok') {
  state.toast = { text, kind };
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { state.toast = null; }, 3200);
}

function confirmAction(text, onYes) { state.confirmDialog = { text, onYes }; }

function applyTheme() {
  document.documentElement.dataset.theme = state.settings.theme;
}

// ── Bons ──────────────────────────────────────────────────────────────────────
function currentReceipt() {
  return state.receipts.find((r) => r.id === state.currentId) || null;
}

function newDraft({ store = '', date = '', totalCents = 0, items = [], notes = '' } = {}) {
  const r = {
    id: newId('bon'),
    store,
    date: date || new Date().toISOString().slice(0, 10),
    createdAt: Date.now(),
    status: 'draft',
    totalCents,
    notes,
    items,
  };
  state.receipts.unshift(r);
  persistReceipts();
  return r;
}

function addManualReceipt() {
  const r = newDraft({});
  state.currentId = r.id;
  state.screen = 'review';
  addItem();
}

function addItem() {
  const r = currentReceipt();
  if (!r) return;
  r.items.push({
    id: newId('pos'),
    name: '',
    qty: 1,
    priceCents: 0,
    priceInput: '',
    categoryId: state.settings.defaultCategoryId,
    split: evenSplit(personIds()),
    kind: 'normal',
    needsReview: false,
  });
  persistReceipts();
}

function removeItem(item) {
  const r = currentReceipt();
  if (!r) return;
  r.items = r.items.filter((i) => i.id !== item.id);
  persistReceipts();
}

function deleteReceipt(r) {
  confirmAction(`Bon „${r.store || 'ohne Namen'}“ vom ${formatDate(r.date)} wirklich löschen?`, () => {
    state.receipts = state.receipts.filter((x) => x.id !== r.id);
    if (state.currentId === r.id) { state.currentId = null; state.screen = 'home'; }
    persistReceipts();
    toast('Bon gelöscht');
  });
}

function openReceipt(r) {
  state.currentId = r.id;
  state.screen = r.status === 'final' ? 'summary' : 'review';
}

function finalizeReceipt() {
  const r = currentReceipt();
  if (!r) return;
  r.items = r.items.filter((i) => (i.name || '').trim() || i.priceCents);
  r.items.forEach((i) => {
    i.split = normalizeSplit(i.split, personIds());
    i.needsReview = false;
  });
  r.status = 'final';
  if (state.settings.learningEnabled) {
    state.rules = learnFromReceipt(state.rules, r, Date.now());
    persistRules();
  }
  persistReceipts();
  log('bon', 'finalized', { items: r.items.length, store: r.store });
  state.screen = 'summary';
  toast('Bon abgeschlossen — Zuordnungen gelernt');
}

function reopenReceipt() {
  const r = currentReceipt();
  if (!r) return;
  r.status = 'draft';
  persistReceipts();
  state.screen = 'review';
}

// Preis-Eingabe: die UI hält den Rohtext (priceInput), Cents werden daraus geparst.
function onPriceInput(item) {
  item.priceCents = toCents(item.priceInput);
  persistReceipts();
}
function onTotalInput(r, ev) {
  r.totalCents = toCents(ev.target.value);
  persistReceipts();
}

// Split-Schnellwahl: 'shared' | pid | 'custom'
function setQuickSplit(item, mode) {
  const pids = personIds();
  if (mode === 'shared') item.split = evenSplit(pids);
  else if (pids.includes(mode)) item.split = Object.fromEntries(pids.map((pid) => [pid, pid === mode ? 100 : 0]));
  else {
    state.splitEditor = { itemId: item.id, p1pct: item.split[pids[0]] ?? 50 };
    return;
  }
  item.needsReview = false;
  persistReceipts();
}

function splitMode(item) {
  const pids = personIds();
  if (isEvenSplit(item.split, pids)) return 'shared';
  const solo = pids.find((pid) => (item.split[pid] || 0) === 100);
  return solo || 'custom';
}

function splitLabel(item) {
  const pids = personIds();
  const mode = splitMode(item);
  if (mode === 'shared') return 'geteilt 50 : 50';
  if (pids.includes(mode)) return `nur ${personName(mode)}`;
  return pids.map((pid) => `${personName(pid)} ${item.split[pid] || 0}%`).join(' / ');
}

function applySplitEditor() {
  const ed = state.splitEditor;
  const r = currentReceipt();
  if (!ed || !r) return;
  const item = r.items.find((i) => i.id === ed.itemId);
  if (item) {
    const pids = personIds();
    const p1 = Math.min(100, Math.max(0, Math.round(ed.p1pct)));
    item.split = normalizeSplit({ [pids[0]]: p1, [pids[1]]: 100 - p1 }, pids);
    item.needsReview = false;
    persistReceipts();
  }
  state.splitEditor = null;
}

function setKind(item, kind) {
  item.kind = kind;
  if (kind === 'deposit' || kind === 'deposit_return') {
    item.categoryId = state.settings.depositCategoryId;
    item.split = evenSplit(personIds());
    if (kind === 'deposit_return' && item.priceCents > 0) {
      item.priceCents = -item.priceCents;
      item.priceInput = (item.priceCents / 100).toFixed(2).replace('.', ',');
    }
  }
  item.needsReview = false;
  persistReceipts();
}

// ── Analyse (Foto/Datei → Claude) ────────────────────────────────────────────
async function onFilePicked(ev) {
  const file = ev.target.files?.[0];
  ev.target.value = '';
  if (!file) return;
  if (!state.settings.apiKey) {
    toast('Bitte zuerst den Claude-API-Key in den Einstellungen hinterlegen', 'warn');
    state.screen = 'settings';
    state.settingsOpen.ki = true;
    return;
  }
  state.analyzing = true;
  state.analyzeError = '';
  try {
    const prepared = await prepareFile(file);
    const result = await analyzeReceipt({
      settings: state.settings,
      file: prepared,
      ruleLines: rulesForPrompt(state.rules, state.settings.persons, state.settings.categories),
    });
    const r = buildDraftFromAnalysis(result);
    state.currentId = r.id;
    state.screen = 'review';
    log('bon', 'analyzed', { items: r.items.length, store: r.store });
    toast(`${r.items.length} Positionen erkannt — bitte prüfen`);
  } catch (e) {
    state.analyzeError = e.message || String(e);
    log('error', 'analyze failed', { message: state.analyzeError });
    toast(state.analyzeError, 'warn');
  } finally {
    state.analyzing = false;
  }
}

// Bilder clientseitig verkleinern (max. 2000px Kante, JPEG) — spart Tokens und
// umgeht das 5-MB-Limit der API; PDFs unverändert als Dokument senden.
async function prepareFile(file) {
  if (file.type === 'application/pdf') {
    return { base64: await fileToBase64(file), mediaType: 'application/pdf' };
  }
  if (!/^image\//.test(file.type)) {
    throw new Error('Bitte ein Foto (JPG/PNG/HEIC via Kamera) oder PDF auswählen.');
  }
  const img = await loadImage(file);
  const maxEdge = 2000;
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
  return { base64: dataUrl.split(',')[1], mediaType: 'image/jpeg' };
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1]);
    fr.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
    fr.readAsDataURL(file);
  });
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Bild konnte nicht geladen werden (Format nicht unterstützt?).')); };
    img.src = url;
  });
}

function buildDraftFromAnalysis(result) {
  const pids = personIds();
  let items = (result.items || []).map((it) => {
    let split = evenSplit(pids);
    let needsReview = false;
    if (pids.includes(it.assignment)) {
      split = Object.fromEntries(pids.map((pid) => [pid, pid === it.assignment ? 100 : 0]));
    } else if (it.assignment === 'unknown') {
      needsReview = true;
    }
    const priceCents = toCents(it.totalPrice);
    return {
      id: newId('pos'),
      name: it.name || '',
      qty: it.qty || 1,
      priceCents,
      priceInput: (priceCents / 100).toFixed(2).replace('.', ','),
      categoryId: state.settings.categories.some((c) => c.id === it.categoryId)
        ? it.categoryId : state.settings.defaultCategoryId,
      split,
      kind: ['deposit', 'deposit_return'].includes(it.kind) ? it.kind : 'normal',
      needsReview,
      fromRule: false,
    };
  });
  // Gelernte Regeln schlagen die KI-Vorschläge.
  items = applyRules(items, state.rules).map((i) => (i.fromRule ? { ...i, needsReview: false } : i));
  return newDraft({
    store: result.store || '',
    date: /^\d{4}-\d{2}-\d{2}$/.test(result.date || '') ? result.date : new Date().toISOString().slice(0, 10),
    totalCents: toCents(result.total),
    notes: result.notes || '',
    items,
  });
}

// ── Übersichten / Export ─────────────────────────────────────────────────────
function summaryFor(r) { return receiptSummary(r, state.settings); }
function monthFor(key) { return monthSummary(state.receipts, state.settings, key); }

function receiptsOfMonth(key) {
  return state.receipts.filter((r) => receiptMonth(r) === key);
}

function shiftMonth(delta) {
  const [y, m] = state.monthKey.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  state.monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
}

function formatDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return iso || '—';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

// Tabelle als Text (Tab-getrennt, für Excel/Numbers) in die Zwischenablage.
function summaryToTSV(summary, title) {
  const pids = personIds();
  const euro = (c) => (c / 100).toFixed(2).replace('.', ',');
  const lines = [[title, ...pids.map(personName)].join('\t')];
  summary.rows.forEach((row) => {
    if (pids.some((pid) => row.single[pid] !== 0)) {
      lines.push([`${row.name} einzeln`, ...pids.map((pid) => euro(row.single[pid]))].join('\t'));
    }
    if (row.sharedTotal !== 0) {
      lines.push([`${row.name} teilen`, ...pids.map((pid) => euro(row.sharedPer[pid]))].join('\t'));
    }
  });
  lines.push(['Gesamt', ...pids.map((pid) => euro(summary.personTotals[pid]))].join('\t'));
  return lines.join('\n');
}

async function copySummary(summary, title) {
  try {
    await navigator.clipboard.writeText(summaryToTSV(summary, title));
    toast('Tabelle kopiert — direkt in Excel/Numbers einfügbar');
  } catch {
    toast('Kopieren nicht möglich (Browser-Rechte?)', 'warn');
  }
}

// ── KI-Chat ───────────────────────────────────────────────────────────────────
async function sendChat() {
  const text = state.chatInput.trim();
  if (!text || state.chatBusy) return;
  if (!state.settings.apiKey) {
    toast('Bitte zuerst den Claude-API-Key in den Einstellungen hinterlegen', 'warn');
    return;
  }
  state.chatInput = '';
  state.chat.push({ role: 'user', text, ts: Date.now() });
  saveChat(state.chat);
  state.chatBusy = true;
  try {
    const history = state.chat.slice(-CHAT_HISTORY_LIMIT).map((m) => ({ role: m.role, text: m.text }));
    const res = await assistantChat({ settings: state.settings, rules: state.rules, history });
    const applied = (res.actions || []).map(applyAssistantAction).filter(Boolean);
    state.chat.push({ role: 'assistant', text: res.reply, actions: applied, ts: Date.now() });
    saveChat(state.chat);
  } catch (e) {
    state.chat.push({ role: 'assistant', text: `⚠︎ ${e.message}`, actions: [], ts: Date.now() });
    saveChat(state.chat);
  } finally {
    state.chatBusy = false;
    queueMicrotask(scrollChat);
  }
}

function scrollChat() {
  const el = document.querySelector('.chat-log');
  if (el) el.scrollTop = el.scrollHeight;
}

// Wendet eine Assistent-Aktion an; Rückgabe = menschenlesbare Beschreibung
// (im Chat als Chip angezeigt) oder null wenn ungültig.
function applyAssistantAction(a) {
  try {
    const pids = personIds();
    switch (a.type) {
      case 'rename_person': {
        const p = state.settings.persons.find((x) => x.id === a.personId);
        if (!p || !a.name) return null;
        const old = p.name;
        p.name = a.name.trim();
        persistSettings();
        return `Person „${old}“ heißt jetzt „${p.name}“`;
      }
      case 'rename_category': {
        const c = state.settings.categories.find((x) => x.id === a.categoryId);
        if (!c || !a.name) return null;
        const old = c.name;
        c.name = a.name.trim();
        persistSettings();
        return `Kategorie „${old}“ heißt jetzt „${c.name}“`;
      }
      case 'add_category': {
        if (!a.name) return null;
        const id = (a.categoryId || a.name).toLowerCase().replace(/[^a-zäöüß]/g, '').slice(0, 24) || newId('cat');
        if (state.settings.categories.some((c) => c.id === id)) return null;
        state.settings.categories.push({ id, name: a.name.trim(), icon: 'cart' });
        persistSettings();
        return `Kategorie „${a.name.trim()}“ angelegt`;
      }
      case 'remove_category': {
        const c = state.settings.categories.find((x) => x.id === a.categoryId);
        if (!c || state.settings.categories.length <= 1) return null;
        if (c.id === state.settings.depositCategoryId) return null; // Pfand-Kategorie ist geschützt
        state.settings.categories = state.settings.categories.filter((x) => x.id !== c.id);
        if (state.settings.defaultCategoryId === c.id) state.settings.defaultCategoryId = state.settings.categories[0].id;
        persistSettings();
        return `Kategorie „${c.name}“ entfernt`;
      }
      case 'set_default_category': {
        if (!state.settings.categories.some((c) => c.id === a.categoryId)) return null;
        state.settings.defaultCategoryId = a.categoryId;
        persistSettings();
        return `Standard-Kategorie: ${categoryName(a.categoryId)}`;
      }
      case 'set_rule': {
        if (!a.productName || !a.split) return null;
        const catId = state.settings.categories.some((c) => c.id === a.categoryId)
          ? a.categoryId : state.settings.defaultCategoryId;
        const split = normalizeSplit(a.split, pids);
        const key = normalizeKey(a.productName);
        const idx = state.rules.findIndex((r) => r.key === key);
        const rule = { key, name: a.productName, categoryId: catId, split, count: (idx >= 0 ? state.rules[idx].count : 0) + 1, updatedAt: Date.now() };
        if (idx >= 0) state.rules[idx] = rule; else state.rules.push(rule);
        persistRules();
        const parts = pids.filter((pid) => split[pid] > 0).map((pid) => `${personName(pid)} ${split[pid]}%`).join(' / ');
        return `Regel: ${a.productName} → ${categoryName(catId)}, ${parts}`;
      }
      case 'remove_rule': {
        const key = normalizeKey(a.productName || '');
        const before = state.rules.length;
        state.rules = state.rules.filter((r) => r.key !== key);
        if (state.rules.length === before) return null;
        persistRules();
        return `Regel für „${a.productName}“ entfernt`;
      }
      default: return null;
    }
  } catch (e) {
    log('error', 'action failed', { type: a?.type, message: e?.message });
    return null;
  }
}

// Spracheingabe (Web Speech API, de-DE). Auf iOS-Safari ab 14.5 verfügbar.
let recognition = null;
function toggleVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast('Spracheingabe wird von diesem Browser nicht unterstützt', 'warn'); return; }
  if (state.listening) { recognition?.stop(); return; }
  recognition = new SR();
  recognition.lang = 'de-DE';
  recognition.interimResults = true;
  recognition.continuous = false;
  const base = state.chatInput;
  recognition.onresult = (ev) => {
    let text = '';
    for (const res of ev.results) text += res[0].transcript;
    state.chatInput = (base ? base + ' ' : '') + text;
  };
  recognition.onend = () => { state.listening = false; };
  recognition.onerror = (ev) => { state.listening = false; if (ev.error !== 'aborted') toast('Spracheingabe fehlgeschlagen', 'warn'); };
  state.listening = true;
  recognition.start();
}

// ── Einstellungen: Personen / Kategorien / Regeln / Daten ────────────────────
function addCategory() {
  const name = state.newCategoryName.trim();
  if (!name) return;
  const id = name.toLowerCase().replace(/[^a-zäöüß]/g, '').slice(0, 24) || newId('cat');
  if (state.settings.categories.some((c) => c.id === id)) { toast('Kategorie existiert schon', 'warn'); return; }
  state.settings.categories.push({ id, name, icon: 'cart' });
  state.newCategoryName = '';
  persistSettings();
  toast(`Kategorie „${name}“ angelegt`);
}

function removeCategory(c) {
  if (c.id === state.settings.depositCategoryId) { toast('Die Pfand-Kategorie kann nicht gelöscht werden', 'warn'); return; }
  if (state.settings.categories.length <= 1) return;
  confirmAction(`Kategorie „${c.name}“ löschen? Bestehende Positionen fallen auf „${categoryName(state.settings.defaultCategoryId)}“ zurück.`, () => {
    state.settings.categories = state.settings.categories.filter((x) => x.id !== c.id);
    if (state.settings.defaultCategoryId === c.id) state.settings.defaultCategoryId = state.settings.categories[0].id;
    persistSettings();
  });
}

function deleteRule(rule) {
  state.rules = state.rules.filter((r) => r.key !== rule.key);
  persistRules();
}

function exportBackup() {
  const data = collectExportData(
    JSON.parse(JSON.stringify(state.settings)),
    JSON.parse(JSON.stringify(state.receipts)),
    JSON.parse(JSON.stringify(state.rules)),
  );
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `grocery-share-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Sicherung heruntergeladen (enthält den API-Key!)');
}

async function importBackup(ev) {
  const file = ev.target.files?.[0];
  ev.target.value = '';
  if (!file) return;
  try {
    const data = parseImportData(await file.text());
    confirmAction(`Sicherung mit ${data.receipts.length} Bons und ${data.rules.length} Regeln einspielen? Die aktuellen Daten werden ersetzt.`, () => {
      applyImport(data);
      state.settings = data.settings;
      state.receipts = data.receipts;
      state.rules = data.rules;
      applyTheme();
      toast('Sicherung eingespielt');
    });
  } catch (e) {
    toast(e.message, 'warn');
  }
}

function wipeAll() {
  confirmAction('Wirklich ALLE Bons, Regeln und Einstellungen löschen?', () => {
    localStorage.removeItem('gs_settings');
    localStorage.removeItem('gs_receipts');
    localStorage.removeItem('gs_rules');
    localStorage.removeItem('gs_chat');
    location.reload();
  });
}

function exportDebugLog() {
  const blob = new Blob([exportLogText(BUILD)], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'grocery-share-diagnose.txt';
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Update-Mechanismus (wie coop-number-sums, vereinfacht) ───────────────────
let swRegistration = null;
async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    swRegistration = await navigator.serviceWorker.register('./sw.js');
    swRegistration.addEventListener('updatefound', () => {
      const worker = swRegistration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          state.updateReady = true;
        }
      });
    });
    log('sw', 'registered');
  } catch (e) {
    log('sw', 'register failed', { message: e?.message });
  }
}

async function checkForUpdate() {
  if (!swRegistration) return toast('Kein Service Worker aktiv', 'warn');
  await swRegistration.update();
  if (swRegistration.waiting) state.updateReady = true;
  else toast('App ist aktuell ✓');
}

function restartForUpdate() {
  const waiting = swRegistration?.waiting;
  if (!waiting) return location.reload();
  waiting.postMessage('SKIP_WAITING');
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
}

// „Was ist neu"-Hinweis nach Updates.
const seenKey = 'gs_seen_version';
function maybeShowWhatsNew() {
  const seen = localStorage.getItem(seenKey);
  if (seen && seen !== BUILD) state.whatsNewOpen = true;
  localStorage.setItem(seenKey, BUILD);
}

// ── App ───────────────────────────────────────────────────────────────────────
const app = createApp({
  setup() {
    const receipt = computed(currentReceipt);
    const summary = computed(() => (receipt.value ? summaryFor(receipt.value) : null));
    const month = computed(() => monthFor(state.monthKey));
    const monthReceipts = computed(() => receiptsOfMonth(state.monthKey));
    const totalsDiff = computed(() => {
      const r = receipt.value;
      if (!r || !r.totalCents) return 0;
      return itemsTotal(r, state.settings) - r.totalCents;
    });
    const reviewCount = computed(() => receipt.value?.items.filter((i) => i.needsReview).length || 0);
    const sortedRules = computed(() => [...state.rules].sort((a, b) => b.updatedAt - a.updatedAt));

    return {
      state,
      models: CLAUDE_MODELS,
      receipt, summary, month, monthReceipts, totalsDiff, reviewCount, sortedRules,
      ic: (name, size) => icon(name, { size }),
      fmt, personName, categoryName, formatDate, monthLabel,
      personIds,
      go: (screen) => { state.screen = screen; if (screen === 'chat') queueMicrotask(scrollChat); },
      addManualReceipt, onFilePicked, openReceipt, deleteReceipt,
      addItem, removeItem, onPriceInput, onTotalInput, setQuickSplit, splitMode, splitLabel,
      applySplitEditor, setKind, finalizeReceipt, reopenReceipt,
      summaryFor, copySummary, summaryToTSV, shiftMonth,
      sendChat, toggleVoice,
      persistSettings, persistReceipts, applyTheme,
      addCategory, removeCategory, deleteRule,
      exportBackup, importBackup, wipeAll, exportDebugLog,
      checkForUpdate, restartForUpdate,
      confirmYes: () => { const d = state.confirmDialog; state.confirmDialog = null; d?.onYes?.(); },
      splitPreview: (p1) => {
        const pids = personIds();
        return `${personName(pids[0])} ${Math.round(p1)}% / ${personName(pids[1])} ${100 - Math.round(p1)}%`;
      },
      kindLabel: (k) => (k === 'deposit' ? 'Pfand' : k === 'deposit_return' ? 'Leergut' : ''),
    };
  },
  template: `
  <div class="app">
    <!-- ═══ Kopfzeile ═══ -->
    <header class="topbar" v-if="state.screen !== 'home'">
      <button class="iconbtn" @click="go(state.screen === 'summary' || state.screen === 'review' ? 'home' : 'home')" v-html="ic('back')" aria-label="Zurück"></button>
      <div class="topbar-title">
        <template v-if="state.screen === 'review'">Bon prüfen</template>
        <template v-else-if="state.screen === 'summary'">Auswertung</template>
        <template v-else-if="state.screen === 'month'">Monatsübersicht</template>
        <template v-else-if="state.screen === 'chat'">KI-Assistent</template>
        <template v-else-if="state.screen === 'settings'">Einstellungen</template>
      </div>
      <div style="width:40px"></div>
    </header>

    <!-- ═══ HOME ═══ -->
    <main v-if="state.screen === 'home'" class="screen home">
      <div class="home-head">
        <div>
          <h1 class="app-title">Grocery Share</h1>
          <div class="app-sub">Kassenbons fair aufteilen — {{ personName(personIds()[0]) }} & {{ personName(personIds()[1]) }}</div>
        </div>
        <button class="iconbtn" @click="go('settings')" v-html="ic('settings')" aria-label="Einstellungen"></button>
      </div>

      <div class="upload-card card">
        <label class="btn btn-primary btn-big upload-btn" :class="{ disabled: state.analyzing }">
          <span v-html="ic('camera')"></span>
          <span>{{ state.analyzing ? 'Analysiere Bon …' : 'Bon fotografieren / hochladen' }}</span>
          <input type="file" accept="image/*,application/pdf" @change="onFilePicked" :disabled="state.analyzing" hidden>
        </label>
        <div v-if="state.analyzing" class="analyze-progress"><div class="bar"></div></div>
        <div class="upload-hint">JPG, PNG oder PDF — die KI liest alle Positionen aus und schlägt die Aufteilung vor.</div>
        <button class="btn btn-ghost" @click="addManualReceipt"><span v-html="ic('edit', 18)"></span> Bon manuell anlegen</button>
      </div>

      <div class="home-actions">
        <button class="tile" @click="go('month')">
          <span v-html="ic('table', 26)"></span><span>Monats­übersicht</span>
        </button>
        <button class="tile" @click="go('chat')">
          <span v-html="ic('sparkle', 26)"></span><span>KI-Assistent</span>
        </button>
      </div>

      <h2 class="section-title" v-if="state.receipts.length">Letzte Bons</h2>
      <div class="receipt-list">
        <button v-for="r in state.receipts.slice(0, 30)" :key="r.id" class="receipt-row card" @click="openReceipt(r)">
          <div class="rr-main">
            <div class="rr-store">{{ r.store || 'Ohne Namen' }} <span v-if="r.status === 'draft'" class="chip chip-warn">Entwurf</span></div>
            <div class="rr-date">{{ formatDate(r.date) }} · {{ r.items.length }} Positionen</div>
          </div>
          <div class="rr-total">{{ fmt(r.totalCents || summaryFor(r).grandTotal) }}</div>
        </button>
      </div>
      <div v-if="!state.receipts.length" class="empty-hint">Noch keine Bons. Fotografier den ersten! 🧾</div>

      <footer class="home-footer">
        <button class="version" @click="checkForUpdate">v{{ state.build }}</button>
      </footer>
    </main>

    <!-- ═══ REVIEW (Bon prüfen) ═══ -->
    <main v-else-if="state.screen === 'review' && receipt" class="screen review">
      <div class="card review-meta">
        <div class="meta-row">
          <label>Geschäft<input v-model="receipt.store" @change="persistReceipts" placeholder="z.B. REWE"></label>
          <label>Datum<input type="date" v-model="receipt.date" @change="persistReceipts"></label>
        </div>
        <div class="meta-row">
          <label>Bon-Gesamtbetrag
            <input inputmode="decimal" :value="receipt.totalCents ? (receipt.totalCents / 100).toFixed(2).replace('.', ',') : ''"
                   @change="onTotalInput(receipt, $event)" placeholder="0,00">
          </label>
          <div class="meta-check" :class="{ ok: totalsDiff === 0 && receipt.totalCents, bad: totalsDiff !== 0 && receipt.totalCents }">
            <template v-if="!receipt.totalCents">Summe der Positionen: {{ fmt(summary.grandTotal) }}</template>
            <template v-else-if="totalsDiff === 0"><span v-html="ic('check', 16)"></span> Positionen stimmen mit dem Bon überein</template>
            <template v-else><span v-html="ic('warn', 16)"></span> Differenz {{ fmt(totalsDiff, { sign: true }) }} zu den Positionen</template>
          </div>
        </div>
        <div v-if="receipt.notes" class="ai-note"><span v-html="ic('info', 16)"></span> {{ receipt.notes }}</div>
        <div v-if="reviewCount" class="ai-note warn"><span v-html="ic('warn', 16)"></span> {{ reviewCount }} Position(en) ohne klare Zuordnung — bitte unten prüfen.</div>
      </div>

      <div class="item-list">
        <div v-for="item in receipt.items" :key="item.id" class="card item-card" :class="{ review: item.needsReview, deposit: item.kind !== 'normal' }">
          <div class="item-top">
            <input class="item-name" v-model="item.name" @change="persistReceipts" placeholder="Artikel">
            <input class="item-price" inputmode="decimal" v-model="item.priceInput" @change="onPriceInput(item)" placeholder="0,00">
            <button class="iconbtn small" @click="removeItem(item)" v-html="ic('trash', 18)" aria-label="Position löschen"></button>
          </div>
          <div class="item-controls" v-if="item.kind === 'normal'">
            <select class="cat-select" v-model="item.categoryId" @change="persistReceipts">
              <option v-for="c in state.settings.categories" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
            <div class="split-btns">
              <button :class="{ active: splitMode(item) === personIds()[0] }" @click="setQuickSplit(item, personIds()[0])">{{ personName(personIds()[0]) }}</button>
              <button :class="{ active: splitMode(item) === 'shared' }" @click="setQuickSplit(item, 'shared')">50:50</button>
              <button :class="{ active: splitMode(item) === personIds()[1] }" @click="setQuickSplit(item, personIds()[1])">{{ personName(personIds()[1]) }}</button>
              <button :class="{ active: splitMode(item) === 'custom' }" @click="setQuickSplit(item, 'custom')">%</button>
            </div>
          </div>
          <div class="item-badges">
            <span v-if="item.kind !== 'normal'" class="chip chip-accent">{{ kindLabel(item.kind) }} — immer 50:50, Kategorie {{ categoryName(state.settings.depositCategoryId) }}</span>
            <span v-else class="chip">{{ splitLabel(item) }}</span>
            <span v-if="item.fromRule" class="chip chip-good" title="Aus gelernter Regel">gelernt ✓</span>
            <span v-if="item.needsReview" class="chip chip-warn">Zuordnung prüfen</span>
            <button class="chip chip-btn" v-if="item.kind === 'normal'" @click="setKind(item, 'deposit')">als Pfand</button>
            <button class="chip chip-btn" v-else @click="setKind(item, 'normal')">kein Pfand</button>
          </div>
        </div>
      </div>

      <button class="btn btn-ghost wide" @click="addItem"><span v-html="ic('plus', 18)"></span> Position hinzufügen</button>

      <div class="review-actions">
        <button class="btn btn-danger-ghost" @click="deleteReceipt(receipt)">Löschen</button>
        <button class="btn btn-primary btn-big" @click="finalizeReceipt"><span v-html="ic('check', 20)"></span> Abschließen & auswerten</button>
      </div>
    </main>

    <!-- ═══ SUMMARY (Auswertung eines Bons) ═══ -->
    <main v-else-if="state.screen === 'summary' && receipt" class="screen summary">
      <div class="card">
        <div class="sum-head">
          <div>
            <div class="sum-store">{{ receipt.store || 'Ohne Namen' }}</div>
            <div class="sum-date">{{ formatDate(receipt.date) }} · {{ receipt.items.length }} Positionen</div>
          </div>
          <div class="sum-total">{{ fmt(summary.grandTotal) }}</div>
        </div>
        <table class="sum-table">
          <thead><tr><th></th><th v-for="pid in personIds()" :key="pid">{{ personName(pid) }}</th></tr></thead>
          <tbody>
            <template v-for="row in summary.rows" :key="row.categoryId">
              <tr v-if="personIds().some((pid) => row.single[pid] !== 0)">
                <td>{{ row.name }} einzeln</td>
                <td v-for="pid in personIds()" :key="pid" class="num">{{ fmt(row.single[pid]) }}</td>
              </tr>
              <tr v-if="row.sharedTotal !== 0">
                <td>{{ row.name }} teilen <span class="mut">({{ fmt(row.sharedTotal) }} gesamt)</span></td>
                <td v-for="pid in personIds()" :key="pid" class="num">{{ fmt(row.sharedPer[pid]) }}</td>
              </tr>
            </template>
          </tbody>
          <tfoot><tr><td>Gesamt pro Person</td><td v-for="pid in personIds()" :key="pid" class="num strong">{{ fmt(summary.personTotals[pid]) }}</td></tr></tfoot>
        </table>
        <div class="sum-actions">
          <button class="btn btn-ghost" @click="copySummary(summary, (receipt.store || 'Bon') + ' ' + formatDate(receipt.date))"><span v-html="ic('copy', 18)"></span> Tabelle kopieren</button>
          <button class="btn btn-ghost" @click="reopenReceipt"><span v-html="ic('edit', 18)"></span> Bearbeiten</button>
        </div>
      </div>
      <button class="btn btn-primary wide" @click="go('home')">Fertig</button>
    </main>

    <!-- ═══ MONAT ═══ -->
    <main v-else-if="state.screen === 'month'" class="screen month">
      <div class="month-nav">
        <button class="iconbtn" @click="shiftMonth(-1)" v-html="ic('back')" aria-label="Voriger Monat"></button>
        <div class="month-label">{{ monthLabel(state.monthKey) }}</div>
        <button class="iconbtn" @click="shiftMonth(1)" v-html="ic('next')" aria-label="Nächster Monat"></button>
      </div>

      <div class="card" v-if="month.receiptCount">
        <div class="sum-head"><div class="sum-store">{{ month.receiptCount }} abgeschlossene Bons</div><div class="sum-total">{{ fmt(month.grandTotal) }}</div></div>
        <table class="sum-table">
          <thead><tr><th></th><th v-for="pid in personIds()" :key="pid">{{ personName(pid) }}</th></tr></thead>
          <tbody>
            <template v-for="row in month.rows" :key="row.categoryId">
              <tr v-if="personIds().some((pid) => row.single[pid] !== 0)">
                <td>{{ row.name }} einzeln</td>
                <td v-for="pid in personIds()" :key="pid" class="num">{{ fmt(row.single[pid]) }}</td>
              </tr>
              <tr v-if="row.sharedTotal !== 0">
                <td>{{ row.name }} teilen <span class="mut">({{ fmt(row.sharedTotal) }} gesamt)</span></td>
                <td v-for="pid in personIds()" :key="pid" class="num">{{ fmt(row.sharedPer[pid]) }}</td>
              </tr>
            </template>
          </tbody>
          <tfoot><tr><td>Gesamt pro Person</td><td v-for="pid in personIds()" :key="pid" class="num strong">{{ fmt(month.personTotals[pid]) }}</td></tr></tfoot>
        </table>
        <div class="sum-actions">
          <button class="btn btn-ghost" @click="copySummary(month, 'Monat ' + monthLabel(state.monthKey))"><span v-html="ic('copy', 18)"></span> Tabelle kopieren</button>
        </div>
      </div>
      <div v-else class="empty-hint">Keine abgeschlossenen Bons in diesem Monat.</div>

      <h2 class="section-title" v-if="monthReceipts.length">Bons im {{ monthLabel(state.monthKey) }}</h2>
      <div class="receipt-list">
        <button v-for="r in monthReceipts" :key="r.id" class="receipt-row card" @click="openReceipt(r)">
          <div class="rr-main">
            <div class="rr-store">{{ r.store || 'Ohne Namen' }} <span v-if="r.status === 'draft'" class="chip chip-warn">Entwurf</span></div>
            <div class="rr-date">{{ formatDate(r.date) }}</div>
          </div>
          <div class="rr-total">{{ fmt(r.totalCents || summaryFor(r).grandTotal) }}</div>
        </button>
      </div>
    </main>

    <!-- ═══ CHAT ═══ -->
    <main v-else-if="state.screen === 'chat'" class="screen chat">
      <div class="chat-log">
        <div class="chat-intro card" v-if="!state.chat.length">
          <span v-html="ic('sparkle', 28)"></span>
          <p>Ich bin dein Assistent und kann die App live umkonfigurieren. Sag mir z.B.:</p>
          <ul>
            <li>„Milka-Schokolade gehört ab jetzt immer Tara."</li>
            <li>„Leg eine Kategorie Tierbedarf an."</li>
            <li>„Kaffee teilen wir ab jetzt 70/30, Tom zahlt mehr."</li>
            <li>„Warum wird Pfand 50:50 geteilt?"</li>
          </ul>
        </div>
        <div v-for="(m, i) in state.chat" :key="i" class="chat-msg" :class="m.role">
          <div class="bubble">{{ m.text }}</div>
          <div v-if="m.actions && m.actions.length" class="action-chips">
            <span v-for="(a, j) in m.actions" :key="j" class="chip chip-good">{{ a }}</span>
          </div>
        </div>
        <div v-if="state.chatBusy" class="chat-msg assistant"><div class="bubble typing"><span></span><span></span><span></span></div></div>
      </div>
      <div class="chat-inputbar">
        <button class="iconbtn" :class="{ rec: state.listening }" @click="toggleVoice" v-html="ic('mic')" aria-label="Spracheingabe"></button>
        <input v-model="state.chatInput" @keyup.enter="sendChat" placeholder="Nachricht oder Wunsch …" :disabled="state.chatBusy">
        <button class="iconbtn accent" @click="sendChat" :disabled="state.chatBusy || !state.chatInput.trim()" v-html="ic('send')" aria-label="Senden"></button>
      </div>
    </main>

    <!-- ═══ EINSTELLUNGEN ═══ -->
    <main v-else-if="state.screen === 'settings'" class="screen settings">
      <div class="card acc" :class="{ open: state.settingsOpen.ki }">
        <button class="acc-head" @click="state.settingsOpen.ki = !state.settingsOpen.ki"><span v-html="ic('key', 20)"></span> Claude-KI<span class="acc-arrow" v-html="ic('next', 16)"></span></button>
        <div class="acc-body" v-if="state.settingsOpen.ki">
          <label>API-Key
            <input type="password" v-model="state.settings.apiKey" @change="persistSettings" placeholder="sk-ant-…" autocomplete="off">
          </label>
          <div class="hint">Der Key wird nur lokal auf diesem Gerät gespeichert und direkt an api.anthropic.com geschickt. Erstellen unter console.anthropic.com → API Keys.</div>
          <label>Modell
            <select v-model="state.settings.model" @change="persistSettings">
              <option v-for="m in models" :key="m.id" :value="m.id">{{ m.name }}</option>
            </select>
          </label>
        </div>
      </div>

      <div class="card acc" :class="{ open: state.settingsOpen.personen }">
        <button class="acc-head" @click="state.settingsOpen.personen = !state.settingsOpen.personen"><span v-html="ic('users', 20)"></span> Personen<span class="acc-arrow" v-html="ic('next', 16)"></span></button>
        <div class="acc-body" v-if="state.settingsOpen.personen">
          <label v-for="p in state.settings.persons" :key="p.id">Person {{ p.id === personIds()[0] ? 1 : 2 }}
            <input v-model="p.name" @change="persistSettings">
          </label>
        </div>
      </div>

      <div class="card acc" :class="{ open: state.settingsOpen.kategorien }">
        <button class="acc-head" @click="state.settingsOpen.kategorien = !state.settingsOpen.kategorien"><span v-html="ic('cart', 20)"></span> Kategorien<span class="acc-arrow" v-html="ic('next', 16)"></span></button>
        <div class="acc-body" v-if="state.settingsOpen.kategorien">
          <div v-for="c in state.settings.categories" :key="c.id" class="cat-row">
            <input v-model="c.name" @change="persistSettings">
            <span v-if="c.id === state.settings.depositCategoryId" class="chip" title="Pfand landet hier">Pfand</span>
            <button class="iconbtn small" @click="removeCategory(c)" v-html="ic('trash', 16)" aria-label="Kategorie löschen"></button>
          </div>
          <div class="cat-row">
            <input v-model="state.newCategoryName" placeholder="Neue Kategorie …" @keyup.enter="addCategory">
            <button class="iconbtn small accent" @click="addCategory" v-html="ic('plus', 18)" aria-label="Kategorie hinzufügen"></button>
          </div>
          <div class="hint">Jede Kategorie bekommt in der Auswertung automatisch die Zeilen „einzeln" und „teilen".</div>
        </div>
      </div>

      <div class="card acc" :class="{ open: state.settingsOpen.regeln }">
        <button class="acc-head" @click="state.settingsOpen.regeln = !state.settingsOpen.regeln"><span v-html="ic('bulb', 20)"></span> Gelernte Regeln <span class="chip">{{ state.rules.length }}</span><span class="acc-arrow" v-html="ic('next', 16)"></span></button>
        <div class="acc-body" v-if="state.settingsOpen.regeln">
          <label class="switch-row"><span>Mitlernen aktiv</span>
            <input type="checkbox" v-model="state.settings.learningEnabled" @change="persistSettings">
          </label>
          <div v-if="!state.rules.length" class="hint">Noch keine Regeln — sie entstehen beim Abschließen von Bons.</div>
          <div v-for="r in sortedRules.slice(0, 100)" :key="r.key" class="rule-row">
            <div class="rule-main">
              <div class="rule-name">{{ r.name }}</div>
              <div class="rule-detail">{{ categoryName(r.categoryId) }} · {{ personIds().filter((pid) => r.split[pid] > 0).map((pid) => personName(pid) + ' ' + r.split[pid] + '%').join(' / ') }}</div>
            </div>
            <button class="iconbtn small" @click="deleteRule(r)" v-html="ic('trash', 16)" aria-label="Regel löschen"></button>
          </div>
        </div>
      </div>

      <div class="card acc" :class="{ open: state.settingsOpen.daten }">
        <button class="acc-head" @click="state.settingsOpen.daten = !state.settingsOpen.daten"><span v-html="ic('download', 20)"></span> Daten & Darstellung<span class="acc-arrow" v-html="ic('next', 16)"></span></button>
        <div class="acc-body" v-if="state.settingsOpen.daten">
          <label class="switch-row"><span>Helles Design</span>
            <input type="checkbox" :checked="state.settings.theme === 'light'"
                   @change="state.settings.theme = $event.target.checked ? 'light' : 'dark'; persistSettings(); applyTheme()">
          </label>
          <div class="btn-row">
            <button class="btn btn-ghost" @click="exportBackup"><span v-html="ic('download', 18)"></span> Sicherung exportieren</button>
            <label class="btn btn-ghost"><span v-html="ic('upload', 18)"></span> Sicherung einspielen
              <input type="file" accept="application/json" @change="importBackup" hidden>
            </label>
          </div>
          <div class="btn-row">
            <button class="btn btn-ghost" @click="exportDebugLog">Diagnoseprotokoll exportieren</button>
            <button class="btn btn-danger-ghost" @click="wipeAll">Alles löschen</button>
          </div>
        </div>
      </div>

      <div class="card acc" :class="{ open: state.settingsOpen.info }">
        <button class="acc-head" @click="state.settingsOpen.info = !state.settingsOpen.info"><span v-html="ic('info', 20)"></span> Version & Changelog<span class="acc-arrow" v-html="ic('next', 16)"></span></button>
        <div class="acc-body" v-if="state.settingsOpen.info">
          <div class="btn-row">
            <button class="btn btn-ghost" @click="checkForUpdate"><span v-html="ic('refresh', 18)"></span> Auf Updates prüfen (v{{ state.build }})</button>
          </div>
          <div v-for="entry in state.changelog.slice(0, 8)" :key="entry.version" class="changelog-entry">
            <div class="cl-version">v{{ entry.version }} <span class="mut">{{ entry.date }}</span></div>
            <ul><li v-for="(ch, i) in entry.changes" :key="i">{{ ch }}</li></ul>
          </div>
        </div>
      </div>
    </main>

    <!-- ═══ Overlays ═══ -->
    <div v-if="state.splitEditor" class="modal-bg" @click.self="state.splitEditor = null">
      <div class="modal">
        <h3>Aufteilung in Prozent</h3>
        <div class="split-preview">{{ splitPreview(state.splitEditor.p1pct) }}</div>
        <input type="range" min="0" max="100" step="5" v-model.number="state.splitEditor.p1pct">
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="state.splitEditor = null">Abbrechen</button>
          <button class="btn btn-primary" @click="applySplitEditor">Übernehmen</button>
        </div>
      </div>
    </div>

    <div v-if="state.confirmDialog" class="modal-bg" @click.self="state.confirmDialog = null">
      <div class="modal">
        <p>{{ state.confirmDialog.text }}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="state.confirmDialog = null">Abbrechen</button>
          <button class="btn btn-danger" @click="confirmYes">Ja</button>
        </div>
      </div>
    </div>

    <div v-if="state.whatsNewOpen" class="modal-bg" @click.self="state.whatsNewOpen = false">
      <div class="modal">
        <h3>Was ist neu in v{{ state.build }}</h3>
        <ul class="whatsnew-list"><li v-for="(ch, i) in (state.changelog[0]?.changes || [])" :key="i">{{ ch }}</li></ul>
        <div class="modal-actions"><button class="btn btn-primary" @click="state.whatsNewOpen = false">Alles klar</button></div>
      </div>
    </div>

    <div v-if="state.updateReady" class="update-banner">
      <span>Neue Version verfügbar.</span>
      <button class="btn btn-primary" @click="restartForUpdate">Neu starten</button>
    </div>

    <div v-if="state.toast" class="toast" :class="state.toast.kind">{{ state.toast.text }}</div>
  </div>
  `,
});

applyTheme();
app.mount('#app');
registerSW();
maybeShowWhatsNew();
log('app', `start v${BUILD}`);

// Splash ausblenden.
const splash = document.getElementById('splash');
if (splash) {
  splash.classList.add('fade-out');
  setTimeout(() => splash.remove(), 500);
}

// Debug-Hook für E2E-Tests (nur lokal).
if (['localhost', '127.0.0.1'].includes(location.hostname)) {
  window.__gs = {
    state,
    newDraft,
    finalizeReceipt,
    buildDraftFromAnalysis,
    applyAssistantAction,
  };
}
