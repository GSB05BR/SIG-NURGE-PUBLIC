/**
 * Serviço de PROCESSOS reescrito para o showcase — lê/escreve o banco EM
 * MEMÓRIA (`src/mock/db.ts`) em vez do Firestore, mantendo EXATAMENTE as mesmas
 * assinaturas públicas que o app já consumia (por isso nenhuma página mudou).
 *
 * Diferenças em relação ao original:
 *  - Sem rede/credenciais: `subscribe*` usa `db.processos.subscribe`, os getters
 *    resolvem Promises com dados do seed, e as mutações alteram o mock in-place.
 *  - Mutações são best-effort e NÃO lançam em uso normal (sem parsing SEI pesado,
 *    sem algoritmo de distribuição, sem validação de conclusão, sem histórico).
 *  - Todos os dados são fictícios (ver `src/mock/seed.ts`).
 */
import { Timestamp, type Unsubscribe } from 'firebase/firestore';
import { db, mockId } from '@/mock/db';
import {
  addDiasUteis,
  getSemanaIso,
  nowInSp,
  parseIsoDateLocal,
} from '@/lib/datetime';
import {
  HISTORICO_RECEBEDOR_LIMITE,
  compararPrioridadeFilaNaoAtribuidos,
} from '@/lib/processo-helpers';
import type {
  DadosConclusaoProcesso,
  DiaSemana,
  EventoNurge,
  Processo,
  ProcessoRegime,
  ProcessoStatus,
  User,
} from '@/types';

// Conjuntos de status espelhados do original (usados nos filtros dos listeners).
const COORDENACAO_STATUSES: Array<
  Extract<ProcessoStatus, 'em_coordenacao' | 'em_espera'>
> = ['em_coordenacao', 'em_espera'];
const STATUS_ABERTOS: Array<
  Extract<ProcessoStatus, 'pendente' | 'em_andamento' | 'em_coordenacao' | 'em_espera'>
> = ['pendente', 'em_andamento', 'em_coordenacao', 'em_espera'];

const MANUAL_SEM_ORIGEM_ID = 'manual-sem-origem';
const MANUAL_SEM_ORIGEM_NOME = 'Sem origem';

type ProcessoStatusOperacional = Extract<
  ProcessoStatus,
  'pendente' | 'em_andamento' | 'concluido'
>;

/** millis de um Timestamp (0 quando ausente) — auxiliar de ordenação/filtro. */
function millis(ts: Timestamp | null | undefined): number {
  return ts?.toMillis?.() ?? 0;
}

/** Ordena por data de envio à coordenação (mais recente primeiro). */
function compararCoordenacaoDesc(a: Processo, b: Processo): number {
  const at = a.coordenacaoEnviadoEm?.toMillis() ?? millis(a.updatedAt);
  const bt = b.coordenacaoEnviadoEm?.toMillis() ?? millis(b.updatedAt);
  return bt - at;
}

/**
 * Lê o histórico SEI completo de um processo. No showcase o histórico vive
 * inline no doc (não há subcoleção). Prefere o `inline` recebido; senão lê do
 * mock. Retorna [] quando não houver.
 */
export async function getHistoricoSeiProcesso(
  processoId: string,
  inline?: EventoNurge[] | null
): Promise<EventoNurge[]> {
  if (inline && inline.length > 0) return inline;
  return db.processos.get(processoId)?.historicoSei ?? inline ?? [];
}

/**
 * Cria processos em lote no mock. Retorna a lista de novos ids (na ordem de
 * entrada). Preenche `id`/`createdAt`/`updatedAt`.
 */
export async function bulkCreateProcessos(
  processos: Omit<Processo, 'id' | 'createdAt' | 'updatedAt'>[]
): Promise<string[]> {
  const ids: string[] = [];
  for (const p of processos) {
    const id = mockId('proc');
    ids.push(id);
    const now = Timestamp.now();
    db.processos.insert({ ...p, id, createdAt: now, updatedAt: now } as Processo);
  }
  return ids;
}

