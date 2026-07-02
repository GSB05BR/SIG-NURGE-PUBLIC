import { useEffect } from 'react';
import { create } from 'zustand';
import type { Unsubscribe } from 'firebase/firestore';
import {
  subscribeProcessosAbertos,
  subscribeProcessosBySemana,
} from '@/services/firebase/processos';
import { shouldResubscribeListener } from '@/lib/listener-retry';
import { useAuthStore } from '@/store/authStore';
import type { Processo } from '@/types';

// Store global de processos com listeners COMPARTILHADOS e reference-counted.
//
// Problema que resolve (docs/otimizacao-leituras-firestore.md, item 1): cada
// página assinava seus próprios `onSnapshot` ao montar e os derrubava ao
// desmontar. Navegar Overview → Produtividade → Overview reabria os mesmos
// listeners e re-lia todos os documentos. Aqui, o listener de uma query é
// aberto UMA vez e mantido vivo enquanto houver consumidores (e por um tempo
// depois, para sobreviver à navegação). Não depende de cache nem de resume
// token — é puro "parar de reabrir o mesmo listener".

interface ProcessosState {
  abertos: Processo[] | null;
  /** Processos por semana ISO; cada chave tem seu próprio listener compartilhado. */
  semanas: Record<string, Processo[] | null>;
  // Campos de erro PARALELOS (aditivos): não alteram o contrato de sucesso de
  // `abertos`/`semanas`. Um listener que falha (permissão/índice/rede) grava o
  // erro aqui para que o consumidor saia do estado de loading e mostre a falha
  // em vez de spinner eterno. Voltam a null quando o listener recupera.
  abertosError: Error | null;
  semanasError: Record<string, Error | null>;
}

const useProcessosStore = create<ProcessosState>(() => ({
  abertos: null,
  semanas: {},
  abertosError: null,
  semanasError: {},
}));

// ---------------------------------------------------------------------------
// Bookkeeping de listeners em nível de módulo (sobrevive a HMR/StrictMode, igual
// ao padrão idempotente de authStore.ts).
// ---------------------------------------------------------------------------

let abertosUnsub: Unsubscribe | null = null;
let abertosRefs = 0;

const semanaUnsub: Record<string, Unsubscribe> = {};
const semanaRefs: Record<string, number> = {};
/** Chaves de semana com 0 consumidores, em ordem de liberação (LRU). */
const semanaIdle: string[] = [];
/** Quantos listeners de semana ociosos (0 refs) mantemos vivos antes de podar. */
const MAX_SEMANAS_OCIOSAS = 8;

/**
 * Abre a assinatura compartilhada de `abertos` (se ainda não houver uma viva).
 * No sucesso, limpa qualquer erro pendente. No erro, grava o erro E zera o
 * bookkeeping: o `onSnapshot` do Firestore é TERMINAL (não re-tenta), então o
 * listener já está morto; nulificar `abertosUnsub` é o que permite re-assinar
 * (via `retryAbertos` ou um novo `retainAbertos`).
 */
function assinarAbertos(): void {
  if (abertosUnsub) return;
  abertosUnsub = subscribeProcessosAbertos(
    (list) =>
      useProcessosStore.setState({ abertos: list, abertosError: null }),
    (error) => {
      abertosUnsub = null;
      useProcessosStore.setState({ abertosError: error });
    }
  );
}

function retainAbertos(): void {
  abertosRefs += 1;
  assinarAbertos();
}

function releaseAbertos(): void {
  abertosRefs = Math.max(0, abertosRefs - 1);
  // `abertos` é um único listener sempre operacionalmente relevante: mantemos
  // vivo enquanto o app estiver aberto. Só é derrubado no logout (clearAll).
}

/** Abre a assinatura de uma semana (se ainda não houver). Mesma lógica de
 * sucesso/erro de `assinarAbertos`, mas por chave ISO. */
function assinarSemana(semanaIso: string): void {
  if (semanaUnsub[semanaIso]) return;
  semanaUnsub[semanaIso] = subscribeProcessosBySemana(
    semanaIso,
    (list) =>
      useProcessosStore.setState((s) => ({
        semanas: { ...s.semanas, [semanaIso]: list },
        semanasError: { ...s.semanasError, [semanaIso]: null },
      })),
    (error) => {
      delete semanaUnsub[semanaIso];
      useProcessosStore.setState((s) => ({
        semanasError: { ...s.semanasError, [semanaIso]: error },
      }));
    }
  );
}

