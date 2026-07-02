import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Search, X } from 'lucide-react';
import { useAuth } from '@/store/authStore';
import {
  approveUser,
  rejectUser,
  setUserAtivo,
  subscribeAllUsers,
  updateUserAgrupadores,
  updateUserRole,
} from '@/services/firebase/users';
import { subscribeAgrupadores } from '@/services/firebase/agrupadores';
import { isSuperAdminUidEmail } from '@/lib/super-admins';
import { usePageTitle } from '@/lib/usePageTitle';
import type { Agrupador, AgrupadoresMode, User } from '@/types';
import UserAvatar from '@/components/usuarios/UserAvatar';
import RoleBadge from '@/components/usuarios/RoleBadge';
import StatusBadge from '@/components/usuarios/StatusBadge';
import PendingUserCard from '@/components/usuarios/PendingUserCard';
import UserActionsMenu from '@/components/usuarios/UserActionsMenu';
import AgrupadoresSelectModal, {
  type AgrupadoresSelectResult,
} from '@/components/usuarios/AgrupadoresSelectModal';

// ---------------------------------------------------------------------------
// Filter chips
// ---------------------------------------------------------------------------

type FilterKey =
  | 'todos'
  | 'pendentes'
  | 'recebedores'
  | 'distribuidores'
  | 'inativos';

const FILTER_LABELS: Record<FilterKey, string> = {
  todos: 'Todos',
  pendentes: 'Pendentes',
  recebedores: 'Recebedores',
  distribuidores: 'Distribuidores',
  inativos: 'Inativos',
};

const FILTER_ORDER: FilterKey[] = [
  'todos',
  'pendentes',
  'recebedores',
  'distribuidores',
  'inativos',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FeedbackState {
  kind: 'success' | 'error';
  message: string;
}

interface AgrupadoresModalState {
  user: User;
  /** "approve_recebedor" = aprovação inicial de pendente; "edit" = edição. */
  intent: 'approve_recebedor' | 'edit';
  initialMode: AgrupadoresMode;
  initialIds: string[];
}

interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
}

function formatApprovedDate(user: User): string {
  if (!user.approvedAt) return '—';
  try {
    const d = user.approvedAt.toDate();
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(d);
  } catch {
    return '—';
  }
}