export interface ImportarProcessosSeiInput {
  processos: Omit<Processo, 'id' | 'createdAt' | 'updatedAt'>[];
  fileName: string;
  byUid: string;
  byNome: string;
  modo: 'nao_atribuidos' | 'distribuidos';
}

/**
 * Importação best-effort: insere os processos recebidos como novos e devolve um
 * resumo bem-formado (sem dedup por número nem preservação de concluídos —
 * simplificação do showcase). Não faz parsing SEI (o chamador já entrega docs).
 */
export async function importarProcessosSei(
  input: ImportarProcessosSeiInput
): Promise<{
  ids: string[];
  importacaoId: string;
  criados: number;
  substituidos: number;
  concluidosPreservados: number;
  numerosConcluidosPreservados: string[];
  distribuidosPreservados: number;
  numerosDistribuidosPreservados: string[];
}> {
  const importacaoId = mockId('importacao');
  const ids = await bulkCreateProcessos(
    input.processos.map((processo) => ({ ...processo, importacaoId }))
  );
  return {
    ids,
    importacaoId,
    criados: ids.length,
    substituidos: 0,
    concluidosPreservados: 0,
    numerosConcluidosPreservados: [],
    distribuidosPreservados: 0,
    numerosDistribuidosPreservados: [],
  };
}

export interface AtribuirProcessosInput {
  processoIds: string[];
  recebedor: Pick<User, 'uid' | 'displayName' | 'email'>;
  diaAtribuicao: Date;
  prazoFinal: Date;
  marcarUrgente?: boolean;
  byUid: string;
  byNome: string;
}

export async function atribuirProcessos(
  input: AtribuirProcessosInput
): Promise<void> {
  const unique = Array.from(new Set(input.processoIds));
  if (unique.length === 0) return;

  const diaSemana = diaSemanaFromDate(input.diaAtribuicao);
  const semanaIso = getSemanaIso(input.diaAtribuicao);

  for (const id of unique) {
    const patch: Partial<Processo> = {
      recebedorUid: input.recebedor.uid,
      status: 'pendente',
      diaSemana,
      diaAtribuicao: Timestamp.fromDate(input.diaAtribuicao),
      prazoFinal: Timestamp.fromDate(input.prazoFinal),
      semanaIso,
      updatedAt: Timestamp.now(),
    };
    if (input.marcarUrgente === true) {
      patch.urgente = true;
    }
    db.processos.update(id, patch);
  }
}

export interface DevolverProcessoParaFilaInput {
  processoId: string;
  recebedorNomeAnterior?: string | null;
  byUid: string;
  byNome: string;
}

export async function devolverProcessoParaFila(
  input: DevolverProcessoParaFilaInput
): Promise<void> {
  const before = db.processos.get(input.processoId);
  if (!before || before.status === 'nao_atribuido') return;

  db.processos.update(input.processoId, {
    recebedorUid: null,
    status: 'nao_atribuido',
    iniciadoEm: null,
    concluidoEm: null,
    devolvido: null,
    recebedorVinculadoUid: null,
    observacaoInicio: null,
    observacaoConclusao: null,
    dadosConclusao: null,
    coordenacaoEnviadoEm: null,
    coordenacaoEnviadoPorUid: null,
    coordenacaoEnviadoPorNome: null,
    coordenacaoEnviadoPorEmail: null,
    coordenacaoUltimaAcaoEm: null,
    coordenacaoUltimaAcaoPorUid: null,
    coordenacaoUltimaAcaoPorNome: null,
    coordenacaoUltimaObservacao: null,
    updatedAt: Timestamp.now(),
  });
}

export interface CreateProcessoManualInput {
  numero: string;
  agrupadorId?: string | null;
  agrupadorNome?: string | null;
  urgente: boolean;
  prioridade: boolean;
  regime?: ProcessoRegime;
  recebedorUid: string;
  diaSemana: DiaSemana;
  diaAtribuicao: Date;
  prazoFinal: Date;
  observacao: string | null;
  adicionadoPorUid: string;
  adicionadoPorNome: string;
}

