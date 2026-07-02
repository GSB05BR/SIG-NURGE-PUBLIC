// Produtividade — pure aggregation helpers over Processo[] + User[].
//
// All functions are deterministic and side-effect-free; the page layer feeds
// in the latest data and a "now" Date (already projected to America/Sao_Paulo
// when needed). The page layer is also responsible for narrowing the dataset
// to the desired period.

import type { DiaSemana, Processo, User } from '@/types';
import { formatDateBr, parseIsoDateLocal } from '@/lib/datetime';
import { isAtrasado } from '@/lib/processo-helpers';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Recebedor flagged when their atrasados count strictly exceeds this limit. */
export const LIMITE_ATRASADOS = 5;

/** Recebedor flagged when their pendentes count strictly exceeds this limit. */
export const LIMITE_PENDENTES = 10;

/** Top-N agrupadores reported as "acumulando" in the alerts section. */
export const ACUMULANDO_TOP_N = 3;

const DIAS_SEMANA_ORDER: DiaSemana[] = [
  'segunda',
  'terca',
  'quarta',
  'quinta',
  'sexta',
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KPIs {
  total: number;
  seiJson: number;
  csv: number;
  manuais: number;
  pendentes: number;
  emAndamento: number;
  concluidos: number;
  atrasados: number;
  urgentes: number;
  prioridades: number;
  pctConclusao: number; // 0..100
}

export interface RecebedorStats {
  uid: string;
  nome: string;
  /**
   * Processos atribuídos ao recebedor no período filtrado (diaAtribuicao em
   * [start, end], em SP). Coluna "Distribuídos no dia/período".
   */
  distribuidosNoPeriodo: number;
  /**
   * Backlog: processos atribuídos ANTES do período e ainda não concluídos às
   * 23h59 da véspera do início do período. Registro histórico — reconstruído de
   * timestamps imutáveis, então não diminui quando concluídos depois. Coluna
   * "Pendentes até o dia anterior".
   */
  pendentesAnteriores: number;
  /** Total = distribuidosNoPeriodo + pendentesAnteriores (= concluidos + pendentes). */
  total: number;
  /** Itens do cohort concluídos até o fim do período (23h59 do último dia). */
  concluidos: number;
  /** Itens do cohort NÃO concluídos até o fim do período. */
  pendentes: number;
  /** Pendentes do cohort cujo prazoFinal já vencera no fim do período. */
  atrasados: number;
  urgentes: number;
  prioridades: number;
  manuais: number;
  pctConclusao: number;
}

export interface CalcularPorRecebedorOptions {
  /** Primeiro dia do período filtrado, ISO "YYYY-MM-DD" (SP), inclusivo. */
  periodoStartIso: string;
  /**
   * Último dia do período filtrado, ISO "YYYY-MM-DD" (SP), inclusivo — já
   * limitado a hoje pela camada de página (nunca um dia futuro). Define o
   * instante de referência (fim desse dia) usado para "congelar" as contagens.
   */
  periodoEndIso: string;
  /**
   * Quando `true` (período "Hoje"), as colunas Total e Pendentes passam a
   * representar a carga da manhã: Total = pendentes às 6h de hoje; Pendentes =
   * quantos desses ainda não foram concluídos (cai em tempo real). Fora do modo
   * Hoje, Total = distribuídos + pendentes anteriores e Pendentes = não
   * concluídos do cohort até o fim do período.
   */
  modoHoje?: boolean;
}

export interface SerieDiaria {
  /** "DD/MM" — display label. */
  data: string;
  /** "YYYY-MM-DD" — stable bucket key. */
  iso: string;
  /** Processos com status='concluido' e concluidoEm dentro do dia. */
  concluidos: number;
  /** Processos com diaAtribuicao dentro do dia. */
  distribuidos: number;
}

export interface AgrupadorStats {
  agrupadorId: string;
  agrupadorNome: string;
  total: number;
  concluidos: number;
}

export interface DiaSemanaStats {
  dia: DiaSemana;
  total: number;
}

export interface OrigemCadastroStats {
  recebedorUid: string;
  recebedorNome: string;
  seiJson: number;
  manual: number;
  legado: number;
}

export interface TempoMedioRecebedorStats {
  uid: string;
  nome: string;
  processosMedidos: number;
  mediaMs: number | null;
  menorMs: number | null;
  maiorMs: number | null;
}

export interface AlertasInfo {
  /** Recebedores cujos atrasados > LIMITE_ATRASADOS. */
  recebedoresMuitosAtrasados: RecebedorStats[];
  /** Recebedores cujos pendentes > LIMITE_PENDENTES. */
  recebedoresMuitosPendentes: RecebedorStats[];
  /** Top-3 agrupadores com maior backlog total. */
  agrupadoresAcumulando: {
    agrupadorId: string;
    agrupadorNome: string;
    total: number;
  }[];
}

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------

export function calcularKPIs(processos: Processo[], now: Date): KPIs {
  let csv = 0;
  let seiJson = 0;
  let manuais = 0;
  let pendentes = 0;
  let emAndamento = 0;
  let concluidos = 0;
  let atrasados = 0;
  let urgentes = 0;
  let prioridades = 0;

  for (const p of processos) {
    if (p.origem === 'sei_json') seiJson += 1;
    else if (p.origem === 'csv') csv += 1;
    else manuais += 1;

    if (p.status === 'pendente') pendentes += 1;
    else if (p.status === 'em_andamento') emAndamento += 1;
    else if (p.status === 'concluido') concluidos += 1;

    if (p.urgente) urgentes += 1;
    if (p.prioridade) prioridades += 1;
    if (isAtrasado(p, now)) atrasados += 1;
  }

  const total = processos.length;
  const pctConclusao = total > 0 ? (concluidos / total) * 100 : 0;

  return {
    total,
    seiJson,
    csv,
    manuais,
    pendentes,
    emAndamento,
    concluidos,
    atrasados,
    urgentes,
    prioridades,
    pctConclusao,
  };
}

// ---------------------------------------------------------------------------
// Por recebedor
// ---------------------------------------------------------------------------

/**
 * Returns one RecebedorStats per active recebedor (role='recebedor', ativo).
 *
 * Modelo "carga do período" (por data de atribuição, fuso SP fixo -03:00):
 *
 *  - O cohort de cada recebedor = (a) processos atribuídos DENTRO do período
 *    [start, end] + (b) o backlog: processos atribuídos ANTES do período e que
 *    ainda não tinham sido concluídos às 23h59 da véspera do início (start-1).
 *    Esses dois conjuntos são disjuntos (separados pela data de atribuição).
 *
 *  - As contagens são "congeladas" no FIM do período (23h59 do último dia, que
 *    a página limita a hoje). Como `concluidoEm` nunca está no futuro, usar o
 *    fim do dia como corte exclusivo dá, para hoje, exatamente "concluídos até
 *    agora" — a atualização em tempo real vem da assinatura de dados, só no dia
 *    presente; para dias passados o resultado é determinístico e imutável.
 *
 *  - Concluídos = processos concluídos DENTRO do período por data de conclusão
 *    (independe da data de atribuição); como todo cohort concluído tem
 *    concluidoEm >= início do período, contar o cohort concluído equivale a isso.
 *
 *  - Total = distribuidosNoPeriodo + pendentesAnteriores = concluidos + pendentes
 *    (modo padrão). No modo Hoje (`modoHoje`), Total = pendentes às 6h da manhã
 *    e Pendentes = quantos desses ainda não foram concluídos (tempo real).
 *
 * Recebedores sem processos continuam na lista para o ranking mostrar todo o
 * time. Ordenado por concluidos desc, total desc, nome asc.
 *
 * Observação de janela: o cohort/6h só enxergam os processos presentes em
 * `processos`. A camada de página une ao dataset os processos abertos (qualquer
 * data) E os concluídos no período (qualquer data de atribuição), de modo que
 * tanto Concluídos quanto o backlog/6h fiquem corretos mesmo para itens
 * atribuídos fora da janela carregada.
 */
export function calcularPorRecebedor(
  processos: Processo[],
  users: User[],
  options: CalcularPorRecebedorOptions
): RecebedorStats[] {
  const { periodoStartIso, periodoEndIso, modoHoje = false } = options;
  const recebedores = users.filter((u) => u.role === 'recebedor' && u.ativo);

  // Limiares em millis (SP 00:00 = 03:00Z). O período é [startMs, endExclMs):
  // startMs = início (SP 00:00) do primeiro dia; endExclMs = SP 00:00 do dia
  // seguinte ao último dia = instante de referência (corte exclusivo). O
  // backlog usa a véspera do início, cujo fim coincide com startMs.
  const startMs = spDayStartMs(periodoStartIso);
  const endExclMs = spDayStartMs(isoAddDays(periodoEndIso, 1));
  const backlogExclMs = startMs;
  // 6h de SP = 09:00Z. Só usado no modo Hoje (período = um único dia).
  const seisHorasMs = Date.parse(`${periodoStartIso}T09:00:00Z`);

  // Bucket processos por recebedorUid.
  const byUid = new Map<string, Processo[]>();
  for (const p of processos) {
    if (!p.recebedorUid) continue;
    const list = byUid.get(p.recebedorUid);
    if (list) list.push(p);
    else byUid.set(p.recebedorUid, [p]);
  }

  const stats: RecebedorStats[] = recebedores.map((u) => {
    const owned = byUid.get(u.uid) ?? [];
    let distribuidosNoPeriodo = 0;
    let pendentesAnteriores = 0;
    let concluidos = 0;
    let cohortPendentes = 0;
    let atrasados = 0;
    let urgentes = 0;
    let prioridades = 0;
    let manuais = 0;
    // Modo Hoje: carga da manhã (pendentes às 6h) e quantos ainda faltam.
    let pendentesSeisHoras = 0;
    let pendentesSeisHorasAbertos = 0;

    for (const p of owned) {
      const atribMs = p.diaAtribuicao.toMillis();
      const concMs = p.concluidoEm ? p.concluidoEm.toMillis() : null;

      const noPeriodo = atribMs >= startMs && atribMs < endExclMs;
      const noBacklog =
        atribMs < backlogExclMs && (concMs === null || concMs >= backlogExclMs);

      if (!noPeriodo && !noBacklog) continue; // fora do cohort

      if (noPeriodo) distribuidosNoPeriodo += 1;
      if (noBacklog) pendentesAnteriores += 1;

      // Concluídos = concluídos no período por data de conclusão (todo cohort
      // concluído tem concMs >= startMs, logo isso = concluídos em [start, end],
      // independentemente da data de atribuição). Tempo real no dia presente.
      const concluidoNoPeriodo = concMs !== null && concMs < endExclMs;
      if (concluidoNoPeriodo) {
        concluidos += 1;
      } else {
        cohortPendentes += 1;
        // Atrasado no fim do período: prazoFinal (dia SP) anterior ao último dia.
        if (isoDiaSp(p.prazoFinal.toMillis()) < periodoEndIso) atrasados += 1;
      }
      if (p.urgente) urgentes += 1;
      if (p.prioridade) prioridades += 1;
      if (p.origem === 'manual') manuais += 1;

      if (modoHoje) {
        const atribuidoAteSeisHoras = atribMs <= seisHorasMs;
        const naoConcluidoAteSeisHoras = concMs === null || concMs > seisHorasMs;
        if (atribuidoAteSeisHoras && naoConcluidoAteSeisHoras) {
          pendentesSeisHoras += 1;
          // Ainda não concluído agora (concMs nulo) → continua pendente.
          if (concMs === null) pendentesSeisHorasAbertos += 1;
        }
      }
    }

    // Hoje: Total = pendentes às 6h; Pendentes = quantos desses ainda faltam.
    // Demais períodos: Total = distribuídos + backlog; Pendentes = cohort aberto.
    const total = modoHoje
      ? pendentesSeisHoras
      : distribuidosNoPeriodo + pendentesAnteriores;
    const pendentes = modoHoje ? pendentesSeisHorasAbertos : cohortPendentes;
    return {
      uid: u.uid,
      nome: u.displayName,
      distribuidosNoPeriodo,
      pendentesAnteriores,
      total,
      concluidos,
      pendentes,
      atrasados,
      urgentes,
      prioridades,
      manuais,
      pctConclusao: total > 0 ? (concluidos / total) * 100 : 0,
    };
  });

  stats.sort((a, b) => {
    if (a.concluidos !== b.concluidos) return b.concluidos - a.concluidos;
    if (a.total !== b.total) return b.total - a.total;
    return a.nome.localeCompare(b.nome, 'pt-BR');
  });

  return stats;
}

// ---------------------------------------------------------------------------
// Carga em aberto por recebedor (Visão Geral)
// ---------------------------------------------------------------------------

export interface EmAbertoPorRecebedor {
  uid: string;
  nome: string;
  /** Total de processos em aberto do recebedor no conjunto fornecido. */
  total: number;
  /** Quebra do total por dia da semana (tipologia diaSemana). */
  porDia: Record<DiaSemana, number>;
}

/**
 * Conta, por recebedor ativo e aprovado, toda a carga EM ABERTO no conjunto
 * `processos` fornecido — não apenas os `pendente`. Em aberto = qualquer status
 * que não seja `concluido` nem `nao_atribuido` (ou seja, pendente, em_andamento,
 * em_coordenacao e em_espera). Atrasados já estão contemplados: todo processo
 * atrasado tem um desses status, então não precisa de `now`/`isAtrasado` aqui.
 *
 * O total é quebrado por `diaSemana` (mesma tipologia das colunas Seg–Sex do
 * painel), com o MESMO filtro do total, de modo que a soma dos dias bate com o
 * total. A camada de página limita o conjunto à semana escolhida.
 *
 * Recebedores sem carga aparecem zerados, para o painel listar todo o time.
 * Ordenado por total desc, depois nome asc.
 */
export function calcularEmAbertoPorRecebedor(
  processos: Processo[],
  users: User[]
): EmAbertoPorRecebedor[] {
  const recebedores = users.filter(
    (u) => u.role === 'recebedor' && u.approved && u.ativo
  );
  const byUid = new Map<string, EmAbertoPorRecebedor>();
  for (const u of recebedores) {
    byUid.set(u.uid, {
      uid: u.uid,
      nome: u.displayName,
      total: 0,
      porDia: {
        segunda: 0,
        terca: 0,
        quarta: 0,
        quinta: 0,
        sexta: 0,
      },
    });
  }

  for (const p of processos) {
    if (p.status === 'concluido' || p.status === 'nao_atribuido') continue;
    if (!p.recebedorUid) continue;
    const row = byUid.get(p.recebedorUid);
    if (!row) continue;
    row.total += 1;
    row.porDia[p.diaSemana] += 1;
  }

  return Array.from(byUid.values()).sort(
    (a, b) => b.total - a.total || a.nome.localeCompare(b.nome, 'pt-BR')
  );
}

// ---------------------------------------------------------------------------
// Pendentes às 6h por recebedor por dia (reconstruído do histórico)
// ---------------------------------------------------------------------------

/** Quantos pendentes vieram de um determinado dia de distribuição. */
export interface PendentesOrigemDia {
  /** Dia de distribuição (diaAtribuicao) em ISO "YYYY-MM-DD". */
  origemIso: string;
  /** Rótulo "DD/MM" do dia de origem. */
  origemLabel: string;
  count: number;
}

export interface PendentesSeisHorasPorDia {
  /** Dias ISO "YYYY-MM-DD" (ascendente) cobertos pelo painel. */
  dias: string[];
  /** Rótulos "DD/MM" alinhados a `dias`. */
  diasLabel: string[];
  /** Uma linha por recebedor ativo. */
  porRecebedor: {
    uid: string;
    nome: string;
    /** Pendentes às 6h em cada dia (alinhado a `dias`). */
    porDia: number[];
    /**
     * Para cada dia (alinhado a `dias`), a quebra dos pendentes por dia de
     * origem (diaAtribuicao), ascendente. Usado no tooltip de cada célula.
     */
    detalhePorDia: PendentesOrigemDia[][];
  }[];
  /** Total geral (todos os recebedores) por dia, alinhado a `dias`. */
  totalPorDia: number[];
}

/**
 * Para cada dia em `dias` e cada recebedor ativo, conta quantos processos
 * estavam PENDENTES às 6h daquele dia, reconstruído a partir dos timestamps do
 * próprio processo (não depende de snapshot).
 *
 * Um processo conta como pendente às 6h do dia D para o recebedor R quando:
 *  - está atribuído a R (recebedorUid == R);
 *  - já havia sido distribuído antes das 6h (diaAtribuicao <= D 06:00);
 *  - ainda não tinha sido iniciado (iniciadoEm vazio ou > D 06:00);
 *  - ainda não tinha sido concluído (concluidoEm vazio ou > D 06:00).
 *
 * 6h de São Paulo = 09:00 UTC (fuso fixo -03:00, sem horário de verão desde
 * 2019), então o limiar do dia D é `${D}T09:00:00Z`.
 *
 * Observação: a contagem só enxerga os processos presentes em `processos` — se
 * o período carregado não incluir processos antigos ainda pendentes, dias mais
 * recuados podem ficar subestimados (mesma limitação de janela do restante da
 * aba).
 */
export function calcularPendentesSeisHorasPorDia(
  processos: Processo[],
  users: User[],
  dias: string[]
): PendentesSeisHorasPorDia {
  const recebedores = users.filter((u) => u.role === 'recebedor' && u.ativo);
  const limiares = dias.map((d) => Date.parse(`${d}T09:00:00Z`));

  // Bucket processos por recebedorUid para iterar uma vez por recebedor.
  const byUid = new Map<string, Processo[]>();
  for (const p of processos) {
    if (!p.recebedorUid) continue;
    const list = byUid.get(p.recebedorUid);
    if (list) list.push(p);
    else byUid.set(p.recebedorUid, [p]);
  }

  const totalPorDia = dias.map(() => 0);

  const porRecebedor = recebedores.map((u) => {
    const owned = byUid.get(u.uid) ?? [];
    const detalhePorDia: PendentesOrigemDia[][] = [];
    const porDia = limiares.map((limiar, i) => {
      // Quebra dos pendentes por dia de origem (diaAtribuicao em SP).
      const porOrigem = new Map<string, number>();
      let count = 0;
      for (const p of owned) {
        const atribuido = p.diaAtribuicao.toMillis();
        if (atribuido > limiar) continue; // ainda não distribuído às 6h
        const iniciado = p.iniciadoEm ? p.iniciadoEm.toMillis() : null;
        if (iniciado !== null && iniciado <= limiar) continue; // já iniciado
        const concluido = p.concluidoEm ? p.concluidoEm.toMillis() : null;
        if (concluido !== null && concluido <= limiar) continue; // já concluído
        count += 1;
        const origemIso = isoDiaSp(atribuido);
        porOrigem.set(origemIso, (porOrigem.get(origemIso) ?? 0) + 1);
      }
      detalhePorDia[i] = Array.from(porOrigem.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([origemIso, c]) => ({
          origemIso,
          origemLabel: formatDateBr(parseIsoDateLocal(origemIso), 'dd/MM'),
          count: c,
        }));
      totalPorDia[i] += count;
      return count;
    });
    return { uid: u.uid, nome: u.displayName, porDia, detalhePorDia };
  });

  porRecebedor.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  return {
    dias,
    diasLabel: dias.map((d) => formatDateBr(parseIsoDateLocal(d), 'dd/MM')),
    porRecebedor,
    totalPorDia,
  };
}

// ---------------------------------------------------------------------------
// Série diária
// ---------------------------------------------------------------------------

/**
 * Returns the last `dias` days, anchored on the latest diaAtribuicao or
 * concluidoEm seen in `processos` (or today if list is empty), with daily
 * counts for `concluidos` (status='concluido' and concluidoEm in the day) and
 * `distribuidos` (diaAtribuicao in the day).
 *
 * Days are computed in the SP timezone implicitly via Date.toISOString slicing
 * after rounding to the local day. Timestamps come from Firestore (UTC) but
 * we use the JS Date local day for bucketing — adequate for a daily chart
 * displayed to a SP-based audience.
 */
export function calcularSerieDiaria(
  processos: Processo[],
  dias: number
): SerieDiaria[] {
  if (dias <= 0) return [];

  // Anchor: latest day we have any signal for. Falls back to "today" so the
  // chart still renders an axis on empty input.
  let anchor: Date | null = null;
  for (const p of processos) {
    const atribuido = p.diaAtribuicao.toDate();
    if (!anchor || atribuido > anchor) anchor = atribuido;
    if (p.concluidoEm) {
      const c = p.concluidoEm.toDate();
      if (!anchor || c > anchor) anchor = c;
    }
  }
  const anchorDate = anchor ?? new Date();

  // Build the day-window in chronological order (oldest first).
  const buckets = new Map<string, SerieDiaria>();
  const dayStart = startOfDayLocal(anchorDate);
  for (let i = dias - 1; i >= 0; i -= 1) {
    const d = new Date(dayStart);
    d.setDate(d.getDate() - i);
    const iso = toIsoDay(d);
    buckets.set(iso, {
      iso,
      data: formatDateBr(d, 'dd/MM'),
      concluidos: 0,
      distribuidos: 0,
    });
  }

  for (const p of processos) {
    const distIso = toIsoDay(p.diaAtribuicao.toDate());
    const distBucket = buckets.get(distIso);
    if (distBucket) distBucket.distribuidos += 1;

    if (p.status === 'concluido' && p.concluidoEm) {
      const concIso = toIsoDay(p.concluidoEm.toDate());
      const concBucket = buckets.get(concIso);
      if (concBucket) concBucket.concluidos += 1;
    }
  }

  return Array.from(buckets.values());
}

// ---------------------------------------------------------------------------
// Por agrupador
// ---------------------------------------------------------------------------

export function calcularPorAgrupador(
  processos: Processo[]
): AgrupadorStats[] {
  const map = new Map<string, AgrupadorStats>();
  for (const p of processos) {
    const id = p.agrupadorId;
    let entry = map.get(id);
    if (!entry) {
      entry = {
        agrupadorId: id,
        agrupadorNome: p.agrupadorNome,
        total: 0,
        concluidos: 0,
      };
      map.set(id, entry);
    }
    entry.total += 1;
    if (p.status === 'concluido') entry.concluidos += 1;
  }
  const out = Array.from(map.values());
  out.sort((a, b) => {
    if (a.total !== b.total) return b.total - a.total;
    return a.agrupadorNome.localeCompare(b.agrupadorNome, 'pt-BR');
  });
  return out;
}

// ---------------------------------------------------------------------------
// Por dia da semana (tipologia diaSemana, não data calendário)
// ---------------------------------------------------------------------------

export function calcularPorDiaSemana(
  processos: Processo[]
): DiaSemanaStats[] {
  const counts: Record<DiaSemana, number> = {
    segunda: 0,
    terca: 0,
    quarta: 0,
    quinta: 0,
    sexta: 0,
  };
  for (const p of processos) {
    counts[p.diaSemana] += 1;
  }
  return DIAS_SEMANA_ORDER.map((d) => ({ dia: d, total: counts[d] }));
}

// ---------------------------------------------------------------------------
// Origem do cadastro por recebedor
// ---------------------------------------------------------------------------

export function calcularOrigemCadastroPorRecebedor(
  processos: Processo[],
  users: User[]
): OrigemCadastroStats[] {
  const recebedores = users.filter(
    (u) => u.role === 'recebedor' && u.ativo
  );
  const byUid = new Map<
    string,
    { seiJson: number; manual: number; legado: number }
  >();
  for (const u of recebedores) {
    byUid.set(u.uid, { seiJson: 0, manual: 0, legado: 0 });
  }
  for (const p of processos) {
    if (!p.recebedorUid) continue;
    const entry = byUid.get(p.recebedorUid);
    if (!entry) continue; // ignore inactive / non-receiver assignments
    if (p.origem === 'sei_json') entry.seiJson += 1;
    else if (p.origem === 'manual') entry.manual += 1;
    else entry.legado += 1;
  }
  const out: OrigemCadastroStats[] = recebedores.map((u) => {
    const entry = byUid.get(u.uid)!;
    return {
      recebedorUid: u.uid,
      recebedorNome: u.displayName,
      seiJson: entry.seiJson,
      manual: entry.manual,
      legado: entry.legado,
    };
  });
  out.sort((a, b) => {
    const totalA = a.seiJson + a.manual + a.legado;
    const totalB = b.seiJson + b.manual + b.legado;
    if (totalA !== totalB) return totalB - totalA;
    return a.recebedorNome.localeCompare(b.recebedorNome, 'pt-BR');
  });
  return out;
}

// ---------------------------------------------------------------------------
// Tempo médio entre início e conclusão por recebedor
// ---------------------------------------------------------------------------

export function calcularTempoMedioConclusaoPorRecebedor(
  processos: Processo[],
  users: User[]
): TempoMedioRecebedorStats[] {
  const recebedores = users.filter(
    (u) => u.role === 'recebedor' && u.ativo
  );
  const byUid = new Map<
    string,
    {
      totalMs: number;
      count: number;
      menorMs: number | null;
      maiorMs: number | null;
    }
  >();
  for (const u of recebedores) {
    byUid.set(u.uid, { totalMs: 0, count: 0, menorMs: null, maiorMs: null });
  }

  for (const p of processos) {
    if (p.status !== 'concluido' || !p.recebedorUid) continue;
    const entry = byUid.get(p.recebedorUid);
    if (!entry || !p.iniciadoEm || !p.concluidoEm) continue;

    const started = p.iniciadoEm.toMillis();
    const concluded = p.concluidoEm.toMillis();
    const elapsed = concluded - started;
    if (!Number.isFinite(elapsed) || elapsed < 0) continue;

    entry.totalMs += elapsed;
    entry.count += 1;
    entry.menorMs =
      entry.menorMs === null ? elapsed : Math.min(entry.menorMs, elapsed);
    entry.maiorMs =
      entry.maiorMs === null ? elapsed : Math.max(entry.maiorMs, elapsed);
  }

  const out: TempoMedioRecebedorStats[] = recebedores.map((u) => {
    const entry = byUid.get(u.uid)!;
    return {
      uid: u.uid,
      nome: u.displayName,
      processosMedidos: entry.count,
      mediaMs: entry.count > 0 ? entry.totalMs / entry.count : null,
      menorMs: entry.menorMs,
      maiorMs: entry.maiorMs,
    };
  });

  out.sort((a, b) => {
    if (a.processosMedidos === 0 && b.processosMedidos > 0) return 1;
    if (b.processosMedidos === 0 && a.processosMedidos > 0) return -1;
    if (a.mediaMs !== null && b.mediaMs !== null && a.mediaMs !== b.mediaMs) {
      return a.mediaMs - b.mediaMs;
    }
    if (a.processosMedidos !== b.processosMedidos) {
      return b.processosMedidos - a.processosMedidos;
    }
    return a.nome.localeCompare(b.nome, 'pt-BR');
  });

  return out;
}

// ---------------------------------------------------------------------------
// Alertas
// ---------------------------------------------------------------------------

export function calcularAlertas(
  stats: RecebedorStats[],
  processos: Processo[]
): AlertasInfo {
  const recebedoresMuitosAtrasados = stats
    .filter((s) => s.atrasados > LIMITE_ATRASADOS)
    .slice()
    .sort((a, b) => b.atrasados - a.atrasados);

  const recebedoresMuitosPendentes = stats
    .filter((s) => s.pendentes > LIMITE_PENDENTES)
    .slice()
    .sort((a, b) => b.pendentes - a.pendentes);

  // Backlog = não concluídos.
  const backlogByAgrupador = new Map<
    string,
    { agrupadorId: string; agrupadorNome: string; total: number }
  >();
  for (const p of processos) {
    if (p.status === 'concluido') continue;
    const id = p.agrupadorId;
    let entry = backlogByAgrupador.get(id);
    if (!entry) {
      entry = { agrupadorId: id, agrupadorNome: p.agrupadorNome, total: 0 };
      backlogByAgrupador.set(id, entry);
    }
    entry.total += 1;
  }
  const agrupadoresAcumulando = Array.from(backlogByAgrupador.values())
    .sort((a, b) => {
      if (a.total !== b.total) return b.total - a.total;
      return a.agrupadorNome.localeCompare(b.agrupadorNome, 'pt-BR');
    })
    .slice(0, ACUMULANDO_TOP_N);

  return {
    recebedoresMuitosAtrasados,
    recebedoresMuitosPendentes,
    agrupadoresAcumulando,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Dia calendário em São Paulo (ISO "YYYY-MM-DD") de um instante em millis.
 * SP é fixo -03:00, então o dia SP = dia UTC de (millis - 3h).
 */
function isoDiaSp(millis: number): string {
  return new Date(millis - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Instante (millis) de 00:00 em São Paulo do dia ISO "YYYY-MM-DD" (= 03:00Z). */
function spDayStartMs(iso: string): number {
  return Date.parse(`${iso}T03:00:00Z`);
}

/**
 * Soma `days` a uma data ISO "YYYY-MM-DD" e devolve a nova data ISO. Aritmética
 * pura em UTC (sem fuso), correta através de viradas de mês/ano.
 */
function isoAddDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function startOfDayLocal(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function toIsoDay(d: Date): string {
  const local = startOfDayLocal(d);
  const y = local.getFullYear();
  const m = String(local.getMonth() + 1).padStart(2, '0');
  const day = String(local.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ---------------------------------------------------------------------------
// Produtividade pessoal do recebedor (versão simplificada por uid)
// ---------------------------------------------------------------------------

/**
 * Métricas pessoais de um recebedor para um mês "YYYY-MM" (fuso SP), derivadas
 * dos seus processos CONCLUÍDOS. A camada de página alimenta a lista com uma
 * leitura BOUNDED dos concluídos mais recentes do próprio recebedor
 * (`getProcessosConcluidosByRecebedor`, no máx. ~100 docs, já memoizada por
 * sessão), então `concluidos` aqui pode subestimar meses muito antigos que
 * caíram fora dessa janela — adequado para o mês corrente, que é o foco.
 */
export interface ProdutividadePessoalStats {
  /** Mês de referência "YYYY-MM" (SP). */
  mes: string;
  /** Concluídos no mês por data de conclusão (concluidoEm em SP). */
  concluidosNoMes: number;
  /** Dos concluídos no mês, quantos foram marcados como devolvidos. */
  devolvidosNoMes: number;
  /** Concluídos no mês que NÃO foram devolvidos (implantados). */
  implantadosNoMes: number;
  /** Concluídos no mês marcados como urgentes. */
  urgentesNoMes: number;
  /** Concluídos no mês marcados como prioridade. */
  prioridadesNoMes: number;
  /**
   * Tempo médio de execução em MILISSEGUNDOS (início -> conclusão), sobre os
   * concluídos do mês que foram iniciados. `null` quando não há nenhum medido.
   * Mesma métrica da aba de produtividade do distribuidor
   * (`calcularTempoMedioConclusaoPorRecebedor`); formate com `formatDurationMs`.
   */
  mediaMs: number | null;
  /** Menor tempo de execução (início -> conclusão) em ms no mês (ou `null`). */
  menorMs: number | null;
  /** Maior tempo de execução (início -> conclusão) em ms no mês (ou `null`). */
  maiorMs: number | null;
  /** Total de concluídos do recebedor visíveis na janela (todos os meses). */
  concluidosTotalJanela: number;
}

/**
 * Calcula as métricas pessoais de produtividade do recebedor `recebedorUid` no
 * mês `mesKey` ("YYYY-MM", fuso SP). Puro e determinístico.
 *
 * O mês é delimitado pelo dia-calendário SP de `concluidoEm` (mesmo critério do
 * painel do distribuidor, via `isoDiaSp`), não pelo horário local da máquina,
 * para que "no mês" bata com a visão da coordenação.
 *
 * O tempo de execução usa milissegundos de `iniciadoEm` -> `concluidoEm` (só os
 * concluídos que foram iniciados), a MESMA métrica de
 * `calcularTempoMedioConclusaoPorRecebedor` (aba do distribuidor); formate com
 * `formatDurationMs`.
 */
export function calcularProdutividadePessoal(
  processos: readonly Processo[],
  recebedorUid: string,
  mesKey: string
): ProdutividadePessoalStats {
  let concluidosTotalJanela = 0;
  let concluidosNoMes = 0;
  let devolvidosNoMes = 0;
  let urgentesNoMes = 0;
  let prioridadesNoMes = 0;
  let totalMs = 0;
  let medidos = 0;
  let menorMs: number | null = null;
  let maiorMs: number | null = null;

  for (const p of processos) {
    if (p.status !== 'concluido' || p.recebedorUid !== recebedorUid) continue;
    concluidosTotalJanela += 1;

    const concluidoEm = p.concluidoEm;
    if (concluidoEm === null) continue;
    if (isoDiaSp(concluidoEm.toMillis()).slice(0, 7) !== mesKey) continue;

    concluidosNoMes += 1;
    if (p.devolvido === true) devolvidosNoMes += 1;
    if (p.urgente) urgentesNoMes += 1;
    if (p.prioridade) prioridadesNoMes += 1;

    // Tempo de execução: início -> conclusão (ms), só para os que foram
    // iniciados. Mesma métrica da aba do distribuidor.
    const iniciadoEm = p.iniciadoEm;
    if (iniciadoEm) {
      const elapsed = concluidoEm.toMillis() - iniciadoEm.toMillis();
      if (Number.isFinite(elapsed) && elapsed >= 0) {
        totalMs += elapsed;
        medidos += 1;
        menorMs = menorMs === null ? elapsed : Math.min(menorMs, elapsed);
        maiorMs = maiorMs === null ? elapsed : Math.max(maiorMs, elapsed);
      }
    }
  }

  return {
    mes: mesKey,
    concluidosNoMes,
    devolvidosNoMes,
    implantadosNoMes: concluidosNoMes - devolvidosNoMes,
    urgentesNoMes,
    prioridadesNoMes,
    mediaMs: medidos > 0 ? totalMs / medidos : null,
    menorMs,
    maiorMs,
    concluidosTotalJanela,
  };
}

/**
 * Formata uma duração em milissegundos como texto curto PT-BR: "X min" abaixo
 * de 1h, "Xh Ymin" abaixo de 1 dia, "Xd Yh" acima. `null`/inválido vira "—".
 * Fonte única usada tanto pela aba do distribuidor quanto pela do recebedor.
 */
export function formatDurationMs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—';
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }

  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (totalHours < 24) {
    return minutes === 0 ? `${totalHours}h` : `${totalHours}h ${minutes}min`;
  }

  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours === 0 ? `${days}d` : `${days}d ${hours}h`;
}
