/**
 * Config do sistema (singleton) servida pelo banco EM MEMÓRIA do showcase.
 *
 * Mantém as assinaturas do serviço original (`getConfigSistema`,
 * `subscribeConfigSistema`, `updateConfigSistema`). Sem Firestore, sem histórico:
 * o documento único vive em `db.config` (MockSingleton) e é sempre presente, por
 * isso não há caminho de "documento inexistente" como no app real.
 */
import { Timestamp, type Unsubscribe } from 'firebase/firestore';
import { db } from '@/mock/db';
import type { ConfigSistema } from '@/types';

/** Reads the singleton system config. */
export function getConfigSistema(): Promise<ConfigSistema> {
  return Promise.resolve(db.config.get());
}

/** Subscribes to the singleton system config. */
export function subscribeConfigSistema(
  callback: (config: ConfigSistema) => void
): Unsubscribe {
  return db.config.subscribe(callback);
}

/**
 * Updates the singleton system config, carimbando quem/quando atualizou.
 */
export function updateConfigSistema(
  patch: Partial<
    Pick<
      ConfigSistema,
      | 'prazoPadraoDiasUteis'
      | 'feriadosNacionais'
      | 'coordenacaoNotificacaoDistribuidorUids'
    >
  >,
  byUid: string,
  byNome: string
): Promise<void> {
  void byNome; // sem trilha de auditoria no showcase
  db.config.set({
    ...patch,
    ultimaAtualizacaoUid: byUid,
    ultimaAtualizacaoEm: Timestamp.now(),
  });
  return Promise.resolve();
}
