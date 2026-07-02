import { AlertCircle, RefreshCw } from 'lucide-react';

interface ErrorStateProps {
  /** Mensagem de falha exibida ao usuário. */
  message: string;
  /** Quando informado, mostra o botão "Tentar novamente". */
  onRetry?: () => void;
}

/**
 * Estado de falha PERSISTENTE para carregamentos que travaram (ex.: um
 * `onSnapshot` que falhou por permissão/índice/rede e não se refaz sozinho).
 *
 * Diferente do Toast (transitório/auto-dismiss), este componente fica na tela
 * no lugar do conteúdo até a condição ser corrigida — substitui o spinner
 * eterno. Espelha o visual de EmptyState/LoadingCard usando os tokens do
 * design system.
 */
export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-lg border border-gray-200 bg-surface px-4 py-12 text-center"
    >
      <AlertCircle className="h-10 w-10 text-state-danger" />
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-ink-primary">
          Não foi possível carregar
        </h2>
        <p className="max-w-md text-sm text-ink-secondary">{message}</p>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-surface-elevated px-3 py-2 text-sm font-semibold text-ink-primary transition hover:bg-gray-50"
        >
          <RefreshCw className="h-4 w-4" />
          Tentar novamente
        </button>
      )}
    </div>
  );
}

export default ErrorState;