function retainSemana(semanaIso: string): void {
  semanaRefs[semanaIso] = (semanaRefs[semanaIso] ?? 0) + 1;
  const idleIdx = semanaIdle.indexOf(semanaIso);
  if (idleIdx !== -1) semanaIdle.splice(idleIdx, 1);
  assinarSemana(semanaIso);
}

function releaseSemana(semanaIso: string): void {
  const next = Math.max(0, (semanaRefs[semanaIso] ?? 0) - 1);
  semanaRefs[semanaIso] = next;
  if (next > 0) return;
  // Sem consumidores: mantém o listener vivo (não re-lê ao navegar de volta),
  // mas limita quantas semanas ociosas acumulam ao longo de uma sessão longa.
  if (!semanaIdle.includes(semanaIso)) semanaIdle.push(semanaIso);
  while (semanaIdle.length > MAX_SEMANAS_OCIOSAS) {
    const evict = semanaIdle.shift();
    if (evict && semanaUnsub[evict] && (semanaRefs[evict] ?? 0) === 0) {
      semanaUnsub[evict]();
      delete semanaUnsub[evict];
      delete semanaRefs[evict];
      useProcessosStore.setState((s) => {
        const semanas = { ...s.semanas };
        delete semanas[evict];
        const semanasError = { ...s.semanasError };
        delete semanasError[evict];
        return { semanas, semanasError };
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Memoização da lista global "todos" (item 3A).
//
// `getAllProcessos()` é `getDocs` (busca única) — não fica barato com cache
// persistente (item 4), pois online sempre vai ao servidor. Guardamos o
// resultado na sessão para que remontagens da página Processos (navegar pra
// fora e voltar) não re-leiam a coleção inteira. É invalidado por escrita
// (botão Atualizar / mutações via `refresh()`), no logout, e por TTL curto para
// que mudanças vindas de outras telas/sessões se auto-corrijam.
// ---------------------------------------------------------------------------

const TODOS_TTL_MS = 5 * 60 * 1000;
let todosCache: { data: Processo[]; at: number } | null = null;

/** Lista "todos" memoizada (ou null se vazia/expirada). Não conta leitura. */
export function getTodosCache(): Processo[] | null {
  if (!todosCache) return null;
  if (Date.now() - todosCache.at > TODOS_TTL_MS) {
    todosCache = null;
    return null;
  }
  return todosCache.data;
}

export function setTodosCache(data: Processo[]): void {
  todosCache = { data, at: Date.now() };
}

export function invalidateTodosCache(): void {
  todosCache = null;
}

// Memoização do histórico de concluídos do recebedor (item 6). A página
// Histórico lê só os ~100 concluídos mais recentes (query ordenada + limit) e
// filtra client-side dentro dessa janela; guardamos o resultado da sessão para
// que remontagens não releiam.
let concluidosRecebedorCache: {
  uid: string;
  data: Processo[];
  at: number;
} | null = null;

export function getConcluidosRecebedorCache(uid: string): Processo[] | null {
  if (!concluidosRecebedorCache || concluidosRecebedorCache.uid !== uid) {
    return null;
  }
  if (Date.now() - concluidosRecebedorCache.at > TODOS_TTL_MS) {
    concluidosRecebedorCache = null;
    return null;
  }
  return concluidosRecebedorCache.data;
}

export function setConcluidosRecebedorCache(
  uid: string,
  data: Processo[]
): void {
  concluidosRecebedorCache = { uid, data, at: Date.now() };
}

export function invalidateConcluidosRecebedorCache(): void {
  concluidosRecebedorCache = null;
}

// Memoização de buscas por período FECHADO (item 2). Períodos cujo fim já passou
// não mudam, então re-varrê-los a cada visita é desperdício. A chave inclui o
// tipo de busca e os limites do período. Períodos abertos (mês corrente etc.)
// NÃO são cacheados pelos chamadores, para não exibir dados velhos.
const periodoCache = new Map<string, { data: Processo[]; at: number }>();

export function getPeriodoCache(key: string): Processo[] | null {
  const hit = periodoCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TODOS_TTL_MS) {
    periodoCache.delete(key);
    return null;
  }
  return hit.data;
}

export function setPeriodoCache(key: string, data: Processo[]): void {
  periodoCache.set(key, { data, at: Date.now() });
}

export function invalidatePeriodoCache(): void {
  periodoCache.clear();
}

/** Derruba todos os listeners e zera o estado (chamado no logout). */
function clearAll(): void {
  if (abertosUnsub) {
    abertosUnsub();
    abertosUnsub = null;
  }
  abertosRefs = 0;
  for (const key of Object.keys(semanaUnsub)) {
    semanaUnsub[key]();
    delete semanaUnsub[key];
  }
  for (const key of Object.keys(semanaRefs)) delete semanaRefs[key];
  semanaIdle.length = 0;
  todosCache = null;
  concluidosRecebedorCache = null;
  periodoCache.clear();
  useProcessosStore.setState({
    abertos: null,
    semanas: {},
    abertosError: null,
    semanasError: {},
  });
}

// Limpa tudo quando o usuário sai (firebaseUser passa de algo -> null). Idempotente.
let authWatcherInstalled = false;
function installAuthWatcher(): void {
  if (authWatcherInstalled) return;
  authWatcherInstalled = true;
  useAuthStore.subscribe((state, prev) => {
    if (prev.firebaseUser && !state.firebaseUser) clearAll();
  });
}
installAuthWatcher();

// ---------------------------------------------------------------------------
// Hooks de consumo. Cada consumidor "retém" o listener no mount e o "libera" no
// unmount; o reference counting garante uma única assinatura por query.
// ---------------------------------------------------------------------------

/** Processos com status aberto (pendente/em_andamento/coordenação/espera). */
export function useProcessosAbertos(): Processo[] | null {
  useEffect(() => {
    retainAbertos();
    return () => releaseAbertos();
  }, []);
  return useProcessosStore((s) => s.abertos);
}

/**
 * Processos de uma semana ISO. Passe `null` para não assinar (ex.: a página está
 * num modo que não usa dados de semana). Quando duas partes da UI pedem a mesma
 * semana (ex.: semana atual + pendências da semana atual), compartilham um único
 * listener.
 */
export function useProcessosSemana(
  semanaIso: string | null
): Processo[] | null {
  useEffect(() => {
    if (!semanaIso) return;
    retainSemana(semanaIso);
    return () => releaseSemana(semanaIso);
  }, [semanaIso]);
  return useProcessosStore((s) =>
    semanaIso ? s.semanas[semanaIso] ?? null : null
  );
}

// ---------------------------------------------------------------------------
// Selectors de erro (aditivos) + retry. Permitem que os consumidores saiam do
// loading e exibam uma falha visível em vez de spinner eterno.
// ---------------------------------------------------------------------------

/** Erro do listener `abertos` (null se saudável). */
export function useProcessosAbertosError(): Error | null {
  return useProcessosStore((s) => s.abertosError);
}

/** Erro do listener de uma semana ISO (null se saudável ou sem assinatura). */
export function useProcessosSemanaError(
  semanaIso: string | null
): Error | null {
  return useProcessosStore((s) =>
    semanaIso ? s.semanasError[semanaIso] ?? null : null
  );
}

/**
 * Re-assina o listener `abertos` após uma falha. Não mexe no ref-count: só
 * re-assina se ainda houver consumidores (refs > 0) e a assinatura estiver
 * morta (unsub == null). Limpa o erro otimisticamente para que a UI saia do
 * estado de falha enquanto a nova assinatura carrega.
 */
export function retryAbertos(): void {
  if (!shouldResubscribeListener(abertosRefs, Boolean(abertosUnsub))) return;
  useProcessosStore.setState({ abertosError: null });
  assinarAbertos();
}

/** Idem `retryAbertos`, por chave de semana. */
export function retrySemana(semanaIso: string): void {
  if (
    !shouldResubscribeListener(
      semanaRefs[semanaIso] ?? 0,
      Boolean(semanaUnsub[semanaIso])
    )
  )
    return;
  useProcessosStore.setState((s) => ({
    semanasError: { ...s.semanasError, [semanaIso]: null },
  }));
  assinarSemana(semanaIso);
}

export { useProcessosStore };
