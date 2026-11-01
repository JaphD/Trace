import type { Workspace } from './types';
import { buildRows, calculate } from './calculations';
import { serviceFor } from './component-view';
export type SupplierChange = {
  projectId: string;
  buildId?: string;
  code: string;
  kind: 'library' | 'service' | 'stock' | 'requirement' | 'threshold';
  message: string;
};
export function supplierChanges(
  before: Workspace,
  after: Workspace,
  successfulCodes: string[],
): SupplierChange[] {
  const changes: SupplierChange[] = [];
  const codes = [...new Set(successfulCodes)].filter(
    (code) =>
      before.observations[code]?.updatedAt > 0 &&
      after.observations[code]?.updatedAt > 0 &&
      !after.observations[code].error,
  );
  const serviceLabels = {
    economic: 'Economic-capable',
    standard: 'Standard-only',
    unknown: 'Unknown',
  };
  for (const project of after.projects) {
    const builds = [project.workingBuild, ...project.builds.filter((b) => b.status === 'planned')];
    const relevantRows = builds
      .flatMap((b) => buildRows(project, b))
      .filter((r) => r.population === 'jlc');
    for (const code of codes) {
      const row = relevantRows.find((r) => r.code === code);
      if (!row) continue;
      const old = before.observations[code],
        next = after.observations[code];
      const add = (kind: SupplierChange['kind'], message: string, buildId?: string) =>
        changes.push({ projectId: project.id, code, kind, message, buildId });
      if (old.library !== next.library) add('library', `Library: ${old.library} → ${next.library}`);
      const oldService = serviceFor(row, old),
        newService = serviceFor(row, next);
      if (oldService !== newService)
        add('service', `Assembly: ${serviceLabels[oldService]} → ${serviceLabels[newService]}`);
      if (old.stock === 0 && next.stock !== null && next.stock > 0)
        add('stock', `Back in stock: ${next.stock} available`);
      if (
        relevantRows.some(
          (r) =>
            r.code === code &&
            r.minStock !== undefined &&
            next.stock !== null &&
            old.stock !== null &&
            old.stock >= r.minStock &&
            next.stock < r.minStock,
        )
      )
        add('threshold', 'Stock crossed your low-stock threshold');
    }
    for (const build of builds) {
      const rows = buildRows(project, build);
      const prior = calculate(rows, before.observations, build, after.pricing, after.inventory);
      const current = calculate(rows, after.observations, build, after.pricing, after.inventory);
      for (const code of codes) {
        const old = prior.lines.find((l) => l.code === code),
          next = current.lines.find((l) => l.code === code);
        if (!old || !next) continue;
        const add = (kind: SupplierChange['kind'], message: string) =>
          changes.push({
            projectId: project.id,
            buildId: build.id,
            code,
            kind,
            message: `${build.name}: ${message}`,
          });
        if (old.required !== next.required)
          add(
            'requirement',
            `purchase requirement ${old.required} → ${next.required} (${next.placed} placed)`,
          );
        if (
          old.shortage !== null &&
          next.shortage !== null &&
          old.shortage !== next.shortage &&
          (old.shortage > 0 || next.shortage > 0)
        )
          add(
            'stock',
            next.shortage > 0
              ? `short by ${next.shortage} (was ${old.shortage})`
              : 'now covers this build',
          );
      }
    }
  }
  return changes;
}
