import { describe, expect, it } from 'vitest';
import { holdEditorLock, type EditorLocks, type EditorState } from './editor-lock';

// Models the exclusive/ifAvailable contract; actual browser locks are tested in localhost QA.
function locks(): EditorLocks {
  let held = false;
  return {
    async request(_name, _options, callback) {
      if (held) return callback(null);
      held = true;
      try {
        return await callback({});
      } finally {
        held = false;
      }
    },
  };
}
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
describe('single editing tab', () => {
  it('allows one editor and requires retry after it releases the lock', async () => {
    const manager = locks(),
      first: EditorState[] = [],
      second: EditorState[] = [];
    const close = holdEditorLock(manager, (state) => first.push(state));
    await settle();
    holdEditorLock(manager, (state) => second.push(state));
    await settle();
    expect(first).toEqual(['editor']);
    expect(second).toEqual(['blocked']);
    close();
    await settle();
    const retry: EditorState[] = [];
    const release = holdEditorLock(manager, (state) => retry.push(state));
    await settle();
    expect(retry).toEqual(['editor']);
    release();
  });
  it('does not acquire a ghost lock during StrictMode setup and cleanup', async () => {
    const manager = locks(),
      cancelled: EditorState[] = [],
      live: EditorState[] = [];
    holdEditorLock(manager, (state) => cancelled.push(state))();
    const release = holdEditorLock(manager, (state) => live.push(state));
    await settle();
    expect(cancelled).toEqual([]);
    expect(live).toEqual(['editor']);
    release();
  });
  it('keeps the lock until pending workspace writes finish', async () => {
    const manager = locks();
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const release = holdEditorLock(
      manager,
      () => {},
      () => pending,
    );
    await settle();
    release();
    await settle();
    const second: EditorState[] = [];
    holdEditorLock(manager, (state) => second.push(state));
    await settle();
    expect(second).toEqual(['blocked']);
    finish();
    await settle();
    const retry: EditorState[] = [];
    const close = holdEditorLock(manager, (state) => retry.push(state));
    await settle();
    expect(retry).toEqual(['editor']);
    close();
  });
  it('fails safely if locks are missing or rejected', async () => {
    const states: EditorState[] = [];
    holdEditorLock(undefined, (state) => states.push(state));
    await settle();
    expect(states).toEqual(['unsupported']);
    const failed: EditorState[] = [];
    holdEditorLock(
      {
        request: async () => {
          throw new Error('denied');
        },
      },
      (state) => failed.push(state),
    );
    await settle();
    expect(failed).toEqual(['error']);
  });
});
