import type { BomRow } from './types';
import { validateRows } from './bom';
export type ReimportMessage = { refs: string; message: string; review: boolean };
export function reconcileBom(
  old: BomRow[],
  incoming: BomRow[],
): { rows: BomRow[]; messages: ReimportMessage[]; needsReview: boolean } {
  const messages: ReimportMessage[] = [],
    usedIds = new Set<string>();
  const previousRefs = new Map<string, BomRow[]>(),
    incomingRefs = new Map<string, number>();
  for (const row of old)
    for (const ref of row.refs) previousRefs.set(ref, [...(previousRefs.get(ref) || []), row]);
  for (const row of incoming)
    for (const ref of row.refs) incomingRefs.set(ref, (incomingRefs.get(ref) || 0) + 1);
  const sameRefs = (a: BomRow, b: BomRow) =>
    [...a.refs].sort().join(',') === [...b.refs].sort().join(',');
  const idFor = (preferred: string) => {
    let id = preferred,
      suffix = 1;
    while (usedIds.has(id)) id = preferred + ':import-' + suffix++;
    usedIds.add(id);
    return id;
  };
  const inherit = (row: BomRow, prev?: BomRow): BomRow => {
    if (!prev) return { ...row, id: idFor(row.id) };
    const changed =
      row.qty !== prev.qty ||
      !sameRefs(row, prev) ||
      (['code', 'footprint', 'value', 'description', 'mpn'] as const).some(
        (k) => (prev[k] || '') !== (row[k] || ''),
      );
    if (!sameRefs(row, prev))
      messages.push({
        refs: row.refs.join(', '),
        review: false,
        message:
          'Saved notes and choices followed these designators. Alternative approvals require revalidation after regrouping.',
      });
    return {
      ...row,
      id: idFor(prev.id),
      notes: prev.notes,
      tags: [...prev.tags],
      critical: prev.critical,
      minStock: prev.minStock,
      population: row.populationExplicit ? row.population : prev.population,
      assembly: prev.code === row.code ? prev.assembly : undefined,
      identityReview: changed ? undefined : prev.identityReview,
      alternatives: prev.alternatives.map((a) =>
        changed
          ? { ...a, status: 'candidate', notes: a.notes + ' [Revalidate after BOM change]' }
          : { ...a },
      ),
    };
  };
  const result = incoming.flatMap((row) => {
    const label = row.refs.join(', ') || 'Source row ' + row.sourceRow;
    if (!row.refs.length) {
      const matches = old.filter((o) => !o.refs.length && o.code === row.code);
      const incomingMatches = incoming.filter((o) => !o.refs.length && o.code === row.code);
      if (matches.length === 0 || (matches.length === 1 && incomingMatches.length === 1))
        return [inherit(row, matches[0])];
      messages.push({
        refs: label,
        review: true,
        message:
          'Ambiguous previous rows without designators. Saved choices were not assigned; inspect the previous revision.',
      });
      return [inherit(row)];
    }
    const owners = row.refs.map((ref) => previousRefs.get(ref) || []);
    const ambiguous = owners.some(
      (matches, i) =>
        matches.length > 1 || ((incomingRefs.get(row.refs[i]) || 0) > 1 && matches.length > 0),
    );
    const previous = [...new Set(owners.flat())];
    const invalidPrevious = previous.some((prev) => prev.qty !== prev.refs.length);
    const groups = new Map<BomRow | undefined, string[]>();
    row.refs.forEach((ref, index) => {
      const owner = owners[index][0];
      groups.set(owner, [...(groups.get(owner) || []), ref]);
    });
    if (ambiguous || invalidPrevious || (previous.length > 0 && row.qty !== row.refs.length)) {
      messages.push({
        refs: label,
        review: true,
        message:
          'Ambiguous regrouping or inconsistent quantity. Source quantity kept unchanged; previous notes, choices and approvals are retained in the automatic revision, not assigned by guesswork.',
      });
      return [inherit(row)];
    }
    if (groups.size > 1)
      messages.push({
        refs: label,
        review: false,
        message: `Kept ${groups.size} circuit groups separate to preserve saved choices. Imported total quantity is unchanged.`,
      });
    return [...groups].map(([prev, refs]) =>
      inherit({ ...row, refs, qty: groups.size > 1 ? refs.length : row.qty }, prev),
    );
  });
  return { rows: validateRows(result), messages, needsReview: messages.some((m) => m.review) };
}
