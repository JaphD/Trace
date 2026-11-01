import type { BomRow, Observation } from '../core/types';
import { identityKey, identityWarnings } from '../core/identity';

export function IdentityReview({
  row,
  observation,
  onRow,
}: {
  row: BomRow;
  observation?: Observation;
  onRow: (row: BomRow) => void;
}) {
  const warnings = identityWarnings({ ...row, identityReview: undefined }, observation);
  if (!warnings.length)
    return (
      <p className="muted">
        Identity checks cover supplied MPNs and recognizable package sizes/pin counts. A missing
        warning does not verify the land pattern or pinout.
      </p>
    );
  const checked = row.identityReview === identityKey(row, observation);
  return (
    <div className={'notice ' + (checked ? '' : 'warning')}>
      <strong>{checked ? 'Identity differences checked' : 'Check part identity'}</strong>
      {warnings.map((w) => (
        <p key={w.kind}>
          {w.kind === 'mpn' ? 'MPN' : 'Package'}: BOM <b>{w.expected}</b> · JLCPCB{' '}
          <b>{w.observed}</b>
        </p>
      ))}
      <p>
        These may be naming differences or different variants. Check the datasheet, land pattern and
        pinout before accepting. TRACE does not substitute parts.
      </p>
      <button
        onClick={() =>
          onRow({ ...row, identityReview: checked ? undefined : identityKey(row, observation) })
        }
      >
        {checked ? 'Reopen identity review' : 'I checked these differences'}
      </button>
    </div>
  );
}
