import { describe, expect, it, vi } from 'vitest';
import { stopLocalServer } from './local-session';

describe('save before stopping the local server', () => {
  it('waits for the final save before making any server request', async () => {
    let finishSave!: () => void;
    const saved = new Promise<void>((resolve) => {
      finishSave = resolve;
    });
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ shutdownToken: 'test-token' }))
      .mockResolvedValueOnce(Response.json({ stopped: true }));
    const stopped = stopLocalServer(() => saved, request);
    expect(request).not.toHaveBeenCalled();
    finishSave();
    await stopped;
    expect(request.mock.calls.map(([url]) => url)).toEqual(['/api/session', '/api/shutdown']);
    expect(request.mock.calls[1][1]).toMatchObject({
      method: 'POST',
      headers: { 'X-TRACE-Shutdown': 'test-token' },
    });
  });
  it('never sends shutdown when saving fails', async () => {
    const request = vi.fn<typeof fetch>();
    await expect(
      stopLocalServer(async () => {
        throw new Error('Storage full');
      }, request),
    ).rejects.toThrow('Storage full');
    expect(request).not.toHaveBeenCalled();
  });
  it('does not treat an unreachable server as confirmed shutdown', async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(stopLocalServer(async () => {}, request)).rejects.toThrow();
  });
  it('rejects an old server or an invalid session response without sending shutdown', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ app: 'TRACE' }));
    await expect(stopLocalServer(async () => {}, request)).rejects.toThrow(/restart/i);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('reports rejection or a missing acknowledgement instead of claiming success', async () => {
    for (const response of [new Response('', { status: 403 }), Response.json({})]) {
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json({ shutdownToken: 'test-token' }))
        .mockResolvedValueOnce(response);
      await expect(stopLocalServer(async () => {}, request)).rejects.toThrow(/confirm/i);
    }
  });
});
