import Papa from 'papaparse';

export interface ParsedRow {
  numero: string;
  agrupadorNome: string;
  urgente: boolean;
  prioridade: boolean;
  ordemCsv: number;
}

export interface ParseResult {
  rows: ParsedRow[];
  warnings: string[];
  agrupadoresUnicos: string[];
}

/** Removes diacritics + lowercases. Used to compare headers and marker values. */
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

const COMMON_TRUE_TOKENS = [
  'sim',
  's',
  'yes',
  'y',
  'true',
  '1',
] as const;

const URGENTE_TRUE_TOKENS = new Set([
  ...COMMON_TRUE_TOKENS,
  'urgente',
]);

const PRIORIDADE_TRUE_TOKENS = new Set([
  ...COMMON_TRUE_TOKENS,
  'prioridade',
  'prioritario',
  'prioritaria',
]);

/**
 * Normalizes a "urgente" cell value. Accepts (case- and accent-insensitive):
 *   sim, s, yes, y, true, 1, urgente -> true
 * All other values (including empty) -> false.
 */
export function normalizeUrgente(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const str = typeof value === 'string' ? value : String(value);
  const norm = normalize(str);
  if (!norm) return false;
  return URGENTE_TRUE_TOKENS.has(norm);
}

/**
 * Normalizes a "prioridade" cell value. Accepts the same truthy values as
 * urgente, plus prioridade/prioritario/prioritaria.
 */
export function normalizePrioridade(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const str = typeof value === 'string' ? value : String(value);
  const norm = normalize(str);
  if (!norm) return false;
  return PRIORIDADE_TRUE_TOKENS.has(norm);
}

const NUMERO_HEADER_KEYS = new Set([
  'numero do processo',
  'numero',
]);
const ORIGEM_HEADER_KEYS = new Set(['origem', 'agrupador']);
const URGENTE_HEADER_KEY = 'urgente';
const PRIORIDADE_HEADER_KEYS = new Set(['prioridade', 'prioridades']);

/** Strips a UTF-8 BOM if present. */
function stripBom(text: string): string {
  if (text.charCodeAt(0) === 0xfeff) return text.slice(1);
  return text;
}

interface PickedHeaders {
  numeroKey: string | null;
  agrupadorKey: string | null;
  urgenteKey: string | null;
  prioridadeKey: string | null;
}

/** Picks the actual header keys (case/accent-insensitive) from the parsed fields. */
function pickHeaders(fields: string[]): PickedHeaders {
  let numeroKey: string | null = null;
  let agrupadorKey: string | null = null;
  let urgenteKey: string | null = null;
  let prioridadeKey: string | null = null;
  for (const f of fields) {
    const n = normalize(f);
    if (!numeroKey && NUMERO_HEADER_KEYS.has(n)) numeroKey = f;
    else if (!agrupadorKey && ORIGEM_HEADER_KEYS.has(n)) agrupadorKey = f;
    else if (!urgenteKey && n === URGENTE_HEADER_KEY) urgenteKey = f;
    else if (!prioridadeKey && PRIORIDADE_HEADER_KEYS.has(n)) prioridadeKey = f;
  }
  return { numeroKey, agrupadorKey, urgenteKey, prioridadeKey };
}

/**
 * Parses CSV text following the project's conventions:
 *   - separator ';'
 *   - header obrigatório (numero do processo|numero, origem|agrupador)
 *   - BOM tolerado, UTF-8
 *   - urgente/prioridade normalizados quando os cabeçalhos existirem
 *   - prioridade é opcional; ausência significa prioridade=false
 */
export function parseCsvText(text: string): ParseResult {
  const warnings: string[] = [];
  const rows: ParsedRow[] = [];
  const agrupadoresUnicosSet = new Set<string>();

  const cleaned = stripBom(text);

  const parsed = Papa.parse<Record<string, string>>(cleaned, {
    delimiter: ';',
    header: true,
    skipEmptyLines: true,
  });

  if (parsed.errors && parsed.errors.length > 0) {
    for (const err of parsed.errors) {
      warnings.push(`CSV parser: ${err.message}`);
    }
  }

  const fields = parsed.meta.fields ?? [];
  const headers = pickHeaders(fields);
  if (!headers.numeroKey) {
    warnings.push(
      'Cabeçalho ausente: "numero do processo" (ou "numero"). Linhas serão ignoradas.'
    );
  }
  if (!headers.agrupadorKey) {
    warnings.push('Cabeçalho ausente: "origem" (ou "agrupador"). Linhas serão ignoradas.');
  }
  if (!headers.urgenteKey) {
    warnings.push(
      'Cabeçalho ausente: "urgente". Todas as linhas serão tratadas como não-urgente.'
    );
  }

  if (!headers.numeroKey || !headers.agrupadorKey) {
    return { rows, warnings, agrupadoresUnicos: [] };
  }

  let validIndex = 0;
  parsed.data.forEach((row, i) => {
    const lineNumber = i + 2; // +1 for 0-based, +1 for header row
    const rawNumero = headers.numeroKey ? row[headers.numeroKey] : '';
    const rawAgrupador = headers.agrupadorKey
      ? row[headers.agrupadorKey]
      : '';
    const rawUrgente = headers.urgenteKey ? row[headers.urgenteKey] : '';
    const rawPrioridade = headers.prioridadeKey
      ? row[headers.prioridadeKey]
      : '';

    const numero = (rawNumero ?? '').toString().trim();
    const agrupadorNome = (rawAgrupador ?? '').toString().trim();

    if (!numero) {
      warnings.push(`Linha ${lineNumber}: número vazio, ignorada`);
      return;
    }
    if (!agrupadorNome) {
      warnings.push(`Linha ${lineNumber}: origem vazia, ignorada`);
      return;
    }

    const urgente = normalizeUrgente(rawUrgente);
    const prioridade = normalizePrioridade(rawPrioridade);

    rows.push({
      numero,
      agrupadorNome,
      urgente,
      prioridade,
      ordemCsv: validIndex,
    });
    agrupadoresUnicosSet.add(agrupadorNome);
    validIndex += 1;
  });

  return {
    rows,
    warnings,
    agrupadoresUnicos: Array.from(agrupadoresUnicosSet),
  };
}
