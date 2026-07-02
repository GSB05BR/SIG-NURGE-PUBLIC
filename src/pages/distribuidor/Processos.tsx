import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Eraser,
  FileText,
  Filter,
  Flame,
  History as HistoryIcon,
  Loader2,
  RefreshCw,
  Search,
  Star,
  Trash2,
  UserMinus,
  Users,
} from 'lucide-react';
import {
  addDiasUteis,
  formatDateBr,
  nowInSp,
} from '@/lib/datetime';
import {
  desmarcarProcessoUrgente,
  deleteProcessosByIds,
  devolverProcessoParaFila,
  getAllProcessos,
  getProcessosByDistribuicaoIds,
  getProcessosByPeriodo,
  marcarProcessoUrgente,
  renovarPrazoProcesso,
  updateProcessoStatus,
} from '@/services/firebase/processos';
import { subscribeAllUsers } from '@/services/firebase/users';
import { subscribeAgrupadores } from '@/services/firebase/agrupadores';
import { subscribeConfigSistema } from '@/services/firebase/sistema-config';
import { apagarUltimaDistribuicaoComProcessos } from '@/services/firebase/distribuicoes';
import { subscribeHistoricoProcesso } from '@/services/firebase/historico';
import { useAuth } from '@/store/authStore';
import {
  getTodosCache,
  setTodosCache,
  invalidateTodosCache,
} from '@/store/processosStore';
import {
  compareUrgentesFirst,
  diffDiasUteis,
  getStatusBadgeClass,
  getStatusLabel,
  getSentenciadoNomeProcesso,
  isAtrasado,
} from '@/lib/processo-helpers';
import {
  ATIVIDADE_CONCLUSAO_OPTIONS,
  BENEFICIO_PENDENTE_OPTIONS,
  EXECUCAO_PENAL_PATTERN,
  GUIA_EXECUCAO_PATTERN,
  REGIME_CONDENACAO_OPTIONS,
  SITUACAO_PRISAO_OPTIONS,
  TIPO_PENA_OPTIONS,
  formatDadosConclusao,
} from '@/lib/conclusao';
import {
  HISTORICO_TIPO_LABELS,
  getHistoricoTipoCor,
  resumirPayload,
} from '@/lib/historico-helpers';
import { usePageTitle } from '@/lib/usePageTitle';
import type {
  Agrupador,
  BeneficioPendenteConclusao,
  ConfigSistema,
  ConclusaoAtividade,
  ConclusaoRegimeCondenacao,
  ConclusaoSituacaoPrisao,
  ConclusaoTipoPena,
  DadosConclusaoProcesso,
  DiaSemana,
  HistoricoEntry,
  Processo,
  ProcessoOrigem,
  ProcessoStatus,
  User,
} from '@/types';
import UserAvatar from '@/components/usuarios/UserAvatar';
import { Field } from '@/components/form/Field';
import Toast, { type ToastState } from '@/components/Toast';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type PeriodoMode = 'mes' | 'todos' | 'custom';
type ProcessoStatusEditavel = Extract<
  ProcessoStatus,
  'pendente' | 'em_andamento' | 'concluido'
>;

interface PeriodoIso {
  start: string; // inclusive
  end: string; // exclusive
}

const DIA_SEMANA_LABEL: Record<DiaSemana, string> = {
  segunda: 'Segunda',
  terca: 'Terça',
  quarta: 'Quarta',
  quinta: 'Quinta',
  sexta: 'Sexta',
};

const REGIME_LABEL: Record<Processo['regime'], string> = {
  aberto: 'Aberto',
  fechado: 'Fechado',
};

const STATUS_OPTIONS: ProcessoStatus[] = [
  'nao_atribuido',
  'pendente',
  'em_andamento',
  'em_coordenacao',
  'em_espera',
  'concluido',
];
const STATUS_CHANGE_OPTIONS: ProcessoStatusEditavel[] = [
  'pendente',
  'em_andamento',
  'concluido',
];
const ORIGEM_OPTIONS: ProcessoOrigem[] = ['sei_json', 'manual'];

const ORIGEM_LABEL: Record<ProcessoOrigem, string> = {
  sei_json: 'SEI JSON',
  csv: 'Legado',
  manual: 'Manual',
};

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
type PageSizeOption = (typeof PAGE_SIZE_OPTIONS)[number];
const DEFAULT_PAGE_SIZE: PageSizeOption = 50;

type SortKey =
  | 'numero'
  | 'agrupador'
  | 'recebedor'
  | 'diaSemana'
  | 'diaAtribuicao'
  | 'prazoFinal'
  | 'status'
  | 'origem';

