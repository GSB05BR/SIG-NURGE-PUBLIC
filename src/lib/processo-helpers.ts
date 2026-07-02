import type { Processo, ProcessoStatus, ResponsavelSei } from '@/types';
import { formatDateBr } from '@/lib/datetime';

export const MAX_PROCESSOS_EM_ANDAMENTO_RECEBEDOR = 4;
export const LIMITE_EM_ANDAMENTO_RECEBEDOR_MESSAGE =
  'CONCLUA AS IMPLANTAÇÕES INICIADAS ANTES DE COMEÇAR OUTRAS!';

/**
 * Returns true if the processo is past its prazoFinal.
 * Comparison uses prazoFinal.toDate() vs now (already projected to SP TZ
 * by callers). Concluded processos are never atrasados (they finished in time
 * or out — but for UI purposes we don't flag them).
 */
export function isAtrasado(p: Processo, now: Date): boolean {
  if (p.status === 'concluido' || p.status === 'nao_atribuido') return false;
  return (
    formatDateBr(p.prazoFinal.toDate(), 'yyyy-MM-dd') <
    formatDateBr(now, 'yyyy-MM-dd')
  );
}

export function isAtribuicaoLiberada(p: Processo, now: Date): boolean {
  return (
    formatDateBr(p.diaAtribuicao.toDate(), 'yyyy-MM-dd') <=
    formatDateBr(now, 'yyyy-MM-dd')
  );
}

export function isLiberadoSemBloqueioRecebedor(
  p: Processo,
  now: Date
): boolean {
  if (p.status !== 'pendente' && p.status !== 'em_andamento') return false;
  if (!isAtribuicaoLiberada(p, now)) return false;
  if (p.status === 'em_andamento') return true;
  if (isAtrasado(p, now)) return true;
  return (
    formatDateBr(p.diaAtribuicao.toDate(), 'yyyy-MM-dd') <
    formatDateBr(now, 'yyyy-MM-dd')
  );
}

export function contarProcessosEmAndamento(
  processos: readonly Pick<Processo, 'status'>[] | null | undefined
): number {
  return (processos ?? []).filter((p) => p.status === 'em_andamento').length;
}

export function isProcessoPendenteOuEmAndamentoDeSemanaAnterior(
  p: Pick<Processo, 'status' | 'semanaIso' | 'diaAtribuicao'>,
  semanaIsoAtual: string,
  inicioSemanaAtual: Date
): boolean {
  if (p.status !== 'pendente' && p.status !== 'em_andamento') return false;
  if (p.semanaIso === semanaIsoAtual) return false;
  return (
    formatDateBr(p.diaAtribuicao.toDate(), 'yyyy-MM-dd') <
    formatDateBr(inicioSemanaAtual, 'yyyy-MM-dd')
  );
}

/**
 * Pendente/em andamento atribuído para um dia ANTERIOR ao de hoje (carried-over).
 * Esses processos saem do limite de "N comuns por vez" no painel do recebedor:
 * trabalho que ficou de dias passados deve aparecer sempre. Ao virar o dia, os
 * que eram "de hoje" passam a contar como anteriores automaticamente.
 */
export function isPendenteDeDiaAnterior(
  p: Pick<Processo, 'status' | 'diaAtribuicao'>,
  now: Date
): boolean {
  if (p.status !== 'pendente' && p.status !== 'em_andamento') return false;
  return (
    formatDateBr(p.diaAtribuicao.toDate(), 'yyyy-MM-dd') <
    formatDateBr(now, 'yyyy-MM-dd')
  );
}

export function isVisivelNoPainelRecebedor(
  p: Processo,
  semanaIsoAtual: string,
  now: Date
): boolean {
  if (p.status === 'em_coordenacao' || p.status === 'em_espera') return false;
  if (!isAtribuicaoLiberada(p, now)) return false;
  return p.semanaIso === semanaIsoAtual || p.status !== 'concluido';
}

export function getChegadaOperacionalNurgeMillis(p: Processo): number | null {
  return (
    p.ultimoRetornoNurgeEm?.toMillis() ??
    p.primeiraEntradaNurgeEm?.toMillis() ??
    p.createdAt?.toMillis?.() ??
    null
  );
}

export function compararPrioridadeFilaNaoAtribuidos(
  a: Processo,
  b: Processo
): number {
  const regimeA = a.regime === 'fechado' ? 0 : 1;
  const regimeB = b.regime === 'fechado' ? 0 : 1;
  if (regimeA !== regimeB) return regimeA - regimeB;

  const chegadaA = getChegadaOperacionalNurgeMillis(a);
  const chegadaB = getChegadaOperacionalNurgeMillis(b);
  if (chegadaA === null && chegadaB === null) return a.numero.localeCompare(b.numero);
  if (chegadaA === null) return 1;
  if (chegadaB === null) return -1;
  if (chegadaA !== chegadaB) return chegadaA - chegadaB;
  return a.numero.localeCompare(b.numero);
}

