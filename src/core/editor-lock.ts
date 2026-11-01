export type EditorState = 'checking' | 'editor' | 'blocked' | 'unsupported' | 'error';
export type EditorLocks = {
  request: (
    name: string,
    options: { ifAvailable: true; mode: 'exclusive' },
    callback: (lock: unknown | null) => Promise<void>,
  ) => Promise<unknown>;
};
export function holdEditorLock(
  manager: EditorLocks | undefined,
  onState: (state: EditorState) => void,
  drain: () => Promise<void> = async () => {},
) {
  let disposed = false;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  // StrictMode may dispose the first effect before acquisition starts.
  void Promise.resolve()
    .then(async () => {
      if (disposed) return;
      if (!manager) {
        onState('unsupported');
        return;
      }
      await manager.request(
        'trace-workspace-editor',
        { mode: 'exclusive', ifAvailable: true },
        async (lock) => {
          if (disposed) return;
          if (!lock) {
            onState('blocked');
            return;
          }
          onState('editor');
          await held;
          await drain().catch(() => {});
        },
      );
    })
    .catch(() => {
      if (!disposed) onState('error');
    });
  return () => {
    disposed = true;
    release();
  };
}
