import Papa from 'papaparse';
import { reconcileBom } from './bom-reimport';
import { uid, type BomRow } from './types';
export type Mapping = Record<
  'code' | 'refs' | 'qty' | 'value' | 'description' | 'footprint' | 'mpn' | 'dnp',
  string
>;
const aliases: Record<keyof Mapping, string[]> = {
  code: [
    'lcscpart',
    'lcscpartnumber',
    'lcsc',
    'jlcpart',
    'jlcpcbpart',
    'jlcpcb',
    'componentcode',
    'supplierpart',
    'lcscpartno',
    'jlcpartnumber',
  ],
  refs: [
    'designator',
    'designators',
    'reference',
    'references',
    'referencedesignator',
    'ref',
    'refs',
  ],
  qty: ['qty', 'quantity', 'count'],
  value: ['value', 'comment'],
  description: ['description', 'partdescription', 'specification', 'specifications'],
  footprint: ['footprint', 'package'],
  mpn: ['mpn', 'manufacturerpartnumber', 'manufacturerpart'],
  dnp: ['dnp', 'donotpopulate', 'donotplace'],
};
export function detectMapping(headers: string[]) {
  const mapping = {} as Mapping,
    warnings: string[] = [];
  for (const field of Object.keys(aliases) as (keyof Mapping)[]) {
    const matches = headers.filter((h) =>
      aliases[field].includes(h.toLowerCase().replace(/[^a-z0-9]/g, '')),
    );
    mapping[field] = matches[0] || '';
    if (matches.length > 1) warnings.push('Multiple columns match ' + field + ': choose one.');
  }
  if (!mapping.value) mapping.value = headers.find((h) => h.trim().toLowerCase() === 'name') || '';
  return { mapping, warnings };
}
export function validateRows(rows: BomRow[]): BomRow[] {
  const refs = new Map<string, number>();
  for (const r of rows) for (const ref of r.refs) refs.set(ref, (refs.get(ref) || 0) + 1);
  return rows.map((r) => {
    const issues: string[] = [];
    if (r.population !== 'dnp') {
      if (!/^C\d+$/i.test(r.code)) issues.push('Missing or invalid C-code');
      if (r.qty === null || !Number.isInteger(r.qty) || r.qty <= 0)
        issues.push('Missing or invalid quantity');
      if (r.refs.length && r.qty !== r.refs.length)
        issues.push('Quantity does not match designator count');
    }
    if (!r.refs.length) issues.push('No designators supplied');
    for (const ref of r.refs)
      if ((refs.get(ref) || 0) > 1) issues.push('Duplicate designator ' + ref);
    return { ...r, issues: [...new Set(issues)] };
  });
}
export function parseBom(csv: string, mappingOverride?: Mapping, sourceRows?: number[]) {
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim().replace(/^\uFEFF/, ''),
  });
  const headers = parsed.meta.fields || [];
  const { mapping: detected, warnings } = detectMapping(headers);
  const mapping = mappingOverride || detected;
  const rows = parsed.data.map((source, index) => {
    const get = (key: keyof Mapping) => String(source[mapping[key]] ?? '').trim();
    const refs = get('refs')
      .split(/[,;\s]+/)
      .filter(Boolean)
      .map((x) => x.toUpperCase());
    const qtyText = get('qty');
    const qty = qtyText !== '' ? Number(qtyText) : !mapping.qty && refs.length ? refs.length : null;
    const inferredDnp = !mapping.dnp && /^DNP$/i.test(get('value'));
    return {
      id: uid(),
      code: get('code').toUpperCase(),
      refs,
      qty: qty !== null && Number.isInteger(qty) && qty >= 0 ? qty : null,
      value: get('value'),
      description: get('description'),
      mpn: get('mpn'),
      footprint: get('footprint'),
      population: inferredDnp || /^(1|yes|true|dnp|x)$/i.test(get('dnp')) ? 'dnp' : 'jlc',
      populationExplicit: !!mapping.dnp || inferredDnp,
      tags: [],
      notes: '',
      alternatives: [],
      issues: [],
      sourceRow: sourceRows?.[index] ?? index + 2,
      source,
    } as BomRow;
  });
  return {
    headers,
    mapping,
    warnings: [...(mappingOverride ? [] : warnings), ...parsed.errors.map((e) => e.message)],
    rows: validateRows(rows),
  };
}
const refKey = (r: BomRow) => [...r.refs].sort().join(',');
export function reconcileRows(old: BomRow[], incoming: BomRow[]) {
  return reconcileBom(old, incoming).rows;
}
export function editRow(row: BomRow, patch: Partial<BomRow>): BomRow {
  const changed =
    (['code', 'footprint', 'value', 'description', 'mpn'] as const).some(
      (k) => k in patch && (patch[k] || '') !== (row[k] || ''),
    ) ||
    (patch.refs !== undefined &&
      JSON.stringify([...patch.refs].sort()) !== JSON.stringify([...row.refs].sort()));
  return {
    ...row,
    ...patch,
    assembly:
      patch.code !== undefined && patch.code !== row.code
        ? undefined
        : (patch.assembly ?? row.assembly),
    alternatives: changed
      ? row.alternatives.map((a) => ({
          ...a,
          status: 'candidate',
          notes: a.notes + ' [Revalidate after circuit change]',
        }))
      : row.alternatives,
  };
}
export function diffRows(old: BomRow[], next: BomRow[]) {
  const used = new Set<string>();
  const changes: { kind: 'added' | 'removed' | 'changed'; label: string; detail: string }[] = [];
  for (const r of next) {
    const candidates = old.filter(
      (o) => !used.has(o.id) && (o.id === r.id || (r.refs.length && refKey(o) === refKey(r))),
    );
    const prev = candidates.length === 1 ? candidates[0] : undefined;
    const label = r.refs.join(', ') || r.code || 'Unresolved row';
    if (!prev) {
      changes.push({ kind: 'added', label, detail: r.code });
      continue;
    }
    used.add(prev.id);
    const fields = (
      ['code', 'qty', 'footprint', 'population', 'value', 'description', 'mpn'] as const
    ).filter((k) => (k === 'description' ? (prev[k] || '') !== (r[k] || '') : prev[k] !== r[k]));
    if (fields.length)
      changes.push({
        kind: 'changed',
        label,
        detail: fields.map((k) => k + ': ' + prev[k] + ' → ' + r[k]).join('; '),
      });
  }
  for (const r of old)
    if (!used.has(r.id))
      changes.push({ kind: 'removed', label: r.refs.join(', ') || r.code, detail: r.code });
  return changes;
}