export function compareUrgentesFirst(
  a: Pick<Processo, 'urgente'>,
  b: Pick<Processo, 'urgente'>
): number {
  if (a.urgente === b.urgente) return 0;
  return a.urgente ? -1 : 1;
}

export function isUrgenteOuPrioridade(
  p: Pick<Processo, 'urgente' | 'prioridade'>
): boolean {
  return p.urgente || p.prioridade;
}

/**
 * Algum dos processos existentes para um número já está DISTRIBUÍDO e ABERTO
 * (atribuído a alguém e ainda não concluído)? Nesse caso o re-import do SEI deve
 * PRESERVAR — não reimportar/sobrescrever, para o processo não pular de
 * dia/recebedor. `nao_atribuido` (fila) e `concluido` não contam: fila pode ser
 * atualizada pela importação e concluído tem tratamento próprio.
 */
export function temProcessoDistribuidoAberto(
  existentes: Pick<Processo, 'recebedorUid' | 'status'>[]
): boolean {
  return existentes.some(
    (e) =>
      e.recebedorUid != null &&
      e.status !== 'concluido' &&
      e.status !== 'nao_atribuido'
  );
}

export function getUltimoResponsavelNurge(p: Processo): ResponsavelSei | null {
  const historico = p.historicoSei ?? [];
  for (let i = historico.length - 1; i >= 0; i -= 1) {
    const evento = historico[i];
    const responsavel = evento.tipo === 'atribuicao_nurge' ? evento.usuario : null;
    if (responsavel?.nome || responsavel?.login) return responsavel;
  }

  // Twin persistido (item 7): docs novos não trazem o histórico inline. Vem da
  // ÚLTIMA atribuição — não usar ciclos.atribuidoPara, que é a PRIMEIRA do ciclo.
  if (p.ultimoResponsavelNurge?.nome || p.ultimoResponsavelNurge?.login) {
    return p.ultimoResponsavelNurge;
  }

  const ciclos = p.ciclosNurge ?? [];
  for (let i = ciclos.length - 1; i >= 0; i -= 1) {
    const responsavel = ciclos[i].atribuidoPara;
    if (responsavel?.nome || responsavel?.login) return responsavel;
  }

  return p.primeiroResponsavelNurge ?? null;
}

export function getResponsavelSeiLabel(
  responsavel: ResponsavelSei | null | undefined
): string {
  return responsavel?.nome || responsavel?.login || '—';
}

const CNJ_NUMERO_PATTERN = /\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/g;

// Marcador de visibilidade do SEI: "(Não Visualizado)" / "(Visualizado)".
const SEI_MARCADOR_VISIBILIDADE = /\(\s*(?:n[ãa]o\s+)?visualizad[oa]\s*\)/gi;

// Rótulos "réu:/sentenciado:/nome:" seguidos de separador — viram espaço.
const SEI_ROTULOS = /\b(?:r[eé]u|sentenciado(?:a)?|nome)\s*[:;-]\s*/gi;

// Frases de tipo de expediente/guia que nunca fazem parte do nome.
const SEI_FRASES_RUIDO: RegExp[] = [
  /\bguia\s+de\s+execu[cç][aã]o(?:\s+penal)?(?:\s+definitiva)?\b/gi,
  /\bguia\s+de\s+recolhimento(?:\s+definitiva)?\b/gi,
  /\bguia\s+de\s+interna[cç][aã]o\b/gi,
  /\bcarta\s+de\s+guia\b/gi,
  /\bguia\s+definitiva\b/gi,
  /\bguia\s+expedida\b/gi,
  /\breferente\s+aos\s+autos\b/gi,
  /\benvio\s+de\s+guias?(?:\s+de\s+execu[cç][aã]o)?\b/gi,
  /\bexecu[cç][aã]o\s+penal\b/gi,
  /\br[eé]u\s+(?:solto|preso)\b/gi,
  /\bcpf\b\s*[:.\-]?\s*[\d.\-]{6,}/gi,
];

// Palavras isoladas de tipo (só as comprovadas no corpus + irmãs próximas).
// Viés de precisão: termos que poderiam ser parte de nome real ficam de fora —
// um tipo que vaze vira um grupo pequeno visível, melhor que comer um nome.
const SEI_TOKENS_RUIDO =
  /\b(?:guias?|processo|procedimento|execu[cç][aã]o|recolhimento|definitiv[oa]|provis[oó]ri[oa]|expedida|solicita[cç][aã]o|peti[cç][aã]o)\b/gi;

