import { useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Flame,
  Loader2,
  Lock,
  Pencil,
  Play,
  RotateCcw,
  Send,
  Star,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react';
import type { Processo } from '@/types';
import { formatDateBr } from '@/lib/datetime';
import {
  diffDiasUteis,
  getSentenciadoNomeProcesso,
  getStatusBadgeClass,
  getStatusLabel,
  isAtrasado,
} from '@/lib/processo-helpers';

const DIA_LABEL_SHORT: Record<Processo['diaSemana'], string> = {
  segunda: 'Seg',
  terca: 'Ter',
  quarta: 'Qua',
  quinta: 'Qui',
  sexta: 'Sex',
};

const REGIME_LABEL: Record<Processo['regime'], string> = {
  aberto: 'Regime aberto',
  fechado: 'Regime fechado',
};

export type ProcessoCardAction =
  | 'iniciar'
  | 'concluir'
  | 'enviar_coordenacao'
  | 'reabrir';

interface ProcessoCardProps {
  processo: Processo;
  now: Date;
  /**
   * Called when the user requests an action. Parent is responsible for
   * confirming/persisting and displaying toast. The card itself shows a
   * minimal "loading" affordance via `pendingAction`.
   */
  onAction?: (action: ProcessoCardAction, p: Processo) => void;
  /** When set, shows spinners/disables this card. */
  pendingAction?: ProcessoCardAction | null;
  /** Anotação pessoal (privada) do usuário para este processo, se houver. */
  nota?: string | null;
  /** Salva a anotação pessoal. Se ausente, o recurso de anotação não aparece. */
  onSalvarNota?: (p: Processo, texto: string) => Promise<void> | void;
  /** Remove a anotação pessoal. */
  onRemoverNota?: (p: Processo) => Promise<void> | void;
}

/**
 * Visual card for a single processo on the recebedor's daily panel.
 * Action buttons in the footer change based on status.
 */
export default function ProcessoCard({
  processo,
  now,
  onAction,
  pendingAction = null,
  nota = null,
  onSalvarNota,
  onRemoverNota,
}: ProcessoCardProps) {
  const [showObs, setShowObs] = useState(false);
  const [copiedNumero, setCopiedNumero] = useState(false);
  const [copiedSentenciado, setCopiedSentenciado] = useState(false);
  const [editandoNota, setEditandoNota] = useState(false);
  const [draftNota, setDraftNota] = useState('');
  const [salvandoNota, setSalvandoNota] = useState(false);

  const notasHabilitadas = Boolean(onSalvarNota);

  async function salvarNota() {
    if (!onSalvarNota) return;
    setSalvandoNota(true);
    try {
      await onSalvarNota(processo, draftNota);
      setEditandoNota(false);
    } finally {
      setSalvandoNota(false);
    }
  }

  async function removerNota() {
    if (!onRemoverNota) return;
    setSalvandoNota(true);
    try {
      await onRemoverNota(processo);
      setEditandoNota(false);
    } finally {
      setSalvandoNota(false);
    }
  }

  const atrasado = isAtrasado(processo, now);
  const concluido = processo.status === 'concluido';
  const urgente = processo.urgente && !concluido;
  const prioridade = processo.prioridade && !concluido;
  const destacado = urgente || prioridade;
  const atrasadoNaoConcluido = atrasado && !concluido;

  const borderClass = concluido
    ? 'border-state-success'
    : urgente
      ? 'border-state-danger'
      : prioridade
      ? 'border-brand-primary'
      : atrasadoNaoConcluido
        ? 'border-state-danger'
        : 'border-gray-300';

  const ringClass = concluido
    ? ''
    : urgente
      ? 'ring-2 ring-state-danger/25'
      : prioridade
        ? 'ring-2 ring-brand-primary/25'
        : atrasadoNaoConcluido
          ? 'ring-1 ring-state-danger/30'
          : '';
  const surfaceClass = concluido
    ? 'bg-surface'
    : urgente
      ? 'bg-rose-50/80'
      : prioridade
        ? 'bg-brand-primary/5'
        : 'bg-surface';

  const opacityClass = concluido ? 'opacity-70' : '';

  const isBusy = pendingAction !== null;
  const actionsDisabled = isBusy;
  const dadosLiberados = processo.status !== 'pendente';
  const sentenciadoNome = getSentenciadoNomeProcesso(processo) ?? '';
  const observacaoRetornoCoordenacao =
    processo.status === 'em_andamento'
      ? processo.coordenacaoUltimaObservacao?.trim() ?? ''
      : '';

  const diaAtribuicaoStr = formatDateBr(processo.diaAtribuicao.toDate());
  const prazoStr = formatDateBr(processo.prazoFinal.toDate());
  const venceHoje =
    formatDateBr(processo.prazoFinal.toDate(), 'yyyy-MM-dd') ===
    formatDateBr(now, 'yyyy-MM-dd');
  const prazoDias = atrasado
    ? diffDiasUteis(processo.prazoFinal.toDate(), now)
    : diffDiasUteis(now, processo.prazoFinal.toDate());
  const prazoFraseLabel = concluido
    ? null
    : venceHoje
        ? 'Vence hoje'
        : !atrasado
          ? `${prazoDias} dia${prazoDias === 1 ? '' : 's'} útei${prazoDias === 1 ? 'l' : 's'} para concluir`
          : `${prazoDias} dia${prazoDias === 1 ? '' : 's'} útei${prazoDias === 1 ? 'l' : 's'} de atraso`;
  const observacoes = [
    processo.observacao ? ['Observação', processo.observacao] : null,
    processo.observacaoInicio ? ['Início', processo.observacaoInicio] : null,
    processo.observacaoConclusao
      ? ['Conclusão', processo.observacaoConclusao]
      : null,
  ].filter(Boolean) as Array<[string, string]>;
  const observacoesVisiveis = dadosLiberados ? observacoes : [];

  return (
    <article
      className={`rounded-lg border-l-4 p-3 shadow-sm transition-shadow hover:shadow ${surfaceClass} ${borderClass} ${ringClass} ${opacityClass}`}
      aria-label={
        dadosLiberados
          ? `Processo ${processo.numero}`
          : 'Processo pendente com dados bloqueados'
      }
    >
      {/* Header: número + status badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-1.5">
          {dadosLiberados ? (
            <>
              <span
                className="break-all font-mono text-sm font-semibold text-ink-primary"
                title={processo.numero}
              >
                {processo.numero}
              </span>
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(processo.numero);
                  setCopiedNumero(true);
                  window.setTimeout(() => setCopiedNumero(false), 1400);
                }}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-gray-50 hover:text-ink-primary -m-2.5"
                title="Copiar número"
                aria-label={`Copiar número do processo ${processo.numero}`}
              >
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-gray-200">
                  {copiedNumero ? (
                    <Check className="h-3.5 w-3.5 text-state-success" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </span>
              </button>
            </>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-semibold text-ink-secondary">
              <Lock className="h-3.5 w-3.5" />
              Número bloqueado
            </span>
          )}
        </div>
        <span
          className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${getStatusBadgeClass(processo.status)}`}
        >
          {getStatusLabel(processo.status)}
        </span>
      </div>

      {destacado && (
        <div
          className={`mt-2 flex items-center gap-2 rounded-md px-2.5 py-2 text-xs font-bold ${
            urgente
              ? 'bg-state-danger text-white'
              : 'bg-amber-100 text-amber-950 ring-1 ring-amber-200'
          }`}
        >
          {urgente ? (
            <Flame className="h-4 w-4 shrink-0" />
          ) : (
            <Star className="h-4 w-4 shrink-0 fill-current" />
          )}
          <span>
            {urgente && prioridade
              ? 'Urgente e prioridade: liberado fora do limite'
              : urgente
                ? 'Urgente: liberado fora do limite'
                : 'Prioridade: liberado fora do limite'}
          </span>
        </div>
      )}

      {/* Linha 1: agrupador + ícones */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span
          className="inline-flex max-w-full items-center truncate rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-ink-primary"
          title={processo.agrupadorNome}
        >
          {processo.agrupadorNome}
        </span>
        {urgente && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-state-danger px-2 py-1 text-[11px] font-bold text-white ring-1 ring-state-danger/30"
            aria-label="Urgente"
            title="Urgente"
          >
            <Flame className="h-3 w-3" />
            Urgente
          </span>
        )}
        {prioridade && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-[11px] font-bold text-amber-950 ring-1 ring-amber-200"
            aria-label="Prioridade"
            title="Prioridade"
          >
            <Star className="h-3 w-3 fill-current" />
            Prioridade
          </span>
        )}
        {atrasadoNaoConcluido && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-1.5 py-0.5 text-[11px] font-semibold text-state-danger"
            aria-label="Atrasado"
            title="Atrasado"
          >
            <AlertTriangle className="h-3 w-3" />
            Atrasado
          </span>
        )}
        <span className="inline-flex items-center rounded-full bg-white px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-secondary ring-1 ring-gray-200">
          {REGIME_LABEL[processo.regime]}
        </span>
        {processo.devolvido && (
          <span className="inline-flex items-center rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 ring-1 ring-amber-200">
            Devolvido
          </span>
        )}
        {processo.recebedorVinculadoUid &&
          processo.recebedorVinculadoUid === processo.recebedorUid && (
            <span className="inline-flex items-center rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-800 ring-1 ring-violet-200">
              Processo vinculado
            </span>
          )}
      </div>

      {!dadosLiberados && (
        <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-secondary">
            Sentenciado
          </div>
          <div className="mt-0.5 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-secondary">
            <Lock className="h-3.5 w-3.5" />
            Nome bloqueado até iniciar
          </div>
        </div>
      )}

      {dadosLiberados && sentenciadoNome && (
        <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-secondary">
            Sentenciado
          </div>
          <div className="mt-0.5 flex items-start gap-1.5">
            <span
              className="min-w-0 flex-1 break-words text-sm font-semibold text-ink-primary"
              title={sentenciadoNome}
            >
              {sentenciadoNome}
            </span>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(sentenciadoNome);
                setCopiedSentenciado(true);
                window.setTimeout(() => setCopiedSentenciado(false), 1400);
              }}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-white hover:text-ink-primary -m-2.5"
              title="Copiar nome do sentenciado"
              aria-label={`Copiar nome do sentenciado ${sentenciadoNome}`}
            >
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-gray-200 bg-surface">
                {copiedSentenciado ? (
                  <Check className="h-3.5 w-3.5 text-state-success" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Linha 2: datas */}
      <div className="mt-2 space-y-0.5 text-xs text-ink-secondary">
        <p>
          Atribuído em{' '}
          <span className="text-ink-primary">{diaAtribuicaoStr}</span>{' '}
          ({DIA_LABEL_SHORT[processo.diaSemana]})
        </p>
        <p>
          Prazo: <span className="text-ink-primary">{prazoStr}</span>
          {prazoFraseLabel && (
            <span
              className={`ml-1 ${
                atrasadoNaoConcluido
                  ? 'font-semibold text-state-danger'
                  : ''
              }`}
            >
              · {prazoFraseLabel}
            </span>
          )}
        </p>
      </div>

      {dadosLiberados && observacaoRetornoCoordenacao && (
        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
          <div className="font-semibold text-amber-950">
            Retorno da coordenação
          </div>
          <p className="mt-0.5 whitespace-pre-wrap break-words">
            {observacaoRetornoCoordenacao}
          </p>
          {processo.coordenacaoUltimaAcaoPorNome && (
            <p className="mt-1 text-[11px] text-amber-800">
              Por {processo.coordenacaoUltimaAcaoPorNome}
            </p>
          )}
        </div>
      )}

      {/* Observações (collapsible) */}
      {observacoesVisiveis.length > 0 && (
        <div className="mt-2 text-xs">
          {showObs ? (
            <div className="rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-ink-secondary">
              <div className="space-y-1">
                {observacoesVisiveis.map(([label, text]) => (
                  <p key={label}>
                    <span className="font-semibold text-ink-primary">
                      {label}:
                    </span>{' '}
                    {text}
                  </p>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setShowObs(false)}
                className="mt-1 inline-flex min-h-[44px] items-center text-[11px] text-brand-primary hover:underline"
              >
                ocultar
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowObs(true)}
              className="inline-flex min-h-[44px] items-center text-[11px] text-brand-primary hover:underline"
            >
              Ver observações
            </button>
          )}
        </div>
      )}

      {/* Minha anotação (privada) */}
      {notasHabilitadas && (
        <div className="mt-2">
          {editandoNota ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-2">
              <textarea
                value={draftNota}
                onChange={(e) => setDraftNota(e.target.value)}
                rows={3}
                autoFocus
                placeholder="Escreva uma anotação (só você vê)"
                className="w-full rounded border border-amber-200 bg-white px-2 py-1.5 text-sm text-ink-primary"
              />
              <div className="mt-1.5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void salvarNota()}
                  disabled={salvandoNota}
                  className="inline-flex min-h-[36px] items-center gap-1 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
                >
                  {salvandoNota ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  Salvar
                </button>
                <button
                  type="button"
                  onClick={() => setEditandoNota(false)}
                  disabled={salvandoNota}
                  className="inline-flex min-h-[36px] items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-semibold text-ink-primary hover:bg-gray-50 disabled:opacity-60"
                >
                  <X className="h-3.5 w-3.5" />
                  Cancelar
                </button>
              </div>
            </div>
          ) : nota ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                <StickyNote className="h-3.5 w-3.5" />
                Minha anotação
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-amber-950">
                {nota}
              </p>
              <div className="mt-1.5 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setDraftNota(nota);
                    setEditandoNota(true);
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 hover:underline"
                >
                  <Pencil className="h-3 w-3" />
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => void removerNota()}
                  disabled={salvandoNota}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-state-danger hover:underline disabled:opacity-60"
                >
                  <Trash2 className="h-3 w-3" />
                  Remover
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setDraftNota('');
                setEditandoNota(true);
              }}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-dashed border-amber-300 px-2.5 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-50"
            >
              <StickyNote className="h-3.5 w-3.5" />
              Adicionar anotação
            </button>
          )}
        </div>
      )}

      {/* Ações */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2">
        {processo.status === 'pendente' && (
          <ActionButton
            kind="primary"
            disabled={actionsDisabled}
            loading={pendingAction === 'iniciar'}
            onClick={() => onAction?.('iniciar', processo)}
            icon={<Play className="h-3.5 w-3.5" />}
            label="Iniciar"
          />
        )}
        {processo.status === 'em_andamento' && (
          <>
            <ActionButton
              kind="success"
              disabled={actionsDisabled}
              loading={pendingAction === 'concluir'}
              onClick={() => onAction?.('concluir', processo)}
              icon={<CheckCircle2 className="h-3.5 w-3.5" />}
              label="Concluir"
            />
            <ActionButton
              kind="outline"
              disabled={actionsDisabled}
              loading={pendingAction === 'enviar_coordenacao'}
              onClick={() => onAction?.('enviar_coordenacao', processo)}
              icon={<Send className="h-3.5 w-3.5" />}
              label="Enviar para coordenação"
            />
          </>
        )}
        {processo.status === 'concluido' && (
          <ActionButton
            kind="outline"
            disabled={actionsDisabled}
            loading={pendingAction === 'reabrir'}
            onClick={() => onAction?.('reabrir', processo)}
            icon={<RotateCcw className="h-3.5 w-3.5" />}
            label="Reabrir"
          />
        )}
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

interface ActionButtonProps {
  kind: 'primary' | 'success' | 'ghost' | 'outline';
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}

const ACTION_KIND_CLASSES: Record<ActionButtonProps['kind'], string> = {
  primary:
    'bg-brand-primary text-white hover:bg-brand-primary-dark disabled:opacity-60',
  success: 'bg-state-success text-white hover:bg-emerald-700 disabled:opacity-60',
  ghost:
    'border border-transparent text-ink-secondary hover:bg-gray-100 disabled:opacity-60',
  outline:
    'border border-gray-300 bg-surface text-ink-primary hover:bg-gray-50 disabled:opacity-60',
};

function ActionButton({
  kind,
  label,
  icon,
  disabled,
  loading,
  onClick,
}: ActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-[44px] items-center justify-center gap-1 rounded-md px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed ${ACTION_KIND_CLASSES[kind]}`}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {label}
    </button>
  );
}
