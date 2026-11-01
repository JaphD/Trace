import type { SupplierChange } from '../core/supplier-changes';
export type RefreshReport = {
  id: number;
  checked: number;
  failed: number;
  changes: SupplierChange[];
};
export function RefreshSummary({
  report,
  projectId,
  onPart,
}: {
  report: RefreshReport;
  projectId: string;
  onPart: (code: string) => void;
}) {
  const changes = report.changes.filter((c) => c.projectId === projectId);
  return (
    <details className="refresh-summary" open={changes.length > 0}>
      <summary>
        Last refresh ·{' '}
        {new Date(report.id).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ·{' '}
        {report.checked} parts checked{report.failed > 0 ? ` · ${report.failed} failed` : ''} ·{' '}
        {changes.length
          ? `${changes.length} changes in this project`
          : 'no tracked changes in this project'}
      </summary>
      {report.failed > 0 && (
        <p className="amber">Failed lookups kept cached data. Recheck before ordering.</p>
      )}
      {changes.length > 0 ? (
        <ul>
          {changes.map((c, i) => (
            <li key={i}>
              <button onClick={() => onPart(c.code)}>{c.code}</button>
              <span>{c.message}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">
          Tracks library, assembly service, stock coverage and purchase requirements. First lookups
          establish a baseline.
        </p>
      )}
      <p className="muted">
        Checks run while TRACE is open. This summary is for the latest refresh; earlier alerts
        remain in Workspace tools → Activity.
      </p>
    </details>
  );
}
