/**
 * Agrupadores servidos pelo banco EM MEMÓRIA do showcase (sem Firestore).
 *
 * Mantém exatamente as assinaturas do serviço original — as páginas continuam
 * consumindo `subscribeAgrupadores`, `getAgrupadores`, `createAgrupador`, etc.
 * sem qualquer mudança. A trilha de auditoria (histórico) e a semeadura do app
 * real são omitidas aqui: o banco já vem populado por `src/mock/seed.ts`.
 */
import { Timestamp, type Unsubscribe } from 'firebase/firestore';
import { db, mockId } from '@/mock/db';
import type { Agrupador } from '@/types';

/** Subscribes to all agrupadores. */
export function subscribeAgrupadores(
  callback: (list: Agrupador[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  void onError; // o mock nunca falha
  return db.agrupadores.subscribe(callback);
}

/** Reads all agrupadores once. */
export function getAgrupadores(): Promise<Agrupador[]> {
  return Promise.resolve(db.agrupadores.all());
}

/** Looks up an agrupador by exact name. Returns null if not found. */
export function getAgrupadorByNome(nome: string): Promise<Agrupador | null> {
  const [match] = db.agrupadores.find((a) => a.nome === nome);
  return Promise.resolve(match ?? null);
}

/** Creates a new agrupador and returns it. */
export function createAgrupador(
  nome: string,
  byUid: string,
  byNome: string
): Promise<Agrupador> {
  void byUid; // sem trilha de auditoria no showcase
  void byNome;
  const agrupador: Agrupador = {
    id: mockId('agrupador'),
    nome,
    prazoDiasUteisOverride: null,
    ativo: true,
    createdAt: Timestamp.now(),
  };
  db.agrupadores.insert(agrupador);
  return Promise.resolve(agrupador);
}

/** Updates fields of an agrupador. */
export function updateAgrupador(
  id: string,
  patch: Partial<Pick<Agrupador, 'nome' | 'prazoDiasUteisOverride' | 'ativo'>>,
  byUid: string,
  byNome: string
): Promise<void> {
  void byUid; // sem trilha de auditoria no showcase
  void byNome;
  db.agrupadores.update(id, patch);
  return Promise.resolve();
}

/**
 * No app real semeia a coleção quando vazia. No showcase o banco já vem
 * populado, então isto é um no-op que resolve com 0 (nenhum criado).
 */
export function seedIfEmpty(byUid: string, byNome: string): Promise<number> {
  void byUid;
  void byNome;
  return Promise.resolve(0);
}
