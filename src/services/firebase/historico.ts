/**
 * Histórico (auditoria) servido pelo banco EM MEMÓRIA do showcase.
 *
 * Sem Firestore: as leituras/escritas vão para `db.historico` (ver
 * `src/mock/db.ts`). As assinaturas públicas — `appendHistorico`,
 * `subscribeHistorico`, `subscribeHistoricoProcesso` e a interface
 * `HistoricoFilters` — são idênticas às do app original, então nenhum consumidor
 * mudou. Ordena por `timestamp` desc e aplica `limit`, como o Firestore fazia.
 */
import { Timestamp, type Unsubscribe } from 'firebase/firestore';
import { db, mockId } from '@/mock/db';
import type { HistoricoEntry, HistoricoTipo } from '@/types';

/**
 * Anexa uma entrada de auditoria ao histórico.
 * `timestamp` usa `Timestamp.now()`; `id` é gerado localmente (`mockId`).
 */
export async function appendHistorico(
  entry: Omit<HistoricoEntry, 'id' | 'timestamp'>
): Promise<string> {
  const id = mockId('h');
  db.historico.insert({
    id,
    tipo: entry.tipo,
    acaoPorUid: entry.acaoPorUid,
    acaoPorNome: entry.acaoPorNome,
    alvoUid: entry.alvoUid,
    processoId: entry.processoId,
    payload: entry.payload,
    timestamp: Timestamp.now(),
  });
  return id;
}

export interface HistoricoFilters {
  tipos?: HistoricoTipo[];
  acaoPorUid?: string;
  alvoUid?: string;
  processoId?: string;
  limit?: number;
}

function timestampMillis(entry: HistoricoEntry): number {
  return entry.timestamp.toMillis();
}

/** Predicado equivalente aos `where(...)` do Firestore para os filtros dados. */
function matchesFilters(entry: HistoricoEntry, filters: HistoricoFilters): boolean {
  if (
    filters.tipos &&
    filters.tipos.length > 0 &&
    !filters.tipos.includes(entry.tipo)
  ) {
    return false;
  }
  if (filters.acaoPorUid && entry.acaoPorUid !== filters.acaoPorUid) return false;
  if (filters.alvoUid && entry.alvoUid !== filters.alvoUid) return false;
  if (filters.processoId && entry.processoId !== filters.processoId) return false;
  return true;
}

/**
 * Assina o histórico aplicando os filtros no cliente (o mock não tem índices).
 * Ordena por `timestamp` desc e aplica o `limit` (padrão 200), como o original.
 */
export function subscribeHistorico(
  filters: HistoricoFilters,
  callback: (entries: HistoricoEntry[]) => void
): Unsubscribe {
  const max = filters.limit ?? 200;
  return db.historico.subscribe(
    (items) => {
      const entries = [...items].sort(
        (a, b) => timestampMillis(b) - timestampMillis(a)
      );
      callback(entries.slice(0, max));
    },
    (entry) => matchesFilters(entry, filters)
  );
}

export function subscribeHistoricoProcesso(
  processoId: string,
  callback: (entries: HistoricoEntry[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  // `onError` existe por compatibilidade de API (canal de erro do onSnapshot);
  // o banco em memória nunca falha, então nunca é chamado.
  void onError;
  return db.historico.subscribe(
    (items) => {
      const entries = [...items].sort(
        (a, b) => timestampMillis(b) - timestampMillis(a)
      );
      callback(entries);
    },
    (entry) => entry.processoId === processoId
  );
}
