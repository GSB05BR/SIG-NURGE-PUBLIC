import type {
  CicloNurge,
  EventoNurge,
  ProcessoRegime,
  ResponsavelSei,
  UnidadeSei,
} from '@/types';
import { slugify } from '@/lib/slug';

interface SeiDescricaoLink {
  texto?: unknown;
  titulo?: unknown;
}

interface SeiHistoryRecord {
  dataHora?: unknown;
  dataISO?: unknown;
  descricao?: unknown;
  descricaoLinks?: unknown;
  destacada?: unknown;
  ordem?: unknown;
  unidade?: unknown;
  usuario?: unknown;
}

interface SeiProcessRecord {
  capturedAt?: unknown;
  history?: unknown;
  historyCount?: unknown;
  historyMode?: unknown;
  idProcedimento?: unknown;
  numero?: unknown;
  origemPagina?: unknown;
  pageUrl?: unknown;
  regime?: unknown;
  tooltip?: unknown;
  url?: unknown;
}

interface SeiExportRoot {
  schema?: unknown;
  version?: unknown;
  exportedAt?: unknown;
  summary?: unknown;
  processes?: unknown;
}

export interface SeiProcessAnalysis {
  numero: string;
  idProcedimento: string | null;
  tooltip: string | null;
  url: string | null;
  pageUrl: string | null;
  capturedAt: string | null;
  historyCount: number;
  historyMode: string | null;
  regime: ProcessoRegime | null;
  unidadeOrigem: UnidadeSei | null;
  primeiraEntradaNurge: EventoNurge | null;
  primeiraDevolucaoOrigem: EventoNurge | null;
  ultimoRetornoNurge: EventoNurge | null;
  ultimaAtribuicaoNurge: EventoNurge | null;
  primeiroResponsavelNurge: ResponsavelSei | null;
  ultimoResponsavelNurge: ResponsavelSei | null;
  ciclosNurge: CicloNurge[];
  historicoSei: EventoNurge[];
  warnings: string[];
}

export interface ParsedSeiImport {
  schema: string | null;
  version: number | null;
  exportedAt: string | null;
  totalInformado: number | null;
  processes: SeiProcessAnalysis[];
  warnings: string[];
}

interface TimedEvento {
  evento: EventoNurge;
  time: number;
  index: number;
}

export function parseSeiJsonText(text: string): ParsedSeiImport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Arquivo JSON invalido.');
  }

  if (!isObject(parsed)) {
    throw new Error('JSON precisa ser um objeto exportado pelo capturador.');
  }

  const root = parsed as SeiExportRoot;
  if (!Array.isArray(root.processes)) {
    throw new Error('JSON nao contem a lista "processes".');
  }

  const warnings: string[] = [];
  const processes = root.processes
    .map((item, index) => analyseProcess(item as SeiProcessRecord, index))
    .filter((item): item is SeiProcessAnalysis => {
      if (!item) return false;
      return true;
    });

  const missingNumero = root.processes.length - processes.length;
  if (missingNumero > 0) {
    warnings.push(
      `${missingNumero} registro${missingNumero === 1 ? '' : 's'} sem numero foram ignorados.`
    );
  }

  return {
    schema: asString(root.schema),
    version: asNumber(root.version),
    exportedAt: asString(root.exportedAt),
    totalInformado: getSummaryTotal(root.summary),
    processes,
    warnings,
  };
}

export function origemToAgrupadorId(unidade: UnidadeSei | null): string {
  const base = unidade?.sigla || unidade?.nome || 'sem-origem';
  return slugify(base) || 'sem-origem';
}

export function origemToAgrupadorNome(unidade: UnidadeSei | null): string {
  if (!unidade) return 'Origem nao identificada';
  return unidade.sigla || unidade.nome || 'Origem nao identificada';
}

export function eventDate(evento: EventoNurge | null): Date | null {
  if (!evento?.dataISO) return null;
  const date = new Date(evento.dataISO);
  return Number.isNaN(date.getTime()) ? null : date;
}

