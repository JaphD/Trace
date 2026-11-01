const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { installationId, buildCurrent } = require('./release-utils.cjs');
const root = path.resolve(__dirname, '..');
const { version } = require('../package.json');
async function run() {
  assert.ok(buildCurrent(root), 'Run npm run build first; release manifest is missing or stale.');
  const port = await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
  const child = spawn(process.execPath, ['dist/server.cjs', '--production'], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port) },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '',
    failure;
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  child.on('error', (error) => {
    failure = error;
  });
  const base = 'http://127.0.0.1:' + port;
  try {
    let health;
    for (let i = 0; i < 100; i++) {
      if (failure) throw failure;
      try {
        const response = await fetch(base + '/api/health', { signal: AbortSignal.timeout(500) });
        if (response.ok) {
          health = await response.json();
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(health, 'Server did not start: ' + output);
    assert.equal(health.app, 'TRACE');
    assert.equal(health.version, version);
    assert.equal(health.mode, 'production');
    assert.equal(health.localOnly, true);
    assert.equal(health.installationId, installationId(root));
    assert.equal(
      health.buildId,
      JSON.parse(fs.readFileSync(path.join(root, 'dist', 'release.json'), 'utf8')).artifactHash,
    );
    const response = await fetch(base),
      html = await response.text();
    assert.equal(response.status, 200);
    assert.ok(!html.includes('/@vite/client'));
    const asset = html.match(/src="([^"]+\.js)"/);
    assert.ok(asset, 'Compiled entry missing');
    assert.equal((await fetch(base + asset[1])).status, 200);
    assert.equal((await fetch(base + '/api/part/not-a-code')).status, 400);
    assert.equal(
      (await fetch(base + '/api/health', { headers: { Origin: 'https://outside.example' } }))
        .status,
      403,
      'external Origin must be rejected',
    );
    // Fetch implementations may normalize Host; test this header on the HTTP wire.
    const badHostStatus = await new Promise((resolve, reject) => {
      http
        .get(
          {
            hostname: '127.0.0.1',
            port,
            path: '/api/health',
            headers: { Host: 'outside.example' },
          },
          (response) => {
            response.resume();
            resolve(response.statusCode);
          },
        )
        .on('error', reject);
    });
    assert.equal(badHostStatus, 403, 'external Host must be rejected');
    assert.equal(
      (await fetch(base + '/api/session')).status,
      403,
      'session token must require an application request header',
    );
    const sessionResponse = await fetch(base + '/api/session', {
      headers: { 'X-TRACE-Request': '1' },
    });
    assert.equal(sessionResponse.status, 200);
    assert.equal(sessionResponse.headers.get('cache-control'), 'no-store');
    const session = await sessionResponse.json();
    assert.match(session.shutdownToken, /^[0-9a-f-]{36}$/);
    assert.equal((await fetch(base + '/api/shutdown')).status, 405);
    for (const headers of [
      {},
      { Origin: base },
      { Origin: base, 'X-TRACE-Shutdown': 'wrong-token' },
      { 'X-TRACE-Shutdown': session.shutdownToken },
      { Origin: 'https://outside.example', 'X-TRACE-Shutdown': session.shutdownToken },
      { Origin: base.replace('http:', 'https:'), 'X-TRACE-Shutdown': session.shutdownToken },
      { Origin: base.replace('127.0.0.1', 'localhost'), 'X-TRACE-Shutdown': session.shutdownToken },
      { Origin: base, 'X-TRACE-Shutdown': session.shutdownToken, 'Sec-Fetch-Site': 'cross-site' },
    ]) {
      assert.equal(
        (await fetch(base + '/api/shutdown', { method: 'POST', headers })).status,
        403,
        'shutdown must reject a missing/wrong token, missing/mismatched Origin or cross-site request',
      );
    }
    assert.equal((await fetch(base + '/api/health')).status, 200);
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.ok(response.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
    const shutdown = await fetch(base + '/api/shutdown', {
      method: 'POST',
      headers: { Origin: base, 'X-TRACE-Shutdown': session.shutdownToken },
    });
    assert.equal(shutdown.status, 200);
    assert.deepEqual(await shutdown.json(), { stopped: true });
    for (let i = 0; i < 60 && child.exitCode === null; i++)
      await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(child.exitCode, 0, 'authenticated shutdown must exit the server cleanly');
    console.log(
      'PASS: production startup, build identity, assets, local access restrictions and protected browser shutdown. No supplier connection required.',
    );
  } finally {
    if (child.exitCode === null && child.pid) {
      child.kill();
      await new Promise((resolve) => child.once('exit', resolve));
    }
  }
}
run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
