import { ReactNode, useId } from 'react';
import { clsx } from 'clsx';

interface FieldRenderProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
  labelClassName?: string;
  children: (props: FieldRenderProps) => ReactNode;
}

/**
 * Accessible form-field wrapper.
 *
 * Wraps an arbitrary input (text/select/textarea/custom) and supplies it
 * with a generated id, an associated <label htmlFor>, and the proper
 * aria-describedby / aria-invalid wiring for hint and error messages.
 *
 * Uses render-prop pattern so callers can inject icons or custom markup
 * around the actual <input>, while still ensuring the label is anchored
 * to the focusable element via explicit `htmlFor` / `id`.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  className,
  labelClassName,
  children,
}: FieldProps) {
  const autoId = useId();
  const id = htmlFor ?? autoId;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy =
    [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={clsx('flex flex-col gap-1', className)}>
      <label
        htmlFor={id}
        className={clsx(
          'text-sm font-medium text-ink-primary',
          labelClassName,
        )}
      >
        {label}
        {required && (
          <span className="ml-0.5 text-state-danger" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
      })}
      {hint && !error && (
        <p id={hintId} className="text-xs text-ink-secondary">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-state-danger">
          {error}
        </p>
      )}
    </div>
  );
}
