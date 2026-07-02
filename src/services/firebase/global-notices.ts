/**
 * Avisos globais — versão do showcase (banco em memória).
 *
 * Reescrito para ler/escrever os `MockCollection` em `src/mock/db.ts`
 * (`db.notices` e `db.noticeDismissals`), mantendo exatamente as mesmas
 * assinaturas públicas do serviço original de Firestore. Sem rede, sem
 * credenciais e sem persistência — tudo vive na aba do navegador.
 */
import { Timestamp, type Unsubscribe } from 'firebase/firestore';
import { db, mockId } from '@/mock/db';
import {
  makeNoticeDismissalKey,
  normalizeNoticeTargetRoles,
  normalizeTargetUserUids,
  sanitizeNoticeHtml,
} from '@/lib/global-notices';
import type { GlobalNotice, NoticeTargetRole } from '@/types';

interface NoticeActor {
  byUid: string;
  byNome: string;
}

interface NoticePayload {
  title: string;
  bodyHtml: string;
  targetRoles: NoticeTargetRole[];
  targetUserUids: string[];
}

function cleanNoticePayload(input: {
  title: string;
  bodyHtml: string;
  targetRoles: readonly string[];
  targetUserUids?: readonly string[];
}): NoticePayload {
  const title = input.title.trim();
  const bodyHtml = sanitizeNoticeHtml(input.bodyHtml);
  if (!title) {
    throw new Error('Informe o título do aviso.');
  }
  if (!bodyHtml.trim()) {
    throw new Error('Digite o texto do aviso.');
  }
  return {
    title,
    bodyHtml,
    targetRoles: normalizeNoticeTargetRoles(input.targetRoles),
    targetUserUids: normalizeTargetUserUids(input.targetUserUids),
  };
}

export async function createGlobalNotice(input: {
  title: string;
  bodyHtml: string;
  targetRoles: readonly string[];
  targetUserUids?: readonly string[];
  byUid: string;
  byNome: string;
}): Promise<string> {
  const payload = cleanNoticePayload(input);
  const id = mockId('notice');
  const now = Timestamp.now();
  const notice: GlobalNotice = {
    id,
    title: payload.title,
    bodyHtml: payload.bodyHtml,
    targetRoles: payload.targetRoles,
    targetUserUids: payload.targetUserUids,
    active: true,
    noticeVersion: 1,
    createdAtMs: Date.now(),
    createdAt: now,
    updatedAt: now,
    createdByUid: input.byUid,
    createdByName: input.byNome,
    updatedByUid: input.byUid,
    reactivatedAtMs: null,
    reactivatedAt: null,
    reactivatedByUid: null,
  };
  db.notices.insert(notice);
  return id;
}

export async function updateGlobalNotice(
  id: string,
  input: {
    title: string;
    bodyHtml: string;
    targetRoles: readonly string[];
    targetUserUids?: readonly string[];
    byUid: string;
    byNome: string;
  }
): Promise<void> {
  const payload = cleanNoticePayload(input);
  const noticeVersion = Date.now();
  db.notices.update(id, {
    title: payload.title,
    bodyHtml: payload.bodyHtml,
    targetRoles: payload.targetRoles,
    targetUserUids: payload.targetUserUids,
    noticeVersion,
    updatedAt: Timestamp.now(),
    updatedByUid: input.byUid,
  });
}

export async function setGlobalNoticeActive(
  id: string,
  active: boolean,
  actor: NoticeActor
): Promise<void> {
  const notice = db.notices.get(id);
  if (!notice) {
    throw new Error('Aviso não encontrado.');
  }
  const patch: Partial<GlobalNotice> = {
    active,
    updatedAt: Timestamp.now(),
    updatedByUid: actor.byUid,
  };
  if (active && !notice.active) {
    const version = Date.now();
    patch.noticeVersion = version;
    patch.reactivatedAtMs = version;
    patch.reactivatedAt = Timestamp.now();
    patch.reactivatedByUid = actor.byUid;
  }
  db.notices.update(id, patch);
}

export async function deleteGlobalNotice(
  id: string,
  actor: NoticeActor
): Promise<void> {
  void actor;
  db.notices.remove(id);
}

export function listenGlobalNotices(
  onChange: (notices: GlobalNotice[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  void onError;
  return db.notices.subscribe((notices) => {
    onChange(
      [...notices].sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0))
    );
  });
}

export async function dismissGlobalNotice(
  noticeId: string,
  noticeVersion: number,
  uid: string
): Promise<void> {
  db.noticeDismissals.insert({
    id: mockId('dismiss'),
    uid,
    noticeId,
    noticeVersion,
  });
}

export function listenUserNoticeDismissals(
  uid: string,
  onChange: (dismissedKeys: Set<string>) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  void onError;
  return db.noticeDismissals.subscribe(
    (docs) =>
      onChange(
        new Set(
          docs.map((d) => makeNoticeDismissalKey(d.noticeId, d.noticeVersion))
        )
      ),
    (d) => d.uid === uid
  );
}
