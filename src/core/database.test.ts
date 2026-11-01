import { describe, it, expect } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  readWorkspace,
  writeWorkspace,
  replaceWorkspace,
  recoveryEntries,
  readBackupStatus,
  writeBackupStatus,
} from './database';
import { emptyWorkspace } from './storage';
function memoryStorage(initial: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(initial));
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      m.set(k, v);
    },
    removeItem: (k) => {
      m.delete(k);
    },
  };
}
describe('local IndexedDB storage', () => {
  it('records a once-per-release checkpoint before opening saved data and never overwrites it', async () => {
    const db = new IDBFactory(),
      w = emptyWorkspace();
    w.settings.staleMinutes = 60;
    await writeWorkspace(w, db);
    await readWorkspace(memoryStorage(), db);
    await writeWorkspace({ ...w, settings: { ...w.settings, staleMinutes: 90 } }, db);
    await readWorkspace(memoryStorage(), db);
    const checkpoints = (await recoveryEntries(db)) as any[];
    const release = checkpoints.filter((c) => c.appVersion === '0.1.0');
    expect(release).toHaveLength(1);
    expect(release[0].workspace.settings.staleMinutes).toBe(60);
    expect((await readWorkspace(memoryStorage(), db)).settings.staleMinutes).toBe(90);
  });
  it('persists device backup status separately from workspace replacement', async () => {
    const db = new IDBFactory(),
      w = emptyWorkspace();
    expect(await readBackupStatus(db)).toEqual({ lastExportAt: null, snoozedUntil: null });
    await writeBackupStatus({ lastExportAt: 123, snoozedUntil: null }, db);
    await replaceWorkspace(w, w, db);
    expect(await readBackupStatus(db)).toEqual({ lastExportAt: 123, snoozedUntil: null });
  });
  it('migrates existing localStorage without changing the original keys', async () => {
    const raw = JSON.stringify([{ id: 'p', name: 'Old', parts: [], batchSize: 5 }]);
    const storage = memoryStorage({ 'jlcpcb-projects': raw });
    const db = new IDBFactory();
    const w = await readWorkspace(storage, db);
    expect(w.projects[0].workingBuild.quantity).toBe(5);
    expect(storage.getItem('jlcpcb-projects')).toBe(raw);
    expect((await readWorkspace(memoryStorage(), db)).projects[0].name).toBe('Old');
  });
  it('persists the most recent workspace transaction', async () => {
    const db = new IDBFactory(),
      w = emptyWorkspace();
    await writeWorkspace(w, db);
    await writeWorkspace({ ...w, settings: { ...w.settings, staleMinutes: 60 } }, db);
    expect((await readWorkspace(memoryStorage(), db)).settings.staleMinutes).toBe(60);
  });
  it('rejects a malformed replacement without changing saved data', async () => {
    const db = new IDBFactory(),
      w = emptyWorkspace();
    await writeWorkspace(w, db);
    await expect(replaceWorkspace(w, { version: 99 } as any, db)).rejects.toThrow();
    expect((await readWorkspace(memoryStorage(), db)).version).toBe(2);
  });
});
