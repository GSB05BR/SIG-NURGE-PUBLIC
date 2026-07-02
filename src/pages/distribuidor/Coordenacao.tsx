import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  ExternalLink,
  FileText,
  Flame,
  Loader2,
  RotateCcw,
  Search,
  Star,
} from 'lucide-react';
import {
  colocarProcessoCoordenacaoEmEspera,
  concluirProcessoPelaCoordenacao,
  devolverProcessoDaCoordenacao,
  subscribeProcessosCoordenacao,
} from '@/services/firebase/processos';
import { subscribeAllUsers } from '@/services/firebase/users';
import { useAuth } from '@/store/authStore';
import { formatDateBr, nowInSp } from '@/lib/datetime';
import {
  getResponsavelSeiLabel,
  getStatusBadgeClass,
  getStatusLabel,
  isAtrasado,
} from '@/lib/processo-helpers';
import { usePageTitle } from '@/lib/usePageTitle';
import { useHistoricoSei } from '@/lib/useHistoricoSei';
import type { Processo, User } from '@/types';
import Toast, { type ToastState } from '@/components/Toast';
import { ErrorState } from '@/components/ErrorState';

type CoordenacaoAction = 'devolver' | 'concluir' | 'espera';
type StatusFiltro = 'todos' | 'em_coordenacao' | 'em_espera';

interface ActionDialogState {
  processo: Processo;
  action: CoordenacaoAction;
}

const STATUS_OPTIONS: Array<{ key: StatusFiltro; label: string }> = [
  { key: 'todos', label: 'Todos' },
  { key: 'em_coordenacao', label: 'Na coordenação' },
  { key: 'em_espera', label: 'Em espera' },
];

const REGIME_LABEL: Record<Processo['regime'], string> = {
  aberto: 'Regime aberto',
  fechado: 'Regime fechado',
};

const ORIGEM_LABEL: Record<Processo['origem'], string> = {
  sei_json: 'SEI JSON',
  csv: 'Legado',
  manual: 'Manual',
};

