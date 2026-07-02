import type {
  Agrupador,
  DiaSemana,
  ProcessoRegime,
  ProcessoStatus,
  User
} from '@/types';
import type { ParsedRow } from '@/lib/csv';
import {
  addDiasUteis,
  getSemanaIso,
  parseIsoDateLocal,
  proximaOcorrenciaDia
} from '@/lib/datetime';

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export interface InputDistribuicao {
  rows: ParsedRow[];
  quotasPorRecebedor: QuotasPorRecebedorDia;
  limitesAgrupadorPorPessoaDia?: LimitesAgrupadorPorPessoaDia;
  recebedoresAtivos: User[];
  agrupadores: Agrupador[];
  prazoPadraoDiasUteis: number;
  feriadosIso: string[];
  regime: ProcessoRegime;
  /** "YYYY-MM-DD" usado como data-base de visibilidade da distribuição. */
  dataBaseIso: string;
  /** "YYYY-MM-DD" do último dia permitido para visibilidade da distribuição. */
  dataFinalIso: string;
}

export type ModoDataManual = 'dia_semana' | 'data_fixa';

export interface AtribuicaoManualDistribuicao {
  agrupadorNome: string;
  recebedorUid: string;
  quantidade: number;
  diaSemana: DiaSemana;
}

export interface ConfigManualAgrupadorDistribuicao {
  agrupadorNome: string;
  dividirSemana: boolean;
  dataFinalIso: string;
}

export interface InputDistribuicaoManual {
  rows: ParsedRow[];
  nomesAgrupadores: string[];
  atribuicoes: AtribuicaoManualDistribuicao[];
  configAgrupadores?: ConfigManualAgrupadorDistribuicao[];
  agrupadores: Agrupador[];
  prazoPadraoDiasUteis: number;
  feriadosIso: string[];
  regime: ProcessoRegime;
  dataBaseIso: string;
  dataFixaIso: string;
  modoData: ModoDataManual;
}

export type QuotasPorRecebedorDia = Record<string, Record<DiaSemana, number>>;

export type LimitesAgrupadorPorPessoaDia = Record<string, number>;

export type DiasAtivosDistribuicao = Record<DiaSemana, boolean>;

export interface PreparedProcesso {
  numero: string;
  agrupadorId: string;
  agrupadorNome: string;
  urgente: boolean;
  prioridade: boolean;
  regime: ProcessoRegime;
  recebedorUid: string | null;
  diaSemana: DiaSemana;
  status: ProcessoStatus;
  origem: 'csv';
  distribuicaoId: string | null;
  diaAtribuicao: Date;
  prazoFinal: Date;
  semanaIso: string;
  concluidoEm: null;
  iniciadoEm: null;
  ordemCsv: number;
  adicionadoPorUid: null;
  observacao: null;
}

export interface ResumoDistribuicao {
  porDia: Record<DiaSemana, number>;
  porAgrupador: Record<string, number>;
  porRecebedor: Record<string, number>;
  urgentes: number;
  prioridades: number;
  naoAtribuidos: number;
}

export interface SimulacaoResult {
  atribuicoes: PreparedProcesso[];
  resumo: ResumoDistribuicao;
  excedeuQuota: boolean;
  totalQuota: number;
  totalProcessos: number;
  datasPorDia: Record<DiaSemana, Date>;
  diasAtivos: DiasAtivosDistribuicao;
  agrupadoresNaoCadastrados: string[];
}

export interface ResumoManualAgrupador {
  agrupadorNome: string;
  disponiveis: number;
  atribuido: number;
  criados: number;
  descartados: number;
  excedente: number;
  cadastrado: boolean;
}

export interface SimulacaoManualResult extends SimulacaoResult {
  modoData: ModoDataManual;
  descartadosSemAtribuicao: number;
  excedentesManuais: number;
  totalCriar: number;
  resumoManualAgrupadores: ResumoManualAgrupador[];
}

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

