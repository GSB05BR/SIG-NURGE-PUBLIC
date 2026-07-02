import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import { createPortal } from 'react-dom';

export type ToastKind = 'success' | 'error';

export interface ToastState {
  kind: ToastKind;
  message: string;
}

interface ToastProps {
  toast: ToastState | null;
  onDismiss: () => void;
}

/**
 * Simple feedback banner shared across pages. Renders via a portal into
 * `document.body` in a fixed position (canto inferior direito), acima do
 * conteúdo, para que o feedback fique visível mesmo em listas longas. O
 * consumidor continua responsável por limpar o estado (tipicamente com um
 * `setTimeout` em um efeito para auto-dispensa).
 */
export default function Toast({ toast, onDismiss }: ToastProps) {
  if (!toast) return null;
  const isSuccess = toast.kind === 'success';
  const Icon = isSuccess ? CheckCircle2 : AlertCircle;
  return createPortal(
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex justify-end px-4">
      <div
        role="status"
        aria-live="polite"
        className={`pointer-events-auto flex min-w-[280px] max-w-[420px] items-start gap-3 rounded-md px-5 py-3.5 text-sm text-white shadow-lg ${
          isSuccess
            ? 'bg-state-success'
            : 'bg-state-danger'
        }`}
      >
        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
        <span className="flex-1">{toast.message}</span>
        <button
          type="button"
          aria-label="Dispensar"
          onClick={onDismiss}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-white/90 hover:bg-white/15"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>,
    document.body,
  );
}