/**
 * Cria um processo adicionado manualmente. Status inicia pendente;
 * origem='manual'; semanaIso derivada de diaAtribuicao.
 */
export async function createProcessoManual(
  input: CreateProcessoManualInput
): Promise<string> {
  const id = mockId('proc');
  const now = Timestamp.now();
  const agrupadorId = input.agrupadorId || MANUAL_SEM_ORIGEM_ID;
  const agrupadorNome = input.agrupadorNome || MANUAL_SEM_ORIGEM_NOME;
  const processo: Processo = {
    id,
    numero: input.numero,
    agrupadorId,
    agrupadorNome,
    urgente: input.urgente,
    prioridade: input.prioridade,
    regime: input.regime ?? 'fechado',
    recebedorUid: input.recebedorUid,
    diaSemana: input.diaSemana,
    status: 'pendente',
    origem: 'manual',
    distribuicaoId: null,
    diaAtribuicao: Timestamp.fromDate(input.diaAtribuicao),
    prazoFinal: Timestamp.fromDate(input.prazoFinal),
    semanaIso: getSemanaIso(input.diaAtribuicao),
    concluidoEm: null,
    iniciadoEm: null,
    devolvido: null,
    observacaoInicio: null,
    observacaoConclusao: null,
    ordemCsv: null,
    adicionadoPorUid: input.adicionadoPorUid,
    observacao: input.observacao,
    createdAt: now,
    updatedAt: now,
  };
  db.processos.insert(processo);
  return id;
}

export interface UpdateProcessoStatusOptions {
  devolvido?: boolean;
  dadosConclusao?: DadosConclusaoProcesso | null;
  permitirConclusaoSemDados?: boolean;
}

/**
 * Atualiza o status de um processo, aplicando os efeitos colaterais de
 * iniciadoEm/concluidoEm (best-effort, sem validação de dados nem limite).
 */
export async function updateProcessoStatus(
  processoId: string,
  novoStatus: ProcessoStatusOperacional,
  byUid: string,
  byNome: string,
  observacao?: string | null,
  options: UpdateProcessoStatusOptions = {}
): Promise<void> {
  const before = db.processos.get(processoId);
  if (!before) return;

  const observacaoLimpa = observacao?.trim() || null;
  const patch: Partial<Processo> = {
    status: novoStatus,
    updatedAt: Timestamp.now(),
  };

  if (novoStatus === 'em_andamento') {
    if (!before.iniciadoEm) patch.iniciadoEm = Timestamp.now();
    patch.concluidoEm = null;
    patch.devolvido = null;
    patch.dadosConclusao = null;
    if (observacaoLimpa) patch.observacaoInicio = observacaoLimpa;
  } else if (novoStatus === 'concluido') {
    if (!before.iniciadoEm) patch.iniciadoEm = Timestamp.now();
    patch.concluidoEm = Timestamp.now();
    patch.devolvido = options.devolvido === true;
    patch.dadosConclusao =
      options.permitirConclusaoSemDados === true
        ? null
        : options.dadosConclusao ?? null;
    if (observacaoLimpa) patch.observacaoConclusao = observacaoLimpa;
  } else if (novoStatus === 'pendente') {
    patch.iniciadoEm = null;
    patch.concluidoEm = null;
    patch.devolvido = null;
    patch.dadosConclusao = null;
    patch.observacaoInicio = null;
  }

  db.processos.update(processoId, patch);
}

export interface EnviarProcessoParaCoordenacaoInput {
  processoId: string;
  byUid: string;
  byNome: string;
  byEmail?: string | null;
  observacao?: string | null;
}

