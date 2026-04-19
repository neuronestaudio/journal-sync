// db.js — IndexedDB wrapper for Journal Sync
// Provides a clean async API over the IndexedDB object store.

const DB_NAME    = 'JournalSyncDB';
const DB_VERSION = 1;
const STORE      = 'entries';

/** Cached DB connection — opened once per page session */
let _db = null;

// ─── Connection ───────────────────────────────────────────────────────────────

/**
 * Open (or reuse) the IndexedDB connection.
 * Creates the object store and indexes on first run.
 * @returns {Promise<IDBDatabase>}
 */
export function openDB() {
  return new Promise((resolve, reject) => {
    if (_db) { resolve(_db); return; }

    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        // Index by date so we can load "today's entry" efficiently
        store.createIndex('by_date', 'date', { unique: false });
      }
    };

    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror   = (e) => reject(e.target.error);
  });
}

// ─── Writes ───────────────────────────────────────────────────────────────────

/**
 * Save or update an entry (upsert keyed by entry.id).
 * @param {object} entry
 * @returns {Promise<object>} the saved entry
 */
export async function saveEntry(entry) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).put(entry);
    req.onsuccess = () => resolve(entry);
    req.onerror   = () => reject(req.error);
  });
}

/**
 * Mark a specific entry as synced.
 * Reads the current record, patches sync fields, then writes it back.
 * @param {string} id
 * @param {string} [syncedAt] ISO timestamp — defaults to now
 * @returns {Promise<object>} the updated entry
 */
export async function markSynced(id, syncedAt = new Date().toISOString()) {
  const db    = await openDB();
  const entry = await _getById(db, id);
  if (!entry) throw new Error(`Entry not found in IndexedDB: ${id}`);

  const updated = {
    ...entry,
    synced:    true,
    syncedAt,
    updatedAt: new Date().toISOString(),
  };

  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).put(updated);
    req.onsuccess = () => resolve(updated);
    req.onerror   = () => reject(req.error);
  });
}

// ─── Reads ────────────────────────────────────────────────────────────────────

/**
 * Return the first entry matching a date string (YYYY-MM-DD), or null.
 * @param {string} date
 * @returns {Promise<object|null>}
 */
export async function getEntryByDate(date) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly')
                  .objectStore(STORE)
                  .index('by_date')
                  .getAll(date);
    req.onsuccess = () => resolve(req.result[0] ?? null);
    req.onerror   = () => reject(req.error);
  });
}

/**
 * Return all entries that have not yet been synced to Google Sheets.
 * @returns {Promise<object[]>}
 */
export async function getUnsyncedEntries() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result.filter(e => !e.synced));
    req.onerror   = () => reject(req.error);
  });
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _getById(db, id) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror   = () => reject(req.error);
  });
}
