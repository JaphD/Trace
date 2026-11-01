export { version as APP_VERSION } from '../../package.json';
export interface BackupStatus {
  lastExportAt: number | null;
  snoozedUntil: number | null;
}
export const emptyBackupStatus = (): BackupStatus => ({ lastExportAt: null, snoozedUntil: null });
export function backupDue(hasData: boolean, status: BackupStatus, now: number) {
  return (
    hasData &&
    !(status.snoozedUntil !== null && status.snoozedUntil > now) &&
    (status.lastExportAt === null || now - status.lastExportAt >= 7 * 86400000)
  );
}