export async function enviarProcessoParaCoordenacao(
  input: EnviarProcessoParaCoordenacaoInput
): Promise<void> {
  const before = db.processos.get(input.processoId);
  if (!before) return;

  const observacaoLimpa = input.observacao?.trim() || null;
  const now = Timestamp.now();
  db.processos.update(input.processoId, {
    status: 'em_coordenacao',
    coordenacaoEnviadoEm: now,
    coordenacaoEnviadoPorUid: input.byUid,
    coordenacaoEnviadoPorNome: input.byNome,
    coordenacaoEnviadoPorEmail: input.byEmail ?? null,
    coordenacaoUltimaAcaoEm: now,
    coordenacaoUltimaAcaoPorUid: input.byUid,
    coordenacaoUltimaAcaoPorNome: input.byNome,
    coordenacaoUltimaObservacao: observacaoLimpa,
    updatedAt: now,
  });
}

export interface AcaoCoordenacaoProcessoInput {
  processoId: string;
  byUid: string;
  byNome: string;
  observacao?: string | null;
}

export async function devolverProcessoDaCoordenacao(
  input: AcaoCoordenacaoProcessoInput
): Promise<void> {
  const before = db.processos.get(input.processoId);
  if (!before) return;

  const observacaoLimpa = input.observacao?.trim() || null;
  const now = Timestamp.now();
  db.processos.update(input.processoId, {
    status: 'em_andamento',
    concluidoEm: null,
    devolvido: null,
    coordenacaoUltimaAcaoEm: now,
    coordenacaoUltimaAcaoPorUid: input.byUid,
    coordenacaoUltimaAcaoPorNome: input.byNome,
    coordenacaoUltimaObservacao: observacaoLimpa,
    updatedAt: now,
  });
}

export async function colocarProcessoCoordenacaoEmEspera(
  input: AcaoCoordenacaoProcessoInput
): Promise<void> {
  const before = db.processos.get(input.processoId);
  if (!before) return;

  const observacaoLimpa = input.observacao?.trim() || null;
  const now = Timestamp.now();
  db.processos.update(input.processoId, {
    status: 'em_espera',
    coordenacaoUltimaAcaoEm: now,
    coordenacaoUltimaAcaoPorUid: input.byUid,
    coordenacaoUltimaAcaoPorNome: input.byNome,
    coordenacaoUltimaObservacao: observacaoLimpa,
    updatedAt: now,
  });
}

export async function concluirProcessoPelaCoordenacao(
  input: AcaoCoordenacaoProcessoInput
): Promise<void> {
  const before = db.processos.get(input.processoId);
  if (!before) return;

  const observacaoLimpa = input.observacao?.trim() || null;
  const now = Timestamp.now();
  const patch: Partial<Processo> = {
    status: 'concluido',
    concluidoEm: now,
    devolvido: false,
    coordenacaoUltimaAcaoEm: now,
    coordenacaoUltimaAcaoPorUid: input.byUid,
    coordenacaoUltimaAcaoPorNome: input.byNome,
    coordenacaoUltimaObservacao: observacaoLimpa,
    updatedAt: now,
  };
  if (observacaoLimpa) patch.observacaoConclusao = observacaoLimpa;
  db.processos.update(input.processoId, patch);
}

export interface RenovarPrazoProcessoInput {
  processoId: string;
  prazoDiasUteis: number;
  feriadosIso: string[];
  byUid: string;
  byNome: string;
}

export async function renovarPrazoProcesso(
  input: RenovarPrazoProcessoInput
): Promise<{ prazoFinal: Date }> {
  const base = nowInSp();
  const prazoDias = Math.max(0, input.prazoDiasUteis);
  const novoPrazoFinal = addDiasUteis(base, prazoDias, input.feriadosIso);

  if (db.processos.get(input.processoId)) {
    db.processos.update(input.processoId, {
      prazoFinal: Timestamp.fromDate(novoPrazoFinal),
      updatedAt: Timestamp.now(),
    });
  }

  return { prazoFinal: novoPrazoFinal };
}

