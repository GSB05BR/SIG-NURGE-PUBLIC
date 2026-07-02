import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useDialogA11y } from '@/lib/useDialogA11y';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  /** Disables overlay click + Esc + close button while busy. */
  busy?: boolean;
  /** Hides the X close button (e.g. when only programmatic close is desired). */
  hideCloseButton?: boolean;
  size?: ModalSize;
  onClose: () => void;
  children: ReactNode;
  /** Optional footer; rendered with a top border separator. */
  footer?: ReactNode;
  /** ARIA label id; auto-generated if omitted. */
  labelledBy?: string;
}

const SIZE_CLASS: Record<ModalSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-7xl',
};

const BODY_SIZE_CLASS: Record<ModalSize, string> = {
  sm: 'max-h-[60vh]',
  md: 'max-h-[60vh]',
  lg: 'max-h-[60vh]',
  xl: 'max-h-[calc(100vh-12rem)]',
};

/**
 * Reusable modal shell with overlay, Esc-to-close and focus management.
 * Children render inside the body; `footer` renders inside a separated footer.
 */
export default function Modal({
  open,
  title,
  description,
  busy = false,
  hideCloseButton = false,
  size = 'md',
  onClose,
  children,
  footer,
  labelledBy,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = labelledBy ?? 'modal-title';

  // Esc-to-close (disabled when busy).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  // Focus trap + restauração de foco + trava de scroll do body (apenas aberto).
  useDialogA11y({ enabled: open, containerRef: dialogRef });

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        className="absolute inset-0 bg-black/50"
        aria-hidden="true"
        onClick={() => {
          if (!busy) onClose();
        }}
      />
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={`relative w-full ${SIZE_CLASS[size]} rounded-lg bg-surface shadow-lg outline-none`}
      >
        <div className="flex items-start justify-between border-b border-gray-200 px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold text-ink-primary">
              {title}
            </h2>
            {description && (
              <p className="mt-1 text-sm text-ink-secondary">{description}</p>
            )}
          </div>
          {!hideCloseButton && (
            <button
              type="button"
              aria-label="Fechar"
              className="inline-flex h-10 w-10 items-center justify-center rounded-md text-ink-secondary hover:bg-gray-100 hover:text-ink-primary disabled:opacity-50"
              onClick={() => {
                if (!busy) onClose();
              }}
              disabled={busy}
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        <div className={`${BODY_SIZE_CLASS[size]} overflow-y-auto px-5 py-4`}>
          {children}
        </div>

        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
