/**
 * Banco de dados EM MEMÓRIA (fake) que substitui o Firestore no showcase.
 *
 * Não há rede, credenciais nem persistência: tudo vive na aba do navegador e é
 * reiniciado ao recarregar. Os "serviços" em `src/services/firebase/*` foram
 * reescritos para ler/escrever aqui, mantendo exatamente as mesmas assinaturas
 * que o app já consumia — por isso nenhuma página precisou mudar.
 *
 * Semântica imita o `onSnapshot` do Firestore: `subscribe` emite os dados atuais
 * de forma assíncrona (após um pequeno atraso, para exibir o "carregando") e
 * volta a emitir a cada mutação.
 */
import { Timestamp, type Unsubscribe } from 'firebase/firestore';
import {
  seedAgrupadores,
  seedComentarios,
  seedConfigSistema,
  seedDistribuicoes,
  seedHistorico,
  seedNotices,
  seedNotificacoes,
  seedProcessos,
  seedTickets,
  seedUsers,
} from './seed';
import type {
  Agrupador,
  ConfigSistema,
  Distribuicao,
  GlobalNotice,
  HistoricoEntry,
  Processo,
  SuporteComentario,
  SuporteNotificacao,
  SuporteTicket,
  User,
} from '@/types';

/** Atraso do primeiro emit, p/ simular latência e exibir spinners brevemente. */
const EMIT_DELAY_MS = 80;

type Listener<T> = (items: T[]) => void;

/**
 * Coleção reativa simples com API no estilo Firestore (subscribe/mutations).
 *
 * A maioria das coleções tem chave `id`, mas algumas (ex.: `User`) usam outro
 * campo — por isso o acessor de id é configurável no construtor.
 */
export class MockCollection<T> {
  private items: T[];
  private listeners = new Set<() => void>();
  private idOf: (item: T) => string;

  constructor(
    initial: T[] = [],
    idOf: (item: T) => string = (i) => (i as { id: string }).id
  ) {
    this.items = [...initial];
    this.idOf = idOf;
  }

  all(): T[] {
    return [...this.items];
  }

  get(id: string): T | undefined {
    return this.items.find((i) => this.idOf(i) === id);
  }

  find(pred: (item: T) => boolean): T[] {
    return this.items.filter(pred);
  }

  /**
   * Assina alterações. Emite o estado atual (opcionalmente filtrado) após um
   * tick e depois a cada mutação. Retorna a função de cancelamento.
   */
  subscribe(cb: Listener<T>, filter?: (item: T) => boolean): Unsubscribe {
    const emit = () => cb(filter ? this.items.filter(filter) : this.all());
    this.listeners.add(emit);
    const t = setTimeout(emit, EMIT_DELAY_MS);
    return () => {
      clearTimeout(t);
      this.listeners.delete(emit);
    };
  }

  insert(item: T): void {
    this.items = [item, ...this.items];
    this.notify();
  }

  upsert(item: T): void {
    const key = this.idOf(item);
    const idx = this.items.findIndex((i) => this.idOf(i) === key);
    if (idx === -1) this.items = [item, ...this.items];
    else {
      const next = [...this.items];
      next[idx] = item;
      this.items = next;
    }
    this.notify();
  }

  update(id: string, patch: Partial<T>): void {
    const idx = this.items.findIndex((i) => this.idOf(i) === id);
    if (idx === -1) return;
    const next = [...this.items];
    next[idx] = { ...next[idx], ...patch };
    this.items = next;
    this.notify();
  }

  remove(id: string): void {
    this.items = this.items.filter((i) => this.idOf(i) !== id);
    this.notify();
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }
}

/** Singleton reativo (para documentos únicos, ex.: config do sistema). */
export class MockSingleton<T> {
  private value: T;
  private listeners = new Set<(v: T) => void>();

  constructor(initial: T) {
    this.value = initial;
  }

  get(): T {
    return this.value;
  }

  subscribe(cb: (v: T) => void): Unsubscribe {
    this.listeners.add(cb);
    const t = setTimeout(() => cb(this.value), EMIT_DELAY_MS);
    return () => {
      clearTimeout(t);
      this.listeners.delete(cb);
    };
  }

  set(patch: Partial<T>): void {
    this.value = { ...this.value, ...patch };
    for (const l of this.listeners) l(this.value);
  }
}

// Tipos auxiliares p/ coleções cujos itens carregam um campo de "escopo"
// (usado só para filtrar no mock; o app nunca vê esse campo).
export type ComentarioDoc = SuporteComentario & { ticketId: string };
export type NotificacaoDoc = SuporteNotificacao & { uid: string };
export interface ProcessoNotaDoc {
  id: string;
  processoId: string;
  texto: string;
  autorUid: string;
  autorNome: string;
  criadoEm: Timestamp;
  atualizadoEm: Timestamp;
}
export interface NoticeDismissalDoc {
  id: string;
  uid: string;
  noticeId: string;
  noticeVersion: number;
}

/** Instância única do "banco". */
export const db = {
  users: new MockCollection<User>(seedUsers, (u) => u.uid),
  agrupadores: new MockCollection<Agrupador>(seedAgrupadores),
  processos: new MockCollection<Processo>(seedProcessos),
  distribuicoes: new MockCollection<Distribuicao>(seedDistribuicoes),
  notices: new MockCollection<GlobalNotice>(seedNotices),
  noticeDismissals: new MockCollection<NoticeDismissalDoc>([]),
  historico: new MockCollection<HistoricoEntry>(seedHistorico),
  processoNotas: new MockCollection<ProcessoNotaDoc>([]),
  tickets: new MockCollection<SuporteTicket>(seedTickets),
  comentarios: new MockCollection<ComentarioDoc>(seedComentarios),
  notificacoes: new MockCollection<NotificacaoDoc>(seedNotificacoes),
  config: new MockSingleton<ConfigSistema>(seedConfigSistema),
};

/** Gera ids incrementais estáveis para novos documentos criados na sessão. */
let idCounter = 1;
export function mockId(prefix = 'doc'): string {
  idCounter += 1;
  return `${prefix}-${idCounter}-${Math.round(performance.now())}`;
}