export interface MarcarProcessoUrgenteInput {
  processoId: string;
  byUid: string;
  byNome: string;
}

export async function marcarProcessoUrgente(
  input: MarcarProcessoUrgenteInput
): Promise<void> {
  const before = db.processos.get(input.processoId);
  if (!before || before.urgente) return;
  db.processos.update(input.processoId, {
    urgente: true,
    updatedAt: Timestamp.now(),
  });
}

export interface DesmarcarProcessoUrgenteInput {
  processoId: string;
  byUid: string;
  byNome: string;
}

export async function desmarcarProcessoUrgente(
  input: DesmarcarProcessoUrgenteInput
): Promise<void> {
  const before = db.processos.get(input.processoId);
  if (!before || !before.urgente) return;
  db.processos.update(input.processoId, {
    urgente: false,
    updatedAt: Timestamp.now(),
  });
}

export async function getProcessosByNumeros(
  numeros: string[]
): Promise<Processo[]> {
  const unique = new Set(numeros.map((n) => n.trim()).filter(Boolean));
  if (unique.size === 0) return [];
  return db.processos.find((p) => unique.has(p.numero));
}

export async function getProcessosPendentesEmAndamentoOuCoordenacao(): Promise<
  Processo[]
> {
  const list = db.processos.find((p) =>
    ['pendente', 'em_andamento', 'em_coordenacao'].includes(p.status)
  );
  list.sort((a, b) => {
    const da = millis(a.diaAtribuicao);
    const db2 = millis(b.diaAtribuicao);
    if (da !== db2) return da - db2;
    return a.numero.localeCompare(b.numero);
  });
  return list;
}

export async function getProcessosByDistribuicaoIds(
  distribuicaoIds: string[]
): Promise<Processo[]> {
  const unique = new Set(distribuicaoIds.map((id) => id.trim()).filter(Boolean));
  if (unique.size === 0) return [];
  return db.processos.find(
    (p) => p.distribuicaoId != null && unique.has(p.distribuicaoId)
  );
}

export async function deleteProcessosByIds(
  ids: string[],
  byUid: string,
  byNome: string
): Promise<void> {
  const unique = Array.from(new Set(ids));
  for (const id of unique) db.processos.remove(id);
}

