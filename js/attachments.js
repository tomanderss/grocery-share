// attachments.js — Original-Dateien der Bons (Fotos/PDFs) in IndexedDB.
// localStorage ist für Bilder zu klein (~5 MB gesamt), IndexedDB nicht.
// Gespeichert wird die für die Analyse aufbereitete Version (Bilder auf max.
// 2000px verkleinert, PDFs unverändert) als base64 — dasselbe Format wie im
// JSON-Backup, dadurch verlustfreier Export/Import.
//
// Eintrag: { id, receiptId, mediaType, base64, page, createdAt }

import { log } from './debuglog.js';
import { newId } from './storage.js';

const DB_NAME = 'grocery-share';
const STORE = 'attachments';

let dbPromise = null;
function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: 'id' });
          os.createIndex('receiptId', 'receiptId', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function reqAsPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function readStore() {
  const db = await openDb();
  return db.transaction(STORE, 'readonly').objectStore(STORE);
}

// files: [{ base64, mediaType }] — page zählt über bestehende Anhänge weiter
// (Neu-Analyse hängt an, statt die Historie zu überschreiben).
export async function saveAttachments(receiptId, files) {
  try {
    const existing = await getAttachments(receiptId);
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    const now = Date.now();
    files.forEach((f, i) => {
      tx.objectStore(STORE).put({
        id: newId('att'),
        receiptId,
        mediaType: f.mediaType,
        base64: f.base64,
        page: existing.length + i + 1,
        createdAt: now,
      });
    });
    await txDone(tx);
    log('storage', 'attachments saved', { receiptId, count: files.length });
    return files.length;
  } catch (e) {
    log('error', 'saveAttachments failed', { message: e?.message });
    return 0;
  }
}

export async function getAttachments(receiptId) {
  try {
    const os = await readStore();
    const list = await reqAsPromise(os.index('receiptId').getAll(receiptId));
    return (list || []).sort((a, b) => a.page - b.page);
  } catch (e) {
    log('error', 'getAttachments failed', { message: e?.message });
    return [];
  }
}

export async function deleteAttachmentsFor(receiptId) {
  try {
    const items = await getAttachments(receiptId);
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    items.forEach((a) => tx.objectStore(STORE).delete(a.id));
    await txDone(tx);
  } catch (e) {
    log('error', 'deleteAttachments failed', { message: e?.message });
  }
}

export async function getAllAttachments() {
  try {
    const os = await readStore();
    return (await reqAsPromise(os.getAll())) || [];
  } catch (e) {
    log('error', 'getAllAttachments failed', { message: e?.message });
    return [];
  }
}

// Import ersetzt den kompletten Bestand (wie der übrige Backup-Import).
export async function replaceAllAttachments(list) {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    (list || []).forEach((a) => {
      if (a && a.id && a.receiptId && a.base64 && a.mediaType) tx.objectStore(STORE).put(a);
    });
    await txDone(tx);
    log('storage', 'attachments imported', { count: (list || []).length });
  } catch (e) {
    log('error', 'replaceAllAttachments failed', { message: e?.message });
  }
}

export async function clearAttachments() {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    await txDone(tx);
  } catch (e) {
    log('error', 'clearAttachments failed', { message: e?.message });
  }
}
