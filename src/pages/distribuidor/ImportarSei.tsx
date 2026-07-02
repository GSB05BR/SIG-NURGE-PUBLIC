import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Database,
  ExternalLink,
  FileJson,
  History as HistoryIcon,
  Loader2,
  Upload,
  Users,
} from 'lucide-react';
import { Timestamp } from 'firebase/firestore';
import { useAuth } from '@/store/authStore';
import { subscribeAllUsers } from '@/services/firebase/users';
import { subscribeConfigSistema } from '@/services/firebase/sistema-config';
import { subscribeHistorico } from '@/services/firebase/historico';
import {
  getProcessosByNumeros,
  importarProcessosSei,
} from '@/services/firebase/processos';
import {
  eventDate,
  origemToAgrupadorId,
  origemToAgrupadorNome,
  parseSeiJsonText,
  type ParsedSeiImport,
  type SeiProcessAnalysis,
} from '@/lib/sei-json';
import {
  addDiasUteis,
  formatDateBr,
  getSemanaIso,
  nowInSp,
  parseIsoDateLocal,
} from '@/lib/datetime';
import {
  getStatusBadgeClass,
  getStatusLabel,
} from '@/lib/processo-helpers';
import { usePageTitle } from '@/lib/usePageTitle';
import type {
  ConfigSistema,
  DiaSemana,
  HistoricoEntry,
  Processo,
  ProcessoRegime,
  User,
} from '@/types';
import Toast, { type ToastState } from '@/components/Toast';

type ModoImportacao = 'fila' | 'fila_filtrada' | 'distribuir';

interface UploadState {
  fileName: string;
  fileSize: number;
  parsed: ParsedSeiImport;
  duplicates: string[];
  existingProcessos: Processo[];
  checkingDuplicates: boolean;
}

interface ImportacaoDiaResumo {
  iso: string;
  label: string;
  total: number;
  criados: number;
  substituidos: number;
  importacoes: number;
}

interface ProcessoSubstituicao {
  numero: string;
  atual: Processo;
  extras: Processo[];
  concluidosPreservados: Processo[];
}

interface ProcessoConcluidoPreservado {
  numero: string;
  principal: Processo;
  outros: Processo[];
}

type MotivoDescarteImportacao =
  | 'concluido_hoje'
  | 'pendente'
  | 'em_andamento'
  | 'em_coordenacao'
  | 'em_espera';

interface ProcessoDescartadoNaImportacao {
  numero: string;
  principal: Processo;
  outros: Processo[];
  motivos: MotivoDescarteImportacao[];
}

const REGIME_OPTIONS: ProcessoRegime[] = ['fechado', 'aberto'];

const REGIME_LABEL: Record<ProcessoRegime, string> = {
  aberto: 'Regime aberto',
  fechado: 'Regime fechado',
};

function readErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Ocorreu um erro inesperado.';
}

function todayIso(): string {
  return formatDateBr(nowInSp(), 'yyyy-MM-dd');
}