export const DIAS_SEMANA: readonly DiaSemana[] = [
  'segunda',
  'terca',
  'quarta',
  'quinta',
  'sexta'
] as const;

export const NAO_ATRIBUIDO_KEY = 'NAO_ATRIBUIDO';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface BucketRow {
  row: ParsedRow;
  diaSemana: DiaSemana;
}

function emptyDiaCounts(): Record<DiaSemana, number> {
  return {
    segunda: 0,
    terca: 0,
    quarta: 0,
    quinta: 0,
    sexta: 0
  };
}

function emptyDiasAtivos(): DiasAtivosDistribuicao {
  return {
    segunda: false,
    terca: false,
    quarta: false,
    quinta: false,
    sexta: false
  };
}

export function criarContagemDiasVazia(): Record<DiaSemana, number> {
  return emptyDiaCounts();
}

export function somarQuotasPorDia(
  quotasPorRecebedor: QuotasPorRecebedorDia,
  recebedorUids?: string[],
  diasAtivos?: DiasAtivosDistribuicao
): Record<DiaSemana, number> {
  const out = emptyDiaCounts();
  const uids = recebedorUids ?? Object.keys(quotasPorRecebedor);
  for (const uid of uids) {
    const quotas = quotasPorRecebedor[uid];
    if (!quotas) continue;
    for (const dia of DIAS_SEMANA) {
      if (diasAtivos && !diasAtivos[dia]) continue;
      out[dia] += Math.max(0, quotas[dia] ?? 0);
    }
  }
  return out;
}

export function somarTotalQuotas(
  quotasPorRecebedor: QuotasPorRecebedorDia,
  recebedorUids?: string[],
  diasAtivos?: DiasAtivosDistribuicao
): number {
  const totais = somarQuotasPorDia(
    quotasPorRecebedor,
    recebedorUids,
    diasAtivos
  );
  return DIAS_SEMANA.reduce((sum, dia) => sum + totais[dia], 0);
}

export function calcularDatasDistribuicao(
  dataBaseIso: string
): Record<DiaSemana, Date> {
  const base = parseIsoDateLocal(dataBaseIso);
  return {
    segunda: proximaOcorrenciaDia('segunda', base),
    terca: proximaOcorrenciaDia('terca', base),
    quarta: proximaOcorrenciaDia('quarta', base),
    quinta: proximaOcorrenciaDia('quinta', base),
    sexta: proximaOcorrenciaDia('sexta', base)
  };
}

export function calcularDiasAtivosDistribuicao(
  dataBaseIso: string,
  dataFinalIso: string
): DiasAtivosDistribuicao {
  if (!dataBaseIso || !dataFinalIso || dataFinalIso < dataBaseIso) {
    return emptyDiasAtivos();
  }
  const datasPorDia = calcularDatasDistribuicao(dataBaseIso);
  const dataFinal = parseIsoDateLocal(dataFinalIso);
  return {
    segunda: datasPorDia.segunda.getTime() <= dataFinal.getTime(),
    terca: datasPorDia.terca.getTime() <= dataFinal.getTime(),
    quarta: datasPorDia.quarta.getTime() <= dataFinal.getTime(),
    quinta: datasPorDia.quinta.getTime() <= dataFinal.getTime(),
    sexta: datasPorDia.sexta.getTime() <= dataFinal.getTime()
  };
}

export function diaSemanaFromDate(date: Date): DiaSemana | null {
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
      return null;
  }
}

