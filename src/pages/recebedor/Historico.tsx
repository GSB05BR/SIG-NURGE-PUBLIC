import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eraser,
  Flame,
  Inbox,
  Loader2,
  RefreshCw,
  Search,
  Star,
} from 'lucide-react';
import { useAuth } from '@/store/authStore';
import { getProcessosConcluidosByRecebedor } from '@/services/firebase/processos';
import {
  getConcluidosRecebedorCache,
  setConcluidosRecebedorCache,
  invalidateConcluidosRecebedorCache,
} from '@/store/processosStore';
import { formatDateBr, parseIsoDateLocal } from '@/lib/datetime';
import { formatDadosConclusao } from '@/lib/conclusao';
import {
  HISTORICO_RECEBEDOR_LIMITE,
  diffDiasUteis,
  selecionarConcluidosRecentes,
} from '@/lib/processo-helpers';
import { usePageTitle } from '@/lib/usePageTitle';
import type { Processo } from '@/types';
import { Field } from '@/components/form/Field';

const PAGE_SIZE = 20;

const ORIGEM_LABEL: Record<Processo['origem'], string> = {
  sei_json: 'SEI JSON',
  csv: 'Legado',
  manual: 'Manual',
};

interface AgrupadorOption {
  id: string;
  nome: string;
}

