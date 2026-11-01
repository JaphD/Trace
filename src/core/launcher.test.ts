import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const {
  supportedNode,
  installationId,
  sourceDigest,
  artifactDigest,
  buildCurrent,
  dependenciesCurrent,
  classifyServer,
} = createRequire(import.meta.url)('../../scripts/release-utils.cjs');
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-release-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'dist'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '0.1.0' }));
  fs.writeFileSync(
    path.join(root, 'package-lock.json'),
    JSON.stringify({
      packages: { '': { version: '0.1.0' }, 'node_modules/example': { version: '1.0.0' } },
    }),
  );
  fs.writeFileSync(path.join(root, 'src', 'app.ts'), 'one');
  fs.writeFileSync(path.join(root, 'dist', 'index.html'), 'compiled');
  fs.writeFileSync(path.join(root, 'dist', 'server.cjs'), 'server');
  return root;
}
function removeFixture(root: string) {
  const relative = path.relative(os.tmpdir(), path.resolve(root));
  if (
    relative.startsWith('..') ||
    path.isAbsolute(relative) ||
    !path.basename(root).startsWith('trace-release-')
  )
    throw new Error('Unexpected release fixture path');
  fs.rmSync(root, { recursive: true, force: true });
}
describe('local release launcher policy', () => {
  it('fingerprints only distributable application sources, excluding real-board tests and audit scripts', () => {
    const root = fixture();
    try {
      const initial = sourceDigest(root);
      fs.mkdirSync(path.join(root, 'src', 'core', 'fixtures'), { recursive: true });
      fs.mkdirSync(path.join(root, 'scripts'));
      fs.writeFileSync(
        path.join(root, 'src', 'core', 'fixtures', 'private-bom.csv'),
        'private board',
      );
      fs.writeFileSync(
        path.join(root, 'src', 'core', 'private.test.ts'),
        'real board fixture imports',
      );
      fs.writeFileSync(path.join(root, 'scripts', 'audit-private.mjs'), 'private paths');
      expect(sourceDigest(root)).toBe(initial);
      fs.writeFileSync(path.join(root, 'scripts', 'launch-trace.cjs'), 'launcher');
      expect(sourceDigest(root)).not.toBe(initial);
    } finally {
      removeFixture(root);
    }
  });
  it('checks the supported Node floor including minor versions', () => {
    expect(supportedNode('22.11.0')).toBe(false);
    expect(supportedNode('22.12.0')).toBe(true);
    expect(supportedNode('24.0.0')).toBe(true);
    expect(supportedNode('20.19.0')).toBe(false);
  });
  it('identifies installations by path without exposing the actual path', () => {
    expect(installationId('C:/TRACE/A')).not.toBe(installationId('C:/TRACE/B'));
    expect(installationId('C:/TRACE/A')).toMatch(/^[a-f0-9]{16}$/);
  });
  it('reuses only matching current production builds', () => {
    const expected = { version: '0.1.0', installationId: 'here', buildId: 'built', current: true };
    const health = {
      app: 'TRACE',
      version: '0.1.0',
      installationId: 'here',
      buildId: 'built',
      mode: 'production',
      localOnly: true,
    };
    expect(classifyServer(health, expected)).toBe('reuse');
    expect(classifyServer({ ...health, mode: 'development' }, expected)).toBe('restart');
    expect(classifyServer({ ...health, version: '0.0.0' }, expected)).toBe('restart');
    expect(classifyServer(health, { ...expected, current: false })).toBe('restart');
    expect(classifyServer({ ...health, installationId: 'elsewhere' }, expected)).toBe('foreign');
    expect(classifyServer({ status: 'ok' }, expected)).toBe('occupied');
  });
  it('detects stale source and modified compiled output without hashing runtime data', () => {
    const root = fixture();
    try {
      const manifest = {
        version: '0.1.0',
        sourceHash: sourceDigest(root),
        artifactHash: artifactDigest(root),
      };
      fs.writeFileSync(path.join(root, 'dist', 'release.json'), JSON.stringify(manifest));
      expect(buildCurrent(root)).toBe(true);
      fs.mkdirSync(path.join(root, '.trace-runtime'));
      fs.writeFileSync(path.join(root, '.trace-runtime', 'server.log'), 'log');
      expect(buildCurrent(root)).toBe(true);
      fs.writeFileSync(path.join(root, 'src', 'app.ts'), 'two');
      expect(buildCurrent(root)).toBe(false);
      fs.writeFileSync(path.join(root, 'src', 'app.ts'), 'one');
      fs.writeFileSync(path.join(root, 'dist', 'index.html'), 'tampered');
      expect(buildCurrent(root)).toBe(false);
    } finally {
      removeFixture(root);
    }
  });
  it('detects missing or mismatched locked dependencies', () => {
    const root = fixture();
    try {
      expect(dependenciesCurrent(root)).toBe(false);
      fs.mkdirSync(path.join(root, 'node_modules', 'example'), { recursive: true });
      fs.writeFileSync(
        path.join(root, 'node_modules', 'example', 'package.json'),
        '{"version":"1.0.0"}',
      );
      expect(dependenciesCurrent(root)).toBe(true);
      fs.writeFileSync(
        path.join(root, 'node_modules', 'example', 'package.json'),
        '{"version":"2.0.0"}',
      );
      expect(dependenciesCurrent(root)).toBe(false);
    } finally {
      removeFixture(root);
    }
  });
});