type SortDir = 'asc' | 'desc';
type BulkAction = 'urgente' | 'desatribuir' | 'concluir' | 'remover';

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Processos() {
  usePageTitle('Processos');
  const { firebaseUser, userDoc } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const historyProcessoIdParam =
    searchParams.get('historicoProcessoId') ?? searchParams.get('processoId') ?? '';
  const openedHistoryUrlRef = useRef<string | null>(null);

  const [now, setNow] = useState<Date>(() => nowInSp());
  useEffect(() => {
    const id = window.setInterval(() => setNow(nowInSp()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const mesAtualKey = useMemo(
    () => `${now.getFullYear()}-${now.getMonth()}`,
    [now]
  );

  // Period filters
  const [modo, setModo] = useState<PeriodoMode>(() =>
    historyProcessoIdParam ? 'todos' : 'mes'
  );
  const [customStart, setCustomStart] = useState<string>(() =>
    firstOfMonthIso(now)
  );
  const [customEnd, setCustomEnd] = useState<string>(() => todayIso(now));

  // Other filters
  const [busca, setBusca] = useState('');
  const [recebedoresFiltro, setRecebedoresFiltro] = useState<string[]>([]);
  const [agrupadoresFiltro, setAgrupadoresFiltro] = useState<string[]>([]);
  const [statusFiltro, setStatusFiltro] = useState<ProcessoStatus[]>([]);
  const [origemFiltro, setOrigemFiltro] = useState<ProcessoOrigem[]>([]);
  const [urgenteFiltro, setUrgenteFiltro] = useState(false);
  const [prioridadeFiltro, setPrioridadeFiltro] = useState(false);
  const [atrasadoFiltro, setAtrasadoFiltro] = useState(false);
  const [devolvidoFiltro, setDevolvidoFiltro] = useState(false);

  // Sort + pagination
  const [sortKey, setSortKey] = useState<SortKey>('diaAtribuicao');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<PageSizeOption>(DEFAULT_PAGE_SIZE);
  const [selectedProcessoIds, setSelectedProcessoIds] = useState<Set<string>>(
    () => new Set()
  );
  const [bulkAction, setBulkAction] = useState<BulkAction | null>(null);
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [copiedNumero, setCopiedNumero] = useState<string | null>(null);
  const [duplicadosOpen, setDuplicadosOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteOneProcesso, setDeleteOneProcesso] = useState<Processo | null>(
    null
  );
  const [deleteOneBusy, setDeleteOneBusy] = useState(false);
  const [deleteLastDistributionDialogOpen, setDeleteLastDistributionDialogOpen] =
    useState(false);
  const [deleteLastDistributionBusy, setDeleteLastDistributionBusy] =
    useState(false);
  const [renewDialogProcesso, setRenewDialogProcesso] =
    useState<Processo | null>(null);
  const [renewBusy, setRenewBusy] = useState(false);
  const [historyDialogProcesso, setHistoryDialogProcesso] =
    useState<Processo | null>(null);
  const [statusDialogProcesso, setStatusDialogProcesso] =
    useState<Processo | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [urgentBusyId, setUrgentBusyId] = useState<string | null>(null);
  const [returnQueueProcesso, setReturnQueueProcesso] =
    useState<Processo | null>(null);
  const [returnQueueBusy, setReturnQueueBusy] = useState(false);
  const [quickCompleteProcesso, setQuickCompleteProcesso] =
    useState<Processo | null>(null);
  const [quickCompleteBusy, setQuickCompleteBusy] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  // Reference data
  const [users, setUsers] = useState<User[] | null>(null);
  const [agrupadores, setAgrupadores] = useState<Agrupador[] | null>(null);
  const [config, setConfig] = useState<ConfigSistema | null>(null);

  useEffect(() => {
    const unsubU = subscribeAllUsers((list) => setUsers(list));
    const unsubA = subscribeAgrupadores((list) => setAgrupadores(list));
    const unsubC = subscribeConfigSistema((c) => setConfig(c));
    return () => {
      unsubU();
      unsubA();
      unsubC();
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (historyProcessoIdParam && modo !== 'todos') {
      setModo('todos');
    }
  }, [historyProcessoIdParam, modo]);

  useEffect(() => {
    setSelectedProcessoIds(new Set());
  }, [
    busca,
    recebedoresFiltro,
    agrupadoresFiltro,
    statusFiltro,
    origemFiltro,
    urgenteFiltro,
    prioridadeFiltro,
    atrasadoFiltro,
    devolvidoFiltro,
    modo,
    customStart,
    customEnd,
  ]);

  // Processos: one-shot fetch for the selected period.
  const [processos, setProcessos] = useState<Processo[] | null>(null);
  const [fetchKey, setFetchKey] = useState(0);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Recarrega sob demanda: invalida a memoização da lista global "todos" (item
  // 3A) e dispara a busca. Usado pelo botão "Atualizar" e após cada mutação.
  const refresh = useCallback(() => {
    invalidateTodosCache();
    setFetchKey((k) => k + 1);
  }, []);

  useEffect(() => {
    setFetchError(null);
    let cancelled = false;

    if (modo === 'custom' && (!customStart || !customEnd)) {
      setProcessos([]);
      return;
    }
    if (modo === 'custom' && customStart > customEnd) {
      setProcessos([]);
      setFetchError('Data inicial não pode ser posterior à final.');
      return;
    }

    // Modo "todos": reaproveita a lista memoizada na sessão quando válida —
    // refiltros e remontagens custam zero leituras. `refresh()` força recarga.
    if (modo === 'todos') {
      const cached = getTodosCache();
      if (cached) {
        setProcessos(cached);
        return;
      }
    }

    setProcessos(null);
    (async () => {
      try {
        let list: Processo[];
        if (modo === 'todos') {
          list = await getAllProcessos();
          setTodosCache(list);
        } else {
          const periodo =
            modo === 'mes'
              ? mesAtualIso(now)
              : { start: customStart, end: addIsoDays(customEnd, 1) };
          list = await getProcessosByPeriodo(periodo.start, periodo.end);
        }
        if (!cancelled) setProcessos(list);
      } catch (err) {
        if (!cancelled) {
          setFetchError(
            err instanceof Error
              ? err.message
              : 'Falha ao carregar processos do período.'
          );
          setProcessos([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modo, customStart, customEnd, fetchKey, mesAtualKey]);

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [
    busca,
    recebedoresFiltro,
    agrupadoresFiltro,
    statusFiltro,
    origemFiltro,
    urgenteFiltro,
    prioridadeFiltro,
    atrasadoFiltro,
    devolvidoFiltro,
    sortKey,
    sortDir,
    modo,
    customStart,
    customEnd,
    pageSize,
  ]);

  const usersByUid = useMemo(() => {
    const m = new Map<string, User>();
    (users ?? []).forEach((u) => m.set(u.uid, u));
    return m;
  }, [users]);

  const recebedoresList = useMemo(
    () =>
      (users ?? []).filter(
        (u) => u.role === 'recebedor' || u.role === 'distribuidor'
      ),
    [users]
  );

  // Filter + sort
  const filtered = useMemo(() => {
    if (!processos) return [];
    const q = busca.trim().toLowerCase();
    const recSet = recebedoresFiltro.length
      ? new Set(recebedoresFiltro)
      : null;
    const agrSet = agrupadoresFiltro.length
      ? new Set(agrupadoresFiltro)
      : null;
    const statusSet = statusFiltro.length ? new Set(statusFiltro) : null;
    const origemSet = origemFiltro.length ? new Set(origemFiltro) : null;
    return processos.filter((p) => {
      if (
        q &&
        ![
          p.numero,
          p.observacao,
          p.tooltip,
          getSentenciadoNomeProcesso(p),
          p.dadosConclusao?.sentenciadoNome,
          p.dadosConclusao?.guiaExecucaoNumero,
        ].some((value) => (value ?? '').toLowerCase().includes(q))
      ) {
        return false;
      }
      if (recSet && (!p.recebedorUid || !recSet.has(p.recebedorUid)))
        return false;
      if (agrSet && !agrSet.has(p.agrupadorId)) return false;
      if (statusSet && !statusSet.has(p.status)) return false;
      if (origemSet && !origemSet.has(p.origem)) return false;
      if (urgenteFiltro && !p.urgente) return false;
      if (prioridadeFiltro && !p.prioridade) return false;
      if (atrasadoFiltro && !isAtrasado(p, now)) return false;
      if (devolvidoFiltro && p.devolvido !== true) return false;
      return true;
    });
  }, [
    processos,
    busca,
    recebedoresFiltro,
    agrupadoresFiltro,
    statusFiltro,
    origemFiltro,
    urgenteFiltro,
    prioridadeFiltro,
    atrasadoFiltro,
    devolvidoFiltro,
    now,
  ]);

  const listaEmEstadoPadrao = useMemo(
    () =>
      modo === 'mes' &&
      busca.trim() === '' &&
      recebedoresFiltro.length === 0 &&
      agrupadoresFiltro.length === 0 &&
      statusFiltro.length === 0 &&
      origemFiltro.length === 0 &&
      !urgenteFiltro &&
      !prioridadeFiltro &&
      !atrasadoFiltro &&
      !devolvidoFiltro &&
      sortKey === 'diaAtribuicao' &&
      sortDir === 'desc',
    [
      modo,
      busca,
      recebedoresFiltro,
      agrupadoresFiltro,
      statusFiltro,
      origemFiltro,
      urgenteFiltro,
      prioridadeFiltro,
      atrasadoFiltro,
      devolvidoFiltro,
      sortKey,
      sortDir,
    ]
  );

  const sorted = useMemo(() => {
    const out = filtered.slice();
    const dir = sortDir === 'asc' ? 1 : -1;
    const key = sortKey;
    out.sort((a, b) => {
      if (listaEmEstadoPadrao) {
        const urgenteCmp = compareUrgentesFirst(a, b);
        if (urgenteCmp !== 0) return urgenteCmp;
      }
      const cmp = compareForSort(a, b, key, usersByUid);
      return cmp === 0 ? a.numero.localeCompare(b.numero) : cmp * dir;
    });
    return out;
  }, [filtered, listaEmEstadoPadrao, sortKey, sortDir, usersByUid]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = useMemo(
    () => sorted.slice(safePage * pageSize, (safePage + 1) * pageSize),
    [sorted, safePage, pageSize]
  );
  const rangeStart = sorted.length === 0 ? 0 : safePage * pageSize + 1;
  const rangeEnd = Math.min((safePage + 1) * pageSize, sorted.length);
  const selectedProcessos = useMemo(
    () => sorted.filter((p) => selectedProcessoIds.has(p.id)),
    [selectedProcessoIds, sorted]
  );
  const selectedCount = selectedProcessos.length;
  const allPageSelected =
    pageItems.length > 0 && pageItems.every((p) => selectedProcessoIds.has(p.id));
  const selectedUrgenteTargets = selectedProcessos.filter((p) => !p.urgente);
  const selectedReturnQueueTargets = selectedProcessos.filter(
    (p) => p.status !== 'nao_atribuido'
  );
  const selectedQuickCompleteTargets = selectedProcessos.filter(
    (p) => p.status !== 'nao_atribuido' && p.status !== 'concluido'
  );
  const selectedStatusTargets = selectedProcessos.filter(
    (p) => p.status !== 'nao_atribuido'
  );

  useEffect(() => {
    if (!processos) {
      setSelectedProcessoIds(new Set());
      return;
    }
    const validIds = new Set(processos.map((p) => p.id));
    setSelectedProcessoIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (validIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [processos]);

  useEffect(() => {
    if (!historyProcessoIdParam || !processos) return;
    const processo = processos.find((p) => p.id === historyProcessoIdParam);
    if (!processo) return;
    if (
      openedHistoryUrlRef.current === historyProcessoIdParam &&
      historyDialogProcesso?.id === historyProcessoIdParam
    ) {
      return;
    }
    setHistoryDialogProcesso(processo);
    openedHistoryUrlRef.current = historyProcessoIdParam;
  }, [historyProcessoIdParam, processos, historyDialogProcesso?.id]);

  function closeHistoryDialog() {
    setHistoryDialogProcesso(null);
    openedHistoryUrlRef.current = null;
    if (!historyProcessoIdParam) return;
    const next = new URLSearchParams(searchParams);
    next.delete('historicoProcessoId');
    next.delete('processoId');
    setSearchParams(next, { replace: true });
  }

  function clearFilters() {
    setBusca('');
    setRecebedoresFiltro([]);
    setAgrupadoresFiltro([]);
    setStatusFiltro([]);
    setOrigemFiltro([]);
    setUrgenteFiltro(false);
    setPrioridadeFiltro(false);
    setAtrasadoFiltro(false);
    setDevolvidoFiltro(false);
  }

  function toggleProcessoSelection(id: string) {
    setSelectedProcessoIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function togglePageSelection() {
    setSelectedProcessoIds((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        pageItems.forEach((p) => next.delete(p.id));
      } else {
        pageItems.forEach((p) => next.add(p.id));
      }
      return next;
    });
  }

  function selectAllFiltered() {
    setSelectedProcessoIds(new Set(sorted.map((p) => p.id)));
  }

  function clearSelection() {
    setSelectedProcessoIds(new Set());
  }

  function getBulkTargets(action: BulkAction): Processo[] {
    if (action === 'urgente') return selectedUrgenteTargets;
    if (action === 'desatribuir') return selectedReturnQueueTargets;
    if (action === 'concluir') return selectedQuickCompleteTargets;
    return selectedProcessos;
  }

  function getBulkStatusTargets(novoStatus: ProcessoStatusEditavel): Processo[] {
    return selectedStatusTargets.filter((p) => p.status !== novoStatus);
  }

  async function handleBulkAction(action: BulkAction) {
    if (!firebaseUser?.uid) return;
    const targets = getBulkTargets(action);
    if (targets.length === 0) {
      setBulkAction(null);
      setToast({
        kind: 'error',
        message: 'Nenhum processo selecionado pode receber esta ação.',
      });
      return;
    }

    setBulkBusy(true);
    try {
      const meNome =
        userDoc?.displayName ?? firebaseUser.displayName ?? 'Usuário';

      if (action === 'remover') {
        await deleteProcessosByIds(
          targets.map((p) => p.id),
          firebaseUser.uid,
          meNome
        );
      } else if (action === 'urgente') {
        for (const processo of targets) {
          await marcarProcessoUrgente({
            processoId: processo.id,
            byUid: firebaseUser.uid,
            byNome: meNome,
          });
        }
      } else if (action === 'desatribuir') {
        for (const processo of targets) {
          const recebedorNomeAnterior = processo.recebedorUid
            ? usersByUid.get(processo.recebedorUid)?.displayName ?? null
            : null;
          await devolverProcessoParaFila({
            processoId: processo.id,
            recebedorNomeAnterior,
            byUid: firebaseUser.uid,
            byNome: meNome,
          });
        }
      } else if (action === 'concluir') {
        for (const processo of targets) {
          await updateProcessoStatus(
            processo.id,
            'concluido',
            firebaseUser.uid,
            meNome,
            null,
            {
              devolvido: false,
              dadosConclusao: null,
              permitirConclusaoSemDados: true,
            }
          );
        }
      }

      const targetIds = new Set(targets.map((p) => p.id));
      setSelectedProcessoIds((prev) => {
        const next = new Set(prev);
        targetIds.forEach((id) => next.delete(id));
        return next;
      });
      setBulkAction(null);
      refresh();
      setToast({
        kind: 'success',
        message: `${targets.length} processo${targets.length === 1 ? '' : 's'} atualizado${targets.length === 1 ? '' : 's'} em lote.`,
      });
    } catch (err) {
      setToast({
        kind: 'error',
        message:
          err instanceof Error ? err.message : 'Falha ao executar ação em lote.',
      });
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleBulkStatusChange(
    novoStatus: ProcessoStatusEditavel,
    observacao: string | null
  ) {
    if (!firebaseUser?.uid) return;
    const targets = getBulkStatusTargets(novoStatus);
    if (targets.length === 0) {
      setBulkStatusOpen(false);
      setToast({
        kind: 'error',
        message: 'Nenhum processo selecionado pode trocar para este status.',
      });
      return;
    }

    setBulkBusy(true);
    try {
      const meNome =
        userDoc?.displayName ?? firebaseUser.displayName ?? 'Usuário';
      const successIds = new Set<string>();
      let falhas = 0;
      let primeiraFalha: string | null = null;

      for (const processo of targets) {
        try {
          await updateProcessoStatus(
            processo.id,
            novoStatus,
            firebaseUser.uid,
            meNome,
            observacao,
            novoStatus === 'concluido'
              ? {
                  devolvido: false,
                  dadosConclusao: null,
                  permitirConclusaoSemDados: true,
                }
              : undefined
          );
          successIds.add(processo.id);
        } catch (err) {
          falhas += 1;
          if (!primeiraFalha) {
            primeiraFalha =
              err instanceof Error ? err.message : 'Falha ao trocar status.';
          }
        }
      }

      setSelectedProcessoIds((prev) => {
        const next = new Set(prev);
        successIds.forEach((id) => next.delete(id));
        return next;
      });
      setBulkStatusOpen(false);
      refresh();
      setToast({
        kind: falhas > 0 ? 'error' : 'success',
        message:
          falhas > 0
            ? `${successIds.size} processo${successIds.size === 1 ? '' : 's'} atualizado${successIds.size === 1 ? '' : 's'}; ${falhas} falharam. ${primeiraFalha}`
            : `${successIds.size} processo${successIds.size === 1 ? '' : 's'} alterado${successIds.size === 1 ? '' : 's'} para ${getStatusLabel(novoStatus)}.`,
      });
    } finally {
      setBulkBusy(false);
    }
  }

  function exportCsv() {
    const csv = buildCsv(sorted, usersByUid, now);
    // BOM + UTF-8 so Excel opens with correct accents.
    const blob = new Blob(['﻿' + csv], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `processos-${formatDateBr(now, 'yyyy-MM-dd')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function copyNumero(numero: string) {
    await navigator.clipboard.writeText(numero);
    setCopiedNumero(numero);
    window.setTimeout(() => {
      setCopiedNumero((cur) => (cur === numero ? null : cur));
    }, 1400);
  }

  async function handleDeleteAllLoaded() {
    if (!processos || processos.length === 0 || !firebaseUser?.uid) return;
    setDeleteBusy(true);
    try {
      const meNome =
        userDoc?.displayName ?? firebaseUser.displayName ?? 'Usuário';
      const distribuicaoIds = Array.from(
        new Set(
          processos
            .map((p) => p.distribuicaoId)
            .filter((id): id is string => Boolean(id))
        )
      );
      const relacionados =
        distribuicaoIds.length > 0
          ? await getProcessosByDistribuicaoIds(distribuicaoIds)
          : [];
      const ids = Array.from(
        new Set([...processos, ...relacionados].map((p) => p.id))
      );
      await deleteProcessosByIds(ids, firebaseUser.uid, meNome);
      setDeleteDialogOpen(false);
      refresh();
    } catch (err) {
      setFetchError(
        err instanceof Error ? err.message : 'Falha ao apagar processos.'
      );
    } finally {
      setDeleteBusy(false);
    }
  }

  async function handleDeleteOneProcesso(processo: Processo) {
    if (!firebaseUser?.uid) return;
    setDeleteOneBusy(true);
    try {
      const meNome =
        userDoc?.displayName ?? firebaseUser.displayName ?? 'Usuário';
      await deleteProcessosByIds([processo.id], firebaseUser.uid, meNome);
      setDeleteOneProcesso(null);
      refresh();
      setToast({
        kind: 'success',
        message: `Processo ${processo.numero} removido.`,
      });
    } catch (err) {
      setToast({
        kind: 'error',
        message:
          err instanceof Error ? err.message : 'Falha ao remover processo.',
      });
    } finally {
      setDeleteOneBusy(false);
    }
  }

  async function handleDeleteLastDistribution() {
    if (!firebaseUser?.uid) return;
    setDeleteLastDistributionBusy(true);
    try {
      const meNome =
        userDoc?.displayName ?? firebaseUser.displayName ?? 'Usuário';
      const result = await apagarUltimaDistribuicaoComProcessos(
        firebaseUser.uid,
        meNome
      );
      setDeleteLastDistributionDialogOpen(false);
      refresh();
      setToast({
        kind: 'success',
        message: `Distribuição ${result.distribuicao.fileName} apagada: ${result.totalProcessos} processo(s) removido(s).`,
      });
    } catch (err) {
      setToast({
        kind: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Falha ao apagar a última distribuição.',
      });
    } finally {
      setDeleteLastDistributionBusy(false);
    }
  }

  async function handleRenewPrazo(processo: Processo, prazoDiasUteis: number) {
    if (!firebaseUser?.uid || !config) return;
    setRenewBusy(true);
    try {
      const meNome =
        userDoc?.displayName ?? firebaseUser.displayName ?? 'Usuário';
      const result = await renovarPrazoProcesso({
        processoId: processo.id,
        prazoDiasUteis,
        feriadosIso: config.feriadosNacionais,
        byUid: firebaseUser.uid,
        byNome: meNome,
      });
      setRenewDialogProcesso(null);
      refresh();
      setToast({
        kind: 'success',
        message: `Prazo renovado para ${formatDateBr(result.prazoFinal)}.`,
      });
    } catch (err) {
      setToast({
        kind: 'error',
        message:
          err instanceof Error ? err.message : 'Falha ao renovar prazo.',
      });
    } finally {
      setRenewBusy(false);
    }
  }

  async function handleStatusChange(
    processo: Processo,
    novoStatus: ProcessoStatusEditavel,
    observacao: string | null,
    options?: {
      devolvido?: boolean;
      dadosConclusao?: DadosConclusaoProcesso | null;
    }
  ) {
    if (!firebaseUser?.uid) return;
    setStatusBusy(true);
    try {
      const meNome =
        userDoc?.displayName ?? firebaseUser.displayName ?? 'Usuário';
      await updateProcessoStatus(
        processo.id,
        novoStatus,
        firebaseUser.uid,
        meNome,
        observacao,
        options
      );
      setStatusDialogProcesso(null);
      refresh();
      setToast({
        kind: 'success',
        message: `Status de ${processo.numero} alterado para ${getStatusLabel(novoStatus)}.`,
      });
    } catch (err) {
      setToast({
        kind: 'error',
        message:
          err instanceof Error ? err.message : 'Falha ao alterar status.',
      });
    } finally {
      setStatusBusy(false);
    }
  }

  async function handleToggleUrgente(processo: Processo) {
    if (!firebaseUser?.uid) return;
    setUrgentBusyId(processo.id);
    try {
      const meNome =
        userDoc?.displayName ?? firebaseUser.displayName ?? 'Usuário';
      if (processo.urgente) {
        await desmarcarProcessoUrgente({
          processoId: processo.id,
          byUid: firebaseUser.uid,
          byNome: meNome,
        });
      } else {
        await marcarProcessoUrgente({
          processoId: processo.id,
          byUid: firebaseUser.uid,
          byNome: meNome,
        });
      }
      refresh();
      setToast({
        kind: 'success',
        message: processo.urgente
          ? `Urgência removida do processo ${processo.numero}.`
          : `Processo ${processo.numero} marcado como urgente.`,
      });
    } catch (err) {
      setToast({
        kind: 'error',
        message:
          err instanceof Error
            ? err.message
            : processo.urgente
              ? 'Falha ao remover urgência do processo.'
              : 'Falha ao marcar processo como urgente.',
      });
    } finally {
      setUrgentBusyId(null);
    }
  }

  async function handleReturnToQueue(processo: Processo) {
    if (!firebaseUser?.uid) return;
    setReturnQueueBusy(true);
    try {
      const meNome =
        userDoc?.displayName ?? firebaseUser.displayName ?? 'Usuário';
      const recebedorNomeAnterior = processo.recebedorUid
        ? usersByUid.get(processo.recebedorUid)?.displayName ?? null
        : null;
      await devolverProcessoParaFila({
        processoId: processo.id,
        recebedorNomeAnterior,
        byUid: firebaseUser.uid,
        byNome: meNome,
      });
      setReturnQueueProcesso(null);
      refresh();
      setToast({
        kind: 'success',
        message: `Processo ${processo.numero} voltou para a fila.`,
      });
    } catch (err) {
      setToast({
        kind: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Falha ao devolver processo para a fila.',
      });
    } finally {
      setReturnQueueBusy(false);
    }
  }

  async function handleQuickComplete(processo: Processo) {
    if (!firebaseUser?.uid) return;
    setQuickCompleteBusy(true);
    try {
      const meNome =
        userDoc?.displayName ?? firebaseUser.displayName ?? 'Usuário';
      await updateProcessoStatus(
        processo.id,
        'concluido',
        firebaseUser.uid,
        meNome,
        null,
        {
          devolvido: false,
          dadosConclusao: null,
          permitirConclusaoSemDados: true,
        }
      );
      setQuickCompleteProcesso(null);
      refresh();
      setToast({
        kind: 'success',
        message: `Processo ${processo.numero} concluído sem dados de conclusão.`,
      });
    } catch (err) {
      setToast({
        kind: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Falha ao concluir processo sem dados.',
      });
    } finally {
      setQuickCompleteBusy(false);
    }
  }

  function toggleSort(k: SortKey) {
    if (sortKey === k) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(k);
      setSortDir(k === 'diaAtribuicao' || k === 'prazoFinal' ? 'desc' : 'asc');
    }
  }

  const isLoading =
    processos === null || users === null || agrupadores === null || config === null;
  const periodoLabel = buildPeriodoLabel(modo, now, customStart, customEnd);
  const deleteAllLabel =
    modo === 'todos' ? 'Apagar todos carregados' : 'Apagar todos do período';

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink-primary">Processos</h1>
          <p className="text-sm text-ink-secondary">
            Visualize, filtre e exporte processos por data de atribuição. {periodoLabel}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-surface px-3 py-1.5 text-sm font-semibold text-ink-primary">
            <Filter className="h-4 w-4 text-brand-primary" />
            {isLoading ? (
              'Carregando lista'
            ) : (
              <>
                {sorted.length} processo{sorted.length === 1 ? '' : 's'} na lista
                {(processos?.length ?? 0) !== sorted.length && (
                  <span className="font-medium text-ink-secondary">
                    de {processos?.length ?? 0}
                  </span>
                )}
              </>
            )}
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={isLoading}
            className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-surface px-3 py-1.5 text-sm font-medium text-ink-primary transition-colors hover:bg-gray-50 disabled:opacity-60"
          >
            <RefreshCw className="h-4 w-4" />
            Atualizar
          </button>
          <button
            type="button"
            onClick={() => setDuplicadosOpen(true)}
            className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-surface px-3 py-1.5 text-sm font-medium text-ink-primary transition-colors hover:bg-gray-50 disabled:opacity-60"
          >
            <Users className="h-4 w-4" />
            Nomes repetidos
          </button>
          <button
            type="button"
            onClick={exportCsv}
            disabled={isLoading || sorted.length === 0}
            className="inline-flex items-center gap-1 rounded-md bg-brand-primary px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-primary-dark disabled:opacity-60"
          >
            <Download className="h-4 w-4" />
            Exportar CSV
          </button>
          <button
            type="button"
            onClick={() => setDeleteDialogOpen(true)}
            disabled={isLoading || (processos?.length ?? 0) === 0}
            className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-sm font-semibold text-rose-700 transition-colors hover:bg-rose-100 disabled:opacity-60"
          >
            <Trash2 className="h-4 w-4" />
            {deleteAllLabel}
          </button>
          <button
            type="button"
            onClick={() => setDeleteLastDistributionDialogOpen(true)}
            disabled={isLoading || deleteLastDistributionBusy}
            className="inline-flex items-center gap-1 rounded-md border border-rose-300 bg-rose-700 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-rose-800 disabled:opacity-60"
          >
            <Trash2 className="h-4 w-4" />
            Apagar última distribuição
          </button>
        </div>
      </header>

      <Toast toast={toast} onDismiss={() => setToast(null)} />

      {/* Filters */}
      <section className="space-y-3 rounded-lg border border-gray-200 bg-surface p-4">
        <div className="flex flex-wrap items-end gap-3">
          {/* Search */}
          <Field
            label="Buscar por número, sentenciado ou guia"
            className="flex-1 min-w-[220px]"
            labelClassName="text-xs font-normal text-ink-secondary"
          >
            {(fieldProps) => (
              <div className="flex items-center rounded-md border border-gray-300 px-2 py-1 focus-within:border-brand-primary">
                <Search
                  className="h-4 w-4 text-ink-secondary"
                  aria-hidden="true"
                />
                <input
                  {...fieldProps}
                  type="text"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Número, sentenciado ou nº da guia"
                  className="ml-2 w-full bg-transparent text-sm text-ink-primary outline-none placeholder:text-ink-secondary/70"
                />
              </div>
            )}
          </Field>

          {/* Period */}
          <fieldset className="flex flex-wrap items-center gap-3">
            <legend className="sr-only">Período</legend>
            <RadioOption
              id="proc-periodo-mes"
              name="proc-periodo"
              checked={modo === 'mes'}
              onChange={() => setModo('mes')}
              label="Mês atual"
            />
            <RadioOption
              id="proc-periodo-todos"
              name="proc-periodo"
              checked={modo === 'todos'}
              onChange={() => setModo('todos')}
              label="Todos"
            />
            <RadioOption
              id="proc-periodo-custom"
              name="proc-periodo"
              checked={modo === 'custom'}
              onChange={() => setModo('custom')}
              label="Personalizado"
            />
          </fieldset>

          {modo === 'custom' && (
            <div className="flex flex-wrap items-end gap-2">
              <Field
                label="De"
                labelClassName="text-xs font-normal text-ink-secondary"
              >
                {(fieldProps) => (
                  <input
                    {...fieldProps}
                    type="date"
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
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
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    className="rounded-md border border-gray-300 px-2 py-1 text-sm text-ink-primary"
                  />
                )}
              </Field>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Recebedor multi-select */}
          <MultiSelect
            label="Recebedor"
            options={recebedoresList.map((u) => ({
              value: u.uid,
              label: u.displayName,
            }))}
            selected={recebedoresFiltro}
            onChange={setRecebedoresFiltro}
            emptyText="Todos"
          />

          {/* Origem multi-select */}
          <MultiSelect
            label="Origem"
            options={(agrupadores ?? []).map((a) => ({
              value: a.id,
              label: a.nome,
            }))}
            selected={agrupadoresFiltro}
            onChange={setAgrupadoresFiltro}
            emptyText="Todos"
          />

          {/* Status chips */}
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-xs text-ink-secondary">Status:</span>
            {STATUS_OPTIONS.map((s) => {
              const active = statusFiltro.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() =>
                    setStatusFiltro((prev) =>
                      active ? prev.filter((x) => x !== s) : [...prev, s]
                    )
                  }
                  aria-pressed={active}
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                    active
                      ? 'border-brand-primary bg-brand-primary text-white'
                      : 'border-gray-200 bg-surface text-ink-primary hover:bg-gray-50'
                  }`}
                >
                  {getStatusLabel(s)}
                </button>
              );
            })}
          </div>

          {/* Origem chips */}
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-xs text-ink-secondary">Origem:</span>
            {ORIGEM_OPTIONS.map((o) => {
              const active = origemFiltro.includes(o);
              return (
                <button
                  key={o}
                  type="button"
                  onClick={() =>
                    setOrigemFiltro((prev) =>
                      active ? prev.filter((x) => x !== o) : [...prev, o]
                    )
                  }
                  aria-pressed={active}
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                    active
                      ? 'border-brand-primary bg-brand-primary text-white'
                      : 'border-gray-200 bg-surface text-ink-primary hover:bg-gray-50'
                  }`}
                >
                  {ORIGEM_LABEL[o]}
                </button>
              );
            })}
          </div>

          {/* Toggles */}
          <ToggleChip
            checked={urgenteFiltro}
            onChange={setUrgenteFiltro}
            icon={<Flame className="h-3 w-3" />}
            label="Urgentes"
          />
          <ToggleChip
            checked={prioridadeFiltro}
            onChange={setPrioridadeFiltro}
            icon={<Star className="h-3 w-3" />}
            label="Prioridades"
          />
          <ToggleChip
            checked={atrasadoFiltro}
            onChange={setAtrasadoFiltro}
            icon={<AlertTriangle className="h-3 w-3" />}
            label="Atrasados"
          />
          <ToggleChip
            checked={devolvidoFiltro}
            onChange={setDevolvidoFiltro}
            icon={<RefreshCw className="h-3 w-3" />}
            label="Devolvidos"
          />

          <div className="ml-auto">
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-surface px-2.5 py-1 text-xs font-medium text-ink-primary transition-colors hover:bg-gray-50"
            >
              <Eraser className="h-3.5 w-3.5" />
              Limpar filtros
            </button>
          </div>
        </div>
      </section>

      {/* Body */}
      {fetchError && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{fetchError}</span>
        </div>
      )}

      {isLoading ? (
        <LoadingCard />
      ) : sorted.length === 0 ? (
        <EmptyCard hasProcessos={(processos ?? []).length > 0} />
      ) : (
        <>
          <BulkActionsBar
            selectedCount={selectedCount}
            totalFiltered={sorted.length}
            pageCount={pageItems.length}
            allPageSelected={allPageSelected}
            canMarkUrgente={selectedUrgenteTargets.length > 0}
            canReturnToQueue={selectedReturnQueueTargets.length > 0}
            canQuickComplete={selectedQuickCompleteTargets.length > 0}
            canChangeStatus={selectedStatusTargets.length > 0}
            busy={bulkBusy}
            onTogglePage={togglePageSelection}
            onSelectAllFiltered={selectAllFiltered}
            onClear={clearSelection}
            onOpenStatus={() => setBulkStatusOpen(true)}
            onAction={setBulkAction}
          />

          <PaginationControls
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            totalFiltered={sorted.length}
            totalLoaded={processos?.length ?? sorted.length}
            safePage={safePage}
            totalPages={totalPages}
            pageSize={pageSize}
            onPageSizeChange={setPageSize}
            onPrevious={() => setPage((p) => Math.max(0, p - 1))}
            onNext={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
          />

          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-surface">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left text-xs uppercase tracking-wide text-ink-secondary">
                  <th scope="col" className="w-10 px-3 py-2 font-medium">
                    <input
                      type="checkbox"
                      checked={allPageSelected}
                      onChange={togglePageSelection}
                      aria-label={
                        allPageSelected
                          ? 'Desmarcar processos da página'
                          : 'Selecionar processos da página'
                      }
                      className="h-4 w-4 rounded border-gray-300 accent-brand-primary"
                    />
                  </th>
                  <th
                    scope="col"
                    className="w-12 px-3 py-2 text-right font-medium tabular-nums"
                    title="Contador"
                  >
                    #
                  </th>
                  <SortableTh
                    label="Número"
                    sortKey="numero"
                    activeKey={sortKey}
                    dir={sortDir}
                    onClick={toggleSort}
                  />
                  <SortableTh
                    label="Origem"
                    sortKey="agrupador"
                    activeKey={sortKey}
                    dir={sortDir}
                    onClick={toggleSort}
                  />
                  <th
                    scope="col"
                    className="hidden px-3 py-2 font-medium lg:table-cell"
                  >
                    Regime
                  </th>
                  <SortableTh
                    label="Recebedor"
                    sortKey="recebedor"
                    activeKey={sortKey}
                    dir={sortDir}
                    onClick={toggleSort}
                  />
                  <SortableTh
                    label="Dia"
                    sortKey="diaSemana"
                    activeKey={sortKey}
                    dir={sortDir}
                    onClick={toggleSort}
                    className="hidden md:table-cell"
                  />
                  <SortableTh
                    label="Atribuído em"
                    sortKey="diaAtribuicao"
                    activeKey={sortKey}
                    dir={sortDir}
                    onClick={toggleSort}
                    className="hidden lg:table-cell"
                  />
                  <SortableTh
                    label="Prazo"
                    sortKey="prazoFinal"
                    activeKey={sortKey}
                    dir={sortDir}
                    onClick={toggleSort}
                    className="hidden lg:table-cell"
                  />
                  <SortableTh
                    label="Status"
                    sortKey="status"
                    activeKey={sortKey}
                    dir={sortDir}
                    onClick={toggleSort}
                  />
                  <th
                    scope="col"
                    className="hidden px-3 py-2 font-medium xl:table-cell"
                  >
                    Iniciado em
                  </th>
                  <th
                    scope="col"
                    className="hidden px-3 py-2 font-medium xl:table-cell"
                  >
                    Concluído em
                  </th>
                  <th
                    scope="col"
                    className="hidden px-3 py-2 font-medium 2xl:table-cell"
                  >
                    1ª entrada NURGE
                  </th>
                  <th
                    scope="col"
                    className="hidden px-3 py-2 font-medium 2xl:table-cell"
                  >
                    Devolvido origem
                  </th>
                  <th
                    scope="col"
                    className="hidden px-3 py-2 font-medium 2xl:table-cell"
                  >
                    Voltou NURGE
                  </th>
                  <th
                    scope="col"
                    className="hidden px-3 py-2 font-medium 2xl:table-cell"
                  >
                    Chegou para
                  </th>
                  <th
                    scope="col"
                    className="hidden px-3 py-2 text-center font-medium md:table-cell"
                    title="Urgente"
                  >
                    <Flame className="mx-auto h-3.5 w-3.5" />
                  </th>
                  <th
                    scope="col"
                    className="hidden px-3 py-2 text-center font-medium md:table-cell"
                    title="Prioridade"
                  >
                    <Star className="mx-auto h-3.5 w-3.5" />
                  </th>
                  <th
                    scope="col"
                    className="hidden px-3 py-2 text-center font-medium md:table-cell"
                    title="Atrasado"
                  >
                    <AlertTriangle className="mx-auto h-3.5 w-3.5" />
                  </th>
                  <SortableTh
                    label="Origem"
                    sortKey="origem"
                    activeKey={sortKey}
                    dir={sortDir}
                    onClick={toggleSort}
                    className="hidden xl:table-cell"
                  />
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pageItems.map((p, index) => {
                  const recebedor = p.recebedorUid
                    ? usersByUid.get(p.recebedorUid) ?? null
                    : null;
                  const atrasado = isAtrasado(p, now);
                  const selected = selectedProcessoIds.has(p.id);
                  const rowClass = selected
                    ? 'bg-brand-primary-light/60'
                    : p.urgente || p.prioridade
                      ? 'bg-red-50/60'
                      : atrasado
                        ? 'bg-amber-50/60'
                        : '';
                  return (
                    <tr key={p.id} className={rowClass}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleProcessoSelection(p.id)}
                          aria-label={`Selecionar processo ${p.numero}`}
                          className="h-4 w-4 rounded border-gray-300 accent-brand-primary"
                        />
                      </td>
                      <td className="px-3 py-2 text-right text-xs text-ink-secondary tabular-nums">
                        {safePage * pageSize + index + 1}
                      </td>
                      <td className="px-3 py-2 text-xs text-ink-primary">
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
                      <td className="px-3 py-2 text-ink-primary">
                        <span className="line-clamp-1">{p.agrupadorNome}</span>
                      </td>
                      <td className="hidden px-3 py-2 lg:table-cell">
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-ink-primary">
                          {REGIME_LABEL[p.regime]}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-ink-primary">
                        {recebedor ? (
                          <div className="flex items-center gap-2">
                            <UserAvatar
                              displayName={recebedor.displayName}
                              photoURL={recebedor.photoURL}
                              size="sm"
                            />
                            <span className="line-clamp-1">
                              {recebedor.displayName}
                            </span>
                          </div>
                        ) : (
                          <span className="text-ink-secondary">—</span>
                        )}
                      </td>
                      <td className="hidden whitespace-nowrap px-3 py-2 text-ink-secondary md:table-cell">
                        {DIA_SEMANA_LABEL[p.diaSemana]}
                      </td>
                      <td className="hidden whitespace-nowrap px-3 py-2 text-ink-secondary lg:table-cell">
                        {formatDateBr(p.diaAtribuicao.toDate())}
                      </td>
                      <td className="hidden whitespace-nowrap px-3 py-2 text-ink-secondary lg:table-cell">
                        {formatDateBr(p.prazoFinal.toDate())}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${getStatusBadgeClass(p.status)}`}
                        >
                          {getStatusLabel(p.status)}
                        </span>
                      </td>
                      <td className="hidden whitespace-nowrap px-3 py-2 text-xs text-ink-secondary xl:table-cell">
                        {p.iniciadoEm
                          ? formatDateBr(p.iniciadoEm.toDate(), 'dd/MM/yyyy HH:mm:ss')
                          : '—'}
                      </td>
                      <td className="hidden whitespace-nowrap px-3 py-2 text-xs text-ink-secondary xl:table-cell">
                        {p.concluidoEm
                          ? formatDateBr(p.concluidoEm.toDate(), 'dd/MM/yyyy HH:mm:ss')
                          : '—'}
                      </td>
                      <td className="hidden whitespace-nowrap px-3 py-2 text-xs text-ink-secondary 2xl:table-cell">
                        {p.primeiraEntradaNurgeEm
                          ? formatDateBr(p.primeiraEntradaNurgeEm.toDate(), 'dd/MM/yyyy HH:mm')
                          : '—'}
                      </td>
                      <td className="hidden whitespace-nowrap px-3 py-2 text-xs text-ink-secondary 2xl:table-cell">
                        {p.primeiraDevolucaoOrigemEm
                          ? formatDateBr(p.primeiraDevolucaoOrigemEm.toDate(), 'dd/MM/yyyy HH:mm')
                          : '—'}
                      </td>
                      <td className="hidden whitespace-nowrap px-3 py-2 text-xs text-ink-secondary 2xl:table-cell">
                        {p.ultimoRetornoNurgeEm
                          ? formatDateBr(p.ultimoRetornoNurgeEm.toDate(), 'dd/MM/yyyy HH:mm')
                          : '—'}
                      </td>
                      <td className="hidden max-w-[180px] truncate px-3 py-2 text-xs text-ink-secondary 2xl:table-cell">
                        {p.primeiroResponsavelNurge?.nome ??
                          p.primeiroResponsavelNurge?.login ??
                          '—'}
                      </td>
                      <td className="hidden px-3 py-2 text-center md:table-cell">
                        {p.urgente ? (
                          <Flame
                            className="mx-auto h-4 w-4 text-rose-600"
                            aria-label="Urgente"
                          />
                        ) : (
                          <span className="text-ink-secondary">—</span>
                        )}
                      </td>
                      <td className="hidden px-3 py-2 text-center md:table-cell">
                        {p.prioridade ? (
                          <Star
                            className="mx-auto h-4 w-4 text-rose-600"
                            aria-label="Prioridade"
                          />
                        ) : (
                          <span className="text-ink-secondary">—</span>
                        )}
                      </td>
                      <td className="hidden px-3 py-2 text-center md:table-cell">
                        {atrasado ? (
                          <AlertTriangle
                            className="mx-auto h-4 w-4 text-amber-600"
                            aria-label="Atrasado"
                          />
                        ) : (
                          <span className="text-ink-secondary">—</span>
                        )}
                      </td>
                      <td className="hidden px-3 py-2 xl:table-cell">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            p.origem === 'sei_json'
                              ? 'bg-sky-50 text-sky-700 ring-1 ring-sky-200'
                              : p.origem === 'csv'
                              ? 'bg-slate-100 text-slate-700 ring-1 ring-slate-200'
                              : 'bg-violet-50 text-violet-700 ring-1 ring-violet-200'
                          }`}
                        >
                          {ORIGEM_LABEL[p.origem]}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setHistoryDialogProcesso(p)}
                            className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-surface px-2 py-1 text-xs font-semibold text-ink-primary hover:bg-gray-50"
                          >
                            <HistoryIcon className="h-3.5 w-3.5" />
                            Histórico
                          </button>
                          <button
                            type="button"
                            onClick={() => setStatusDialogProcesso(p)}
                            disabled={p.status === 'nao_atribuido' || statusBusy}
                            className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-surface px-2 py-1 text-xs font-semibold text-ink-primary hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                            title={
                              p.status === 'nao_atribuido'
                                ? 'Atribua o processo antes de trocar o status'
                                : 'Trocar status'
                            }
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                            Status
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleToggleUrgente(p)}
                            disabled={urgentBusyId === p.id}
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
                              p.urgente
                                ? 'border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200'
                                : 'border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                            }`}
                            title={
                              p.urgente
                                ? 'Remover urgência do processo'
                                : 'Marcar processo como urgente'
                            }
                          >
                            {urgentBusyId === p.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              p.urgente ? (
                                <Eraser className="h-3.5 w-3.5" />
                              ) : (
                                <Flame className="h-3.5 w-3.5" />
                              )
                            )}
                            {p.urgente ? 'Remover urgência' : 'Urgente'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setReturnQueueProcesso(p)}
                            disabled={
                              p.status === 'nao_atribuido' || returnQueueBusy
                            }
                            className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                            title={
                              p.status === 'nao_atribuido'
                                ? 'Processo já está na fila'
                                : 'Desatribuir e voltar para a fila'
                            }
                          >
                            <UserMinus className="h-3.5 w-3.5" />
                            Desatribuir
                          </button>
                          <button
                            type="button"
                            onClick={() => setQuickCompleteProcesso(p)}
                            disabled={
                              p.status === 'nao_atribuido' ||
                              p.status === 'concluido' ||
                              quickCompleteBusy
                            }
                            className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                            title={
                              p.status === 'nao_atribuido'
                                ? 'Atribua o processo antes de concluir'
                                : p.status === 'concluido'
                                  ? 'Processo já concluído'
                                  : 'Concluir sem preencher dados'
                            }
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Concluir
                          </button>
                          <button
                            type="button"
                            onClick={() => setRenewDialogProcesso(p)}
                            disabled={renewBusy}
                            className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-surface px-2 py-1 text-xs font-semibold text-ink-primary hover:bg-gray-50 disabled:opacity-60"
                          >
                            <CalendarClock className="h-3.5 w-3.5" />
                            Renovar
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteOneProcesso(p)}
                            disabled={deleteOneBusy}
                            className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                            title="Remover processo"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Remover
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <PaginationControls
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            totalFiltered={sorted.length}
            totalLoaded={processos?.length ?? sorted.length}
            safePage={safePage}
            totalPages={totalPages}
            pageSize={pageSize}
            onPageSizeChange={setPageSize}
            onPrevious={() => setPage((p) => Math.max(0, p - 1))}
            onNext={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
          />
        </>
      )}

      {bulkAction && (
        <BulkActionDialog
          action={bulkAction}
          selectedCount={selectedCount}
          targetCount={getBulkTargets(bulkAction).length}
          busy={bulkBusy}
          onCancel={() => {
            if (!bulkBusy) setBulkAction(null);
          }}
          onConfirm={() => {
            void handleBulkAction(bulkAction);
          }}
        />
      )}

      {bulkStatusOpen && (
        <BulkStatusDialog
          processos={selectedProcessos}
          busy={bulkBusy}
          onCancel={() => {
            if (!bulkBusy) setBulkStatusOpen(false);
          }}
          onConfirm={(novoStatus, observacao) => {
            void handleBulkStatusChange(novoStatus, observacao);
          }}
        />
      )}

      {duplicadosOpen && (
        <SentenciadosDuplicadosDialog
          usersByUid={usersByUid}
          onClose={() => setDuplicadosOpen(false)}
        />
      )}

      {deleteDialogOpen && (
        <DeleteAllDialog
          count={processos?.length ?? 0}
          periodoLabel={periodoLabel}
          busy={deleteBusy}
          onCancel={() => {
            if (!deleteBusy) setDeleteDialogOpen(false);
          }}
          onConfirm={handleDeleteAllLoaded}
        />
      )}

      {deleteLastDistributionDialogOpen && (
        <DeleteLastDistributionDialog
          busy={deleteLastDistributionBusy}
          onCancel={() => {
            if (!deleteLastDistributionBusy) {
              setDeleteLastDistributionDialogOpen(false);
            }
          }}
          onConfirm={handleDeleteLastDistribution}
        />
      )}

      {deleteOneProcesso && (
        <DeleteOneDialog
          processo={deleteOneProcesso}
          busy={deleteOneBusy}
          onCancel={() => {
            if (!deleteOneBusy) setDeleteOneProcesso(null);
          }}
          onConfirm={() => {
            void handleDeleteOneProcesso(deleteOneProcesso);
          }}
        />
      )}

      {historyDialogProcesso && (
        <ProcessHistoryDialog
          processo={historyDialogProcesso}
          usersByUid={usersByUid}
          onClose={closeHistoryDialog}
        />
      )}

      {statusDialogProcesso && (
        <StatusChangeDialog
          processo={statusDialogProcesso}
          busy={statusBusy}
          onCancel={() => {
            if (!statusBusy) setStatusDialogProcesso(null);
          }}
          onConfirm={(novoStatus, observacao, options) => {
            void handleStatusChange(
              statusDialogProcesso,
              novoStatus,
              observacao,
              options
            );
          }}
        />
      )}

      {returnQueueProcesso && (
        <ReturnToQueueDialog
          processo={returnQueueProcesso}
          recebedor={
            returnQueueProcesso.recebedorUid
              ? usersByUid.get(returnQueueProcesso.recebedorUid) ?? null
              : null
          }
          busy={returnQueueBusy}
          onCancel={() => {
            if (!returnQueueBusy) setReturnQueueProcesso(null);
          }}
          onConfirm={() => {
            void handleReturnToQueue(returnQueueProcesso);
          }}
        />
      )}

      {quickCompleteProcesso && (
        <QuickCompleteDialog
          processo={quickCompleteProcesso}
          recebedor={
            quickCompleteProcesso.recebedorUid
              ? usersByUid.get(quickCompleteProcesso.recebedorUid) ?? null
              : null
          }
          busy={quickCompleteBusy}
          onCancel={() => {
            if (!quickCompleteBusy) setQuickCompleteProcesso(null);
          }}
          onConfirm={() => {
            void handleQuickComplete(quickCompleteProcesso);
          }}
        />
      )}

      {renewDialogProcesso && config && (
        <RenewPrazoDialog
          processo={renewDialogProcesso}
          feriadosIso={config.feriadosNacionais}
          prazoPadraoDiasUteis={config.prazoPadraoDiasUteis}
          busy={renewBusy}
          onCancel={() => {
            if (!renewBusy) setRenewDialogProcesso(null);
          }}
          onConfirm={(dias) => {
            void handleRenewPrazo(renewDialogProcesso, dias);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

interface RadioOptionProps {
  id: string;
  name: string;
  checked: boolean;
  onChange: () => void;
  label: string;
  hint?: string;
}

function RadioOption(props: RadioOptionProps) {
  return (
    <label
      htmlFor={props.id}
      className={`inline-flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1 text-sm transition-colors ${
        props.checked
          ? 'border-brand-primary bg-brand-primary/5 text-brand-primary'
          : 'border-gray-200 bg-surface text-ink-primary hover:bg-gray-50'
      }`}
    >
      <input
        type="radio"
        id={props.id}
        name={props.name}
        checked={props.checked}
        onChange={props.onChange}
        className="accent-brand-primary"
      />
      <span>{props.label}</span>
      {props.hint && (
        <span className="text-xs text-ink-secondary">({props.hint})</span>
      )}
    </label>
  );
}

interface ToggleChipProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  icon: React.ReactNode;
  label: string;
}

function ToggleChip({ checked, onChange, icon, label }: ToggleChipProps) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
        checked
          ? 'border-brand-primary bg-brand-primary text-white'
          : 'border-gray-200 bg-surface text-ink-primary hover:bg-gray-50'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

interface PaginationControlsProps {
  rangeStart: number;
  rangeEnd: number;
  totalFiltered: number;
  totalLoaded: number;
  safePage: number;
  totalPages: number;
  pageSize: PageSizeOption;
  onPageSizeChange: (value: PageSizeOption) => void;
  onPrevious: () => void;
  onNext: () => void;
}

function PaginationControls({
  rangeStart,
  rangeEnd,
  totalFiltered,
  totalLoaded,
  safePage,
  totalPages,
  pageSize,
  onPageSizeChange,
  onPrevious,
  onNext,
}: PaginationControlsProps) {
  return (
    <nav
      role="navigation"
      aria-label="Paginação"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-surface px-3 py-2 text-sm text-ink-secondary"
    >
      <div className="tabular-nums">
        Mostrando{' '}
        <span className="font-medium text-ink-primary">{rangeStart}</span>
        {'–'}
        <span className="font-medium text-ink-primary">{rangeEnd}</span> de{' '}
        <span className="font-medium text-ink-primary">{totalFiltered}</span>{' '}
        processos
        {totalLoaded !== totalFiltered && <> (filtrado de {totalLoaded})</>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-xs text-ink-secondary">
          Por página
          <select
            value={pageSize}
            onChange={(e) =>
              onPageSizeChange(Number(e.target.value) as PageSizeOption)
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
          onClick={onPrevious}
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
          onClick={onNext}
          disabled={safePage >= totalPages - 1}
          className="inline-flex min-h-[44px] items-center gap-1 rounded-md border border-gray-300 bg-surface px-3 py-1.5 text-sm font-medium text-ink-primary transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Próxima página"
        >
          Próxima
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </nav>
  );
}

interface BulkActionsBarProps {
  selectedCount: number;
  totalFiltered: number;
  pageCount: number;
  allPageSelected: boolean;
  canMarkUrgente: boolean;
  canReturnToQueue: boolean;
  canQuickComplete: boolean;
  canChangeStatus: boolean;
  busy: boolean;
  onTogglePage: () => void;
  onSelectAllFiltered: () => void;
  onClear: () => void;
  onOpenStatus: () => void;
  onAction: (action: BulkAction) => void;
}

function BulkActionsBar({
  selectedCount,
  totalFiltered,
  pageCount,
  allPageSelected,
  canMarkUrgente,
  canReturnToQueue,
  canQuickComplete,
  canChangeStatus,
  busy,
  onTogglePage,
  onSelectAllFiltered,
  onClear,
  onOpenStatus,
  onAction,
}: BulkActionsBarProps) {
  return (
    <section className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-surface px-3 py-3 text-sm">
      <div className="mr-auto flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-2 rounded-full bg-surface-elevated px-2.5 py-1 text-xs font-semibold text-ink-primary ring-1 ring-gray-200">
          <Check className="h-3.5 w-3.5 text-brand-primary" />
          {selectedCount} selecionado{selectedCount === 1 ? '' : 's'}
        </span>
        <button
          type="button"
          onClick={onTogglePage}
          disabled={busy || pageCount === 0}
          className="rounded-md border border-gray-300 bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink-primary hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {allPageSelected ? 'Desmarcar página' : 'Selecionar página'}
        </button>
        <button
          type="button"
          onClick={onSelectAllFiltered}
          disabled={busy || totalFiltered === 0 || selectedCount === totalFiltered}
          className="rounded-md border border-gray-300 bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink-primary hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Selecionar filtrados
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={busy || selectedCount === 0}
          className="rounded-md border border-gray-300 bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink-primary hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Limpar seleção
        </button>
      </div>

      <button
        type="button"
        onClick={onOpenStatus}
        disabled={busy || !canChangeStatus}
        className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink-primary hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Trocar status
      </button>
      <button
        type="button"
        onClick={() => onAction('urgente')}
        disabled={busy || !canMarkUrgente}
        className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Flame className="h-3.5 w-3.5" />
        Marcar urgente
      </button>
      <button
        type="button"
        onClick={() => onAction('desatribuir')}
        disabled={busy || !canReturnToQueue}
        className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <UserMinus className="h-3.5 w-3.5" />
        Desatribuir
      </button>
      <button
        type="button"
        onClick={() => onAction('concluir')}
        disabled={busy || !canQuickComplete}
        className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
        Concluir sem dados
      </button>
      <button
        type="button"
        onClick={() => onAction('remover')}
        disabled={busy || selectedCount === 0}
        className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-700 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Remover
      </button>
    </section>
  );
}

interface BulkStatusDialogProps {
  processos: Processo[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (
    novoStatus: ProcessoStatusEditavel,
    observacao: string | null
  ) => void;
}

function BulkStatusDialog({
  processos,
  busy,
  onCancel,
  onConfirm,
}: BulkStatusDialogProps) {
  const [novoStatus, setNovoStatus] =
    useState<ProcessoStatusEditavel>('pendente');
  const [observacao, setObservacao] = useState('');
  const eligible = processos.filter((p) => p.status !== 'nao_atribuido');
  const targets = eligible.filter((p) => p.status !== novoStatus);
  const ignoredCount = Math.max(0, processos.length - targets.length);
  const observacaoLimpa = observacao.trim();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-status-title"
    >
      <div
        className="absolute inset-0 bg-black/50"
        aria-hidden="true"
        onClick={() => {
          if (!busy) onCancel();
        }}
      />
      <div className="relative w-full max-w-lg rounded-lg bg-surface shadow-xl">
        <div className="px-5 py-4">
          <h2
            id="bulk-status-title"
            className="text-lg font-semibold text-ink-primary"
          >
            Trocar status em lote
          </h2>
          <p className="mt-2 text-sm text-ink-secondary">
            Escolha o novo status para os processos selecionados. Processos não
            atribuídos ou que já estão no status escolhido serão ignorados.
          </p>

          <div className="mt-4 grid gap-2">
            {STATUS_CHANGE_OPTIONS.map((status) => {
              const checked = novoStatus === status;
              return (
                <label
                  key={status}
                  className={`flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm transition-colors ${
                    checked
                      ? 'border-brand-primary bg-brand-primary/5'
                      : 'border-gray-200 bg-surface-elevated hover:bg-gray-50'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="bulk-novo-status"
                      checked={checked}
                      disabled={busy}
                      onChange={() => setNovoStatus(status)}
                      className="accent-brand-primary"
                    />
                    <span className="font-medium text-ink-primary">
                      {getStatusLabel(status)}
                    </span>
                  </span>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${getStatusBadgeClass(status)}`}
                  >
                    {getStatusLabel(status)}
                  </span>
                </label>
              );
            })}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <InfoTile label="Selecionados" value={String(processos.length)} />
            <InfoTile label="Afetados" value={String(targets.length)} />
            <InfoTile label="Ignorados" value={String(ignoredCount)} />
          </div>

          {novoStatus === 'concluido' && (
            <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
              A conclusão em lote será feita sem preencher dados estruturados de
              guia, sentenciado, atividade ou execução penal.
            </p>
          )}
          {novoStatus === 'em_andamento' && (
            <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
              Ao iniciar em lote, o limite de processos em andamento por
              recebedor continua sendo aplicado.
            </p>
          )}

          <label
            htmlFor="bulk-status-observacao"
            className="mt-4 block text-sm font-medium text-ink-primary"
          >
            Observação <span className="font-normal text-ink-secondary">(opcional)</span>
          </label>
          <textarea
            id="bulk-status-observacao"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            disabled={busy}
            rows={3}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-ink-primary focus:border-brand-primary focus:ring-1 focus:ring-brand-primary disabled:opacity-50"
            placeholder="Registre uma observação para aplicar aos processos afetados."
          />
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
            onClick={() =>
              onConfirm(novoStatus, observacaoLimpa ? observacaoLimpa : null)
            }
            disabled={busy || targets.length === 0}
            className="rounded-md bg-brand-primary px-3 py-2 text-sm font-semibold text-white hover:bg-brand-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Alterando...' : 'Trocar status'}
          </button>
        </div>
      </div>
    </div>
  );
}

function bulkActionTitle(action: BulkAction): string {
  if (action === 'urgente') return 'Marcar processos como urgentes?';
  if (action === 'desatribuir') return 'Desatribuir processos selecionados?';
  if (action === 'concluir') return 'Concluir processos sem dados?';
  return 'Remover processos selecionados?';
}

function bulkActionDescription(action: BulkAction): string {
  if (action === 'urgente') {
    return 'Os processos ainda não urgentes serão marcados como urgentes.';
  }
  if (action === 'desatribuir') {
    return 'Os processos sairão dos recebedores atuais e voltarão para a fila de não atribuídos.';
  }
  if (action === 'concluir') {
    return 'Os processos serão marcados como concluídos sem guia, sentenciado, atividade ou dados da execução penal.';
  }
  return 'Os processos selecionados serão removidos permanentemente. Essa ação grava histórico, mas não pode ser desfeita por esta tela.';
}

function bulkActionButtonLabel(action: BulkAction, busy: boolean): string {
  if (busy) {
    if (action === 'urgente') return 'Marcando...';
    if (action === 'desatribuir') return 'Desatribuindo...';
    if (action === 'concluir') return 'Concluindo...';
    return 'Removendo...';
  }
  if (action === 'urgente') return 'Marcar urgentes';
  if (action === 'desatribuir') return 'Desatribuir';
  if (action === 'concluir') return 'Concluir sem dados';
  return 'Remover processos';
}

interface BulkActionDialogProps {
  action: BulkAction;
  selectedCount: number;
  targetCount: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

function BulkActionDialog({
  action,
  selectedCount,
  targetCount,
  busy,
  onCancel,
  onConfirm,
}: BulkActionDialogProps) {
  const ignoredCount = Math.max(0, selectedCount - targetCount);
  const danger = action === 'remover';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-action-title"
    >
      <div
        className="absolute inset-0 bg-black/50"
        aria-hidden="true"
        onClick={() => {
          if (!busy) onCancel();
        }}
      />
      <div className="relative w-full max-w-lg rounded-lg bg-surface shadow-xl">
        <div className="px-5 py-4">
          <h2
            id="bulk-action-title"
            className={`text-lg font-semibold ${
              danger ? 'text-rose-700' : 'text-ink-primary'
            }`}
          >
            {bulkActionTitle(action)}
          </h2>
          <p className="mt-2 text-sm text-ink-secondary">
            {bulkActionDescription(action)}
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <InfoTile label="Selecionados" value={String(selectedCount)} />
            <InfoTile label="Afetados" value={String(targetCount)} />
            <InfoTile label="Ignorados" value={String(ignoredCount)} />
          </div>
          {ignoredCount > 0 && (
            <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
              {ignoredCount} processo{ignoredCount === 1 ? '' : 's'} não se
              enquadra{ignoredCount === 1 ? '' : 'm'} nesta ação e será
              ignorado{ignoredCount === 1 ? '' : 's'}.
            </p>
          )}
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
            onClick={onConfirm}
            disabled={busy || targetCount === 0}
            className={`rounded-md px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 ${
              danger
                ? 'bg-state-danger hover:bg-rose-700'
                : 'bg-brand-primary hover:bg-brand-primary-dark'
            }`}
          >
            {bulkActionButtonLabel(action, busy)}
          </button>
        </div>
      </div>
    </div>
  );
}

interface DeleteAllDialogProps {
  count: number;
  periodoLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

function DeleteAllDialog({
  count,
  periodoLabel,
  busy,
  onCancel,
  onConfirm,
}: DeleteAllDialogProps) {
  const [confirmText, setConfirmText] = useState('');
  const canConfirm = confirmText === 'APAGAR TUDO';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-all-title"
    >
      <div
        className="absolute inset-0 bg-black/60"
        aria-hidden="true"
        onClick={() => {
          if (!busy) onCancel();
        }}
      />
      <div className="relative w-full max-w-lg rounded-lg bg-surface shadow-xl">
        <div className="px-5 py-4">
          <h2
            id="delete-all-title"
            className="text-lg font-semibold text-rose-700"
          >
            Apagar todos os processos carregados?
          </h2>
          <p className="mt-2 text-sm text-ink-secondary">
            Esta ação excluirá permanentemente{' '}
            <span className="font-semibold text-ink-primary">{count}</span>{' '}
            processo{count === 1 ? '' : 's'} de {periodoLabel}. Se eles vieram
            de uma distribuição legada, também serão apagados outros processos da
            mesma distribuição, mesmo fora deste período. Não dá para desfazer
            por esta tela.
          </p>
          <label
            htmlFor="delete-confirm"
            className="mt-4 block text-sm font-medium text-ink-primary"
          >
            Digite <span className="font-mono">APAGAR TUDO</span> para
            confirmar
          </label>
          <input
            id="delete-confirm"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            disabled={busy}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm text-ink-primary focus:border-state-danger focus:ring-1 focus:ring-state-danger disabled:opacity-50"
            autoFocus
          />
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
            onClick={() => {
              void onConfirm();
            }}
            disabled={busy || !canConfirm}
            className="rounded-md bg-state-danger px-3 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Apagando...' : 'Apagar definitivamente'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface DeleteLastDistributionDialogProps {
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

function DeleteLastDistributionDialog({
  busy,
  onCancel,
  onConfirm,
}: DeleteLastDistributionDialogProps) {
  const [confirmText, setConfirmText] = useState('');
  const canConfirm = confirmText === 'APAGAR DISTRIBUICAO';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-last-distribution-title"
    >
      <div
        className="absolute inset-0 bg-black/60"
        aria-hidden="true"
        onClick={() => {
          if (!busy) onCancel();
        }}
      />
      <div className="relative w-full max-w-lg rounded-lg bg-surface shadow-xl">
        <div className="px-5 py-4">
          <h2
            id="delete-last-distribution-title"
            className="text-lg font-semibold text-rose-700"
          >
            Apagar a última distribuição?
          </h2>
          <p className="mt-2 text-sm text-ink-secondary">
            Esta ação apagará todos os processos da distribuição confirmada mais
            recente que ainda tenha processos vinculados. Depois de apagar, essa
            distribuição será marcada como descartada; se você usar o botão de
            novo, ele avançará para a distribuição anterior.
          </p>
          <label
            htmlFor="delete-last-distribution-confirm"
            className="mt-4 block text-sm font-medium text-ink-primary"
          >
            Digite <span className="font-mono">APAGAR DISTRIBUICAO</span> para
            confirmar
          </label>
          <input
            id="delete-last-distribution-confirm"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            disabled={busy}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm text-ink-primary focus:border-state-danger focus:ring-1 focus:ring-state-danger disabled:opacity-50"
            autoFocus
          />
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
            onClick={() => {
              void onConfirm();
            }}
            disabled={busy || !canConfirm}
            className="rounded-md bg-state-danger px-3 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Apagando...' : 'Apagar distribuição'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sentenciados duplicados (nomes repetidos)
// ---------------------------------------------------------------------------

interface DuplicadoNumero {
  numero: string;
  processo: Processo;
}

interface DuplicadoGrupo {
  key: string;
  nome: string;
  numeros: DuplicadoNumero[];
}

/** Chave de comparação: sem acento, minúsculo, espaços colapsados. */
function normalizeNomeKey(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

interface SentenciadosDuplicadosDialogProps {
  usersByUid: Map<string, User>;
  onClose: () => void;
}

function SentenciadosDuplicadosDialog({
  usersByUid,
  onClose,
}: SentenciadosDuplicadosDialogProps) {
  const [processos, setProcessos] = useState<Processo[] | null>(() =>
    getTodosCache()
  );
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (processos) return; // cache de sessão já tem a lista completa
    let cancelled = false;
    (async () => {
      try {
        const list = await getAllProcessos();
        if (cancelled) return;
        setTodosCache(list);
        setProcessos(list);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : 'Falha ao varrer os processos.'
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [processos]);

  // Varre todos os processos em uma única passada: extrai o nome do sentenciado,
  // agrupa por nome normalizado e mantém só quem aparece em 2+ números SEI
  // distintos (dedupe por número evita falso positivo de doc reimportado).
  const { grupos, totalProcessos, comNome } = useMemo(() => {
    if (!processos) {
      return { grupos: [] as DuplicadoGrupo[], totalProcessos: 0, comNome: 0 };
    }
    const map = new Map<
      string,
      { nome: string; porNumero: Map<string, Processo> }
    >();
    let comNome = 0;
    for (const p of processos) {
      const nome = getSentenciadoNomeProcesso(p);
      if (!nome) continue;
      const key = normalizeNomeKey(nome);
      if (!key) continue;
      comNome += 1;
      let entry = map.get(key);
      if (!entry) {
        entry = { nome, porNumero: new Map() };
        map.set(key, entry);
      } else if (nome.length > entry.nome.length) {
        // mostra a versão mais completa do nome como rótulo do grupo
        entry.nome = nome;
      }
      if (!entry.porNumero.has(p.numero)) entry.porNumero.set(p.numero, p);
    }
    const grupos: DuplicadoGrupo[] = [];
    for (const [key, entry] of map) {
      if (entry.porNumero.size < 2) continue;
      grupos.push({
        key,
        nome: entry.nome,
        numeros: Array.from(entry.porNumero.values()).map((processo) => ({
          numero: processo.numero,
          processo,
        })),
      });
    }
    grupos.sort(
      (a, b) =>
        b.numeros.length - a.numeros.length ||
        a.nome.localeCompare(b.nome, 'pt-BR')
    );
    return { grupos, totalProcessos: processos.length, comNome };
  }, [processos]);

  const gruposFiltrados = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    if (!q) return grupos;
    return grupos.filter(
      (g) =>
        g.nome.toLowerCase().includes(q) ||
        g.numeros.some((n) => n.numero.toLowerCase().includes(q))
    );
  }, [grupos, filtro]);

  const totalNumeros = useMemo(
    () => grupos.reduce((sum, g) => sum + g.numeros.length, 0),
    [grupos]
  );

  async function copy(text: string, marker: string) {
    await navigator.clipboard.writeText(text);
    setCopied(marker);
    window.setTimeout(
      () => setCopied((cur) => (cur === marker ? null : cur)),
      1400
    );
  }

  const loading = processos === null && !error;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="duplicados-title"
    >
      <div
        className="absolute inset-0 bg-black/50"
        aria-hidden="true"
        onClick={onClose}
      />
      <div className="relative flex max-h-[86vh] w-full max-w-3xl flex-col rounded-lg bg-surface shadow-xl">
        <div className="border-b border-gray-200 px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2
                id="duplicados-title"
                className="inline-flex items-center gap-2 text-lg font-semibold text-ink-primary"
              >
                <Users className="h-5 w-5 text-ink-secondary" />
                Sentenciados com mais de um processo
              </h2>
              <p className="mt-1 text-xs text-ink-secondary">
                {loading
                  ? 'Varrendo todos os processos...'
                  : `Varridos ${totalProcessos} processos · ${comNome} com nome identificável · ${grupos.length} nome${grupos.length === 1 ? '' : 's'} repetido${grupos.length === 1 ? '' : 's'} (${totalNumeros} processos).`}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium text-ink-primary hover:bg-gray-50"
            >
              Fechar
            </button>
          </div>
          {!loading && !error && grupos.length > 0 && (
            <div className="mt-3 flex items-center rounded-md border border-gray-300 px-2 py-1 focus-within:border-brand-primary">
              <Search className="h-4 w-4 text-ink-secondary" aria-hidden="true" />
              <input
                type="text"
                value={filtro}
                onChange={(e) => setFiltro(e.target.value)}
                placeholder="Filtrar por nome ou número SEI"
                className="ml-2 w-full bg-transparent text-sm text-ink-primary outline-none placeholder:text-ink-secondary/70"
              />
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error ? (
            <p className="text-sm text-rose-700">{error}</p>
          ) : loading ? (
            <p className="inline-flex items-center gap-2 text-sm text-ink-secondary">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando...
            </p>
          ) : grupos.length === 0 ? (
            <p className="text-sm text-ink-secondary">
              Nenhum sentenciado com mais de um processo encontrado.
            </p>
          ) : gruposFiltrados.length === 0 ? (
            <p className="text-sm text-ink-secondary">
              Nenhum resultado para “{filtro}”.
            </p>
          ) : (
            <ul className="space-y-3">
              {gruposFiltrados.map((g) => (
                <li
                  key={g.key}
                  className="rounded-lg border border-gray-200 bg-surface-elevated"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-ink-primary">
                        {g.nome}
                      </span>
                      <span className="inline-flex items-center rounded-full bg-brand-primary-light px-2 py-0.5 text-xs font-semibold text-brand-primary-dark">
                        {g.numeros.length} processos
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        void copy(
                          g.numeros.map((n) => n.numero).join('\n'),
                          `${g.key}|all`
                        )
                      }
                      className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-ink-secondary hover:bg-gray-50 hover:text-ink-primary"
                    >
                      {copied === `${g.key}|all` ? (
                        <Check className="h-3.5 w-3.5 text-state-success" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      Copiar números
                    </button>
                  </div>
                  <ul className="divide-y divide-gray-100">
                    {g.numeros.map(({ numero, processo }) => {
                      const recebedor = processo.recebedorUid
                        ? usersByUid.get(processo.recebedorUid)
                        : null;
                      const marker = `${g.key}|${numero}`;
                      return (
                        <li
                          key={processo.id}
                          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-xs text-ink-primary">
                              {numero}
                            </span>
                            <button
                              type="button"
                              onClick={() => void copy(numero, marker)}
                              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-gray-200 text-ink-secondary hover:bg-gray-50 hover:text-ink-primary"
                              title="Copiar número"
                              aria-label={`Copiar número do processo ${numero}`}
                            >
                              {copied === marker ? (
                                <Check className="h-3.5 w-3.5 text-state-success" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-ink-secondary">
                            <span className="line-clamp-1">
                              {recebedor ? recebedor.displayName : 'Sem recebedor'}
                            </span>
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ${getStatusBadgeClass(
                                processo.status
                              )}`}
                            >
                              {getStatusLabel(processo.status)}
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

interface DeleteOneDialogProps {
  processo: Processo;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

function DeleteOneDialog({
  processo,
  busy,
  onCancel,
  onConfirm,
}: DeleteOneDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-one-title"
    >
      <div
        className="absolute inset-0 bg-black/50"
        aria-hidden="true"
        onClick={() => {
          if (!busy) onCancel();
        }}
      />
      <div className="relative w-full max-w-lg rounded-lg bg-surface shadow-xl">
        <div className="px-5 py-4">
          <h2 id="delete-one-title" className="text-lg font-semibold text-rose-700">
            Remover processo?
          </h2>
          <p className="mt-2 text-sm text-ink-secondary">
            O processo{' '}
            <span className="font-mono font-semibold text-ink-primary">
              {processo.numero}
            </span>{' '}
            será removido permanentemente. Essa ação grava histórico, mas não
            pode ser desfeita por esta tela.
          </p>
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
            onClick={() => {
              void onConfirm();
            }}
            disabled={busy}
            className="rounded-md bg-state-danger px-3 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Removendo...' : 'Remover processo'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ProcessHistoryDialogProps {
  processo: Processo;
  usersByUid: Map<string, User>;
  onClose: () => void;
}

function ProcessHistoryDialog({
  processo,
  usersByUid,
  onClose,
}: ProcessHistoryDialogProps) {
  const [entries, setEntries] = useState<HistoricoEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEntries(null);
    setError(null);
    const unsub = subscribeHistoricoProcesso(
      processo.id,
      (list) => setEntries(list),
      (err) => {
        setEntries([]);
        setError(err.message || 'Falha ao carregar histórico do processo.');
      }
    );
    return unsub;
  }, [processo.id]);

  const recebedor = processo.recebedorUid
    ? usersByUid.get(processo.recebedorUid)
    : null;
  const observacoes = [
    processo.observacao ? ['Observação geral', processo.observacao] : null,
    processo.observacaoInicio ? ['Observação de início', processo.observacaoInicio] : null,
    processo.observacaoConclusao
      ? ['Observação de conclusão', processo.observacaoConclusao]
      : null,
  ].filter(Boolean) as Array<[string, string]>;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="process-history-title"
    >
      <div
        className="absolute inset-0 bg-black/50"
        aria-hidden="true"
        onClick={onClose}
      />
      <div className="relative flex max-h-[86vh] w-full max-w-3xl flex-col rounded-lg bg-surface shadow-xl">
        <div className="border-b border-gray-200 px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2
                id="process-history-title"
                className="text-lg font-semibold text-ink-primary"
              >
                Histórico do processo
              </h2>
              <p className="mt-1 font-mono text-sm text-ink-secondary">
                {processo.numero}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-200 px-3 py-2 text-sm font-medium text-ink-primary hover:bg-gray-50"
            >
              Fechar
            </button>
          </div>
        </div>

        <div className="space-y-5 overflow-y-auto px-5 py-4">
          <section className="grid gap-3 md:grid-cols-3">
            <InfoTile label="Origem" value={processo.agrupadorNome} />
            <InfoTile
              label="Recebedor"
              value={recebedor?.displayName ?? processo.recebedorUid ?? '—'}
            />
            <InfoTile label="Status" value={getStatusLabel(processo.status)} />
            <InfoTile
              label="Devolvido"
              value={processo.devolvido ? 'Sim' : 'Não'}
            />
            <InfoTile
              label="Criado em"
              value={formatTimestampBr(processo.createdAt)}
            />
            <InfoTile
              label="Atribuído em"
              value={formatTimestampBr(processo.diaAtribuicao)}
            />
            <InfoTile label="Prazo" value={formatTimestampBr(processo.prazoFinal)} />
            <InfoTile
              label="Iniciado em"
              value={formatTimestampBr(processo.iniciadoEm)}
            />
            <InfoTile
              label="Concluído em"
              value={formatTimestampBr(processo.concluidoEm)}
            />
            <InfoTile
              label="Atualizado em"
              value={formatTimestampBr(processo.updatedAt)}
            />
          </section>

          <section>
            <h3 className="text-sm font-semibold text-ink-primary">
              Dados da conclusão
            </h3>
            {formatDadosConclusao(processo.dadosConclusao).length === 0 ? (
              <p className="mt-2 rounded-md border border-dashed border-gray-200 px-3 py-3 text-sm text-ink-secondary">
                Nenhum dado de conclusão registrado neste processo.
              </p>
            ) : (
              <div className="mt-2 grid gap-3 md:grid-cols-2">
                {formatDadosConclusao(processo.dadosConclusao).map((item) => (
                  <InfoTile
                    key={item.label}
                    label={item.label}
                    value={item.value}
                  />
                ))}
              </div>
            )}
          </section>

          <section>
            <h3 className="text-sm font-semibold text-ink-primary">
              Observações registradas
            </h3>
            {observacoes.length === 0 ? (
              <p className="mt-2 rounded-md border border-dashed border-gray-200 px-3 py-3 text-sm text-ink-secondary">
                Nenhuma observação registrada neste processo.
              </p>
            ) : (
              <div className="mt-2 space-y-2">
                {observacoes.map(([label, text]) => (
                  <div
                    key={label}
                    className="rounded-md border border-gray-200 bg-surface-elevated px-3 py-2"
                  >
                    <div className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
                      {label}
                    </div>
                    <div className="mt-1 whitespace-pre-wrap text-sm text-ink-primary">
                      {text}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h3 className="text-sm font-semibold text-ink-primary">
              Linha do tempo
            </h3>
            {error && (
              <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
                {error}
              </div>
            )}
            {entries === null ? (
              <div className="mt-2 flex items-center gap-2 rounded-md border border-gray-200 bg-surface-elevated px-3 py-4 text-sm text-ink-secondary">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando histórico...
              </div>
            ) : entries.length === 0 && !error ? (
              <p className="mt-2 rounded-md border border-dashed border-gray-200 px-3 py-3 text-sm text-ink-secondary">
                Não há eventos individuais no histórico para este processo.
              </p>
            ) : (
              <ol className="mt-3 space-y-3">
                {entries.map((entry) => {
                  const obs = getHistoricoObservacao(entry);
                  return (
                    <li
                      key={entry.id}
                      className="rounded-md border border-gray-200 bg-surface-elevated px-3 py-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${getHistoricoTipoCor(entry.tipo)}`}
                        >
                          {HISTORICO_TIPO_LABELS[entry.tipo]}
                        </span>
                        <span className="text-xs font-medium text-ink-secondary">
                          {formatTimestampBr(entry.timestamp)}
                        </span>
                      </div>
                      <div className="mt-2 text-sm text-ink-primary">
                        {resumirPayload(entry)}
                      </div>
                      <div className="mt-1 text-xs text-ink-secondary">
                        Por {entry.acaoPorNome}
                      </div>
                      {obs && (
                        <div className="mt-2 rounded-md border border-gray-200 bg-surface px-3 py-2 text-sm">
                          <span className="font-semibold text-ink-primary">
                            Observação:
                          </span>{' '}
                          <span className="whitespace-pre-wrap text-ink-primary">
                            {obs}
                          </span>
                        </div>
                      )}
                      <HistoricoDadosConclusao entry={entry} />
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-gray-200 bg-surface-elevated px-3 py-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
        {label}
      </div>
      <div className="mt-1 break-words text-sm font-medium text-ink-primary">
        {value}
      </div>
    </div>
  );
}

function HistoricoDadosConclusao({ entry }: { entry: HistoricoEntry }) {
  const dados = entry.payload.dadosConclusao as
    | DadosConclusaoProcesso
    | null
    | undefined;
  const rows = formatDadosConclusao(dados);
  if (rows.length === 0) return null;

  return (
    <div className="mt-2 rounded-md border border-gray-200 bg-surface px-3 py-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
        Dados da conclusão
      </div>
      <dl className="mt-2 grid gap-x-3 gap-y-1 text-xs sm:grid-cols-2">
        {rows.map((item) => (
          <div key={item.label}>
            <dt className="text-ink-secondary">{item.label}</dt>
            <dd className="font-medium text-ink-primary">{item.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function FieldGroup({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}

interface StatusChangeDialogProps {
  processo: Processo;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (
    novoStatus: ProcessoStatusEditavel,
    observacao: string | null,
    options?: {
      devolvido?: boolean;
      dadosConclusao?: DadosConclusaoProcesso | null;
    }
  ) => void;
}

function StatusChangeDialog({
  processo,
  busy,
  onCancel,
  onConfirm,
}: StatusChangeDialogProps) {
  const initialStatus =
    processo.status === 'pendente' ||
    processo.status === 'em_andamento' ||
    processo.status === 'concluido'
      ? processo.status
      : 'pendente';
  const [novoStatus, setNovoStatus] =
    useState<ProcessoStatusEditavel>(initialStatus);
  const [observacao, setObservacao] = useState('');
  const [devolvido, setDevolvido] = useState(processo.devolvido === true);
  const [guiaExecucaoNumero, setGuiaExecucaoNumero] = useState(
    processo.dadosConclusao?.guiaExecucaoNumero ?? ''
  );
  const [sentenciadoNome, setSentenciadoNome] = useState(
    getSentenciadoNomeProcesso(processo) ?? ''
  );
  const [tipoPena, setTipoPena] = useState<ConclusaoTipoPena | ''>(
    processo.dadosConclusao?.tipoPena ?? ''
  );
  const [regimeCondenacao, setRegimeCondenacao] = useState<
    ConclusaoRegimeCondenacao | ''
  >(processo.dadosConclusao?.regimeCondenacao ?? '');
  const [situacaoPrisao, setSituacaoPrisao] = useState<
    ConclusaoSituacaoPrisao | ''
  >(processo.dadosConclusao?.situacaoPrisao ?? '');
  const [atividade, setAtividade] = useState<ConclusaoAtividade | ''>(
    processo.dadosConclusao?.atividade ?? ''
  );
  const [execucaoPenalNumero, setExecucaoPenalNumero] = useState(
    processo.dadosConclusao?.execucaoPenalNumero ?? ''
  );
  const [comarca, setComarca] = useState(processo.dadosConclusao?.comarca ?? '');
  const [beneficiosPendentes, setBeneficiosPendentes] = useState<
    BeneficioPendenteConclusao[]
  >(processo.dadosConclusao?.beneficiosPendentes ?? []);
  const observacaoLimpa = observacao.trim();
  const isConclusao = novoStatus === 'concluido';
  const observacaoObrigatoria = isConclusao && devolvido;
  const observacaoDevolucaoPendente =
    observacaoObrigatoria && observacaoLimpa.length === 0;
  const exigeDadosGuia = isConclusao;
  const exigeDadosExecucao = isConclusao && !devolvido;
  const exigeAtividade = isConclusao && !devolvido;
  const guiaExecucaoLimpa = guiaExecucaoNumero.trim();
  const sentenciadoLimpo = sentenciadoNome.trim();
  const execucaoPenalLimpa = execucaoPenalNumero.trim();
  const comarcaLimpa = comarca.trim();
  const guiaExecucaoInvalida =
    exigeDadosGuia &&
    guiaExecucaoLimpa.length > 0 &&
    !GUIA_EXECUCAO_PATTERN.test(guiaExecucaoLimpa);
  const execucaoPenalInvalida =
    exigeDadosExecucao &&
    execucaoPenalLimpa.length > 0 &&
    !EXECUCAO_PENAL_PATTERN.test(execucaoPenalLimpa);
  const dadosBasicosPendente =
    exigeDadosGuia &&
    (guiaExecucaoLimpa.length === 0 ||
      guiaExecucaoInvalida ||
      sentenciadoLimpo.length === 0 ||
      tipoPena === '' ||
      regimeCondenacao === '' ||
      situacaoPrisao === '' ||
      (exigeAtividade && atividade === ''));
  const dadosExecucaoPendente =
    exigeDadosExecucao &&
    (execucaoPenalLimpa.length === 0 ||
      execucaoPenalInvalida ||
      comarcaLimpa.length === 0);
  const dadosConclusaoPendente = dadosBasicosPendente || dadosExecucaoPendente;
  const dadosConclusao: DadosConclusaoProcesso | null =
    isConclusao && !dadosConclusaoPendente
      ? {
          guiaExecucaoNumero: guiaExecucaoLimpa,
          sentenciadoNome: sentenciadoLimpo,
          tipoPena: tipoPena as ConclusaoTipoPena,
          regimeCondenacao: regimeCondenacao as ConclusaoRegimeCondenacao,
          situacaoPrisao: situacaoPrisao as ConclusaoSituacaoPrisao,
          atividade: devolvido
            ? 'pendencia'
            : (atividade as ConclusaoAtividade),
          execucaoPenalNumero: exigeDadosExecucao ? execucaoPenalLimpa : '',
          comarca: exigeDadosExecucao ? comarcaLimpa : '',
          beneficiosPendentes: exigeDadosExecucao ? beneficiosPendentes : [],
        }
      : null;
  const changed =
    novoStatus !== processo.status ||
    (isConclusao && devolvido !== (processo.devolvido === true)) ||
    (isConclusao && JSON.stringify(dadosConclusao) !== JSON.stringify(processo.dadosConclusao ?? null));

  function toggleBeneficio(beneficio: BeneficioPendenteConclusao) {
    setBeneficiosPendentes((prev) =>
      prev.includes(beneficio)
        ? prev.filter((item) => item !== beneficio)
        : [...prev, beneficio]
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="status-change-title"
    >
      <div
        className="absolute inset-0 bg-black/50"
        aria-hidden="true"
        onClick={() => {
          if (!busy) onCancel();
        }}
      />
      <div className="relative flex max-h-[86vh] w-full max-w-2xl flex-col rounded-lg bg-surface shadow-xl">
        <div className="overflow-y-auto px-5 py-4">
          <h2
            id="status-change-title"
            className="text-lg font-semibold text-ink-primary"
          >
            Trocar status do processo
          </h2>
          <p className="mt-1 text-sm text-ink-secondary">
            Processo{' '}
            <span className="font-mono font-semibold text-ink-primary">
              {processo.numero}
            </span>
          </p>

          <div className="mt-4 grid gap-2">
            {STATUS_CHANGE_OPTIONS.map((status) => {
              const checked = novoStatus === status;
              return (
                <label
                  key={status}
                  className={`flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm transition-colors ${
                    checked
                      ? 'border-brand-primary bg-brand-primary/5'
                      : 'border-gray-200 bg-surface-elevated hover:bg-gray-50'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="novo-status"
                      checked={checked}
                      disabled={busy}
                      onChange={() => setNovoStatus(status)}
                      className="accent-brand-primary"
                    />
                    <span className="font-medium text-ink-primary">
                      {getStatusLabel(status)}
                    </span>
                  </span>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${getStatusBadgeClass(status)}`}
                  >
                    {getStatusLabel(status)}
                  </span>
                </label>
              );
            })}
          </div>

          {isConclusao && (
            <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-md border border-gray-200 bg-surface-elevated px-3 py-2 text-sm text-ink-primary">
              <input
                type="checkbox"
                checked={devolvido}
                onChange={(e) => setDevolvido(e.target.checked)}
                disabled={busy}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-brand-primary"
              />
              <span>
                <span className="font-medium">Devolvido?</span>
                <span className="block text-xs text-ink-secondary">
                  Marque quando a conclusão corresponde a devolução do processo.
                </span>
              </span>
            </label>
          )}
          {isConclusao && devolvido && (
            <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
              Conclusões marcadas como devolvidas não exigem atividade nem dados
              da execução penal, mas os dados da guia continuam obrigatórios.
            </p>
          )}
          {isConclusao && (
            <section className="mt-4 rounded-md border border-gray-200 bg-surface-elevated px-4 py-3">
              <h3 className="text-sm font-semibold text-ink-primary">
                Dados da guia
              </h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <FieldGroup>
                  <label
                    htmlFor="status-guia-execucao"
                    className="block text-sm font-medium text-ink-primary"
                  >
                    Nº da guia de execução
                    {exigeDadosGuia && (
                      <span className="text-state-danger"> *</span>
                    )}
                  </label>
                  <input
                    id="status-guia-execucao"
                    type="text"
                    value={guiaExecucaoNumero}
                    onChange={(e) => setGuiaExecucaoNumero(e.target.value)}
                    disabled={busy}
                    placeholder="0000000-00.0000.0.00.0000"
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-ink-primary focus:border-brand-primary focus:ring-1 focus:ring-brand-primary disabled:opacity-50"
                  />
                  {guiaExecucaoInvalida && (
                    <p className="mt-1 text-xs font-medium text-state-danger">
                      Use o formato 0000000-00.0000.0.00.0000.
                    </p>
                  )}
                </FieldGroup>

                <FieldGroup>
                  <label
                    htmlFor="status-sentenciado"
                    className="block text-sm font-medium text-ink-primary"
                  >
                    Nome do sentenciado
                    {exigeDadosGuia && (
                      <span className="text-state-danger"> *</span>
                    )}
                  </label>
                  <input
                    id="status-sentenciado"
                    type="text"
                    value={sentenciadoNome}
                    onChange={(e) => setSentenciadoNome(e.target.value)}
                    disabled={busy}
                    placeholder="Nome completo"
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-ink-primary focus:border-brand-primary focus:ring-1 focus:ring-brand-primary disabled:opacity-50"
                  />
                </FieldGroup>

                <FieldGroup>
                  <label
                    htmlFor="status-tipo-pena"
                    className="block text-sm font-medium text-ink-primary"
                  >
                    Tipo de pena
                    {exigeDadosGuia && (
                      <span className="text-state-danger"> *</span>
                    )}
                  </label>
                  <select
                    id="status-tipo-pena"
                    value={tipoPena}
                    onChange={(e) =>
                      setTipoPena(e.target.value as ConclusaoTipoPena | '')
                    }
                    disabled={busy}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-ink-primary focus:border-brand-primary focus:ring-1 focus:ring-brand-primary disabled:opacity-50"
                  >
                    <option value="">Escolher</option>
                    {TIPO_PENA_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </FieldGroup>

                <FieldGroup>
                  <label
                    htmlFor="status-regime-condenacao"
                    className="block text-sm font-medium text-ink-primary"
                  >
                    Regime da condenação
                    {exigeDadosGuia && (
                      <span className="text-state-danger"> *</span>
                    )}
                  </label>
                  <select
                    id="status-regime-condenacao"
                    value={regimeCondenacao}
                    onChange={(e) =>
                      setRegimeCondenacao(
                        e.target.value as ConclusaoRegimeCondenacao | ''
                      )
                    }
                    disabled={busy}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-ink-primary focus:border-brand-primary focus:ring-1 focus:ring-brand-primary disabled:opacity-50"
                  >
                    <option value="">Escolher</option>
                    {REGIME_CONDENACAO_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </FieldGroup>

                <FieldGroup>
                  <label
                    htmlFor="status-situacao-prisao"
                    className="block text-sm font-medium text-ink-primary"
                  >
                    Situação de prisão
                    {exigeDadosGuia && (
                      <span className="text-state-danger"> *</span>
                    )}
                  </label>
                  <select
                    id="status-situacao-prisao"
                    value={situacaoPrisao}
                    onChange={(e) =>
                      setSituacaoPrisao(
                        e.target.value as ConclusaoSituacaoPrisao | ''
                      )
                    }
                    disabled={busy}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-ink-primary focus:border-brand-primary focus:ring-1 focus:ring-brand-primary disabled:opacity-50"
                  >
                    <option value="">Escolher</option>
                    {SITUACAO_PRISAO_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </FieldGroup>

                {!devolvido && (
                  <FieldGroup>
                    <label
                      htmlFor="status-atividade-conclusao"
                      className="block text-sm font-medium text-ink-primary"
                    >
                      Atividade
                      {exigeAtividade && (
                        <span className="text-state-danger"> *</span>
                      )}
                    </label>
                    <select
                      id="status-atividade-conclusao"
                      value={atividade}
                      onChange={(e) =>
                        setAtividade(e.target.value as ConclusaoAtividade | '')
                      }
                      disabled={busy}
                      className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-ink-primary focus:border-brand-primary focus:ring-1 focus:ring-brand-primary disabled:opacity-50"
                    >
                      <option value="">Escolher</option>
                      {ATIVIDADE_CONCLUSAO_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </FieldGroup>
                )}
              </div>
              {dadosBasicosPendente && !guiaExecucaoInvalida && (
                <p className="mt-2 text-xs font-medium text-state-danger">
                  Preencha os dados obrigatórios da guia.
                </p>
              )}
            </section>
          )}
          {exigeDadosExecucao && (
            <div className="mt-4 space-y-5">
              <FieldGroup>
                <label
                  htmlFor="status-execucao-penal"
                  className="block text-sm font-semibold text-ink-primary"
                >
                  Nº da execução penal
                  <span className="font-normal text-state-danger"> *</span>
                </label>
                <p className="mt-1 text-xs text-ink-secondary">
                  Formato CNJ: 0000000-00.0000.0.00.0000
                </p>
                <input
                  id="status-execucao-penal"
                  type="text"
                  value={execucaoPenalNumero}
                  onChange={(e) => setExecucaoPenalNumero(e.target.value)}
                  disabled={busy}
                  required
                  placeholder="0000000-00.0000.0.00.0000"
                  className="mt-2 w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm text-ink-primary focus:border-brand-primary focus:ring-1 focus:ring-brand-primary disabled:opacity-50"
                />
                {execucaoPenalInvalida && (
                  <p className="mt-1 text-xs font-medium text-state-danger">
                    Use o formato 0000000-00.0000.0.00.0000.
                  </p>
                )}
              </FieldGroup>

              <FieldGroup>
                <label
                  htmlFor="status-comarca"
                  className="block text-sm font-semibold text-ink-primary"
                >
                  Comarca
                  <span className="font-normal text-state-danger"> *</span>
                </label>
                <input
                  id="status-comarca"
                  type="text"
                  value={comarca}
                  onChange={(e) => setComarca(e.target.value)}
                  disabled={busy}
                  required
                  placeholder="Escolher"
                  className="mt-2 w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm text-ink-primary focus:border-brand-primary focus:ring-1 focus:ring-brand-primary disabled:opacity-50"
                />
              </FieldGroup>

              <FieldGroup>
                <div className="text-sm font-semibold text-ink-primary">
                  Benefícios Pendentes
                </div>
                <p className="mt-1 text-xs text-ink-secondary">
                  Marque apenas quando o sistema apontar benefício vencido.
                </p>
                <div className="mt-3 space-y-2">
                  {BENEFICIO_PENDENTE_OPTIONS.map((option) => (
                    <label
                      key={option.value}
                      className="flex cursor-pointer items-start gap-2 text-sm text-ink-primary"
                    >
                      <input
                        type="checkbox"
                        checked={beneficiosPendentes.includes(option.value)}
                        onChange={() => toggleBeneficio(option.value)}
                        disabled={busy}
                        className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-brand-primary"
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </FieldGroup>
            </div>
          )}

          <label
            htmlFor="status-observacao"
            className="mt-4 block text-sm font-medium text-ink-primary"
          >
            Observação{' '}
            <span
              className={
                observacaoObrigatoria
                  ? 'font-normal text-state-danger'
                  : 'font-normal text-ink-secondary'
              }
            >
              {observacaoObrigatoria ? '*' : '(opcional)'}
            </span>
          </label>
          <textarea
            id="status-observacao"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            disabled={busy}
            rows={3}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-ink-primary focus:border-brand-primary focus:ring-1 focus:ring-brand-primary disabled:opacity-50"
            placeholder="Registre o motivo da alteração, se necessário."
          />
          {observacaoDevolucaoPendente && (
            <p className="mt-1 text-xs font-medium text-state-danger">
              Informe a observação para concluir como devolvido.
            </p>
          )}
          {isConclusao && dadosConclusaoPendente && !execucaoPenalInvalida && (
            <p className="mt-1 text-xs font-medium text-state-danger">
              Preencha todos os dados obrigatórios da conclusão.
            </p>
          )}
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
            onClick={() =>
              onConfirm(
                novoStatus,
                observacaoLimpa ? observacaoLimpa : null,
                isConclusao ? { devolvido, dadosConclusao } : undefined
              )
            }
            disabled={
              busy ||
              !changed ||
              dadosConclusaoPendente ||
              observacaoDevolucaoPendente
            }
            className="rounded-md bg-brand-primary px-3 py-2 text-sm font-semibold text-white hover:bg-brand-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Alterando...' : 'Alterar status'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ReturnToQueueDialogProps {
  processo: Processo;
  recebedor: User | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

interface QuickCompleteDialogProps {
  processo: Processo;
  recebedor: User | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

function QuickCompleteDialog({
  processo,
  recebedor,
  busy,
  onCancel,
  onConfirm,
}: QuickCompleteDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-complete-title"
    >
      <div
        className="absolute inset-0 bg-black/50"
        aria-hidden="true"
        onClick={() => {
          if (!busy) onCancel();
        }}
      />
      <div className="relative w-full max-w-lg rounded-lg bg-surface shadow-xl">
        <div className="px-5 py-4">
          <h2
            id="quick-complete-title"
            className="text-lg font-semibold text-emerald-800"
          >
            Concluir sem preencher dados?
          </h2>
          <p className="mt-2 text-sm text-ink-secondary">
            O processo{' '}
            <span className="font-mono font-semibold text-ink-primary">
              {processo.numero}
            </span>{' '}
            será marcado como concluído sem guia, nome do sentenciado, atividade
            ou dados da execução penal.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <InfoTile label="Status atual" value={getStatusLabel(processo.status)} />
            <InfoTile
              label="Recebedor"
              value={recebedor?.displayName ?? processo.recebedorUid ?? '—'}
            />
          </div>
          <p className="mt-3 text-xs text-ink-secondary">
            Use esta ação apenas para correção administrativa. O histórico
            registrará que a conclusão foi feita sem dados estruturados.
          </p>
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
            onClick={onConfirm}
            disabled={busy}
            className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Concluindo...' : 'Concluir sem dados'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReturnToQueueDialog({
  processo,
  recebedor,
  busy,
  onCancel,
  onConfirm,
}: ReturnToQueueDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="return-queue-title"
    >
      <div
        className="absolute inset-0 bg-black/50"
        aria-hidden="true"
        onClick={() => {
          if (!busy) onCancel();
        }}
      />
      <div className="relative w-full max-w-lg rounded-lg bg-surface shadow-xl">
        <div className="px-5 py-4">
          <h2
            id="return-queue-title"
            className="text-lg font-semibold text-amber-800"
          >
            Desatribuir e voltar para a fila?
          </h2>
          <p className="mt-2 text-sm text-ink-secondary">
            O processo{' '}
            <span className="font-mono font-semibold text-ink-primary">
              {processo.numero}
            </span>{' '}
            sairá de{' '}
            <span className="font-semibold text-ink-primary">
              {recebedor?.displayName ?? processo.recebedorUid ?? 'sem recebedor'}
            </span>{' '}
            e voltará para a fila de não atribuídos.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <InfoTile label="Status atual" value={getStatusLabel(processo.status)} />
            <InfoTile label="Origem" value={processo.agrupadorNome} />
          </div>
          <p className="mt-3 text-xs text-ink-secondary">
            A ação remove o recebedor, limpa início/conclusão e preserva o
            histórico do processo para auditoria.
          </p>
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
            onClick={onConfirm}
            disabled={busy}
            className="rounded-md bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Enviando...' : 'Voltar para fila'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface RenewPrazoDialogProps {
  processo: Processo;
  feriadosIso: string[];
  prazoPadraoDiasUteis: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (prazoDiasUteis: number) => void;
}

function RenewPrazoDialog({
  processo,
  feriadosIso,
  prazoPadraoDiasUteis,
  busy,
  onCancel,
  onConfirm,
}: RenewPrazoDialogProps) {
  const now = useMemo(() => nowInSp(), []);
  const prazoOriginal = Math.max(
    1,
    diffDiasUteis(processo.diaAtribuicao.toDate(), processo.prazoFinal.toDate()) ||
      prazoPadraoDiasUteis
  );
  const [dias, setDias] = useState(String(prazoOriginal));
  const diasNumber = Math.max(0, Number.parseInt(dias, 10));
  const safeDias = Number.isNaN(diasNumber) ? 0 : diasNumber;
  const novoPrazo = useMemo(
    () => addDiasUteis(now, safeDias, feriadosIso),
    [now, safeDias, feriadosIso]
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="renew-prazo-title"
    >
      <div
        className="absolute inset-0 bg-black/50"
        aria-hidden="true"
        onClick={() => {
          if (!busy) onCancel();
        }}
      />
      <div className="relative w-full max-w-lg rounded-lg bg-surface shadow-xl">
        <div className="px-5 py-4">
          <h2
            id="renew-prazo-title"
            className="text-lg font-semibold text-ink-primary"
          >
            Renovar prazo do processo
          </h2>
          <p className="mt-1 text-sm text-ink-secondary">
            Processo{' '}
            <span className="font-mono font-semibold text-ink-primary">
              {processo.numero}
            </span>
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-gray-200 bg-surface-elevated px-3 py-2 text-sm">
              <div className="text-xs text-ink-secondary">Prazo atual</div>
              <div className="font-medium text-ink-primary">
                {formatDateBr(processo.prazoFinal.toDate())}
              </div>
            </div>
            <div className="rounded-md border border-gray-200 bg-surface-elevated px-3 py-2 text-sm">
              <div className="text-xs text-ink-secondary">Novo prazo</div>
              <div className="font-medium text-ink-primary">
                {formatDateBr(novoPrazo)}
              </div>
            </div>
          </div>

          <label
            htmlFor="renew-prazo-dias"
            className="mt-4 block text-sm font-medium text-ink-primary"
          >
            Dias úteis a partir de hoje
          </label>
          <input
            id="renew-prazo-dias"
            type="number"
            min={0}
            value={dias}
            onChange={(e) => setDias(e.target.value)}
            disabled={busy}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-ink-primary focus:border-brand-primary focus:ring-1 focus:ring-brand-primary disabled:opacity-50"
            autoFocus
          />
          <p className="mt-2 text-xs text-ink-secondary">
            O valor inicial usa a duração aproximada do prazo anterior; altere
            para definir um prazo específico somente para este processo.
          </p>
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
            onClick={() => onConfirm(safeDias)}
            disabled={busy || !Number.isFinite(safeDias)}
            className="rounded-md bg-brand-primary px-3 py-2 text-sm font-semibold text-white hover:bg-brand-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Renovando...' : 'Renovar prazo'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface SortableThProps {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: SortDir;
  onClick: (k: SortKey) => void;
  className?: string;
}

function SortableTh({
  label,
  sortKey,
  activeKey,
  dir,
  onClick,
  className,
}: SortableThProps) {
  const isActive = activeKey === sortKey;
  const Icon = !isActive ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      className={`px-3 py-2 font-medium ${className ?? ''}`}
    >
      <button
        type="button"
        onClick={() => onClick(sortKey)}
        className={`inline-flex items-center gap-1 ${
          isActive ? 'text-brand-primary' : ''
        }`}
      >
        {label}
        <Icon className="h-3 w-3" />
      </button>
    </th>
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
    <div ref={containerRef} className="relative">
      <span className="mb-1 block text-xs text-ink-secondary">{label}</span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex min-w-[160px] items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
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
          className="absolute left-0 z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded-md border border-gray-200 bg-surface p-1 shadow-lg"
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
      Carregando processos...
    </div>
  );
}

function EmptyCard({ hasProcessos }: { hasProcessos: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-gray-200 bg-surface px-4 py-12 text-center text-sm text-ink-secondary">
      <FileText className="h-8 w-8 text-ink-secondary" />
      <span>
        {hasProcessos
          ? 'Nenhum processo corresponde aos filtros aplicados.'
          : 'Nenhum processo no período selecionado.'}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plain helpers
// ---------------------------------------------------------------------------

function todayIso(d: Date): string {
  return localIso(d);
}

function firstOfMonthIso(d: Date): string {
  const out = new Date(d);
  out.setDate(1);
  return localIso(out);
}

function mesAtualIso(now: Date): PeriodoIso {
  const start = new Date(now);
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  return { start: localIso(start), end: localIso(end) };
}

function localIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addIsoDays(iso: string, days: number): string {
  if (!iso) return '';
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return localIso(date);
}

function buildPeriodoLabel(
  modo: PeriodoMode,
  now: Date,
  customStart: string,
  customEnd: string
): string {
  if (modo === 'mes') {
    return `Mês de ${formatDateBr(now, "MMMM 'de' yyyy")}`;
  }
  if (modo === 'todos') {
    return 'todos os períodos';
  }
  if (!customStart || !customEnd) return 'Período personalizado';
  return `${formatIsoBr(customStart)} – ${formatIsoBr(customEnd)}`;
}

function formatIsoBr(iso: string): string {
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function formatTimestampBr(
  value: { toDate?: () => Date } | null | undefined
): string {
  if (!value || typeof value.toDate !== 'function') return '—';
  try {
    return formatDateBr(value.toDate(), 'dd/MM/yyyy HH:mm:ss');
  } catch {
    return '—';
  }
}

function getHistoricoObservacao(entry: HistoricoEntry): string | null {
  const value = entry.payload?.observacao;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function compareForSort(
  a: Processo,
  b: Processo,
  key: SortKey,
  usersByUid: Map<string, User>
): number {
  switch (key) {
    case 'numero':
      return a.numero.localeCompare(b.numero, 'pt-BR');
    case 'agrupador':
      return a.agrupadorNome.localeCompare(b.agrupadorNome, 'pt-BR');
    case 'recebedor': {
      const an = a.recebedorUid
        ? usersByUid.get(a.recebedorUid)?.displayName ?? ''
        : '';
      const bn = b.recebedorUid
        ? usersByUid.get(b.recebedorUid)?.displayName ?? ''
        : '';
      return an.localeCompare(bn, 'pt-BR');
    }
    case 'diaSemana': {
      const order: Record<DiaSemana, number> = {
        segunda: 1,
        terca: 2,
        quarta: 3,
        quinta: 4,
        sexta: 5,
      };
      return order[a.diaSemana] - order[b.diaSemana];
    }
    case 'diaAtribuicao':
      return a.diaAtribuicao.toMillis() - b.diaAtribuicao.toMillis();
    case 'prazoFinal':
      return a.prazoFinal.toMillis() - b.prazoFinal.toMillis();
    case 'status': {
      const order: Record<ProcessoStatus, number> = {
        nao_atribuido: 0,
        pendente: 1,
        em_andamento: 2,
        em_coordenacao: 3,
        em_espera: 4,
        concluido: 5,
      };
      return order[a.status] - order[b.status];
    }
    case 'origem':
      return a.origem.localeCompare(b.origem);
  }
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

const CSV_COLUMNS = [
  'Número',
  'Origem SEI',
  'Regime',
  'Recebedor',
  'Email recebedor',
  'Dia da semana',
  'Atribuído em',
  'Prazo',
  'Status',
  'Iniciado em',
  'Concluído em',
  'Nº da guia',
  'Sentenciado',
  'Tipo de pena',
  'Regime da condenação',
  'Situação de prisão',
  'Atividade',
  'Nº da execução penal',
  'Comarca',
  'Benefícios pendentes',
  '1ª entrada NURGE',
  'Devolvido origem',
  'Voltou NURGE',
  'Chegou originalmente para',
  'Urgente',
  'Prioridade',
  'Atrasado',
  'Origem do cadastro',
] as const;

function csvEscape(v: string): string {
  if (v.includes('"') || v.includes(';') || v.includes('\n') || v.includes('\r')) {
    return '"' + v.replace(/"/g, '""') + '"';
  }
  return v;
}

function buildCsv(
  list: Processo[],
  usersByUid: Map<string, User>,
  now: Date
): string {
  const rows = [CSV_COLUMNS.join(';')];
  for (const p of list) {
    const recebedor = p.recebedorUid ? usersByUid.get(p.recebedorUid) : null;
    const dadosConclusaoCsv = Object.fromEntries(
      formatDadosConclusao(p.dadosConclusao).map((item) => [
        item.label,
        item.value === '—' ? '' : item.value,
      ])
    );
    const cells = [
      p.numero,
      p.agrupadorNome,
      REGIME_LABEL[p.regime],
      recebedor?.displayName ?? '',
      recebedor?.email ?? '',
      DIA_SEMANA_LABEL[p.diaSemana],
      formatDateBr(p.diaAtribuicao.toDate()),
      formatDateBr(p.prazoFinal.toDate()),
      getStatusLabel(p.status),
      p.iniciadoEm
        ? formatDateBr(p.iniciadoEm.toDate(), 'dd/MM/yyyy HH:mm:ss')
        : '',
      p.concluidoEm
        ? formatDateBr(p.concluidoEm.toDate(), 'dd/MM/yyyy HH:mm:ss')
        : '',
      dadosConclusaoCsv['Nº da guia'] ?? '',
      dadosConclusaoCsv.Sentenciado ?? '',
      dadosConclusaoCsv['Tipo de pena'] ?? '',
      dadosConclusaoCsv['Regime da condenação'] ?? '',
      dadosConclusaoCsv['Situação de prisão'] ?? '',
      dadosConclusaoCsv.Atividade ?? '',
      dadosConclusaoCsv['Nº da execução penal'] ?? '',
      dadosConclusaoCsv.Comarca ?? '',
      dadosConclusaoCsv['Benefícios pendentes'] ?? '',
      p.primeiraEntradaNurgeEm
        ? formatDateBr(p.primeiraEntradaNurgeEm.toDate(), 'dd/MM/yyyy HH:mm:ss')
        : '',
      p.primeiraDevolucaoOrigemEm
        ? formatDateBr(
            p.primeiraDevolucaoOrigemEm.toDate(),
            'dd/MM/yyyy HH:mm:ss'
          )
        : '',
      p.ultimoRetornoNurgeEm
        ? formatDateBr(p.ultimoRetornoNurgeEm.toDate(), 'dd/MM/yyyy HH:mm:ss')
        : '',
      p.primeiroResponsavelNurge?.nome ??
        p.primeiroResponsavelNurge?.login ??
        '',
      p.urgente ? 'Sim' : 'Não',
      p.prioridade ? 'Sim' : 'Não',
      isAtrasado(p, now) ? 'Sim' : 'Não',
      ORIGEM_LABEL[p.origem],
    ].map(csvEscape);
    rows.push(cells.join(';'));
  }
  return rows.join('\r\n');
}