export default function RecebedorHistorico() {
  usePageTitle('Meu histórico');
  const { firebaseUser } = useAuth();
  const meUid = firebaseUser?.uid ?? null;

  const [processos, setProcessos] = useState<Processo[] | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [agrupadorId, setAgrupadorId] = useState('');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [somenteUrgentes, setSomenteUrgentes] = useState(false);
  const [somentePrioridades, setSomentePrioridades] = useState(false);
  const [copiedNumero, setCopiedNumero] = useState<string | null>(null);

  // Pagination
  const [page, setPage] = useState(0);
  const [fetchKey, setFetchKey] = useState(0);

  // Item 6: leitura única memoizada dos concluídos (sem listener realtime de
  // tudo). Remontagens reaproveitam o cache de sessão; "Atualizar" recarrega.
  useEffect(() => {
    if (!meUid) return;
    const cached = getConcluidosRecebedorCache(meUid);
    if (cached) {
      setProcessos(cached);
      return;
    }
    setProcessos(null);
    let cancelled = false;
    void (async () => {
      try {
        const list = await getProcessosConcluidosByRecebedor(meUid);
        if (cancelled) return;
        setConcluidosRecebedorCache(meUid, list);
        setProcessos(list);
      } catch {
        if (!cancelled) setProcessos([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [meUid, fetchKey]);

  const refresh = useCallback(() => {
    invalidateConcluidosRecebedorCache();
    setFetchKey((k) => k + 1);
  }, []);

  // Reset page when filters change.
  useEffect(() => {
    setPage(0);
  }, [
    search,
    agrupadorId,
    dataInicio,
    dataFim,
    somenteUrgentes,
    somentePrioridades,
  ]);

  // Derived ---------------------------------------------------------------

  const todosConcluidos = useMemo(() => {
    return (processos ?? []).filter((p) => p.status === 'concluido');
  }, [processos]);

  // O recebedor enxerga apenas os concluídos mais recentes; busca, filtros,
  // origens e paginação operam dentro dessa janela.
  const concluidos = useMemo(
    () => selecionarConcluidosRecentes(todosConcluidos),
    [todosConcluidos]
  );
  const limiteAtingido = todosConcluidos.length > HISTORICO_RECEBEDOR_LIMITE;

  const agrupadoresDisponiveis: AgrupadorOption[] = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of concluidos) {
      if (!seen.has(p.agrupadorId)) seen.set(p.agrupadorId, p.agrupadorNome);
    }
    return Array.from(seen, ([id, nome]) => ({ id, nome })).sort((a, b) =>
      a.nome.localeCompare(b.nome)
    );
  }, [concluidos]);

  const filtrados = useMemo(() => {
    const trimmed = search.trim().toLowerCase();
    const inicioMs =
      dataInicio !== '' ? parseIsoDateLocal(dataInicio).getTime() : null;
    const fimMs =
      dataFim !== '' ? parseIsoDateLocal(addIsoDays(dataFim, 1)).getTime() : null;
    const list = concluidos.filter((p) => {
      if (trimmed !== '') {
        const haystack = [
          p.numero,
          ...formatDadosConclusao(p.dadosConclusao).map((item) => item.value),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(trimmed)) return false;
      }
      if (agrupadorId !== '' && p.agrupadorId !== agrupadorId) return false;
      if (somenteUrgentes && !p.urgente) return false;
      if (somentePrioridades && !p.prioridade) return false;
      const concluidoMs = p.concluidoEm?.toMillis() ?? null;
      if (inicioMs !== null) {
        if (concluidoMs === null || concluidoMs < inicioMs) return false;
      }
      if (fimMs !== null) {
        if (concluidoMs === null || concluidoMs >= fimMs) return false;
      }
      return true;
    });
    // Most recently concluded first.
    list.sort((a, b) => {
      const ta = a.concluidoEm?.toMillis() ?? 0;
      const tb = b.concluidoEm?.toMillis() ?? 0;
      return tb - ta;
    });
    return list;
  }, [
    concluidos,
    search,
    agrupadorId,
    dataInicio,
    dataFim,
    somenteUrgentes,
    somentePrioridades,
  ]);

  const totalPages = Math.max(1, Math.ceil(filtrados.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageStart = safePage * PAGE_SIZE;
  const pageItems = filtrados.slice(pageStart, pageStart + PAGE_SIZE);

  const filtrosAtivos =
    search.trim() !== '' ||
    agrupadorId !== '' ||
    dataInicio !== '' ||
    dataFim !== '' ||
    somenteUrgentes ||
    somentePrioridades;

  function clearFilters() {
    setSearch('');
    setAgrupadorId('');
    setDataInicio('');
    setDataFim('');
    setSomenteUrgentes(false);
    setSomentePrioridades(false);
  }

  async function copyNumero(numero: string) {
    await navigator.clipboard.writeText(numero);
    setCopiedNumero(numero);
    window.setTimeout(() => {
      setCopiedNumero((cur) => (cur === numero ? null : cur));
    }, 1400);
  }

  const carregando = processos === null;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink-primary">
            Histórico de processos concluídos
          </h1>
          <p className="mt-1 text-sm text-ink-secondary">
            Lista dos seus processos concluídos mais recentes. Use os filtros
            para pesquisar por período, origem ou número.
          </p>
          {limiteAtingido && (
            <p className="mt-1 text-xs text-ink-secondary">
              Mostrando apenas os {HISTORICO_RECEBEDOR_LIMITE} processos
              concluídos mais recentes.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={carregando}
          className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-surface px-3 py-1.5 text-sm font-medium text-ink-primary transition-colors hover:bg-gray-50 disabled:opacity-60"
        >
          <RefreshCw className="h-4 w-4" />
          Atualizar
        </button>
      </header>

      {/* Filters */}
      <section className="rounded-lg border border-gray-200 bg-surface p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field
            label="Número do processo"
            htmlFor="hist-busca"
            className="lg:col-span-2"
            labelClassName="text-xs font-medium text-ink-secondary"
          >
            {(fieldProps) => (
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary"
                  aria-hidden="true"
                />
                <input
                  {...fieldProps}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por número..."
                  className="w-full rounded-md border border-gray-300 bg-surface py-2 pl-8 pr-3 text-sm text-ink-primary focus:border-brand-primary focus:ring-1 focus:ring-brand-primary"
                />
              </div>
            )}
          </Field>

          <Field
            label="Origem"
            htmlFor="hist-agrupador"
            labelClassName="text-xs font-medium text-ink-secondary"
          >
            {(fieldProps) => (
              <select
                {...fieldProps}
                value={agrupadorId}
                onChange={(e) => setAgrupadorId(e.target.value)}
                className="w-full rounded-md border border-gray-300 bg-surface py-2 px-3 text-sm text-ink-primary focus:border-brand-primary focus:ring-1 focus:ring-brand-primary"
              >
                <option value="">Todos</option>
                {agrupadoresDisponiveis.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nome}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <div className="flex items-end">
            <label className="flex w-full items-center gap-2 rounded-md border border-gray-300 bg-surface px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={somenteUrgentes}
                onChange={(e) => setSomenteUrgentes(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-gray-300 accent-brand-primary"
              />
              <span className="inline-flex items-center gap-1 text-ink-primary">
                <Flame className="h-3.5 w-3.5 text-brand-primary" />
                Somente urgentes
              </span>
            </label>
          </div>

          <div className="flex items-end">
            <label className="flex w-full items-center gap-2 rounded-md border border-gray-300 bg-surface px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={somentePrioridades}
                onChange={(e) => setSomentePrioridades(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-gray-300 accent-brand-primary"
              />
              <span className="inline-flex items-center gap-1 text-ink-primary">
                <Star className="h-3.5 w-3.5 text-brand-primary" />
                Somente prioridades
              </span>
            </label>
          </div>

          <Field
            label="Concluído de"
            htmlFor="hist-de"
            labelClassName="text-xs font-medium text-ink-secondary"
          >
            {(fieldProps) => (
              <input
                {...fieldProps}
                type="date"
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
                className="w-full rounded-md border border-gray-300 bg-surface py-2 px-3 text-sm text-ink-primary focus:border-brand-primary focus:ring-1 focus:ring-brand-primary"
              />
            )}
          </Field>

          <Field
            label="Concluído até"
            htmlFor="hist-ate"
            labelClassName="text-xs font-medium text-ink-secondary"
          >
            {(fieldProps) => (
              <input
                {...fieldProps}
                type="date"
                value={dataFim}
                onChange={(e) => setDataFim(e.target.value)}
                className="w-full rounded-md border border-gray-300 bg-surface py-2 px-3 text-sm text-ink-primary focus:border-brand-primary focus:ring-1 focus:ring-brand-primary"
              />
            )}
          </Field>

          <div className="flex items-end gap-2 sm:col-span-2">
            <p className="flex-1 text-xs text-ink-secondary">
              {carregando
                ? 'Carregando...'
                : `${filtrados.length} processo${filtrados.length === 1 ? '' : 's'} encontrado${filtrados.length === 1 ? '' : 's'}.`}
            </p>
            {filtrosAtivos && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-200 bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-primary hover:bg-gray-50"
              >
                <Eraser className="h-3.5 w-3.5" />
                Limpar
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Tabela */}
      {carregando ? (
        <div className="flex items-center justify-center rounded-lg border border-gray-200 bg-surface px-4 py-12 text-sm text-ink-secondary">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Carregando histórico...
        </div>
      ) : filtrados.length === 0 ? (
        <EmptyState
          title="Nenhum processo encontrado"
          message={
            concluidos.length === 0
              ? 'Quando você concluir processos, eles aparecerão aqui.'
              : 'Ajuste os filtros para encontrar processos concluídos.'
          }
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-lg border border-gray-200 bg-surface shadow-sm md:block">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-surface-elevated">
                <tr>
                  <Th>Número</Th>
                  <Th>Origem SEI</Th>
                  <Th>Guia</Th>
                  <Th>Sentenciado</Th>
                  <Th>Tipo de pena</Th>
                  <Th>Regime condenação</Th>
                  <Th>Situação prisão</Th>
                  <Th>Atividade</Th>
                  <Th>Execução penal</Th>
                  <Th>Comarca</Th>
                  <Th>Benefícios pendentes</Th>
                  <Th>Atribuído em</Th>
                  <Th>Concluído em</Th>
                  <Th>Dias úteis</Th>
                  <Th>Origem do cadastro</Th>
                  <Th className="text-center">Urgente</Th>
                  <Th className="text-center">Prioridade</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pageItems.map((p) => (
                  <tr key={p.id} className="hover:bg-surface-elevated">
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-primary">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono">{p.numero}</span>
                        <button
                          type="button"
                          onClick={() => void copyNumero(p.numero)}
                          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-gray-200 text-ink-secondary hover:bg-gray-50 hover:text-ink-primary"
                          title="Copiar número"
                          aria-label={`Copiar número do processo ${p.numero}`}
                        >
                          {copiedNumero === p.numero ? (
                            <Check className="h-3.5 w-3.5 text-state-success" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-primary">
                      {p.agrupadorNome}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-primary">
                      {dadosConclusaoValor(p, 'Nº da guia')}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-primary">
                      {dadosConclusaoValor(p, 'Sentenciado')}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-secondary">
                      {dadosConclusaoValor(p, 'Tipo de pena')}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-secondary">
                      {dadosConclusaoValor(p, 'Regime da condenação')}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-secondary">
                      {dadosConclusaoValor(p, 'Situação de prisão')}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-secondary">
                      {dadosConclusaoValor(p, 'Atividade')}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-primary">
                      {dadosConclusaoValor(p, 'Nº da execução penal')}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-primary">
                      {dadosConclusaoValor(p, 'Comarca')}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-secondary">
                      {dadosConclusaoValor(p, 'Benefícios pendentes')}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-secondary">
                      {formatDateBr(p.diaAtribuicao.toDate())}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-secondary">
                      {p.concluidoEm
                        ? formatDateBr(p.concluidoEm.toDate())
                        : '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-secondary">
                      {p.concluidoEm
                        ? diffDiasUteis(
                            p.diaAtribuicao.toDate(),
                            p.concluidoEm.toDate()
                          )
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-secondary">
                      {ORIGEM_LABEL[p.origem]}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {p.urgente ? (
                        <Flame
                          className="mx-auto h-4 w-4 text-brand-primary"
                          aria-label="Urgente"
                        />
                      ) : (
                        <span className="text-ink-secondary">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {p.prioridade ? (
                        <Star
                          className="mx-auto h-4 w-4 text-brand-primary"
                          aria-label="Prioridade"
                        />
                      ) : (
                        <span className="text-ink-secondary">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {pageItems.map((p) => (
              <article
                key={p.id}
                className="rounded-lg border border-gray-200 bg-surface p-3 text-sm shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-1.5">
                    <span className="break-all font-mono text-xs font-semibold text-ink-primary">
                      {p.numero}
                    </span>
                    <button
                      type="button"
                      onClick={() => void copyNumero(p.numero)}
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-gray-200 text-ink-secondary hover:bg-gray-50 hover:text-ink-primary"
                      title="Copiar número"
                      aria-label={`Copiar número do processo ${p.numero}`}
                    >
                      {copiedNumero === p.numero ? (
                        <Check className="h-3.5 w-3.5 text-state-success" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                  {p.urgente && (
                    <Flame className="h-4 w-4 text-brand-primary" />
                  )}
                  {p.prioridade && (
                    <Star className="h-4 w-4 text-brand-primary" />
                  )}
                </div>
                <p className="mt-1 text-xs text-ink-primary">
                  {p.agrupadorNome}
                </p>
                <dl className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-ink-secondary">
                  {formatDadosConclusao(p.dadosConclusao).map((item) => (
                    <div key={item.label} className="col-span-2">
                      <dt>{item.label}</dt>
                      <dd className="text-ink-primary">{item.value}</dd>
                    </div>
                  ))}
                  <div>
                    <dt>Atribuído</dt>
                    <dd className="text-ink-primary">
                      {formatDateBr(p.diaAtribuicao.toDate())}
                    </dd>
                  </div>
                  <div>
                    <dt>Concluído</dt>
                    <dd className="text-ink-primary">
                      {p.concluidoEm
                        ? formatDateBr(p.concluidoEm.toDate())
                        : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt>Dias úteis</dt>
                    <dd className="text-ink-primary">
                      {p.concluidoEm
                        ? diffDiasUteis(
                            p.diaAtribuicao.toDate(),
                            p.concluidoEm.toDate()
                          )
                        : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt>Origem do cadastro</dt>
                    <dd className="text-ink-primary">
                      {ORIGEM_LABEL[p.origem]}
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>

          {totalPages > 1 && (
            <nav
              aria-label="Paginação"
              className="flex items-center justify-between text-xs text-ink-secondary"
            >
              <span className="tabular-nums" aria-live="polite">
                Página {safePage + 1} de {totalPages}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={safePage === 0}
                  aria-label="Página anterior"
                  className="inline-flex min-h-[44px] items-center gap-1 rounded-md border border-gray-200 bg-surface px-2.5 py-1.5 font-medium text-ink-primary hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Anterior
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setPage((p) => Math.min(totalPages - 1, p + 1))
                  }
                  disabled={safePage >= totalPages - 1}
                  aria-label="Próxima página"
                  className="inline-flex min-h-[44px] items-center gap-1 rounded-md border border-gray-200 bg-surface px-2.5 py-1.5 font-medium text-ink-primary hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Próxima
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </nav>
          )}
        </>
      )}
    </div>
  );
}

function dadosConclusaoValor(processo: Processo, label: string): string {
  return (
    formatDadosConclusao(processo.dadosConclusao).find(
      (item) => item.label === label
    )?.value ?? '—'
  );
}

function addIsoDays(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function Th({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-secondary ${className}`}
    >
      {children}
    </th>
  );
}

interface EmptyStateProps {
  title: string;
  message: string;
}

function EmptyState({ title, message }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-gray-300 bg-surface px-4 py-12 text-center">
      <Inbox className="h-10 w-10 text-ink-secondary/60" />
      <h2 className="text-lg font-semibold text-ink-primary">{title}</h2>
      <p className="max-w-md text-sm text-ink-secondary">{message}</p>
    </div>
  );
}