function summarizeAgrupadores(
  user: User,
  agrupadoresById: Map<string, Agrupador>
): string {
  if (user.agrupadoresMode === 'todos') return 'Todos';
  if (user.agrupadoresMode === 'especificos') {
    const count = user.agrupadoresPermitidos.filter((id) =>
      agrupadoresById.has(id)
    ).length;
    if (count === 0) return 'Nenhum específico';
    return `${count} específico${count > 1 ? 's' : ''}`;
  }
  return '—';
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Usuarios() {
  usePageTitle('Usuários');
  const { userDoc, firebaseUser } = useAuth();

  const [users, setUsers] = useState<User[] | null>(null);
  const [agrupadores, setAgrupadores] = useState<Agrupador[] | null>(null);

  const [filter, setFilter] = useState<FilterKey>('todos');
  const [search, setSearch] = useState('');

  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [busyUid, setBusyUid] = useState<string | null>(null);

  const [agrupadoresModal, setAgrupadoresModal] =
    useState<AgrupadoresModalState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  // ----- Subscriptions -----
  useEffect(() => {
    const unsubUsers = subscribeAllUsers((list) => setUsers(list));
    const unsubAgrupadores = subscribeAgrupadores((list) =>
      setAgrupadores(list)
    );
    return () => {
      unsubUsers();
      unsubAgrupadores();
    };
  }, []);

  // ----- Auto-dismiss feedback -----
  useEffect(() => {
    if (!feedback) return;
    const id = window.setTimeout(() => setFeedback(null), 4500);
    return () => window.clearTimeout(id);
  }, [feedback]);

  // ----- Derived -----
  const meUid = firebaseUser?.uid ?? null;
  const meNome = userDoc?.displayName ?? firebaseUser?.displayName ?? 'Usuário';

  const agrupadoresById = useMemo(() => {
    const m = new Map<string, Agrupador>();
    (agrupadores ?? []).forEach((a) => m.set(a.id, a));
    return m;
  }, [agrupadores]);

  const activeAgrupadores = useMemo(
    () => (agrupadores ?? []).filter((a) => a.ativo),
    [agrupadores]
  );

  const pending = useMemo(
    () => (users ?? []).filter((u) => u.role === 'pendente' && u.ativo),
    [users]
  );

  const filteredAndSearched = useMemo(() => {
    if (!users) return [];
    const q = search.trim().toLowerCase();
    let list = users;
    switch (filter) {
      case 'pendentes':
        list = list.filter((u) => u.role === 'pendente');
        break;
      case 'recebedores':
        list = list.filter((u) => u.role === 'recebedor');
        break;
      case 'distribuidores':
        list = list.filter((u) => u.role === 'distribuidor');
        break;
      case 'inativos':
        list = list.filter((u) => !u.ativo);
        break;
      default:
        break;
    }
    if (q) {
      list = list.filter(
        (u) =>
          u.displayName.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q)
      );
    }
    return list;
  }, [users, filter, search]);

  // ----- Action helpers -----

  function showSuccess(msg: string) {
    setFeedback({ kind: 'success', message: msg });
  }

  function showError(msg: string) {
    setFeedback({ kind: 'error', message: msg });
  }

  function readErrorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    return 'Ocorreu um erro inesperado.';
  }

  async function withBusy<T>(uid: string, fn: () => Promise<T>): Promise<T | null> {
    if (!meUid) {
      showError('Usuário não autenticado.');
      return null;
    }
    setBusyUid(uid);
    try {
      return await fn();
    } catch (err) {
      showError(readErrorMessage(err));
      return null;
    } finally {
      setBusyUid(null);
    }
  }

  // Aprovar como Distribuidor: chama approveUser(role='distribuidor') e em
  // sequência seta agrupadoresMode='todos' (convenção para distribuidor).
  async function handleApproveDistribuidor(user: User) {
    if (!meUid) return;
    await withBusy(user.uid, async () => {
      await approveUser(user.uid, 'distribuidor', meUid, meNome);
      try {
        await updateUserAgrupadores(user.uid, 'todos', [], meUid, meNome);
      } catch (err) {
        // Aprovação concluída, mas ajuste de agrupadores falhou.
        showError(
          `Aprovado, mas falhou ao definir origens como "todas": ${readErrorMessage(
            err
          )}`
        );
        return;
      }
      showSuccess(`${user.displayName} aprovado como Distribuidor.`);
    });
  }

  // Abre o modal de agrupadores como parte do fluxo de aprovação como Recebedor.
  function handleApproveRecebedor(user: User) {
    setAgrupadoresModal({
      user,
      intent: 'approve_recebedor',
      initialMode: user.agrupadoresMode ?? 'todos',
      initialIds: user.agrupadoresPermitidos ?? [],
    });
  }

  // Abre modal de edição de agrupadores (recebedor já existente).
  function handleEditAgrupadores(user: User) {
    setAgrupadoresModal({
      user,
      intent: 'edit',
      initialMode: user.agrupadoresMode ?? 'todos',
      initialIds: user.agrupadoresPermitidos ?? [],
    });
  }

  // Confirmação do modal de agrupadores. Encadeia aprovação + permissão se for
  // o fluxo de aprovação inicial; caso contrário, só atualiza permissão.
  async function handleAgrupadoresConfirm(result: AgrupadoresSelectResult) {
    if (!agrupadoresModal || !meUid) return;
    const { user, intent } = agrupadoresModal;

    await withBusy(user.uid, async () => {
      if (intent === 'approve_recebedor') {
        try {
          await approveUser(user.uid, 'recebedor', meUid, meNome);
        } catch (err) {
          showError(`Falha ao aprovar: ${readErrorMessage(err)}`);
          return;
        }
        try {
          await updateUserAgrupadores(
            user.uid,
            result.mode,
            result.agrupadoresIds,
            meUid,
            meNome
          );
        } catch (err) {
          // Aprovação OK, mas configuração de agrupadores falhou.
          showError(
            `Aprovado como Recebedor, mas falhou ao salvar origens: ${readErrorMessage(
              err
            )}`
          );
          setAgrupadoresModal(null);
          return;
        }
        showSuccess(
          `${user.displayName} aprovado como Recebedor com permissões salvas.`
        );
      } else {
        try {
          await updateUserAgrupadores(
            user.uid,
            result.mode,
            result.agrupadoresIds,
            meUid,
            meNome
          );
          showSuccess(`Origens de ${user.displayName} atualizadas.`);
        } catch (err) {
          showError(`Falha ao atualizar: ${readErrorMessage(err)}`);
          return;
        }
      }
      setAgrupadoresModal(null);
    });
  }

  function handleReject(user: User) {
    setConfirm({
      title: 'Rejeitar usuário',
      message: `Tem certeza que deseja rejeitar ${user.displayName}? O usuário ficará inativo e perderá acesso.`,
      confirmLabel: 'Rejeitar',
      destructive: true,
      onConfirm: async () => {
        if (!meUid) return;
        await withBusy(user.uid, async () => {
          await rejectUser(user.uid, meUid, meNome);
          showSuccess(`${user.displayName} foi rejeitado.`);
        });
      },
    });
  }

  function handleChangeRole(user: User, newRole: 'recebedor' | 'distribuidor') {
    if (!meUid) return;
    setConfirm({
      title: 'Alterar papel do usuário',
      message: `Mudar ${user.displayName} para ${newRole === 'recebedor' ? 'Recebedor' : 'Distribuidor'}?`,
      confirmLabel: 'Confirmar',
      onConfirm: async () => {
        await withBusy(user.uid, async () => {
          await updateUserRole(user.uid, newRole, meUid, meNome);
          // Quando promovido a distribuidor, conveniência: zera para "todos".
          if (newRole === 'distribuidor') {
            try {
              await updateUserAgrupadores(
                user.uid,
                'todos',
                [],
                meUid,
                meNome
              );
            } catch {
              // Falha silenciosa; mudança de role já foi aplicada.
            }
          }
          showSuccess(
            `${user.displayName} agora é ${newRole === 'recebedor' ? 'Recebedor' : 'Distribuidor'}.`
          );
        });
      },
    });
  }

  function handleToggleAtivo(user: User) {
    if (!meUid) return;
    const willActivate = !user.ativo;
    setConfirm({
      title: willActivate ? 'Reativar usuário' : 'Desativar usuário',
      message: willActivate
        ? `Reativar ${user.displayName}? O acesso será restaurado.`
        : `Desativar ${user.displayName}? O usuário perderá acesso ao sistema.`,
      confirmLabel: willActivate ? 'Reativar' : 'Desativar',
      destructive: !willActivate,
      onConfirm: async () => {
        await withBusy(user.uid, async () => {
          await setUserAtivo(user.uid, willActivate, meUid, meNome);
          showSuccess(
            `${user.displayName} foi ${willActivate ? 'reativado' : 'desativado'}.`
          );
        });
      },
    });
  }

  // ----- Render -----

  const loading = users === null || agrupadores === null;
  const pendingCount = pending.length;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Header */}
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink-primary">Usuários</h1>
          <p className="text-sm text-ink-secondary">
            Aprove novos usuários, configure permissões e gerencie acessos.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pendingCount > 0 && (
            <span className="inline-flex items-center rounded-full bg-brand-primary px-3 py-1 text-xs font-semibold text-white">
              {pendingCount} {pendingCount === 1 ? 'pendente' : 'pendentes'}
            </span>
          )}
        </div>
      </header>

      {/* Feedback */}
      {feedback && (
        <FeedbackBanner
          kind={feedback.kind}
          message={feedback.message}
          onDismiss={() => setFeedback(null)}
        />
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-ink-secondary">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Carregando usuários...
        </div>
      ) : (
        <>
          {/* Pending section */}
          <section
            aria-labelledby="pending-heading"
            className="space-y-3 rounded-lg border border-brand-primary/20 bg-brand-primary-light/20 p-4"
          >
            <div className="flex items-center justify-between">
              <h2
                id="pending-heading"
                className="text-base font-semibold text-ink-primary"
              >
                Pendentes de aprovação
              </h2>
            </div>

            {pending.length === 0 ? (
              <div className="rounded-md border border-dashed border-brand-primary/30 bg-surface px-4 py-6 text-center text-sm text-ink-secondary">
                Nenhum usuário aguardando aprovação.
              </div>
            ) : (
              <div className="space-y-3">
                {pending.map((u) => (
                  <PendingUserCard
                    key={u.uid}
                    user={u}
                    busy={busyUid === u.uid}
                    onApproveRecebedor={handleApproveRecebedor}
                    onApproveDistribuidor={handleApproveDistribuidor}
                    onReject={handleReject}
                  />
                ))}
              </div>
            )}
          </section>

          {/* All users section */}
          <section
            aria-labelledby="all-heading"
            className="space-y-4 rounded-lg border border-gray-200 bg-surface p-4 shadow-sm"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2
                id="all-heading"
                className="text-base font-semibold text-ink-primary"
              >
                Todos os usuários
              </h2>

              <div className="relative w-full sm:max-w-xs">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por nome ou email..."
                  className="w-full rounded-md border border-gray-200 bg-surface py-2 pl-8 pr-3 text-sm text-ink-primary outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20"
                  aria-label="Buscar usuário"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {FILTER_ORDER.map((key) => {
                const isActive = filter === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setFilter(key)}
                    aria-pressed={isActive}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      isActive
                        ? 'border-brand-primary bg-brand-primary text-white'
                        : 'border-gray-200 bg-surface text-ink-primary hover:bg-gray-50'
                    }`}
                  >
                    {FILTER_LABELS[key]}
                  </button>
                );
              })}
            </div>

            {filteredAndSearched.length === 0 ? (
              <div className="rounded-md border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-ink-secondary">
                Nenhum usuário corresponde ao filtro/busca.
              </div>
            ) : (
              <UsersTable
                users={filteredAndSearched}
                meUid={meUid}
                agrupadoresById={agrupadoresById}
                busyUid={busyUid}
                onEditAgrupadores={handleEditAgrupadores}
                onChangeRole={handleChangeRole}
                onToggleAtivo={handleToggleAtivo}
              />
            )}
          </section>
        </>
      )}

      {/* Origens modal */}
      {agrupadoresModal && (
        <AgrupadoresSelectModal
          open
          title={
            agrupadoresModal.intent === 'approve_recebedor'
              ? 'Configurar origens'
              : 'Editar origens'
          }
          description={
            agrupadoresModal.intent === 'approve_recebedor'
              ? `Defina o que ${agrupadoresModal.user.displayName} poderá ver ao aprovar.`
              : `Atualize as permissões de ${agrupadoresModal.user.displayName}.`
          }
          agrupadores={activeAgrupadores}
          initialMode={agrupadoresModal.initialMode}
          initialSelectedIds={agrupadoresModal.initialIds}
          confirmLabel={
            agrupadoresModal.intent === 'approve_recebedor'
              ? 'Aprovar'
              : 'Salvar'
          }
          busy={busyUid === agrupadoresModal.user.uid}
          onCancel={() => {
            if (busyUid !== agrupadoresModal.user.uid) {
              setAgrupadoresModal(null);
            }
          }}
          onConfirm={handleAgrupadoresConfirm}
        />
      )}

      {/* Confirm modal */}
      {confirm && (
        <ConfirmDialog
          state={confirm}
          busy={busyUid !== null}
          onCancel={() => {
            if (busyUid === null) setConfirm(null);
          }}
          onConfirm={async () => {
            await confirm.onConfirm();
            setConfirm(null);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components (locais, dedicados a esta página)
// ---------------------------------------------------------------------------

interface UsersTableProps {
  users: User[];
  meUid: string | null;
  agrupadoresById: Map<string, Agrupador>;
  busyUid: string | null;
  onEditAgrupadores: (u: User) => void;
  onChangeRole: (u: User, role: 'recebedor' | 'distribuidor') => void;
  onToggleAtivo: (u: User) => void;
}

function UsersTable({
  users,
  meUid,
  agrupadoresById,
  busyUid,
  onEditAgrupadores,
  onChangeRole,
  onToggleAtivo,
}: UsersTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-ink-secondary">
            <th scope="col" className="py-2 pr-3 font-medium">
              Usuário
            </th>
            <th scope="col" className="hidden py-2 pr-3 font-medium md:table-cell">
              Email
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              Role
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              Status
            </th>
            <th
              scope="col"
              className="hidden py-2 pr-3 font-medium lg:table-cell"
            >
              Origens
            </th>
            <th
              scope="col"
              className="hidden py-2 pr-3 font-medium lg:table-cell"
            >
              Aprovado em
            </th>
            <th scope="col" className="py-2 pl-3 text-right font-medium">
              Ações
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {users.map((u) => {
            const isSelf = meUid !== null && u.uid === meUid;
            const isSuper = isSuperAdminUidEmail(u.email);
            const rowBusy = busyUid === u.uid;
            return (
              <tr
                key={u.uid}
                className={`align-middle ${rowBusy ? 'opacity-60' : ''}`}
              >
                <td className="py-3 pr-3">
                  <div className="flex items-center gap-3">
                    <UserAvatar
                      displayName={u.displayName}
                      photoURL={u.photoURL}
                      size="sm"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-ink-primary">
                          {u.displayName}
                        </span>
                        {isSelf && (
                          <span className="rounded bg-brand-primary-light px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-primary-dark">
                            você
                          </span>
                        )}
                        {isSuper && (
                          <span
                            className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700"
                            title="Super-admin: protegido contra rebaixamento"
                          >
                            super-admin
                          </span>
                        )}
                      </div>
                      <span className="block truncate text-xs text-ink-secondary md:hidden">
                        {u.email}
                      </span>
                    </div>
                  </div>
                </td>
                <td className="hidden truncate py-3 pr-3 text-sm text-ink-secondary md:table-cell">
                  {u.email}
                </td>
                <td className="py-3 pr-3">
                  <RoleBadge role={u.role} />
                </td>
                <td className="py-3 pr-3">
                  <StatusBadge approved={u.approved} ativo={u.ativo} />
                </td>
                <td className="hidden py-3 pr-3 text-sm text-ink-secondary lg:table-cell">
                  {summarizeAgrupadores(u, agrupadoresById)}
                </td>
                <td className="hidden py-3 pr-3 text-sm text-ink-secondary lg:table-cell">
                  {formatApprovedDate(u)}
                </td>
                <td className="py-3 pl-3 text-right">
                  <UserActionsMenu
                    user={u}
                    isSuperAdminTarget={isSuper}
                    isSelf={isSelf}
                    onEditAgrupadores={onEditAgrupadores}
                    onChangeRole={onChangeRole}
                    onToggleAtivo={onToggleAtivo}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface FeedbackBannerProps {
  kind: 'success' | 'error';
  message: string;
  onDismiss: () => void;
}

function FeedbackBanner({ kind, message, onDismiss }: FeedbackBannerProps) {
  const isSuccess = kind === 'success';
  const Icon = isSuccess ? CheckCircle2 : AlertCircle;
  return (
    <div
      role="status"
      className={`flex items-start gap-3 rounded-md border px-4 py-3 text-sm ${
        isSuccess
          ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
          : 'border-rose-200 bg-rose-50 text-rose-900'
      }`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="flex-1">{message}</span>
      <button
        type="button"
        aria-label="Dispensar"
        onClick={onDismiss}
        className="rounded p-0.5 hover:bg-black/5"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

interface ConfirmDialogProps {
  state: ConfirmState;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

function ConfirmDialog({ state, busy, onCancel, onConfirm }: ConfirmDialogProps) {
  // Foco automático no botão de confirmar e Esc fecha.
  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onCancel();
    }
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [busy, onCancel]);

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
      <div className="relative w-full max-w-md rounded-lg bg-surface shadow-xl">
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
            className="rounded-md border border-gray-200 px-3 py-2 text-sm font-medium text-ink-primary hover:bg-gray-50 disabled:opacity-50"
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
            className={`rounded-md px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 ${
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
