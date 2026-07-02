import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  Database,
  Download,
  Filter,
  Flame,
  History,
  Loader2,
  Search,
  Trash2,
  Upload,
  UserPlus,
  X,
} from 'lucide-react';
import {
  atribuirProcessos,
  deleteProcessosByIds,
  getProcessosByNumeros,
  getProcessosPendentesEmAndamentoOuCoordenacao,
  subscribeProcessosNaoAtribuidos,
} from '@/services/firebase/processos';
import { subscribeAllUsers } from '@/services/firebase/users';
import { subscribeConfigSistema } from '@/services/firebase/sistema-config';
import { useAuth } from '@/store/authStore';
import {
  addDiasUteis,
  formatDateBr,
  nowInSp,
  parseIsoDateLocal,
} from '@/lib/datetime';
import {
  compareUrgentesFirst,
  compararPrioridadeFilaNaoAtribuidos,
  getResponsavelSeiLabel,
  getSentenciadoNomeProcesso,
  getStatusBadgeClass,
  getStatusLabel,
  getUltimoResponsavelNurge,
} from '@/lib/processo-helpers';
import { distribuirFilaComVinculo, type FilaBucketRoteamento } from '@/lib/distribuicao-fila';
import { usePageTitle } from '@/lib/usePageTitle';
import { useHistoricoSei } from '@/lib/useHistoricoSei';
import type { ConfigSistema, EventoNurge, Processo, User } from '@/types';
import Toast, { type ToastState } from '@/components/Toast';
import Modal from '@/components/Modal';
import { ErrorState } from '@/components/ErrorState';

type SortKey =
  | 'prioridadeOperacional'
  | 'primeiraEntradaNurgeEm'
  | 'primeiraDevolucaoOrigemEm'
  | 'ultimoRetornoNurgeEm';

type SortDir = 'asc' | 'desc';
type DiasUltimaAtribuicaoFiltro = '' | '15' | '30' | '45' | '60' | '75' | '90' | '100';
type RegimeFiltro = '' | Processo['regime'];

interface AtribuicaoPreviewItem {
  user: User;
  processoIds: string[];
  fechado: number;
  aberto: number;
  limiteTotal: number;
  porVinculo?: number;
}

interface PessoaLimiteConfig {
  usarLimitePadrao: boolean;
  fechado: string;
  aberto: string;
}

const REGIME_LABEL: Record<Processo['regime'], string> = {
  aberto: 'Aberto',
  fechado: 'Fechado',
};

const DEFAULT_PESSOA_LIMITE_CONFIG: PessoaLimiteConfig = {
  usarLimitePadrao: true,
  fechado: '',
  aberto: '',
};

const FILA_PAGE_SIZE = 100;

type ExportProcessoItem = {
  numero: string;
  status: Processo['status'];
  statusLabel: string;
  regime: Processo['regime'];
  origem: string;
  recebedorUid: string | null;
  recebedorNome: string | null;
  recebedorEmail: string | null;
};

const EVENTO_TIPO_LABEL: Record<string, string> = {
  entrada_nurge: 'Entrada no NURGE',
  devolucao_origem: 'Devolução à origem',
  atribuicao_nurge: 'Atribuição no NURGE',
  outro: 'Outro evento',
};

const DIAS_ULTIMA_ATRIBUICAO_OPTIONS: Array<{
  value: DiasUltimaAtribuicaoFiltro;
  label: string;
}> = [
  { value: '', label: 'Qualquer prazo' },
  { value: '15', label: '15+ dias' },
  { value: '30', label: '30+ dias' },
  { value: '45', label: '45+ dias' },
  { value: '60', label: '60+ dias' },
  { value: '75', label: '75+ dias' },
  { value: '90', label: '90+ dias' },
  { value: '100', label: '100+ dias' },
];

function readErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Ocorreu um erro inesperado.';
}

function todayIso(): string {
  return formatDateBr(nowInSp(), 'yyyy-MM-dd');
}

function usuarioPodeReceberProcessos(u: User): boolean {
  return (
    (u.role === 'recebedor' || u.role === 'distribuidor') &&
    u.approved &&
    u.ativo
  );
}

function roleLabel(role: User['role']): string {
  if (role === 'distribuidor') return 'Distribuidor';
  if (role === 'recebedor') return 'Recebedor';
  return 'Pendente';
}

function timestampLabel(value: Processo['primeiraEntradaNurgeEm']): string {
  if (!value) return '—';
  return formatDateBr(value.toDate(), 'dd/MM/yyyy HH:mm');
}

function timestampMillis(value: Processo['primeiraEntradaNurgeEm']): number | null {
  return value ? value.toMillis() : null;
}

function compareProcessosFila(
  a: Processo,
  b: Processo,
  sortKey: SortKey,
  sortDir: SortDir
): number {
  if (sortKey === 'prioridadeOperacional') {
    const cmp = compararPrioridadeFilaNaoAtribuidos(a, b);
    return sortDir === 'asc' ? cmp : -cmp;
  }

  const av = timestampMillis(a[sortKey]);
  const bv = timestampMillis(b[sortKey]);
  if (av === null && bv === null) return a.numero.localeCompare(b.numero);
  if (av === null) return 1;
  if (bv === null) return -1;
  const cmp = av - bv;
  return sortDir === 'asc' ? cmp : -cmp;
}

function pessoaLimiteConfig(
  limites: Record<string, PessoaLimiteConfig>,
  uid: string
): PessoaLimiteConfig {
  return {
    ...DEFAULT_PESSOA_LIMITE_CONFIG,
    ...limites[uid],
  };
}