function diaSemanaFromDate(date: Date): DiaSemana {
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function usuarioPodeReceberProcessos(u: User): boolean {
  return (
    (u.role === 'recebedor' || u.role === 'distribuidor') &&
    u.approved &&
    u.ativo
  );
}

function toTimestamp(date: Date | null) {
  return date ? Timestamp.fromDate(date) : null;
}

function addCalendarDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function buildImportacoesDiarias(
  entries: HistoricoEntry[],
  baseDate = nowInSp()
): ImportacaoDiaResumo[] {
  const days = Array.from({ length: 15 }, (_, index) => {
    const date = addCalendarDays(baseDate, -index);
    const iso = formatDateBr(date, 'yyyy-MM-dd');
    return {
      iso,
      label:
        index === 0
          ? `Hoje (${formatDateBr(date, 'dd/MM')})`
          : index === 1
            ? `Ontem (${formatDateBr(date, 'dd/MM')})`
            : formatDateBr(date, 'dd/MM/yyyy'),
      total: 0,
      criados: 0,
      substituidos: 0,
      importacoes: 0,
    };
  });
  const byIso = new Map(days.map((item) => [item.iso, item]));

  for (const entry of entries) {
    const timestampDate = entry.timestamp?.toDate?.();
    if (!timestampDate) continue;
    const iso = formatDateBr(timestampDate, 'yyyy-MM-dd');
    const item = byIso.get(iso);
    if (!item) continue;

    const total = readNumber(entry.payload.totalProcessos);
    const substituidos = readNumber(entry.payload.totalSubstituidos);
    const criadosPayload = readNumber(entry.payload.totalCriados);
    item.total += total;
    item.substituidos += substituidos;
    item.criados += criadosPayload || Math.max(0, total - substituidos);
    item.importacoes += 1;
  }

  return days;
}

function sortProcessosAtuais(a: Processo, b: Processo): number {
  const aUpdated = a.updatedAt?.toMillis?.() ?? 0;
  const bUpdated = b.updatedAt?.toMillis?.() ?? 0;
  if (aUpdated !== bUpdated) return bUpdated - aUpdated;
  return a.id.localeCompare(b.id);
}

function isProcessoSubstituivelNaImportacao(processo: Processo): boolean {
  return processo.status !== 'concluido';
}

function isProcessoConcluidoNaData(
  processo: Processo,
  isoDate: string
): boolean {
  if (processo.status !== 'concluido' || !processo.concluidoEm) return false;
  try {
    return formatDateBr(processo.concluidoEm.toDate(), 'yyyy-MM-dd') === isoDate;
  } catch {
    return false;
  }
}

function getMotivosDescarteNaImportacao(
  processos: Processo[],
  isoDate: string
): MotivoDescarteImportacao[] {
  const motivos: MotivoDescarteImportacao[] = [];
  if (processos.some((processo) => isProcessoConcluidoNaData(processo, isoDate))) {
    motivos.push('concluido_hoje');
  }
  if (processos.some((processo) => processo.status === 'pendente')) {
    motivos.push('pendente');
  }
  if (processos.some((processo) => processo.status === 'em_andamento')) {
    motivos.push('em_andamento');
  }
  if (processos.some((processo) => processo.status === 'em_coordenacao')) {
    motivos.push('em_coordenacao');
  }
  if (processos.some((processo) => processo.status === 'em_espera')) {
    motivos.push('em_espera');
  }
  return motivos;
}

function groupProcessosByNumero(processos: Processo[]): Map<string, Processo[]> {
  const byNumero = new Map<string, Processo[]>();
  for (const processo of processos) {
    const list = byNumero.get(processo.numero) ?? [];
    list.push(processo);
    byNumero.set(processo.numero, list);
  }
  for (const list of byNumero.values()) {
    list.sort(sortProcessosAtuais);
  }
  return byNumero;
}

export default function ImportarSei() {
  usePageTitle('Importar SEI');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { firebaseUser, userDoc } = useAuth();
  const meUid = firebaseUser?.uid ?? '';
  const meNome =
    userDoc?.displayName ?? firebaseUser?.displayName ?? 'Usuario';

  const [users, setUsers] = useState<User[] | null>(null);
  const [config, setConfig] = useState<ConfigSistema | null>(null);
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [modo, setModo] = useState<ModoImportacao>('fila');
  const [dataAtribuicaoIso, setDataAtribuicaoIso] = useState(todayIso);
  const [prazoDias, setPrazoDias] = useState(5);
  const [regimeFallback, setRegimeFallback] =
    useState<ProcessoRegime>('fechado');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [importacoesDiarias, setImportacoesDiarias] = useState<
    ImportacaoDiaResumo[] | null
  >(null);

  useEffect(() => {
    const unsubU = subscribeAllUsers(setUsers);
    const unsubC = subscribeConfigSistema((next) => {
      setConfig(next);
      if (next) setPrazoDias(next.prazoPadraoDiasUteis);
    });
    return () => {
      unsubU();
      unsubC();
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    const unsub = subscribeHistorico(
      { tipos: ['importacao_sei_json'], limit: 1000 },
      (entries) => setImportacoesDiarias(buildImportacoesDiarias(entries))
    );
    return unsub;
  }, []);

  const recebedoresAtivos = useMemo(
    () => (users ?? []).filter(usuarioPodeReceberProcessos),
    [users]
  );
  const usersByUid = useMemo(() => {
    const m = new Map<string, User>();
    (users ?? []).forEach((u) => m.set(u.uid, u));
    return m;
  }, [users]);

  const dataImportacaoIso = todayIso();
  const processosDoJson = useMemo(
    () => upload?.parsed.processes ?? [],
    [upload]
  );
  const processosDescartadosImportacao = useMemo<
    ProcessoDescartadoNaImportacao[]
  >(() => {
    if (!upload) return [];
    const byNumero = groupProcessosByNumero(upload.existingProcessos);
    const order = new Map(
      processosDoJson.map((processo, index) => [processo.numero, index])
    );
    return Array.from(byNumero.entries())
      .filter(([numero]) => order.has(numero))
      .sort((a, b) => (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0))
      .map(([numero, list]) => {
        const motivos = getMotivosDescarteNaImportacao(
          list,
          dataImportacaoIso
        );
        if (motivos.length === 0) return null;
        const descartaveis = list.filter(
          (processo) =>
            processo.status === 'pendente' ||
            processo.status === 'em_coordenacao' ||
            processo.status === 'em_andamento' ||
            processo.status === 'em_espera' ||
            isProcessoConcluidoNaData(processo, dataImportacaoIso)
        );
        const principal = descartaveis[0];
        if (!principal) return null;
        return {
          numero,
          principal,
          outros: descartaveis.slice(1),
          motivos,
        };
      })
      .filter(
        (item): item is ProcessoDescartadoNaImportacao => item !== null
      );
  }, [upload, processosDoJson, dataImportacaoIso]);
  const numerosDescartadosSet = useMemo(
    () =>
      modo === 'fila_filtrada'
        ? new Set(processosDescartadosImportacao.map((item) => item.numero))
        : new Set<string>(),
    [modo, processosDescartadosImportacao]
  );
  const processosParaImportar = useMemo(
    () =>
      processosDoJson.filter(
        (processo) => !numerosDescartadosSet.has(processo.numero)
      ),
    [processosDoJson, numerosDescartadosSet]
  );
  const numerosParaImportarSet = useMemo(
    () => new Set(processosParaImportar.map((processo) => processo.numero)),
    [processosParaImportar]
  );
  const duplicadosSet = useMemo(
    () =>
      new Set(
        (upload?.duplicates ?? []).filter((numero) =>
          numerosParaImportarSet.has(numero)
        )
      ),
    [upload, numerosParaImportarSet]
  );
  const processosNovosCount = useMemo(
    () => processosParaImportar.filter((p) => !duplicadosSet.has(p.numero)).length,
    [processosParaImportar, duplicadosSet]
  );
  const substituicoesAtuais = useMemo<ProcessoSubstituicao[]>(() => {
    if (!upload) return [];
    const byNumero = groupProcessosByNumero(upload.existingProcessos);
    const order = new Map(
      processosParaImportar.map((processo, index) => [processo.numero, index])
    );
    return Array.from(byNumero.entries())
      .filter(([numero]) => numerosParaImportarSet.has(numero))
      .sort((a, b) => (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0))
      .map(([numero, list]) => {
        const substituiveis = list.filter(isProcessoSubstituivelNaImportacao);
        if (substituiveis.length === 0) return null;
        return {
          numero,
          atual: substituiveis[0],
          extras: substituiveis.slice(1),
          concluidosPreservados: list.filter(
            (processo) => processo.status === 'concluido'
          ),
        };
      })
      .filter((item): item is ProcessoSubstituicao => item !== null);
  }, [upload, processosParaImportar, numerosParaImportarSet]);
  const concluidosPreservadosAtuais = useMemo<ProcessoConcluidoPreservado[]>(() => {
    if (!upload) return [];
    const byNumero = groupProcessosByNumero(upload.existingProcessos);
    const order = new Map(
      processosParaImportar.map((processo, index) => [processo.numero, index])
    );
    return Array.from(byNumero.entries())
      .filter(([numero]) => numerosParaImportarSet.has(numero))
      .sort((a, b) => (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0))
      .map(([numero, list]) => {
        const concluidos = list.filter(
          (processo) => processo.status === 'concluido'
        );
        if (concluidos.length === 0) return null;
        return {
          numero,
          principal: concluidos[0],
          outros: concluidos.slice(1),
        };
      })
      .filter((item): item is ProcessoConcluidoPreservado => item !== null);
  }, [upload, processosParaImportar, numerosParaImportarSet]);

  const resumo = useMemo(() => {
    const origem = new Map<string, number>();
    const responsavel = new Map<string, number>();
    const regimes = new Map<string, number>();
    for (const p of processosParaImportar) {
      const origemNome = origemToAgrupadorNome(p.unidadeOrigem);
      origem.set(origemNome, (origem.get(origemNome) ?? 0) + 1);
      const resp = p.primeiroResponsavelNurge?.nome || 'Sem responsavel';
      responsavel.set(resp, (responsavel.get(resp) ?? 0) + 1);
      const regimeLabel = p.regime ? REGIME_LABEL[p.regime] : 'Sem regime no JSON';
      regimes.set(regimeLabel, (regimes.get(regimeLabel) ?? 0) + 1);
    }
    return {
      origens: Array.from(origem.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8),
      responsaveis: Array.from(responsavel.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8),
      regimes: Array.from(regimes.entries()).sort((a, b) => b[1] - a[1]),
    };
  }, [processosParaImportar]);

  const semRegimeCount = useMemo(
    () => processosParaImportar.filter((p) => !p.regime).length,
    [processosParaImportar]
  );

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUpload(null);

    if (!file.name.toLowerCase().endsWith('.json')) {
      setError('Arquivo precisa ser .json.');
      return;
    }

    try {
      const text = await file.text();
      const parsed = parseSeiJsonText(text);
      const next: UploadState = {
        fileName: file.name,
        fileSize: file.size,
        parsed,
        duplicates: [],
        existingProcessos: [],
        checkingDuplicates: true,
      };
      setUpload(next);

      const existing = await getProcessosByNumeros(
        parsed.processes.map((p) => p.numero)
      );
      const existingByNumero = groupProcessosByNumero(existing);
      const duplicates = parsed.processes
        .map((p) => p.numero)
        .filter((numero, index, numeros) => {
          const existingList = existingByNumero.get(numero) ?? [];
          return (
            existingList.some(isProcessoSubstituivelNaImportacao) &&
            numeros.indexOf(numero) === index
          );
        });
      setUpload({
        ...next,
        duplicates,
        existingProcessos: existing,
        checkingDuplicates: false,
      });
    } catch (err) {
      setError(readErrorMessage(err));
      setUpload(null);
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function handleImportar() {
    if (!upload) return;
    if (!meUid) {
      setError('Usuario autenticado nao identificado.');
      return;
    }
    if (processosParaImportar.length === 0) {
      setError(
        modo === 'fila_filtrada' &&
          processosDescartadosImportacao.length > 0
          ? 'Todos os processos do JSON foram descartados porque ja foram concluidos hoje, estao pendentes, em andamento, na coordenacao ou em espera no sistema.'
          : 'Nao ha processos para importar.'
      );
      return;
    }
    if (
      modo === 'distribuir' &&
      processosNovosCount > 0 &&
      recebedoresAtivos.length === 0
    ) {
      setError('Nao ha recebedores ativos para distribuir na importacao.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      let distribuicaoIndex = 0;
      const processos = processosParaImportar.map((analysis, index) => {
        const substituirExistente = duplicadosSet.has(analysis.numero);
        const distribuirNovo =
          modo === 'distribuir' && !substituirExistente;
        const recebedor =
          distribuirNovo
            ? recebedoresAtivos[
                distribuicaoIndex++ % recebedoresAtivos.length
              ]
            : null;
        const primeiraEntrada = eventDate(analysis.primeiraEntradaNurge);
        const dataAtribuicao =
          distribuirNovo
            ? parseIsoDateLocal(dataAtribuicaoIso)
            : primeiraEntrada ?? nowInSp();
        const prazoFinal =
          distribuirNovo
            ? addDiasUteis(
                dataAtribuicao,
                Math.max(0, prazoDias),
                config?.feriadosNacionais ?? []
              )
            : dataAtribuicao;
        return buildProcessoFromAnalysis({
          analysis,
          ordem: index + 1,
          regime: analysis.regime ?? regimeFallback,
          recebedorUid: recebedor?.uid ?? null,
          dataAtribuicao,
          prazoFinal,
        });
      });

      const result = await importarProcessosSei({
        processos,
        fileName: upload.fileName,
        byUid: meUid,
        byNome: meNome,
        modo: modo === 'distribuir' ? 'distribuidos' : 'nao_atribuidos',
      });

      const substituicaoMsg =
        result.substituidos > 0
          ? ` (${result.substituidos} substituido${result.substituidos === 1 ? '' : 's'})`
          : '';
      const preservadosMsg =
        result.concluidosPreservados > 0
          ? `; ${result.concluidosPreservados} concluido${result.concluidosPreservados === 1 ? '' : 's'} anterior${result.concluidosPreservados === 1 ? '' : 'es'} preservado${result.concluidosPreservados === 1 ? '' : 's'}`
          : '';
      const mantidosMsg =
        result.distribuidosPreservados > 0
          ? `; ${result.distribuidosPreservados} ja distribuido${result.distribuidosPreservados === 1 ? '' : 's'} mantido${result.distribuidosPreservados === 1 ? '' : 's'} no dia atual`
          : '';
      const descartadosMsg =
        modo === 'fila_filtrada' &&
        processosDescartadosImportacao.length > 0
          ? `; ${processosDescartadosImportacao.length} descartado${processosDescartadosImportacao.length === 1 ? '' : 's'} por status atual`
          : '';
      const distribuicaoMsg =
        result.substituidos > 0
          ? `${result.ids.length} processos importados; ${result.criados} novo${result.criados === 1 ? '' : 's'} distribuido${result.criados === 1 ? '' : 's'} e ${result.substituidos} substituido${result.substituidos === 1 ? '' : 's'} enviado${result.substituidos === 1 ? '' : 's'} para a fila${preservadosMsg}${mantidosMsg}.`
          : `${result.ids.length} processos importados e distribuidos${preservadosMsg}${mantidosMsg}.`;
      setToast({
        kind: 'success',
        message:
          modo === 'distribuir'
            ? distribuicaoMsg
            : `${result.ids.length} processos importados para a fila${substituicaoMsg}${preservadosMsg}${mantidosMsg}${descartadosMsg}.`,
      });
      setUpload(null);
    } catch (err) {
      setError(readErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const canImport =
    !!upload &&
    !upload.checkingDuplicates &&
    processosParaImportar.length > 0 &&
    (modo !== 'distribuir' ||
      processosNovosCount === 0 ||
      recebedoresAtivos.length > 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink-primary">
            Importar processos do SEI
          </h1>
          <p className="text-sm text-ink-secondary">
            Carregue o JSON do capturador, confira as datas do NURGE e decida se
            os processos entram na fila ou ja saem distribuidos.
          </p>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-brand-primary px-4 py-2 text-sm font-semibold text-white hover:bg-brand-primary-dark"
        >
          <Upload className="h-4 w-4" />
          Escolher JSON
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={handleFileChange}
        />
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-lg border border-gray-200 bg-surface p-4">
          {!upload ? (
            <div className="flex min-h-[280px] flex-col items-center justify-center rounded-md border border-dashed border-gray-300 bg-gray-50 p-8 text-center">
              <FileJson className="h-10 w-10 text-brand-primary" />
              <h2 className="mt-3 text-lg font-semibold text-ink-primary">
                Nenhum JSON selecionado
              </h2>
              <p className="mt-1 max-w-xl text-sm text-ink-secondary">
                Use o arquivo exportado pelo Capturador de Processos SEI. O
                sistema identifica entrada no NURGE, devolucao para origem,
                retorno ao NURGE e primeiro responsavel.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-ink-primary">
                    {upload.fileName}
                  </h2>
                  <p className="text-sm text-ink-secondary">
                    {formatBytes(upload.fileSize)} · exportado em{' '}
                    {upload.parsed.exportedAt
                      ? formatDateBr(new Date(upload.parsed.exportedAt), 'dd/MM/yyyy HH:mm')
                      : 'data nao informada'}
                  </p>
                </div>
                {upload.checkingDuplicates ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Verificando duplicados
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Pronto
                  </span>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
                <Metric label="No JSON" value={upload.parsed.processes.length} />
                <Metric label="A importar" value={processosParaImportar.length} />
                <Metric
                  label="Descartados"
                  value={
                    modo === 'fila_filtrada'
                      ? processosDescartadosImportacao.length
                      : 0
                  }
                />
                <Metric label="A substituir" value={substituicoesAtuais.length} />
                <Metric
                  label="Concluídos preservados"
                  value={concluidosPreservadosAtuais.length}
                />
                <Metric
                  label="Históricos"
                  value={upload.parsed.processes.reduce(
                    (sum, item) => sum + item.historyCount,
                    0
                  )}
                />
              </div>

              <DescartadosImportacaoPanel
                items={
                  modo === 'fila_filtrada'
                    ? processosDescartadosImportacao
                    : []
                }
                checking={upload.checkingDuplicates}
                usersByUid={usersByUid}
                dataImportacaoIso={dataImportacaoIso}
              />
              <SubstituicoesPanel
                items={substituicoesAtuais}
                checking={upload.checkingDuplicates}
                usersByUid={usersByUid}
              />
              <ConcluidosPreservadosPanel
                items={concluidosPreservadosAtuais}
                checking={upload.checkingDuplicates}
                usersByUid={usersByUid}
              />

              <div className="grid gap-4 md:grid-cols-2">
                <ResumoList
                  title="Origens mais frequentes"
                  items={resumo.origens}
                  empty="Sem origem identificada."
                />
                <ResumoList
                  title="Chegou originalmente para"
                  items={resumo.responsaveis}
                  empty="Sem responsavel identificado."
                />
                <ResumoList
                  title="Regime informado no JSON"
                  items={resumo.regimes}
                  empty="Sem regime informado."
                />
              </div>

              <div className="overflow-hidden rounded-md border border-gray-200">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50 text-xs uppercase tracking-wide text-ink-secondary">
                    <tr>
                      <th className="px-3 py-2 text-left">Processo</th>
                      <th className="px-3 py-2 text-left">1ª entrada NURGE</th>
                      <th className="px-3 py-2 text-left">Devolvido origem</th>
                      <th className="px-3 py-2 text-left">Voltou NURGE</th>
                      <th className="px-3 py-2 text-left">Responsavel</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {processosParaImportar.slice(0, 12).map((p) => (
                      <tr key={p.numero}>
                        <td className="px-3 py-2 font-mono text-xs font-semibold text-ink-primary">
                          {p.numero}
                        </td>
                        <DateCell evento={p.primeiraEntradaNurge} />
                        <DateCell evento={p.primeiraDevolucaoOrigem} />
                        <DateCell evento={p.ultimoRetornoNurge} />
                        <td className="px-3 py-2 text-xs text-ink-secondary">
                          {p.primeiroResponsavelNurge?.nome ??
                            p.primeiroResponsavelNurge?.login ??
                            '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {processosParaImportar.length > 12 && (
                  <div className="border-t border-gray-200 bg-gray-50 px-3 py-2 text-xs text-ink-secondary">
                    Mostrando 12 de {processosParaImportar.length} processos a importar.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <ImportacoesRecentesPanel items={importacoesDiarias} />

          <div className="rounded-lg border border-gray-200 bg-surface p-4">
            <h2 className="flex items-center gap-2 text-base font-semibold text-ink-primary">
              <Database className="h-4 w-4 text-brand-primary" />
              Destino da importacao
            </h2>
            <div className="mt-3 grid gap-2">
              <label className="flex cursor-pointer gap-3 rounded-md border border-gray-200 p-3 hover:bg-gray-50">
                <input
                  type="radio"
                  checked={modo === 'fila'}
                  onChange={() => setModo('fila')}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-semibold text-ink-primary">
                    Importar como não atribuídos
                  </span>
                  <span className="block text-xs text-ink-secondary">
                    Cria o banco de processos para distribuir depois.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer gap-3 rounded-md border border-gray-200 p-3 hover:bg-gray-50">
                <input
                  type="radio"
                  checked={modo === 'fila_filtrada'}
                  onChange={() => setModo('fila_filtrada')}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-semibold text-ink-primary">
                    Importar para fila com filtro de status
                  </span>
                  <span className="block text-xs text-ink-secondary">
                    Remove do lote os números do JSON concluídos hoje, em
                    pendentes, em andamento, na coordenação ou em espera.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer gap-3 rounded-md border border-gray-200 p-3 hover:bg-gray-50">
                <input
                  type="radio"
                  checked={modo === 'distribuir'}
                  onChange={() => setModo('distribuir')}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-semibold text-ink-primary">
                    Distribuir na importação
                  </span>
                  <span className="block text-xs text-ink-secondary">
                    Divide novos em rodizio; duplicados substituidos voltam
                    para a fila.
                  </span>
                </span>
              </label>
            </div>
          </div>

          {modo === 'distribuir' ? (
            <div className="rounded-lg border border-gray-200 bg-surface p-4">
              <h2 className="flex items-center gap-2 text-base font-semibold text-ink-primary">
                <CalendarClock className="h-4 w-4 text-brand-primary" />
                Atribuicao inicial
              </h2>
              <div className="mt-3 grid gap-3">
                <label className="text-sm">
                  <span className="mb-1 block font-medium text-ink-primary">
                    Data de atribuicao
                  </span>
                  <input
                    type="date"
                    value={dataAtribuicaoIso}
                    onChange={(e) => setDataAtribuicaoIso(e.target.value)}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block font-medium text-ink-primary">
                    Prazo em dias uteis
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={prazoDias}
                    onChange={(e) => setPrazoDias(Number(e.target.value))}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-gray-200 bg-surface p-4">
              <h2 className="flex items-center gap-2 text-base font-semibold text-ink-primary">
                <Database className="h-4 w-4 text-brand-primary" />
                Fila sem atribuição
              </h2>
              <p className="mt-2 text-sm text-ink-secondary">
                {modo === 'fila_filtrada'
                  ? 'Antes de importar, o sistema descarta do lote os processos do JSON que ja aparecem como concluidos hoje, pendentes, em andamento, na coordenacao ou em espera no site. O restante entra no estoque sem recebedor.'
                  : 'Processos importados como não atribuídos entram no estoque sem exigir data de atribuição, prazo ou recebedor. Esses campos serão definidos quando você distribuir a fila.'}
              </p>
            </div>
          )}

          <div className="rounded-lg border border-gray-200 bg-surface p-4">
            <h2 className="flex items-center gap-2 text-base font-semibold text-ink-primary">
              <FileJson className="h-4 w-4 text-brand-primary" />
              Classificação
            </h2>
            <div className="mt-3 grid gap-3">
              <ResumoList
                title="Regimes detectados"
                items={resumo.regimes}
                empty="Selecione um JSON para ver os regimes."
              />
              {semRegimeCount > 0 && (
                <div>
                <span className="mb-1 block text-sm font-medium text-ink-primary">
                  Regime padrão para {semRegimeCount} sem informação
                </span>
                <div className="grid grid-cols-2 gap-2">
                  {REGIME_OPTIONS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setRegimeFallback(option)}
                      className={`rounded-md border px-3 py-2 text-sm font-semibold ${
                        regimeFallback === option
                          ? 'border-brand-primary bg-brand-primary text-white'
                          : 'border-gray-200 bg-surface text-ink-primary hover:bg-gray-50'
                      }`}
                    >
                      {REGIME_LABEL[option]}
                    </button>
                  ))}
                </div>
              </div>
              )}
            </div>
          </div>

          {modo === 'distribuir' && (
            <div className="rounded-lg border border-gray-200 bg-surface p-4">
              <h2 className="flex items-center gap-2 text-base font-semibold text-ink-primary">
                <Users className="h-4 w-4 text-brand-primary" />
                Recebedores ativos
              </h2>
              <p className="mt-1 text-sm text-ink-secondary">
                {recebedoresAtivos.length} usuario
                {recebedoresAtivos.length === 1 ? '' : 's'} disponivel
                {recebedoresAtivos.length === 1 ? '' : 's'} para rodizio.
              </p>
              <div className="mt-3 max-h-36 space-y-1 overflow-auto">
                {recebedoresAtivos.slice(0, 8).map((u) => (
                  <div
                    key={u.uid}
                    className="truncate rounded-md bg-gray-50 px-2 py-1.5 text-xs font-medium text-ink-primary"
                  >
                    {u.displayName}
                  </div>
                ))}
                {recebedoresAtivos.length === 0 && (
                  <p className="text-xs text-state-danger">
                    Aprove pelo menos um recebedor antes de distribuir na importacao.
                  </p>
                )}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={handleImportar}
            disabled={!canImport || busy}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-brand-primary px-4 py-3 text-sm font-semibold text-white hover:bg-brand-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            {modo === 'distribuir'
              ? 'Importar e distribuir'
              : modo === 'fila_filtrada'
                ? 'Importar lote filtrado para fila'
                : 'Importar para fila'}
          </button>
        </aside>
      </section>

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

function buildProcessoFromAnalysis({
  analysis,
  ordem,
  regime,
  recebedorUid,
  dataAtribuicao,
  prazoFinal,
}: {
  analysis: SeiProcessAnalysis;
  ordem: number;
  regime: ProcessoRegime;
  recebedorUid: string | null;
  dataAtribuicao: Date;
  prazoFinal: Date;
}): Omit<Processo, 'id' | 'createdAt' | 'updatedAt'> {
  const assigned = recebedorUid !== null;
  const primeiraEntrada = eventDate(analysis.primeiraEntradaNurge);
  const primeiraDevolucao = eventDate(analysis.primeiraDevolucaoOrigem);
  const ultimoRetorno = eventDate(analysis.ultimoRetornoNurge);
  const ultimaAtribuicao = eventDate(analysis.ultimaAtribuicaoNurge);
  const agrupadorId = origemToAgrupadorId(analysis.unidadeOrigem);
  const agrupadorNome = origemToAgrupadorNome(analysis.unidadeOrigem);

  return {
    numero: analysis.numero,
    agrupadorId,
    agrupadorNome,
    urgente: false,
    prioridade: false,
    regime,
    recebedorUid,
    diaSemana: diaSemanaFromDate(dataAtribuicao),
    status: assigned ? 'pendente' : 'nao_atribuido',
    origem: 'sei_json',
    distribuicaoId: null,
    diaAtribuicao: Timestamp.fromDate(dataAtribuicao),
    prazoFinal: Timestamp.fromDate(prazoFinal),
    semanaIso: getSemanaIso(dataAtribuicao),
    concluidoEm: null,
    iniciadoEm: null,
    devolvido: null,
    observacaoInicio: null,
    observacaoConclusao: null,
    ordemCsv: ordem,
    adicionadoPorUid: null,
    observacao: analysis.tooltip,
    idProcedimento: analysis.idProcedimento,
    seiUrl: analysis.url,
    seiHistoricoUrl: analysis.pageUrl,
    tooltip: analysis.tooltip,
    historyMode: analysis.historyMode,
    historyCount: analysis.historyCount,
    capturedAt: analysis.capturedAt,
    importacaoId: null,
    unidadeOrigem: analysis.unidadeOrigem,
    primeiraEntradaNurgeEm: toTimestamp(primeiraEntrada),
    primeiraDevolucaoOrigemEm: toTimestamp(primeiraDevolucao),
    ultimoRetornoNurgeEm: toTimestamp(ultimoRetorno),
    ultimaAtribuicaoNurgeEm: toTimestamp(ultimaAtribuicao),
    primeiroResponsavelNurge: analysis.primeiroResponsavelNurge,
    ultimoResponsavelNurge: analysis.ultimoResponsavelNurge,
    ciclosNurge: analysis.ciclosNurge,
    historicoSei: analysis.historicoSei,
  };
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-gray-200 bg-white px-3 py-2">
      <div className="text-xs font-medium text-ink-secondary">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-ink-primary">{value}</div>
    </div>
  );
}

function ImportacoesRecentesPanel({
  items,
}: {
  items: ImportacaoDiaResumo[] | null;
}) {
  const totalPeriodo =
    items?.reduce((sum, item) => sum + item.total, 0) ?? 0;

  return (
    <div className="rounded-lg border border-gray-200 bg-surface p-4">
      <h2 className="flex items-center gap-2 text-base font-semibold text-ink-primary">
        <CalendarClock className="h-4 w-4 text-brand-primary" />
        Importações por dia
      </h2>
      <p className="mt-1 text-sm text-ink-secondary">
        Hoje e os 14 dias anteriores.
      </p>
      <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
        <div className="text-xs font-medium text-ink-secondary">
          Total no período
        </div>
        <div className="mt-1 text-2xl font-semibold text-ink-primary">
          {items === null ? '...' : totalPeriodo}
        </div>
      </div>

      <div className="mt-3 max-h-80 divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-200 bg-white">
        {items === null ? (
          <div className="flex items-center gap-2 px-3 py-4 text-sm text-ink-secondary">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando resumo...
          </div>
        ) : (
          items.map((item) => (
            <div
              key={item.iso}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-ink-primary">
                  {item.label}
                </div>
                <div className="mt-0.5 text-xs text-ink-secondary">
                  {item.importacoes} importação
                  {item.importacoes === 1 ? '' : 'ões'} · {item.criados} novo
                  {item.criados === 1 ? '' : 's'} · {item.substituidos}{' '}
                  substituído{item.substituidos === 1 ? '' : 's'}
                </div>
              </div>
              <div className="self-center rounded-full bg-brand-primary-light px-2.5 py-1 text-xs font-semibold text-brand-primary">
                {item.total}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function DescartadosImportacaoPanel({
  items,
  checking,
  usersByUid,
  dataImportacaoIso,
}: {
  items: ProcessoDescartadoNaImportacao[];
  checking: boolean;
  usersByUid: Map<string, User>;
  dataImportacaoIso: string;
}) {
  if (!checking && items.length === 0) return null;

  return (
    <div className="rounded-md border border-sky-200 bg-sky-50">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sky-200 px-3 py-2">
        <div>
          <h3 className="text-sm font-semibold text-sky-900">
            Processos descartados do lote filtrado
          </h3>
          <p className="text-xs text-sky-800">
            Não serão importados quando já estiverem concluídos hoje (
            {formatDateLikely(dataImportacaoIso)}), pendentes, em andamento, na
            coordenação ou em espera.
          </p>
        </div>
        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-sky-900 ring-1 ring-sky-200">
          {checking
            ? 'Verificando...'
            : `${items.length} processo${items.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {checking ? (
        <div className="flex items-center gap-2 px-3 py-4 text-sm text-sky-900">
          <Loader2 className="h-4 w-4 animate-spin" />
          Conferindo status atuais no sistema...
        </div>
      ) : (
        <div className="max-h-72 divide-y divide-sky-100 overflow-y-auto bg-white">
          {items.map((item) => {
            const recebedor = item.principal.recebedorUid
              ? usersByUid.get(item.principal.recebedorUid)
              : null;
            const historicoHref = `/distribuidor/processos?historicoProcessoId=${encodeURIComponent(item.principal.id)}`;
            return (
              <div
                key={item.numero}
                className="grid gap-3 px-3 py-3 md:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-ink-primary">
                      {item.numero}
                    </span>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${getStatusBadgeClass(item.principal.status)}`}
                    >
                      {getStatusLabel(item.principal.status)}
                    </span>
                    {item.motivos.map((motivo) => (
                      <span
                        key={motivo}
                        className="inline-flex items-center rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800 ring-1 ring-sky-200"
                      >
                        {getMotivoDescarteLabel(motivo)}
                      </span>
                    ))}
                  </div>
                  <div className="mt-1 grid gap-x-4 gap-y-1 text-xs text-ink-secondary sm:grid-cols-2">
                    <span className="truncate">
                      Recebedor:{' '}
                      {recebedor?.displayName ??
                        item.principal.recebedorUid ??
                        'Sem recebedor'}
                    </span>
                    {item.principal.status === 'concluido' ? (
                      <span>
                        Concluído em:{' '}
                        {formatProcessoTimestamp(item.principal.concluidoEm)}
                      </span>
                    ) : (
                      <span>
                        Atualizado em:{' '}
                        {formatProcessoTimestamp(item.principal.updatedAt)}
                      </span>
                    )}
                    <span className="truncate">
                      Origem: {item.principal.agrupadorNome || 'Sem origem'}
                    </span>
                    <span className="font-mono">
                      ID atual: {item.principal.id.slice(0, 8)}...
                    </span>
                  </div>
                  {item.outros.length > 0 && (
                    <p className="mt-1 text-xs font-medium text-sky-800">
                      Há mais {item.outros.length} registro
                      {item.outros.length === 1 ? '' : 's'} com este mesmo
                      número também bloqueando a importação.
                    </p>
                  )}
                </div>
                <a
                  href={historicoHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-md border border-sky-300 bg-white px-3 py-2 text-xs font-semibold text-sky-900 hover:bg-sky-50"
                >
                  <HistoryIcon className="h-3.5 w-3.5" />
                  Histórico atual
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SubstituicoesPanel({
  items,
  checking,
  usersByUid,
}: {
  items: ProcessoSubstituicao[];
  checking: boolean;
  usersByUid: Map<string, User>;
}) {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200 px-3 py-2">
        <div>
          <h3 className="text-sm font-semibold text-amber-900">
            Processos que serão substituídos
          </h3>
          <p className="text-xs text-amber-800">
            Estes registros atuais do sistema serão sobrescritos pela importação.
          </p>
        </div>
        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-amber-900 ring-1 ring-amber-200">
          {checking ? 'Verificando...' : `${items.length} processo${items.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {checking ? (
        <div className="flex items-center gap-2 px-3 py-4 text-sm text-amber-900">
          <Loader2 className="h-4 w-4 animate-spin" />
          Conferindo processos já existentes no sistema...
        </div>
      ) : items.length === 0 ? (
        <div className="px-3 py-4 text-sm text-amber-900">
          Nenhum processo atual será substituído.
        </div>
      ) : (
        <div className="max-h-80 divide-y divide-amber-100 overflow-y-auto bg-white">
          {items.map((item) => {
            const recebedor = item.atual.recebedorUid
              ? usersByUid.get(item.atual.recebedorUid)
              : null;
            const historicoHref = `/distribuidor/processos?historicoProcessoId=${encodeURIComponent(item.atual.id)}`;
            return (
              <div
                key={item.numero}
                className="grid gap-3 px-3 py-3 md:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-ink-primary">
                      {item.numero}
                    </span>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${getStatusBadgeClass(item.atual.status)}`}
                    >
                      {getStatusLabel(item.atual.status)}
                    </span>
                  </div>
                  <div className="mt-1 grid gap-x-4 gap-y-1 text-xs text-ink-secondary sm:grid-cols-2">
                    <span className="truncate">
                      Origem atual: {item.atual.agrupadorNome || 'Sem origem'}
                    </span>
                    <span className="truncate">
                      Recebedor:{' '}
                      {recebedor?.displayName ??
                        item.atual.recebedorUid ??
                        'Sem recebedor'}
                    </span>
                    <span>
                      Atualizado em: {formatProcessoTimestamp(item.atual.updatedAt)}
                    </span>
                    <span className="font-mono">
                      ID atual: {item.atual.id.slice(0, 8)}...
                    </span>
                  </div>
                  {item.extras.length > 0 && (
                    <p className="mt-1 text-xs font-medium text-amber-800">
                      Há {item.extras.length} registro
                      {item.extras.length === 1 ? '' : 's'} extra
                      {item.extras.length === 1 ? '' : 's'} com este mesmo
                      número; a importação manterá o mais recente e removerá o
                      restante.
                    </p>
                  )}
                </div>
                <a
                  href={historicoHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-md border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-50"
                >
                  <HistoryIcon className="h-3.5 w-3.5" />
                  Histórico atual
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ConcluidosPreservadosPanel({
  items,
  checking,
  usersByUid,
}: {
  items: ProcessoConcluidoPreservado[];
  checking: boolean;
  usersByUid: Map<string, User>;
}) {
  if (!checking && items.length === 0) return null;

  return (
    <div className="rounded-md border border-emerald-200 bg-emerald-50">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-200 px-3 py-2">
        <div>
          <h3 className="text-sm font-semibold text-emerald-900">
            Concluídos preservados
          </h3>
          <p className="text-xs text-emerald-800">
            Estes processos já concluídos não serão sobrescritos; a importação
            criará um novo registro para o mesmo número.
          </p>
        </div>
        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-emerald-900 ring-1 ring-emerald-200">
          {checking
            ? 'Verificando...'
            : `${items.length} processo${items.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {checking ? (
        <div className="flex items-center gap-2 px-3 py-4 text-sm text-emerald-900">
          <Loader2 className="h-4 w-4 animate-spin" />
          Conferindo conclusões anteriores...
        </div>
      ) : (
        <div className="max-h-72 divide-y divide-emerald-100 overflow-y-auto bg-white">
          {items.map((item) => {
            const recebedor = item.principal.recebedorUid
              ? usersByUid.get(item.principal.recebedorUid)
              : null;
            const historicoHref = `/distribuidor/processos?historicoProcessoId=${encodeURIComponent(item.principal.id)}`;
            return (
              <div
                key={item.numero}
                className="grid gap-3 px-3 py-3 md:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-ink-primary">
                      {item.numero}
                    </span>
                    <span className="inline-flex items-center rounded-full bg-state-success-bg px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.3px] text-state-success ring-1 ring-green-200">
                      Concluído
                    </span>
                  </div>
                  <div className="mt-1 grid gap-x-4 gap-y-1 text-xs text-ink-secondary sm:grid-cols-2">
                    <span className="truncate">
                      Recebedor:{' '}
                      {recebedor?.displayName ??
                        item.principal.recebedorUid ??
                        'Sem recebedor'}
                    </span>
                    <span>
                      Concluído em:{' '}
                      {formatProcessoTimestamp(item.principal.concluidoEm)}
                    </span>
                    <span className="truncate">
                      Origem: {item.principal.agrupadorNome || 'Sem origem'}
                    </span>
                    <span className="font-mono">
                      ID preservado: {item.principal.id.slice(0, 8)}...
                    </span>
                  </div>
                  {item.outros.length > 0 && (
                    <p className="mt-1 text-xs font-medium text-emerald-800">
                      Há mais {item.outros.length} conclusão
                      {item.outros.length === 1 ? '' : 'ões'} anterior
                      {item.outros.length === 1 ? '' : 'es'} com este número,
                      também preservada
                      {item.outros.length === 1 ? '' : 's'}.
                    </p>
                  )}
                </div>
                <a
                  href={historicoHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-md border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 hover:bg-emerald-50"
                >
                  <HistoryIcon className="h-3.5 w-3.5" />
                  Histórico preservado
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ResumoList({
  title,
  items,
  empty,
}: {
  title: string;
  items: Array<[string, number]>;
  empty: string;
}) {
  return (
    <div className="rounded-md border border-gray-200 bg-white p-3">
      <h3 className="text-sm font-semibold text-ink-primary">{title}</h3>
      <div className="mt-2 space-y-1">
        {items.length === 0 ? (
          <p className="text-xs text-ink-secondary">{empty}</p>
        ) : (
          items.map(([label, count]) => (
            <div key={label} className="flex items-center justify-between gap-3 text-xs">
              <span className="truncate text-ink-secondary">{label}</span>
              <span className="font-semibold text-ink-primary">{count}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function formatProcessoTimestamp(value: Processo['updatedAt'] | null): string {
  if (!value || typeof value.toDate !== 'function') return '—';
  try {
    return formatDateBr(value.toDate(), 'dd/MM/yyyy HH:mm');
  } catch {
    return '—';
  }
}

function formatDateLikely(iso: string): string {
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function getMotivoDescarteLabel(motivo: MotivoDescarteImportacao): string {
  switch (motivo) {
    case 'concluido_hoje':
      return 'Concluído hoje';
    case 'pendente':
      return 'Pendente';
    case 'em_andamento':
      return 'Em andamento';
    case 'em_coordenacao':
      return 'Na coordenação';
    case 'em_espera':
      return 'Em espera';
  }
}

function DateCell({ evento }: { evento: SeiProcessAnalysis[keyof Pick<SeiProcessAnalysis, 'primeiraEntradaNurge' | 'primeiraDevolucaoOrigem' | 'ultimoRetornoNurge'>] }) {
  const date = eventDate(evento);
  return (
    <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-secondary">
      {date ? formatDateBr(date, 'dd/MM/yyyy HH:mm') : '—'}
    </td>
  );
}
