import Papa from 'papaparse';
export function excelRowsToCsv(rows: unknown[][]) {
  const indexed = rows
    .map((row, index) => ({ row, sourceRow: index + 1 }))
    .filter(({ row }) => row.some((v) => v !== null && v !== undefined && String(v).trim() !== ''));
  const populated = indexed.map((item) => item.row);
  if (populated.length < 2)
    throw new Error('This worksheet needs a header row and at least one BOM row.');
  if (populated.length > 10001 || populated.some((r) => r.length > 100))
    throw new Error('Please select a BOM worksheet with at most 10,000 rows and 100 columns.');
  const text = Papa.unparse(
    populated.map((r) =>
      r.map((v) => (v == null ? '' : v instanceof Date ? v.toISOString() : String(v))),
    ),
  );
  return { text, sourceRows: indexed.slice(1).map((item) => item.sourceRow) };
}
