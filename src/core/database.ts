import type { Workspace } from './types';
import { STORAGE_KEY, emptyWorkspace, migrate, validateWorkspace } from './storage';
import { APP_VERSION, emptyBackupStatus, type BackupStatus } from './local-release';
const DB_NAME = 'jlcpcb-local-workbench';
const queues = new WeakMap<IDBFactory, Promise<void>>();
export async function drainWorkspaceWrites(factory: IDBFactory = indexedDB) {
  await queues.get(factory);
}
async function releaseCheckpoint(workspace: unknown, factory: IDBFactory) {
  await serial(factory, () =>
    transaction(factory, (tx) => {
      const store = tx.objectStore('recovery'),
        key = 'before-release-' + APP_VERSION;
      const request = store.get(key);
      request.onsuccess = () => {
        if (request.result === undefined)
          store.put({ date: Date.now(), appVersion: APP_VERSION, workspace }, key);
      };
    }),
  );
}
export async function readBackupStatus(factory: IDBFactory = indexedDB): Promise<BackupStatus> {
  const db = await open(factory);
  return new Promise((resolve, reject) => {
    const tx = db.transaction('workspace', 'readonly'),
      req = tx.objectStore('workspace').get('backup-status');
    let status = emptyBackupStatus();
    req.onsuccess = () => {
      const value = req.result;
      const date = (v: unknown) =>
        typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
      status = { lastExportAt: date(value?.lastExportAt), snoozedUntil: date(value?.snoozedUntil) };
    };
    tx.oncomplete = () => {
      db.close();
      resolve(status);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}
export function writeBackupStatus(status: BackupStatus, factory: IDBFactory = indexedDB) {
  return serial(factory, () =>
    transaction(factory, (tx) => {
      tx.objectStore('workspace').put(status, 'backup-status');
    }),
  );
}
function open(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('workspace');
      req.result.createObjectStore('recovery');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () =>
      reject(new Error('Database upgrade blocked. Close other workbench tabs and retry.'));
  });
}
function serial(factory: IDBFactory, action: () => Promise<void>): Promise<void> {
  const next = (queues.get(factory) || Promise.resolve()).catch(() => {}).then(action);
  queues.set(factory, next);
  return next;
}
async function transaction(factory: IDBFactory, write: (tx: IDBTransaction) => void) {
  const db = await open(factory);
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['workspace', 'recovery'], 'readwrite');
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error || new Error('Save transaction aborted'));
    };
    try {
      write(tx);
    } catch (e) {
      tx.abort();
      reject(e);
    }
  });
}
export async function readWorkspace(
  storage: Storage,
  factory: IDBFactory = indexedDB,
): Promise<Workspace> {
  await queues.get(factory)?.catch(() => {});
  const db = await open(factory);
  const saved = await new Promise<unknown>((resolve, reject) => {
    const tx = db.transaction('workspace', 'readonly'),
      req = tx.objectStore('workspace').get('current');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
  if (saved !== undefined) {
    await releaseCheckpoint(saved, factory);
    return validateWorkspace(saved);
  }
  const current = storage.getItem(STORAGE_KEY),
    legacy = storage.getItem('jlcpcb-projects'),
    single = storage.getItem('jlcpcb-parts');
  const raw =
    current ||
    legacy ||
    (single ? JSON.stringify([{ name: 'Imported project', parts: JSON.parse(single) }]) : null);
  const w = raw ? migrate(JSON.parse(raw)) : emptyWorkspace();
  await serial(factory, () =>
    transaction(factory, (tx) => {
      if (raw) tx.objectStore('recovery').put({ date: Date.now(), raw }, 'migration-original');
      tx.objectStore('workspace').put(w, 'current');
    }),
  );
  await releaseCheckpoint(w, factory);
  return w;
}
export function writeWorkspace(w: Workspace, factory: IDBFactory = indexedDB): Promise<void> {
  const copy = validateWorkspace(w);
  return serial(factory, () =>
    transaction(factory, (tx) => {
      tx.objectStore('workspace').put(copy, 'current');
    }),
  );
}
export async function replaceWorkspace(
  previous: Workspace,
  next: Workspace,
  factory: IDBFactory = indexedDB,
) {
  const copy = validateWorkspace(next);
  await serial(factory, () =>
    transaction(factory, (tx) => {
      tx.objectStore('recovery').put(
        { date: Date.now(), workspace: structuredClone(previous) },
        'before-last-restore',
      );
      tx.objectStore('workspace').put(copy, 'current');
    }),
  );
}
export async function recoveryEntries(factory: IDBFactory = indexedDB): Promise<unknown[]> {
  const db = await open(factory);
  return new Promise((resolve, reject) => {
    const tx = db.transaction('recovery', 'readonly'),
      req = tx.objectStore('recovery').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}