/** Subscribes to all processos in a given ISO week. */
export function subscribeProcessosBySemana(
  semanaIso: string,
  callback: (list: Processo[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  return db.processos.subscribe(callback, (p) => p.semanaIso === semanaIso);
}

/**
 * Subscribes to a recebedor's processos. If semanaIso is null, returns all
 * processos for that recebedor; otherwise filters by week as well.
 */
export function subscribeProcessosByRecebedor(
  recebedorUid: string,
  semanaIso: string | null,
  callback: (list: Processo[]) => void
): Unsubscribe {
  return db.processos.subscribe(callback, (p) =>
    semanaIso === null
      ? p.recebedorUid === recebedorUid
      : p.recebedorUid === recebedorUid && p.semanaIso === semanaIso
  );
}

/** Subscribe (realtime) aos processos ABERTOS de um recebedor (qualquer data). */
export function subscribeProcessosAbertosByRecebedor(
  recebedorUid: string,
  callback: (list: Processo[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  return db.processos.subscribe(
    callback,
    (p) => p.recebedorUid === recebedorUid && STATUS_ABERTOS.includes(p.status as never)
  );
}

/**
 * Subscribe (realtime) aos processos de um recebedor atribuídos a partir de
 * `sinceIso` (inclusive), por `diaAtribuicao`.
 */
export function subscribeProcessosByRecebedorDesde(
  recebedorUid: string,
  sinceIso: string,
  callback: (list: Processo[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const since = parseIsoDateLocal(sinceIso).getTime();
  return db.processos.subscribe(
    (list) => {
      list.sort((a, b) => millis(b.diaAtribuicao) - millis(a.diaAtribuicao));
      callback(list);
    },
    (p) => p.recebedorUid === recebedorUid && millis(p.diaAtribuicao) >= since
  );
}

/**
 * Busca única dos concluídos MAIS RECENTES de um recebedor (sem realtime).
 * Retorna no máximo `HISTORICO_RECEBEDOR_LIMITE + 1` docs (o "+1" sinaliza à UI
 * que há mais que o limite), por `concluidoEm` desc.
 */
export async function getProcessosConcluidosByRecebedor(
  recebedorUid: string
): Promise<Processo[]> {
  const list = db.processos.find(
    (p) => p.recebedorUid === recebedorUid && p.status === 'concluido'
  );
  list.sort((a, b) => millis(b.concluidoEm) - millis(a.concluidoEm));
  return list.slice(0, HISTORICO_RECEBEDOR_LIMITE + 1);
}

export function subscribeProcessosNaoAtribuidos(
  callback: (list: Processo[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  return db.processos.subscribe(
    (list) => {
      list.sort(compararPrioridadeFilaNaoAtribuidos);
      callback(list);
    },
    (p) => p.status === 'nao_atribuido'
  );
}

export function subscribeProcessosAbertos(
  callback: (list: Processo[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  return db.processos.subscribe(
    (list) => {
      list.sort((a, b) => millis(a.diaAtribuicao) - millis(b.diaAtribuicao));
      callback(list);
    },
    (p) => STATUS_ABERTOS.includes(p.status as never)
  );
}

export function subscribeProcessosCoordenacao(
  callback: (list: Processo[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  return db.processos.subscribe(
    (list) => {
      list.sort(compararCoordenacaoDesc);
      callback(list);
    },
    (p) => COORDENACAO_STATUSES.includes(p.status as never)
  );
}

export function subscribeProcessosNaCoordenacao(
  callback: (list: Processo[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  return db.processos.subscribe(
    (list) => {
      list.sort(compararCoordenacaoDesc);
      callback(list);
    },
    (p) => p.status === 'em_coordenacao'
  );
}

/**
 * Reads processos assigned within a date range (inclusive of start, exclusive
 * of end). startIso/endIso are ISO date strings ("YYYY-MM-DD").
 */
export async function getProcessosByPeriodo(
  startIso: string,
  endIso: string
): Promise<Processo[]> {
  const start = parseIsoDateLocal(startIso).getTime();
  const end = parseIsoDateLocal(endIso).getTime();
  const list = db.processos.find((p) => {
    const d = millis(p.diaAtribuicao);
    return d >= start && d < end;
  });
  list.sort((a, b) => millis(a.diaAtribuicao) - millis(b.diaAtribuicao));
  return list;
}

/**
 * Subscribe (realtime) aos processos concluídos no período [startIso,
 * endExclusiveIso) por data de conclusão (concluidoEm).
 */
export function subscribeProcessosConcluidosNoPeriodo(
  startIso: string,
  endExclusiveIso: string,
  callback: (list: Processo[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const start = parseIsoDateLocal(startIso).getTime();
  const end = parseIsoDateLocal(endExclusiveIso).getTime();
  return db.processos.subscribe(callback, (p) => {
    if (!p.concluidoEm) return false;
    const c = p.concluidoEm.toMillis();
    return c >= start && c < end;
  });
}

/** Busca única dos processos concluídos no período [startIso, endExclusiveIso). */
export async function getProcessosConcluidosNoPeriodo(
  startIso: string,
  endExclusiveIso: string
): Promise<Processo[]> {
  const start = parseIsoDateLocal(startIso).getTime();
  const end = parseIsoDateLocal(endExclusiveIso).getTime();
  return db.processos.find((p) => {
    if (!p.concluidoEm) return false;
    const c = p.concluidoEm.toMillis();
    return c >= start && c < end;
  });
}

export async function getAllProcessos(): Promise<Processo[]> {
  const list = db.processos.all();
  list.sort((a, b) => millis(a.diaAtribuicao) - millis(b.diaAtribuicao));
  return list;
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
