import React from 'react';
import type { Project, Build, Workspace } from '../core/types';
import { calculate, boardCount, buildRows } from '../core/calculations';
import { Field, NumberField, AssemblyQuantity, Badge, money, count } from './common';
import { AssemblyFeesPanel } from './AssemblyFeesPanel';
import { QuoteCostControls } from './QuoteCostControls';
export function BuildPanel({
  project,
  w,
  onChange,
}: {
  project: Project;
  w: Workspace;
  onChange: (b: Build) => void;
}) {
  const b = project.workingBuild,
    calc = calculate(
      buildRows(project, b),
      w.observations,
      b,
      w.pricing,
      w.inventory,
      w.settings.staleMinutes,
    );
  const patch = (v: Partial<Build>) =>
    onChange({
      ...b,
      ...v,
      ...(['mode', 'sides', 'quantity', 'boardsPerPanel', 'panelMethod'].some((k) => k in v)
        ? { boardReviewed: false }
        : {}),
    });
  return (
    <div className="build-layout">
      <section className="panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">BUILD CONFIGURATION</span>
            <h2>Set up the run</h2>
          </div>
          <Badge>{b.status}</Badge>
        </div>
        <div className="form-grid">
          <Field label="Build name">
            <input value={b.name} onChange={(e) => patch({ name: e.target.value })} />
          </Field>
          <Field label="BOM revision">
            <select
              value={b.revisionId || ''}
              onChange={(e) => patch({ revisionId: e.target.value || undefined })}
            >
              <option value="">Working BOM (follows edits)</option>
              {project.revisions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
          <AssemblyQuantity
            label="Boards or panels to assemble"
            value={b.quantity}
            onChange={(quantity) => patch({ quantity })}
          />
          <NumberField
            label="Boards per panel"
            value={b.boardsPerPanel}
            min={1}
            onChange={(n) => patch({ boardsPerPanel: Math.floor(n || 1) })}
          />
          <Field label="BOM quantity basis">
            <select value={b.bomBasis} onChange={(e) => patch({ bomBasis: e.target.value as any })}>
              <option value="board">Per single board</option>
              <option value="panel">Per complete panel</option>
            </select>
          </Field>
          <Field label="Assembly service">
            <select value={b.mode} onChange={(e) => patch({ mode: e.target.value as any })}>
              <option value="economic">Economic</option>
              <option value="standard">Standard</option>
            </select>
          </Field>
          <Field label="Assembly sides">
            <select value={b.sides} onChange={(e) => patch({ sides: e.target.value as any })}>
              <option value="single">Single side</option>
              <option value="double">Both sides</option>
            </select>
          </Field>
          <Field label="Inventory source">
            <select value={b.source} onChange={(e) => patch({ source: e.target.value as any })}>
              <option value="public">JLCPCB public stock</option>
              <option value="private">Owned stock allocated to this build</option>
            </select>
          </Field>
          <Field label="Target order date">
            <input
              type="date"
              value={b.targetDate || ''}
              onChange={(e) => patch({ targetDate: e.target.value })}
            />
          </Field>
        </div>
        <p className="notice">
          {count(boardCount(b))} assembled boards. Quantity means panels when boards per panel is
          greater than one. Components and assembly only; PCB manufacture and board services are
          excluded.
        </p>
        <details>
          <summary>Board eligibility inputs</summary>
          <div className="form-grid">
            <NumberField
              label="Width (mm)"
              value={b.width}
              onChange={(n) => patch({ width: n, boardReviewed: false })}
            />
            <NumberField
              label="Height (mm)"
              value={b.height}
              onChange={(n) => patch({ height: n, boardReviewed: false })}
            />
            <NumberField
              label="Layers"
              value={b.layers}
              onChange={(n) => patch({ layers: n, boardReviewed: false })}
            />
            <NumberField
              label="Thickness (mm)"
              value={b.thickness}
              step={0.1}
              onChange={(n) => patch({ thickness: n, boardReviewed: false })}
            />
            <Field label="Delivery format">
              <select
                value={b.panelMethod}
                onChange={(e) =>
                  patch({ panelMethod: e.target.value as any, boardReviewed: false })
                }
              >
                <option value="single">Single board</option>
                <option value="mouse-bites">Mouse bites</option>
                <option value="v-cut">V-cut</option>
              </select>
            </Field>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={b.boardReviewed}
              onChange={(e) => patch({ boardReviewed: e.target.checked })}
            />
            I checked dimensions, finish, color, panel and other board constraints against current
            JLCPCB capabilities.
          </label>
          <a
            href="https://jlcpcb.com/capabilities/pcb-assembly-capabilities"
            target="_blank"
            rel="noreferrer"
          >
            Open JLCPCB capabilities ↗
          </a>
        </details>
        <div
          className={'notice ' + (calc.eligibility.status === 'ineligible' ? 'danger' : 'warning')}
        >
          <strong>Eligibility: {calc.eligibility.status}</strong>
          {calc.eligibility.reasons.map((x, i) => (
            <div key={i}>{x}</div>
          ))}
        </div>
      </section>
      <section className="panel">
        <span className="eyebrow">COST ESTIMATE · USD</span>
        <h2>Components & assembly</h2>
        <QuoteCostControls build={b} calc={calc} onChange={patch} />
        {calc.eligibility.status === 'ineligible' && (
          <p className="notice danger">
            The selected assembly service is incompatible. The rates below are a draft; switch
            service before using the total.
          </p>
        )}
        <dl className="cost-list">
          {b.source === 'private' && (
            <div>
              <dt>Owned component value consumed (FIFO allocations)</dt>
              <dd>{money(calc.ownedValue)}</dd>
            </div>
          )}
          <div>
            <dt>
              {b.source === 'private'
                ? 'Public-price comparison (not new spending)'
                : 'Component subtotal (public pricing)'}
            </dt>
            <dd>{money(calc.componentCost)}</dd>
          </div>
          <div>
            <dt>Feeder loading {b.loadingOverride != null ? '(quoted)' : '(estimate)'}</dt>
            <dd>{money(calc.feederCost)}</dd>
          </div>
          <div>
            <dt>Setup + stencil reference</dt>
            <dd>{money(calc.fixedCost)}</dd>
          </div>
        </dl>
        <AssemblyFeesPanel fees={calc.assemblyFees} build={b} onChange={patch} />
        <div className="form-grid">
          {Object.entries(b.extras)
            .filter(([key]) => key !== 'fabrication')
            .map(([key, value]) => (
              <NumberField
                key={key}
                label={
                  key === 'assembly'
                    ? 'Other assembly fees (not listed above)'
                    : key.charAt(0).toUpperCase() + key.slice(1)
                }
                value={value}
                step={0.01}
                hint="Additional amounts only; avoid duplicating the fee lines above"
                onChange={(n) => patch({ extras: { ...b.extras, [key]: n } })}
              />
            ))}
        </div>
        {b.extras.fabrication != null && (
          <p className="muted">
            A previous PCB fabrication value is preserved in your data and excluded from this
            estimate.
          </p>
        )}
        <div className="cost-total">
          <span>
            {b.quoteOverride !== null ? 'Manual quote total' : 'Known estimated subtotal'}
          </span>
          <strong>
            {calc.eligibility.status === 'ineligible'
              ? 'Review assembly service'
              : money(calc.total)}
          </strong>
          <small>
            {b.costScope === 'selected' ? 'Selected quote budget' : 'Full BOM budget'}
            {calc.eligibility.status !== 'ineligible' && (
              <> · {money(calc.perBoard)} / assembled board</>
            )}
          </small>
        </div>
        <details>
          <summary>Manual quote override</summary>
          <NumberField
            label="Assembly-only quote total (USD)"
            value={b.quoteOverride}
            step={0.01}
            hint="Components and assembly only; exclude bare PCBs and board services"
            onChange={(n) => patch({ quoteOverride: n })}
          />
          <Field label="Quote date / reference / inclusions">
            <textarea value={b.quoteNote} onChange={(e) => patch({ quoteNote: e.target.value })} />
          </Field>
        </details>
        <div className="notice warning">
          <strong>Assumptions and exclusions</strong>
          {calc.exclusions.map((x) => (
            <div key={x}>• {x}</div>
          ))}
        </div>
        <p className="muted">
          Profile dated {w.pricing.date}. Unmodeled fees must be entered from your quote. This is a
          planning estimate, not a JLCPCB quote.
        </p>
      </section>
    </div>
  );
}
