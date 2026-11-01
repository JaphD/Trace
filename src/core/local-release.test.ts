import { describe, expect, it } from 'vitest';
import { backupDue, emptyBackupStatus, APP_VERSION } from './local-release';
describe('local release backup policy', () => {
  it('uses the first local release version', () => {
    expect(APP_VERSION).toBe('0.1.0');
  });
  it('reminds only when there is user data and no recent export', () => {
    const now = 10 * 86400000;
    expect(backupDue(false, emptyBackupStatus(), now)).toBe(false);
    expect(backupDue(true, emptyBackupStatus(), now)).toBe(true);
    expect(backupDue(true, { lastExportAt: now - 6 * 86400000, snoozedUntil: null }, now)).toBe(
      false,
    );
    expect(backupDue(true, { lastExportAt: now - 7 * 86400000, snoozedUntil: null }, now)).toBe(
      true,
    );
  });
  it('honours a one-day snooze without changing the last export date', () => {
    const status = { lastExportAt: null, snoozedUntil: 86400000 };
    expect(backupDue(true, status, 86399999)).toBe(false);
    expect(backupDue(true, status, 86400000)).toBe(true);
    expect(status.lastExportAt).toBeNull();
  });
});
