const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const {
  supportedNode,
  installationId,
  buildCurrent,
  dependenciesCurrent,
  classifyServer,
} = require('./release-utils.cjs');
const root = path.resolve(__dirname, '..');
const runtime = path.join(root, '.trace-runtime');
const statePath = path.join(runtime, 'server.json');
const url = 'http://localhost:3000/';
const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function health() {
  try {
    const response = await fetch('http://127.0.0.1:3000/api/health', {
      signal: AbortSignal.timeout(1500),
      redirect: 'error',
    });
    return response.ok ? await response.json() : {};
  } catch (error) {
    return error.cause?.code === 'ECONNREFUSED' ? null : {};
  }
}
function npm(command) {
  const result =
    process.platform === 'win32'
      ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd ' + command], {
          cwd: root,
          stdio: 'inherit',
          windowsHide: true,
        })
      : spawnSync('npm', command.split(' '), { cwd: root, stdio: 'inherit' });
  if (result.error || result.status !== 0)
    throw new Error(
      'npm ' + command + ' failed. ' + (result.error?.message || 'See output above.'),
    );
}
function openBrowser() {
  if (process.argv.includes('--no-open')) return;
  const child =
    process.platform === 'win32'
      ? spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        })
      : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], {
          detached: true,
          stdio: 'ignore',
        });
  child.on('error', () => console.log('Open ' + url + ' in your browser.'));
  child.unref();
}
async function stop() {
  const current = await health(),
    state = readJson(statePath);
  if (!current) {
    console.log('TRACE is not running on port 3000.');
    return;
  }
  if (
    current.app !== 'TRACE' ||
    !state ||
    current.instanceId !== state.instanceId ||
    current.pid !== state.pid ||
    current.installationId !== installationId(root)
  )
    throw new Error(
      'This launcher cannot verify ownership of the running server. Stop it from its original terminal or launcher.',
    );
  process.kill(state.pid);
  for (let i = 0; i < 30; i++) {
    if (!(await health())) {
      fs.unlinkSync(statePath);
      console.log('TRACE stopped. Browser data was kept.');
      return;
    }
    await pause(100);
  }
  throw new Error('Stop requested; port 3000 is still responding.');
}
async function main() {
  if (!supportedNode(process.versions.node))
    throw new Error('Install Node.js 22.12 or newer before starting TRACE.');
  if (process.argv.includes('--stop')) {
    await stop();
    return;
  }
  fs.mkdirSync(runtime, { recursive: true });
  const lockPath = path.join(runtime, 'launch.json');
  const token = randomUUID();
  try {
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, token }), { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const previous = readJson(lockPath);
    let alive = false;
    if (Number.isInteger(previous?.pid) && previous.pid > 0) {
      try {
        process.kill(previous.pid, 0);
        alive = true;
      } catch (e) {
        if (e.code !== 'ESRCH') alive = true;
      }
    }
    if (alive)
      throw new Error('Another TRACE launcher is starting. Wait for it to finish, then try again.');
    fs.unlinkSync(lockPath);
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, token }), { flag: 'wx' });
  }
  try {
    const { version } = readJson(path.join(root, 'package.json'));
    const existing = await health();
    if (existing) {
      const manifest = readJson(path.join(root, 'dist', 'release.json'));
      const kind = classifyServer(existing, {
        version,
        installationId: installationId(root),
        buildId: manifest?.artifactHash,
        current: buildCurrent(root),
      });
      if (kind !== 'reuse')
        throw new Error(
          kind === 'restart'
            ? 'An older or development TRACE server is already using port 3000. Stop that session first, then launch again. The address stays localhost:3000 to preserve your workspace.'
            : kind === 'foreign'
              ? 'TRACE is running from a different folder. Stop that copy before launching this one.'
              : 'Port 3000 is occupied by another application. Close it before starting TRACE.',
        );
      console.log('TRACE v' + version + ' is already running: ' + url);
      openBrowser();
      return;
    }
    if (!dependenciesCurrent(root)) {
      console.log('Installing locked dependencies (internet needed for first setup)…');
      npm('ci');
    }
    if (!buildCurrent(root)) {
      console.log('Preparing the compiled local app…');
      npm('run build');
    }
    if (!buildCurrent(root)) throw new Error('The compiled build could not be verified.');
    const instanceId = randomUUID();
    const logPath = path.join(runtime, 'server.log');
    const log = fs.openSync(logPath, 'a');
    const child = spawn(process.execPath, [path.join(root, 'dist', 'server.cjs'), '--production'], {
      cwd: root,
      env: { ...process.env, PORT: '3000', NODE_ENV: 'production', TRACE_INSTANCE_ID: instanceId },
      detached: true,
      windowsHide: true,
      stdio: ['ignore', log, log],
    });
    try {
      await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
    } finally {
      fs.closeSync(log);
    }
    child.unref();
    fs.writeFileSync(
      statePath,
      JSON.stringify({ pid: child.pid, instanceId, version, installationId: installationId(root) }),
    );
    for (let i = 0; i < 50; i++) {
      const ready = await health();
      if (ready?.instanceId === instanceId && ready.mode === 'production') {
        console.log('TRACE v' + version + ' is ready: ' + url);
        openBrowser();
        return;
      }
      if (ready && ready.instanceId !== instanceId) break;
      await pause(200);
    }
    // This is the child created above, never a PID inferred from a busy port.
    try {
      child.kill();
    } catch {}
    throw new Error('TRACE did not start. See ' + logPath);
  } finally {
    if (readJson(lockPath)?.token === token) fs.unlinkSync(lockPath);
  }
}
main().catch((error) => {
  console.error('\nTRACE: ' + error.message);
  process.exitCode = 1;
});
