import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlarmClock,
  CheckCircle2,
  ClipboardList,
  Clock,
  CornerUpLeft,
  Flame,
  Loader2,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { useAuth } from '@/store/authStore';
import {
  getProcessosConcluidosByRecebedor,
  subscribeProcessosAbertosByRecebedor,
} from '@/services/firebase/processos';
import {
  getConcluidosRecebedorCache,
  setConcluidosRecebedorCache,
  invalidateConcluidosRecebedorCache,
} from '@/store/processosStore';
import { ErrorState } from '@/components/ErrorState';
import { formatDateBr, nowInSp } from '@/lib/datetime';
import {
  HISTORICO_RECEBEDOR_LIMITE,
  isAtrasado,
  selecionarConcluidosRecentes,
} from '@/lib/processo-helpers';
import {
  calcularProdutividadePessoal,
  formatDurationMs,
  type ProdutividadePessoalStats,
} from '@/lib/produtividade';
import { usePageTitle } from '@/lib/usePageTitle';
import type { Processo } from '@/types';

// ---------------------------------------------------------------------------
// Página: produtividade pessoal do recebedor (versão simplificada da visão do
// distribuidor em pages/distribuidor/Produtividade.tsx).
//
// CUSTO DE LEITURA: usa a leitura BOUNDED `getProcessosConcluidosByRecebedor`
// (no máx. ~100 docs do próprio recebedor, índice composto), reaproveitando o
// cache de sessão compartilhado com a aba Histórico. Para o card "Atrasados"
// assina os processos EM ABERTO do recebedor (listener escopado por uid,
// conjunto pequeno). Os agregados `stats/agregado_mes_*` NÃO são usados aqui:
// (1) o recebedor não tem permissão de leitura nesses docs (são por mês e
// expõem todos os recebedores), e (2) eles só guardam distribuídos/concluídos,
// sem "devolvidos" nem o tempo de execução (início->conclusão) que esta página
// precisa.
// ---------------------------------------------------------------------------

type KpiTone = 'neutral' | 'success' | 'warning' | 'info' | 'danger' | 'purple';

const KPI_TONE_CLASSES: Record<KpiTone, { value: string; iconWrap: string }> = {
  neutral: { value: 'text-ink-primary', iconWrap: 'bg-gray-100 text-ink-primary' },
  success: {
    value: 'text-state-success-strong',
    iconWrap: 'bg-state-success-bg text-state-success-strong',
  },
  warning: {
    value: 'text-state-warning-strong',
    iconWrap: 'bg-state-warning-bg text-state-warning-strong',
  },
  info: {
    value: 'text-state-info-strong',
    iconWrap: 'bg-state-info-bg text-state-info-strong',
  },
  danger: {
    value: 'text-state-danger-strong',
    iconWrap: 'bg-state-danger-bg text-state-danger-strong',
  },
  purple: {
    value: 'text-state-purple-strong',
    iconWrap: 'bg-state-purple-bg text-state-purple-strong',
  },
};

const RECENTES_LIMITE = 100;

