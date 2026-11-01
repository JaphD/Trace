import type { EditorState } from '../core/editor-lock';
export function EditorGate({ state, retry }: { state: EditorState; retry: () => void }) {
  return (
    <main className="editor-gate">
      <span className="eyebrow">TRACE · LOCAL WORKBENCH</span>
      <h1>
        {state === 'checking'
          ? 'Opening your workspace…'
          : state === 'blocked'
            ? 'TRACE is already open in another tab'
            : 'Workspace protection is unavailable'}
      </h1>
      {state === 'blocked' ? (
        <p>
          Use the tab that is already open. This tab cannot edit or save your data. To work here
          instead, close the other TRACE tab, then try again.
        </p>
      ) : (
        state !== 'checking' && (
          <p>
            TRACE needs browser tab coordination to protect your saved projects. Open it in an
            up-to-date browser at http://localhost:3000, or retry if this was a temporary error.
          </p>
        )
      )}
      {state !== 'checking' && (
        <button className="primary" onClick={retry}>
          Try again
        </button>
      )}
    </main>
  );
}
