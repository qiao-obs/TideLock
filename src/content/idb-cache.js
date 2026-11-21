(function (root) {
  'use strict';

  const DB_NAME = 'TideLockFeedCache';
  const DB_VERSION = 1;
  const STORE_NAME = 'feeds';
  const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      try {
        if (typeof indexedDB === 'undefined') {
          resolve(null);
          return;
        }
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return dbPromise;
  }

  async function putFeedSlot(slotKey, payload) {
    try {
      const db = await openDb();
      if (!db) return false;
      return await new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(
          {
            ...payload,
            savedAt: payload.savedAt || Date.now(),
          },
          slotKey
        );
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      });
    } catch {
      return false;
    }
  }

  async function getFeedSlot(slotKey, ttlMs = DEFAULT_TTL_MS) {
    try {
      const db = await openDb();
      if (!db) return null;
      const record = await new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(slotKey);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
      if (!record || !record.baseResponse) return null;
      if (ttlMs > 0 && record.savedAt && Date.now() - record.savedAt > ttlMs) {
        return null;
      }
      return record;
    } catch {
      return null;
    }
  }

  async function clearAllSlots() {
    try {
      const db = await openDb();
      if (!db) return false;
      return await new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).clear();
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    } catch {
      return false;
    }
  }

  const api = {
    DB_NAME,
    DEFAULT_TTL_MS,
    putFeedSlot,
    getFeedSlot,
    clearAllSlots,
  };

  if (typeof root !== 'undefined') {
    root.__TideLockIdbCache = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