function analyseProcess(
  raw: SeiProcessRecord,
  index: number
): SeiProcessAnalysis | null {
  if (!isObject(raw)) return null;
  const numero = asString(raw.numero)?.trim();
  if (!numero) return null;

  const rawHistory = Array.isArray(raw.history)
    ? (raw.history as SeiHistoryRecord[])
    : [];
  const warnings: string[] = [];
  if (rawHistory.length === 0) {
    warnings.push('Processo sem historico capturado.');
  }

  const ordered = rawHistory
    .map((record, recordIndex) => ({ record, recordIndex }))
    .sort((a, b) => compareHistoryRecord(a, b));

  const timedEventos: TimedEvento[] = ordered.map(({ record }, eventIndex) => {
    const evento = toEventoNurge(record);
    return {
      evento,
      time: safeTime(evento.dataISO),
      index: eventIndex,
    };
  });

  const entradaEventos = timedEventos.filter(
    (item) => item.evento.tipo === 'entrada_nurge'
  );
  const devolucaoEventos = timedEventos.filter(
    (item) => item.evento.tipo === 'devolucao_origem'
  );
  const atribuicaoEventos = timedEventos.filter(
    (item) => item.evento.tipo === 'atribuicao_nurge'
  );

  const primeiraEntrada = entradaEventos[0] ?? null;
  const primeiraDevolucao = primeiraEntrada
    ? devolucaoEventos.find((item) => isAfter(item, primeiraEntrada)) ?? null
    : devolucaoEventos[0] ?? null;
  const ultimoRetorno = calcularUltimoRetornoNurge(
    timedEventos.map((item) => item.evento)
  );
  const primeiraAtribuicao = primeiraEntrada
    ? atribuicaoEventos.find((item) => isAfter(item, primeiraEntrada)) ?? null
    : atribuicaoEventos[0] ?? null;
  // Última atribuição a usuário do NURGE (maior tempo). Persistida como twin de
  // `getUltimaAtribuicaoNurgeMillis`, que antes varria o historicoSei inline
  // (item 7 — para o histórico sair do doc principal sem quebrar a derivação).
  const ultimaAtribuicao =
    atribuicaoEventos.length > 0
      ? atribuicaoEventos.reduce((acc, item) =>
          item.time >= acc.time ? item : acc
        )
      : null;

  const unidadeOrigem =
    primeiraEntrada?.evento.unidade && isNurge(primeiraEntrada.evento.unidade)
      ? extractOrigemFromDescricao(primeiraEntrada.evento.descricao)
      : primeiraEntrada?.evento.unidade ?? null;

  const ciclosNurge = buildCiclos(entradaEventos, devolucaoEventos, atribuicaoEventos);

  if (!primeiraEntrada) {
    warnings.push('Nenhuma entrada no NURGE foi identificada automaticamente.');
  }
  if (!primeiraAtribuicao) {
    warnings.push('Nenhuma atribuicao para usuario do NURGE foi identificada.');
  }

  return {
    numero,
    idProcedimento: asString(raw.idProcedimento),
    tooltip: asString(raw.tooltip),
    url: asString(raw.url),
    pageUrl: asString(raw.pageUrl),
    capturedAt: asString(raw.capturedAt),
    historyCount: asNumber(raw.historyCount) ?? rawHistory.length,
    historyMode: asString(raw.historyMode),
    regime: normalizeRegime(asString(raw.regime)),
    unidadeOrigem,
    primeiraEntradaNurge: primeiraEntrada?.evento ?? null,
    primeiraDevolucaoOrigem: primeiraDevolucao?.evento ?? null,
    ultimoRetornoNurge: ultimoRetorno,
    ultimaAtribuicaoNurge: ultimaAtribuicao?.evento ?? null,
    primeiroResponsavelNurge: primeiraAtribuicao?.evento.usuario ?? null,
    // Responsável da ÚLTIMA atribuição NURGE (twin de getUltimoResponsavelNurge,
    // que antes varria o histórico inline). historicoSei é ascendente no tempo,
    // então a última atribuição = a de maior tempo.
    ultimoResponsavelNurge: ultimaAtribuicao?.evento.usuario ?? null,
    ciclosNurge,
    historicoSei: timedEventos.map((item) => item.evento),
    warnings: warnings.map((message) => `Linha ${index + 1}: ${message}`),
  };
}

export function calcularUltimoRetornoNurge(
  historico: EventoNurge[]
): EventoNurge | null {
  const timedEventos = historico
    .map((evento, index) => ({
      evento,
      time: safeTime(evento.dataISO),
      index,
    }))
    .sort((a, b) => {
      if (a.time !== b.time) return a.time - b.time;
      return a.index - b.index;
    });
  const entradaEventos = timedEventos.filter(
    (item) => item.evento.tipo === 'entrada_nurge'
  );
  const devolucaoEventos = timedEventos.filter(
    (item) => item.evento.tipo === 'devolucao_origem'
  );
  const ultimaDevolucao = last(devolucaoEventos);
  if (ultimaDevolucao) {
    return (
      entradaEventos.find((item) => isAfter(item, ultimaDevolucao))?.evento ??
      null
    );
  }
  return entradaEventos[0]?.evento ?? null;
}

function buildCiclos(
  entradas: TimedEvento[],
  devolucoes: TimedEvento[],
  atribuicoes: TimedEvento[]
): CicloNurge[] {
  return entradas.map((entrada, idx) => {
    const proximaEntrada = entradas[idx + 1] ?? null;
    const devolucao =
      devolucoes.find(
        (item) =>
          isAfter(item, entrada) &&
          (!proximaEntrada || isBefore(item, proximaEntrada))
      ) ?? null;
    const atribuicao =
      atribuicoes.find(
        (item) =>
          isAfter(item, entrada) &&
          (!devolucao || isBefore(item, devolucao)) &&
          (!proximaEntrada || isBefore(item, proximaEntrada))
      ) ?? null;

    return {
      entrada: entrada.evento,
      devolucaoOrigem: devolucao?.evento ?? null,
      retornoNurge: proximaEntrada?.evento ?? null,
      atribuidoPara: atribuicao?.evento.usuario ?? null,
    };
  });
}

