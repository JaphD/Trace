const fs = require('node:fs');
const path = require('node:path');
const { sourceDigest, artifactDigest } = require('./release-utils.cjs');
const root = path.resolve(__dirname, '..');
const { version } = require('../package.json');
fs.writeFileSync(
  path.join(root, 'dist', 'release.json'),
  JSON.stringify(
    {
      version,
      sourceHash: sourceDigest(root),
      artifactHash: artifactDigest(root),
      builtAt: new Date().toISOString(),
    },
    null,
    2,
  ) + '\n',
);
console.log('TRACE v' + version + ' local release manifest written.');
