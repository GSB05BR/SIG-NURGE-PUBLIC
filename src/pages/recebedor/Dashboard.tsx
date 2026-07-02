import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  AlertTriangle,
  Eraser,
  Filter,
  FileText,
  Flame,
  Inbox,
  LockKeyhole,
  Loader2,
  Play,
  Search,
  Star,
  X,
} from 'lucide-react';
import { useAuth } from '@/store/authStore';
import {
  enviarProcessoParaCoordenacao,
  subscribeProcessosAbertosByRecebedor,
  subscribeProcessosByRecebedorDesde,
  updateProcessoStatus,
} from '@/services/firebase/processos';
import { invalidateConcluidosRecebedorCache } from '@/store/processosStore';
import { ErrorState } from '@/components/ErrorState';
import {
  removerProcessoNota,
  salvarProcessoNota,
  subscribeProcessoNotas,
} from '@/services/firebase/processo-notas';
import { formatDateBr, getSemanaIso, nowInSp } from '@/lib/datetime';
import {
  detectarRetornosDaCoordenacao,
  mensagemRetornoCoordenacao,
  snapshotStatusPorId,
} from '@/lib/retorno-coordenacao';
import {
  isAtribuicaoLiberada,
  isAtrasado,
  LIMITE_EM_ANDAMENTO_RECEBEDOR_MESSAGE,
  MAX_PROCESSOS_EM_ANDAMENTO_RECEBEDOR,
  contarProcessosEmAndamento,
  getSentenciadoNomeProcesso,
  isPendenteDeDiaAnterior,
  isProcessoPendenteOuEmAndamentoDeSemanaAnterior,
  isUrgenteOuPrioridade,
  ordenarProcessosDoDia,
} from '@/lib/processo-helpers';
import {
  ATIVIDADE_CONCLUSAO_OPTIONS,
  BENEFICIO_PENDENTE_OPTIONS,
  EXECUCAO_PENAL_PATTERN,
  GUIA_EXECUCAO_PATTERN,
  REGIME_CONDENACAO_OPTIONS,
  SITUACAO_PRISAO_OPTIONS,
  TIPO_PENA_OPTIONS,
} from '@/lib/conclusao';
import { usePageTitle } from '@/lib/usePageTitle';
import type {
  BeneficioPendenteConclusao,
  ConclusaoAtividade,
  ConclusaoRegimeCondenacao,
  ConclusaoSituacaoPrisao,
  ConclusaoTipoPena,
  DadosConclusaoProcesso,
  DiaSemana,
  Processo,
  ProcessoRegime,
  ProcessoStatus,
} from '@/types';
import Toast, { type ToastState } from '@/components/Toast';
import ConfirmDialog, {
  type ConfirmDialogState,
} from '@/components/ConfirmDialog';
import ProcessoCard, {
  type ProcessoCardAction,
} from '@/components/recebedor/ProcessoCard';

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const DIAS_SEMANA: readonly DiaSemana[] = [
  'segunda',
  'terca',
  'quarta',
  'quinta',
  'sexta',
] as const;

const DIA_MS = 86_400_000;

const DIA_LABEL: Record<DiaSemana, string> = {
  segunda: 'Segunda-feira',
  terca: 'Terça-feira',
  quarta: 'Quarta-feira',
  quinta: 'Quinta-feira',
  sexta: 'Sexta-feira',
};

const DIA_LABEL_SHORT: Record<DiaSemana, string> = {
  segunda: 'Segunda',
  terca: 'Terça',
  quarta: 'Quarta',
  quinta: 'Quinta',
  sexta: 'Sexta',
};

const REGIMES: readonly ProcessoRegime[] = ['fechado', 'aberto'] as const;

const REGIME_LABEL: Record<ProcessoRegime, string> = {
  aberto: 'Regime aberto',
  fechado: 'Regime fechado',
};

const PROCESSOS_COMUNS_VISIVEIS_POR_VEZ = 3;

interface QuickChip {
  key: 'urgentes' | 'prioridades' | 'atrasados';
  label: string;
}

const QUICK_CHIPS: ReadonlyArray<QuickChip> = [
  { key: 'urgentes', label: 'Urgentes' },
  { key: 'prioridades', label: 'Prioridades' },
  { key: 'atrasados', label: 'Atrasados' },
];

type PeriodoMode = 'semana-atual' | 'proxima-semana' | 'mes-atual';

const PERIODO_OPTIONS: ReadonlyArray<{ key: PeriodoMode; label: string }> = [
  { key: 'semana-atual', label: 'Semana atual' },
  { key: 'proxima-semana', label: 'Próxima semana' },
  { key: 'mes-atual', label: 'Mês atual' },
];

function readErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Ocorreu um erro inesperado.';
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DIA_MS);
}

function getSegundaDaSemana(date: Date): Date {
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(date, diff);
}

function criarMapaProcessosPorDia(): Record<DiaSemana, Processo[]> {
  return {
    segunda: [],
    terca: [],
    quarta: [],
    quinta: [],
    sexta: [],
  };
}

function agruparOrdenarProcessosPorDia(
  list: Processo[],
  now: Date
): Record<DiaSemana, Processo[]> {
  const out = criarMapaProcessosPorDia();
  for (const p of list) {
    out[p.diaSemana].push(p);
  }
  for (const dia of DIAS_SEMANA) {
    out[dia] = ordenarProcessosDoDia(out[dia], now);
  }
  return out;
}

function ordenarFilaLiberacao(list: Processo[], now: Date): Processo[] {
  const ativos = list.filter(
    (p) => p.status === 'pendente' || p.status === 'em_andamento'
  );
  const fechados = ordenarProcessosDoDia(
    ativos.filter((p) => p.regime === 'fechado'),
    now
  );
  const abertos = ordenarProcessosDoDia(
    ativos.filter((p) => p.regime === 'aberto'),
    now
  );
  return [...fechados, ...abertos];
}

function isProcessoAFazer(p: Processo): boolean {
  return p.status === 'pendente' || p.status === 'em_andamento';
}

function isProcessoDestaqueLivre(p: Processo): boolean {
  return isProcessoAFazer(p) && isUrgenteOuPrioridade(p);
}

function getDiaSemanaAtual(date: Date): DiaSemana {
  switch (date.getDay()) {
    case 1:
      return 'segunda';
    case 2:
      return 'terca';
    case 3:
      return 'quarta';
    case 4:
      return 'quinta';
    case 5:
      return 'sexta';
    default:
      return 'segunda';
  }
}

interface StatusNoteDialogState {
  processo: Processo;
  novoStatus: ProcessoStatusOperacional;
  actionKey: ProcessoCardAction;
  title: string;
  confirmLabel: string;
  successMsg: string;
}

type ProcessoStatusOperacional = Extract<
  Processo['status'],
  'pendente' | 'em_andamento' | 'concluido'
