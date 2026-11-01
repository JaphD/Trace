import React from 'react';
import type { Build } from '../core/types';
import type { calculate } from '../core/calculations';
import { Field, NumberField, Badge, count, money } from './common';

export function QuoteCostControls({
  build,
  calc,
  onChange,
}: {
  build: Build;
  calc: ReturnType<typeof calculate>;
  onChange: (patch: Partial<Build>) => void;
}) {
  const excluded = build.excludedCodes || [];
  return (
    <>
      <Field label="Cost basis" hint="Availability and build blockers always cover the full BOM">
        <select
          value={build.costScope || 'full'}
          onChange={(e) => onChange({ costScope: e.target.value as 'full' | 'selected' })}
        >
          <option value="full">Full BOM budget</option>
          <option value="selected">JLCPCB quote selections</option>
        </select>
      </Field>
      {build.costScope === 'selected' && (
        <details className="quote-selection" open>
          <summary>
            Quote selections · {calc.costLines.length} / {calc.lines.length} part types
          </summary>
          <p className="muted">
            Match the parts selected in JLCPCB's order review. Excluded parts remain in your BOM and
            shortage checks.
          </p>
          <div className="actions">
            <button
              disabled={!calc.shortages}
              onClick={() =>
                onChange({
                  excludedCodes: [
                    ...new Set([
                      ...excluded,
                      ...calc.lines
                        .filter((l) => (l.shortage ?? 0) > 0)
                        .map((l) => l.code)
                        .filter((c) => /^C\d+$/.test(c)),
                    ]),
                  ],
                })
              }
            >
              Exclude current shortages from quote
            </button>
            <button onClick={() => onChange({ excludedCodes: [] })}>Include all</button>
          </div>
          <div className="quote-selection-list">
            {calc.lines.map((l) => (
              <label className="check" key={l.code}>
                <input
                  type="checkbox"
                  aria-label={'Include ' + l.code + ' in quote'}
                  disabled={!/^C\d+$/.test(l.code)}
                  checked={!excluded.includes(l.code)}
                  onChange={(e) =>
                    onChange({
                      excludedCodes: e.target.checked
                        ? excluded.filter((c) => c !== l.code)
                        : [...new Set([...excluded, l.code])],
                    })
                  }
                />
                <span>
                  {l.code} · {l.refs.join(', ')}
                  <small>
                    {count(l.placed)} placed · {count(l.required)} required
                    {(l.shortage ?? 0) > 0 ? ' · short ' + count(l.shortage) : ''}
                  </small>
                </span>
              </label>
            ))}
          </div>
        </details>
      )}
      <NumberField
        label="Quoted loading total (optional)"
        value={build.loadingOverride ?? null}
        step={0.01}
        hint={
          'Blank uses estimate ' +
          money(calc.estimatedFeederCost) +
          '. THT loading is zero; unexposed Preferred exemptions may still differ. Fixed total for this cost selection.'
        }
        onChange={(n) => onChange({ loadingOverride: n })}
      />
      {build.loadingOverride != null && <Badge>Loading amount from quote</Badge>}
    </>
  );
}