function cloneDateOnly(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isValidDate(date: Date | null): date is Date {
  return date instanceof Date && !Number.isNaN(date.getTime());
}

function datasUteisNoIntervalo(dataInicial: Date, dataFinal: Date): Date[] {
  const out: Date[] = [];
  const cursor = cloneDateOnly(dataInicial);
  const limite = cloneDateOnly(dataFinal);
  while (cursor.getTime() <= limite.getTime()) {
    if (diaSemanaFromDate(cursor)) {
      out.push(cloneDateOnly(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

/**
 * Distribui rows em buckets diários respeitando quotas nos dias ativos, em
 * ordem cronológica de visibilidade.
 * Quando todos os dias atingem a quota, o restante é distribuído rotativamente
 * dentro desse mesmo intervalo. A flag excedeuQuota fica true se houver
 * processos extras alocados na fase rotativa.
 */
function bucketRowsByDia(
  rows: ParsedRow[],
  quotasTotaisPorDia: Record<DiaSemana, number>,
  diasAtivos: DiasAtivosDistribuicao,
  datasPorDia: Record<DiaSemana, Date>
): { buckets: BucketRow[]; excedeuQuota: boolean; totalQuota: number } {
  const diasParaDistribuir = DIAS_SEMANA.filter((dia) => diasAtivos[dia]).sort(
    (a, b) => datasPorDia[a].getTime() - datasPorDia[b].getTime()
  );
  const totalQuota = DIAS_SEMANA.reduce(
    (sum, d) => sum + Math.max(0, quotasTotaisPorDia[d] ?? 0),
    0
  );

  if (diasParaDistribuir.length === 0) {
    return {
      buckets: [],
      excedeuQuota: rows.length > 0,
      totalQuota
    };
  }

  const counts = emptyDiaCounts();
  const buckets: BucketRow[] = [];
  let excedeuQuota = false;

  // Fase 1 — preenche cada dia até a quota, em ordem de chegada (CSV).
  let cursorDia = 0;
  let pendingIndex = 0;
  for (; pendingIndex < rows.length; pendingIndex += 1) {
    let placed = false;
    for (let attempt = 0; attempt < diasParaDistribuir.length; attempt += 1) {
      const dia = diasParaDistribuir[cursorDia];
      const cap = Math.max(0, quotasTotaisPorDia[dia] ?? 0);
      if (counts[dia] < cap) {
        buckets.push({ row: rows[pendingIndex], diaSemana: dia });
        counts[dia] += 1;
        placed = true;
        // Se cumpriu a quota neste dia, segue para o próximo. Caso contrário,
        // mantém para deixar o dia "absorver" enquanto pode.
        if (counts[dia] >= cap) {
          cursorDia = (cursorDia + 1) % diasParaDistribuir.length;
        }
        break;
      }
      cursorDia = (cursorDia + 1) % diasParaDistribuir.length;
    }
    if (!placed) {
      // Todos os dias estão lotados — entra na fase 2.
      break;
    }
  }

  // Fase 2 — overflow rotativo Seg→Sex repetindo.
  let rotIndex = 0;
  for (; pendingIndex < rows.length; pendingIndex += 1) {
    const dia = diasParaDistribuir[rotIndex % diasParaDistribuir.length];
    buckets.push({ row: rows[pendingIndex], diaSemana: dia });
    counts[dia] += 1;
    excedeuQuota = true;
    rotIndex += 1;
  }

  // Caso especial — total das quotas é zero. Distribui tudo rotativamente.
  if (totalQuota === 0 && rows.length > 0) {
    excedeuQuota = true;
  }

  return { buckets, excedeuQuota, totalQuota };
}

/**
 * Particiona recebedores ativos em Tier 2 (modo='todos') uma única vez —
 * ordem estável é a do array de entrada (subscribeAllUsers já ordena por
 * displayName, então isso preserva a ordem alfabética).
 */
function buildTier2(recebedores: User[]): User[] {
  return recebedores.filter(
    (u) =>
      u.agrupadoresMode === 'todos' ||
      (u.role === 'distribuidor' && u.agrupadoresMode !== 'especificos')
  );
}

/**
 * Tier 1 para um agrupador específico: recebedores com modo='especificos'
 * cuja lista contém o agrupadorId.
 */
function buildTier1ForAgrupador(
  recebedores: User[],
  agrupadorId: string
): User[] {
  if (!agrupadorId) return [];
  return recebedores.filter(
    (u) =>
      u.agrupadoresMode === 'especificos' &&
      u.agrupadoresPermitidos.includes(agrupadorId)
  );
}

// ---------------------------------------------------------------------------
// Função principal
// ---------------------------------------------------------------------------

/**
 * Simula uma distribuição completa. Pura, sem efeitos: dado o input, devolve
 * o resultado determinístico.
 */
export function simularDistribuicao(input: InputDistribuicao): SimulacaoResult {
  const {
    rows,
    quotasPorRecebedor,
    limitesAgrupadorPorPessoaDia = {},
    recebedoresAtivos,
    agrupadores,
    prazoPadraoDiasUteis,
    feriadosIso,
    regime,
    dataBaseIso,
    dataFinalIso
  } = input;

  // 1) Mapa de agrupadores por nome (case-insensitive).
  const agrupadorByNomeLower = new Map<string, Agrupador>();
  for (const a of agrupadores) {
    agrupadorByNomeLower.set(a.nome.trim().toLowerCase(), a);
  }
  const limitesByNomeLower = new Map<string, number>();
  for (const [nome, limite] of Object.entries(limitesAgrupadorPorPessoaDia)) {
    const safe = Math.max(0, Math.floor(limite || 0));
    if (safe > 0) {
      limitesByNomeLower.set(nome.trim().toLowerCase(), safe);
    }
  }

  // 2) Detectar agrupadores não-cadastrados.
  const naoCadastradosSet = new Set<string>();
  for (const r of rows) {
    if (!agrupadorByNomeLower.has(r.agrupadorNome.trim().toLowerCase())) {
      naoCadastradosSet.add(r.agrupadorNome);
    }
  }
  const agrupadoresNaoCadastrados = Array.from(naoCadastradosSet);

  const dataPorDia = calcularDatasDistribuicao(dataBaseIso);
  const diasAtivos = calcularDiasAtivosDistribuicao(dataBaseIso, dataFinalIso);

  // 3) Bucketing por dia (preserva ordem do CSV).
  const recebedorUids = recebedoresAtivos.map((u) => u.uid);
  const quotasTotaisPorDia = somarQuotasPorDia(
    quotasPorRecebedor,
    recebedorUids,
    diasAtivos
  );
  const { buckets, excedeuQuota, totalQuota } = bucketRowsByDia(
    rows,
    quotasTotaisPorDia,
    diasAtivos,
    dataPorDia
  );

  // 4) Round-robin por dia, com tiers.
  const tier2 = buildTier2(recebedoresAtivos);
  // Cache de Tier 1 por agrupadorId — evita recomputar.
  const tier1Cache = new Map<string, User[]>();
  function getTier1(agrupadorId: string): User[] {
    if (tier1Cache.has(agrupadorId)) {
      return tier1Cache.get(agrupadorId) ?? [];
    }
    const arr = buildTier1ForAgrupador(recebedoresAtivos, agrupadorId);
    tier1Cache.set(agrupadorId, arr);
    return arr;
  }

  // Cursores round-robin: um por dia+agrupadorId (Tier 1) + um por dia (Tier 2).
  const tier1Cursor = new Map<string, number>();
  const tier2Cursor = new Map<DiaSemana, number>();

  const remainingByUid = new Map<string, Record<DiaSemana, number>>();
  for (const uid of recebedorUids) {
    const quotas = quotasPorRecebedor[uid] ?? emptyDiaCounts();
    remainingByUid.set(uid, {
      segunda: diasAtivos.segunda ? Math.max(0, quotas.segunda ?? 0) : 0,
      terca: diasAtivos.terca ? Math.max(0, quotas.terca ?? 0) : 0,
      quarta: diasAtivos.quarta ? Math.max(0, quotas.quarta ?? 0) : 0,
      quinta: diasAtivos.quinta ? Math.max(0, quotas.quinta ?? 0) : 0,
      sexta: diasAtivos.sexta ? Math.max(0, quotas.sexta ?? 0) : 0
    });
  }

  function hasRemaining(uid: string, dia: DiaSemana): boolean {
    return (remainingByUid.get(uid)?.[dia] ?? 0) > 0;
  }

  function consumeRemaining(uid: string, dia: DiaSemana) {
    const remaining = remainingByUid.get(uid);
    if (!remaining) return;
    remaining[dia] = Math.max(0, remaining[dia] - 1);
  }

  const usedAgrupadorByUidDia = new Map<string, number>();

  function agrupadorLimitKey(
    uid: string,
    dia: DiaSemana,
    agrupadorNomeLower: string
  ): string {
    return `${uid}:${dia}:${agrupadorNomeLower}`;
  }

  function hasAgrupadorCapacity(
    uid: string,
    dia: DiaSemana,
    agrupadorNomeLower: string
  ): boolean {
    const limite = limitesByNomeLower.get(agrupadorNomeLower);
    if (!limite) return true;
    const key = agrupadorLimitKey(uid, dia, agrupadorNomeLower);
    return (usedAgrupadorByUidDia.get(key) ?? 0) < limite;
  }

  function consumeAgrupadorCapacity(
    uid: string,
    dia: DiaSemana,
    agrupadorNomeLower: string
  ) {
    const limite = limitesByNomeLower.get(agrupadorNomeLower);
    if (!limite) return;
    const key = agrupadorLimitKey(uid, dia, agrupadorNomeLower);
    usedAgrupadorByUidDia.set(key, (usedAgrupadorByUidDia.get(key) ?? 0) + 1);
  }

  // 5) Processa buckets em ORDEM DE BUCKET (que preserva a ordem do CSV
  // dentro de cada dia, pois bucketRowsByDia preenche em ordem).
  // Para round-robin determinístico, percorremos cada dia separadamente em
  // sequência de chegada CSV.
  const atribuicoes: PreparedProcesso[] = [];

  // Agrupa buckets por dia preservando ordem do CSV dentro de cada dia.
  const bucketsPorDia: Record<DiaSemana, BucketRow[]> = {
    segunda: [],
    terca: [],
    quarta: [],
    quinta: [],
    sexta: []
  };
  for (const b of buckets) {
    bucketsPorDia[b.diaSemana].push(b);
  }

  const diasProcessamento = DIAS_SEMANA.filter(
    (dia) => bucketsPorDia[dia].length > 0
  ).sort((a, b) => dataPorDia[a].getTime() - dataPorDia[b].getTime());

  for (const dia of diasProcessamento) {
    for (const item of bucketsPorDia[dia]) {
      const { row } = item;
      const lookup = agrupadorByNomeLower.get(
        row.agrupadorNome.trim().toLowerCase()
      );
      const agrupadorNomeLower = row.agrupadorNome.trim().toLowerCase();
      const agrupadorId = lookup?.id ?? '';
      const agrupadorNomeFinal = lookup?.nome ?? row.agrupadorNome;

      // Tier 1 → Tier 2 → null.
      let recebedorUid: string | null = null;
      const t1 = agrupadorId
        ? getTier1(agrupadorId).filter(
            (u) =>
              hasRemaining(u.uid, dia) &&
              hasAgrupadorCapacity(u.uid, dia, agrupadorNomeLower)
          )
        : [];
      if (t1.length > 0) {
        const cursorKey = `${dia}:${agrupadorId}`;
        const idx = tier1Cursor.get(cursorKey) ?? 0;
        const selected = t1[idx % t1.length];
        recebedorUid = selected.uid;
        consumeRemaining(selected.uid, dia);
        consumeAgrupadorCapacity(selected.uid, dia, agrupadorNomeLower);
        tier1Cursor.set(cursorKey, idx + 1);
      } else {
        const t2 = tier2.filter(
          (u) =>
            hasRemaining(u.uid, dia) &&
            hasAgrupadorCapacity(u.uid, dia, agrupadorNomeLower)
        );
        if (t2.length > 0) {
          const idx = tier2Cursor.get(dia) ?? 0;
          const selected = t2[idx % t2.length];
          recebedorUid = selected.uid;
          consumeRemaining(selected.uid, dia);
          consumeAgrupadorCapacity(selected.uid, dia, agrupadorNomeLower);
          tier2Cursor.set(dia, idx + 1);
        }
      }

      // Datas.
      const diaAtribuicao = dataPorDia[dia];
      const prazoDias = lookup?.prazoDiasUteisOverride ?? prazoPadraoDiasUteis;
      const prazoFinal = addDiasUteis(diaAtribuicao, prazoDias, feriadosIso);
      const semanaIso = getSemanaIso(diaAtribuicao);

      atribuicoes.push({
        numero: row.numero,
        agrupadorId,
        agrupadorNome: agrupadorNomeFinal,
        urgente: row.urgente,
        prioridade: row.prioridade,
        regime,
        recebedorUid,
        diaSemana: dia,
        status: 'pendente',
        origem: 'csv',
        distribuicaoId: null,
        diaAtribuicao,
        prazoFinal,
        semanaIso,
        concluidoEm: null,
        iniciadoEm: null,
        ordemCsv: row.ordemCsv,
        adicionadoPorUid: null,
        observacao: null
      });
    }
  }

  // 6) Resumo.
  const resumo: ResumoDistribuicao = {
    porDia: emptyDiaCounts(),
    porAgrupador: {},
    porRecebedor: {},
    urgentes: 0,
    prioridades: 0,
    naoAtribuidos: 0
  };
  for (const p of atribuicoes) {
    resumo.porDia[p.diaSemana] += 1;
    resumo.porAgrupador[p.agrupadorNome] =
      (resumo.porAgrupador[p.agrupadorNome] ?? 0) + 1;
    if (p.urgente) resumo.urgentes += 1;
    if (p.prioridade) resumo.prioridades += 1;
    if (p.recebedorUid === null) {
      resumo.naoAtribuidos += 1;
      resumo.porRecebedor[NAO_ATRIBUIDO_KEY] =
        (resumo.porRecebedor[NAO_ATRIBUIDO_KEY] ?? 0) + 1;
    } else {
      resumo.porRecebedor[p.recebedorUid] =
        (resumo.porRecebedor[p.recebedorUid] ?? 0) + 1;
    }
  }

  return {
    atribuicoes,
    resumo,
    excedeuQuota,
    totalQuota,
    totalProcessos: rows.length,
    datasPorDia: dataPorDia,
    diasAtivos,
    agrupadoresNaoCadastrados
  };
}

export function simularDistribuicaoManual(
  input: InputDistribuicaoManual
): SimulacaoManualResult {
  const {
    rows,
    nomesAgrupadores,
    atribuicoes,
    configAgrupadores = [],
    agrupadores,
    prazoPadraoDiasUteis,
    feriadosIso,
    regime,
    dataBaseIso,
    dataFixaIso,
    modoData
  } = input;

  const agrupadorByNomeLower = new Map<string, Agrupador>();
  for (const a of agrupadores) {
    agrupadorByNomeLower.set(a.nome.trim().toLowerCase(), a);
  }

  const agrupadoresNaoCadastrados = nomesAgrupadores.filter(
    (nome) => !agrupadorByNomeLower.has(nome.trim().toLowerCase())
  );

  const rowsByAgrupador = new Map<string, ParsedRow[]>();
  for (const row of rows) {
    const key = row.agrupadorNome.trim().toLowerCase();
    const bucket = rowsByAgrupador.get(key) ?? [];
    bucket.push(row);
    rowsByAgrupador.set(key, bucket);
  }

  const atribuicoesByAgrupador = new Map<
    string,
    AtribuicaoManualDistribuicao[]
  >();
  for (const atribuicao of atribuicoes) {
    const key = atribuicao.agrupadorNome.trim().toLowerCase();
    const bucket = atribuicoesByAgrupador.get(key) ?? [];
    bucket.push(atribuicao);
    atribuicoesByAgrupador.set(key, bucket);
  }

  const configByAgrupador = new Map<
    string,
    ConfigManualAgrupadorDistribuicao
  >();
  for (const config of configAgrupadores) {
    configByAgrupador.set(config.agrupadorNome.trim().toLowerCase(), config);
  }

  const datasPorDia =
    modoData === 'data_fixa'
      ? (() => {
          const dataFixa = parseIsoDateLocal(dataFixaIso);
          const base = calcularDatasDistribuicao(dataFixaIso);
          const diaFixo = diaSemanaFromDate(dataFixa);
          return diaFixo ? { ...base, [diaFixo]: dataFixa } : base;
        })()
      : calcularDatasDistribuicao(dataBaseIso);

  const diasAtivos: DiasAtivosDistribuicao =
    modoData === 'data_fixa'
      ? (() => {
          const out = emptyDiasAtivos();
          const diaFixo = diaSemanaFromDate(parseIsoDateLocal(dataFixaIso));
          if (diaFixo) out[diaFixo] = true;
          return out;
        })()
      : {
          segunda: true,
          terca: true,
          quarta: true,
          quinta: true,
          sexta: true
        };

  const dataFixa =
    modoData === 'data_fixa' ? parseIsoDateLocal(dataFixaIso) : null;
  const diaFixo = dataFixa ? diaSemanaFromDate(dataFixa) : null;
  const atribuicoesPreparadas: PreparedProcesso[] = [];
  const resumoManualAgrupadores: ResumoManualAgrupador[] = [];

  for (const agrupadorNome of nomesAgrupadores) {
    const key = agrupadorNome.trim().toLowerCase();
    const rowsDoAgrupador = rowsByAgrupador.get(key) ?? [];
    const config = atribuicoesByAgrupador.get(key) ?? [];
    const configGrupo = configByAgrupador.get(key);
    const lookup = agrupadorByNomeLower.get(key);
    const dividirSemana =
      modoData === 'dia_semana' && Boolean(configGrupo?.dividirSemana);
    const dataFinalDivisao =
      dividirSemana && configGrupo?.dataFinalIso
        ? parseIsoDateLocal(configGrupo.dataFinalIso)
        : null;

    let cursor = 0;
    let totalSolicitado = 0;
    let totalCriadoAgrupador = 0;

    for (const bloco of config) {
      const quantidade = Math.max(0, Math.floor(bloco.quantidade || 0));
      totalSolicitado += quantidade;
      if (!bloco.recebedorUid || quantidade <= 0) continue;

      const dataInicialBloco =
        modoData === 'data_fixa' ? dataFixa : datasPorDia[bloco.diaSemana];
      if (!dataInicialBloco) continue;
      if (modoData === 'data_fixa' && !diaFixo) continue;

      let datasDoBloco = [dataInicialBloco];
      if (dividirSemana) {
        if (!isValidDate(dataFinalDivisao)) continue;
        datasDoBloco = datasUteisNoIntervalo(
          dataInicialBloco,
          dataFinalDivisao
        );
      }
      if (datasDoBloco.length === 0) continue;

      const rowsSelecionadas = rowsDoAgrupador.slice(
        cursor,
        cursor + quantidade
      );
      cursor += rowsSelecionadas.length;
      totalCriadoAgrupador += rowsSelecionadas.length;

      for (const [index, row] of rowsSelecionadas.entries()) {
        const diaAtribuicao = datasDoBloco[index % datasDoBloco.length];
        const diaSemana = diaSemanaFromDate(diaAtribuicao);
        if (!diaSemana) continue;
        const agrupadorId = lookup?.id ?? '';
        const agrupadorNomeFinal = lookup?.nome ?? row.agrupadorNome;
        const prazoDias =
          lookup?.prazoDiasUteisOverride ?? prazoPadraoDiasUteis;
        const prazoFinal = addDiasUteis(diaAtribuicao, prazoDias, feriadosIso);

        atribuicoesPreparadas.push({
          numero: row.numero,
          agrupadorId,
          agrupadorNome: agrupadorNomeFinal,
          urgente: row.urgente,
          prioridade: row.prioridade,
          regime,
          recebedorUid: bloco.recebedorUid,
          diaSemana,
          status: 'pendente',
          origem: 'csv',
          distribuicaoId: null,
          diaAtribuicao,
          prazoFinal,
          semanaIso: getSemanaIso(diaAtribuicao),
          concluidoEm: null,
          iniciadoEm: null,
          ordemCsv: row.ordemCsv,
          adicionadoPorUid: null,
          observacao: null
        });
      }
    }

    const disponiveis = rowsDoAgrupador.length;
    resumoManualAgrupadores.push({
      agrupadorNome,
      disponiveis,
      atribuido: totalSolicitado,
      criados: totalCriadoAgrupador,
      descartados: Math.max(0, disponiveis - totalCriadoAgrupador),
      excedente: Math.max(0, totalSolicitado - disponiveis),
      cadastrado: Boolean(lookup)
    });
  }

  const resumo: ResumoDistribuicao = {
    porDia: emptyDiaCounts(),
    porAgrupador: {},
    porRecebedor: {},
    urgentes: 0,
    prioridades: 0,
    naoAtribuidos: 0
  };
  for (const p of atribuicoesPreparadas) {
    resumo.porDia[p.diaSemana] += 1;
    resumo.porAgrupador[p.agrupadorNome] =
      (resumo.porAgrupador[p.agrupadorNome] ?? 0) + 1;
    resumo.porRecebedor[p.recebedorUid ?? NAO_ATRIBUIDO_KEY] =
      (resumo.porRecebedor[p.recebedorUid ?? NAO_ATRIBUIDO_KEY] ?? 0) + 1;
    if (p.urgente) resumo.urgentes += 1;
    if (p.prioridade) resumo.prioridades += 1;
  }

  const descartadosSemAtribuicao = resumoManualAgrupadores.reduce(
    (sum, item) => sum + item.descartados,
    0
  );
  const excedentesManuais = resumoManualAgrupadores.reduce(
    (sum, item) => sum + item.excedente,
    0
  );
  const totalSolicitado = resumoManualAgrupadores.reduce(
    (sum, item) => sum + item.atribuido,
    0
  );

  return {
    atribuicoes: atribuicoesPreparadas,
    resumo,
    excedeuQuota: excedentesManuais > 0,
    totalQuota: totalSolicitado,
    totalProcessos: rows.length,
    datasPorDia,
    diasAtivos,
    agrupadoresNaoCadastrados,
    modoData,
    descartadosSemAtribuicao,
    excedentesManuais,
    totalCriar: atribuicoesPreparadas.length,
    resumoManualAgrupadores
  };
}

/**
 * Ordena uma lista de PreparedProcesso para exibição: urgentes/prioridades primeiro,
 * depois ordem do CSV. NÃO muta o array original.
 */
export function ordenarParaPrevia(
  list: PreparedProcesso[]
): PreparedProcesso[] {
  return [...list].sort((a, b) => {
    const specialA = a.urgente || a.prioridade;
    const specialB = b.urgente || b.prioridade;
    if (specialA !== specialB) return specialA ? -1 : 1;
    return a.ordemCsv - b.ordemCsv;
  });
}
