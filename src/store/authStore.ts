import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { User as FirebaseAuthUser, Unsubscribe } from 'firebase/auth';
import {
  onAuthChange,
  signOutCurrent,
} from '@/services/firebase/auth';
import {
  createUserOnFirstLogin,
  ensureSuperAdminUserDoc,
  getUserByUid,
} from '@/services/firebase/users';
import {
  ensureSuperAdminInRegistry,
  getSuperAdminsRegistry,
} from '@/services/firebase/super-admins';
import { isSuperAdminEmail } from '@/lib/super-admins';
import type { User } from '@/types';

interface AuthState {
  firebaseUser: FirebaseAuthUser | null;
  userDoc: User | null;
  isSuperAdmin: boolean;
  loading: boolean;
  error: string | null;
}

interface AuthActions {
  init: () => Unsubscribe;
  signOut: () => Promise<void>;
  setError: (err: string | null) => void;
}

type AuthStore = AuthState & AuthActions;

const initialState: AuthState = {
  firebaseUser: null,
  userDoc: null,
  isSuperAdmin: false,
  loading: true,
  error: null,
};

let initialized = false;
let unsubscribe: Unsubscribe | null = null;

const useAuthStore = create<AuthStore>((set) => ({
  ...initialState,

  init: () => {
    // Idempotent: only register the listener once across HMR / StrictMode.
    if (initialized && unsubscribe) {
      return unsubscribe;
    }
    initialized = true;

    unsubscribe = onAuthChange(async (firebaseUser) => {
      // Mark loading while we resolve the user doc for this auth state.
      set({ loading: true, error: null });

      if (!firebaseUser) {
        set({
          firebaseUser: null,
          userDoc: null,
          isSuperAdmin: false,
          loading: false,
        });
        return;
      }

      try {
        const email = firebaseUser.email ?? '';
        let isSuper = isSuperAdminEmail(email);

        // Only explicitly configured super-admin emails are elevated. Everyone
        // else creates/keeps a pending user doc on first login.
        if (!isSuper) {
          try {
            const registry = await getSuperAdminsRegistry();
            const emailLc = email.toLowerCase();
            const inRegistry =
              registry !== null && registry.emails?.[emailLc] !== undefined;
            if (inRegistry) {
              isSuper = true;
            }
          } catch {
            // Falha de leitura não bloqueia o fluxo; usuário comum segue como pendente.
          }
        }

        let userDoc: User | null;

        if (isSuper) {
          // Cria/atualiza user doc primeiro — as regras permitem isso apenas
          // para emails super-admins explícitos.
          userDoc = await ensureSuperAdminUserDoc({
            uid: firebaseUser.uid,
            email,
            displayName:
              firebaseUser.displayName ?? email.split('@')[0] ?? 'Usuário',
            photoURL: firebaseUser.photoURL,
          });
          // Best-effort: registra no super_admins doc para que próximos
          // logins não-listados caiam corretamente no fluxo pendente.
          ensureSuperAdminInRegistry(email, firebaseUser.uid).catch(() => {
            // Não-bloqueante; o admin pode adicionar emails depois via UI.
          });
        } else {
          // Regular user: read existing doc or create a pending one.
          userDoc = await getUserByUid(firebaseUser.uid);
          if (!userDoc) {
            userDoc = await createUserOnFirstLogin({
              uid: firebaseUser.uid,
              email,
              displayName:
                firebaseUser.displayName ?? email.split('@')[0] ?? 'Usuário',
              photoURL: firebaseUser.photoURL,
              isSuperAdmin: false,
            });
          }
        }

        // Set userDoc BEFORE turning off loading so RouteGuard never sees a
        // logged-in firebaseUser without the corresponding userDoc.
        set({
          firebaseUser,
          userDoc,
          isSuperAdmin: isSuper,
          loading: false,
          error: null,
        });
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Falha ao carregar usuário.';
        set({
          firebaseUser,
          userDoc: null,
          isSuperAdmin: isSuperAdminEmail(firebaseUser.email),
          loading: false,
          error: message,
        });
      }
    });

    return unsubscribe;
  },

  signOut: async () => {
    set({ loading: true, error: null });
    try {
      await signOutCurrent();
      // onAuthChange will fire and reset state; nothing else to do.
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Falha ao sair.';
      set({ loading: false, error: message });
      throw err;
    }
  },

  setError: (err) => set({ error: err }),
}));

export { useAuthStore };

/** Returns just the auth state (no actions). Stable via shallow equality. */
export function useAuth(): AuthState {
  return useAuthStore(
    useShallow((s) => ({
      firebaseUser: s.firebaseUser,
      userDoc: s.userDoc,
      isSuperAdmin: s.isSuperAdmin,
      loading: s.loading,
      error: s.error,
    }))
  );
}

/** Returns just the auth actions. Stable via shallow equality. */
export function useAuthActions(): AuthActions {
  return useAuthStore(
    useShallow((s) => ({
      init: s.init,
      signOut: s.signOut,
      setError: s.setError,
    }))
  );
}
