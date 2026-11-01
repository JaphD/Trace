import React from 'react';
import type { Build } from '../core/types';
import type { AssemblyFeeEstimate } from '../core/assembly-fees';
import { Badge, NumberField, count, money } from './common';

export function AssemblyFeesPanel({
  fees,
  build,
  onChange,
}: {
  fees: AssemblyFeeEstimate;
  build: Build;
  onChange: (patch: Partial<Build>) => void;
}) {
  const value = build.assemblyFees?.specialOverride;
  return (
    <>
      <dl className="cost-list processing-costs">
        <div>
          <dt>
            Special components{' '}
            {value != null ? (
              <Badge>Quote</Badge>
            ) : (
              !fees.specialComplete && <Badge tone="warn">Partial</Badge>
            )}
          </dt>
          <dd>{fees.specialComplete || fees.specialCost ? money(fees.specialCost) : 'Unknown'}</dd>
        </div>
      </dl>
      <p className="muted">X-ray, packaging and SMT fees are excluded from this estimate.</p>
      <details className="fee-details">
        <summary>Special-component fees</summary>
        <p className="muted">
          Supplier fee per placed component. Purchasing spares, attrition, DNP and manual-assembly
          parts do not add processing charges.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Part / refs</th>
                <th>Placed</th>
                <th>Fee / unit</th>
              </tr>
            </thead>
            <tbody>
              {fees.parts.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.code || 'Unresolved'}
                    <small>{p.refs.join(', ')}</small>
                  </td>
                  <td>{count(p.placed)}</td>
                  <td>
                    {money(p.specialFee, 4)}
                    <small>{p.specialSource}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <NumberField
          label="Special-components quote amount"
          value={value ?? null}
          step={0.01}
          hint="Optional total USD for this run; blank uses supplier fees, zero waives this fee"
          onChange={(n) =>
            onChange({ assemblyFees: { ...build.assemblyFees, specialOverride: n } })
          }
        />
      </details>
    </>
  );
}
