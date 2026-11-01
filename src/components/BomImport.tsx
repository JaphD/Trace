import React, { useMemo, useState, useRef, useEffect } from 'react';
import { excelRowsToCsv } from '../core/bom-file';
import { Upload, Check } from 'lucide-react';
import { parseBom, diffRows, type Mapping } from '../core/bom';
import { reconcileBom } from '../core/bom-reimport';
import type { BomRow } from '../core/types';
import { Modal, Field, Badge } from './common';
const mappingLabels: Record<keyof Mapping, string> = {
  code: 'LCSC / JLCPCB part number',
  refs: 'Reference designators',
  qty: 'Quantity',
  value: 'Value / comment',
  description: 'Description / specifications',
  footprint: 'Footprint / package',
  mpn: 'Manufacturer part number',
  dnp: 'DNP',
};
export function BomImport({
  rows,
  onImport,
  onClose,
}: {
  rows: BomRow[];
  onImport: (rows: BomRow[], revision: boolean, basis: 'board' | 'panel') => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(''),
    [mapping, setMapping] = useState<Mapping>(),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(rows.length > 0),
    [basis, setBasis] = useState<'board' | 'panel'>('board');
  const [sourceRows, setSourceRows] = useState<number[] | undefined>();
  const parsed = useMemo(
    () => (text ? parseBom(text, mapping, sourceRows) : null),
    [text, mapping, sourceRows],
  );
  const reconciliation = useMemo(() => reconcileBom(rows, parsed?.rows || []), [rows, parsed]);
  const next = reconciliation.rows;
  const [reviewedMatches, setReviewedMatches] = useState(false);
  useEffect(() => setReviewedMatches(false), [parsed]);
  const changes = useMemo(() => diffRows(rows, next), [rows, next]);
  const [excel, setExcel] = useState<{ file: File; sheets: string[]; sheet: string } | null>(null);
  const [reading, setReading] = useState(false);
  const readId = useRef(0);
  async function selectSheet(file: File, sheet: string) {
    const id = ++readId.current;
    setReading(true);
    setText('');
    setError('');
    try {
      const { default: readXlsxFile } = await import('read-excel-file');
      const csv = excelRowsToCsv(await readXlsxFile(file, { sheet }));
      if (id === readId.current) {
        setText(csv.text);
        setSourceRows(csv.sourceRows);
        setMapping(undefined);
      }
    } catch (e) {
      if (id === readId.current) setError('Could not read worksheet: ' + (e as Error).message);
    } finally {
      if (id === readId.current) setReading(false);
    }
  }
  async function read(file?: File) {
    if (!file) return;
    const id = ++readId.current;
    setText('');
    setExcel(null);
    setSourceRows(undefined);
    setMapping(undefined);
    setError('');
    setReading(true);
    try {
      if (file.size > 5e6) throw new Error('Please use a BOM smaller than 5 MB.');
      if (/\.xlsx$/i.test(file.name)) {
        const { readSheetNames } = await import('read-excel-file');
        const sheets = await readSheetNames(file);
        if (id !== readId.current) return;
        if (!sheets.length) throw new Error('This workbook has no worksheets.');
        setExcel({ file, sheets, sheet: sheets[0] });
        await selectSheet(file, sheets[0]);
      } else {
        if (!/\.(csv|tsv|txt)$/i.test(file.name))
          throw new Error(
            'Use .xlsx, .csv, .tsv or .txt. Older .xls files must be saved as .xlsx first.',
          );
        const text = await file.text();
        if (id === readId.current) setText(text);
      }
    } catch (e) {
      if (id === readId.current) setError((e as Error).message);
    } finally {
      if (id === readId.current) setReading(false);
    }
  }
  return (
    <Modal title="Import or update BOM" onClose={onClose} wide>
      <div
        className="dropzone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          read(e.dataTransfer.files[0]);
        }}
      >
        <Upload size={26} />
        <strong>Drop an Excel, CSV or TSV BOM</strong>
        <span>Every row stays in your project, including unresolved components.</span>
        <label className="button">
          Choose file
          <input
            aria-label="Choose BOM file"
            type="file"
            accept=".xlsx,.csv,.tsv,.txt"
            hidden
            onChange={(e) => read(e.target.files?.[0])}
          />
        </label>
      </div>
      {excel && (
        <Field
          label="Excel worksheet"
          hint="Only the selected worksheet is imported. Your file stays on this device."
        >
          <select
            value={excel.sheet}
            onChange={(e) => {
              const sheet = e.target.value;
              setExcel({ ...excel, sheet });
              void selectSheet(excel.file, sheet);
            }}
          >
            {excel.sheets.map((sheet) => (
              <option key={sheet}>{sheet}</option>
            ))}
          </select>
        </Field>
      )}
      {reading && <p role="status">Reading BOM…</p>}
      <details>
        <summary>Or paste BOM text</summary>
        <textarea
          aria-label="Paste BOM text"
          rows={5}
          value={text}
          onChange={(e) => {
            ++readId.current;
            setReading(false);
            setExcel(null);
            setSourceRows(undefined);
            setError('');
            setText(e.target.value);
            setMapping(undefined);
          }}
          placeholder={'Designator,Qty,LCSC Part,Value,Footprint\nR1,1,C25804,10k,0603'}
        />
      </details>
      {error && <p className="notice danger">{error}</p>}
      {parsed && (
        <>
          <div className="form-grid mapping">
            {Object.keys(parsed.mapping).map((k: keyof Mapping) => (
              <Field key={k} label={mappingLabels[k]}>
                <select
                  value={parsed.mapping[k]}
                  onChange={(e) => setMapping({ ...parsed.mapping, [k]: e.target.value })}
                >
                  <option value="">Not supplied</option>
                  {parsed.headers.map((h) => (
                    <option key={h}>{h}</option>
                  ))}
                </select>
              </Field>
            ))}
          </div>
          {parsed.warnings.map((w, i) => (
            <p className="notice warning" key={i}>
              {w}
            </p>
          ))}
          {parsed.rows.some((r) => r.population === 'dnp') && (
            <p className="notice">
              {parsed.rows.filter((r) => r.population === 'dnp').length} rows marked DNP. An
              explicit DNP column takes precedence; otherwise an exact “DNP” value is treated as do
              not place. Review the preview before importing.
            </p>
          )}
          <div className="inline-controls">
            <Field label="File describes">
              <select value={basis} onChange={(e) => setBasis(e.target.value as any)}>
                <option value="board">One board</option>
                <option value="panel">Complete panel</option>
              </select>
            </Field>
            {rows.length > 0 && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={revision || reconciliation.needsReview}
                  disabled={reconciliation.needsReview}
                  onChange={(e) => setRevision(e.target.checked)}
                />
                Save previous working BOM as a revision
              </label>
            )}
          </div>
          {reconciliation.messages.length > 0 && (
            <details open={reconciliation.needsReview}>
              <summary>
                Saved circuit choices · {reconciliation.messages.length} import notes
              </summary>
              {reconciliation.messages.map((m, i) => (
                <p key={i} className={m.review ? 'amber' : 'muted'}>
                  <strong>{m.refs}</strong> · {m.message}
                </p>
              ))}
            </details>
          )}
          {reconciliation.needsReview && (
            <div className="notice warning">
              <strong>Review ambiguous matches before importing</strong>
              <p>
                TRACE kept the source rows and quantities. Previous metadata is protected in an
                automatic revision. Check the notes above and resolve any remaining BOM issues after
                import.
              </p>
              <label className="check">
                <input
                  type="checkbox"
                  checked={reviewedMatches}
                  onChange={(e) => setReviewedMatches(e.target.checked)}
                />
                I reviewed the ambiguous matches
              </label>
            </div>
          )}
          <div className="table-scroll import-preview">
            <table>
              <thead>
                <tr>
                  <th>Refs / source row</th>
                  <th>C-number</th>
                  <th>Description / value</th>
                  <th>Qty</th>
                  <th>Review</th>
                </tr>
              </thead>
              <tbody>
                {next.map((r) => (
                  <tr key={r.id}>
                    <td>{r.refs.join(', ') || 'Row ' + r.sourceRow}</td>
                    <td className="mono">{r.code || 'Unresolved'}</td>
                    <td>{r.description || r.value || 'Not supplied'}</td>
                    <td>{r.qty ?? '?'}</td>
                    <td>
                      {r.issues.length ? (
                        r.issues.map((i) => (
                          <div key={i} className="amber">
                            {i}
                          </div>
                        ))
                      ) : (
                        <Badge tone="good">Parsed</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">
            {changes.filter((c) => c.kind === 'added').length} added ·{' '}
            {changes.filter((c) => c.kind === 'changed').length} changed ·{' '}
            {changes.filter((c) => c.kind === 'removed').length} removed. Descriptions, stock and
            prices are looked up automatically after import.
          </p>
          {rows.length > 0 && (
            <details>
              <summary>Review changes</summary>
              {changes.map((d, i) => (
                <p key={i}>
                  <Badge>{d.kind}</Badge> <strong>{d.label}</strong> {d.detail}
                </p>
              ))}
            </details>
          )}
          <footer>
            <span>
              {next.length} BOM rows · {next.filter((r) => r.issues.length).length} need review
            </span>
            <button
              className="primary"
              disabled={
                reading ||
                !next.length ||
                parsed.warnings.length > 0 ||
                (reconciliation.needsReview && !reviewedMatches)
              }
              onClick={() => onImport(next, revision || reconciliation.needsReview, basis)}
            >
              <Check size={16} />
              Import entire BOM
            </button>
          </footer>
        </>
      )}
    </Modal>
  );
}
