import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Eraser,
  Filter,
  History as HistoryIcon,
  Loader2,
  Search,
} from 'lucide-react';
import { subscribeHistorico } from '@/services/firebase/historico';
import { subscribeAllUsers } from '@/services/firebase/users';
import {
  HISTORICO_TIPOS_TODOS,
  HISTORICO_TIPO_LABELS,
  getHistoricoTipoCor,
  resumirPayload,
} from '@/lib/historico-helpers';
import { formatDateBr } from '@/lib/datetime';
import { usePageTitle } from '@/lib/usePageTitle';
import type { HistoricoEntry, HistoricoTipo, User } from '@/types';
import UserAvatar from '@/components/usuarios/UserAvatar';
import { Field } from '@/components/form/Field';

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
type PageSizeOption = (typeof PAGE_SIZE_OPTIONS)[number];
const DEFAULT_PAGE_SIZE: PageSizeOption = 50;
const LIMIT_OPTIONS = [50, 100, 200] as const;
type LimitOption = (typeof LIMIT_OPTIONS)[number];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Historico() {
  usePageTitle('Histórico');

  // Filters
  const [tipos, setTipos] = useState<HistoricoTipo[]>([]);
  const [acaoPorUids, setAcaoPorUids] = useState<string[]>([]);
  const [alvoQuery, setAlvoQuery] = useState('');
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [limite, setLimite] = useState<LimitOption>(200);

  // Pagination
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<PageSizeOption>(DEFAULT_PAGE_SIZE);

  // Data
  const [users, setUsers] = useState<User[] | null>(null);
  const [entries, setEntries] = useState<HistoricoEntry[] | null>(null);

  useEffect(() => {
    const unsub = subscribeAllUsers((list) => setUsers(list));
    return unsub;
  }, []);

  useEffect(() => {
    setEntries(null);
    const unsub = subscribeHistorico({ tipos, limit: limite }, (list) =>
      setEntries(list)
    );
    return unsub;
    // tipos & limite affect the query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(tipos), limite]);

  useEffect(() => {
    setPage(0);
  }, [
    JSON.stringify(tipos),
    JSON.stringify(acaoPorUids),
    alvoQuery,
    dateStart,
    dateEnd,
    limite,
    pageSize,
  ]);

  const distribuidoresList = useMemo(
    () => (users ?? []).filter((u) => u.role === 'distribuidor'),
    [users]
  );

  const usersByUid = useMemo(() => {
    const m = new Map<string, User>();
    (users ?? []).forEach((u) => m.set(u.uid, u));
    return m;
  }, [users]);

  // Apply client-side filters that the service can't easily express.
  const filtered = useMemo(() => {
    if (!entries) return [];
    const acaoSet = acaoPorUids.length ? new Set(acaoPorUids) : null;
    const q = alvoQuery.trim().toLowerCase();
    const startMs = dateStart ? new Date(dateStart + 'T00:00:00').getTime() : null;
    const endMs = dateEnd
      ? new Date(dateEnd + 'T23:59:59.999').getTime()
      : null;
    return entries.filter((e) => {
      if (acaoSet && !acaoSet.has(e.acaoPorUid)) return false;
      if (startMs !== null || endMs !== null) {
        const ms = e.timestamp?.toMillis ? e.timestamp.toMillis() : 0;
        if (startMs !== null && ms < startMs) return false;
        if (endMs !== null && ms > endMs) return false;
      }
      if (q) {
        const alvoUid = e.alvoUid ?? '';
        const alvoUser = e.alvoUid ? usersByUid.get(e.alvoUid) : null;
        const alvoNome = alvoUser?.displayName ?? '';
        if (
          !alvoUid.toLowerCase().includes(q) &&
          !alvoNome.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [entries, acaoPorUids, alvoQuery, dateStart, dateEnd, usersByUid]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = filtered.slice(
    safePage * pageSize,
    (safePage + 1) * pageSize
  );
  const rangeStart = filtered.length === 0 ? 0 : safePage * pageSize + 1;
  const rangeEnd = Math.min((safePage + 1) * pageSize, filtered.length);

  function clearFilters() {
    setTipos([]);
    setAcaoPorUids([]);
    setAlvoQuery('');
    setDateStart('');
    setDateEnd('');
    setLimite(200);
    setPageSize(DEFAULT_PAGE_SIZE);
  }

  const isLoading = entries === null || users === null;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold text-ink-primary">
          Histórico de ações
        </h1>
        <p className="text-sm text-ink-secondary">
          Log completo de ações administrativas, distribuições e mudanças de
          status. Atualizado em tempo real.
        </p>
      </header>

      {/* Filters */}
      <section className="space-y-3 rounded-lg border border-gray-200 bg-surface p-4">
        <div className="flex flex-wrap items-end gap-3">
          {/* Tipo */}
          <MultiSelect
            label="Tipo de ação"
            options={HISTORICO_TIPOS_TODOS.map((t) => ({
              value: t,
              label: HISTORICO_TIPO_LABELS[t],
            }))}
            selected={tipos}
            onChange={(v) => setTipos(v as HistoricoTipo[])}
            emptyText="Todos"
          />

          {/* Ação por */}
          <MultiSelect
            label="Ação por"
            options={distribuidoresList.map((u) => ({
              value: u.uid,
              label: u.displayName,
            }))}
            selected={acaoPorUids}
            onChange={setAcaoPorUids}
            emptyText="Todos os distribuidores"
          />

          {/* Alvo */}
          <Field
            label="Alvo (uid ou nome)"
            labelClassName="text-xs font-normal text-ink-secondary"
          >
            {(fieldProps) => (
              <div className="flex items-center rounded-md border border-gray-300 px-2 py-1 focus-within:border-brand-primary">
                <Search
                  className="h-3.5 w-3.5 text-ink-secondary"
                  aria-hidden="true"
                />
                <input
                  {...fieldProps}
                  type="text"
                  value={alvoQuery}
                  onChange={(e) => setAlvoQuery(e.target.value)}
                  placeholder="Buscar..."
                  className="ml-1 w-full bg-transparent text-sm text-ink-primary outline-none placeholder:text-ink-secondary/70"
                />
              </div>
            )}
          </Field>

          {/* Date range */}
          <Field
            label="De"
            labelClassName="text-xs font-normal text-ink-secondary"
          >
            {(fieldProps) => (
              <input
                {...fieldProps}
                type="date"
                value={dateStart}
                onChange={(e) => setDateStart(e.target.value)}
                className="rounded-md border border-gray-300 px-2 py-1 text-sm text-ink-primary"
              />
            )}
          </Field>
          <Field
            label="Até"
            labelClassName="text-xs font-normal text-ink-secondary"
          >
            {(fieldProps) => (
              <input
                {...fieldProps}
                type="date"
                value={dateEnd}
                onChange={(e) => setDateEnd(e.target.value)}
                className="rounded-md border border-gray-300 px-2 py-1 text-sm text-ink-primary"
              />
            )}
          </Field>

          {/* Limit */}
          <Field
            label="Limite"
            labelClassName="text-xs font-normal text-ink-secondary"
          >
            {(fieldProps) => (
              <select
                {...fieldProps}
                value={limite}
                onChange={(e) =>
                  setLimite(Number(e.target.value) as LimitOption)
                }
                className="rounded-md border border-gray-300 px-2 py-1 text-sm text-ink-primary"
              >
                {LIMIT_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    Últimas {opt}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <button
            type="button"
            onClick={clearFilters}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-gray-300 bg-surface px-2.5 py-1 text-xs font-medium text-ink-primary transition-colors hover:bg-gray-50"
          >
            <Eraser className="h-3.5 w-3.5" />
            Limpar filtros
          </button>
        </div>
      </section>

      {/* Body */}
      {isLoading ? (
        <LoadingCard />
      ) : filtered.length === 0 ? (
        <EmptyCard hasEntries={(entries ?? []).length > 0} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-surface">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left text-xs uppercase tracking-wide text-ink-secondary">
                  <th scope="col" className="px-3 py-2 font-medium">
                    Quando
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Tipo
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Ação por
                  </th>
                  <th
                    scope="col"
                    className="hidden px-3 py-2 font-medium md:table-cell"
                  >
                    Alvo
                  </th>
                  <th
                    scope="col"
                    className="hidden px-3 py-2 font-medium lg:table-cell"
                  >
                    Processo
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Detalhes
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pageItems.map((e) => {
                  const alvoUser = e.alvoUid
                    ? usersByUid.get(e.alvoUid)
                    : null;
                  const alvoLabel = alvoUser
                    ? alvoUser.displayName
                    : e.alvoUid ?? '';
                  return (
                    <tr key={e.id}>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-secondary">
                        {formatTimestamp(e)}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${getHistoricoTipoCor(e.tipo)}`}
                        >
                          {HISTORICO_TIPO_LABELS[e.tipo]}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <ActorCell uid={e.acaoPorUid} nome={e.acaoPorNome} />
                      </td>
                      <td className="hidden px-3 py-2 md:table-cell">
                        {alvoUser ? (
                          <ActorCell
                            uid={alvoUser.uid}
                            nome={alvoUser.displayName}
                            photoURL={alvoUser.photoURL}
                          />
                        ) : alvoLabel ? (
                          <span className="font-mono text-xs text-ink-secondary">
                            {alvoLabel.slice(0, 12)}...
                          </span>
                        ) : (
                          <span className="text-ink-secondary">—</span>
                        )}
                      </td>
                      <td className="hidden px-3 py-2 lg:table-cell">
                        {e.processoId ? (
                          <span className="font-mono text-xs text-ink-secondary">
                            {e.processoId.slice(0, 8)}…
                          </span>
                        ) : (
                          <span className="text-ink-secondary">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-ink-primary">
                        {resumirPayload(e)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <nav
            role="navigation"
            aria-label="Paginação"
            className="flex flex-wrap items-center justify-between gap-3 text-sm text-ink-secondary"
          >
            <div className="tabular-nums">
              Mostrando{' '}
              <span className="font-medium text-ink-primary">{rangeStart}</span>
              {'–'}
              <span className="font-medium text-ink-primary">{rangeEnd}</span>{' '}
              de{' '}
              <span className="font-medium text-ink-primary">
                {filtered.length}
              </span>{' '}
              entradas
              {(entries?.length ?? 0) !== filtered.length && (
                <> (filtrado de {entries?.length})</>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1 text-xs text-ink-secondary">
                Por página
                <select
                  value={pageSize}
                  onChange={(e) =>
                    setPageSize(Number(e.target.value) as PageSizeOption)
                  }
                  className="rounded-md border border-gray-300 bg-surface px-2 py-1 text-xs text-ink-primary"
                  aria-label="Itens por página"
                >
                  {PAGE_SIZE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
                className="inline-flex min-h-[44px] items-center gap-1 rounded-md border border-gray-300 bg-surface px-3 py-1.5 text-sm font-medium text-ink-primary transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Página anterior"
              >
                <ChevronLeft className="h-4 w-4" />
                Anterior
              </button>
              <span className="px-1 text-xs tabular-nums" aria-live="polite">
                Página {safePage + 1} de {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={safePage >= totalPages - 1}
                className="inline-flex min-h-[44px] items-center gap-1 rounded-md border border-gray-300 bg-surface px-3 py-1.5 text-sm font-medium text-ink-primary transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Próxima página"
              >
                Próxima
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </nav>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

interface ActorCellProps {
  uid: string;
  nome: string;
  photoURL?: string | null;
}

function ActorCell({ nome, photoURL }: ActorCellProps) {
  return (
    <div className="flex items-center gap-2">
      <UserAvatar
        displayName={nome}
        photoURL={photoURL ?? null}
        size="sm"
      />
      <span className="line-clamp-1 text-sm text-ink-primary">{nome}</span>
    </div>
  );
}

interface MultiSelectProps {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
  emptyText: string;
}

function MultiSelect({
  label,
  options,
  selected,
  onChange,
  emptyText,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) {
      document.addEventListener('mousedown', onDocClick);
      return () => document.removeEventListener('mousedown', onDocClick);
    }
  }, [open]);

  const buttonLabel =
    selected.length === 0
      ? emptyText
      : selected.length === 1
      ? options.find((o) => o.value === selected[0])?.label ?? '1 selecionado'
      : `${selected.length} selecionados`;

  return (
    <div ref={containerRef} className="relative flex flex-col text-xs text-ink-secondary">
      <span className="mb-1">{label}</span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex min-w-[180px] items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
          selected.length > 0
            ? 'border-brand-primary bg-brand-primary/5 text-brand-primary'
            : 'border-gray-300 bg-surface text-ink-primary hover:bg-gray-50'
        }`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Filter className="h-3 w-3" />
        <span className="truncate">{buttonLabel}</span>
      </button>
      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          className="absolute left-0 top-full z-20 mt-1 max-h-72 w-72 overflow-y-auto rounded-md border border-gray-200 bg-surface p-1 shadow-lg"
        >
          {options.length === 0 ? (
            <div className="px-2 py-3 text-xs text-ink-secondary">
              Nenhuma opção disponível.
            </div>
          ) : (
            options.map((opt) => {
              const checked = selected.includes(opt.value);
              return (
                <label
                  key={opt.value}
                  className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors hover:bg-gray-50 ${
                    checked ? 'text-brand-primary' : 'text-ink-primary'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      if (checked) {
                        onChange(selected.filter((v) => v !== opt.value));
                      } else {
                        onChange([...selected, opt.value]);
                      }
                    }}
                    className="accent-brand-primary"
                  />
                  <span className="line-clamp-1">{opt.label}</span>
                </label>
              );
            })
          )}
          {selected.length > 0 && (
            <div className="mt-1 border-t border-gray-100 pt-1">
              <button
                type="button"
                onClick={() => onChange([])}
                className="w-full rounded px-2 py-1 text-left text-xs text-ink-secondary hover:bg-gray-50"
              >
                Limpar seleção
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LoadingCard() {
  return (
    <div className="flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-surface px-4 py-12 text-sm text-ink-secondary">
      <Loader2 className="h-4 w-4 animate-spin" />
      Carregando histórico...
    </div>
  );
}

function EmptyCard({ hasEntries }: { hasEntries: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-gray-200 bg-surface px-4 py-12 text-center text-sm text-ink-secondary">
      <HistoryIcon className="h-8 w-8 text-ink-secondary" />
      <span>
        {hasEntries
          ? 'Nenhuma entrada corresponde aos filtros aplicados.'
          : 'Nenhuma entrada de histórico ainda.'}
      </span>
    </div>
  );
}

function formatTimestamp(e: HistoricoEntry): string {
  if (!e.timestamp || typeof e.timestamp.toDate !== 'function') return '—';
  try {
    const d = e.timestamp.toDate();
    return `${formatDateBr(d)} ${formatDateBr(d, 'HH:mm:ss')}`;
  } catch {
    return '—';
  }
}