export default function Coordenacao() {
  usePageTitle('Coordenação');
  const { firebaseUser, userDoc } = useAuth();
  const meUid = firebaseUser?.uid ?? null;
  const meNome =
    userDoc?.displayName ?? firebaseUser?.displayName ?? 'Usuário';

  const [now, setNow] = useState<Date>(() => nowInSp());
  useEffect(() => {
    const id = window.setInterval(() => setNow(nowInSp()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const [processos, setProcessos] = useState<Processo[] | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [loadRetryKey, setLoadRetryKey] = useState(0);
  const [users, setUsers] = useState<User[] | null>(null);
  const [statusFiltro, setStatusFiltro] = useState<StatusFiltro>('todos');
  const [busca, setBusca] = useState('');
  const [copiedNumero, setCopiedNumero] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [actionDialog, setActionDialog] = useState<ActionDialogState | null>(
    null
  );
  const [actionBusy, setActionBusy] = useState(false);

  useEffect(() => {
    setLoadError(null);
    const unsubP = subscribeProcessosCoordenacao(
      (list) => setProcessos(list),
      (err) => setLoadError(err)
    );
    const unsubU = subscribeAllUsers(
      (list) => setUsers(list),
      (err) => setLoadError(err)
    );
    return () => {
      unsubP();
      unsubU();
    };
  }, [loadRetryKey]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(id);
  }, [toast]);

  const usersByUid = useMemo(() => {
    const map = new Map<string, User>();
    (users ?? []).forEach((u) => map.set(u.uid, u));
    return map;
  }, [users]);

  const counts = useMemo(() => {
    const list = processos ?? [];
    return {
      total: list.length,
      coordenacao: list.filter((p) => p.status === 'em_coordenacao').length,
      espera: list.filter((p) => p.status === 'em_espera').length,
      atrasados: list.filter((p) => isAtrasado(p, now)).length,
    };
  }, [processos, now]);

  const filtered = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (processos ?? []).filter((p) => {
      if (statusFiltro !== 'todos' && p.status !== statusFiltro) return false;
      if (!q) return true;
      const sender = [
        p.coordenacaoEnviadoPorNome,
        p.coordenacaoEnviadoPorEmail,
        p.numero,
        p.agrupadorNome,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return sender.includes(q);
    });
  }, [processos, statusFiltro, busca]);

  async function copyNumero(numero: string) {
    await navigator.clipboard.writeText(numero);
    setCopiedNumero(numero);
    window.setTimeout(() => {
      setCopiedNumero((current) => (current === numero ? null : current));
    }, 1400);
  }

  async function handleAction(
    state: ActionDialogState,
    observacao: string | null
  ) {
    if (!meUid) return;
    setActionBusy(true);
    try {
      const input = {
        processoId: state.processo.id,
        byUid: meUid,
        byNome: meNome,
        observacao,
      };
      if (state.action === 'devolver') {
        await devolverProcessoDaCoordenacao(input);
      } else if (state.action === 'concluir') {
        await concluirProcessoPelaCoordenacao(input);
      } else {
        await colocarProcessoCoordenacaoEmEspera(input);
      }
      setToast({
        kind: 'success',
        message: buildSuccessMessage(state),
      });
      setActionDialog(null);
    } catch (err) {
      setToast({
        kind: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Falha ao atualizar processo da coordenação.',
      });
    } finally {
      setActionBusy(false);
    }
  }

  const isLoading = processos === null || users === null;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink-primary">
            Coordenação
          </h1>
          <p className="text-sm text-ink-secondary">
            Processos enviados pelos recebedores para decisão da coordenação.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SummaryPill
            label="Total"
            value={counts.total}
            tone="neutral"
            icon={<FileText className="h-3.5 w-3.5" />}
          />
          <SummaryPill
            label="Na coordenação"
            value={counts.coordenacao}
            tone="info"
            icon={<CalendarClock className="h-3.5 w-3.5" />}
          />
          <SummaryPill
            label="Em espera"
            value={counts.espera}
            tone="warning"
            icon={<Clock3 className="h-3.5 w-3.5" />}
          />
          <SummaryPill
            label="Atrasados"
            value={counts.atrasados}
            tone={counts.atrasados > 0 ? 'danger' : 'neutral'}
            icon={<AlertTriangle className="h-3.5 w-3.5" />}
          />
        </div>
      </header>

      <Toast toast={toast} onDismiss={() => setToast(null)} />

      <section className="rounded-lg border border-gray-200 bg-surface p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div
            className="inline-flex rounded-md border border-gray-200 bg-surface p-0.5"
            role="group"
            aria-label="Status da coordenação"
          >
            {STATUS_OPTIONS.map((option) => {
              const active = statusFiltro === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setStatusFiltro(option.key)}
                  className={`rounded px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                    active
                      ? 'bg-brand-primary text-white'
                      : 'text-ink-secondary hover:bg-gray-50 hover:text-ink-primary'
                  }`}
                  aria-pressed={active}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary" />
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por número, origem ou quem enviou..."
              className="w-full rounded-md border border-gray-300 bg-surface py-2 pl-8 pr-3 text-sm text-ink-primary focus:border-brand-primary focus:ring-1 focus:ring-brand-primary"
            />
          </div>
        </div>
        <p className="mt-2 text-xs text-ink-secondary">
          {filtered.length} de {counts.total} processo
          {counts.total === 1 ? '' : 's'} na coordenação.
        </p>
      </section>

      {loadError ? (
        <ErrorState
          message="Falha ao carregar os processos da coordenação. Verifique sua conexão e tente novamente."
          onRetry={() => setLoadRetryKey((k) => k + 1)}
        />
      ) : isLoading ? (
        <div className="flex items-center justify-center rounded-lg border border-gray-200 bg-surface px-4 py-12 text-sm text-ink-secondary">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Carregando processos...
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-surface px-4 py-12 text-center">
          <Clock3 className="mx-auto h-10 w-10 text-ink-secondary/60" />
          <h2 className="mt-2 text-lg font-semibold text-ink-primary">
            Nenhum processo na coordenação
          </h2>
          <p className="mt-1 text-sm text-ink-secondary">
            Quando um recebedor enviar um processo em andamento, ele aparecerá aqui.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {filtered.map((processo) => (
            <CoordenacaoProcessoCard
              key={processo.id}
              processo={processo}
              now={now}
              recebedor={getRecebedor(processo, usersByUid)}
              copied={copiedNumero === processo.numero}
              onCopy={() => {
                void copyNumero(processo.numero);
              }}
              onAction={(action) => setActionDialog({ processo, action })}
            />
          ))}
        </div>
      )}

      {actionDialog && (
        <CoordenacaoActionDialog
          state={actionDialog}
          busy={actionBusy}
          onCancel={() => {
            if (!actionBusy) setActionDialog(null);
          }}
          onConfirm={(observacao) => {
            void handleAction(actionDialog, observacao);
          }}
        />
      )}
    </div>
  );
}

interface CoordenacaoProcessoCardProps {
  processo: Processo;
  now: Date;
  recebedor: User | null;
  copied: boolean;
  onCopy: () => void;
  onAction: (action: CoordenacaoAction) => void;
}

function CoordenacaoProcessoCard({
  processo,
  now,
  recebedor,
  copied,
  onCopy,
  onAction,
}: CoordenacaoProcessoCardProps) {
  const atrasado = isAtrasado(processo, now);
  const enviadoEm = formatTimestamp(processo.coordenacaoEnviadoEm);
  const ultimaAcaoEm = formatTimestamp(processo.coordenacaoUltimaAcaoEm);
  const responsavelSei = getResponsavelSeiLabel(
    processo.primeiroResponsavelNurge
  );
  // Item 7: contagem vem do campo persistido (historyCount === nº de eventos);
  // a lista de eventos só é buscada do subdoc quando o usuário expande.
  const [histOpen, setHistOpen] = useState(false);
  const { eventos: histEventos, loading: histLoading } = useHistoricoSei(
    processo,
    histOpen
  );
  const totalHistorico =
    processo.historicoSei && processo.historicoSei.length > 0
      ? processo.historicoSei.length
      : processo.historyCount ?? 0;

  return (
    <article className="rounded-lg border border-gray-200 bg-surface shadow-sm">
      <div className="border-b border-gray-100 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex min-w-0 items-start gap-1.5">
              <span
                className="break-all font-mono text-sm font-semibold text-ink-primary"
                title={processo.numero}
              >
                {processo.numero}
              </span>
              <button
                type="button"
                onClick={onCopy}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-gray-50 hover:text-ink-primary"
                title="Copiar número"
                aria-label={`Copiar número do processo ${processo.numero}`}
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-state-success" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${getStatusBadgeClass(processo.status)}`}
              >
                {getStatusLabel(processo.status)}
              </span>
              {processo.urgente && (
                <Tag tone="brand" icon={<Flame className="h-3 w-3" />}>
                  Urgente
                </Tag>
              )}
              {processo.prioridade && (
                <Tag tone="brand" icon={<Star className="h-3 w-3" />}>
                  Prioridade
                </Tag>
              )}
              {atrasado && (
                <Tag tone="danger" icon={<AlertTriangle className="h-3 w-3" />}>
                  Atrasado
                </Tag>
              )}
            </div>
          </div>
          <div className="shrink-0 text-right text-xs text-ink-secondary">
            <span className="block font-semibold text-ink-primary">
              {enviadoEm}
            </span>
            <span>Envio</span>
          </div>
        </div>
      </div>

      <div className="grid gap-4 px-4 py-4 lg:grid-cols-[1fr_1fr]">
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            Enviado por
          </h3>
          <div className="mt-2 space-y-1 text-sm">
            <InfoRow
              label="Nome"
              value={
                processo.coordenacaoEnviadoPorNome ||
                recebedor?.displayName ||
                'Não informado'
              }
            />
            <InfoRow
              label="E-mail"
              value={
                processo.coordenacaoEnviadoPorEmail ||
                recebedor?.email ||
                'Não informado'
              }
            />
            <InfoRow label="Recebedor atual" value={recebedor?.displayName ?? '—'} />
            <InfoRow label="Última ação" value={ultimaAcaoEm} />
          </div>
          {processo.coordenacaoUltimaObservacao && (
            <p className="mt-3 rounded-md border border-gray-200 bg-surface-elevated px-3 py-2 text-sm text-ink-secondary">
              {processo.coordenacaoUltimaObservacao}
            </p>
          )}
        </section>

        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            Dados do processo
          </h3>
          <div className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
            <InfoRow label="Origem" value={processo.agrupadorNome} />
            <InfoRow label="Tipo" value={ORIGEM_LABEL[processo.origem]} />
            <InfoRow label="Regime" value={REGIME_LABEL[processo.regime]} />
            <InfoRow
              label="Atribuição"
              value={formatDateBr(processo.diaAtribuicao.toDate())}
            />
            <InfoRow
              label="Prazo"
              value={formatDateBr(processo.prazoFinal.toDate())}
              danger={atrasado}
            />
            <InfoRow label="Responsável SEI" value={responsavelSei} />
            <InfoRow
              label="Unidade origem"
              value={processo.unidadeOrigem?.sigla || processo.unidadeOrigem?.nome || '—'}
            />
            <InfoRow
              label="Histórico SEI"
              value={`${totalHistorico} evento${totalHistorico === 1 ? '' : 's'}`}
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {processo.seiUrl && (
              <a
                href={processo.seiUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-ink-primary hover:bg-gray-50"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Abrir processo
              </a>
            )}
            {processo.seiHistoricoUrl && (
              <a
                href={processo.seiHistoricoUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-ink-primary hover:bg-gray-50"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Histórico SEI
              </a>
            )}
          </div>
        </section>
      </div>

      {processo.observacao && (
        <div className="border-t border-gray-100 px-4 py-3 text-sm text-ink-secondary">
          <span className="font-semibold text-ink-primary">Observação: </span>
          {processo.observacao}
        </div>
      )}

      {totalHistorico > 0 && (
        <details
          className="border-t border-gray-100 px-4 py-3 text-sm"
          onToggle={(e) => setHistOpen(e.currentTarget.open)}
        >
          <summary className="cursor-pointer font-semibold text-brand-primary">
            Ver últimos eventos do SEI
          </summary>
          <div className="mt-2 space-y-2">
            {histLoading && (
              <p className="text-xs text-ink-secondary">Carregando eventos…</p>
            )}
            {histEventos.slice(0, 5).map((evento, index) => (
              <div
                key={`${evento.dataISO ?? 'sem-data'}-${index}`}
                className="rounded-md border border-gray-200 bg-surface-elevated px-3 py-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-secondary">
                  <span className="font-semibold uppercase tracking-wide text-ink-primary">
                    {evento.tipo.replaceAll('_', ' ')}
                  </span>
                  <span>{evento.dataHora ?? 'Sem data'}</span>
                </div>
                <p className="mt-1 text-ink-secondary">{evento.descricao}</p>
              </div>
            ))}
          </div>
        </details>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-100 px-4 py-3">
        <ActionButton
          label="Devolver ao recebedor"
          icon={<RotateCcw className="h-4 w-4" />}
          tone="outline"
          onClick={() => onAction('devolver')}
        />
        <ActionButton
          label="Colocar em espera"
          icon={<Clock3 className="h-4 w-4" />}
          tone="warning"
          onClick={() => onAction('espera')}
        />
        <ActionButton
          label="Concluir"
          icon={<CheckCircle2 className="h-4 w-4" />}
          tone="success"
          onClick={() => onAction('concluir')}
        />
      </div>
    </article>
  );
}

function CoordenacaoActionDialog({
  state,
  busy,
  onCancel,
  onConfirm,
}: {
  state: ActionDialogState;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (observacao: string) => void;
}) {
  const [observacao, setObservacao] = useState('');
  const copy = getActionCopy(state.action, state.processo);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="coordenacao-action-title"
    >
      <div
        className="absolute inset-0 bg-black/50"
        aria-hidden="true"
        onClick={onCancel}
      />
      <div className="relative w-full max-w-lg rounded-lg bg-surface shadow-xl">
        <div className="px-5 py-4">
          <h2
            id="coordenacao-action-title"
            className="text-lg font-semibold text-ink-primary"
          >
            {copy.title}
          </h2>
          <p className="mt-1 text-sm text-ink-secondary">
            Processo{' '}
            <span className="font-mono font-semibold text-ink-primary">
              {state.processo.numero}
            </span>
          </p>
          <label
            htmlFor="coordenacao-action-note"
            className="mt-4 block text-sm font-medium text-ink-primary"
          >
            Observação{' '}
            <span className="font-normal text-ink-secondary">(opcional)</span>
          </label>
          <textarea
            id="coordenacao-action-note"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            rows={4}
            maxLength={1000}
            disabled={busy}
            placeholder={copy.placeholder}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-ink-primary focus:border-brand-primary focus:ring-1 focus:ring-brand-primary disabled:opacity-50"
            autoFocus
          />
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-gray-200 px-3 py-2 text-sm font-medium text-ink-primary hover:bg-gray-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onConfirm(observacao)}
            disabled={busy}
            className={`rounded-md px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 ${copy.buttonClass}`}
          >
            {busy ? 'Salvando...' : copy.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function SummaryPill({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: 'neutral' | 'info' | 'warning' | 'danger';
  icon: React.ReactNode;
}) {
  const cls =
    tone === 'danger'
      ? 'bg-rose-50 text-state-danger ring-1 ring-rose-200'
      : tone === 'warning'
        ? 'bg-state-warning-bg text-state-warning ring-1 ring-state-warning-border'
        : tone === 'info'
          ? 'bg-state-info-bg text-state-info ring-1 ring-state-info-border'
          : 'bg-gray-100 text-ink-primary ring-1 ring-gray-200';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}
    >
      {icon}
      {label}: {value}
    </span>
  );
}

function Tag({
  children,
  tone,
  icon,
}: {
  children: React.ReactNode;
  tone: 'brand' | 'danger';
  icon: React.ReactNode;
}) {
  const cls =
    tone === 'danger'
      ? 'bg-rose-50 text-state-danger ring-1 ring-rose-200'
      : 'bg-brand-primary-light text-brand-primary-dark ring-1 ring-brand-primary/20';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${cls}`}
    >
      {icon}
      {children}
    </span>
  );
}

function InfoRow({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="min-w-0">
      <span className="block text-[11px] font-medium uppercase tracking-wide text-ink-secondary">
        {label}
      </span>
      <span
        className={`block break-words font-medium ${
          danger ? 'text-state-danger' : 'text-ink-primary'
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function ActionButton({
  label,
  icon,
  tone,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  tone: 'outline' | 'warning' | 'success';
  onClick: () => void;
}) {
  const cls =
    tone === 'success'
      ? 'bg-state-success text-white hover:bg-emerald-700'
      : tone === 'warning'
        ? 'border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
        : 'border border-gray-300 bg-surface text-ink-primary hover:bg-gray-50';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold ${cls}`}
    >
      {icon}
      {label}
    </button>
  );
}

function getRecebedor(
  processo: Processo,
  usersByUid: Map<string, User>
): User | null {
  if (!processo.recebedorUid) return null;
  return usersByUid.get(processo.recebedorUid) ?? null;
}

function formatTimestamp(value: Processo['coordenacaoEnviadoEm']): string {
  if (!value) return '—';
  return formatDateBr(value.toDate(), 'dd/MM/yyyy HH:mm');
}

function getActionCopy(action: CoordenacaoAction, processo: Processo) {
  if (action === 'devolver') {
    return {
      title: 'Devolver ao recebedor',
      confirmLabel: 'Devolver',
      placeholder: 'Registre a orientação para quem enviou o processo...',
      buttonClass: 'bg-brand-primary hover:bg-brand-primary-dark',
    };
  }
  if (action === 'concluir') {
    return {
      title: 'Concluir pela coordenação',
      confirmLabel: 'Concluir',
      placeholder: 'Registre a conclusão adotada pela coordenação...',
      buttonClass: 'bg-state-success hover:bg-emerald-700',
    };
  }
  return {
    title:
      processo.status === 'em_espera'
        ? 'Atualizar espera'
        : 'Colocar em espera',
    confirmLabel: processo.status === 'em_espera' ? 'Atualizar' : 'Colocar em espera',
    placeholder: 'Registre o motivo da espera ou a pendência necessária...',
    buttonClass: 'bg-amber-700 hover:bg-amber-800',
  };
}

function buildSuccessMessage(state: ActionDialogState): string {
  if (state.action === 'devolver') {
    return `Processo ${state.processo.numero} devolvido ao recebedor.`;
  }
  if (state.action === 'concluir') {
    return `Processo ${state.processo.numero} concluído pela coordenação.`;
  }
  return `Processo ${state.processo.numero} colocado em espera.`;
}
