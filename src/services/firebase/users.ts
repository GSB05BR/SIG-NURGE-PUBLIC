/**
 * Serviço de usuários — versão showcase (banco em memória, sem Firestore).
 * Mantém as mesmas assinaturas do original; escreve em `db.users`.
 */
import { Timestamp, type Unsubscribe } from 'firebase/firestore';
import { db } from '@/mock/db';
import { appendHistorico } from './historico';
import type { AgrupadoresMode, User, UserRole } from '@/types';

/** Lê um usuário por uid. Retorna null se não existir. */
export async function getUserByUid(uid: string): Promise<User | null> {
  return db.users.get(uid) ?? null;
}

export interface CreateUserOnFirstLoginInput {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string | null;
  isSuperAdmin: boolean;
}

export async function createUserOnFirstLogin(
  input: CreateUserOnFirstLoginInput
): Promise<User> {
  const now = Timestamp.now();
  const role: UserRole = input.isSuperAdmin ? 'distribuidor' : 'pendente';
  const user: User = {
    uid: input.uid,
    email: input.email,
    displayName: input.displayName,
    photoURL: input.photoURL,
    role,
    approved: input.isSuperAdmin,
    approvedByUid: input.isSuperAdmin ? input.uid : null,
    approvedAt: input.isSuperAdmin ? now : null,
    agrupadoresMode: input.isSuperAdmin ? 'todos' : null,
    agrupadoresPermitidos: [],
    ativo: true,
    createdAt: now,
    updatedAt: now,
  };
  db.users.upsert(user);
  return user;
}

export interface EnsureSuperAdminUserDocInput {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string | null;
}

export async function ensureSuperAdminUserDoc(
  input: EnsureSuperAdminUserDocInput
): Promise<User> {
  const existing = db.users.get(input.uid);
  if (!existing) {
    return createUserOnFirstLogin({ ...input, isSuperAdmin: true });
  }
  const upgraded: User = {
    ...existing,
    role: 'distribuidor',
    approved: true,
    approvedByUid: input.uid,
    approvedAt: existing.approvedAt ?? Timestamp.now(),
    agrupadoresMode: existing.agrupadoresMode ?? 'todos',
    ativo: true,
    displayName: input.displayName,
    photoURL: input.photoURL,
    updatedAt: Timestamp.now(),
  };
  db.users.upsert(upgraded);
  return upgraded;
}

/** Assina todos os usuários, ordenados por displayName. */
export function subscribeAllUsers(
  callback: (users: User[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  void onError;
  return db.users.subscribe((users) =>
    callback([...users].sort((a, b) => a.displayName.localeCompare(b.displayName)))
  );
}

/** Assina usuários com role='pendente' (aguardando aprovação). */
export function subscribePendingUsers(
  callback: (users: User[]) => void
): Unsubscribe {
  return db.users.subscribe(callback, (u) => u.role === 'pendente');
}

export async function approveUser(
  targetUid: string,
  role: UserRole,
  byUid: string,
  byNome: string
): Promise<void> {
  const before = db.users.get(targetUid);
  db.users.update(targetUid, {
    approved: true,
    role,
    approvedByUid: byUid,
    approvedAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  await appendHistorico({
    tipo: 'aprovacao_usuario',
    acaoPorUid: byUid,
    acaoPorNome: byNome,
    alvoUid: targetUid,
    processoId: null,
    payload: { roleAnterior: before?.role ?? null, roleNovo: role },
  });
}

export async function rejectUser(
  targetUid: string,
  byUid: string,
  byNome: string
): Promise<void> {
  db.users.update(targetUid, { ativo: false, updatedAt: Timestamp.now() });
  await appendHistorico({
    tipo: 'rejeicao_usuario',
    acaoPorUid: byUid,
    acaoPorNome: byNome,
    alvoUid: targetUid,
    processoId: null,
    payload: {},
  });
}

export async function updateUserRole(
  targetUid: string,
  role: UserRole,
  byUid: string,
  byNome: string
): Promise<void> {
  const before = db.users.get(targetUid);
  db.users.update(targetUid, { role, updatedAt: Timestamp.now() });
  await appendHistorico({
    tipo: 'mudanca_role',
    acaoPorUid: byUid,
    acaoPorNome: byNome,
    alvoUid: targetUid,
    processoId: null,
    payload: { roleAnterior: before?.role ?? null, roleNovo: role },
  });
}

export async function updateUserAgrupadores(
  targetUid: string,
  mode: AgrupadoresMode,
  agrupadoresIds: string[],
  byUid: string,
  byNome: string
): Promise<void> {
  const before = db.users.get(targetUid);
  db.users.update(targetUid, {
    agrupadoresMode: mode,
    agrupadoresPermitidos: agrupadoresIds,
    updatedAt: Timestamp.now(),
  });
  await appendHistorico({
    tipo: 'mudanca_permissao',
    acaoPorUid: byUid,
    acaoPorNome: byNome,
    alvoUid: targetUid,
    processoId: null,
    payload: {
      modoAnterior: before?.agrupadoresMode ?? null,
      permitidosAnterior: before?.agrupadoresPermitidos ?? [],
      modoNovo: mode,
      permitidosNovo: agrupadoresIds,
    },
  });
}

export async function setUserAtivo(
  targetUid: string,
  ativo: boolean,
  byUid: string,
  byNome: string
): Promise<void> {
  db.users.update(targetUid, { ativo, updatedAt: Timestamp.now() });
  await appendHistorico({
    tipo: 'toggle_ativo_usuario',
    acaoPorUid: byUid,
    acaoPorNome: byNome,
    alvoUid: targetUid,
    processoId: null,
    payload: { ativo },
  });
}
