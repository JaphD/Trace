import { describe, it, expect } from 'vitest';
import { parseBom } from './bom';
import { excelRowsToCsv } from './bom-file';
import readXlsxFile from 'read-excel-file/node';
import { fileURLToPath } from 'node:url';
describe('Excel-style BOM headers and DNP', () => {
  it('reports the original Excel row after leading and internal blank rows', () => {
    const converted = excelRowsToCsv([
      [],
      ['Name', 'Designator', 'Qty', 'LCSC Part'],
      [],
      ['10K', '', 1, 'C1'],
    ]);
    const p = parseBom(converted.text, undefined, converted.sourceRows);
    expect(p.rows[0].sourceRow).toBe(4);
  });
  it('reads a synthetic workbook with all rows and DNP positions preserved', async () => {
    const grid = await readXlsxFile(
      fileURLToPath(new URL('./fixtures/synthetic-bom.xlsx', import.meta.url)),
    );
    const converted = excelRowsToCsv(grid);
    const p = parseBom(converted.text, undefined, converted.sourceRows);
    expect(p.rows).toHaveLength(4);
    expect(p.warnings).toEqual([]);
    expect(p.rows.flatMap((r) => r.issues)).toEqual([]);
    expect(p.rows.filter((r) => r.population === 'dnp').flatMap((r) => r.refs)).toEqual([
      'C2',
      'J1',
    ]);
    expect(p.rows.filter((r) => r.population === 'jlc').reduce((s, r) => s + r.qty!, 0)).toBe(3);
    expect(p.rows[0].value).toBe('10K, 1%');
  });
  it('preserves CSV quoting and rejects an empty or header-only worksheet', () => {
    expect(() => excelRowsToCsv([])).toThrow(/header/);
    expect(() => excelRowsToCsv([['Name']])).toThrow(/header/);
    const p = parseBom(
      excelRowsToCsv([
        ['Comment', 'Designator', 'Qty', 'LCSC Part'],
        ['10K, 1%', 'R1', 1, 'C1'],
      ]).text,
    );
    expect(p.rows[0].value).toBe('10K, 1%');
  });
  it('recognizes Name and excludes exact DNP markers while keeping the other placements', () => {
    const p = parseBom(
      'Name,Designator,LCSC Part #,Manufacturer Part,Footprint,Quantity\n100nF,"C1,C2",C14663,CC0603,C0603,2\nDNP,C3,C14663,CC0603,C0603,1',
    );
    expect(p.mapping.value).toBe('Name');
    expect(p.rows.map((r) => r.population)).toEqual(['jlc', 'dnp']);
    expect(p.rows[1].populationExplicit).toBe(true);
    expect(p.warnings).toEqual([]);
  });
  it('respects an explicit false DNP column and does not mistake a part name containing DNP for exclusion', () => {
    const p = parseBom('Name,Designator,Qty,LCSC Part,DNP\nDNP,R1,1,C1,no\nDNP123,R2,1,C2,');
    expect(p.rows.map((r) => r.population)).toEqual(['jlc', 'jlc']);
  });
  it('keeps a deliberate custom value mapping instead of guessing from Name', () => {
    const p = parseBom('Name,Designator,Qty,LCSC Part,Comment\nDNP,R1,1,C1,10K');
    const custom = parseBom('Name,Designator,Qty,LCSC Part,Comment\nDNP,R1,1,C1,10K', {
      ...p.mapping,
      value: 'Comment',
    });
    expect(custom.rows[0].population).toBe('jlc');
  });
});