export default function RecebedorProdutividade() {
  usePageTitle('Minha produtividade');
  const { firebaseUser } = useAuth();
  const meUid = firebaseUser?.uid ?? null;

  // "now" no fuso SP; recalcula o mês corrente uma vez por minuto.
  const [now, setNow] = useState<Date>(() => nowInSp());
  useEffect(() => {
    const id = window.setInterval(() => setNow(nowInSp()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const mesKey = useMemo(() => formatDateBr(now, 'yyyy-MM'), [now]);
  const mesLabel = useMemo(() => formatDateBr(now, 'MM/yyyy'), [now]);

  const [processos, setProcessos] = useState<Processo[] | null>(null);
  const [erro, setErro] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  useEffect(() => {
    if (!meUid) return;
    setErro(null);
    const cached = getConcluidosRecebedorCache(meUid);
    if (cached) {
      setProcessos(cached);
      return;
    }
    setProcessos(null);
    let cancelled = false;
    void (async () => {
      try {
        const list = await getProcessosConcluidosByRecebedor(meUid);
        if (cancelled) return;
        setConcluidosRecebedorCache(meUid, list);
        setProcessos(list);
      } catch (err) {
        if (cancelled) return;
        setErro(err instanceof Error ? err : new Error('Falha ao carregar.'));
        setProcessos([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [meUid, fetchKey]);

  const refresh = useCallback(() => {
    invalidateConcluidosRecebedorCache();
    setFetchKey((k) => k + 1);
  }, []);

  // Processos em aberto do recebedor (para o card "Atrasados"). Listener
  // escopado por uid; conta os vencidos com isAtrasado(now).
  const [abertos, setAbertos] = useState<Processo[] | null>(null);
  useEffect(() => {
    if (!meUid) {
      setAbertos(null);
      return;
    }
    const unsub = subscribeProcessosAbertosByRecebedor(
      meUid,
      setAbertos,
      () => setAbertos([])
    );
    return () => unsub();
  }, [meUid]);
  const atrasados = useMemo(
    () => (abertos ?? []).filter((p) => isAtrasado(p, now)).length,
    [abertos, now]
  );

  // A leitura traz no máx. LIMITE+1 (101) docs — o "+1" é só sinal para a aba
  // Histórico ("há mais de 100"). Esta página opera sobre no máx.
  // HISTORICO_RECEBEDOR_LIMITE (100), então "Concluídos no mês" nunca passa de 100.
  const concluidos = useMemo(
    () =>
      selecionarConcluidosRecentes(processos ?? [], HISTORICO_RECEBEDOR_LIMITE),
    [processos]
  );

  const stats: ProdutividadePessoalStats | null = useMemo(() => {
    if (!meUid || processos === null) return null;
    return calcularProdutividadePessoal(concluidos, meUid, mesKey);
  }, [concluidos, meUid, mesKey]);

  // Conclusões recentes para a lista de apoio (mesma janela de 100).
  const recentes = useMemo(
    () => selecionarConcluidosRecentes(concluidos, RECENTES_LIMITE),
    [concluidos]
  );

  const carregando = processos === null;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink-primary">
            Minha produtividade
          </h1>
          <p className="mt-1 text-sm text-ink-secondary">
            Seus números do mês {mesLabel}: concluídos, devolvidos e tempo de
            execução (início até conclusão).
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={carregando}
          className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-surface px-3 py-2 text-sm font-medium text-ink-primary hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {carregando ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Atualizar
        </button>
      </header>

      {erro ? (
        <ErrorState
          message="Falha ao carregar sua produtividade. Verifique sua conexão e tente novamente."
          onRetry={refresh}
        />
      ) : carregando || stats === null ? (
        <div className="flex items-center justify-center rounded-lg border border-gray-200 bg-surface px-4 py-12 text-sm text-ink-secondary">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Carregando produtividade...
        </div>
      ) : (
        <>
          <section
            aria-label="Indicadores do mês"
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
          >
            <KpiCard
              label="Concluídos no mês"
              value={String(stats.concluidosNoMes)}
              icon={<CheckCircle2 className="h-5 w-5" />}
              tone="success"
              subtitle={mesLabel}
            />
            <KpiCard
              label="Implantados"
              value={String(stats.implantadosNoMes)}
              icon={<ClipboardList className="h-5 w-5" />}
              tone="info"
              subtitle="Concluídos sem devolução"
            />
            <KpiCard
              label="Devolvidos"
              value={String(stats.devolvidosNoMes)}
              icon={<CornerUpLeft className="h-5 w-5" />}
              tone="warning"
              subtitle="Devolvidos à origem"
            />
            <KpiCard
              label="Tempo médio"
              value={formatDurationMs(stats.mediaMs)}
              icon={<Clock className="h-5 w-5" />}
              tone="neutral"
              subtitle="Início até conclusão"
            />
            <KpiCard
              label="Mais rápido"
              value={formatDurationMs(stats.menorMs)}
              icon={<TrendingDown className="h-5 w-5" />}
              tone="success"
              subtitle="Menor tempo no mês"
            />
            <KpiCard
              label="Mais lento"
              value={formatDurationMs(stats.maiorMs)}
              icon={<TrendingUp className="h-5 w-5" />}
              tone="danger"
              subtitle="Maior tempo no mês"
            />
            <KpiCard
              label="Urgentes"
              value={String(stats.urgentesNoMes)}
              icon={<Flame className="h-5 w-5" />}
              tone="danger"
              subtitle="Concluídos urgentes"
            />
            <KpiCard
              label="Atrasados"
              value={abertos === null ? '—' : String(atrasados)}
              icon={<AlarmClock className="h-5 w-5" />}
              tone={atrasados > 0 ? 'danger' : 'neutral'}
              subtitle="Em aberto vencidos agora"
            />
          </section>

          <RecentesPanel recentes={recentes} />
        </>
      )}
    </div>
  );
}

interface KpiCardProps {
  label: string;
  value: string;
  subtitle: string;
  tone: KpiTone;
  icon: React.ReactNode;
}

function KpiCard(props: KpiCardProps) {
  const classes = KPI_TONE_CLASSES[props.tone];
  return (
    <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-surface p-4 shadow-sm">
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${classes.iconWrap}`}
        aria-hidden
      >
        {props.icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs uppercase tracking-wide text-ink-secondary">
          {props.label}
        </div>
        <div
          className={`text-2xl font-semibold leading-tight tabular-nums ${classes.value}`}
        >
          {props.value}
        </div>
        <div className="truncate text-xs text-ink-secondary">
          {props.subtitle}
        </div>
      </div>
    </div>
  );
}

function RecentesPanel({ recentes }: { recentes: Processo[] }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-surface shadow-sm">
      <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-secondary">
          Conclusões recentes
        </h2>
        <span className="text-xs text-ink-secondary">
          Últimos {RECENTES_LIMITE}
        </span>
      </header>

      {recentes.length === 0 ? (
        <div className="flex items-center justify-center px-4 py-8 text-sm text-ink-secondary">
          Quando você concluir processos, eles aparecerão aqui.
        </div>
      ) : (
        <>
          {/* Tabela no desktop */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-ink-secondary">
                <tr>
                  <th className="px-3 py-2">Número</th>
                  <th className="px-3 py-2">Origem</th>
                  <th className="px-3 py-2">Concluído em</th>
                  <th className="px-3 py-2 text-right">Tempo</th>
                  <th className="px-3 py-2 text-center">Devolvido</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {recentes.map((p) => (
                  <tr key={p.id} className="text-ink-primary">
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                      {p.numero}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-secondary">
                      {p.agrupadorNome}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-secondary">
                      {p.concluidoEm
                        ? formatDateBr(p.concluidoEm.toDate())
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs text-ink-secondary">
                      {p.iniciadoEm && p.concluidoEm
                        ? formatDurationMs(
                            p.concluidoEm.toMillis() - p.iniciadoEm.toMillis()
                          )
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-center text-xs">
                      {p.devolvido ? (
                        <span className="inline-flex items-center gap-1 text-state-warning-strong">
                          <CornerUpLeft className="h-3.5 w-3.5" />
                          Sim
                        </span>
                      ) : (
                        <span className="text-ink-secondary">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Cards no mobile */}
          <div className="space-y-2 p-3 md:hidden">
            {recentes.map((p) => (
              <article
                key={p.id}
                className="rounded-lg border border-gray-200 bg-surface p-3 text-sm shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="break-all font-mono text-xs font-semibold text-ink-primary">
                    {p.numero}
                  </span>
                  {p.devolvido && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-state-warning-bg px-2 py-0.5 text-[11px] font-semibold text-state-warning-strong">
                      <CornerUpLeft className="h-3 w-3" />
                      Devolvido
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-ink-secondary">
                  {p.agrupadorNome}
                </p>
                <dl className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-ink-secondary">
                  <div>
                    <dt>Concluído</dt>
                    <dd className="text-ink-primary">
                      {p.concluidoEm
                        ? formatDateBr(p.concluidoEm.toDate())
                        : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt>Tempo</dt>
                    <dd className="text-ink-primary">
                      {p.iniciadoEm && p.concluidoEm
                        ? formatDurationMs(
                            p.concluidoEm.toMillis() - p.iniciadoEm.toMillis()
                          )
                        : '—'}
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
