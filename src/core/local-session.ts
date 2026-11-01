export async function stopLocalServer(save: () => Promise<void>, request: typeof fetch = fetch) {
  // A rejected save must never stop the process or discard the live editor.
  await save();
  const sessionResponse = await request('/api/session', {
    headers: { 'X-TRACE-Request': '1' },
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  });
  const session = await sessionResponse.json().catch(() => null);
  if (!sessionResponse.ok || typeof session?.shutdownToken !== 'string' || !session.shutdownToken)
    throw new Error('Please restart TRACE with TRACE.cmd to enable browser shutdown.');
  const response = await request('/api/shutdown', {
    method: 'POST',
    headers: { 'X-TRACE-Shutdown': session.shutdownToken },
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.stopped !== true)
    throw new Error('TRACE could not confirm shutdown. Retry or use Stop-TRACE.cmd.');
}
