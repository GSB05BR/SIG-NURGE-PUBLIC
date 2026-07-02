import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import {
  signInAsDistribuidor,
  signInAsRecebedor,
} from '@/services/firebase/auth';

type DemoPersona = 'distribuidor' | 'recebedor';
import { useAuth, useAuthActions } from '@/store/authStore';
import { usePageTitle } from '@/lib/usePageTitle';

function GoogleIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="m6.3 14.7 6.6 4.8C14.7 16 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.4 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35 26.7 36 24 36c-5.3 0-9.7-3.4-11.3-8l-6.5 5C9.4 39.6 16.1 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4.1 5.6l6.2 5.2C40.7 35.5 44 30.2 44 24c0-1.2-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}

export default function Login() {
  usePageTitle('Entrar');
  const { error, firebaseUser, loading, userDoc } = useAuth();
  const { setError } = useAuthActions();
  const [submitting, setSubmitting] = useState<DemoPersona | null>(null);

  async function handleSignIn(persona: DemoPersona) {
    setSubmitting(persona);
    setError(null);
    try {
      if (persona === 'distribuidor') await signInAsDistribuidor();
      else await signInAsRecebedor();
      // On success, the auth listener in authStore will populate state and
      // this page will redirect away from /login.
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Erro ao entrar.';
      setError(message);
    } finally {
      setSubmitting(null);
    }
  }

  const isBusy = submitting !== null || loading;
  const isPending = userDoc
    ? !userDoc.approved || userDoc.role === 'pendente'
    : false;

  if (!loading && firebaseUser) {
    if (!userDoc || isPending) {
      return <Navigate to="/aguardando-aprovacao" replace />;
    }

    const home =
      userDoc.role === 'distribuidor' ? '/distribuidor' : '/recebedor';
    return <Navigate to={home} replace />;
  }

  return (
    <div className="min-h-screen overflow-hidden bg-brand-primary">
      <main className="flex min-h-screen items-center justify-center bg-brand-primary px-0 py-10">
        <section className="auth-card rounded-lg bg-white px-6 py-10 text-center shadow-lg sm:px-10 sm:py-12">
          <img
            src={`${import.meta.env.BASE_URL}logo.png`}
            alt="TJMG"
            className="mx-auto h-[113px] w-[100px] object-contain"
          />

          <div className="mt-8">
            <h1 className="text-[28px] font-bold leading-tight text-brand-primary">
              SIG - NURGE
            </h1>
            <h2 className="mt-3 text-base font-normal text-gray-700">
              Sistema Integrado de Gestão
            </h2>
            <p className="mt-3 text-sm text-ink-muted">
              Processos do NURGE
            </p>
            <p className="mt-2 text-sm text-ink-muted">TJMG</p>
          </div>

          <div className="mt-6 rounded-md border border-brand-primary/20 bg-brand-primary/5 p-3 text-left text-xs leading-relaxed text-ink-muted">
            <strong className="text-brand-primary">Demonstração de UI.</strong>{' '}
            Todos os dados são fictícios. Escolha um perfil para explorar a
            interface — nenhum login real é necessário e nada é salvo.
          </div>

          <div className="mt-6 space-y-3">
            <button
              type="button"
              onClick={() => handleSignIn('distribuidor')}
              disabled={isBusy}
              className="inline-flex w-full min-w-0 items-center justify-center gap-3 rounded-md bg-brand-primary px-4 py-3.5 text-sm font-semibold text-white shadow-sm hover:opacity-95 focus-visible:ring-4 focus-visible:ring-brand-primary/20 disabled:cursor-not-allowed disabled:opacity-50 sm:px-6"
            >
              {submitting === 'distribuidor' || (loading && submitting === null) ? (
                <Loader2 className="h-5 w-5 animate-spin text-white" />
              ) : (
                <GoogleIcon className="h-5 w-5" />
              )}
              <span>Entrar como Distribuidor</span>
            </button>

            <button
              type="button"
              onClick={() => handleSignIn('recebedor')}
              disabled={isBusy}
              className="inline-flex w-full min-w-0 items-center justify-center gap-3 rounded-md border-2 border-gray-300 bg-white px-4 py-3.5 text-sm font-semibold text-gray-800 shadow-sm hover:bg-gray-50 focus-visible:ring-4 focus-visible:ring-brand-primary/10 disabled:cursor-not-allowed disabled:opacity-50 sm:px-6"
            >
              {submitting === 'recebedor' ? (
                <Loader2 className="h-5 w-5 animate-spin text-brand-primary" />
              ) : (
                <GoogleIcon className="h-5 w-5" />
              )}
              <span>Entrar como Recebedor</span>
            </button>

            {error && (
              <p
                role="alert"
                className="mt-4 rounded-md border border-state-danger/30 bg-state-danger/5 p-3 text-left text-sm text-state-danger"
              >
                {error}
              </p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