function parseNonNegativeInt(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parsePositiveInt(value: string): number | null {
  const parsed = parseNonNegativeInt(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function buildAtribuicaoAutomaticaPreview({
  processosVisuais,
  pessoasSelecionadas,
  limitesPorPessoa,
  limitePadraoPessoa,
}: {
  processosVisuais: Processo[];
  pessoasSelecionadas: User[];
  limitesPorPessoa: Record<string, PessoaLimiteConfig>;
  limitePadraoPessoa: string;
}): AtribuicaoPreviewItem[] {
  const limitePadrao = parsePositiveInt(limitePadraoPessoa);
  if (limitePadrao === null) {
    throw new Error('Informe um limite total padrão maior que zero.');
  }
  if (pessoasSelecionadas.length === 0) {
    throw new Error('Selecione pelo menos uma pessoa para receber processos.');
  }

  const buckets: (FilaBucketRoteamento & { user: User; limiteTotal: number })[] =
    pessoasSelecionadas.map((user) => {
      const config = pessoaLimiteConfig(limitesPorPessoa, user.uid);
      if (config.usarLimitePadrao) {
        return {
          uid: user.uid,
          user,
          processoIds: [],
          fechado: 0,
          aberto: 0,
          porVinculo: 0,
          limiteTotal: limitePadrao,
          totalRestante: limitePadrao,
          fechadoRestante: limitePadrao,
          abertoRestante: limitePadrao,
        };
      }

      const limiteFechado = parseNonNegativeInt(config.fechado);
      const limiteAberto = parseNonNegativeInt(config.aberto);
      if (limiteFechado === null || limiteAberto === null) {
        throw new Error(
          `Informe limites válidos para ${user.displayName}: fechado e aberto precisam ser zero ou mais.`
        );
      }
      if (limiteFechado + limiteAberto <= 0) {
        throw new Error(
          `Informe pelo menos um processo para ${user.displayName}.`
        );
      }

      return {
        uid: user.uid,
        user,
        processoIds: [],
        fechado: 0,
        aberto: 0,
        porVinculo: 0,
        limiteTotal: limiteFechado + limiteAberto,
        totalRestante: limiteFechado + limiteAberto,
        fechadoRestante: limiteFechado,
        abertoRestante: limiteAberto,
      };
    });

  distribuirFilaComVinculo(processosVisuais, buckets);

  return buckets
    .filter((bucket) => bucket.processoIds.length > 0)
    .map((bucket) => ({
      user: bucket.user,
      processoIds: bucket.processoIds,
      fechado: bucket.fechado,
      aberto: bucket.aberto,
      limiteTotal: bucket.limiteTotal,
      porVinculo: bucket.porVinculo,
    }));
}

function buildAtribuicaoManualSelecionadosPreview({
  processosVisuais,
  selectedIds,
  pessoasSelecionadas,
}: {
  processosVisuais: Processo[];
  selectedIds: Set<string>;
  pessoasSelecionadas: User[];
}): AtribuicaoPreviewItem[] {
  if (pessoasSelecionadas.length === 0) {
    throw new Error('Selecione pelo menos uma pessoa para receber processos.');
  }

  const processosSelecionados = processosVisuais.filter((processo) =>
    selectedIds.has(processo.id)
  );
  if (processosSelecionados.length === 0) {
    throw new Error(
      'Selecione manualmente pelo menos um processo visível na tabela.'
    );
  }

  const buckets = pessoasSelecionadas.map((user) => ({
    user,
    processoIds: [] as string[],
    fechado: 0,
    aberto: 0,
  }));

  processosSelecionados.forEach((processo, index) => {
    const bucket = buckets[index % buckets.length];
    bucket.processoIds.push(processo.id);
    if (processo.regime === 'fechado') {
      bucket.fechado += 1;
    } else {
      bucket.aberto += 1;
    }
  });

  return buckets
    .filter((bucket) => bucket.processoIds.length > 0)
    .map((bucket) => ({
      user: bucket.user,
      processoIds: bucket.processoIds,
      fechado: bucket.fechado,
      aberto: bucket.aberto,
      limiteTotal: bucket.processoIds.length,
    }));
}

function buildExportProcessoItem(
  processo: Processo,
  usersByUid: Map<string, User>
): ExportProcessoItem {
  const recebedor = processo.recebedorUid
    ? usersByUid.get(processo.recebedorUid) ?? null
    : null;
  return {
    numero: processo.numero,
    status: processo.status,
    statusLabel: getStatusLabel(processo.status),
    regime: processo.regime,
    origem: processo.agrupadorNome || 'Sem origem',
    recebedorUid: processo.recebedorUid,
    recebedorNome: recebedor?.displayName ?? null,
    recebedorEmail: recebedor?.email ?? null,
  };
}

function eventoDateLabel(dataISO: string | null | undefined, dataHora?: string | null) {
  if (!dataISO) return dataHora ?? '—';
  const date = new Date(dataISO);
  if (Number.isNaN(date.getTime())) return dataHora ?? dataISO;
  return formatDateBr(date, 'dd/MM/yyyy HH:mm');
}

function eventoSortMillis(evento: EventoNurge): number | null {
  if (evento.dataISO) {
    const time = new Date(evento.dataISO).getTime();
    if (Number.isFinite(time)) return time;
  }

  const match = evento.dataHora?.match(
    /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?$/
  );
  if (!match) return null;
  const [, dd, mm, yyyy, hh = '0', min = '0'] = match;
  const fallback = new Date(
    Number(yyyy),
    Number(mm) - 1,
    Number(dd),
    Number(hh),
    Number(min)
  ).getTime();
  return Number.isFinite(fallback) ? fallback : null;
}

function getUltimaAtribuicaoNurgeMillis(processo: Processo): number | null {
  // Twin persistido (item 7): docs novos não trazem o histórico inline, então
  // o scan abaixo retornaria null. Preferimos o campo gravado na importação.
  if (processo.ultimaAtribuicaoNurgeEm) {
    return processo.ultimaAtribuicaoNurgeEm.toMillis();
  }
  // Fallback para docs legados com histórico inline.
  let last: number | null = null;
  for (const evento of processo.historicoSei ?? []) {
    if (evento.tipo !== 'atribuicao_nurge') continue;
    const millis = eventoSortMillis(evento);
    if (millis === null) continue;
    if (last === null || millis > last) last = millis;
  }
  return last;
}

function diasDesde(millis: number | null, now: Date): number | null {
  if (millis === null) return null;
  const start = new Date(millis);
  const end = new Date(now);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86_400_000));
}

function ultimaAtribuicaoLabel(processo: Processo, now: Date): string {
  const millis = getUltimaAtribuicaoNurgeMillis(processo);
  const dias = diasDesde(millis, now);
  if (millis === null || dias === null) return 'Sem data de atribuição';
  const data = formatDateBr(new Date(millis), 'dd/MM/yyyy');
  return `${dias} dia${dias === 1 ? '' : 's'} desde ${data}`;
}

function extractProcessoNumerosFromJson(data: unknown): string[] {
  const source =
    Array.isArray(data)
      ? data
      : data && typeof data === 'object' && Array.isArray((data as { numeros?: unknown }).numeros)
        ? (data as { numeros: unknown[] }).numeros
        : data && typeof data === 'object' && Array.isArray((data as { processos?: unknown }).processos)
          ? (data as { processos: unknown[] }).processos
          : data && typeof data === 'object' && Array.isArray((data as { processes?: unknown }).processes)
            ? (data as { processes: unknown[] }).processes
            : null;

  if (!source) {
    throw new Error('O JSON precisa ser uma lista de números de processos.');
  }

  const seen = new Set<string>();
  const numeros: string[] = [];
  for (const item of source) {
    const numero =
      typeof item === 'string'
        ? item.trim()
        : item &&
            typeof item === 'object' &&
            typeof (item as { numero?: unknown }).numero === 'string'
          ? (item as { numero: string }).numero.trim()
          : '';
    if (!numero || seen.has(numero)) continue;
    seen.add(numero);
    numeros.push(numero);
  }

  if (numeros.length === 0) {
    throw new Error('Nenhum número de processo foi encontrado no JSON.');
  }

  return numeros;
}

export default function NaoAtribuidos() {
  usePageTitle('Não atribuídos');
  const { firebaseUser, userDoc } = useAuth();
  const [now, setNow] = useState<Date>(() => nowInSp());
  useEffect(() => {
    const id = window.setInterval(() => setNow(nowInSp()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const meUid = firebaseUser?.uid ?? '';
  const meNome =
    userDoc?.displayName ?? firebaseUser?.displayName ?? 'Usuario';

  const [processos, setProcessos] = useState<Processo[] | null>(null);
  const [users, setUsers] = useState<User[] | null>(null);
  const [config, setConfig] = useState<ConfigSistema | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [loadRetryKey, setLoadRetryKey] = useState(0);
  const [search, setSearch] = useState('');
  const [origemFiltro, setOrigemFiltro] = useState('');
  const [regimeFiltro, setRegimeFiltro] = useState<RegimeFiltro>('');
  const [chegouOriginalFiltro, setChegouOriginalFiltro] = useState('');
  const [atribuidoAtualFiltro, setAtribuidoAtualFiltro] = useState('');
  const [diasUltimaAtribuicaoFiltro, setDiasUltimaAtribuicaoFiltro] =
    useState<DiasUltimaAtribuicaoFiltro>('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [pessoasAtribuicaoUids, setPessoasAtribuicaoUids] = useState<string[]>(
    []
  );
  const [limitePadraoPessoa, setLimitePadraoPessoa] = useState('5');
  const [limitesPorPessoa, setLimitesPorPessoa] = useState<
    Record<string, PessoaLimiteConfig>
  >({});
  const [atribuicaoPreview, setAtribuicaoPreview] = useState<
    AtribuicaoPreviewItem[]
  >([]);
  const [autoSelectedIds, setAutoSelectedIds] = useState<Set<string>>(
    () => new Set()
  );
  const [dataAtribuicaoIso, setDataAtribuicaoIso] = useState(todayIso);
  const [confirmAtribuicaoOpen, setConfirmAtribuicaoOpen] = useState(false);
  const [prazoDias, setPrazoDias] = useState(5);
  const [marcarAtribuicaoUrgente, setMarcarAtribuicaoUrgente] =
    useState(false);
  const [exportarAtribuidosAbertos, setExportarAtribuidosAbertos] =
    useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('prioridadeOperacional');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [filaPage, setFilaPage] = useState(1);
  const [historyProcesso, setHistoryProcesso] = useState<Processo | null>(null);
  const [importedFileName, setImportedFileName] = useState<string | null>(null);
  const [importedNumeros, setImportedNumeros] = useState<string[]>([]);
  const [importedProcessos, setImportedProcessos] = useState<Processo[]>([]);
  const [importedMissingNumeros, setImportedMissingNumeros] = useState<string[]>(
    []
  );
  const [selectedImportedIds, setSelectedImportedIds] = useState<Set<string>>(
    () => new Set()
  );
  const [importBusy, setImportBusy] = useState(false);
  const [deleteImportedBusy, setDeleteImportedBusy] = useState(false);
  const [deleteImportedConfirmOpen, setDeleteImportedConfirmOpen] =
    useState(false);

  useEffect(() => {
    setLoadError(null);
    const unsubP = subscribeProcessosNaoAtribuidos(setProcessos, (err) =>
      setLoadError(err)
    );
    const unsubU = subscribeAllUsers(setUsers, (err) => setLoadError(err));
    const unsubC = subscribeConfigSistema((next) => {
      setConfig(next);
      if (next) setPrazoDias(next.prazoPadraoDiasUteis);
    });
    return () => {
      unsubP();
      unsubU();
      unsubC();
    };
  }, [loadRetryKey]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    setFilaPage(1);
  }, [
    search,
    origemFiltro,
    regimeFiltro,
    chegouOriginalFiltro,
    atribuidoAtualFiltro,
    diasUltimaAtribuicaoFiltro,
    sortKey,
    sortDir,
  ]);

  const pessoasAtribuicao = useMemo(
    () => (users ?? []).filter(usuarioPodeReceberProcessos),
    [users]
  );

  const usersByUid = useMemo(() => {
    const map = new Map<string, User>();
    for (const user of users ?? []) {
      map.set(user.uid, user);
    }
    return map;
  }, [users]);

  const recebedoresAtribuicao = useMemo(
    () => pessoasAtribuicao.filter((u) => u.role === 'recebedor'),
    [pessoasAtribuicao]
  );

  const distribuidoresAtribuicao = useMemo(
    () => pessoasAtribuicao.filter((u) => u.role === 'distribuidor'),
    [pessoasAtribuicao]
  );

  const pessoasAtribuicaoOrdenadas = useMemo(
    () => [...recebedoresAtribuicao, ...distribuidoresAtribuicao],
    [distribuidoresAtribuicao, recebedoresAtribuicao]
  );

  const origens = useMemo(() => {
    const set = new Set<string>();
    for (const p of processos ?? []) {
      set.add(p.agrupadorNome || 'Origem nao identificada');
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [processos]);

  const responsaveisOriginais = useMemo(() => {
    const set = new Set<string>();
    for (const p of processos ?? []) {
      const label = getResponsavelSeiLabel(p.primeiroResponsavelNurge);
      if (label !== '—') set.add(label);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [processos]);

  const responsaveisAtuais = useMemo(() => {
    const set = new Set<string>();
    for (const p of processos ?? []) {
      const label = getResponsavelSeiLabel(getUltimoResponsavelNurge(p));
      if (label !== '—') set.add(label);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [processos]);

  const filtrados = useMemo(() => {
    const termo = search.trim().toLowerCase();
    const diasMinimos = diasUltimaAtribuicaoFiltro
      ? Number(diasUltimaAtribuicaoFiltro)
      : null;
    return (processos ?? []).filter((p) => {
      if (origemFiltro && p.agrupadorNome !== origemFiltro) return false;
      if (regimeFiltro && p.regime !== regimeFiltro) return false;
      const responsavelOriginal = getResponsavelSeiLabel(
        p.primeiroResponsavelNurge
      );
      const responsavelAtual = getResponsavelSeiLabel(getUltimoResponsavelNurge(p));
      if (chegouOriginalFiltro && responsavelOriginal !== chegouOriginalFiltro) {
        return false;
      }
      if (atribuidoAtualFiltro && responsavelAtual !== atribuidoAtualFiltro) {
        return false;
      }
      if (diasMinimos !== null) {
        const dias = diasDesde(getUltimaAtribuicaoNurgeMillis(p), now);
        if (dias === null || dias < diasMinimos) return false;
      }
      if (!termo) return true;
      return (
        p.numero.toLowerCase().includes(termo) ||
        p.agrupadorNome.toLowerCase().includes(termo) ||
        (p.observacao ?? '').toLowerCase().includes(termo) ||
        (p.tooltip ?? '').toLowerCase().includes(termo) ||
        (getSentenciadoNomeProcesso(p) ?? '').toLowerCase().includes(termo) ||
        (p.primeiroResponsavelNurge?.nome ?? '').toLowerCase().includes(termo) ||
        (p.primeiroResponsavelNurge?.login ?? '').toLowerCase().includes(termo) ||
        getResponsavelSeiLabel(getUltimoResponsavelNurge(p))
          .toLowerCase()
          .includes(termo)
      );
    });
  }, [
    processos,
    search,
    origemFiltro,
    regimeFiltro,
    chegouOriginalFiltro,
    atribuidoAtualFiltro,
    diasUltimaAtribuicaoFiltro,
    now,
  ]);

  const filaEmEstadoPadrao = useMemo(
    () =>
      search.trim() === '' &&
      !origemFiltro &&
      !regimeFiltro &&
      !chegouOriginalFiltro &&
      !atribuidoAtualFiltro &&
      !diasUltimaAtribuicaoFiltro &&
      sortKey === 'prioridadeOperacional' &&
      sortDir === 'asc',
    [
      search,
      origemFiltro,
      regimeFiltro,
      chegouOriginalFiltro,
      atribuidoAtualFiltro,
      diasUltimaAtribuicaoFiltro,
      sortKey,
      sortDir,
    ]
  );

  const sortedFiltrados = useMemo(() => {
    const list = filtrados.slice();
    list.sort((a, b) => {
      if (filaEmEstadoPadrao) {
        const urgenteCmp = compareUrgentesFirst(a, b);
        if (urgenteCmp !== 0) return urgenteCmp;
      }
      return compareProcessosFila(a, b, sortKey, sortDir);
    });
    return list;
  }, [filaEmEstadoPadrao, filtrados, sortDir, sortKey]);

  const totalFilaPages = Math.max(
    1,
    Math.ceil(sortedFiltrados.length / FILA_PAGE_SIZE)
  );
  const paginaFilaAtual = Math.min(filaPage, totalFilaPages);
  const filaPageStartIndex = (paginaFilaAtual - 1) * FILA_PAGE_SIZE;
  const filaPageEndIndex = Math.min(
    filaPageStartIndex + FILA_PAGE_SIZE,
    sortedFiltrados.length
  );
  const processosPaginaFila = useMemo(
    () => sortedFiltrados.slice(filaPageStartIndex, filaPageEndIndex),
    [filaPageEndIndex, filaPageStartIndex, sortedFiltrados]
  );

  useEffect(() => {
    setFilaPage((current) => Math.min(current, totalFilaPages));
  }, [totalFilaPages]);

  const pessoasSelecionadas = useMemo(() => {
    const selected = new Set(pessoasAtribuicaoUids);
    return pessoasAtribuicaoOrdenadas.filter((u) => selected.has(u.uid));
  }, [pessoasAtribuicaoOrdenadas, pessoasAtribuicaoUids]);

  const todosRecebedoresAtribuicaoSelecionados =
    recebedoresAtribuicao.length > 0 &&
    recebedoresAtribuicao.every((u) => pessoasAtribuicaoUids.includes(u.uid));

  const atribuicaoPreviewTotal = useMemo(
    () =>
      atribuicaoPreview.reduce(
        (acc, item) => {
          acc.total += item.processoIds.length;
          acc.fechado += item.fechado;
          acc.aberto += item.aberto;
          return acc;
        },
        { total: 0, fechado: 0, aberto: 0 }
      ),
    [atribuicaoPreview]
  );

  const selectedCount = selectedIds.size;
  const allFilteredSelected =
    sortedFiltrados.length > 0 &&
    sortedFiltrados.every((p) => selectedIds.has(p.id));
  const selectedImportedCount = selectedImportedIds.size;
  const allImportedSelected =
    importedProcessos.length > 0 &&
    importedProcessos.every((p) => selectedImportedIds.has(p.id));

  useEffect(() => {
    if (!processos) return;
    const validIds = new Set(processos.map((p) => p.id));
    setSelectedIds((prev) => {
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
    const validUids = new Set(pessoasAtribuicao.map((u) => u.uid));
    setPessoasAtribuicaoUids((prev) => {
      const next = prev.filter((uid) => validUids.has(uid));
      return next.length === prev.length ? prev : next;
    });
  }, [pessoasAtribuicao]);

  useEffect(() => {
    const validIds = new Set(importedProcessos.map((p) => p.id));
    setSelectedImportedIds((prev) => {
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
  }, [importedProcessos]);

  useEffect(() => {
    setAtribuicaoPreview([]);
    setAutoSelectedIds(new Set());
  }, [
    sortedFiltrados,
    pessoasAtribuicaoUids,
    limitePadraoPessoa,
    limitesPorPessoa,
  ]);

  function updateLimitePessoa(
    uid: string,
    patch: Partial<PessoaLimiteConfig>
  ) {
    setLimitesPorPessoa((prev) => ({
      ...prev,
      [uid]: {
        ...DEFAULT_PESSOA_LIMITE_CONFIG,
        ...prev[uid],
        ...patch,
      },
    }));
  }

  function gerarDistribuicaoAutomatica() {
    try {
      const preview = buildAtribuicaoAutomaticaPreview({
        processosVisuais: sortedFiltrados,
        pessoasSelecionadas,
        limitesPorPessoa,
        limitePadraoPessoa,
      });
      if (preview.length === 0) {
        setError('Nenhum processo disponível para os limites informados.');
        setAtribuicaoPreview([]);
        setAutoSelectedIds(new Set());
        return;
      }

      const selecionados = new Set(preview.flatMap((item) => item.processoIds));
      setSelectedIds(selecionados);
      setAutoSelectedIds(selecionados);
      setAtribuicaoPreview(preview);
      setError(null);

      const total = preview.reduce((sum, item) => sum + item.processoIds.length, 0);
      setToast({
        kind: 'success',
        message: `${total} processo${total === 1 ? '' : 's'} selecionado${total === 1 ? '' : 's'} para a prévia da distribuição.`,
      });
    } catch (err) {
      setError(readErrorMessage(err));
      setAtribuicaoPreview([]);
      setAutoSelectedIds(new Set());
    }
  }

  function gerarDistribuicaoManualSelecionados() {
    try {
      const preview = buildAtribuicaoManualSelecionadosPreview({
        processosVisuais: sortedFiltrados,
        selectedIds,
        pessoasSelecionadas,
      });
      setAutoSelectedIds(new Set());
      setAtribuicaoPreview(preview);
      setError(null);

      const total = preview.reduce((sum, item) => sum + item.processoIds.length, 0);
      setToast({
        kind: 'success',
        message: `${total} processo${total === 1 ? '' : 's'} manualmente selecionado${total === 1 ? '' : 's'} dividido${total === 1 ? '' : 's'} entre ${preview.length} pessoa${preview.length === 1 ? '' : 's'}, sem aplicar limites.`,
      });
    } catch (err) {
      setError(readErrorMessage(err));
      setAtribuicaoPreview([]);
      setAutoSelectedIds(new Set());
    }
  }

  function toggleProcesso(id: string) {
    setAtribuicaoPreview([]);
    setAutoSelectedIds(new Set());
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleFiltered() {
    setAtribuicaoPreview([]);
    setAutoSelectedIds(new Set());
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        sortedFiltrados.forEach((p) => next.delete(p.id));
      } else {
        sortedFiltrados.forEach((p) => next.add(p.id));
      }
      return next;
    });
  }

  function togglePessoaAtribuicao(uid: string) {
    setPessoasAtribuicaoUids((prev) =>
      prev.includes(uid) ? prev.filter((item) => item !== uid) : [...prev, uid]
    );
  }

  function toggleTodosRecebedoresAtribuicao() {
    const recebedorUids = recebedoresAtribuicao.map((u) => u.uid);
    if (recebedorUids.length === 0) return;

    setPessoasAtribuicaoUids((prev) => {
      const todosSelecionados = recebedorUids.every((uid) =>
        prev.includes(uid)
      );
      if (todosSelecionados) {
        const recebedoresSet = new Set(recebedorUids);
        return prev.filter((uid) => !recebedoresSet.has(uid));
      }

      const next = new Set(prev);
      recebedorUids.forEach((uid) => next.add(uid));
      return Array.from(next);
    });
  }

  function limparProcessosSelecionados() {
    setSelectedIds(new Set());
    setAutoSelectedIds(new Set());
    setAtribuicaoPreview([]);
    setError(null);
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  async function copyNumero(processo: Processo) {
    try {
      await navigator.clipboard.writeText(processo.numero);
      setCopiedId(processo.id);
      setToast({
        kind: 'success',
        message: `Número ${processo.numero} copiado.`,
      });
      window.setTimeout(() => setCopiedId(null), 1400);
    } catch {
      setToast({
        kind: 'error',
        message: 'Não foi possível copiar o número do processo.',
      });
    }
  }

  async function exportProcessosJson() {
    const fila = sortedFiltrados;
    const numeros = fila.map((processo) => processo.numero);
    if (numeros.length === 0) {
      setToast({
        kind: 'error',
        message: 'Não há processos na fila atual para exportar.',
      });
      return;
    }

    setExportBusy(true);
    setError(null);
    try {
      let payload: unknown = numeros;
      let totalExportado = numeros.length;
      let totalAtribuidosAbertos = 0;
      let totalPendentesEmAndamento = 0;
      let totalEmCoordenacao = 0;

      if (exportarAtribuidosAbertos) {
        const atribuidosAbertos =
          await getProcessosPendentesEmAndamentoOuCoordenacao();
        totalAtribuidosAbertos = atribuidosAbertos.length;
        totalPendentesEmAndamento = atribuidosAbertos.filter(
          (processo) =>
            processo.status === 'pendente' ||
            processo.status === 'em_andamento'
        ).length;
        totalEmCoordenacao = atribuidosAbertos.filter(
          (processo) => processo.status === 'em_coordenacao'
        ).length;
        totalExportado = fila.length + atribuidosAbertos.length;
        payload = {
          schema: 'sig-nurge-fila-export-v2',
          exportedAt: new Date().toISOString(),
          includePendentesEmAndamento: true,
          includeCoordenacao: true,
          summary: {
            total: totalExportado,
            fila: fila.length,
            pendentesEmAndamento: totalPendentesEmAndamento,
            emCoordenacao: totalEmCoordenacao,
            foraDaFila: totalAtribuidosAbertos,
          },
          processes: [
            ...fila.map((processo) =>
              buildExportProcessoItem(processo, usersByUid)
            ),
            ...atribuidosAbertos.map((processo) =>
              buildExportProcessoItem(processo, usersByUid)
            ),
          ],
        };
      }

      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `fila-processos-${formatDateBr(nowInSp(), 'yyyy-MM-dd')}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setToast({
        kind: 'success',
        message: exportarAtribuidosAbertos
          ? `${totalExportado} processo${totalExportado === 1 ? '' : 's'} exportado${totalExportado === 1 ? '' : 's'} em JSON, incluindo ${totalAtribuidosAbertos} pendente${totalAtribuidosAbertos === 1 ? '' : 's'}/em andamento/coordenação.`
          : `${numeros.length} número${numeros.length === 1 ? '' : 's'} exportado${numeros.length === 1 ? '' : 's'} em JSON.`,
      });
    } catch (err) {
      setError(`Falha ao exportar processos: ${readErrorMessage(err)}`);
    } finally {
      setExportBusy(false);
    }
  }

  function toggleImportedProcesso(id: string) {
    setSelectedImportedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllImported() {
    setSelectedImportedIds((prev) => {
      if (allImportedSelected) return new Set();
      const next = new Set(prev);
      importedProcessos.forEach((p) => next.add(p.id));
      return next;
    });
  }

  function clearImportedJson() {
    setImportedFileName(null);
    setImportedNumeros([]);
    setImportedProcessos([]);
    setImportedMissingNumeros([]);
    setSelectedImportedIds(new Set());
  }

  async function handleImportJsonFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setImportBusy(true);
    setError(null);
    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error('Não foi possível ler o JSON selecionado.');
      }
      const numeros = extractProcessoNumerosFromJson(parsed);
      const encontrados = await getProcessosByNumeros(numeros);
      const byNumero = new Map<string, Processo[]>();
      for (const processo of encontrados) {
        const list = byNumero.get(processo.numero) ?? [];
        list.push(processo);
        byNumero.set(processo.numero, list);
      }

      const ordered: Processo[] = [];
      const seenIds = new Set<string>();
      const missing: string[] = [];
      for (const numero of numeros) {
        const matches = byNumero.get(numero) ?? [];
        if (matches.length === 0) {
          missing.push(numero);
          continue;
        }
        for (const processo of matches) {
          if (seenIds.has(processo.id)) continue;
          seenIds.add(processo.id);
          ordered.push(processo);
        }
      }

      setImportedFileName(file.name);
      setImportedNumeros(numeros);
      setImportedProcessos(ordered);
      setImportedMissingNumeros(missing);
      setSelectedImportedIds(new Set());
      setToast({
        kind: 'success',
        message: `${ordered.length} processo${ordered.length === 1 ? '' : 's'} encontrado${ordered.length === 1 ? '' : 's'} no JSON.`,
      });
    } catch (err) {
      clearImportedJson();
      setError(readErrorMessage(err));
    } finally {
      setImportBusy(false);
    }
  }

  async function handleDeleteImportadosSelecionados() {
    if (!meUid) {
      setError('Usuario autenticado nao identificado.');
      return;
    }
    if (selectedImportedIds.size === 0) {
      setError('Selecione pelo menos um processo importado para apagar.');
      return;
    }

    setDeleteImportedBusy(true);
    setError(null);
    try {
      const ids = importedProcessos
        .filter((p) => selectedImportedIds.has(p.id))
        .map((p) => p.id);
      const idsSet = new Set(ids);
      await deleteProcessosByIds(ids, meUid, meNome);
      setImportedProcessos((prev) => prev.filter((p) => !idsSet.has(p.id)));
      setSelectedImportedIds(new Set());
      if (historyProcesso && idsSet.has(historyProcesso.id)) {
        setHistoryProcesso(null);
      }
      setDeleteImportedConfirmOpen(false);
      setToast({
        kind: 'success',
        message: `${ids.length} processo${ids.length === 1 ? '' : 's'} importado${ids.length === 1 ? '' : 's'} apagado${ids.length === 1 ? '' : 's'}.`,
      });
    } catch (err) {
      setError(readErrorMessage(err));
    } finally {
      setDeleteImportedBusy(false);
    }
  }

  async function handleAtribuir(): Promise<boolean> {
    if (!meUid) {
      setError('Usuario autenticado nao identificado.');
      return false;
    }
    if (pessoasSelecionadas.length === 0) {
      setError('Escolha pelo menos uma pessoa ativa.');
      return false;
    }
    if (selectedIds.size === 0) {
      setError('Selecione pelo menos um processo.');
      return false;
    }
    if (atribuicaoPreview.length === 0) {
      setError('Gere a prévia da distribuição antes de confirmar.');
      return false;
    }
    if (!dataAtribuicaoIso) {
      setError('Informe a data de atribuição.');
      return false;
    }

    setBusy(true);
    setError(null);
    try {
      const dataAtribuicao = parseIsoDateLocal(dataAtribuicaoIso);
      const prazoFinal = addDiasUteis(
        dataAtribuicao,
        Math.max(0, prazoDias),
        config?.feriadosNacionais ?? []
      );
      const atribuicoes = atribuicaoPreview.filter(
        (item) => item.processoIds.length > 0
      );
      for (const item of atribuicoes) {
        await atribuirProcessos({
          processoIds: item.processoIds,
          recebedor: item.user,
          diaAtribuicao: dataAtribuicao,
          prazoFinal,
          marcarUrgente: marcarAtribuicaoUrgente,
          byUid: meUid,
          byNome: meNome,
        });
      }
      const totalAtribuido = atribuicoes.reduce(
        (sum, item) => sum + item.processoIds.length,
        0
      );
      setToast({
        kind: 'success',
        message: `${totalAtribuido} processo${totalAtribuido === 1 ? '' : 's'} atribuido${totalAtribuido === 1 ? '' : 's'} para ${atribuicoes.length} pessoa${atribuicoes.length === 1 ? '' : 's'}${marcarAtribuicaoUrgente ? ' e marcado como urgente' : ''}.`,
      });
      setSelectedIds(new Set());
      setAutoSelectedIds(new Set());
      setAtribuicaoPreview([]);
      return true;
    } catch (err) {
      setError(readErrorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteSelecionados() {
    if (!meUid) {
      setError('Usuario autenticado nao identificado.');
      return;
    }
    if (selectedIds.size === 0) {
      setError('Selecione pelo menos um processo para apagar.');
      return;
    }

    setDeleteBusy(true);
    setError(null);
    try {
      const total = selectedIds.size;
      await deleteProcessosByIds(Array.from(selectedIds), meUid, meNome);
      setSelectedIds(new Set());
      setDeleteConfirmOpen(false);
      setToast({
        kind: 'success',
        message: `${total} processo${total === 1 ? '' : 's'} apagado${total === 1 ? '' : 's'} completamente.`,
      });
    } catch (err) {
      setError(readErrorMessage(err));
    } finally {
      setDeleteBusy(false);
    }
  }

  const isLoading = processos === null || users === null;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink-primary">
            Processos não atribuídos
          </h1>
          <p className="text-sm text-ink-secondary">
            Estoque importado do SEI para distribuicao posterior, com datas de
            entrada, devolucao e retorno ao NURGE.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-surface px-3 py-2 text-sm font-semibold text-ink-primary">
            <Database className="h-4 w-4 text-brand-primary" />
            {processos?.length ?? 0} na fila
          </div>
          <div className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-surface px-3 py-2 text-sm font-semibold text-ink-primary">
            <Filter className="h-4 w-4 text-brand-primary" />
            {isLoading ? (
              'Carregando lista'
            ) : (
              <>
                {sortedFiltrados.length} processo
                {sortedFiltrados.length === 1 ? '' : 's'} na lista
                {(processos?.length ?? 0) !== sortedFiltrados.length && (
                  <span className="font-medium text-ink-secondary">
                    de {processos?.length ?? 0}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <section className="rounded-lg border border-gray-200 bg-surface">
          <div className="flex flex-col gap-3 border-b border-gray-200 p-4">
            <div className="grid gap-2 xl:grid-cols-[minmax(240px,1.25fr)_minmax(170px,0.75fr)_minmax(150px,0.65fr)_minmax(180px,0.8fr)_minmax(180px,0.8fr)_minmax(150px,0.65fr)] xl:items-center">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-secondary" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por número, sentenciado, origem ou responsável"
                  className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm"
                />
              </div>
              <select
                value={origemFiltro}
                onChange={(e) => setOrigemFiltro(e.target.value)}
                className="max-w-[260px] rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Todas as origens</option>
                {origens.map((origem) => (
                  <option key={origem} value={origem}>
                    {origem}
                  </option>
                ))}
              </select>
              <select
                value={regimeFiltro}
                onChange={(e) => setRegimeFiltro(e.target.value as RegimeFiltro)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                title="Regime"
              >
                <option value="">Todos os regimes</option>
                <option value="fechado">Regime fechado</option>
                <option value="aberto">Regime aberto</option>
              </select>
              <select
                value={chegouOriginalFiltro}
                onChange={(e) => setChegouOriginalFiltro(e.target.value)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                title="Chegou originalmente para"
              >
                <option value="">Chegou original: todos</option>
                {responsaveisOriginais.map((nome) => (
                  <option key={nome} value={nome}>
                    {nome}
                  </option>
                ))}
              </select>
              <select
                value={atribuidoAtualFiltro}
                onChange={(e) => setAtribuidoAtualFiltro(e.target.value)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                title="Atribuído atualmente no histórico SEI"
              >
                <option value="">Atribuído atual: todos</option>
                {responsaveisAtuais.map((nome) => (
                  <option key={nome} value={nome}>
                    {nome}
                  </option>
                ))}
              </select>
              <select
                value={diasUltimaAtribuicaoFiltro}
                onChange={(e) =>
                  setDiasUltimaAtribuicaoFiltro(
                    e.target.value as DiasUltimaAtribuicaoFiltro
                  )
                }
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                title="Dias desde a última atribuição no NURGE"
              >
                {DIAS_ULTIMA_ATRIBUICAO_OPTIONS.map((option) => (
                  <option key={option.value || 'todos'} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={toggleFiltered}
                disabled={filtrados.length === 0}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-300 bg-surface px-3 py-2 text-sm font-semibold text-ink-primary hover:bg-gray-50 disabled:opacity-60"
              >
                <Check className="h-4 w-4" />
                {allFilteredSelected ? 'Limpar filtrados' : 'Selecionar filtrados'}
              </button>
              <span className="text-xs text-ink-secondary">
                {selectedCount} selecionado{selectedCount === 1 ? '' : 's'}
              </span>
              <div className="inline-flex items-stretch sm:ml-auto">
                <label className="inline-flex min-h-[38px] items-center gap-2 rounded-l-md border border-r-0 border-gray-300 bg-surface px-3 py-2 text-xs font-semibold text-ink-primary">
                  <input
                    type="checkbox"
                    checked={exportarAtribuidosAbertos}
                    onChange={(e) =>
                      setExportarAtribuidosAbertos(e.target.checked)
                    }
                    className="h-3.5 w-3.5 shrink-0 accent-brand-primary"
                  />
                  Incluir pendentes/andamento/coord.
                </label>
                <button
                  type="button"
                  onClick={() => void exportProcessosJson()}
                  disabled={sortedFiltrados.length === 0 || exportBusy}
                  className="inline-flex items-center justify-center gap-2 rounded-r-md border border-gray-300 bg-surface px-3 py-2 text-sm font-semibold text-ink-primary hover:bg-gray-50 disabled:opacity-60"
                >
                  {exportBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  Exportar nº dos processos
                </button>
              </div>
              <label
                className={`inline-flex items-center justify-center gap-2 rounded-md border border-gray-300 bg-surface px-3 py-2 text-sm font-semibold text-ink-primary hover:bg-gray-50 ${
                  importBusy ? 'cursor-wait opacity-60' : 'cursor-pointer'
                }`}
              >
                <input
                  type="file"
                  accept="application/json,.json"
                  disabled={importBusy}
                  onChange={handleImportJsonFile}
                  className="sr-only"
                />
                {importBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                Importar processos já feitos
              </label>
            </div>
          </div>

          {importedFileName && (
            <ImportedJsonPanel
              fileName={importedFileName}
              totalNumeros={importedNumeros.length}
              processos={importedProcessos}
              missingNumeros={importedMissingNumeros}
              usersByUid={usersByUid}
              selectedIds={selectedImportedIds}
              selectedCount={selectedImportedCount}
              allSelected={allImportedSelected}
              busy={deleteImportedBusy}
              copiedId={copiedId}
              onToggle={toggleImportedProcesso}
              onToggleAll={toggleAllImported}
              onClear={clearImportedJson}
              onDelete={() => setDeleteImportedConfirmOpen(true)}
              onCopy={(processo) => void copyNumero(processo)}
              onOpenHistory={setHistoryProcesso}
            />
          )}

          <section className="border-b border-gray-200 bg-surface-elevated px-4 py-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-base font-semibold text-ink-primary">
                  <UserPlus className="h-4 w-4 text-brand-primary" />
                  Atribuir seleção
                </h2>
                <p className="mt-1 text-sm text-ink-secondary">
                  Gere uma prévia para selecionar automaticamente a fila em ordem
                  visual, ou divida apenas os processos já marcados
                  manualmente entre as pessoas selecionadas.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-ink-primary ring-1 ring-gray-200">
                  {selectedCount} selecionado{selectedCount === 1 ? '' : 's'}
                </span>
                <button
                  type="button"
                  onClick={limparProcessosSelecionados}
                  disabled={selectedCount === 0}
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-300 bg-surface px-3 py-2 text-sm font-semibold text-ink-primary hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <X className="h-4 w-4" />
                  Desmarcar
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteConfirmOpen(true)}
                  disabled={deleteBusy || selectedCount === 0}
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {deleteBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  Apagar
                </button>
              </div>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(340px,0.8fr)]">
              <div className="space-y-3">
                <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-surface p-3 lg:flex-row lg:items-end">
                  <label className="text-sm">
                    <span className="mb-1 block font-medium text-ink-primary">
                      Limite total padrão por pessoa
                    </span>
                    <input
                      type="number"
                      min={1}
                      value={limitePadraoPessoa}
                      onChange={(e) => setLimitePadraoPessoa(e.target.value)}
                      className="w-48 rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block font-medium text-ink-primary">
                      Prazo em dias úteis
                    </span>
                    <input
                      type="number"
                      min={0}
                      value={prazoDias}
                      onChange={(e) => setPrazoDias(Number(e.target.value))}
                      className="w-40 rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="flex min-h-[42px] cursor-pointer items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-ink-primary">
                    <input
                      type="checkbox"
                      checked={marcarAtribuicaoUrgente}
                      onChange={(e) =>
                        setMarcarAtribuicaoUrgente(e.target.checked)
                      }
                      className="h-4 w-4 shrink-0 accent-brand-primary"
                    />
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      <Flame className="h-4 w-4 text-brand-primary" />
                      Marcar como urgente
                    </span>
                  </label>
                  <div className="flex flex-wrap gap-2 lg:ml-auto">
                    <button
                      type="button"
                      onClick={gerarDistribuicaoAutomatica}
                      disabled={
                        sortedFiltrados.length === 0 ||
                        pessoasSelecionadas.length === 0
                      }
                      className="inline-flex items-center justify-center gap-2 rounded-md border border-brand-primary bg-surface px-4 py-2 text-sm font-semibold text-brand-primary hover:bg-brand-primary-light disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Check className="h-4 w-4" />
                      Gerar divisão
                    </button>
                    <button
                      type="button"
                      onClick={gerarDistribuicaoManualSelecionados}
                      disabled={
                        selectedCount === 0 ||
                        pessoasSelecionadas.length === 0
                      }
                      className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-300 bg-surface px-4 py-2 text-sm font-semibold text-ink-primary hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <ArrowUpDown className="h-4 w-4" />
                      Dividir selecionados
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmAtribuicaoOpen(true)}
                      disabled={busy || atribuicaoPreview.length === 0}
                      className="inline-flex items-center justify-center gap-2 rounded-md bg-brand-primary px-4 py-2 text-sm font-semibold text-white hover:bg-brand-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {busy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <UserPlus className="h-4 w-4" />
                      )}
                      Confirmar distribuição
                    </button>
                  </div>
                </div>

                <div className="grid gap-3 xl:grid-cols-2">
                  <PessoasAtribuicaoGroup
                    title="Recebedores"
                    users={recebedoresAtribuicao}
                    selectedUids={pessoasAtribuicaoUids}
                    limitesPorPessoa={limitesPorPessoa}
                    limitePadraoPessoa={limitePadraoPessoa}
                    maxVisibleRows={5}
                    onToggle={togglePessoaAtribuicao}
                    onUpdateLimite={updateLimitePessoa}
                  />
                  <PessoasAtribuicaoGroup
                    title="Distribuidores"
                    users={distribuidoresAtribuicao}
                    selectedUids={pessoasAtribuicaoUids}
                    limitesPorPessoa={limitesPorPessoa}
                    limitePadraoPessoa={limitePadraoPessoa}
                    onToggle={togglePessoaAtribuicao}
                    onUpdateLimite={updateLimitePessoa}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {recebedoresAtribuicao.length > 0 && (
                    <button
                      type="button"
                      onClick={toggleTodosRecebedoresAtribuicao}
                      className="text-xs font-semibold text-brand-primary hover:text-brand-primary-dark"
                    >
                      {todosRecebedoresAtribuicaoSelecionados
                        ? 'Desmarcar todos os recebedores'
                        : 'Selecionar todos os recebedores'}
                    </button>
                  )}
                  {pessoasAtribuicaoUids.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setPessoasAtribuicaoUids([])}
                      className="text-xs font-semibold text-ink-secondary hover:text-ink-primary"
                    >
                      Limpar pessoas selecionadas
                    </button>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 bg-surface p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
                      Prévia da distribuição
                    </div>
                    <div className="mt-1 text-sm font-semibold text-ink-primary">
                      {atribuicaoPreviewTotal.total} processo
                      {atribuicaoPreviewTotal.total === 1 ? '' : 's'}
                    </div>
                  </div>
                  {atribuicaoPreview.length > 0 && (
                    <div className="space-y-1 text-right text-xs text-ink-secondary">
                      <div>
                        <div>{atribuicaoPreviewTotal.fechado} fechado</div>
                        <div>{atribuicaoPreviewTotal.aberto} aberto</div>
                      </div>
                      {marcarAtribuicaoUrgente && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-brand-primary-light px-2 py-0.5 font-semibold text-brand-primary-dark">
                          <Flame className="h-3 w-3" />
                          Urgente
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {atribuicaoPreview.length === 0 ? (
                  <div className="mt-3 rounded-md bg-gray-50 px-3 py-3 text-sm text-ink-secondary">
                    Selecione pessoas e gere uma prévia. Use "Gerar divisão"
                    para selecionar automaticamente com limites, ou "Dividir
                    selecionados" para distribuir somente os processos já
                    marcados manualmente, ignorando limites. O botão de
                    confirmar só fica ativo depois da prévia.
                  </div>
                ) : (
                  <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
                    {atribuicaoPreview.map((item) => (
                      <div
                        key={item.user.uid}
                        className="rounded-md border border-gray-200 px-3 py-2 text-sm"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-ink-primary">
                              {item.user.displayName}
                            </div>
                            <div className="text-xs text-ink-secondary">
                              {roleLabel(item.user.role)}
                            </div>
                          </div>
                          <span className="shrink-0 rounded-full bg-brand-primary-light px-2 py-0.5 text-xs font-semibold text-brand-primary-dark">
                            {item.processoIds.length}/{item.limiteTotal}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-800">
                            {item.fechado} fechado
                          </span>
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                            {item.aberto} aberto
                          </span>
                          {item.porVinculo ? (
                            <span className="rounded-full bg-violet-50 px-2 py-0.5 font-semibold text-violet-700">
                              {item.porVinculo} por vínculo
                            </span>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-3 rounded-md bg-gray-50 px-3 py-2 text-xs text-ink-secondary">
                  <CalendarClock className="mr-1 inline h-3.5 w-3.5" />
                  O prazo final será calculado a partir da data de atribuição
                  usando os feriados cadastrados.
                </div>
              </div>
            </div>
          </section>

          {loadError ? (
            <div className="py-6">
              <ErrorState
                message="Falha ao carregar a fila de não atribuídos. Verifique sua conexão e tente novamente."
                onRetry={() => setLoadRetryKey((k) => k + 1)}
              />
            </div>
          ) : isLoading ? (
            <div className="flex h-72 items-center justify-center text-brand-primary">
              <Loader2 className="h-7 w-7 animate-spin" aria-label="Carregando" />
            </div>
          ) : sortedFiltrados.length === 0 ? (
            <div className="flex h-72 flex-col items-center justify-center px-6 text-center">
              <CheckCircle2 className="h-10 w-10 text-emerald-600" />
              <h2 className="mt-3 text-lg font-semibold text-ink-primary">
                Nenhum processo na lista
              </h2>
              <p className="mt-1 max-w-md text-sm text-ink-secondary">
                A fila fica vazia quando todos os processos importados ja foram
                atribuidos ou quando os filtros nao encontram resultados.
              </p>
            </div>
          ) : (
            <>
              <FilaPaginationControls
                page={paginaFilaAtual}
                totalPages={totalFilaPages}
                totalItems={sortedFiltrados.length}
                startItem={filaPageStartIndex + 1}
                endItem={filaPageEndIndex}
                onPageChange={setFilaPage}
              />
              <div className="overflow-x-auto">
                <table className="min-w-[1500px] divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50 text-xs uppercase tracking-wide text-ink-secondary">
                    <tr>
                      <th className="px-3 py-2 text-left">Selecionar</th>
                      <th className="w-16 px-3 py-2 text-right">Nº</th>
                      <th className="px-3 py-2 text-left">Processo</th>
                      <th className="px-3 py-2 text-left">Origem</th>
                      <th className="px-3 py-2 text-left">Regime</th>
                      <SortableDateTh
                        label="1ª entrada NURGE"
                        sortKey="primeiraEntradaNurgeEm"
                        activeKey={sortKey}
                        dir={sortDir}
                        onClick={toggleSort}
                      />
                      <SortableDateTh
                        label="Devolvido origem"
                        sortKey="primeiraDevolucaoOrigemEm"
                        activeKey={sortKey}
                        dir={sortDir}
                        onClick={toggleSort}
                      />
                      <SortableDateTh
                        label="Voltou NURGE"
                        sortKey="ultimoRetornoNurgeEm"
                        activeKey={sortKey}
                        dir={sortDir}
                        onClick={toggleSort}
                      />
                      <th className="px-3 py-2 text-left">Chegou original</th>
                      <th className="px-3 py-2 text-left">Atribuído atual</th>
                      <th className="px-3 py-2 text-left">Ciclos</th>
                      <th className="px-3 py-2 text-right">Histórico</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {processosPaginaFila.map((p, index) => {
                      const selected = selectedIds.has(p.id);
                      const autoSelected = autoSelectedIds.has(p.id);
                      const ultimoResponsavel = getUltimoResponsavelNurge(p);
                      const rowNumber = filaPageStartIndex + index + 1;
                      const urgentRowClass = p.urgente ? 'bg-red-50/70' : '';
                      return (
                        <tr
                          key={p.id}
                          className={
                            autoSelected
                              ? 'bg-brand-primary-light/80 ring-1 ring-inset ring-brand-primary/30'
                              : selected
                                ? 'bg-brand-primary-light/50'
                                : urgentRowClass
                          }
                        >
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleProcesso(p.id)}
                              aria-label={`Selecionar processo ${p.numero}`}
                              className="h-4 w-4"
                            />
                          </td>
                          <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-ink-secondary">
                            {rowNumber}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-xs font-semibold text-ink-primary">
                                {p.numero}
                              </span>
                              {autoSelected && (
                                <span className="rounded-full bg-brand-primary px-2 py-0.5 text-[11px] font-semibold text-white">
                                  Prévia
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => void copyNumero(p)}
                                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-gray-200 text-ink-secondary hover:bg-gray-50 hover:text-ink-primary"
                                title="Copiar número"
                                aria-label={`Copiar número do processo ${p.numero}`}
                              >
                                {copiedId === p.id ? (
                                  <Check className="h-3.5 w-3.5 text-state-success" />
                                ) : (
                                  <Copy className="h-3.5 w-3.5" />
                                )}
                              </button>
                            </div>
                            {p.tooltip && (
                              <div className="mt-0.5 max-w-[260px] truncate text-xs text-ink-secondary">
                                {p.tooltip}
                              </div>
                            )}
                            {p.recebedorVinculadoUid && (
                              <div className="mt-0.5">
                                <span className="inline-flex items-center rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 ring-1 ring-violet-200">
                                  Vinculado a{' '}
                                  {usersByUid.get(p.recebedorVinculadoUid)
                                    ?.displayName ?? 'recebedor'}
                                </span>
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs font-medium text-ink-primary">
                            {p.agrupadorNome}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={
                                p.regime === 'fechado'
                                  ? 'inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800'
                                  : 'inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700'
                              }
                            >
                              {REGIME_LABEL[p.regime]}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-secondary">
                            {timestampLabel(p.primeiraEntradaNurgeEm)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-secondary">
                            {timestampLabel(p.primeiraDevolucaoOrigemEm)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-secondary">
                            {timestampLabel(p.ultimoRetornoNurgeEm)}
                          </td>
                          <td className="px-3 py-2 text-xs text-ink-secondary">
                            {getResponsavelSeiLabel(p.primeiroResponsavelNurge)}
                          </td>
                          <td className="px-3 py-2 text-xs text-ink-primary">
                            <div className="max-w-[180px] truncate font-medium">
                              {getResponsavelSeiLabel(ultimoResponsavel)}
                            </div>
                            {ultimoResponsavel?.login && ultimoResponsavel.nome && (
                              <div className="mt-0.5 text-[11px] text-ink-secondary">
                                {ultimoResponsavel.login}
                              </div>
                            )}
                            <div className="mt-0.5 text-[11px] text-ink-secondary">
                              {ultimaAtribuicaoLabel(p, now)}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-xs text-ink-secondary">
                            {p.ciclosNurge?.length ?? 0}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => setHistoryProcesso(p)}
                              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-gray-300 bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink-primary hover:bg-gray-50"
                            >
                              <History className="h-3.5 w-3.5" />
                              Abrir
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <FilaPaginationControls
                page={paginaFilaAtual}
                totalPages={totalFilaPages}
                totalItems={sortedFiltrados.length}
                startItem={filaPageStartIndex + 1}
                endItem={filaPageEndIndex}
                onPageChange={setFilaPage}
                compact
              />
            </>
          )}
      </section>

      {deleteConfirmOpen && (
        <ConfirmDeleteSelecionadosModal
          total={selectedCount}
          busy={deleteBusy}
          onCancel={() => {
            if (!deleteBusy) setDeleteConfirmOpen(false);
          }}
          onConfirm={() => void handleDeleteSelecionados()}
        />
      )}

      {confirmAtribuicaoOpen && (
        <ConfirmAtribuicaoModal
          total={atribuicaoPreviewTotal.total}
          pessoas={atribuicaoPreview.length}
          busy={busy}
          dataAtribuicaoIso={dataAtribuicaoIso}
          prazoDias={prazoDias}
          marcarUrgente={marcarAtribuicaoUrgente}
          onDataChange={setDataAtribuicaoIso}
          onCancel={() => {
            if (!busy) setConfirmAtribuicaoOpen(false);
          }}
          onConfirm={() => {
            void (async () => {
              const ok = await handleAtribuir();
              if (ok) setConfirmAtribuicaoOpen(false);
            })();
          }}
        />
      )}

      {deleteImportedConfirmOpen && (
        <ConfirmDeleteImportadosModal
          total={selectedImportedCount}
          busy={deleteImportedBusy}
          onCancel={() => {
            if (!deleteImportedBusy) setDeleteImportedConfirmOpen(false);
          }}
          onConfirm={() => void handleDeleteImportadosSelecionados()}
        />
      )}

      {historyProcesso && (
        <HistoricoSeiModal
          processo={historyProcesso}
          onClose={() => setHistoryProcesso(null)}
        />
      )}

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

function ImportedJsonPanel({
  fileName,
  totalNumeros,
  processos,
  missingNumeros,
  usersByUid,
  selectedIds,
  selectedCount,
  allSelected,
  busy,
  copiedId,
  onToggle,
  onToggleAll,
  onClear,
  onDelete,
  onCopy,
  onOpenHistory,
}: {
  fileName: string;
  totalNumeros: number;
  processos: Processo[];
  missingNumeros: string[];
  usersByUid: Map<string, User>;
  selectedIds: Set<string>;
  selectedCount: number;
  allSelected: boolean;
  busy: boolean;
  copiedId: string | null;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onClear: () => void;
  onDelete: () => void;
  onCopy: (processo: Processo) => void;
  onOpenHistory: (processo: Processo) => void;
}) {
  return (
    <section className="border-b border-gray-200 bg-surface-elevated">
      <div className="flex flex-col gap-3 border-b border-gray-200 p-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-ink-primary">
            Processos já feitos importados do JSON
          </h2>
          <p className="mt-1 text-sm text-ink-secondary">
            {fileName} · {processos.length} encontrado
            {processos.length === 1 ? '' : 's'} de {totalNumeros} número
            {totalNumeros === 1 ? '' : 's'}.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <button
            type="button"
            onClick={onToggleAll}
            disabled={processos.length === 0 || busy}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-300 bg-surface px-3 py-2 text-sm font-semibold text-ink-primary hover:bg-gray-50 disabled:opacity-60"
          >
            <Check className="h-4 w-4" />
            {allSelected ? 'Limpar seleção' : 'Selecionar encontrados'}
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={selectedCount === 0 || busy}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Apagar importados selecionados
          </button>
          <button
            type="button"
            onClick={onClear}
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-300 bg-surface px-3 py-2 text-sm font-semibold text-ink-primary hover:bg-gray-50 disabled:opacity-60"
          >
            <X className="h-4 w-4" />
            Limpar importação
          </button>
        </div>
      </div>

      <div className="grid gap-3 border-b border-gray-100 px-4 py-3 text-sm md:grid-cols-3">
        <InfoTile label="No JSON" value={String(totalNumeros)} />
        <InfoTile label="Encontrados" value={String(processos.length)} />
        <InfoTile label="Selecionados" value={String(selectedCount)} />
      </div>

      {missingNumeros.length > 0 && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="font-semibold">
            {missingNumeros.length} número{missingNumeros.length === 1 ? '' : 's'} não encontrado
            {missingNumeros.length === 1 ? '' : 's'} no site.
          </div>
          <div className="mt-1 break-words text-xs">
            {missingNumeros.slice(0, 30).join(', ')}
            {missingNumeros.length > 30 ? '...' : ''}
          </div>
        </div>
      )}

      {processos.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-ink-secondary">
          Nenhum processo do arquivo foi encontrado no banco de dados.
        </div>
      ) : (
        <div className="max-h-[520px] overflow-auto">
          <table className="min-w-[1080px] divide-y divide-gray-200 text-sm">
            <thead className="sticky top-0 bg-gray-50 text-left text-xs uppercase tracking-wide text-ink-secondary">
              <tr>
                <th className="px-3 py-2">Selecionar</th>
                <th className="px-3 py-2">Processo</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Regime</th>
                <th className="px-3 py-2">Recebedor</th>
                <th className="px-3 py-2">Origem</th>
                <th className="px-3 py-2">Concluído em</th>
                <th className="px-3 py-2 text-right">Histórico</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {processos.map((processo) => {
                const selected = selectedIds.has(processo.id);
                const recebedorNome = processo.recebedorUid
                  ? usersByUid.get(processo.recebedorUid)?.displayName ??
                    processo.recebedorUid
                  : '—';
                return (
                  <tr
                    key={processo.id}
                    className={selected ? 'bg-brand-primary-light/50' : ''}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => onToggle(processo.id)}
                        aria-label={`Selecionar processo importado ${processo.numero}`}
                        className="h-4 w-4"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs font-semibold text-ink-primary">
                          {processo.numero}
                        </span>
                        <button
                          type="button"
                          onClick={() => onCopy(processo)}
                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-gray-200 text-ink-secondary hover:bg-gray-50 hover:text-ink-primary"
                          title="Copiar número"
                          aria-label={`Copiar número do processo ${processo.numero}`}
                        >
                          {copiedId === processo.id ? (
                            <Check className="h-3.5 w-3.5 text-state-success" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${getStatusBadgeClass(processo.status)}`}
                      >
                        {getStatusLabel(processo.status)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          processo.regime === 'fechado'
                            ? 'inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800'
                            : 'inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700'
                        }
                      >
                        {REGIME_LABEL[processo.regime]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-primary">
                      <div className="max-w-[180px] truncate font-medium">
                        {recebedorNome}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-secondary">
                      <div className="max-w-[220px] truncate">
                        {processo.agrupadorNome || '—'}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-secondary">
                      {timestampLabel(processo.concluidoEm)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => onOpenHistory(processo)}
                        className="inline-flex items-center justify-center gap-1.5 rounded-md border border-gray-300 bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink-primary hover:bg-gray-50"
                      >
                        <History className="h-3.5 w-3.5" />
                        Abrir
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function PessoasAtribuicaoGroup({
  title,
  users,
  selectedUids,
  limitesPorPessoa,
  limitePadraoPessoa,
  maxVisibleRows,
  onToggle,
  onUpdateLimite,
}: {
  title: string;
  users: User[];
  selectedUids: string[];
  limitesPorPessoa: Record<string, PessoaLimiteConfig>;
  limitePadraoPessoa: string;
  maxVisibleRows?: number;
  onToggle: (uid: string) => void;
  onUpdateLimite: (uid: string, patch: Partial<PessoaLimiteConfig>) => void;
}) {
  const selected = new Set(selectedUids);
  const listStyle =
    maxVisibleRows && maxVisibleRows > 0
      ? { maxHeight: `${maxVisibleRows * 56}px` }
      : undefined;

  return (
    <section className="rounded-lg border border-gray-200 bg-surface">
      <div className="border-b border-gray-100 bg-gray-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-ink-secondary">
        {title}
      </div>
      {users.length === 0 ? (
        <div className="px-3 py-3 text-sm text-ink-secondary">
          Nenhum ativo.
        </div>
      ) : (
        <div className="divide-y divide-gray-100 overflow-y-auto" style={listStyle}>
          {users.map((user) => {
            const checked = selected.has(user.uid);
            const config = pessoaLimiteConfig(limitesPorPessoa, user.uid);
            const fechado = parseNonNegativeInt(config.fechado) ?? 0;
            const aberto = parseNonNegativeInt(config.aberto) ?? 0;
            const total = fechado + aberto;
            return (
              <div
                key={user.uid}
                className="flex flex-col gap-2 px-3 py-2 hover:bg-gray-50"
              >
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(user.uid)}
                    className="mt-0.5 h-4 w-4 shrink-0"
                    aria-label={`Selecionar ${user.displayName}`}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink-primary">
                      {user.displayName}
                    </span>
                    <span className="block truncate text-xs text-ink-secondary">
                      {user.email}
                    </span>
                  </span>
                </label>

                {checked && (
                  <div className="ml-7 flex flex-col gap-2 rounded-md border border-gray-200 bg-white px-2 py-2">
                    <label className="flex cursor-pointer items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-ink-secondary">
                      <input
                        type="checkbox"
                        checked={config.usarLimitePadrao}
                        onChange={(e) => {
                          if (e.target.checked) {
                            onUpdateLimite(user.uid, {
                              usarLimitePadrao: true,
                              fechado: '',
                              aberto: '',
                            });
                            return;
                          }

                          onUpdateLimite(user.uid, {
                            usarLimitePadrao: false,
                            fechado: config.fechado || limitePadraoPessoa,
                            aberto: config.aberto || '0',
                          });
                        }}
                        className="h-3.5 w-3.5 shrink-0"
                      />
                      USAR LIMITE TOTAL PADRÃO
                    </label>

                    {!config.usarLimitePadrao && (
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="text-xs">
                          <span className="mb-1 block font-medium text-ink-secondary">
                            Fechado
                          </span>
                          <input
                            type="number"
                            min={0}
                            value={config.fechado}
                            onChange={(e) =>
                              onUpdateLimite(user.uid, {
                                fechado: e.target.value,
                              })
                            }
                            className="w-24 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                          />
                        </label>
                        <label className="text-xs">
                          <span className="mb-1 block font-medium text-ink-secondary">
                            Aberto
                          </span>
                          <input
                            type="number"
                            min={0}
                            value={config.aberto}
                            onChange={(e) =>
                              onUpdateLimite(user.uid, {
                                aberto: e.target.value,
                              })
                            }
                            className="w-24 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                          />
                        </label>
                        <div className="rounded-md bg-gray-50 px-2 py-1.5 text-xs font-semibold text-ink-primary ring-1 ring-gray-200">
                          Total: {total}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ConfirmAtribuicaoModal({
  total,
  pessoas,
  busy,
  dataAtribuicaoIso,
  prazoDias,
  marcarUrgente,
  onDataChange,
  onCancel,
  onConfirm,
}: {
  total: number;
  pessoas: number;
  busy: boolean;
  dataAtribuicaoIso: string;
  prazoDias: number;
  marcarUrgente: boolean;
  onDataChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open
      title="Confirmar distribuição"
      description="Informe a data de atribuição antes de efetivar a distribuição."
      busy={busy}
      onClose={onCancel}
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-gray-300 bg-surface px-3 py-2 text-sm font-semibold text-ink-primary hover:bg-gray-50 disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || total === 0 || !dataAtribuicaoIso}
            className="inline-flex items-center gap-2 rounded-md bg-brand-primary px-3 py-2 text-sm font-semibold text-white hover:bg-brand-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="h-4 w-4" />
            )}
            Confirmar distribuição
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-ink-secondary">
          <div className="font-semibold text-ink-primary">
            {total} processo{total === 1 ? '' : 's'} para {pessoas} pessoa
            {pessoas === 1 ? '' : 's'}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 ring-1 ring-gray-200">
              <CalendarClock className="h-3.5 w-3.5" />
              Prazo em dias úteis: {prazoDias}
            </span>
            {marcarUrgente && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-1 font-semibold text-red-700 ring-1 ring-red-200">
                <Flame className="h-3.5 w-3.5" />
                Marcar como urgente
              </span>
            )}
          </div>
        </div>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink-primary">
            Data de atribuição
          </span>
          <input
            autoFocus
            type="date"
            value={dataAtribuicaoIso}
            onChange={(e) => onDataChange(e.target.value)}
            disabled={busy}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
      </div>
    </Modal>
  );
}

function ConfirmDeleteSelecionadosModal({
  total,
  busy,
  onCancel,
  onConfirm,
}: {
  total: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open
      title="Apagar processos selecionados"
      description="Esta ação remove os processos da fila e do banco de dados."
      busy={busy}
      onClose={onCancel}
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-gray-300 bg-surface px-3 py-2 text-sm font-semibold text-ink-primary hover:bg-gray-50 disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-md bg-state-danger px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Apagar completamente
          </button>
        </>
      }
    >
      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-800">
        Você está prestes a apagar completamente {total} processo
        {total === 1 ? '' : 's'} selecionado{total === 1 ? '' : 's'}. Essa
        ação não pode ser desfeita pela interface.
      </div>
    </Modal>
  );
}

function ConfirmDeleteImportadosModal({
  total,
  busy,
  onCancel,
  onConfirm,
}: {
  total: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open
      title="Apagar processos importados"
      description="A exclusão será limitada aos processos selecionados no JSON importado."
      busy={busy}
      onClose={onCancel}
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-gray-300 bg-surface px-3 py-2 text-sm font-semibold text-ink-primary hover:bg-gray-50 disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || total === 0}
            className="inline-flex items-center gap-2 rounded-md bg-state-danger px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Apagar importados
          </button>
        </>
      }
    >
      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-800">
        Você está prestes a apagar completamente {total} processo
        {total === 1 ? '' : 's'} selecionado{total === 1 ? '' : 's'} na lista
        importada. Os demais processos da fila não serão incluídos.
      </div>
    </Modal>
  );
}

interface SortableDateThProps {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: SortDir;
  onClick: (key: SortKey) => void;
}

function SortableDateTh({
  label,
  sortKey,
  activeKey,
  dir,
  onClick,
}: SortableDateThProps) {
  const isActive = activeKey === sortKey;
  const Icon = !isActive ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown;
  const title = isActive
    ? dir === 'asc'
      ? 'Mais antigos primeiro'
      : 'Mais novos primeiro'
    : 'Ordenar por data';

  return (
    <th className="px-3 py-2 text-left">
      <button
        type="button"
        onClick={() => onClick(sortKey)}
        title={title}
        className={`inline-flex items-center gap-1 font-semibold ${
          isActive ? 'text-brand-primary' : ''
        }`}
      >
        {label}
        <Icon className="h-3.5 w-3.5" />
      </button>
    </th>
  );
}

function FilaPaginationControls({
  page,
  totalPages,
  totalItems,
  startItem,
  endItem,
  onPageChange,
  compact = false,
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  startItem: number;
  endItem: number;
  onPageChange: (page: number) => void;
  compact?: boolean;
}) {
  const canPrevious = page > 1;
  const canNext = page < totalPages;
  const buttonClass =
    'inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-300 bg-surface text-ink-primary hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-45';

  return (
    <div
      className={`flex flex-col gap-2 border-gray-200 bg-gray-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between ${
        compact ? 'border-t' : 'border-b'
      }`}
    >
      <div className="text-xs font-medium text-ink-secondary">
        Mostrando {startItem}-{endItem} de {totalItems} processo
        {totalItems === 1 ? '' : 's'} · Página {page} de {totalPages}
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onPageChange(1)}
          disabled={!canPrevious}
          className={buttonClass}
          title="Primeira página"
          aria-label="Primeira página da fila"
        >
          <ChevronsLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={!canPrevious}
          className={buttonClass}
          title="Página anterior"
          aria-label="Página anterior da fila"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-[7rem] text-center text-xs font-semibold text-ink-primary">
          {page}/{totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={!canNext}
          className={buttonClass}
          title="Próxima página"
          aria-label="Próxima página da fila"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onPageChange(totalPages)}
          disabled={!canNext}
          className={buttonClass}
          title="Última página"
          aria-label="Última página da fila"
        >
          <ChevronsRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function HistoricoSeiModal({
  processo,
  onClose,
}: {
  processo: Processo;
  onClose: () => void;
}) {
  // Item 7: o histórico vem do subdoc (com fallback inline). Como é um modal
  // aberto sob demanda, buscar na montagem custa 1 leitura só quando consultado.
  const { eventos, loading: loadingHistorico } = useHistoricoSei(processo);
  const eventosOrdenados = useMemo(
    () =>
      eventos
        .map((evento, index) => ({ evento, index }))
        .sort((a, b) => {
          const at = eventoSortMillis(a.evento);
          const bt = eventoSortMillis(b.evento);
          if (at !== null && bt !== null && at !== bt) return bt - at;
          if (at !== null && bt === null) return -1;
          if (at === null && bt !== null) return 1;
          return a.index - b.index;
        }),
    [eventos]
  );
  const ultimoResponsavel = getUltimoResponsavelNurge(processo);

  return (
    <Modal
      open
      title="Histórico completo do SEI"
      description={processo.numero}
      size="xl"
      onClose={onClose}
      footer={
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-gray-300 bg-surface px-3 py-2 text-sm font-semibold text-ink-primary hover:bg-gray-50"
        >
          Fechar
        </button>
      }
    >
      <div className="space-y-4">
        <section className="grid gap-3 md:grid-cols-3">
          <InfoTile
            label="1ª entrada NURGE"
            value={timestampLabel(processo.primeiraEntradaNurgeEm)}
          />
          <InfoTile
            label="Devolvido origem"
            value={timestampLabel(processo.primeiraDevolucaoOrigemEm)}
          />
          <InfoTile
            label="Voltou NURGE"
            value={timestampLabel(processo.ultimoRetornoNurgeEm)}
          />
          <InfoTile label="Origem" value={processo.agrupadorNome || '—'} />
          <InfoTile
            label="Chegou original"
            value={getResponsavelSeiLabel(processo.primeiroResponsavelNurge)}
          />
          <InfoTile
            label="Atribuído atual"
            value={getResponsavelSeiLabel(ultimoResponsavel)}
          />
          <InfoTile label="Ciclos" value={String(processo.ciclosNurge?.length ?? 0)} />
        </section>

        {processo.seiHistoricoUrl && (
          <a
            href={processo.seiHistoricoUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-surface px-3 py-2 text-sm font-semibold text-ink-primary hover:bg-gray-50"
          >
            <History className="h-4 w-4" />
            Abrir histórico no SEI
          </a>
        )}

        {loadingHistorico ? (
          <p className="rounded-md border border-dashed border-gray-200 px-3 py-3 text-sm text-ink-secondary">
            Carregando histórico…
          </p>
        ) : eventosOrdenados.length === 0 ? (
          <p className="rounded-md border border-dashed border-gray-200 px-3 py-3 text-sm text-ink-secondary">
            Este processo não tem histórico SEI salvo no JSON importado.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-gray-200">
            <table className="min-w-[860px] divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-ink-secondary">
                <tr>
                  <th className="px-3 py-2 font-semibold">Data</th>
                  <th className="px-3 py-2 font-semibold">Tipo</th>
                  <th className="px-3 py-2 font-semibold">Descrição</th>
                  <th className="px-3 py-2 font-semibold">Unidade</th>
                  <th className="px-3 py-2 font-semibold">Usuário</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-surface">
                {eventosOrdenados.map(({ evento, index }) => (
                  <tr
                    key={`${evento.dataISO ?? evento.dataHora ?? 'evento'}-${index}`}
                    className="align-top hover:bg-surface-elevated"
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-xs font-semibold text-ink-secondary">
                      {eventoDateLabel(evento.dataISO, evento.dataHora)}
                    </td>
                    <td className="px-3 py-2">
                      <EventoTipoBadge tipo={evento.tipo} />
                    </td>
                    <td className="max-w-[360px] px-3 py-2 text-sm font-medium text-ink-primary">
                      {evento.descricao || 'Evento sem descrição.'}
                    </td>
                    <td className="max-w-[180px] px-3 py-2 text-xs text-ink-secondary">
                      <span className="font-medium text-ink-primary">
                        {evento.unidade?.sigla || evento.unidade?.nome || '—'}
                      </span>
                    </td>
                    <td className="max-w-[220px] px-3 py-2 text-xs text-ink-secondary">
                      <span className="font-medium text-ink-primary">
                        {evento.usuario?.nome || evento.usuario?.login || '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

function EventoTipoBadge({ tipo }: { tipo: EventoNurge['tipo'] }) {
  const className =
    tipo === 'outro'
      ? 'bg-rose-50 text-rose-700 ring-rose-200'
      : tipo === 'entrada_nurge'
        ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
        : tipo === 'devolucao_origem'
          ? 'bg-amber-50 text-amber-700 ring-amber-200'
          : 'bg-sky-50 text-sky-700 ring-sky-200';

  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${className}`}
    >
      {EVENTO_TIPO_LABEL[tipo] ?? tipo}
    </span>
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
