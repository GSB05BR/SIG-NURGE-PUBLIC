import { CheckCircle2, ShieldCheck, XCircle } from 'lucide-react';
import UserAvatar from './UserAvatar';
import type { User } from '@/types';

interface PendingUserCardProps {
  user: User;
  /** Disparado quando o distribuidor clica "Aprovar como Recebedor". */
  onApproveRecebedor: (user: User) => void;
  /** Disparado quando o distribuidor clica "Aprovar como Distribuidor". */
  onApproveDistribuidor: (user: User) => void;
  /** Disparado quando o distribuidor clica "Rejeitar". */
  onReject: (user: User) => void;
  /** Trava o card enquanto uma ação está em andamento. */
  busy?: boolean;
}

function formatRequestedDate(user: User): string {
  const ts = user.createdAt;
  if (!ts) return '—';
  try {
    const date = ts.toDate();
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
  } catch {
    return '—';
  }
}

/** Card de usuário pendente com 3 ações. */
export default function PendingUserCard({
  user,
  onApproveRecebedor,
  onApproveDistribuidor,
  onReject,
  busy = false,
}: PendingUserCardProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-surface p-4 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <UserAvatar
            displayName={user.displayName}
            photoURL={user.photoURL}
            size="md"
          />
          <div className="min-w-0">
            <p className="truncate font-medium text-ink-primary">
              {user.displayName}
            </p>
            <p className="truncate text-sm text-ink-secondary">{user.email}</p>
            <p className="text-xs text-ink-secondary">
              Solicitado em {formatRequestedDate(user)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onApproveRecebedor(user)}
            disabled={busy}
            aria-label={`Aprovar ${user.displayName} como Recebedor`}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-primary px-3 py-2 text-sm font-semibold text-white hover:bg-brand-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            <CheckCircle2 className="h-4 w-4" />
            Aprovar como Recebedor
          </button>
          <button
            type="button"
            onClick={() => onApproveDistribuidor(user)}
            disabled={busy}
            aria-label={`Aprovar ${user.displayName} como Distribuidor`}
            className="inline-flex items-center gap-1.5 rounded-md border border-brand-primary px-3 py-2 text-sm font-semibold text-brand-primary hover:bg-brand-primary-light disabled:cursor-not-allowed disabled:opacity-60"
          >
            <ShieldCheck className="h-4 w-4" />
            Aprovar como Distribuidor
          </button>
          <button
            type="button"
            onClick={() => onReject(user)}
            disabled={busy}
            aria-label={`Rejeitar ${user.displayName}`}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-state-danger hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <XCircle className="h-4 w-4" />
            Rejeitar
          </button>
        </div>
      </div>
    </div>
  );
}