export function getSentenciadoNomeProcesso(
  processo: Pick<Processo, 'dadosConclusao' | 'observacao' | 'tooltip'>
): string | null {
  // A conclusão é a fonte mais confiável, mas alguns docs salvaram o tipo da
  // guia (ou o nome com o marcador "(Não Visualizado)") no campo — limpa igual.
  const concluido = cleanupSentenciadoNome(processo.dadosConclusao?.sentenciadoNome);
  if (concluido) return concluido;

  return (
    extractSentenciadoNomeFromTexto(processo.observacao) ??
    extractSentenciadoNomeFromTexto(processo.tooltip) ??
    null
  );
}

function extractSentenciadoNomeFromTexto(texto: string | null | undefined): string | null {
  const source = texto?.trim();
  if (!source) return null;

  const explicitMatch = source.match(
    /\b(?:r[eé]u|sentenciado(?:a)?)\s*[:;-]\s*([^;\n]+?)(?=\s*;\s*(?:processo|guia|classe|assunto)\b|\s+-\s+(?:ENVIO|R[ÉE]U|REU)\b|$)/i
  );
  const explicitName = cleanupSentenciadoNome(explicitMatch?.[1]);
  if (explicitName) return explicitName;

  const pareceObservacaoSei =
    CNJ_NUMERO_PATTERN.test(source) ||
    /\b(?:guia|execu[cç][aã]o|envio\s+de\s+guias|r[eé]u|sentenciado(?:a)?)\b/i.test(
      source
    );
  CNJ_NUMERO_PATTERN.lastIndex = 0;
  if (!pareceObservacaoSei) return null;

  // Recorta o sufixo administrativo terminal (" - ENVIO DE GUIAS...") e limpa o
  // restante: o que sobra é o nome, ou nada (processo sem nome no texto). Não
  // cortamos em " - RÉU SOLTO/PRESO" porque às vezes o nome vem logo depois
  // ("RÉU PRESO MATEUS..."); o marcador "réu solto/preso" é removido na limpeza.
  const beforeSuffix = source.split(
    /\s+-\s+(?:ENVIO|DEVOLU|RETORNO|PRAZO)\b/i
  )[0];

  return cleanupSentenciadoNome(beforeSuffix);
}

