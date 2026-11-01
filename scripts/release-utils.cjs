const path = require('node:path');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
function supportedNode(version) {
  const [major, minor] = version.replace(/^v/, '').split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 12);
}
function installationId(root) {
  const absolute = fs.existsSync(root) ? fs.realpathSync(root) : path.resolve(root);
  return createHash('sha256')
    .update(process.platform === 'win32' ? absolute.toLowerCase() : absolute)
    .digest('hex')
    .slice(0, 16);
}
function files(root, relative) {
  const target = path.join(root, relative);
  if (!fs.existsSync(target)) return [];
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink())
    throw new Error('Release source must not contain symbolic links: ' + relative);
  if (stat.isFile()) return [relative];
  return fs
    .readdirSync(target)
    .sort()
    .flatMap((name) => files(root, path.join(relative, name)));
}
function digest(root, names) {
  const hash = createHash('sha256');
  for (const name of names.sort())
    hash
      .update(name.replaceAll('\\', '/') + '\0')
      .update(fs.readFileSync(path.join(root, name)))
      .update('\0');
  return hash.digest('hex');
}
function sourceFiles(root) {
  return [
    'src',
    'public',
    'scripts/release-utils.cjs',
    'scripts/launch-trace.cjs',
    'scripts/write-build-info.cjs',
    'scripts/smoke-release.cjs',
    'scripts/package-local.ps1',
    'package.json',
    'package-lock.json',
    'index.html',
    'server.ts',
    'tsconfig.json',
    'vite.config.ts',
  ]
    .flatMap((name) => files(root, name))
    .filter((name) => !/\.test\.ts$|\/fixtures\//.test(name.replaceAll('\\', '/')));
}
function packageFiles(root) {
  return [
    ...sourceFiles(root),
    ...files(root, 'dist'),
    ...[
      'TRACE.cmd',
      'Stop-TRACE.cmd',
      'Start-Local.ps1',
      '.env.example',
      'README.md',
      'LICENSE',
    ].flatMap((name) => files(root, name)),
  ];
}
function sourceDigest(root) {
  return digest(root, sourceFiles(root));
}
function artifactDigest(root) {
  return digest(
    root,
    files(root, 'dist').filter((name) => name.replaceAll('\\', '/') !== 'dist/release.json'),
  );
}
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
function buildCurrent(root) {
  const manifest = readJson(path.join(root, 'dist', 'release.json')),
    pkg = readJson(path.join(root, 'package.json'));
  return !!(
    manifest &&
    pkg &&
    fs.existsSync(path.join(root, 'dist', 'server.cjs')) &&
    fs.existsSync(path.join(root, 'dist', 'index.html')) &&
    manifest.version === pkg.version &&
    manifest.sourceHash === sourceDigest(root) &&
    manifest.artifactHash === artifactDigest(root)
  );
}
function dependenciesCurrent(root) {
  const lock = readJson(path.join(root, 'package-lock.json'));
  if (!lock?.packages) return false;
  return Object.entries(lock.packages).every(([name, data]) => {
    if (!name || data.link) return true;
    const installed = readJson(path.join(root, name, 'package.json'));
    if (!installed) return !!data.optional;
    return installed.version === data.version;
  });
}
function classifyServer(health, expected) {
  if (health?.app !== 'TRACE')
    return health?.localOnly === true && health?.status === 'ok' ? 'restart' : 'occupied';
  if (health.installationId !== expected.installationId) return 'foreign';
  if (
    health.mode !== 'production' ||
    health.version !== expected.version ||
    health.buildId !== expected.buildId ||
    !expected.current
  )
    return 'restart';
  return 'reuse';
}
module.exports = {
  supportedNode,
  installationId,
  sourceDigest,
  artifactDigest,
  buildCurrent,
  dependenciesCurrent,
  classifyServer,
  packageFiles,
};
