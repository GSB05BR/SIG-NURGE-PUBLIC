/**
 * Registro de super-admins — versão showcase (em memória).
 * Mesmas assinaturas do original; dados vêm do seed fictício.
 */
import { Timestamp } from 'firebase/firestore';
import { seedSuperAdminEmails } from '@/mock/seed';

export interface SuperAdminEntry {
  addedAt: Timestamp;
  addedByUid: string;
}

export interface SuperAdminsRegistry {
  emails: Record<string, SuperAdminEntry>;
}

// Cópia mutável em memória (permite "registrar" novos e-mails na sessão).
const emails: Record<string, SuperAdminEntry> = Object.fromEntries(
  Object.entries(seedSuperAdminEmails).map(([email, v]) => [
    email,
    { addedAt: v.addedAt, addedByUid: v.uid },
  ])
);

/** Lê o registro de super-admins. */
export async function getSuperAdminsRegistry(): Promise<SuperAdminsRegistry | null> {
  return { emails: { ...emails } };
}

/** Garante que o e-mail esteja registrado (idempotente). No-op de rede. */
export async function ensureSuperAdminInRegistry(
  email: string,
  uid: string
): Promise<void> {
  const normalized = email.trim().toLowerCase();
  if (!normalized || emails[normalized]) return;
  emails[normalized] = { addedAt: Timestamp.now(), addedByUid: uid };
}
