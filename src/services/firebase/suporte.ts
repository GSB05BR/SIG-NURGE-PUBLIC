/**
 * Serviço de SUPORTE reescrito para o banco em memória (showcase público).
 *
 * Mesma API pública do original em Firestore — as páginas não mudaram. Aqui os
 * dados vêm de `src/mock/db.ts` (sem rede, sem Cloud Functions): as assinaturas,
 * os nomes e os tipos de retorno são idênticos aos do app real.
 */
import { Timestamp, type Unsubscribe } from 'firebase/firestore';
import { db, mockId } from '@/mock/db';
import type { ComentarioDoc } from '@/mock/db';
import type {
  SuporteAnexo,
  SuporteComentario,
  SuporteNotificacao,
  SuporteStatus,
  SuporteTipo,
  SuporteTicket,
  UserRole,
} from '@/types';

// ----- Helpers -----

function millis(t: Timestamp | null | undefined): number {
  return t ? t.toMillis() : 0;
}

// ----- Tickets -----

export async function criarChamado(input: {
  tipo: SuporteTipo;
  titulo: string;
  descricao: string;
  anexos: SuporteAnexo[];
  byUid: string;
  byNome: string;
  byEmail: string;
}): Promise<string> {
  const titulo = input.titulo.trim();
  if (!titulo) throw new Error('Informe um título.');
  const now = Timestamp.now();
  const id = mockId('tk');
  const ticket: SuporteTicket = {
    id,
    tipo: input.tipo,
    titulo,
    descricao: input.descricao.trim(),
    anexos: input.anexos,
    status: 'em_analise',
    criadoPorUid: input.byUid,
    criadoPorNome: input.byNome,
    criadoPorEmail: input.byEmail,
    comentariosCount: 0,
    ultimaAtividadeEm: now,
    ultimaAcaoPorUid: input.byUid,
    criadoEm: now,
    atualizadoEm: now,
  };
  db.tickets.insert(ticket);
  return id;
}

/** Recebedor vê só os próprios; distribuidor vê todos. Ordena por atividade. */
export function subscribeChamados(
  opts: { role: UserRole | null | undefined; uid: string },
  cb: (list: SuporteTicket[]) => void
): Unsubscribe {
  const filter =
    opts.role === 'distribuidor'
      ? undefined
      : (t: SuporteTicket) => t.criadoPorUid === opts.uid;
  return db.tickets.subscribe((list) => {
    const sorted = [...list].sort(
      (a, b) => millis(b.ultimaAtividadeEm) - millis(a.ultimaAtividadeEm)
    );
    cb(sorted);
  }, filter);
}

export function subscribeChamado(
  ticketId: string,
  cb: (ticket: SuporteTicket | null) => void
): Unsubscribe {
  return db.tickets.subscribe((list) => {
    cb(list.find((t) => t.id === ticketId) ?? null);
  });
}

export async function mudarStatus(input: {
  ticketId: string;
  status: SuporteStatus;
  byUid: string;
}): Promise<void> {
  const now = Timestamp.now();
  db.tickets.update(input.ticketId, {
    status: input.status,
    ultimaAcaoPorUid: input.byUid,
    ultimaAtividadeEm: now,
    atualizadoEm: now,
  });
}

export async function excluirChamado(ticketId: string): Promise<void> {
  // Sem cascata: apaga os comentários do chamado e depois o próprio chamado.
  for (const c of db.comentarios.find((c) => c.ticketId === ticketId)) {
    db.comentarios.remove(c.id);
  }
  db.tickets.remove(ticketId);
}

// ----- Comentários -----

export function subscribeComentarios(
  ticketId: string,
  cb: (list: SuporteComentario[]) => void
): Unsubscribe {
  return db.comentarios.subscribe((list) => {
    const sorted = [...list].sort(
      (a, b) => millis(a.criadoEm) - millis(b.criadoEm)
    );
    cb(sorted);
  }, (c) => c.ticketId === ticketId);
}

export async function adicionarComentario(input: {
  ticketId: string;
  texto: string;
  anexos: SuporteAnexo[];
  autorUid: string;
  autorNome: string;
  autorRole: SuporteComentario['autorRole'];
}): Promise<void> {
  const texto = input.texto.trim();
  if (!texto && input.anexos.length === 0) {
    throw new Error('Escreva uma mensagem ou anexe um arquivo.');
  }
  const now = Timestamp.now();
  const comentario: ComentarioDoc = {
    id: mockId('c'),
    ticketId: input.ticketId,
    texto,
    anexos: input.anexos,
    autorUid: input.autorUid,
    autorNome: input.autorNome,
    autorRole: input.autorRole,
    criadoEm: now,
  };
  db.comentarios.insert(comentario);
  // No app real a Cloud Function faz isso; aqui atualizamos direto no mock.
  const ticket = db.tickets.get(input.ticketId);
  if (ticket) {
    db.tickets.update(input.ticketId, {
      comentariosCount: ticket.comentariosCount + 1,
      ultimaAcaoPorUid: input.autorUid,
      ultimaAtividadeEm: now,
      atualizadoEm: now,
    });
  }
}

export async function excluirComentario(
  ticketId: string,
  comentarioId: string
): Promise<void> {
  db.comentarios.remove(comentarioId);
}

// ----- Notificações (por usuário) -----

export function subscribeNotificacoes(
  uid: string,
  cb: (list: SuporteNotificacao[]) => void
): Unsubscribe {
  return db.notificacoes.subscribe((list) => {
    const sorted = [...list]
      .sort((a, b) => millis(b.criadoEm) - millis(a.criadoEm))
      .slice(0, 40);
    cb(sorted);
  }, (n) => n.uid === uid);
}

export async function marcarNotificacaoLida(
  uid: string,
  notifId: string
): Promise<void> {
  db.notificacoes.update(notifId, { lida: true });
}

export async function marcarTodasNotificacoesLidas(uid: string): Promise<void> {
  for (const n of db.notificacoes.find((n) => n.uid === uid && !n.lida)) {
    db.notificacoes.update(n.id, { lida: true });
  }
}