function cleanupSentenciadoNome(value: string | null | undefined): string | null {
  if (!value) return null;
  let clean = value
    .replace(CNJ_NUMERO_PATTERN, ' ')
    .replace(SEI_MARCADOR_VISIBILIDADE, ' ')
    .replace(SEI_ROTULOS, ' ');
  for (const re of SEI_FRASES_RUIDO) clean = clean.replace(re, ' ');
  clean = clean
    .replace(SEI_TOKENS_RUIDO, ' ')
    .replace(/\b\d{4,}\b/g, ' ')
    .replace(/^[\s;:.,()\-]+|[\s;:.,()\-]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (clean.length < 3) return null;
  if (!/[A-Za-zÀ-ÿ]/.test(clean)) return null;
  if (/\d{3,}/.test(clean)) return null;
  if (clean.split(/\s+/).length > 12) return null;
  return clean;
}

/** Human label for a ProcessoStatus. */
export function getStatusLabel(s: ProcessoStatus): string {
  switch (s) {
    case 'nao_atribuido':
      return 'Não atribuído';
    case 'pendente':
      return 'Pendente';
    case 'em_andamento':
      return 'Em andamento';
    case 'em_coordenacao':
      return 'Na coordenação';
    case 'em_espera':
      return 'Em espera';
    case 'concluido':
      return 'Concluído';
  }
}

/** Tailwind classes for a small status badge. */
export function getStatusBadgeClass(s: ProcessoStatus): string {
  switch (s) {
    case 'nao_atribuido':
      return 'bg-slate-100 text-slate-700 ring-1 ring-slate-200 uppercase tracking-[0.3px]';
    case 'pendente':
      return 'bg-state-danger-bg text-state-danger ring-1 ring-red-200 uppercase tracking-[0.3px]';
    case 'em_andamento':
      return 'bg-state-warning-bg text-state-warning ring-1 ring-orange-200 uppercase tracking-[0.3px]';
    case 'em_coordenacao':
      return 'bg-state-info-bg text-state-info ring-1 ring-blue-200 uppercase tracking-[0.3px]';
    case 'em_espera':
      return 'bg-state-purple-bg text-state-purple ring-1 ring-purple-200 uppercase tracking-[0.3px]';
    case 'concluido':
      return 'bg-state-success-bg text-state-success ring-1 ring-green-200 uppercase tracking-[0.3px]';
  }
}

/**
 * Orders processos within a single day-column.
 *
 * Priority groups (desc):
 *  1. Urgentes/prioridades não-concluídos
 *  2. Atrasados não-concluídos (sem urgência/prioridade)
 *  3. Demais não-concluídos
 *  4. Concluídos (sempre por último)
 *
 * Within group 1-3: ordemCsv asc (nulls last), then diaAtribuicao asc.
 * Within group 4: concluidoEm desc (nulls last).
 */
export function ordenarProcessosDoDia(
  list: Processo[],
  now: Date
): Processo[] {
  const out = list.slice();
  out.sort((a, b) => {
    const groupA = bucket(a, now);
    const groupB = bucket(b, now);
    if (groupA !== groupB) return groupA - groupB;

    if (groupA === 4) {
      // Concluded: most recent first.
      const ta = a.concluidoEm?.toMillis() ?? 0;
      const tb = b.concluidoEm?.toMillis() ?? 0;
      if (ta !== tb) return tb - ta;
    } else {
      const oa = a.ordemCsv ?? Number.POSITIVE_INFINITY;
      const ob = b.ordemCsv ?? Number.POSITIVE_INFINITY;
      if (oa !== ob) return oa - ob;
      const da = a.diaAtribuicao.toMillis();
      const db = b.diaAtribuicao.toMillis();
      if (da !== db) return da - db;
    }
    return a.numero.localeCompare(b.numero);
  });
  return out;
}

/**
 * Quantos processos concluídos o recebedor enxerga no próprio histórico. A
 * busca e os filtros operam dentro dessa janela dos mais recentes.
 */
export const HISTORICO_RECEBEDOR_LIMITE = 100;

/**
 * Seleciona os `limite` processos concluídos mais recentes (por `concluidoEm`,
 * desc). Concluídos sem `concluidoEm` (legados) ficam ao final e só caem fora
 * quando há concluídos datados suficientes para preencher o limite. Não muta a
 * lista recebida.
 */
export function selecionarConcluidosRecentes(
  processos: readonly Processo[],
  limite: number = HISTORICO_RECEBEDOR_LIMITE
): Processo[] {
  return processos
    .filter((p) => p.status === 'concluido')
    .sort(
      (a, b) => (b.concluidoEm?.toMillis() ?? 0) - (a.concluidoEm?.toMillis() ?? 0)
    )
    .slice(0, limite);
}

function bucket(p: Processo, now: Date): number {
  if (p.status === 'nao_atribuido') return 5;
  if (p.status === 'concluido') return 4;
  if (p.status === 'em_coordenacao' || p.status === 'em_espera') return 4;
  if (isUrgenteOuPrioridade(p)) return 1;
  if (isAtrasado(p, now)) return 2;
  return 3;
}

/**
 * Counts business days elapsed from `start` to `end` in Sao Paulo calendar days
 * (Mon-Fri only, ignoring holidays). For accurate prazo math with holidays, use
 * `addDiasUteis` from `@/lib/datetime`.
 */
export function diffDiasUteis(start: Date, end: Date): number {
  const startIso = formatDateBr(start, 'yyyy-MM-dd');
  const endIso = formatDateBr(end, 'yyyy-MM-dd');
  if (endIso <= startIso) return 0;

  let count = 0;
  let cursor = addIsoDays(startIso, 1);
  while (cursor <= endIso) {
    const dow = weekdayFromIso(cursor);
    if (dow !== 0 && dow !== 6) count += 1;
    cursor = addIsoDays(cursor, 1);
  }
  return count;
}

function addIsoDays(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function weekdayFromIso(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
}

/**
 * Decide o recebedor vinculado de um número na importação. Carry-forward do
 * vínculo que já estava na fila; senão deriva do concluído-devolvido mais
 * recente (a partir do corte de lançamento). Conclusão normal não vincula.
 *
 * "Mais recente" usa `concluidoEm` (não a ordem do array), pra não depender de
 * `updatedAt` — que pode ser bumpado depois da conclusão (ex.: marcar urgente).
 */
export function derivarRecebedorVinculado(
  processoExistente: Pick<Processo, 'recebedorVinculadoUid'> | null,
  existentesConcluidos: Pick<
    Processo,
    'devolvido' | 'concluidoEm' | 'recebedorUid'
  >[],
  desdeMs: number
): string | null {
  if (processoExistente?.recebedorVinculadoUid) {
    return processoExistente.recebedorVinculadoUid;
  }
  let maisRecente: (typeof existentesConcluidos)[number] | null = null;
  let maisRecenteMs = -Infinity;
  for (const concluido of existentesConcluidos) {
    const ms = concluido.concluidoEm?.toMillis() ?? -Infinity;
    if (ms > maisRecenteMs) {
      maisRecenteMs = ms;
      maisRecente = concluido;
    }
  }
  if (maisRecente?.devolvido === true && maisRecenteMs >= desdeMs) {
    return maisRecente.recebedorUid ?? null;
  }
  return null;
}
