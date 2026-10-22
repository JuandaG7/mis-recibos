// Almacenamiento local en el iPhone (IndexedDB).
// - folders:  { id, name, parentId, color, createdAt }
// - receipts: { id, folderId, note, date, amount, createdAt, ocrStatus, ocrText }
// - images:   { id, type, full: ArrayBuffer, thumb: ArrayBuffer }
// - recurring: { id, name, kind: 'cobro'|'pago', folderId, amount, day, createdAt }  pagos que se repiten cada mes
// - marks:    { id: 'recurringId|AAAA-MM', recurringId, period, createdAt }  marcado como hecho sin recibo
// - meta:     { key, value }
// Las imágenes se guardan como ArrayBuffer (no Blob) porque Safari ha tenido
// problemas leyendo Blobs guardados en IndexedDB.

const DB_NAME = 'mis-recibos';
const DB_VERSION = 2;

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of ['folders', 'receipts', 'images', 'recurring', 'marks']) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => {
      // Si otra pestaña abre una versión nueva, cerrar esta conexión para no bloquearla.
      req.result.onversionchange = () => { req.result.close(); dbPromise = null; };
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transacción cancelada'));
  });
}

export async function getAll(store) {
  const db = await open();
  return wrap(db.transaction(store).objectStore(store).getAll());
}

export async function get(store, id) {
  const db = await open();
  return wrap(db.transaction(store).objectStore(store).get(id));
}

export async function put(store, value) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  return done(tx);
}

export async function remove(store, id) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(id);
  return done(tx);
}

export async function saveReceipt(receipt, image) {
  const db = await open();
  const tx = db.transaction(['receipts', 'images'], 'readwrite');
  tx.objectStore('images').put(image);
  tx.objectStore('receipts').put(receipt);
  return done(tx);
}

export async function deleteReceipt(id) {
  const db = await open();
  const tx = db.transaction(['receipts', 'images'], 'readwrite');
  tx.objectStore('receipts').delete(id);
  tx.objectStore('images').delete(id);
  return done(tx);
}

export async function getMeta(key, fallback = null) {
  const row = await get('meta', key);
  return row ? row.value : fallback;
}

export function setMeta(key, value) {
  return put('meta', { key, value });
}
