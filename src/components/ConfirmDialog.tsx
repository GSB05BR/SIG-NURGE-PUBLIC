import { useEffect, useRef } from 'react';
import { useDialogA11y } from '@/lib/useDialogA11y';

export interface ConfirmDialogState {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
}

interface ConfirmDialogProps {
  state: ConfirmDialogState;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

/**
 * Reusable confirmation modal. Esc-to-cancel; primary button auto-focused.
 * Visual treatment varies based on `state.destructive`.
 */
export default function ConfirmDialog({
  state,
  busy,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onCancel();
    }
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [busy, onCancel]);

  // Focus trap + restauração de foco + trava de scroll (preserva o autoFocus
  // do botão de confirmação, que já roda no commit antes deste efeito).
  useDialogA11y({ enabled: true, containerRef: dialogRef });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      <div
        className="absolute inset-0 bg-black/50"
        aria-hidden="true"
        onClick={() => {
          if (!busy) onCancel();
        }}
      />
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="relative w-full max-w-md rounded-lg bg-surface shadow-lg outline-none"
      >
        <div className="px-5 py-4">
          <h2
            id="confirm-title"
            className="text-lg font-semibold text-ink-primary"
          >
            {state.title}
          </h2>
          <p className="mt-2 text-sm text-ink-secondary">{state.message}</p>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="inline-flex items-center rounded-md border border-gray-300 bg-surface px-5 py-2.5 text-sm font-medium text-ink-primary hover:bg-gray-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => {
              void onConfirm();
            }}
            disabled={busy}
            className={`inline-flex items-center rounded-md px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${
              state.destructive
                ? 'bg-state-danger hover:bg-rose-700'
                : 'bg-brand-primary hover:bg-brand-primary-dark'
            }`}
          >
            {busy ? 'Aguarde...' : state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