function toEventoNurge(record: SeiHistoryRecord): EventoNurge {
  const unidade = toUnidade(record.unidade);
  const usuario = toResponsavel(record.usuario);
  const descricao = asString(record.descricao) ?? '';
  const tipo = classifyEvento(descricao, unidade);
  const atribuido = tipo === 'atribuicao_nurge' ? responsavelFromAtribuicao(record) : null;

  return {
    tipo,
    dataHora: asString(record.dataHora),
    dataISO: asString(record.dataISO),
    descricao,
    unidade,
    usuario: atribuido ?? usuario,
  };
}

function classifyEvento(
  descricao: string,
  unidade: UnidadeSei | null
): EventoNurge['tipo'] {
  const desc = normalize(descricao);
  const unidadeNurge = isNurge(unidade);

  if (
    unidadeNurge &&
    desc.includes('processo atribuido para')
  ) {
    return 'atribuicao_nurge';
  }

  if (
    !unidadeNurge &&
    desc.includes('processo remetido pela unidade nurge')
  ) {
    return 'devolucao_origem';
  }

  if (
    unidadeNurge &&
    (desc.includes('processo recebido na unidade') ||
      (desc.includes('processo remetido pela unidade') &&
        !desc.includes('processo remetido pela unidade nurge')))
  ) {
    return 'entrada_nurge';
  }

  return 'outro';
}

function responsavelFromAtribuicao(record: SeiHistoryRecord): ResponsavelSei | null {
  const links = Array.isArray(record.descricaoLinks)
    ? (record.descricaoLinks as SeiDescricaoLink[])
    : [];
  const first = links[0];
  const login = asString(first?.texto);
  const nome = asString(first?.titulo);
  if (login || nome) {
    return {
      login: login ?? '',
      nome: nome ?? login ?? '',
    };
  }
  return toResponsavel(record.usuario);
}

function extractOrigemFromDescricao(descricao: string): UnidadeSei | null {
  const match = descricao.match(/Processo remetido pela unidade\s+(.+)$/i);
  const sigla = match?.[1]?.trim();
  if (!sigla || normalize(sigla) === 'nurge') return null;
  return { sigla, nome: sigla };
}

function toUnidade(value: unknown): UnidadeSei | null {
  if (!isObject(value)) return null;
  const nome = asString(value.nome) ?? '';
  const sigla = asString(value.sigla) ?? '';
  if (!nome && !sigla) return null;
  return { nome, sigla };
}

function toResponsavel(value: unknown): ResponsavelSei | null {
  if (!isObject(value)) return null;
  const login = asString(value.login) ?? '';
  const nome = asString(value.nome) ?? '';
  if (!login && !nome) return null;
  return { login, nome };
}

function compareHistoryRecord(
  a: { record: SeiHistoryRecord; recordIndex: number },
  b: { record: SeiHistoryRecord; recordIndex: number }
): number {
  const at = safeTime(asString(a.record.dataISO));
  const bt = safeTime(asString(b.record.dataISO));
  if (at !== bt) return at - bt;
  const ao = asNumber(a.record.ordem) ?? 0;
  const bo = asNumber(b.record.ordem) ?? 0;
  if (ao !== bo) return bo - ao;
  return a.recordIndex - b.recordIndex;
}

function isNurge(unidade: UnidadeSei | null): boolean {
  if (!unidade) return false;
  const sigla = normalize(unidade.sigla);
  const nome = normalize(unidade.nome);
  return sigla === 'nurge' || nome.includes('nucleo de recebimento de guias');
}

function isAfter(a: TimedEvento, b: TimedEvento): boolean {
  return a.time > b.time || (a.time === b.time && a.index > b.index);
}

function isBefore(a: TimedEvento, b: TimedEvento): boolean {
  return a.time < b.time || (a.time === b.time && a.index < b.index);
}

function safeTime(value: string | null): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normalizeRegime(value: string | null): ProcessoRegime | null {
  if (!value) return null;
  const normalized = normalize(value).trim();
  if (normalized === 'aberto') return 'aberto';
  if (normalized === 'fechado') return 'fechado';
  return null;
}

function getSummaryTotal(summary: unknown): number | null {
  if (!isObject(summary)) return null;
  return asNumber(summary.totalProcesses) ?? asNumber(summary.listedProcesses);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function last<T>(items: T[]): T | null {
  return items.length > 0 ? items[items.length - 1] : null;
}
