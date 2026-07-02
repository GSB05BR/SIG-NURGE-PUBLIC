import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Loader2,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Search,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '@/store/authStore';
import {
  createAgrupador,
  getAgrupadorByNome,
  seedIfEmpty,
  subscribeAgrupadores,
  updateAgrupador,
} from '@/services/firebase/agrupadores';
import { slugify } from '@/lib/slug';
import { usePageTitle } from '@/lib/usePageTitle';
import type { Agrupador } from '@/types';
import Modal from '@/components/Modal';
import Toast, { type ToastState } from '@/components/Toast';
import ConfirmDialog, {
  type ConfirmDialogState,
} from '@/components/ConfirmDialog';

// ---------------------------------------------------------------------------
// Filter chips
// ---------------------------------------------------------------------------

type FilterKey = 'todos' | 'ativos' | 'inativos';

const FILTER_LABELS: Record<FilterKey, string> = {
  todos: 'Todos',
  ativos: 'Ativos',
  inativos: 'Inativos',
};

const FILTER_ORDER: FilterKey[] = ['todos', 'ativos', 'inativos'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface EditModalState {
  /** null => create mode; populated => edit mode */
  agrupador: Agrupador | null;
}

function readErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Ocorreu um erro inesperado.';
}

function formatCreatedAt(a: Agrupador): string {
  if (!a.createdAt) return '—';
  try {
    const d = a.createdAt.toDate();
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(d);
  } catch {
    return '—';
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Agrupadores() {
  usePageTitle('Origens');
  const { firebaseUser, userDoc } = useAuth();

  const [agrupadores, setAgrupadores] = useState<Agrupador[] | null>(null);
  const [filter, setFilter] = useState<FilterKey>('todos');
  const [search, setSearch] = useState('');
  const [editModal, setEditModal] = useState<EditModalState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmDialogState | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyGlobal, setBusyGlobal] = useState(false);

  const meUid = firebaseUser?.uid ?? null;
  const meNome =
    userDoc?.displayName ?? firebaseUser?.displayName ?? 'Usuário';

  // Real-time subscription.
  useEffect(() => {
    const unsub = subscribeAgrupadores((list) => {
      setAgrupadores(list);
    });
    return () => unsub();
  }, []);

  // Auto-dismiss toast.
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(id);
  }, [toast]);

  // ----- Derived -----

  const filteredAndSearched = useMemo(() => {
    if (!agrupadores) return [];
    const q = search.trim().toLowerCase();
    let list = agrupadores;
    if (filter === 'ativos') list = list.filter((a) => a.ativo);
    else if (filter === 'inativos') list = list.filter((a) => !a.ativo);
    if (q) list = list.filter((a) => a.nome.toLowerCase().includes(q));
    return list;
  }, [agrupadores, filter, search]);

  const isCollectionEmpty =
    agrupadores !== null && agrupadores.length === 0;

  // ----- Action helpers -----

  function showSuccess(message: string) {
    setToast({ kind: 'success', message });
  }

  function showError(message: string) {
    setToast({ kind: 'error', message });
  }

  // ----- Handlers -----

  async function handleSeed() {
    if (!meUid) {
      showError('Usuário não autenticado.');
      return;
    }
    setBusyGlobal(true);
    try {
      const n = await seedIfEmpty(meUid, meNome);
      if (n === 0) {
        showError('A coleção já contém origens.');
      } else {
        showSuccess(`${n} origens carregadas com sucesso.`);
      }
    } catch (err) {
      showError(`Falha ao carregar lista padrão: ${readErrorMessage(err)}`);
    } finally {
      setBusyGlobal(false);
    }
  }

  function openCreate() {
    setEditModal({ agrupador: null });
  }

  function openEdit(a: Agrupador) {
    setEditModal({ agrupador: a });
  }

  async function handleSaveModal(input: {
    nome: string;
    prazoOverride: number | null;
  }) {
    if (!meUid) {
      showError('Usuário não autenticado.');
      return;
    }
    const target = editModal?.agrupador ?? null;
    setBusyGlobal(true);
    try {
      const trimmedNome = input.nome.trim();
      if (!trimmedNome) {
        showError('Informe um nome para a origem.');
        return;
      }

      // Duplicate check (skip when editing and name unchanged).
      if (!target || target.nome !== trimmedNome) {
        const existing = await getAgrupadorByNome(trimmedNome);
        if (existing && (!target || existing.id !== target.id)) {
          showError('Já existe uma origem com esse nome.');
          return;
        }
      }

      if (!target) {
        // Create
        const created = await createAgrupador(trimmedNome, meUid, meNome);
        // If the user also set a prazoOverride, patch it after creation.
        if (input.prazoOverride !== null) {
          await updateAgrupador(
            created.id,
            { prazoDiasUteisOverride: input.prazoOverride },
            meUid,
            meNome
          );
        }
        showSuccess(`Origem "${trimmedNome}" criada.`);
      } else {
        // Edit: send only changed fields.
        const patch: {
          nome?: string;
          prazoDiasUteisOverride?: number | null;
        } = {};
        if (target.nome !== trimmedNome) patch.nome = trimmedNome;
        if (target.prazoDiasUteisOverride !== input.prazoOverride) {
          patch.prazoDiasUteisOverride = input.prazoOverride;
        }
        if (Object.keys(patch).length === 0) {
          showSuccess('Nada a atualizar.');
        } else {
          await updateAgrupador(target.id, patch, meUid, meNome);
          showSuccess(`Origem "${trimmedNome}" atualizada.`);
        }
      }
      setEditModal(null);
    } catch (err) {
      showError(`Falha ao salvar: ${readErrorMessage(err)}`);
    } finally {
      setBusyGlobal(false);
    }
  }

  function handleToggleAtivo(a: Agrupador) {
    if (!meUid) {
      showError('Usuário não autenticado.');
      return;
    }
    const next = !a.ativo;
    const action = async () => {
      setBusyId(a.id);
      try {
        await updateAgrupador(
          a.id,
          { ativo: next },
          meUid,
          meNome
        );
        showSuccess(
          next
            ? `Origem "${a.nome}" ativada.`
            : `Origem "${a.nome}" desativada.`
        );
      } catch (err) {
        showError(`Falha ao atualizar: ${readErrorMessage(err)}`);
      } finally {
        setBusyId(null);
      }
    };
    if (!next) {
      // Confirm before deactivating.
      setConfirm({
        title: 'Desativar origem',
        message: `Tem certeza que deseja desativar "${a.nome}"? Recebedores deixarão de receber novos processos desta origem, mas o histórico permanece.`,
        confirmLabel: 'Desativar',
        destructive: true,
        onConfirm: action,
      });
    } else {
      void action();
    }
  }

  // ----- Render -----

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Header */}
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink-primary">
            Origens
          </h1>
          <p className="text-sm text-ink-secondary">
            Cadastre origens e defina prazos específicos. Apenas Distribuidores podem editar.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          disabled={busyGlobal}
          className="inline-flex items-center gap-2 self-start rounded-md bg-brand-primary px-3 py-2 text-sm font-semibold text-white hover:bg-brand-primary-dark disabled:cursor-not-allowed disabled:opacity-60 sm:self-auto"
        >
          <Plus className="h-4 w-4" />
          Nova origem
        </button>
      </header>

      {/* Toast */}
      <Toast toast={toast} onDismiss={() => setToast(null)} />

      {/* Loading state */}
      {agrupadores === null ? (
        <div className="flex items-center justify-center rounded-lg border border-gray-200 bg-surface px-4 py-12 text-sm text-ink-secondary">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Carregando origens...
        </div>
      ) : (
        <>
          {/* Empty / seed banner */}
          {isCollectionEmpty && (
            <section
              aria-labelledby="seed-heading"
              className="rounded-lg border border-brand-primary/20 bg-brand-primary-light/20 p-4"
            >
              <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <Sparkles className="mt-0.5 h-5 w-5 text-brand-primary" />
                  <div>
                    <h2
                      id="seed-heading"
                      className="text-sm font-semibold text-ink-primary"
                    >
                      Nenhuma origem cadastrada.
                    </h2>
                    <p className="text-sm text-ink-secondary">
                      Carregar lista padrão (94 origens)?
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleSeed}
                  disabled={busyGlobal}
                  className="inline-flex items-center gap-2 rounded-md bg-brand-primary px-3 py-2 text-sm font-semibold text-white hover:bg-brand-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busyGlobal ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  Carregar origens padrão
                </button>
              </div>
            </section>
          )}

          {/* Listing card */}
          <section className="space-y-4 rounded-lg border border-gray-200 bg-surface p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-base font-semibold text-ink-primary">
                Lista de origens
              </h2>
              <div className="relative w-full sm:max-w-xs">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por nome..."
                  className="w-full rounded-md border border-gray-200 bg-surface py-2 pl-8 pr-3 text-sm text-ink-primary outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20"
                  aria-label="Buscar origem"
                />
              </div>
            </div>

            {/* Filter chips */}
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

            {/* Table */}
            {filteredAndSearched.length === 0 ? (
              <div className="rounded-md border border-dashed border-gray-200 bg-surface px-4 py-10 text-center text-sm text-ink-secondary">
                {isCollectionEmpty
                  ? 'Nenhuma origem cadastrada ainda. Use o botão acima para carregar a lista padrão ou adicione manualmente.'
                  : 'Nenhuma origem corresponde ao filtro/busca atuais.'}
              </div>
            ) : (
              <AgrupadoresTable
                agrupadores={filteredAndSearched}
                busyId={busyId}
                onEdit={openEdit}
                onToggleAtivo={handleToggleAtivo}
              />
            )}
          </section>
        </>
      )}

      {/* Create/edit modal */}
      {editModal && (
        <AgrupadorEditModal
          state={editModal}
          busy={busyGlobal}
          allAgrupadores={agrupadores ?? []}
          onCancel={() => {
            if (!busyGlobal) setEditModal(null);
          }}
          onSave={handleSaveModal}
        />
      )}

      {/* Confirm modal */}
      {confirm && (
        <ConfirmDialog
          state={confirm}
          busy={busyId !== null}
          onCancel={() => {
            if (busyId === null) setConfirm(null);
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
// AgrupadoresTable
// ---------------------------------------------------------------------------

interface AgrupadoresTableProps {
  agrupadores: Agrupador[];
  busyId: string | null;
  onEdit: (a: Agrupador) => void;
  onToggleAtivo: (a: Agrupador) => void;
}

function AgrupadoresTable({
  agrupadores,
  busyId,
  onEdit,
  onToggleAtivo,
}: AgrupadoresTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-ink-secondary">
            <th scope="col" className="py-2 pr-3 font-medium">
              Nome
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              Prazo (dias úteis)
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              Status
            </th>
            <th
              scope="col"
              className="hidden py-2 pr-3 font-medium md:table-cell"
            >
              Criado em
            </th>
            <th scope="col" className="py-2 pl-3 text-right font-medium">
              Ações
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {agrupadores.map((a) => {
            const rowBusy = busyId === a.id;
            const prazoLabel =
              a.prazoDiasUteisOverride !== null
                ? `${a.prazoDiasUteisOverride}`
                : 'Padrão do sistema';
            return (
              <tr
                key={a.id}
                onClick={() => {
                  if (!rowBusy) onEdit(a);
                }}
                className={`cursor-pointer align-middle transition-colors hover:bg-gray-50 ${
                  rowBusy ? 'opacity-60' : ''
                }`}
              >
                <td className="py-3 pr-3">
                  <span className="font-medium text-ink-primary">
                    {a.nome}
                  </span>
                </td>
                <td className="py-3 pr-3 text-sm text-ink-secondary">
                  {a.prazoDiasUteisOverride !== null ? (
                    <span className="text-ink-primary">{prazoLabel}</span>
                  ) : (
                    <span className="italic">{prazoLabel}</span>
                  )}
                </td>
                <td className="py-3 pr-3">
                  {a.ativo ? (
                    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                      Ativo
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-ink-secondary">
                      Inativo
                    </span>
                  )}
                </td>
                <td className="hidden py-3 pr-3 text-sm text-ink-secondary md:table-cell">
                  {formatCreatedAt(a)}
                </td>
                <td className="py-3 pl-3 text-right">
                  <div
                    className="inline-flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      title="Editar"
                      aria-label={`Editar ${a.nome}`}
                      onClick={() => onEdit(a)}
                      disabled={rowBusy}
                      className="rounded-md p-1.5 text-ink-secondary hover:bg-gray-100 hover:text-ink-primary disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      title={a.ativo ? 'Desativar' : 'Ativar'}
                      aria-label={
                        a.ativo
                          ? `Desativar ${a.nome}`
                          : `Ativar ${a.nome}`
                      }
                      onClick={() => onToggleAtivo(a)}
                      disabled={rowBusy}
                      className={`rounded-md p-1.5 disabled:cursor-not-allowed disabled:opacity-50 ${
                        a.ativo
                          ? 'text-state-success hover:bg-emerald-50'
                          : 'text-ink-secondary hover:bg-gray-100 hover:text-ink-primary'
                      }`}
                    >
                      {a.ativo ? (
                        <Power className="h-4 w-4" />
                      ) : (
                        <PowerOff className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AgrupadorEditModal
// ---------------------------------------------------------------------------

interface AgrupadorEditModalProps {
  state: EditModalState;
  busy: boolean;
  allAgrupadores: Agrupador[];
  onCancel: () => void;
  onSave: (input: {
    nome: string;
    prazoOverride: number | null;
  }) => void | Promise<void>;
}

function AgrupadorEditModal({
  state,
  busy,
  allAgrupadores,
  onCancel,
  onSave,
}: AgrupadorEditModalProps) {
  const isEdit = state.agrupador !== null;
  const [nome, setNome] = useState(state.agrupador?.nome ?? '');
  const [prazoText, setPrazoText] = useState<string>(
    state.agrupador?.prazoDiasUteisOverride !== undefined &&
      state.agrupador?.prazoDiasUteisOverride !== null
      ? String(state.agrupador.prazoDiasUteisOverride)
      : ''
  );

  const trimmedNome = nome.trim();
  const slugPreview = slugify(trimmedNome) || 'origem';
  const previewLabel = isEdit
    ? state.agrupador?.id ?? slugPreview
    : slugPreview;

  // Validation: nome required + duplicate check (client-side, soft).
  const duplicateLocal = useMemo(() => {
    if (!trimmedNome) return false;
    const lower = trimmedNome.toLowerCase();
    return allAgrupadores.some(
      (a) =>
        a.nome.toLowerCase() === lower &&
        (!isEdit || a.id !== state.agrupador?.id)
    );
  }, [trimmedNome, allAgrupadores, isEdit, state.agrupador]);

  const prazoTextTrim = prazoText.trim();
  const prazoNumber =
    prazoTextTrim === '' ? null : Number.parseInt(prazoTextTrim, 10);
  const prazoInvalid =
    prazoTextTrim !== '' &&
    (Number.isNaN(prazoNumber) || (prazoNumber !== null && prazoNumber < 1));

  const canSave =
    !busy && trimmedNome.length > 0 && !duplicateLocal && !prazoInvalid;

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSave) return;
    void onSave({
      nome: trimmedNome,
      prazoOverride: prazoNumber,
    });
  }

  return (
    <Modal
      open
      title={isEdit ? 'Editar origem' : 'Nova origem'}
      description={
        isEdit
          ? 'Atualize o nome ou o prazo específico desta origem.'
          : 'Defina o nome da origem e, opcionalmente, um prazo específico em dias úteis.'
      }
      busy={busy}
      onClose={onCancel}
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-gray-200 px-3 py-2 text-sm font-medium text-ink-primary hover:bg-gray-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="agrupador-edit-form"
            disabled={!canSave}
            className="rounded-md bg-brand-primary px-3 py-2 text-sm font-semibold text-white hover:bg-brand-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Salvando...' : isEdit ? 'Salvar alterações' : 'Criar origem'}
          </button>
        </>
      }
    >
      <form
        id="agrupador-edit-form"
        onSubmit={handleSubmit}
        className="space-y-4"
      >
        <div>
          <label
            htmlFor="agrupador-nome"
            className="block text-sm font-medium text-ink-primary"
          >
            Nome <span className="text-state-danger">*</span>
          </label>
          <input
            id="agrupador-nome"
            type="text"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            disabled={busy}
            maxLength={200}
            required
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-ink-primary focus:border-brand-primary focus:ring-1 focus:ring-brand-primary disabled:opacity-50"
          />
          <p className="mt-1 text-xs text-ink-secondary">
            ID que será usado:{' '}
            <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[11px] text-ink-primary">
              {previewLabel}
            </code>
          </p>
          {duplicateLocal && (
            <p className="mt-1 text-xs text-state-danger">
              Já existe uma origem com esse nome.
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="agrupador-prazo"
            className="block text-sm font-medium text-ink-primary"
          >
            Prazo override (dias úteis)
          </label>
          <input
            id="agrupador-prazo"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={prazoText}
            onChange={(e) => setPrazoText(e.target.value)}
            disabled={busy}
            placeholder="Padrão do sistema"
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-ink-primary focus:border-brand-primary focus:ring-1 focus:ring-brand-primary disabled:opacity-50"
          />
          <p className="mt-1 text-xs text-ink-secondary">
            Deixe em branco para usar o prazo padrão definido em Configurações.
          </p>
          {prazoInvalid && (
            <p className="mt-1 text-xs text-state-danger">
              Informe um número inteiro maior ou igual a 1.
            </p>
          )}
        </div>
      </form>
    </Modal>
  );
}