>;

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function RecebedorDashboard() {
  usePageTitle('Meus Processos');
  const { firebaseUser, userDoc } = useAuth();
  const meUid = firebaseUser?.uid ?? null;
  const meNome =
    userDoc?.displayName ?? firebaseUser?.displayName ?? 'Usuário';

  // Refresh "now" once a minute so atraso/contagens stay current.
  const [now, setNow] = useState<Date>(() => nowInSp());
  useEffect(() => {
    const id = window.setInterval(() => setNow(nowInSp()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const semanaIso = useMemo(() => getSemanaIso(now), [now]);
  const proximaSemanaIso = useMemo(() => getSemanaIso(addDays(now, 7)), [now]);
  const inicioSemanaAtual = useMemo(() => getSegundaDaSemana(now), [now]);

  // Real-time data (item 6): em vez de um único listener de TODOS os processos
  // que o recebedor já recebeu na vida, usamos dois listeners limitados —
  // abertos (qualquer data, backlog naturalmente limitado) e a janela recente
  // (para concluídos do período). Antigos concluídos não são mais relidos aqui.
  const [processosAbertos, setProcessosAbertos] = useState<Processo[] | null>(
    null
  );
  const [processosRecentes, setProcessosRecentes] = useState<Processo[] | null>(
    null
  );
  const [processosError, setProcessosError] = useState<Error | null>(null);
  const [processosRetryKey, setProcessosRetryKey] = useState(0);
  // Janela recente: do 1º dia do mês atual menos 7 dias (cobre semana que cruza
  // o mês) até hoje. Cobre o que o Dashboard exibe em semana/próxima/mês.
  const desdeIso = useMemo(() => {
    const cutoff = new Date(now.getFullYear(), now.getMonth(), 1);
    cutoff.setDate(cutoff.getDate() - 7);
    return formatDateBr(cutoff, 'yyyy-MM-dd');
  }, [now]);
  const processos = useMemo<Processo[] | null>(() => {
    if (processosAbertos === null || processosRecentes === null) return null;
    const byId = new Map<string, Processo>();
    for (const p of processosAbertos) byId.set(p.id, p);
    for (const p of processosRecentes) byId.set(p.id, p);
    return Array.from(byId.values());
  }, [processosAbertos, processosRecentes]);
  const [notasMap, setNotasMap] = useState<Record<string, string>>({});

  // Aviso de RETORNO da coordenação (melhoria #14): espelho do alerta que o
  // distribuidor recebe quando um processo CHEGA na coordenação. Guardamos o
  // snapshot anterior de status (por id) dos abertos para detectar a transição
  // de `em_coordenacao`/`em_espera` de volta para o recebedor. O ref começa
  // `null` e é reposto a `null` toda vez que o listener de abertos re-semeia
  // (`processosAbertos === null`), garantindo a mesma guarda de inicialização do
  // distribuidor — nunca dispara no primeiro snapshot.
  const statusAbertosAnteriorRef = useRef<ReadonlyMap<
    string,
    ProcessoStatus
  > | null>(null);

  // Filters
  const [periodoMode, setPeriodoMode] =
    useState<PeriodoMode>('semana-atual');
  const [search, setSearch] = useState('');
  const [agrupadoresSelecionados, setAgrupadoresSelecionados] = useState<
    string[]
  >([]);
  const [mostrarConcluidos, setMostrarConcluidos] = useState(false);
  const [chipsAtivos, setChipsAtivos] = useState<Set<QuickChip['key']>>(
    () => new Set()
  );
  const [activeDia, setActiveDia] = useState<DiaSemana>(() =>
    getDiaSemanaAtual(nowInSp())
  );

  // UX
  const [toast, setToast] = useState<ToastState | null>(null);
  const [limiteEmAndamentoAlertOpen, setLimiteEmAndamentoAlertOpen] =
    useState(false);
  const [confirmDialog, setConfirmDialog] =
    useState<ConfirmDialogState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [pendingByProcesso, setPendingByProcesso] = useState<
    Record<string, ProcessoCardAction | null>
  >({});
  const [statusNoteDialog, setStatusNoteDialog] =
    useState<StatusNoteDialogState | null>(null);
  const [coordenacaoDialogProcesso, setCoordenacaoDialogProcesso] =
    useState<Processo | null>(null);

  // Subscriptions ---------------------------------------------------------
  useEffect(() => {
    if (!meUid) return;
    setProcessosAbertos(null);
    setProcessosError(null);
    const unsub = subscribeProcessosAbertosByRecebedor(
      meUid,
      (list) => setProcessosAbertos(list),
      (err) => setProcessosError(err)
    );
    return () => unsub();
  }, [meUid, processosRetryKey]);

  useEffect(() => {
    if (!meUid) return;
    setProcessosRecentes(null);
    const unsub = subscribeProcessosByRecebedorDesde(
      meUid,
      desdeIso,
      (list) => setProcessosRecentes(list),
      (err) => setProcessosError(err)
    );
    return () => unsub();
  }, [meUid, desdeIso, processosRetryKey]);

  // Detecção de RETORNO da coordenação (melhoria #14). Reaproveita a lista de
  // abertos já assinada (sem listener novo): a cada snapshot, compara o status
  // anterior por id e avisa os que voltaram da coordenação. O ramo `null`
  // (carga inicial e cada re-assinatura) só semeia o ref — não avisa.
  useEffect(() => {
    if (processosAbertos === null) {
      statusAbertosAnteriorRef.current = null;
      return;
    }
    const anterior = statusAbertosAnteriorRef.current;
    const proximo = snapshotStatusPorId(processosAbertos);
    if (anterior === null) {
      statusAbertosAnteriorRef.current = proximo;
      return;
    }
    const retornos = detectarRetornosDaCoordenacao(anterior, processosAbertos);
    statusAbertosAnteriorRef.current = proximo;
    if (retornos.length > 0) {
      setToast({
        kind: 'success',
        message: mensagemRetornoCoordenacao(retornos),
      });
    }
  }, [processosAbertos]);

  // Anotações pessoais (privadas) do usuário, mapeadas por processoId.
  useEffect(() => {
    if (!meUid) {
      setNotasMap({});
      return;
    }
    const unsub = subscribeProcessoNotas(meUid, (map) => setNotasMap(map));
    return () => unsub();
  }, [meUid]);

  // Auto-dismiss toast.
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(id);
  }, [toast]);

  // Derived ---------------------------------------------------------------

  const periodoSelecionadoLabel = useMemo(() => {
    switch (periodoMode) {
      case 'semana-atual':
        return `Semana atual: ${semanaIso}`;
      case 'proxima-semana':
        return `Próxima semana: ${proximaSemanaIso}`;
      case 'mes-atual':
        return `Mês atual: ${formatDateBr(now, 'MM/yyyy')}`;
    }
  }, [periodoMode, semanaIso, proximaSemanaIso, now]);

  const periodoContagemLabel = useMemo(() => {
    switch (periodoMode) {
      case 'semana-atual':
        return 'na semana atual';
      case 'proxima-semana':
        return 'na próxima semana';
      case 'mes-atual':
        return 'no mês atual';
    }
  }, [periodoMode]);

  const periodoMesAtual = useMemo(() => formatDateBr(now, 'yyyy-MM'), [now]);

  const processosVisiveis = useMemo(() => {
    return (processos ?? []).filter((p) => {
      if (p.status === 'em_coordenacao' || p.status === 'em_espera') {
        return false;
      }
      if (periodoMode === 'semana-atual') {
        return (
          p.semanaIso === semanaIso ||
          (p.status !== 'concluido' && isAtribuicaoLiberada(p, now))
        );
      }
      if (periodoMode === 'proxima-semana') {
        return p.semanaIso === proximaSemanaIso;
      }
      return (
        formatDateBr(p.diaAtribuicao.toDate(), 'yyyy-MM') === periodoMesAtual ||
        (p.status !== 'concluido' && isAtribuicaoLiberada(p, now))
      );
    });
  }, [
    processos,
    periodoMode,
    semanaIso,
    proximaSemanaIso,
    periodoMesAtual,
    now,
  ]);

  const liberacao = useMemo(() => {
    // Limite "N comuns por vez", mas SÓ para o trabalho de hoje/futuro:
    // - Pendentes de dias ANTERIORES ao atual (carried-over) ficam sempre
    //   liberados — trabalho que sobrou não pode sumir, e libera ao virar o dia.
    // - Urgentes/prioridades do dia ficam fora do teto (sempre visíveis).
    // - Os comuns do dia entram pelo teto: fechados primeiro e depois abertos,
    //   por ordem de distribuição (mais antigos primeiro), via ordenarFilaLiberacao.
    const ativos = processosVisiveis.filter(isProcessoAFazer);
    const anteriores = ativos.filter((p) => isPendenteDeDiaAnterior(p, now));
    const restante = ativos.filter((p) => !isPendenteDeDiaAnterior(p, now));
    const destaquesLivres = restante.filter(isProcessoDestaqueLivre);
    const comuns = ordenarFilaLiberacao(
      restante.filter((p) => !isProcessoDestaqueLivre(p)),
      now
    );
    const comunsLiberados = comuns.slice(0, PROCESSOS_COMUNS_VISIVEIS_POR_VEZ);
    const comunsBloqueados = comuns.slice(PROCESSOS_COMUNS_VISIVEIS_POR_VEZ);
    const liberados = [...anteriores, ...destaquesLivres, ...comunsLiberados];
    const bloqueados = comunsBloqueados;
    const liberadosIds = new Set(liberados.map((p) => p.id));
    const bloqueadosPorDia: Record<DiaSemana, number> = {
      segunda: 0,
      terca: 0,
      quarta: 0,
      quinta: 0,
      sexta: 0,
    };
    for (const p of bloqueados) {
      bloqueadosPorDia[p.diaSemana] += 1;
    }
    return {
      liberadosIds,
      totalLiberados: liberados.length,
      totalDestaquesLivres: destaquesLivres.length,
      totalBloqueados: bloqueados.length,
      bloqueadosPorDia,
    };
  }, [processosVisiveis, now]);

  const todosAgrupadores = useMemo(() => {
    const set = new Map<string, string>();
    for (const p of processosVisiveis) {
      if (!set.has(p.agrupadorId)) set.set(p.agrupadorId, p.agrupadorNome);
    }
    return Array.from(set, ([id, nome]) => ({ id, nome })).sort((a, b) =>
      a.nome.localeCompare(b.nome)
    );
  }, [processosVisiveis]);

  const counts = useMemo(() => {
    const list = processosVisiveis;
    let total = 0;
    let atrasados = 0;
    let urgentes = 0;
    let prioridades = 0;
    let concluidos = 0;
    for (const p of list) {
      total += 1;
      if (p.status === 'concluido') concluidos += 1;
      if (p.urgente && p.status !== 'concluido') urgentes += 1;
      if (p.prioridade && p.status !== 'concluido') prioridades += 1;
      if (isAtrasado(p, now)) atrasados += 1;
    }
    return { total, atrasados, urgentes, prioridades, concluidos };
  }, [processosVisiveis, now]);
  const totalEmAndamento = useMemo(
    () => contarProcessosEmAndamento(processos),
    [processos]
  );

  const notas = useMemo<NotasApi>(
    () => ({
      map: notasMap,
      salvar: async (p: Processo, texto: string) => {
        if (!meUid) return;
        await salvarProcessoNota(meUid, p.id, texto);
      },
      remover: async (p: Processo) => {
        if (!meUid) return;
        await removerProcessoNota(meUid, p.id);
      },
    }),
    [notasMap, meUid]
  );

  // Filtragem aplicada antes de agrupar por dia.
  const processosFiltrados = useMemo(() => {
    const list = processosVisiveis;
    const trimmedSearch = search.trim().toLowerCase();
    const agrSet =
      agrupadoresSelecionados.length > 0
        ? new Set(agrupadoresSelecionados)
        : null;
    return list.filter((p) => {
      if (
        p.status !== 'concluido' &&
        p.status !== 'nao_atribuido' &&
        !liberacao.liberadosIds.has(p.id)
      ) {
        return false;
      }
      if (!mostrarConcluidos && p.status === 'concluido') return false;
      if (
        trimmedSearch !== '' &&
        !p.numero.toLowerCase().includes(trimmedSearch)
      ) {
        return false;
      }
      if (agrSet && !agrSet.has(p.agrupadorId)) return false;
      if (chipsAtivos.has('urgentes') && !p.urgente) return false;
      if (chipsAtivos.has('prioridades') && !p.prioridade) return false;
      if (chipsAtivos.has('atrasados') && !isAtrasado(p, now)) return false;
      return true;
    });
  }, [
    processosVisiveis,
    liberacao,
    search,
    agrupadoresSelecionados,
    mostrarConcluidos,
    chipsAtivos,
    now,
  ]);

  const processosSeparados = useMemo(() => {
    const semanaAtual: Processo[] = [];
    const pendenciasAnteriores: Processo[] = [];

    for (const p of processosFiltrados) {
      if (
        periodoMode === 'semana-atual' &&
        isProcessoPendenteOuEmAndamentoDeSemanaAnterior(
          p,
          semanaIso,
          inicioSemanaAtual
        )
      ) {
        pendenciasAnteriores.push(p);
      } else {
        semanaAtual.push(p);
      }
    }

    return { semanaAtual, pendenciasAnteriores };
  }, [processosFiltrados, periodoMode, semanaIso, inicioSemanaAtual]);

  // Agrupa por dia da semana, já ordenado.
  const processosPorDia = useMemo(
    () => agruparOrdenarProcessosPorDia(processosSeparados.semanaAtual, now),
    [processosSeparados.semanaAtual, now]
  );

  const pendenciasAnterioresPorDia = useMemo(
    () =>
      agruparOrdenarProcessosPorDia(
        processosSeparados.pendenciasAnteriores,
        now
      ),
    [processosSeparados.pendenciasAnteriores, now]
  );

  const totalPendenciasAnteriores =
    processosSeparados.pendenciasAnteriores.length;

  const periodoBaseDate = useMemo(
    () => (periodoMode === 'proxima-semana' ? addDays(now, 7) : now),
    [periodoMode, now]
  );

  // Datas para os headers das colunas na semana selecionada.
  const datasPorDia = useMemo(() => {
    const segunda = getSegundaDaSemana(periodoBaseDate);
    const map: Record<DiaSemana, Date> = {
      segunda,
      terca: new Date(segunda.getTime() + 1 * DIA_MS),
      quarta: new Date(segunda.getTime() + 2 * DIA_MS),
      quinta: new Date(segunda.getTime() + 3 * DIA_MS),
      sexta: new Date(segunda.getTime() + 4 * DIA_MS),
    };
    return map;
  }, [periodoBaseDate]);

  const tabSubLabels = useMemo(() => {
    const out: Record<DiaSemana, string> = {
      segunda: '',
      terca: '',
      quarta: '',
      quinta: '',
      sexta: '',
    };
    if (periodoMode === 'mes-atual') {
      const mes = formatDateBr(now, 'MM/yyyy');
      for (const dia of DIAS_SEMANA) out[dia] = mes;
      return out;
    }
    for (const dia of DIAS_SEMANA) {
      out[dia] = formatDateBr(datasPorDia[dia], 'dd/MM');
    }
    return out;
  }, [periodoMode, datasPorDia, now]);

  const activeDiaSubtitle =
    periodoMode === 'mes-atual'
      ? `Mês ${formatDateBr(now, 'MM/yyyy')}`
      : formatDateBr(datasPorDia[activeDia], 'dd/MM/yyyy');

  const emptyTitle =
    periodoMode === 'semana-atual'
      ? 'Nenhum processo atribuído na semana atual'
      : periodoMode === 'proxima-semana'
        ? 'Nenhum processo atribuído na próxima semana'
        : 'Nenhum processo atribuído no mês atual';

  // Filtros ativos (para o "Limpar")?
  const filtrosAtivos =
    periodoMode !== 'semana-atual' ||
    search.trim() !== '' ||
    agrupadoresSelecionados.length > 0 ||
    mostrarConcluidos ||
    chipsAtivos.size > 0;

  // Handlers --------------------------------------------------------------

  function showSuccess(message: string) {
    setToast({ kind: 'success', message });
  }
  function showError(message: string) {
    if (message === LIMITE_EM_ANDAMENTO_RECEBEDOR_MESSAGE) {
      setLimiteEmAndamentoAlertOpen(true);
      return;
    }
    setToast({ kind: 'error', message });
  }

  function toggleChip(k: QuickChip['key']) {
    setChipsAtivos((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function clearFilters() {
    setPeriodoMode('semana-atual');
    setSearch('');
    setAgrupadoresSelecionados([]);
    setMostrarConcluidos(false);
    setChipsAtivos(new Set());
  }

  function toggleAgrupador(id: string) {
    setAgrupadoresSelecionados((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function applyStatus(
    p: Processo,
    novoStatus: ProcessoStatusOperacional,
    actionKey: ProcessoCardAction,
    successMsg: string,
    observacao?: string | null,
    options?: {
      devolvido?: boolean;
      dadosConclusao?: DadosConclusaoProcesso | null;
    }
  ) {
    if (!meUid) return;
    setPendingByProcesso((prev) => ({ ...prev, [p.id]: actionKey }));
    try {
      await updateProcessoStatus(
        p.id,
        novoStatus,
        meUid,
        meNome,
        observacao,
        options
      );
      // Concluir/reabrir muda o que o Histórico (memoizado) mostra; invalida o
      // cache para que a próxima visita reflita a mudança sem esperar o TTL.
      invalidateConcluidosRecebedorCache();
      showSuccess(successMsg);
    } catch (err) {
      const message = readErrorMessage(err);
      showError(
        message === LIMITE_EM_ANDAMENTO_RECEBEDOR_MESSAGE
          ? message
          : `Falha ao atualizar processo: ${message}`
      );
    } finally {
      setPendingByProcesso((prev) => ({ ...prev, [p.id]: null }));
    }
  }

  async function sendToCoordenacao(p: Processo, observacao?: string | null) {
    if (!meUid) return;
    setPendingByProcesso((prev) => ({
      ...prev,
      [p.id]: 'enviar_coordenacao',
    }));
    try {
      await enviarProcessoParaCoordenacao({
        processoId: p.id,
        byUid: meUid,
        byNome: meNome,
        byEmail: userDoc?.email ?? firebaseUser?.email ?? null,
        observacao,
      });
      showSuccess(`Processo ${p.numero} enviado para coordenação.`);
    } catch (err) {
      showError(`Falha ao enviar para coordenação: ${readErrorMessage(err)}`);
    } finally {
      setPendingByProcesso((prev) => ({ ...prev, [p.id]: null }));
    }
  }

  function handleCardAction(action: ProcessoCardAction, p: Processo) {
    if (action === 'iniciar') {
      if (
        p.status !== 'em_andamento' &&
        totalEmAndamento >= MAX_PROCESSOS_EM_ANDAMENTO_RECEBEDOR
      ) {
        showError(LIMITE_EM_ANDAMENTO_RECEBEDOR_MESSAGE);
        return;
      }
      void applyStatus(
        p,
        'em_andamento',
        'iniciar',
        `Processo ${p.numero} iniciado.`
      );
      return;
    }
    if (action === 'concluir') {
      setStatusNoteDialog({
        processo: p,
        novoStatus: 'concluido',
        actionKey: 'concluir',
        title: 'Concluir processo',
        confirmLabel: 'Concluir',
        successMsg: `Processo ${p.numero} concluído.`,
      });
      return;
    }
    if (action === 'enviar_coordenacao') {
      setCoordenacaoDialogProcesso(p);
      return;
    }
    if (action === 'reabrir') {
      if (
        p.status !== 'em_andamento' &&
        totalEmAndamento >= MAX_PROCESSOS_EM_ANDAMENTO_RECEBEDOR
      ) {
        showError(LIMITE_EM_ANDAMENTO_RECEBEDOR_MESSAGE);
        return;
      }
      // Confirm before reopening.
      setConfirmDialog({
        title: 'Reabrir processo?',
        message: `O processo ${p.numero} voltará para "Em andamento" e perderá a marca de conclusão atual.`,
        confirmLabel: 'Reabrir',
        onConfirm: async () => {
          setConfirmBusy(true);
          await applyStatus(
            p,
            'em_andamento',
            'reabrir',
            `Processo ${p.numero} reaberto.`
          );
          setConfirmBusy(false);
          setConfirmDialog(null);
        },
      });
    }
  }

  // ----- Render -----

  const carregando = processos === null;
  const totalSemFiltro = processosVisiveis.length;
  const totalComFiltro = processosFiltrados.length;

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink-primary">
            Olá, {meNome}
          </h1>
          <p className="mt-1 text-sm text-ink-secondary">
            Período selecionado:{' '}
            <span className="font-medium text-ink-primary">
              {periodoSelecionadoLabel}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <SummaryBadge
            label="Total"
            value={counts.total}
            tone="neutral"
            icon={<FileText className="h-3.5 w-3.5" />}
          />
          {/* Contagem GLOBAL (vinda de `processos`, nao do periodo filtrado):
              espelha o valor que trava Iniciar/Reabrir. */}
          <SummaryBadge
            label="Em andamento"
            value={totalEmAndamento}
            max={MAX_PROCESSOS_EM_ANDAMENTO_RECEBEDOR}
            tone={
              totalEmAndamento >= MAX_PROCESSOS_EM_ANDAMENTO_RECEBEDOR
                ? 'danger'
                : 'neutral'
            }
            icon={<Play className="h-3.5 w-3.5" />}
            title="Limite global de processos iniciados ao mesmo tempo"
          />
          <SummaryBadge
            label="Urgentes"
            value={counts.urgentes}
            tone={counts.urgentes > 0 ? 'urgent' : 'neutral'}
            icon={<Flame className="h-3.5 w-3.5" />}
          />
          <SummaryBadge
            label="Prioridades"
            value={counts.prioridades}
            tone={counts.prioridades > 0 ? 'urgent' : 'neutral'}
            icon={<Star className="h-3.5 w-3.5" />}
          />
          <SummaryBadge
            label="Atrasados"
            value={counts.atrasados}
            tone={counts.atrasados > 0 ? 'danger' : 'neutral'}
            icon={<AlertTriangle className="h-3.5 w-3.5" />}
          />
        </div>
      </header>

      <Toast toast={toast} onDismiss={() => setToast(null)} />

      {limiteEmAndamentoAlertOpen && (
        <LimiteEmAndamentoAlert
          onClose={() => setLimiteEmAndamentoAlertOpen(false)}
        />
      )}

      {/* Sticky filter bar */}
      <section className="sticky top-14 z-20 -mx-4 border-b border-gray-200 bg-surface-elevated/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div
              className="inline-flex shrink-0 rounded-md border border-gray-200 bg-surface p-0.5"
              role="group"
              aria-label="Período dos processos"
            >
              {PERIODO_OPTIONS.map((option) => {
                const active = periodoMode === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setPeriodoMode(option.key)}
                    className={`rounded px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                      active
                        ? 'bg-brand-primary text-white'
                        : 'text-ink-secondary hover:bg-gray-50 hover:text-ink-primary'
                    }`}
                    aria-pressed={active}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <div className="relative flex-1 min-w-[180px]">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por número..."
                className="w-full rounded-md border border-gray-300 bg-surface py-2 pl-8 pr-3 text-sm text-ink-primary focus:border-brand-primary focus:ring-1 focus:ring-brand-primary"
              />
            </div>
            <label className="inline-flex shrink-0 items-center gap-2 text-xs text-ink-secondary">
              <input
                type="checkbox"
                checked={mostrarConcluidos}
                onChange={(e) => setMostrarConcluidos(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-gray-300 accent-brand-primary"
              />
              <span>Mostrar concluídos</span>
            </label>
            {filtrosAtivos && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-200 bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-primary hover:bg-gray-50"
              >
                <Eraser className="h-3.5 w-3.5" />
                Limpar filtros
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {QUICK_CHIPS.map((chip) => {
              const active = chipsAtivos.has(chip.key);
              return (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => toggleChip(chip.key)}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                    active
                      ? 'border-brand-primary bg-brand-primary text-white'
                      : 'border-gray-300 bg-surface text-ink-primary hover:bg-gray-50'
                  }`}
                  aria-pressed={active}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>

          {todosAgrupadores.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wide text-ink-secondary">
                <Filter className="h-3 w-3" /> Origem
              </span>
              {todosAgrupadores.map((a) => {
                const active = agrupadoresSelecionados.includes(a.id);
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => toggleAgrupador(a.id)}
                    className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                      active
                        ? 'border-brand-primary bg-brand-primary-light text-brand-primary-dark'
                        : 'border-gray-300 bg-surface text-ink-primary hover:bg-gray-50'
                    }`}
                    aria-pressed={active}
                    title={a.nome}
                  >
                    {a.nome}
                  </button>
                );
              })}
            </div>
          )}

          <p className="text-[11px] text-ink-secondary">
            {filtrosAtivos
              ? `${totalComFiltro} de ${totalSemFiltro} processo${totalSemFiltro === 1 ? '' : 's'} (após filtros)`
              : `${totalSemFiltro} processo${totalSemFiltro === 1 ? '' : 's'} ${periodoContagemLabel}`}
            {liberacao.totalBloqueados > 0 &&
              ` · ${liberacao.totalLiberados} liberado${liberacao.totalLiberados === 1 ? '' : 's'} · ${liberacao.totalBloqueados} bloqueado${liberacao.totalBloqueados === 1 ? '' : 's'}`}
            {liberacao.totalDestaquesLivres > 0 &&
              ` · ${liberacao.totalDestaquesLivres} urgente/prioridade sem limite`}
            {totalPendenciasAnteriores > 0 &&
              ` · ${totalPendenciasAnteriores} pendência${totalPendenciasAnteriores === 1 ? '' : 's'} de semana${totalPendenciasAnteriores === 1 ? ' anterior' : 's anteriores'} em destaque`}
          </p>
        </div>
      </section>

      {/* Main panel (ordem: erro → carregando → vazio → conteúdo) */}
      {processosError ? (
        <ErrorState
          message="Falha ao carregar seus processos. Verifique sua conexão e tente novamente."
          onRetry={() => setProcessosRetryKey((k) => k + 1)}
        />
      ) : carregando ? (
        <div className="flex items-center justify-center rounded-lg border border-gray-200 bg-surface px-4 py-12 text-sm text-ink-secondary">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Carregando processos...
        </div>
      ) : totalSemFiltro === 0 ? (
        <EmptyState
          title={emptyTitle}
          message="Quando houver processos nesse período, eles aparecerão aqui organizados por dia."
        />
      ) : (
        <div className="space-y-4">
          {totalPendenciasAnteriores > 0 && (
            <PendenciasAnterioresPanel
              processosPorDia={pendenciasAnterioresPorDia}
              now={now}
              onCardAction={handleCardAction}
              pendingByProcesso={pendingByProcesso}
              notas={notas}
            />
          )}

          {totalPendenciasAnteriores > 0 && periodoMode === 'semana-atual' && (
            <div className="rounded-md border border-gray-200 bg-surface px-4 py-3">
              <h2 className="text-sm font-semibold text-ink-primary">
                Semana atual
              </h2>
              <p className="mt-0.5 text-xs text-ink-secondary">
                Os processos desta semana ficam abaixo, separados das
                pendências de semanas anteriores.
              </p>
            </div>
          )}

          <DiasSemanaPanel
            tabSubLabels={tabSubLabels}
            activeSubtitle={activeDiaSubtitle}
            processosPorDia={processosPorDia}
            activeDia={activeDia}
            onActiveDiaChange={setActiveDia}
            now={now}
            onCardAction={handleCardAction}
            pendingByProcesso={pendingByProcesso}
            bloqueadosPorDia={liberacao.bloqueadosPorDia}
            totalBloqueados={liberacao.totalBloqueados}
            notas={notas}
          />
        </div>
      )}

      {statusNoteDialog && (
        <StatusNoteDialog
          state={statusNoteDialog}
          busy={Boolean(pendingByProcesso[statusNoteDialog.processo.id])}
          onCancel={() => setStatusNoteDialog(null)}
          onConfirm={async (observacao, options) => {
            await applyStatus(
              statusNoteDialog.processo,
              statusNoteDialog.novoStatus,
              statusNoteDialog.actionKey,
              statusNoteDialog.successMsg,
              observacao,
              options
            );
            setStatusNoteDialog(null);
          }}
        />
      )}

      {coordenacaoDialogProcesso && (
        <CoordenacaoSendDialog
          processo={coordenacaoDialogProcesso}
          busy={Boolean(pendingByProcesso[coordenacaoDialogProcesso.id])}
          onCancel={() => setCoordenacaoDialogProcesso(null)}
          onConfirm={async (observacao) => {
            await sendToCoordenacao(coordenacaoDialogProcesso, observacao);
            setCoordenacaoDialogProcesso(null);
          }}
        />
      )}

      {confirmDialog && (
        <ConfirmDialog
          state={confirmDialog}
          busy={confirmBusy}
          onCancel={() => {
            if (!confirmBusy) setConfirmDialog(null);
          }}
          onConfirm={() => {
            void confirmDialog.onConfirm();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface SummaryBadgeProps {
  label: string;
  value: number;
  tone: 'neutral' | 'urgent' | 'danger';
  icon?: React.ReactNode;
  /** Quando definido, renderiza o valor como `value/max` (ex.: 3/4). */
  max?: number;
  title?: string;
}

function SummaryBadge({
  label,
  value,
  tone,
  icon,
  max,
  title,
}: SummaryBadgeProps) {
  const cls =
    tone === 'urgent'
      ? 'bg-brand-primary-light text-brand-primary-dark ring-1 ring-brand-primary/20'
      : tone === 'danger'
        ? 'bg-rose-50 text-state-danger ring-1 ring-rose-200'
        : 'bg-gray-100 text-ink-primary ring-1 ring-gray-200';
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}
    >
      {icon}
      {label}: {value}
      {max != null ? `/${max}` : ''}
    </span>
  );
}

function LimiteEmAndamentoAlert({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="limite-em-andamento-title"
      aria-describedby="limite-em-andamento-message"
    >
      <div className="w-full max-w-2xl overflow-hidden rounded-xl border-2 border-state-danger bg-surface shadow-2xl">
        <div className="flex items-start justify-between gap-4 bg-state-danger px-6 py-5 text-white">
          <div className="flex min-w-0 items-start gap-3">
            <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/30">
              <AlertTriangle className="h-7 w-7" />
            </span>
            <div>
              <h2
                id="limite-em-andamento-title"
                className="text-xl font-black uppercase tracking-wide"
              >
                Atenção
              </h2>
              <p className="mt-1 text-sm font-medium text-white/85">
                Limite de processos em andamento atingido.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-white hover:bg-white/15"
            aria-label="Fechar aviso"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="px-6 py-7 text-center">
          <p
            id="limite-em-andamento-message"
            className="text-2xl font-black leading-snug text-state-danger sm:text-3xl"
          >
            {LIMITE_EM_ANDAMENTO_RECEBEDOR_MESSAGE}
          </p>
          <p className="mx-auto mt-4 max-w-xl text-sm font-medium text-ink-secondary">
            Finalize as implantações que já foram iniciadas para liberar novos
            processos.
          </p>
        </div>

        <div className="flex justify-center border-t border-gray-200 bg-surface-elevated px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-[48px] min-w-[180px] items-center justify-center rounded-md bg-state-danger px-5 py-3 text-sm font-bold uppercase tracking-wide text-white hover:bg-red-700"
          >
            Entendi
          </button>
        </div>
      </div>
    </div>
  );
}

interface NotasApi {
  map: Record<string, string>;
  salvar: (p: Processo, texto: string) => Promise<void>;
  remover: (p: Processo) => Promise<void>;
}

interface PendenciasAnterioresPanelProps {
  processosPorDia: Record<DiaSemana, Processo[]>;
  now: Date;
  onCardAction: (action: ProcessoCardAction, p: Processo) => void;
  pendingByProcesso: Record<string, ProcessoCardAction | null>;
  notas: NotasApi;
}

function PendenciasAnterioresPanel({
  processosPorDia,
  now,
  onCardAction,
  pendingByProcesso,
  notas,
}: PendenciasAnterioresPanelProps) {
  const diasComPendencias = DIAS_SEMANA.filter(
    (dia) => processosPorDia[dia].length > 0
  );
  const total = diasComPendencias.reduce(
    (sum, dia) => sum + processosPorDia[dia].length,
    0
  );

  return (
    <section className="overflow-hidden rounded-lg border-2 border-state-danger bg-rose-50 shadow-sm ring-2 ring-state-danger/10">
      <header className="flex flex-col gap-3 bg-state-danger px-4 py-3 text-white sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white/15 ring-1 ring-white/25">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-base font-semibold">
              Pendências de semanas anteriores
            </h2>
            <p className="mt-1 max-w-4xl text-sm text-white/90">
              Estes processos ficaram pendentes ou em andamento de semanas
              anteriores. Eles aparecem separados da semana atual, nos dias
              originais de atribuição, e continuam liberados para trabalho.
            </p>
          </div>
        </div>
        <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-white px-3 py-1 text-xs font-bold text-state-danger">
          {total} processo{total === 1 ? '' : 's'}
        </span>
      </header>

      <div className="space-y-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-state-danger">
            Dias com pendência
          </span>
          {diasComPendencias.map((dia) => (
            <span
              key={dia}
              className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-bold text-state-danger ring-1 ring-rose-200"
            >
              {DIA_LABEL[dia]}
              <span className="rounded-full bg-state-danger px-1.5 py-0.5 text-[10px] text-white">
                {processosPorDia[dia].length}
              </span>
            </span>
          ))}
        </div>

        {diasComPendencias.map((dia) => (
          <section
            key={dia}
            className="rounded-md border border-rose-200 bg-white"
          >
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-rose-100 bg-rose-50 px-3 py-2">
              <div>
                <h3 className="text-sm font-semibold text-state-danger">
                  {DIA_LABEL[dia]}
                </h3>
                <p className="text-xs text-rose-900">
                  Dia original da atribuição anterior.
                </p>
              </div>
              <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-state-danger ring-1 ring-rose-200">
                {processosPorDia[dia].length} processo
                {processosPorDia[dia].length === 1 ? '' : 's'}
              </span>
            </header>
            <DiaProcessosContent
              list={processosPorDia[dia]}
              now={now}
              onCardAction={onCardAction}
              pendingByProcesso={pendingByProcesso}
              notas={notas}
              showBloqueioNotice={false}
              emptyMessage="Sem pendências neste dia."
            />
          </section>
        ))}
      </div>
    </section>
  );
}

interface DiasSemanaPanelProps {
  tabSubLabels: Record<DiaSemana, string>;
  activeSubtitle: string;
  processosPorDia: Record<DiaSemana, Processo[]>;
  activeDia: DiaSemana;
  onActiveDiaChange: (dia: DiaSemana) => void;
  now: Date;
  onCardAction: (action: ProcessoCardAction, p: Processo) => void;
  pendingByProcesso: Record<string, ProcessoCardAction | null>;
  bloqueadosPorDia: Record<DiaSemana, number>;
  totalBloqueados: number;
  notas: NotasApi;
}

function DiasSemanaPanel({
  tabSubLabels,
  activeSubtitle,
  processosPorDia,
  activeDia,
  onActiveDiaChange,
  now,
  onCardAction,
  pendingByProcesso,
  bloqueadosPorDia,
  totalBloqueados,
  notas,
}: DiasSemanaPanelProps) {
  const list = processosPorDia[activeDia];
  const hasUrgentOuAtrasado = list.some(
    (p) => p.urgente || p.prioridade || isAtrasado(p, now)
  );
  const bloqueadosNoDia = bloqueadosPorDia[activeDia] ?? 0;

  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const tabId = (dia: DiaSemana) => `dia-tab-${dia}`;
  const panelId = (dia: DiaSemana) => `dia-tabpanel-${dia}`;

  function focusAndActivate(index: number) {
    const wrapped = (index + DIAS_SEMANA.length) % DIAS_SEMANA.length;
    const dia = DIAS_SEMANA[wrapped];
    onActiveDiaChange(dia);
    // Defer focus so the new tabIndex=0 is applied before focusing.
    window.requestAnimationFrame(() => {
      tabRefs.current[wrapped]?.focus();
    });
  }

  function handleTabKeyDown(
    e: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number
  ) {
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        focusAndActivate(currentIndex - 1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        focusAndActivate(currentIndex + 1);
        break;
      case 'Home':
        e.preventDefault();
        focusAndActivate(0);
        break;
      case 'End':
        e.preventDefault();
        focusAndActivate(DIAS_SEMANA.length - 1);
        break;
      default:
        break;
    }
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-surface">
      <div
        className="flex gap-1 overflow-x-auto border-b border-gray-200 px-2 pt-2"
        role="tablist"
        aria-label="Dias da semana"
      >
        {DIAS_SEMANA.map((dia, idx) => {
          const diaList = processosPorDia[dia];
          const active = dia === activeDia;
          const destaque = diaList.some(
            (p) => p.urgente || p.prioridade || isAtrasado(p, now)
          );
          return (
            <button
              key={dia}
              type="button"
              role="tab"
              id={tabId(dia)}
              aria-selected={active}
              aria-controls={panelId(dia)}
              tabIndex={active ? 0 : -1}
              ref={(el) => {
                tabRefs.current[idx] = el;
              }}
              onClick={() => onActiveDiaChange(dia)}
              onKeyDown={(e) => handleTabKeyDown(e, idx)}
              className={`flex min-w-[150px] items-center justify-between gap-2 rounded-t-md border-b-2 px-3 py-2 text-left text-sm font-semibold transition-colors ${
                active
                  ? 'border-brand-primary bg-brand-primary-light text-brand-primary-dark'
                  : 'border-transparent text-ink-secondary hover:bg-gray-50 hover:text-ink-primary'
              }`}
            >
              <span className="flex flex-col leading-tight">
                <span>{DIA_LABEL_SHORT[dia]}-feira</span>
                <span className="text-[11px] font-normal">
                  {tabSubLabels[dia]}
                </span>
              </span>
              <span
                className={`inline-flex min-w-7 items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  destaque
                    ? 'bg-brand-primary text-white'
                    : 'bg-gray-100 text-ink-secondary'
                }`}
              >
                {diaList.length}
              </span>
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={panelId(activeDia)}
        aria-labelledby={tabId(activeDia)}
        tabIndex={0}
      >
        <header
          className={`flex items-center justify-between px-4 py-3 ${
            hasUrgentOuAtrasado
              ? 'bg-brand-primary text-white'
              : 'bg-brand-primary-light text-brand-primary-dark'
          }`}
        >
          <div>
            <h2 className="text-sm font-semibold">{DIA_LABEL[activeDia]}</h2>
            <p
              className={`text-xs ${
                hasUrgentOuAtrasado ? 'text-white/80' : 'text-brand-primary-dark/70'
              }`}
            >
              {activeSubtitle}
            </p>
          </div>
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
              hasUrgentOuAtrasado
                ? 'bg-white/20 text-white'
                : 'bg-white text-brand-primary-dark'
            }`}
          >
            {list.length} processo{list.length === 1 ? '' : 's'}
          </span>
        </header>

        <DiaProcessosContent
          list={list}
          now={now}
          onCardAction={onCardAction}
          pendingByProcesso={pendingByProcesso}
          notas={notas}
          bloqueadosNoDia={bloqueadosNoDia}
          totalBloqueados={totalBloqueados}
          emptyMessage="Sem processos atribuídos para este dia."
        />
      </div>
    </section>
  );
}

interface DiaProcessosContentProps {
  list: Processo[];
  now: Date;
  onCardAction: (action: ProcessoCardAction, p: Processo) => void;
  pendingByProcesso: Record<string, ProcessoCardAction | null>;
  notas: NotasApi;
  bloqueadosNoDia?: number;
  totalBloqueados?: number;
  showBloqueioNotice?: boolean;
  emptyMessage: string;
}

function DiaProcessosContent({
  list,
  now,
  onCardAction,
  pendingByProcesso,
  notas,
  bloqueadosNoDia = 0,
  totalBloqueados = 0,
  showBloqueioNotice = true,
  emptyMessage,
}: DiaProcessosContentProps) {
  const processosDestaque = useMemo(
    () => list.filter(isProcessoDestaqueLivre),
    [list]
  );
  const processosPorRegime = useMemo(() => {
    const grouped: Record<ProcessoRegime, Processo[]> = {
      fechado: [],
      aberto: [],
    };
    for (const processo of list) {
      if (isProcessoDestaqueLivre(processo)) continue;
      grouped[processo.regime].push(processo);
    }
    return grouped;
  }, [list]);

  return (
    <div className="space-y-4 p-3">
      {showBloqueioNotice && totalBloqueados > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {bloqueadosNoDia > 0
              ? `${bloqueadosNoDia} processo${bloqueadosNoDia === 1 ? '' : 's'} deste dia ${bloqueadosNoDia === 1 ? 'está bloqueado' : 'estão bloqueados'} sem exibir número.`
              : 'Há processos bloqueados em outros dias.'}{' '}
            O painel mostra no máximo {PROCESSOS_COMUNS_VISIVEIS_POR_VEZ}{' '}
            processos comuns por vez, priorizando os que já estavam em
            andamento ou sobraram de dias anteriores e depois regime fechado.
            Urgentes e prioridades ficam no espaço próprio e não consomem esse
            limite.
          </span>
        </div>
      )}

      {list.length === 0 ? (
        <p className="rounded border border-dashed border-gray-200 px-4 py-8 text-center text-sm italic text-ink-secondary">
          {emptyMessage}
        </p>
      ) : (
        <>
          {processosDestaque.length > 0 && (
            <section className="rounded-md border border-brand-primary/30 bg-brand-primary/5 p-3 ring-1 ring-brand-primary/10">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-brand-primary text-white">
                    <Flame className="h-4 w-4" />
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-ink-primary">
                      Urgentes e prioridades
                    </h3>
                    <p className="text-xs text-ink-secondary">
                      Sem limite de liberação e fora da contagem por regime.
                    </p>
                  </div>
                </div>
                <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-brand-primary ring-1 ring-brand-primary/25">
                  {processosDestaque.length} livre
                  {processosDestaque.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {processosDestaque.map((p) => (
                  <ProcessoCard
                    key={p.id}
                    processo={p}
                    now={now}
                    onAction={onCardAction}
                    pendingAction={pendingByProcesso[p.id] ?? null}
                    nota={notas.map[p.id] ?? null}
                    onSalvarNota={notas.salvar}
                    onRemoverNota={notas.remover}
                  />
                ))}
              </div>
            </section>
          )}

          {REGIMES.map((regime) => {
            const regimeList = processosPorRegime[regime];
            const totalAFazer = regimeList.filter(isProcessoAFazer).length;
            return (
              <section
                key={regime}
                className="rounded-md border border-gray-200 bg-surface-elevated p-3"
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-ink-primary">
                      {REGIME_LABEL[regime]}
                    </h3>
                    <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-ink-secondary ring-1 ring-gray-200">
                      {totalAFazer} a fazer
                    </span>
                  </div>
                  {regimeList.length !== totalAFazer && (
                    <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-ink-secondary ring-1 ring-gray-200">
                      {regimeList.length} no regime
                    </span>
                  )}
                </div>
                {regimeList.length === 0 ? (
                  <p className="rounded border border-dashed border-gray-200 bg-surface px-4 py-6 text-center text-sm italic text-ink-secondary">
                    Nenhum processo neste regime.
                  </p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {regimeList.map((p) => (
                      <ProcessoCard
                        key={p.id}
                        processo={p}
                        now={now}
                        onAction={onCardAction}
                        pendingAction={pendingByProcesso[p.id] ?? null}
                        nota={notas.map[p.id] ?? null}
                        onSalvarNota={notas.salvar}
                        onRemoverNota={notas.remover}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}

interface StatusNoteDialogProps {
  state: StatusNoteDialogState;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (
    observacao: string,
    options?: {
      devolvido?: boolean;
      dadosConclusao?: DadosConclusaoProcesso | null;
    }
  ) => void | Promise<void>;
}

interface CoordenacaoSendDialogProps {
  processo: Processo;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (observacao: string) => void | Promise<void>;
}

function CoordenacaoSendDialog({
  processo,
  busy,
  onCancel,
  onConfirm,
}: CoordenacaoSendDialogProps) {
  const [observacao, setObservacao] = useState('');
  const observacaoLimpa = observacao.trim();
  const observacaoObrigatoriaPendente = observacaoLimpa.length === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="coordenacao-send-title"
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
            id="coordenacao-send-title"
            className="text-lg font-semibold text-ink-primary"
          >
            Enviar para coordenação
          </h2>
          <p className="mt-1 text-sm text-ink-secondary">
            Processo{' '}
            <span className="font-mono font-semibold text-ink-primary">
              {processo.numero}
            </span>
          </p>
          <p className="mt-3 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-800">
            O processo sairá do painel de trabalho e ficará disponível na aba
            da coordenação até ser devolvido, concluído ou colocado em espera.
          </p>
          <label
            htmlFor="coordenacao-note"
            className="mt-4 block text-sm font-medium text-ink-primary"
          >
            Observação
            <span className="font-normal text-state-danger"> *</span>
          </label>
          <textarea
            id="coordenacao-note"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            rows={4}
            maxLength={1000}
            disabled={busy}
            placeholder="Registre o motivo do envio ou orientação para a coordenação..."
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-ink-primary focus:border-brand-primary focus:ring-1 focus:ring-brand-primary disabled:opacity-50"
            autoFocus
            required
          />
          {observacaoObrigatoriaPendente && (
            <p className="mt-1 text-xs font-medium text-state-danger">
              Informe a observação para enviar à coordenação.
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
            onClick={() => {
              void onConfirm(observacaoLimpa);
            }}
            disabled={busy || observacaoObrigatoriaPendente}
            className="rounded-md bg-brand-primary px-3 py-2 text-sm font-semibold text-white hover:bg-brand-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Enviando...' : 'Enviar para coordenação'}
          </button>
        </div>
      </div>
    </div>
  );
}

function FieldGroup({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}

function StatusNoteDialog({
  state,
  busy,
  onCancel,
  onConfirm,
}: StatusNoteDialogProps) {
  const [step, setStep] = useState<'confirmacao' | 'execucao'>('confirmacao');
  const [observacao, setObservacao] = useState('');
  const [devolvido, setDevolvido] = useState(false);
  const [guiaExecucaoNumero, setGuiaExecucaoNumero] = useState('');
  const [sentenciadoNome, setSentenciadoNome] = useState(
    getSentenciadoNomeProcesso(state.processo) ?? ''
  );
  const [tipoPena, setTipoPena] = useState<ConclusaoTipoPena | ''>('');
  const [regimeCondenacao, setRegimeCondenacao] = useState<
    ConclusaoRegimeCondenacao | ''
  >('');
  const [situacaoPrisao, setSituacaoPrisao] = useState<
    ConclusaoSituacaoPrisao | ''
  >('');
  const [atividade, setAtividade] = useState<ConclusaoAtividade | ''>('');
  const [execucaoPenalNumero, setExecucaoPenalNumero] = useState('');
  const [comarca, setComarca] = useState('');
  const [beneficiosPendentes, setBeneficiosPendentes] = useState<
    BeneficioPendenteConclusao[]
  >([]);
  const isConclusao = state.novoStatus === 'concluido';
  const observacaoLimpa = observacao.trim();
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

  function toggleBeneficio(beneficio: BeneficioPendenteConclusao) {
    setBeneficiosPendentes((prev) =>
      prev.includes(beneficio)
        ? prev.filter((item) => item !== beneficio)
        : [...prev, beneficio]
    );
  }

  function submitConclusion() {
    void onConfirm(
      observacaoLimpa,
      isConclusao ? { devolvido, dadosConclusao } : undefined
    );
  }

  const comarcasDatalistId = `comarcas-conclusao-${state.processo.id}`;
  const showDadosExecucao = exigeDadosExecucao && step === 'execucao';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="status-note-title"
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
            id="status-note-title"
            className="text-lg font-semibold text-ink-primary"
          >
            {showDadosExecucao ? 'Dados da execução penal' : state.title}
          </h2>
          <p className="mt-1 text-sm text-ink-secondary">
            Processo{' '}
            <span className="font-mono font-semibold text-ink-primary">
              {state.processo.numero}
            </span>
          </p>

          {showDadosExecucao ? (
            <div className="mt-4 space-y-4">
              <section className="overflow-hidden rounded-md border border-gray-200 bg-surface">
                <div className="bg-[#88461f] px-4 py-2 text-sm font-semibold text-white">
                  Dados da execução penal
                </div>
                <div className="px-4 py-4">
                  <label
                    htmlFor="execucao-penal-numero"
                    className="block text-sm font-medium text-ink-primary"
                  >
                    Nº da execução penal
                    <span className="text-state-danger"> *</span>
                  </label>
                  <p className="mt-1 text-xs text-ink-primary">
                    Insira o número da execução penal criada ou utilizada para
                    inserir e/ou implantar a guia de execução no formato do CNJ,
                    ou seja, com pontos e traços. Exemplo:
                    0000000-00.0000.0.00.0000
                  </p>
                  <input
                    id="execucao-penal-numero"
                    type="text"
                    value={execucaoPenalNumero}
                    onChange={(e) => setExecucaoPenalNumero(e.target.value)}
                    disabled={busy}
                    required
                    inputMode="text"
                    placeholder="Sua resposta"
                    className="mt-4 w-full max-w-sm border-0 border-b border-gray-300 bg-transparent px-0 py-2 text-sm text-ink-primary focus:border-brand-primary focus:ring-0 disabled:opacity-50"
                  />
                  {execucaoPenalInvalida && (
                    <p className="mt-1 text-xs font-medium text-state-danger">
                      Use o formato 0000000-00.0000.0.00.0000.
                    </p>
                  )}
                </div>
              </section>

              <FieldGroup>
                <label
                  htmlFor="comarca-conclusao"
                  className="block text-sm font-semibold text-ink-primary"
                >
                  Comarca
                  <span className="font-normal text-state-danger"> *</span>
                </label>
                <p className="mt-1 text-xs text-ink-secondary">
                  Insira a comarca onde o processo de execução penal tramita
                  atualmente.
                </p>
                <input
                  id="comarca-conclusao"
                  type="text"
                  list={comarcasDatalistId}
                  value={comarca}
                  onChange={(e) => setComarca(e.target.value)}
                  disabled={busy}
                  required
                  placeholder="Escolher"
                  className="mt-2 w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm text-ink-primary focus:border-brand-primary focus:ring-1 focus:ring-brand-primary disabled:opacity-50"
                />
                <datalist id={comarcasDatalistId}>
                  {[
                    'Belo Horizonte',
                    'Betim',
                    'Contagem',
                    'Governador Valadares',
                    'Ipatinga',
                    'Juiz de Fora',
                    'Montes Claros',
                    'Pouso Alegre',
                    'Ribeirão das Neves',
                    'Sete Lagoas',
                    'Uberaba',
                    'Uberlândia',
                    'Varginha',
                  ].map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
              </FieldGroup>

              <FieldGroup>
                <div className="text-sm font-semibold text-ink-primary">
                  Benefícios Pendentes
                </div>
                <p className="mt-1 text-xs font-medium uppercase text-ink-primary">
                  Marque uma ou mais opções abaixo caso o sistema aponte
                  benefício vencido. Apenas em caso de cadastrar uma nova ação!
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
          ) : (
            <>
              {isConclusao && (
                <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-md border border-gray-200 bg-surface-elevated px-3 py-2 text-sm text-ink-primary">
                  <input
                    type="checkbox"
                    checked={devolvido}
                    onChange={(e) => {
                      setDevolvido(e.target.checked);
                      if (e.target.checked) setStep('confirmacao');
                    }}
                    disabled={busy}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-brand-primary"
                  />
                  <span>
                    <span className="font-medium">Devolvido?</span>
                    <span className="block text-xs text-ink-secondary">
                      Marque quando a conclusão corresponde a devolução do
                      processo.
                    </span>
                  </span>
                </label>
              )}

              {isConclusao && (
                <section className="mt-4 rounded-md border border-gray-200 bg-surface-elevated px-4 py-3">
                  <h3 className="text-sm font-semibold text-ink-primary">
                    Dados da guia
                  </h3>
                  {devolvido && (
                    <p className="mt-1 text-xs text-ink-secondary">
                      Como devolvido está marcado, atividade e dados da execução
                      penal não serão exigidos. Os dados da guia continuam
                      obrigatórios.
                    </p>
                  )}
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <FieldGroup>
                      <label
                        htmlFor="guia-execucao-numero"
                        className="block text-sm font-medium text-ink-primary"
                      >
                        Nº da guia de execução
                        {exigeDadosGuia && (
                          <span className="text-state-danger"> *</span>
                        )}
                      </label>
                      <input
                        id="guia-execucao-numero"
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
                        htmlFor="sentenciado-nome"
                        className="block text-sm font-medium text-ink-primary"
                      >
                        Nome do sentenciado
                        {exigeDadosGuia && (
                          <span className="text-state-danger"> *</span>
                        )}
                      </label>
                      <input
                        id="sentenciado-nome"
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
                        htmlFor="tipo-pena"
                        className="block text-sm font-medium text-ink-primary"
                      >
                        Tipo de pena
                        {exigeDadosGuia && (
                          <span className="text-state-danger"> *</span>
                        )}
                      </label>
                      <select
                        id="tipo-pena"
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
                        htmlFor="regime-condenacao"
                        className="block text-sm font-medium text-ink-primary"
                      >
                        Regime da condenação
                        {exigeDadosGuia && (
                          <span className="text-state-danger"> *</span>
                        )}
                      </label>
                      <select
                        id="regime-condenacao"
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
                        htmlFor="situacao-prisao"
                        className="block text-sm font-medium text-ink-primary"
                      >
                        Situação de prisão
                        {exigeDadosGuia && (
                          <span className="text-state-danger"> *</span>
                        )}
                      </label>
                      <select
                        id="situacao-prisao"
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
                          htmlFor="atividade-conclusao"
                          className="block text-sm font-medium text-ink-primary"
                        >
                          Atividade
                          {exigeAtividade && (
                            <span className="text-state-danger"> *</span>
                          )}
                        </label>
                        <select
                          id="atividade-conclusao"
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
                      Preencha os dados obrigatórios da guia antes de avançar.
                    </p>
                  )}
                </section>
              )}

              <label
                htmlFor="status-note"
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
                id="status-note"
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                rows={4}
                maxLength={1000}
                disabled={busy}
                placeholder="Digite uma observação para registrar nesta mudança de status..."
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-ink-primary focus:border-brand-primary focus:ring-1 focus:ring-brand-primary disabled:opacity-50"
                autoFocus
              />
              {observacaoDevolucaoPendente && (
                <p className="mt-1 text-xs font-medium text-state-danger">
                  Informe a observação para concluir como devolvido.
                </p>
              )}
            </>
          )}
          {showDadosExecucao && dadosExecucaoPendente && !execucaoPenalInvalida && (
            <p className="mt-1 text-xs font-medium text-state-danger">
              Preencha os dados obrigatórios da execução penal.
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
          {showDadosExecucao && (
            <button
              type="button"
              onClick={() => setStep('confirmacao')}
              disabled={busy}
              className="rounded-md border border-gray-200 px-3 py-2 text-sm font-medium text-ink-primary hover:bg-gray-50 disabled:opacity-50"
            >
              Voltar
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (exigeDadosExecucao && step === 'confirmacao') {
                if (dadosBasicosPendente) return;
                setStep('execucao');
                return;
              }
              submitConclusion();
            }}
            disabled={
              busy ||
              (exigeDadosGuia &&
                step === 'confirmacao' &&
                dadosBasicosPendente) ||
              (step === 'confirmacao' && observacaoDevolucaoPendente) ||
              (showDadosExecucao && dadosExecucaoPendente)
            }
            className="rounded-md bg-brand-primary px-3 py-2 text-sm font-semibold text-white hover:bg-brand-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy
              ? 'Salvando...'
              : exigeDadosExecucao && step === 'confirmacao'
                ? 'PRÓXIMO'
                : state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
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
