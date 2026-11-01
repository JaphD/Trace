import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
export const money = (n: number | null | undefined, d = 2) =>
  n === null || n === undefined
    ? '—'
    : '$' + n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
export const count = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : n.toLocaleString();
export const when = (n: number | undefined) => (n ? new Date(n).toLocaleString() : 'Never checked');
export function Badge({ children, tone = 'muted' }: { children: React.ReactNode; tone?: string }) {
  return <span className={'badge ' + tone}>{children}</span>;
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function NumberField({
  label,
  value,
  onChange,
  min = 0,
  step = 1,
  hint,
}: {
  label: string;
  value: number | null;
  onChange: (n: number | null) => void;
  min?: number;
  step?: number;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        type="number"
        min={min}
        step={step}
        value={value ?? ''}
        placeholder="Unknown"
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === '' ? null : Math.max(min, Number(v)));
        }}
      />
    </Field>
  );
}
export function AssemblyQuantity({
  label,
  value,
  onChange,
  compact = false,
}: {
  label: string;
  value: number;
  onChange: (quantity: number) => void;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <div className={compact ? 'assembly-custom' : ''}>
      <Field label={label} hint={compact ? undefined : 'Whole boards or panels · minimum 2'}>
        <input
          type="number"
          min={2}
          step={1}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            const n = Number(e.target.value);
            if (Number.isSafeInteger(n) && n >= 2) onChange(n);
          }}
          onBlur={() => {
            const parsed = Math.floor(Number(draft));
            const n = Number.isSafeInteger(parsed) ? Math.max(2, parsed) : 2;
            setDraft(String(n));
            if (n !== value) onChange(n);
          }}
        />
      </Field>
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const elements = () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          'button,input,select,textarea,a[href],[tabindex="0"]',
        ) || [],
      ).filter((x) => !x.hasAttribute('disabled'));
    elements()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if ([...document.querySelectorAll('[role="dialog"]')].at(-1) !== ref.current) return;
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const a = elements(),
          first = a[0],
          last = a[a.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      document.body.style.overflow = bodyOverflow;
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={'modal ' + (wide ? 'wide' : '')}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
            <X size={19} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
export function download(name: string, data: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const safeName = (text: string) => text.replace(/[^a-z0-9_-]/gi, '-').slice(0, 60);
export function NameDialog({
  title,
  initialValue,
  onSave,
  onClose,
}: {
  title: string;
  initialValue: string;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialValue);
  return (
    <Modal title={title} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onSave(name.trim());
        }}
      >
        <Field label="Name">
          <input
            required
            maxLength={100}
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <footer>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary">
            Save
          </button>
        </footer>
      </form>
    </Modal>
  );
}
export function useConfirmation() {
  const [message, setMessage] = useState<string | null>(null);
  const pending = useRef<((value: boolean) => void) | null>(null);
  const finish = (value: boolean) => {
    pending.current?.(value);
    pending.current = null;
    setMessage(null);
  };
  const ask = (text: string) =>
    new Promise<boolean>((resolve) => {
      pending.current = resolve;
      setMessage(text);
    });
  const dialog = message ? (
    <Modal title="Confirm change" onClose={() => finish(false)}>
      <p>{message}</p>
      <footer>
        <button onClick={() => finish(false)}>Cancel</button>
        <button className="primary" onClick={() => finish(true)}>
          Confirm
        </button>
      </footer>
    </Modal>
  ) : null;
  return { ask, dialog };
}
export function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
