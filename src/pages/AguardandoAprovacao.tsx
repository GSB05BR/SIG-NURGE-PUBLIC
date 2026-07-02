import { Hourglass, LogOut } from 'lucide-react';
import { useAuth, useAuthActions } from '@/store/authStore';
import { usePageTitle } from '@/lib/usePageTitle';

export default function AguardandoAprovacao() {
  usePageTitle('Aguardando aprovação');
  const { userDoc, firebaseUser } = useAuth();
  const { signOut } = useAuthActions();

  const displayName =
    userDoc?.displayName ?? firebaseUser?.displayName ?? 'Usuário';
  const email = userDoc?.email ?? firebaseUser?.email ?? '';

  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-primary px-0 py-10">
      <div className="auth-card rounded-lg bg-surface px-6 py-10 text-center shadow-lg sm:px-10 sm:py-12">
        <img
          src={`${import.meta.env.BASE_URL}logo.png`}
          alt="TJMG"
          className="mx-auto mb-6 h-[90px] w-[80px] object-contain"
        />
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-primary-light text-brand-primary-dark">
          <Hourglass className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-semibold text-ink-primary">
          Aguardando aprovação
        </h1>
        <p className="mt-3 text-sm text-ink-secondary">
          Sua conta está aguardando aprovação de um administrador. Você
          receberá acesso assim que for aprovado.
        </p>

        <dl className="mt-6 space-y-1 rounded-md bg-surface-elevated p-4 text-left text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-secondary">Nome</dt>
            <dd className="font-medium text-ink-primary">{displayName}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-secondary">Email</dt>
            <dd className="font-medium text-ink-primary break-all">
              {email}
            </dd>
          </div>
        </dl>

        <button
          type="button"
          onClick={() => {
            void signOut();
          }}
          className="mt-6 inline-flex items-center gap-2 rounded-md border border-gray-300 bg-surface px-5 py-2.5 text-sm font-semibold text-ink-primary shadow-sm hover:bg-gray-50 focus-visible:ring-4 focus-visible:ring-brand-primary/10"
        >
          <LogOut className="h-4 w-4" />
          Sair
        </button>
      </div>
    </div>
  );
}
