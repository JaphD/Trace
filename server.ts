import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { version as APP_VERSION } from './package.json';

async function startServer() {
  const app = express(),
    port = Number(process.env.PORT || 3000);
  const production = process.argv.includes('--production') || process.env.NODE_ENV === 'production';
  const root = fs.realpathSync(process.cwd());
  const installationId = createHash('sha256')
    .update(process.platform === 'win32' ? root.toLowerCase() : root)
    .digest('hex')
    .slice(0, 16);
  const instanceId = process.env.TRACE_INSTANCE_ID || randomUUID();
  let buildId: string | null = null;
  if (production) {
    try {
      buildId = JSON.parse(
        fs.readFileSync(path.join(root, 'dist', 'release.json'), 'utf8'),
      ).artifactHash;
    } catch {}
  }
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const host = (req.hostname || '').toLowerCase();
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host))
      return res.status(403).json({ error: 'Local access only' });
    const origin = req.get('origin');
    if (origin) {
      try {
        const url = new URL(origin);
        if (
          !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
          url.port !== String(port)
        )
          return res.status(403).json({ error: 'Local origin required' });
      } catch {
        return res.status(403).end();
      }
    }
    next();
  });
  app.get('/api/health', (_req, res) =>
    res.set('Cache-Control', 'no-store').json({
      status: 'ok',
      app: 'TRACE',
      version: APP_VERSION,
      mode: production ? 'production' : 'development',
      localOnly: true,
      installationId,
      instanceId,
      pid: process.pid,
      buildId,
    }),
  );
  const cache = new Map<string, { date: number; payload: any }>(),
    pending = new Map<string, Promise<any>>();
  let inFlight = 0;
  app.get('/api/part/:code', async (req, res) => {
    const code = req.params.code.toUpperCase();
    if (!/^C[0-9]{1,12}$/.test(code))
      return res.status(400).json({ error: 'Invalid JLCPCB C-number' });
    const cached = cache.get(code);
    if (cached && Date.now() - cached.date < 30000) return res.json(cached.payload);
    if (!pending.has(code) && inFlight >= 4)
      return res.status(429).json({ error: 'Local lookup queue busy. Retry shortly.' });
    try {
      if (!pending.has(code)) {
        const task = (async () => {
          inFlight++;
          try {
            const response = await fetch(
              'https://cart.jlcpcb.com/shoppingCart/smtGood/getComponentDetail?componentCode=' +
                encodeURIComponent(code),
              { signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json' } },
            );
            if (!response.ok) throw new Error('JLCPCB returned HTTP ' + response.status);
            const payload = await response.json();
            if (payload?.code !== 200 || payload?.data?.componentCode !== code)
              throw new Error(
                payload?.message || 'Component unavailable from this supplier endpoint',
              );
            const dated = { ...payload, observedAt: Date.now() };
            cache.set(code, { date: Date.now(), payload: dated });
            if (cache.size > 2000) cache.delete(cache.keys().next().value!);
            return dated;
          } finally {
            inFlight--;
            pending.delete(code);
          }
        })();
        pending.set(code, task);
      }
      res.json(await pending.get(code));
    } catch (e) {
      res.status(502).json({ error: e instanceof Error ? e.message : 'Supplier lookup failed' });
    }
  });
  if (!production) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, host: '127.0.0.1' },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve('dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }
  await new Promise<void>((resolve, reject) => {
    const server = app.listen(port, '127.0.0.1', resolve);
    server.once('error', reject);
  });
  console.log(
    `TRACE v${APP_VERSION}: http://localhost:${port} (${production ? 'production' : 'development'}, local only)`,
  );
}
startServer().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
