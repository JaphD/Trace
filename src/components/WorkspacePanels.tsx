import React, { useState } from 'react';
import { Plus, Trash2, Download } from 'lucide-react';
import { uid, type Workspace, type Project, type Build, type InventoryLot } from '../core/types';
import {
  activeDemand,
  allocate,
  calculate,
  buildRows,
  boardCount,
  saveScenario,
  copyScenarioToWorking,
  defaultPricing,
} from '../core/calculations';
import { diffRows } from '../core/bom';
import { removeRevision } from '../core/storage';
import {
  Field,
  NumberField,
  Badge,
  Modal,
  NameDialog,
  useConfirmation,
  Empty,
  money,
  count,
  when,
  download,
  safeName,
} from './common';
export function Settings({
  w,
  onChange,
  onClose,
  onRecovery,
}: {
  w: Workspace;
  onChange: (w: Workspace) => void;
  onClose: () => void;
  onRecovery: () => void;
}) {
  return (
    <Modal title="Local preferences & pricing" onClose={onClose}>
      <p className="notice">
        No account, cloud sync or telemetry. Data lives in this browser on this origin. Export
        backups before changing browser, port or computer.
      </p>
      <details>
        <summary>Update recovery</summary>
        <p className="muted">
          A local snapshot preserves the workspace from the first launch of this release. It is
          stored in this browser and cannot replace a backup saved outside it.
        </p>
        <button onClick={onRecovery}>Export pre-update snapshot</button>
      </details>
      <div className="form-grid">
        <NumberField
          label="Polling interval (minutes)"
          value={w.settings.pollMinutes}
          min={1}
          onChange={(n) => onChange({ ...w, settings: { ...w.settings, pollMinutes: n || 5 } })}
        />
        <NumberField
          label="Mark observations stale after (minutes)"
          value={w.settings.staleMinutes}
          min={1}
          onChange={(n) => onChange({ ...w, settings: { ...w.settings, staleMinutes: n || 30 } })}
        />
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={w.settings.pollEnabled}
          onChange={(e) =>
            onChange({ ...w, settings: { ...w.settings, pollEnabled: e.target.checked } })
          }
        />
        Poll tracked parts while the app is open
      </label>
      <p className="muted">
        Closing this app stops monitoring. Sleep and network interruptions leave observation gaps.
      </p>
      <h3>Assembly pricing profile · USD</h3>
      <button
        onClick={() => {
          const reference = defaultPricing();
          onChange({
            ...w,
            pricing: {
              ...w.pricing,
              standardFeeder: reference.standardFeeder,
              standardSetup: reference.standardSetup,
              standardStencil: reference.standardStencil,
              economicExtended: reference.economicExtended,
              economicSetup: reference.economicSetup,
              economicStencil: reference.economicStencil,
              date: reference.date,
              note: reference.note,
              verified: false,
            },
          });
        }}
      >
        Use supplied quote reference rates
      </button>
      <p className="muted">
        Existing profiles are preserved. Apply the 1 Nov reference rates: Economic $8.24 setup /
        $1.55 stencil / $3.09 Extended loading, Standard $25.75 / $8.27 / $1.55 loading per type.
        Individual supplier loading exemptions can still differ.
      </p>
      <div className="form-grid">
        <Field label="Profile date">
          <input
            type="date"
            value={w.pricing.date}
            onChange={(e) =>
              onChange({ ...w, pricing: { ...w.pricing, date: e.target.value, verified: false } })
            }
          />
        </Field>
        {(
          [
            'economicExtended',
            'standardFeeder',
            'economicSetup',
            'standardSetup',
            'economicStencil',
            'standardStencil',
          ] as const
        ).map((k) => (
          <NumberField
            key={k}
            label={
              {
                economicExtended: 'Economic Extended loading',
                standardFeeder: 'Standard loading / part',
                economicSetup: 'Economic setup',
                standardSetup: 'Standard setup / side',
                economicStencil: 'Economic stencil',
                standardStencil: 'Standard stencil / side',
              }[k]
            }
            value={w.pricing[k]}
            step={0.01}
            onChange={(n) =>
              onChange({ ...w, pricing: { ...w.pricing, [k]: n || 0, verified: false } })
            }
          />
        ))}
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={w.pricing.preferredFree}
          onChange={(e) =>
            onChange({
              ...w,
              pricing: { ...w.pricing, preferredFree: e.target.checked, verified: false },
            })
          }
        />
        Extended (Preferred) parts exempt from Economic loading fees
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={w.pricing.verified}
          onChange={(e) =>
            onChange({ ...w, pricing: { ...w.pricing, verified: e.target.checked } })
          }
        />
        I verified these rates against my current quote
      </label>
      <Field label="Profile notes">
        <textarea
          value={w.pricing.note}
          onChange={(e) => onChange({ ...w, pricing: { ...w.pricing, note: e.target.value } })}
        />
      </Field>
      <a href="https://jlcpcb.com/help/article/pcb-assembly-price" target="_blank" rel="noreferrer">
        JLCPCB fee reference ↗
      </a>
      <p className="muted">
        Special-component fees use supplier metadata. X-ray, packaging and SMT fees are excluded.
        Other charges may be entered manually; PCB manufacture and board services are excluded.
      </p>
    </Modal>
  );
}
export function DemandPanel({ w }: { w: Workspace }) {
  const demand = activeDemand(w.projects, w.observations, w.settings.staleMinutes);
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">WORKSPACE VIEW</span>
          <h2>Demand across planned builds</h2>
        </div>
        <Badge>{demand.length} parts / sources</Badge>
      </div>
      <p className="muted">
        Only builds marked Planned contribute here. Simulations, working quantities and completed
        orders are excluded. Each build retains its own pricing tiers and setup fees.
      </p>
      {!demand.length ? (
        <Empty title="No committed demand yet">
          Save a build scenario and mark it Planned when you intend to order.
        </Empty>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Component</th>
                <th>Builds</th>
                <th>Source</th>
                <th>Required</th>
                <th>Public stock</th>
                <th>Coverage</th>
              </tr>
            </thead>
            <tbody>
              {demand.map((d) => (
                <tr key={d.source + d.code}>
                  <td className="mono">{d.code}</td>
                  <td>{d.builds.join(' · ')}</td>
                  <td>{d.source}</td>
                  <td>{count(d.required)}</td>
                  <td>{count(d.stock)}</td>
                  <td>
                    <Badge
                      tone={
                        d.incomplete || d.stale || d.stock === null
                          ? 'warn'
                          : d.stock < d.required
                            ? 'bad'
                            : 'good'
                      }
                    >
                      {d.incomplete
                        ? 'Incomplete BOM demand'
                        : d.stale
                          ? 'Stale / failed lookup'
                          : d.stock === null
                            ? 'Check allocations / unknown'
                            : d.stock < d.required
                              ? 'Short ' + (d.required - d.stock)
                              : 'Snapshot covers demand'}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
export function InventoryPanel({
  w,
  onChange,
}: {
  w: Workspace;
  onChange: (w: Workspace) => void;
}) {
  const confirmation = useConfirmation();
  const [lot, setLot] = useState<InventoryLot>({
      id: uid(),
      code: '',
      quantity: 0,
      source: 'private',
      status: 'incoming',
      date: Date.now(),
      notes: '',
      unitCost: null,
      allocations: [],
    }),
    [error, setError] = useState('');
  const builds = w.projects.flatMap((p) =>
    [p.workingBuild, ...p.builds].map((b, index) => ({
      id: b.id,
      name: p.name + ' / ' + b.name + (index === 0 ? ' [working editor]' : ' [' + b.status + ']'),
      status: b.status,
    })),
  );
  const [selection, setSelection] = useState<Record<string, string>>({}),
    [quantities, setQuantities] = useState<Record<string, number>>({});
  return (
    <section className="panel">
      {confirmation.dialog}
      <span className="eyebrow">MANUALLY MAINTAINED · LOCAL</span>
      <h2>Owned component inventory</h2>
      <p className="muted">
        Incoming parts and bench stock never cover JLCPCB placement. Allocate received
        private/consigned parts to a build and select “Owned stock” in its configuration.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!/^C\d+$/.test(lot.code) || !Number.isInteger(lot.quantity) || lot.quantity < 1) {
            setError('Enter a C-number and a positive whole quantity.');
            return;
          }
          onChange({ ...w, inventory: [...w.inventory, { ...lot, id: uid(), date: Date.now() }] });
          setLot({ ...lot, code: '', quantity: 0, notes: '' });
          setError('');
        }}
      >
        <div className="form-grid">
          <Field label="C-number">
            <input
              required
              pattern="C[0-9]+"
              value={lot.code}
              onChange={(e) => setLot({ ...lot, code: e.target.value.toUpperCase() })}
            />
          </Field>
          <NumberField
            label="Quantity"
            value={lot.quantity}
            onChange={(n) => setLot({ ...lot, quantity: n || 0 })}
          />
          <Field label="Location / source">
            <select
              value={lot.source}
              onChange={(e) => setLot({ ...lot, source: e.target.value as any })}
            >
              <option value="private">Private stock at JLCPCB</option>
              <option value="consigned">Consigned to JLCPCB</option>
              <option value="bench">My bench</option>
            </select>
          </Field>
          <Field label="Status">
            <select
              value={lot.status}
              onChange={(e) => setLot({ ...lot, status: e.target.value as any })}
            >
              <option value="incoming">Ordered / incoming</option>
              <option value="received">Received</option>
            </select>
          </Field>
          <NumberField
            label="Original unit cost (USD)"
            value={lot.unitCost}
            step={0.0001}
            onChange={(n) => setLot({ ...lot, unitCost: n })}
          />
          <Field label="Notes / order reference">
            <input value={lot.notes} onChange={(e) => setLot({ ...lot, notes: e.target.value })} />
          </Field>
        </div>
        <button className="primary" type="submit">
          <Plus size={16} />
          Add inventory lot
        </button>
      </form>
      {error && <p className="notice danger">{error}</p>}
      <div className="inventory-lots">
        {w.inventory.map((l) => (
          <article key={l.id} className="inventory-lot">
            <div className="section-heading">
              <div>
                <strong className="mono">{l.code}</strong> <Badge>{l.source}</Badge>{' '}
                <Badge tone={l.status === 'received' ? 'good' : 'warn'}>{l.status}</Badge>
                <p>
                  {l.notes || 'No notes'} · {count(l.quantity)} units · value{' '}
                  {l.unitCost === null ? 'unknown' : money(l.quantity * l.unitCost)}
                </p>
              </div>
              <button
                className="icon-button danger-text"
                aria-label={'Delete lot ' + l.code}
                onClick={async () => {
                  if (await confirmation.ask('Delete this lot and its allocations?'))
                    onChange({ ...w, inventory: w.inventory.filter((x) => x.id !== l.id) });
                }}
              >
                <Trash2 size={16} />
              </button>
            </div>
            {l.status === 'incoming' && (
              <button
                onClick={() =>
                  onChange({
                    ...w,
                    inventory: w.inventory.map((x) =>
                      x.id === l.id ? { ...x, status: 'received', date: Date.now() } : x,
                    ),
                  })
                }
              >
                Mark received
              </button>
            )}
            <p className="muted">
              {count(l.quantity - l.allocations.reduce((s, a) => s + a.quantity, 0))} unallocated.{' '}
              {l.allocations
                .map(
                  (a) =>
                    (builds.find((b) => b.id === a.buildId)?.name || 'Missing build') +
                    ': ' +
                    a.quantity,
                )
                .join(' · ')}
            </p>
            {l.status === 'received' && l.source !== 'bench' && (
              <div className="inline-controls">
                <select
                  aria-label={'Allocate ' + l.code + ' to build'}
                  value={selection[l.id] || ''}
                  onChange={(e) => setSelection({ ...selection, [l.id]: e.target.value })}
                >
                  <option value="">Choose build</option>
                  {builds.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <input
                  aria-label={'Allocation quantity for ' + l.code}
                  type="number"
                  min="0"
                  placeholder="Qty (0 releases)"
                  value={quantities[l.id] ?? ''}
                  onChange={(e) => setQuantities({ ...quantities, [l.id]: Number(e.target.value) })}
                />
                <button
                  disabled={!selection[l.id]}
                  onClick={() => {
                    try {
                      onChange({
                        ...w,
                        inventory: allocate(
                          w.inventory,
                          l.id,
                          selection[l.id],
                          quantities[l.id] || 0,
                        ),
                      });
                      setError('');
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Set allocation
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
export function RevisionsPanel({
  p,
  w,
  onChange,
}: {
  p: Project;
  w: Workspace;
  onChange: (p: Project) => void;
}) {
  const [naming, setNaming] = useState(false);
  const confirmation = useConfirmation();
  const [selected, setSelected] = useState(p.revisions.at(-1)?.id || ''),
    [basis, setBasis] = useState<'current' | 'saved'>('current');
  const rev = p.revisions.find((r) => r.id === selected),
    changes = rev ? diffRows(rev.rows, p.rows) : [];
  const pinnedBuilds = [p.workingBuild, ...p.builds].filter((b) => b.revisionId === selected);
  const current = calculate(
    p.rows,
    w.observations,
    p.workingBuild,
    w.pricing,
    w.inventory,
    w.settings.staleMinutes,
  );
  const previous = rev
    ? calculate(
        rev.rows,
        basis === 'saved' ? rev.observations : w.observations,
        basis === 'saved' ? rev.build : p.workingBuild,
        basis === 'saved' ? rev.pricing : w.pricing,
        basis === 'saved' ? rev.inventory || [] : w.inventory,
        w.settings.staleMinutes,
      )
    : null;
  const snapshot = (name: string) => {
    const r = {
      id: uid(),
      name: name.trim(),
      date: Date.now(),
      rows: structuredClone(p.rows),
      observations: structuredClone(w.observations),
      build: structuredClone(p.workingBuild),
      pricing: structuredClone(w.pricing),
      inventory: structuredClone(w.inventory),
    };
    onChange({ ...p, revisions: [...p.revisions, r] });
    setSelected(r.id);
    setNaming(false);
  };
  return (
    <section className="panel">
      {naming && (
        <NameDialog
          title="Name revision snapshot"
          initialValue={'Rev ' + (p.revisions.length + 1)}
          onSave={snapshot}
          onClose={() => setNaming(false)}
        />
      )}
      <div className="section-heading">
        <div>
          <span className="eyebrow">DESIGN CONTINUITY</span>
          <h2>Revisions & pre-order snapshots</h2>
        </div>
        <button className="primary" onClick={() => setNaming(true)}>
          <Plus size={16} />
          Freeze current BOM
        </button>
      </div>
      <p className="muted">
        Snapshots preserve parts, observations, build assumptions and pricing. They are plans, not
        submitted orders. Refresh first if you need a current stock check.
      </p>
      {confirmation.dialog}
      {!p.revisions.length ? (
        <Empty title="Keep a checkpoint before the next design change">
          Freeze the current BOM, or let re-import save the previous revision automatically.
        </Empty>
      ) : (
        <>
          <div className="inline-controls">
            <Field label="Compare with working BOM">
              <select value={selected} onChange={(e) => setSelected(e.target.value)}>
                <option value="">Choose revision</option>
                {p.revisions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} · {when(r.date)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Cost comparison">
              <select value={basis} onChange={(e) => setBasis(e.target.value as any)}>
                <option value="current">Same current build quantity and prices</option>
                <option value="saved">Saved assumptions versus current</option>
              </select>
            </Field>
            {rev && (
              <button
                onClick={() =>
                  download(
                    safeName(p.name) + '-' + safeName(rev.name) + '-snapshot.json',
                    JSON.stringify(
                      { ...rev, kind: 'pre-order snapshot', estimate: previous },
                      null,
                      2,
                    ),
                  )
                }
              >
                <Download size={16} />
                Export snapshot
              </button>
            )}
            {rev && (
              <button
                className="danger-text"
                disabled={pinnedBuilds.length > 0}
                onClick={async () => {
                  if (
                    await confirmation.ask(
                      `Delete frozen BOM “${rev.name}”, including its saved observations and pricing? Export the snapshot first if you need a copy.`,
                    )
                  ) {
                    onChange(removeRevision(p, rev.id));
                    setSelected(p.revisions.find((r) => r.id !== rev.id)?.id || '');
                  }
                }}
              >
                <Trash2 size={16} />
                Delete revision
              </button>
            )}
          </div>
          {rev && pinnedBuilds.length > 0 && (
            <p className="notice">
              To delete this revision, first unpin it from these builds in Build &amp; cost:{' '}
              {pinnedBuilds.map((b) => b.name).join(', ')}. For a saved scenario, copy it to the
              build editor, choose the working BOM, then update the original scenario.
            </p>
          )}
          {rev && (
            <>
              <p className="notice">
                Revision estimate{' '}
                {previous?.eligibility.status === 'ineligible'
                  ? 'Review assembly service'
                  : money(previous?.total)}{' '}
                → current{' '}
                {current.eligibility.status === 'ineligible'
                  ? 'Review assembly service'
                  : money(current.total)}
                .{' '}
                {basis === 'saved'
                  ? 'Quantities and assumptions may differ.'
                  : 'Both calculated with the current build quantity and pricing profile.'}{' '}
                Partial estimates; exclusions still apply.
              </p>
              <div className="change-list">
                {changes.length ? (
                  changes.map((d, i) => (
                    <div key={i}>
                      <Badge
                        tone={d.kind === 'removed' ? 'bad' : d.kind === 'added' ? 'good' : 'warn'}
                      >
                        {d.kind}
                      </Badge>
                      <strong>{d.label}</strong>
                      <span>{d.detail}</span>
                    </div>
                  ))
                ) : (
                  <p className="muted">No BOM differences.</p>
                )}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
export function ScenariosPanel({
  p,
  w,
  onChange,
  onDelete,
}: {
  p: Project;
  w: Workspace;
  onChange: (p: Project) => void;
  onDelete: (build: Build) => void;
}) {
  const [naming, setNaming] = useState(false);
  const save = (name: string) => {
    onChange(saveScenario(p, name));
    setNaming(false);
  };
  return (
    <section className="panel">
      {naming && (
        <NameDialog
          title="Name build scenario"
          initialValue="Prototype"
          onSave={save}
          onClose={() => setNaming(false)}
        />
      )}
      <div className="section-heading">
        <div>
          <span className="eyebrow">PROTOTYPE → PILOT → PRODUCTION</span>
          <h2>Build scenarios</h2>
        </div>
        <div className="actions">
          {p.workingBuild.basedOnBuildId && (
            <button
              onClick={() =>
                onChange(saveScenario(p, p.workingBuild.name, p.workingBuild.basedOnBuildId))
              }
            >
              Update original scenario
            </button>
          )}
          <button className="primary" onClick={() => setNaming(true)}>
            <Plus size={16} />
            Save as new scenario
          </button>
        </div>
      </div>
      <p className="muted">
        Scenario quantities do not count toward workspace demand. Mark a build Planned to include
        it. “Ordered” is a manual record, not an order submission.
      </p>
      {!p.builds.length ? (
        <Empty title="Compare the next few runs">
          Configure a build, then save it here. Pin a revision in Build & cost if a scenario should
          stay fixed.
        </Empty>
      ) : (
        <div className="scenario-grid">
          {p.builds.map((b) => {
            const c = calculate(
              buildRows(p, b),
              w.observations,
              b,
              w.pricing,
              w.inventory,
              w.settings.staleMinutes,
            );
            return (
              <article className="scenario" key={b.id}>
                <Badge>{b.mode}</Badge>
                <h3>{b.name}</h3>
                <p>
                  {boardCount(b)} boards ·{' '}
                  {b.revisionId
                    ? p.revisions.find((r) => r.id === b.revisionId)?.name
                    : 'Working BOM'}
                </p>
                <strong className="scenario-cost">
                  {c.eligibility.status === 'ineligible'
                    ? 'Review assembly service'
                    : money(c.total)}
                </strong>
                <p>
                  {c.eligibility.status !== 'ineligible' && <>{money(c.perBoard)} / board · </>}
                  {c.shortages} shortages · {c.unknown} unknown
                </p>
                <p className="muted">
                  {c.exclusions.length} assumptions/exclusions · eligibility {c.eligibility.status}
                </p>
                <Field label="Build status">
                  <select
                    value={b.status}
                    onChange={(e) =>
                      onChange({
                        ...p,
                        builds: p.builds.map((x) =>
                          x.id === b.id ? { ...x, status: e.target.value as any } : x,
                        ),
                      })
                    }
                  >
                    {['scenario', 'planned', 'ordered', 'completed', 'cancelled'].map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </Field>
                <button onClick={() => onChange(copyScenarioToWorking(p, b.id))}>
                  Copy to build editor
                </button>
                <button className="danger-text" onClick={() => onDelete(b)}>
                  <Trash2 size={16} />
                  Delete scenario
                </button>
                <small>
                  The saved build remains unchanged. Edit the copy in Build & cost, then update the
                  original here. Its allocations keep their build ID.
                </small>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
