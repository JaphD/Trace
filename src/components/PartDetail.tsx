import React, { useState } from 'react';
import { ExternalLink, RefreshCw, Plus, Trash2 } from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import {
  uid,
  type BomRow,
  type Observation,
  type Build,
  type Attrition,
  type Workspace,
} from '../core/types';
import { editRow } from '../core/bom';
import { IdentityReview } from './IdentityReview';
import { componentAssembly } from '../core/assembly-fees';
import { quantityRule } from '../core/quantities';
import { freshness, updateManualObservation } from '../core/supplier';
import { calculate } from '../core/calculations';
import { Modal, Field, NumberField, Badge, useConfirmation, when, money, count } from './common';
export function PartDetail({
  row,
  bomRows,
  w,
  build,
  onRow,
  onObservation,
  onBuild,
  onRefresh,
  onClose,
}: {
  row: BomRow;
  bomRows?: BomRow[];
  w: Workspace;
  build: Build;
  onRow: (r: BomRow) => void;
  onObservation: (o: Observation) => void;
  onBuild: (b: Build) => void;
  onRefresh: (codes: string[]) => void;
  onClose: () => void;
}) {
  const confirmation = useConfirmation();
  const o = w.observations[row.code],
    a = quantityRule(build, o, row.code).rule;
  const [alt, setAlt] = useState(''),
    [manual, setManual] = useState(false),
    [metric, setMetric] = useState<'stock' | 'price'>('stock');
  const patch = (v: Partial<BomRow>) => onRow(editRow(row, v));
  const processing = componentAssembly(row, o);
  const observation = (v: Partial<Observation>) =>
    onObservation(updateManualObservation(row.code, o, v));
  const attr = (v: Partial<Attrition>) =>
    onBuild({ ...build, attrition: { ...build.attrition, [row.code]: { ...a, ...v } } });
  const line = calculate(
    bomRows || [row],
    w.observations,
    build,
    w.pricing,
    w.inventory,
    w.settings.staleMinutes,
  ).lines.find((l) => l.rows.some((r) => r.id === row.id));
  return (
    <Modal
      title={(row.refs.join(', ') || 'BOM row') + ' · ' + (row.code || 'Unresolved')}
      onClose={onClose}
      wide
    >
      {confirmation.dialog}
      <div className="detail-top">
        <div>
          <h3>{o?.model || row.value || 'Component details'}</h3>
          <p>{row.description || o?.description || row.value || 'No description supplied.'}</p>
          <Badge tone={o?.error ? 'bad' : 'muted'}>
            {freshness(o, w.settings.staleMinutes)}
          </Badge>{' '}
          <small>Last stock observation: {when(o?.updatedAt)}</small>
          {o?.manualFields?.length > 0 && (
            <p className="muted">
              Manual fields: {o.manualFields.join(', ')} · {when(o.manualUpdatedAt)}
            </p>
          )}
          {o?.error && <p className="notice danger">{o.error}</p>}
        </div>
        <div className="actions">
          <button disabled={!/^C\d+$/.test(row.code)} onClick={() => onRefresh([row.code])}>
            <RefreshCw size={16} />
            Refresh
          </button>
          <a
            className="button"
            href={'https://jlcpcb.com/partdetail/' + encodeURIComponent(row.code)}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={16} />
            JLCPCB
          </a>
        </div>
      </div>
      <div className="form-grid">
        <Field label="JLCPCB C-number">
          <input
            value={row.code}
            onChange={(e) => patch({ code: e.target.value.trim().toUpperCase() })}
          />
        </Field>
        <Field label="Designators (comma separated)">
          <input
            defaultValue={row.refs.join(', ')}
            onBlur={(e) =>
              patch({
                refs: e.target.value
                  .split(/[,;\s]+/)
                  .filter(Boolean)
                  .map((x) => x.toUpperCase()),
              })
            }
          />
        </Field>
        <NumberField
          label="Per-BOM quantity"
          value={row.qty}
          onChange={(n) => patch({ qty: n === null ? null : Math.floor(n) })}
        />
        <Field label="Population">
          <select
            value={row.population}
            onChange={(e) => patch({ population: e.target.value as any })}
          >
            <option value="jlc">JLCPCB assembly</option>
            <option value="manual">I will assemble</option>
            <option value="dnp">DNP</option>
          </select>
        </Field>
        <Field label="Value / function">
          <input value={row.value} onChange={(e) => patch({ value: e.target.value })} />
        </Field>
        <Field
          label="Part description"
          hint="BOM description; supplier specifications fill in when this is empty"
        >
          <input
            value={row.description || ''}
            placeholder={o?.description || 'Resistor 10K 1% 0603'}
            onChange={(e) => patch({ description: e.target.value })}
          />
        </Field>
        <Field label="Footprint">
          <input value={row.footprint} onChange={(e) => patch({ footprint: e.target.value })} />
        </Field>
        <Field label="Manufacturer part number">
          <input value={row.mpn} onChange={(e) => patch({ mpn: e.target.value })} />
        </Field>
        <Field label="Tags (comma separated)">
          <input
            defaultValue={row.tags.join(', ')}
            onBlur={(e) =>
              patch({
                tags: e.target.value
                  .split(',')
                  .map((t) => t.trim())
                  .filter(Boolean),
              })
            }
          />
        </Field>
        <NumberField
          label="Low stock alert below"
          value={row.minStock ?? null}
          onChange={(n) => patch({ minStock: n ?? undefined })}
        />
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={!!row.critical}
          onChange={(e) => patch({ critical: e.target.checked })}
        />
        Critical / difficult to replace
      </label>
      <Field label="Circuit requirements and notes">
        <textarea value={row.notes} onChange={(e) => patch({ notes: e.target.value })} />
      </Field>
      {o?.footprint && (
        <p className="muted">
          Supplier package: {o.footprint}. Verify it against the BOM footprint and land pattern.
        </p>
      )}
      {row.issues.map((i) => (
        <p className="notice warning" key={i}>
          {i}
        </p>
      ))}
      <IdentityReview row={row} observation={o} onRow={onRow} />
      <details>
        <summary>Special processing fee</summary>
        <p className="muted">
          Special processing: {money(processing.specialFee, 4)} per placed unit (
          {processing.specialSource}). Verify against JLCPCB's quote.
        </p>
        <div className="form-grid">
          <NumberField
            label="Special fee per placed unit (USD)"
            value={row.assembly?.specialFee ?? null}
            step={0.0001}
            hint={
              'Blank uses supplier fee: ' +
              money(o?.assembly?.specialFee, 4) +
              '. Zero explicitly waives the fee.'
            }
            onChange={(n) => patch({ assembly: { ...row.assembly, specialFee: n } })}
          />
        </div>
        <p className="muted">
          Corrections apply to these circuit positions, survive supplier refreshes, and clear when
          the C-number changes. Manual-assembly and DNP rows are excluded from JLCPCB processing
          charges.
        </p>
      </details>
      <details>
        <summary>Attrition, minimums and spares for this build</summary>
        <p className="muted">
          Per C-number, aggregated across all matching BOM rows. Requirement = max(placements +
          fixed loss + rounded percentage loss, minimum) + spares. Automatic public rules use
          supplier minimum/loss metadata; Economic Basic parts use placement counts.
        </p>
        <p className="muted">
          {count(line?.placed)} placed · {count(line?.required)} required ·{' '}
          {line?.quantitySource || 'excluded'} rule. Supplier minimum:{' '}
          {count(o?.supplierRules?.minimum)}; extra loss: {count(o?.supplierRules?.extra)}. Verify
          larger batches and allowances for both sides against JLCPCB.
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={!!build.attrition[row.code]}
            onChange={(e) => {
              const next = { ...build.attrition };
              if (e.target.checked) next[row.code] = { ...a, verified: false };
              else delete next[row.code];
              onBuild({ ...build, attrition: next });
            }}
          />
          Use a manual quantity rule for this build
        </label>
        {build.attrition[row.code] && (
          <>
            <div className="form-grid">
              {(['extra', 'percent', 'minimum', 'spares'] as const).map((key) => (
                <NumberField
                  key={key}
                  label={
                    {
                      extra: 'Fixed attrition units',
                      percent: 'Attrition (%)',
                      minimum: 'Minimum quantity',
                      spares: 'Optional spares',
                    }[key]
                  }
                  value={a[key]}
                  onChange={(n) => attr({ [key]: n || 0, verified: false })}
                />
              ))}
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={a.verified}
                onChange={(e) => attr({ verified: e.target.checked })}
              />
              I verified this rule for this part and purchasing route.
            </label>
          </>
        )}
      </details>
      <details open>
        <summary>Alternatives for these circuit positions</summary>
        <p className="muted">
          Approval applies only to {row.refs.join(', ') || 'this row'}. Similar descriptions do not
          establish compatibility.
        </p>
        {row.alternatives.map((item, index) => {
          const ao = w.observations[item.code];
          const ac = calculate(
            [{ ...row, code: item.code }],
            w.observations,
            build,
            w.pricing,
            w.inventory,
            w.settings.staleMinutes,
          ).lines[0];
          return (
            <div className="alternative" key={index}>
              <div>
                <strong className="mono">{item.code}</strong>
                <small>
                  {count(ao?.stock)} in stock ·{' '}
                  {ao?.library === 'preferred' ? 'Extended (Preferred)' : ao?.library || 'unknown'}{' '}
                  · {ao?.eligibility || 'unknown'}
                </small>
                <small>
                  Row estimate: {money((ac?.cost ?? 0) + (ac?.fee ?? 0))}{' '}
                  {ac?.cost === null ? '(price unknown)' : ''}
                </small>
              </div>
              <select
                aria-label={'Approval for ' + item.code}
                value={item.status}
                onChange={(e) =>
                  onRow({
                    ...row,
                    alternatives: row.alternatives.map((x, i) =>
                      i === index ? { ...x, status: e.target.value as any, date: Date.now() } : x,
                    ),
                  })
                }
              >
                <option value="candidate">Candidate</option>
                <option value="footprint">Footprint/pinout checked</option>
                <option value="approved">Approved for this circuit</option>
                <option value="tested">Tested (note revision)</option>
              </select>
              <input
                aria-label={'Notes for ' + item.code}
                placeholder="Validation / tested revision"
                value={item.notes}
                onChange={(e) =>
                  onRow({
                    ...row,
                    alternatives: row.alternatives.map((x, i) =>
                      i === index ? { ...x, notes: e.target.value } : x,
                    ),
                  })
                }
              />
              <button
                disabled={!['approved', 'tested'].includes(item.status)}
                onClick={async () => {
                  if (
                    await confirmation.ask(
                      'Replace ' +
                        row.code +
                        ' with ' +
                        item.code +
                        ' at ' +
                        (row.refs.join(', ') || 'this row') +
                        '?',
                    )
                  )
                    onRow({
                      ...row,
                      code: item.code,
                      assembly: undefined,
                      notes:
                        row.notes +
                        '\nSelected ' +
                        item.code +
                        ' on ' +
                        new Date().toLocaleDateString(),
                      alternatives: row.alternatives.filter((_, i) => i !== index),
                    });
                }}
              >
                Use part
              </button>
              <button
                className="icon-button"
                aria-label={'Remove alternative ' + item.code}
                onClick={() =>
                  onRow({ ...row, alternatives: row.alternatives.filter((_, i) => i !== index) })
                }
              >
                <Trash2 size={15} />
              </button>
            </div>
          );
        })}
        <div className="inline-controls">
          <input
            aria-label="Alternative C-number"
            placeholder="C-number"
            value={alt}
            onChange={(e) => setAlt(e.target.value.toUpperCase())}
          />
          <button
            disabled={
              !/^C\d+$/.test(alt) ||
              row.alternatives.some((a) => a.code === alt) ||
              alt === row.code
            }
            onClick={() => {
              onRow({
                ...row,
                alternatives: [
                  ...row.alternatives,
                  { code: alt, status: 'candidate', notes: '', date: Date.now() },
                ],
              });
              onRefresh([alt]);
              setAlt('');
            }}
          >
            <Plus size={15} />
            Add candidate
          </button>
        </div>
      </details>
      <details>
        <summary>Supplier observation and manual corrections</summary>
        <p className="muted">
          Library classification and assembly eligibility are independent. Unsupported supplier
          fields remain unknown. A refresh replaces manual observations; verify them again.
        </p>
        <label className="check">
          <input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} />
          Edit a dated manual observation
        </label>
        {manual && /^C\d+$/.test(row.code) && (
          <div className="form-grid">
            <NumberField
              label="Observed public stock"
              value={o?.stock ?? null}
              onChange={(n) => observation({ stock: n })}
            />
            <Field label="Library classification">
              <select
                value={o?.library || 'unknown'}
                onChange={(e) => observation({ library: e.target.value as any })}
              >
                {['unknown', 'basic', 'preferred', 'extended'].map((x) => (
                  <option key={x} value={x}>
                    {x === 'preferred' ? 'Extended (Preferred)' : x}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Assembly eligibility">
              <select
                value={o?.eligibility || 'unknown'}
                onChange={(e) => observation({ eligibility: e.target.value as any })}
              >
                <option value="unknown">Unknown</option>
                <option value="economic">Economic-compatible</option>
                <option value="standard">Standard-only</option>
              </select>
            </Field>
            <NumberField
              label="Manual unit price (tier 1, USD)"
              value={o?.prices.find((p) => p.startNumber === 1)?.productPrice ?? null}
              step={0.0001}
              onChange={(n) =>
                observation({ prices: n === null ? [] : [{ startNumber: 1, productPrice: n }] })
              }
            />
          </div>
        )}
        {o?.prices.length > 0 && (
          <p className="mono">
            {o.prices.map((p) => p.startNumber + '+: ' + money(p.productPrice, 4)).join(' · ')}
          </p>
        )}
      </details>
      <details open>
        <summary>Observed stock and price history</summary>
        <div className="segmented">
          <button className={metric === 'stock' ? 'active' : ''} onClick={() => setMetric('stock')}>
            Stock
          </button>
          <button className={metric === 'price' ? 'active' : ''} onClick={() => setMetric('price')}>
            Unit price · tier quantity 1 · USD
          </button>
        </div>
        {o?.history.length > 1 ? (
          <div className="history-chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={o.history.map((h) => ({ ...h, time: new Date(h.date).toLocaleString() }))}
              >
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="time" hide />
                <YAxis width={60} stroke="var(--muted)" />
                <Tooltip
                  itemStyle={{ color: 'var(--text)' }}
                  contentStyle={{
                    background: 'var(--surface)',
                    color: 'var(--text)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                  }}
                />
                <Line
                  dataKey={metric}
                  stroke={metric === 'stock' ? 'var(--accent)' : 'var(--text-secondary)'}
                  type="stepAfter"
                  dot={false}
                  connectNulls={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="muted">
            At least two successful observations are needed. Monitoring runs while this app is open.
          </p>
        )}
        {o?.legacyPriceHistory && (
          <p className="muted">
            Legacy price history is preserved in backups; its quantity basis was not recorded.
          </p>
        )}
      </details>
      {line?.suggestion && (
        <p className="notice warning">
          Theoretical component-only break: {line.suggestion.quantity} units save{' '}
          {money(line.suggestion.savings)}. Verify purchase route, minimums and charges; this does
          not recommend assembling more boards.
        </p>
      )}
    </Modal>
  );
}
