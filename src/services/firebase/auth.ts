/**
 * Autenticação FAKE do showcase.
 *
 * Sem Google, sem Firebase Auth: um "usuário atual" em memória com pub/sub que
 * imita `onAuthStateChanged`. Mantém as mesmas assinaturas que o app já usava
 * (`onAuthChange`, `signInWithGoogle`, `signOutCurrent`) e adiciona atalhos de
 * persona para o botão de demonstração da tela de login.
 */
import type { User as FirebaseAuthUser, Unsubscribe } from 'firebase/auth';
import {
  DEMO_DISTRIBUIDOR_EMAIL,
  DEMO_DISTRIBUIDOR_UID,
  DEMO_RECEBEDOR_EMAIL,
  DEMO_RECEBEDOR_UID,
} from '@/mock/seed';

export type { FirebaseAuthUser };

type AuthListener = (user: FirebaseAuthUser | null) => void;

let currentUser: FirebaseAuthUser | null = null;
const listeners = new Set<AuthListener>();

function notify(): void {
  for (const l of listeners) l(currentUser);
}

function fakeUser(uid: string, email: string, displayName: string): FirebaseAuthUser {
  // Só os campos que o app realmente lê (uid/email/displayName/photoURL).
  return { uid, email, displayName, photoURL: null } as unknown as FirebaseAuthUser;
}

/** Entra como a persona de distribuidor (super-admin) da demonstração. */
export async function signInAsDistribuidor(): Promise<void> {
  currentUser = fakeUser(
    DEMO_DISTRIBUIDOR_UID,
    DEMO_DISTRIBUIDOR_EMAIL,
    'Marina (Distribuidor Demo)'
  );
  notify();
}

/** Entra como a persona de recebedor da demonstração. */
export async function signInAsRecebedor(): Promise<void> {
  currentUser = fakeUser(
    DEMO_RECEBEDOR_UID,
    DEMO_RECEBEDOR_EMAIL,
    'Bruno (Recebedor Demo)'
  );
  notify();
}

/** Compatibilidade com o app original: entra como distribuidor por padrão. */
export async function signInWithGoogle(): Promise<void> {
  await signInAsDistribuidor();
}

/** Sai (limpa o usuário atual). */
export function signOutCurrent(): Promise<void> {
  currentUser = null;
  notify();
  return Promise.resolve();
}

/** Assina mudanças de estado de auth. Emite o estado atual num tick. */
export function onAuthChange(callback: AuthListener): Unsubscribe {
  listeners.add(callback);
  const t = setTimeout(() => callback(currentUser), 0);
  return () => {
    clearTimeout(t);
    listeners.delete(callback);
  };
}
