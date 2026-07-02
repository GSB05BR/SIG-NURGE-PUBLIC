import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  ClipboardList,
  Clock,
  Download,
  FileJson,
  FileText,
  Flame,
  Loader2,
  PlayCircle,
  Plus,
  RefreshCw,
  Star,
  TrendingUp,
  X,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  formatDateBr,
  getSemanaIso,
  nowInSp,
} from '@/lib/datetime';
import {
  getProcessosByPeriodo,
  getProcessosConcluidosNoPeriodo,
  subscribeProcessosConcluidosNoPeriodo,
} from '@/services/firebase/processos';
import {
  useProcessosAbertos,
  useProcessosAbertosError,
  useProcessosSemana,
  useProcessosSemanaError,
  retryAbertos,
  retrySemana,
  getPeriodoCache,
  setPeriodoCache,
  invalidatePeriodoCache,
} from '@/store/processosStore';
import { ErrorState } from '@/components/ErrorState';
import { subscribeAgrupadores } from '@/services/firebase/agrupadores';
import { subscribeAllUsers } from '@/services/firebase/users';
import {
  calcularAlertas,
  calcularKPIs,
  calcularOrigemCadastroPorRecebedor,
  calcularPendentesSeisHorasPorDia,
  calcularPorAgrupador,
  calcularPorDiaSemana,
  calcularPorRecebedor,
  calcularSerieDiaria,
  calcularTempoMedioConclusaoPorRecebedor,
  formatDurationMs,
  type PendentesOrigemDia,
  type PendentesSeisHorasPorDia,
  type RecebedorStats,
  type TempoMedioRecebedorStats,
} from '@/lib/produtividade';
import { usePageTitle } from '@/lib/usePageTitle';
import type {
  Agrupador,
  DiaSemana,
  Processo,
  User,
} from '@/types';
import Modal from '@/components/Modal';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type PeriodoMode = 'hoje' | 'semana' | 'mes' | 'custom';

interface PeriodoIso {
  start: string; // "YYYY-MM-DD" inclusive
  end: string; // "YYYY-MM-DD" exclusive
}

const DIA_SEMANA_LABEL: Record<DiaSemana, string> = {
  segunda: 'Seg',
  terca: 'Ter',
  quarta: 'Qua',
  quinta: 'Qui',
  sexta: 'Sex',
};

const TEMPO_MEDIO_PDF_PAGE_HEIGHT_MM = 210;
const TEMPO_MEDIO_PDF_MARGIN_TOP_MM = 10;
const TEMPO_MEDIO_PDF_MARGIN_BOTTOM_MM = 8;
const TEMPO_MEDIO_PDF_HEADER_HEIGHT_MM = 12;
const TEMPO_MEDIO_PDF_TABLE_HEADER_HEIGHT_MM = 6;
const TEMPO_MEDIO_PDF_MAX_ROW_HEIGHT_MM = 6.2;
const TEMPO_MEDIO_PDF_FONT_MIN = 4;
const TEMPO_MEDIO_PDF_FONT_MAX = 8;

// Paleta para recharts (precisa de strings hex — recharts não lê classes Tailwind).
// Para KPIs e UI textual, usamos a prop `tone` do KpiCard que mapeia para tokens
// `state-*` do Tailwind (definidos em index.css com variantes light/dark).
const COLOR = {
  brand: '#C41E3A',
  concluidos: '#059669',
  seiJson: '#0F766E',
  manual: '#7C3AED',
  legado: '#64748B',
  ink: '#6B7280',
} as const;

type KpiTone =
  | 'neutral'
  | 'success'
  | 'warning'
  | 'info'
  | 'danger'
  | 'purple';

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Produtividade() {
  usePageTitle('Produtividade');
  // Refresh "now" once a minute so atrasados stay current.
  const [now, setNow] = useState<Date>(() => nowInSp());
  useEffect(() => {
    const id = window.setInterval(() => setNow(nowInSp()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const semanaAtualKey = useMemo(() => getSemanaIso(now), [now]);
  const mesAtualKey = useMemo(
    () => `${now.getFullYear()}-${now.getMonth()}`,
    [now]
  );

  // Filtros de período
  const [modo, setModo] = useState<PeriodoMode>('hoje');
  const [customStart, setCustomStart] = useState<string>(
    () => firstOfMonthIso(nowInSp())
  );
  const [customEnd, setCustomEnd] = useState<string>(
    () => todayIso(nowInSp())
  );

  // Dados de apoio (sempre realtime — são pequenos)
  const [users, setUsers] = useState<User[] | null>(null);
  const [agrupadores, setAgrupadores] = useState<Agrupador[] | null>(null);
  const [depsError, setDepsError] = useState<Error | null>(null);
  const [depsRetryKey, setDepsRetryKey] = useState(0);

  useEffect(() => {
    setDepsError(null);
    const unsubU = subscribeAllUsers(
      (list) => setUsers(list),
      (err) => setDepsError(err)
    );
    const unsubA = subscribeAgrupadores(
      (list) => setAgrupadores(list),
      (err) => setDepsError(err)
    );
    return () => {
      unsubU();
      unsubA();
    };
  }, [depsRetryKey]);

  // Dados de processos: realtime na semana atual via listener COMPARTILHADO
  // (store global, item 1); fetch único nos demais períodos.
  const isPeriodoRealtime = modo === 'semana' || modo === 'hoje';
  const processosAbertos = useProcessosAbertos();
  const abertosError = useProcessosAbertosError();
  const semanaProcessos = useProcessosSemana(
    isPeriodoRealtime ? semanaAtualKey : null
  );
  const semanaError = useProcessosSemanaError(
    isPeriodoRealtime ? semanaAtualKey : null
  );
  // Mês/custom: busca única, recarregável via fetchKey.
  const [periodoProcessos, setPeriodoProcessos] = useState<Processo[] | null>(
    null
  );
  const processos = isPeriodoRealtime ? semanaProcessos : periodoProcessos;
  // Concluídos no período por data de conclusão (independe da data de
  // atribuição) — alimenta a coluna "Concluídos" do ranking em tempo real.
  const [processosConcluidos, setProcessosConcluidos] = useState<
    Processo[] | null
  >(null);
  const [concluidosError, setConcluidosError] = useState<Error | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchKey, setFetchKey] = useState(0); // bump to manually refresh

  // Recarrega sob demanda: invalida a memoização de períodos fechados (item 2)
  // e dispara nova busca.
  const refresh = useCallback(() => {
    invalidatePeriodoCache();
    setFetchKey((k) => k + 1);
  }, []);

  // Dia de hoje (SP), usado para "distribuídos hoje" e "pendentes de ontem".
  const hojeIso = useMemo(() => localIso(now), [now]);

  useEffect(() => {
    setFetchError(null);
    setPeriodoProcessos(null);

    // "Hoje" e "Semana atual" são realtime via listener compartilhado
    // (semanaProcessos); não há busca a fazer aqui.
    if (isPeriodoRealtime) {
      return;
    }

    // Modo mês ou custom: fetch único, recarrega via fetchKey.
    if (modo === 'custom' && (!customStart || !customEnd)) {
      setPeriodoProcessos([]);
      setFetchError(
        'Período inválido: informe data inicial e final.'
      );
      return;
    }

    if (modo === 'custom' && customStart > customEnd) {
      setPeriodoProcessos([]);
      setFetchError(
        'Período inválido: a data inicial precisa ser anterior ou igual à final.'
      );
      return;
    }

    const periodo: PeriodoIso =
      modo === 'mes'
        ? mesAtualIso(now)
        : { start: customStart, end: addIsoDays(customEnd, 1) };

    if (!isValidPeriodo(periodo)) {
      setPeriodoProcessos([]);
      setFetchError(
        'Período inválido: a data inicial precisa ser anterior à final.'
      );
      return;
    }

    // Memoiza só períodos FECHADOS (fim exclusivo <= hoje): não mudam mais.
    // O mês corrente (e qualquer range incluindo hoje) fica sempre fresco.
    const isFechado = periodo.end <= hojeIso;
    const cacheKey = `byPeriodo:${periodo.start}:${periodo.end}`;
    if (isFechado) {
      const cached = getPeriodoCache(cacheKey);
      if (cached) {
        setPeriodoProcessos(cached);
        return;
      }
    }

    let cancelled = false;
    void (async () => {
      try {
        const list = await getProcessosByPeriodo(periodo.start, periodo.end);
        if (cancelled) return;
        if (isFechado) setPeriodoCache(cacheKey, list);
        setPeriodoProcessos(list);
      } catch (err) {
        if (cancelled) return;
        const msg =
          err instanceof Error
            ? err.message
            : 'Falha ao carregar processos no período.';
        setFetchError(msg);
        setPeriodoProcessos([]);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-run only when the selected period boundary changes or on manual refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modo, customStart, customEnd, fetchKey, mesAtualKey, hojeIso]);

  // ---------------- Derivações ----------------

  const loadingDeps = users === null || agrupadores === null;
  const loadingProcessos =
    processos === null ||
    (modo !== 'custom' && processosAbertos === null) ||
    processosConcluidos === null;
  const isLoading = loadingDeps || loadingProcessos;

  // Erro de CARREGAMENTO (distinto de `fetchError`, que também serve de
  // validação de período e coexiste com conteúdo). Reúne só os listeners cujo
  // `null` trava o spinner: deps (users/agrupadores), abertos (quando gating),
  // a semana realtime e os concluídos realtime. Substitui o LoadingCard.
  const loadError =
    depsError ??
    (modo !== 'custom' ? abertosError : null) ??
    semanaError ??
    concluidosError;

  const processosOperacionais = useMemo(
    () =>
      mergeProcessosPeriodoComAbertos(
        processos ?? [],
        processosAbertos ?? [],
        modo,
        hojeIso
      ),
    [modo, processos, processosAbertos, hojeIso]
  );

  const kpis = useMemo(
    () => calcularKPIs(processosOperacionais, now),
    [processosOperacionais, now]
  );

  // Período do ranking: [start, end] em SP, com end sempre limitado a hoje.
  // Semana/mês cobrem da segunda/1º até hoje; custom usa as datas escolhidas.
  const rankingPeriodo = useMemo<{ startIso: string; endIso: string } | null>(
    () => {
      if (modo === 'hoje') {
        return { startIso: hojeIso, endIso: hojeIso };
      }
      if (modo === 'semana') {
        const dow = now.getDay(); // 0=Dom..6=Sáb
        const back = dow === 0 ? 6 : dow - 1;
        const seg = new Date(now);
        seg.setDate(seg.getDate() - back);
        return { startIso: localIso(seg), endIso: hojeIso };
      }
      if (modo === 'mes') {
        return { startIso: firstOfMonthIso(now), endIso: hojeIso };
      }
      if (!customStart || !customEnd) return null;
      const endIso = customEnd > hojeIso ? hojeIso : customEnd;
      if (customStart > endIso) return null;
      return { startIso: customStart, endIso };
    },
    [modo, now, customStart, customEnd, hojeIso]
  );

  // Concluídos no período por data de conclusão (independe da data de
  // atribuição). Realtime em hoje/semana; fetch único em mês/custom.
  const rankingStartIso = rankingPeriodo?.startIso ?? null;
  const rankingEndIso = rankingPeriodo?.endIso ?? null;
  useEffect(() => {
    setConcluidosError(null);
    if (!rankingStartIso || !rankingEndIso) {
      setProcessosConcluidos([]);
      return;
    }
    const endExclIso = addIsoDays(rankingEndIso, 1);
    if (modo === 'hoje' || modo === 'semana') {
      const unsub = subscribeProcessosConcluidosNoPeriodo(
        rankingStartIso,
        endExclIso,
        (list) => {
          setProcessosConcluidos(list);
          setConcluidosError(null);
        },
        (err) => setConcluidosError(err)
      );
      return () => unsub();
    }
    // Memoiza só períodos fechados (fim exclusivo <= hoje).
    const isFechado = endExclIso <= hojeIso;
    const cacheKey = `concluidos:${rankingStartIso}:${endExclIso}`;
    if (isFechado) {
      const cached = getPeriodoCache(cacheKey);
      if (cached) {
        setProcessosConcluidos(cached);
        return;
      }
    }
    let cancelled = false;
    setProcessosConcluidos(null);
    void (async () => {
      try {
        const list = await getProcessosConcluidosNoPeriodo(
          rankingStartIso,
          endExclIso
        );
        if (cancelled) return;
        if (isFechado) setPeriodoCache(cacheKey, list);
        setProcessosConcluidos(list);
      } catch {
        if (!cancelled) setProcessosConcluidos([]);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modo, rankingStartIso, rankingEndIso, fetchKey, hojeIso]);

  // O ranking precisa enxergar processos atribuídos antes do período (backlog) e
  // concluídos no período mesmo que atribuídos fora da janela. Unimos abertos
  // (qualquer data) e concluídos-do-período ao dataset.
  const processosParaRanking = useMemo(() => {
    const byId = new Map<string, Processo>();
    for (const p of processosOperacionais) byId.set(p.id, p);
    for (const p of processosAbertos ?? []) byId.set(p.id, p);
    for (const p of processosConcluidos ?? []) byId.set(p.id, p);
    return Array.from(byId.values());
  }, [processosOperacionais, processosAbertos, processosConcluidos]);

  const ranking = useMemo(
    () =>
      rankingPeriodo
        ? calcularPorRecebedor(processosParaRanking, users ?? [], {
            periodoStartIso: rankingPeriodo.startIso,
            periodoEndIso: rankingPeriodo.endIso,
            modoHoje: modo === 'hoje',
          })
        : [],
    [processosParaRanking, users, rankingPeriodo, modo]
  );

  // Período de um único dia → rótulos "no dia"; vários dias → "no período".
  const rankingEhDia = rankingPeriodo
    ? rankingPeriodo.startIso === rankingPeriodo.endIso
    : false;

  const diasPeriodo = useMemo(
    () => diasDoPeriodo(modo, now, customStart, customEnd),
    [modo, now, customStart, customEnd]
  );

  const pendentesSeisHoras = useMemo(
    () =>
      calcularPendentesSeisHorasPorDia(
        processosOperacionais,
        users ?? [],
        diasPeriodo
      ),
    [processosOperacionais, users, diasPeriodo]
  );

  const tempoMedio = useMemo(
    () =>
      calcularTempoMedioConclusaoPorRecebedor(
        processosOperacionais,
        users ?? []
      ),
    [processosOperacionais, users]
  );

  const serie = useMemo(
    () => calcularSerieDiaria(processosOperacionais, 7),
    [processosOperacionais]
  );

  const porAgrupador = useMemo(
    () =>
      calcularPorAgrupador(processosOperacionais)
        .slice(0, 10)
        .map((a) => ({
          ...a,
          emAberto: Math.max(0, a.total - a.concluidos),
        })),
    [processosOperacionais]
  );

  const porDiaSemana = useMemo(
    () => calcularPorDiaSemana(processosOperacionais),
    [processosOperacionais]
  );

  const origemCadastro = useMemo(
    () => calcularOrigemCadastroPorRecebedor(processosOperacionais, users ?? []),
    [processosOperacionais, users]
  );

  const alertas = useMemo(
    () => calcularAlertas(ranking, processosOperacionais),
    [ranking, processosOperacionais]
  );

  const periodoLabel = useMemo(
    () => buildPeriodoLabel(modo, now, customStart, customEnd),
    [modo, now, customStart, customEnd]
  );

  // Banner dismiss state (não persiste).
  const [dismissedAtrasados, setDismissedAtrasados] = useState(false);
  const [dismissedPendentes, setDismissedPendentes] = useState(false);
  const [dismissedAcumulando, setDismissedAcumulando] = useState(false);

  // ---------------- Render ----------------

  return (
    <div className="space-y-6">
      <Header
        modo={modo}
        onModoChange={(m) => {
          setModo(m);
          setDismissedAtrasados(false);
          setDismissedPendentes(false);
          setDismissedAcumulando(false);
        }}
        customStart={customStart}
        customEnd={customEnd}
        onCustomStartChange={setCustomStart}
        onCustomEndChange={setCustomEnd}
        showRefresh={modo !== 'semana' && modo !== 'hoje'}
        onRefresh={refresh}
        isLoading={isLoading}
        periodoLabel={periodoLabel}
      />

      {fetchError && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{fetchError}</span>
        </div>
      )}

      {/* Alertas */}
      {!isLoading &&
        !dismissedAtrasados &&
        alertas.recebedoresMuitosAtrasados.length > 0 && (
          <Banner
            kind="danger"
            icon={<AlertTriangle className="h-4 w-4" />}
            title="Recebedores com muitos atrasados"
            onDismiss={() => setDismissedAtrasados(true)}
          >
            <ul className="mt-1 list-disc pl-5">
              {alertas.recebedoresMuitosAtrasados.map((s) => (
                <li key={s.uid}>
                  <strong>{s.nome}</strong>: {s.atrasados} atrasados
                </li>
              ))}
            </ul>
          </Banner>
        )}

      {!isLoading &&
        !dismissedPendentes &&
        alertas.recebedoresMuitosPendentes.length > 0 && (
          <Banner
            kind="warning"
            icon={<Clock className="h-4 w-4" />}
            title="Recebedores com muitos pendentes"
            onDismiss={() => setDismissedPendentes(true)}
          >
            <ul className="mt-1 list-disc pl-5">
              {alertas.recebedoresMuitosPendentes.map((s) => (
                <li key={s.uid}>
                  <strong>{s.nome}</strong>: {s.pendentes} pendentes
                </li>
              ))}
            </ul>
          </Banner>
        )}

      {!isLoading &&
        !dismissedAcumulando &&
        alertas.agrupadoresAcumulando.length > 0 && (
          <Banner
            kind="info"
            icon={<TrendingUp className="h-4 w-4" />}
            title="Origens com mais backlog"
            onDismiss={() => setDismissedAcumulando(true)}
          >
            <ul className="mt-1 list-disc pl-5">
              {alertas.agrupadoresAcumulando.map((a) => (
                <li key={a.agrupadorId}>
                  <strong>{a.agrupadorNome}</strong>: {a.total} em aberto
                </li>
              ))}
            </ul>
          </Banner>
        )}

      {/* KPIs */}
      <section
        aria-label="Indicadores principais"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <KpiCard
          label="Total"
          value={kpis.total}
          icon={<ClipboardList className="h-5 w-5" />}
          tone="neutral"
          subtitle={periodoLabel}
        />
        <KpiCard
          label="Concluídos"
          value={kpis.concluidos}
          icon={<CheckCircle2 className="h-5 w-5" />}
          tone="success"
          subtitle={
            kpis.total > 0
              ? `${kpis.pctConclusao.toFixed(0)}% do total`
              : '—'
          }
        />
        <KpiCard
          label="Pendentes"
          value={kpis.pendentes}
          icon={<Clock className="h-5 w-5" />}
          tone="warning"
          subtitle={
            kpis.total > 0
              ? `${pct(kpis.pendentes, kpis.total)}% do total`
              : '—'
          }
        />
        <KpiCard
          label="Em andamento"
          value={kpis.emAndamento}
          icon={<PlayCircle className="h-5 w-5" />}
          tone="info"
          subtitle={
            kpis.total > 0
              ? `${pct(kpis.emAndamento, kpis.total)}% do total`
              : '—'
          }
        />
        <KpiCard
          label="Atrasados"
          value={kpis.atrasados}
          icon={<AlertTriangle className="h-5 w-5" />}
          tone="danger"
          subtitle={
            kpis.total > 0
              ? `${pct(kpis.atrasados, kpis.total)}% do total`
              : '—'
          }
        />
        <KpiCard
          label="Urgentes"
          value={kpis.urgentes}
          icon={<Flame className="h-5 w-5" />}
          tone="danger"
          subtitle={
            kpis.total > 0
              ? `${pct(kpis.urgentes, kpis.total)}% do total`
              : '—'
          }
        />
        <KpiCard
          label="Prioridades"
          value={kpis.prioridades}
          icon={<Star className="h-5 w-5" />}
          tone="danger"
          subtitle={
            kpis.total > 0
              ? `${pct(kpis.prioridades, kpis.total)}% do total`
              : '—'
          }
        />
        <KpiCard
          label="Manuais"
          value={kpis.manuais}
          icon={<Plus className="h-5 w-5" />}
          tone="purple"
          subtitle={
            kpis.total > 0
              ? `${pct(kpis.manuais, kpis.total)}% do total`
              : '—'
          }
        />
        <KpiCard
          label="SEI JSON"
          value={kpis.seiJson}
          icon={<FileJson className="h-5 w-5" />}
          tone="success"
          subtitle={
            kpis.total > 0 ? `${pct(kpis.seiJson, kpis.total)}% do total` : '—'
          }
        />
      </section>

      {/* Erro / Loading / Empty (ordem canônica: erro → spinner → conteúdo) */}
      {loadError ? (
        <ErrorState
          message="Falha ao carregar os dados de produtividade. Verifique sua conexão e tente novamente."
          onRetry={() => {
            if (depsError) setDepsRetryKey((k) => k + 1);
            if (modo !== 'custom' && abertosError) retryAbertos();
            if (semanaError && isPeriodoRealtime) retrySemana(semanaAtualKey);
            if (concluidosError) refresh();
          }}
        />
      ) : isLoading ? (
        <LoadingCard />
      ) : kpis.total === 0 ? (
        <EmptyCard />
      ) : (
        <>
          {/* Ranking */}
          <RankingTable
            ranking={ranking}
            umDia={rankingEhDia}
            modoHoje={modo === 'hoje'}
          />

          <PendentesSeisHorasPanel
            dados={pendentesSeisHoras}
            periodoLabel={periodoLabel}
          />

          <TempoMedioPanel
            stats={tempoMedio}
            periodoLabel={periodoLabel}
            now={now}
          />

          {/* Gráficos */}
          <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard
              title="Conclusões por dia"
              subtitle="Últimos 7 dias"
            >
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={serie}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" />
                  <XAxis
                    dataKey="data"
                    tick={{ fontSize: 12, fill: COLOR.ink }}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 12, fill: COLOR.ink }}
                  />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line
                    type="monotone"
                    dataKey="concluidos"
                    name="Concluídos"
                    stroke={COLOR.concluidos}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="distribuidos"
                    name="Distribuídos"
                    stroke={COLOR.brand}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Distribuído vs concluído"
              subtitle="Últimos 7 dias"
            >
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={serie}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" />
                  <XAxis
                    dataKey="data"
                    tick={{ fontSize: 12, fill: COLOR.ink }}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 12, fill: COLOR.ink }}
                  />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar
                    dataKey="distribuidos"
                    name="Distribuídos"
                    fill={COLOR.brand}
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="concluidos"
                    name="Concluídos"
                    fill={COLOR.concluidos}
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Distribuição por origem"
              subtitle="Top 10 do período"
            >
              {porAgrupador.length === 0 ? (
                <ChartEmpty />
              ) : (
                <ResponsiveContainer
                  width="100%"
                  height={Math.max(220, porAgrupador.length * 32)}
                >
                  <BarChart data={porAgrupador} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" />
                    <XAxis
                      type="number"
                      allowDecimals={false}
                      tick={{ fontSize: 12, fill: COLOR.ink }}
                    />
                    <YAxis
                      dataKey="agrupadorNome"
                      type="category"
                      width={140}
                      tick={{ fontSize: 12, fill: COLOR.ink }}
                    />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar
                      dataKey="concluidos"
                      stackId="a"
                      name="Concluídos"
                      fill={COLOR.concluidos}
                    />
                    <Bar
                      dataKey="emAberto"
                      stackId="a"
                      name="Em aberto"
                      fill={COLOR.brand}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard
              title="Por dia da semana"
              subtitle="Atribuições no período"
            >
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={porDiaSemana.map((d) => ({
                    dia: DIA_SEMANA_LABEL[d.dia],
                    total: d.total,
                  }))}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" />
                  <XAxis
                    dataKey="dia"
                    tick={{ fontSize: 12, fill: COLOR.ink }}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 12, fill: COLOR.ink }}
                  />
                  <Tooltip />
                  <Bar
                    dataKey="total"
                    name="Processos"
                    fill={COLOR.brand}
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Origem do cadastro por recebedor"
              subtitle="SEI JSON, manual e legado"
              className="lg:col-span-2"
            >
              {origemCadastro.length === 0 ? (
                <ChartEmpty />
              ) : (
                <ResponsiveContainer
                  width="100%"
                  height={Math.max(220, origemCadastro.length * 36)}
                >
                  <BarChart data={origemCadastro} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" />
                    <XAxis
                      type="number"
                      allowDecimals={false}
                      tick={{ fontSize: 12, fill: COLOR.ink }}
                    />
                    <YAxis
                      dataKey="recebedorNome"
                      type="category"
                      width={140}
                      tick={{ fontSize: 12, fill: COLOR.ink }}
                    />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar
                      dataKey="seiJson"
                      stackId="origem"
                      name="SEI JSON"
                      fill={COLOR.seiJson}
                    />
                    <Bar
                      dataKey="manual"
                      stackId="origem"
                      name="Manual"
                      fill={COLOR.manual}
                    />
                    <Bar
                      dataKey="legado"
                      stackId="origem"
                      name="Legado"
                      fill={COLOR.legado}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </section>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface HeaderProps {
  modo: PeriodoMode;
  onModoChange: (m: PeriodoMode) => void;
  customStart: string;
  customEnd: string;
  onCustomStartChange: (v: string) => void;
  onCustomEndChange: (v: string) => void;
  showRefresh: boolean;
  onRefresh: () => void;
  isLoading: boolean;
  periodoLabel: string;
}

function Header(props: HeaderProps) {
  return (
    <header className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink-primary">
            Produtividade
          </h1>
          <p className="text-sm text-ink-secondary">
            KPIs, ranking de recebedores e tendências por data de atribuição. {props.periodoLabel}.
          </p>
        </div>
        {props.showRefresh && (
          <button
            type="button"
            onClick={props.onRefresh}
            disabled={props.isLoading}
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-surface px-3 py-2 text-sm font-medium text-ink-primary hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {props.isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Atualizar
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-gray-200 bg-surface p-3">
        <fieldset className="flex flex-wrap items-center gap-3">
          <legend className="sr-only">Período</legend>
          <RadioOption
            id="periodo-hoje"
            name="periodo"
            checked={props.modo === 'hoje'}
            onChange={() => props.onModoChange('hoje')}
            label="Hoje"
            hint="tempo real"
          />
          <RadioOption
            id="periodo-semana"
            name="periodo"
            checked={props.modo === 'semana'}
            onChange={() => props.onModoChange('semana')}
            label="Semana atual"
            hint="tempo real"
          />
          <RadioOption
            id="periodo-mes"
            name="periodo"
            checked={props.modo === 'mes'}
            onChange={() => props.onModoChange('mes')}
            label="Mês atual"
          />
          <RadioOption
            id="periodo-custom"
            name="periodo"
            checked={props.modo === 'custom'}
            onChange={() => props.onModoChange('custom')}
            label="Personalizado"
          />
        </fieldset>

        {props.modo === 'custom' && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col text-xs text-ink-secondary">
              De
              <input
                type="date"
                value={props.customStart}
                onChange={(e) => props.onCustomStartChange(e.target.value)}
                className="mt-1 rounded-md border border-gray-300 px-2 py-1 text-sm text-ink-primary"
              />
            </label>
            <label className="flex flex-col text-xs text-ink-secondary">
              Até
              <input
                type="date"
                value={props.customEnd}
                onChange={(e) => props.onCustomEndChange(e.target.value)}
                className="mt-1 rounded-md border border-gray-300 px-2 py-1 text-sm text-ink-primary"
              />
            </label>
          </div>
        )}
      </div>
    </header>
  );
}

interface RadioOptionProps {
  id: string;
  name: string;
  checked: boolean;
  onChange: () => void;
  label: string;
  hint?: string;
}

function RadioOption(props: RadioOptionProps) {
  return (
    <label
      htmlFor={props.id}
      className={`inline-flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm transition-colors ${
        props.checked
          ? 'border-brand-primary bg-brand-primary-light text-brand-primary-dark'
          : 'border-gray-300 bg-surface text-ink-primary hover:bg-gray-50'
      }`}
    >
      <input
        type="radio"
        id={props.id}
        name={props.name}
        checked={props.checked}
        onChange={props.onChange}
        className="h-3.5 w-3.5 accent-brand-primary"
      />
      <span className="font-medium">{props.label}</span>
      {props.hint && (
        <span className="text-xs text-ink-secondary">({props.hint})</span>
      )}
    </label>
  );
}

interface KpiCardProps {
  label: string;
  value: number;
  subtitle: string;
  tone: KpiTone;
  icon: React.ReactNode;
}

const PRODUTIVIDADE_KPI_TONE_CLASSES: Record<
  KpiTone,
  { value: string; iconWrap: string }
> = {
  neutral: {
    value: 'text-ink-primary',
    iconWrap: 'bg-gray-100 text-ink-primary',
  },
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

function KpiCard(props: KpiCardProps) {
  const classes = PRODUTIVIDADE_KPI_TONE_CLASSES[props.tone];
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
          {formatInt(props.value)}
        </div>
        <div className="truncate text-xs text-ink-secondary">
          {props.subtitle}
        </div>
      </div>
    </div>
  );
}

interface BannerProps {
  kind: 'danger' | 'warning' | 'info';
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  onDismiss: () => void;
}

function Banner(props: BannerProps) {
  const kindClass =
    props.kind === 'danger'
      ? 'border-rose-200 bg-rose-50 text-rose-900'
      : props.kind === 'warning'
        ? 'border-amber-200 bg-amber-50 text-amber-900'
        : 'border-sky-200 bg-sky-50 text-sky-900';
  return (
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-md border px-4 py-3 text-sm ${kindClass}`}
    >
      <span className="mt-0.5 shrink-0">{props.icon}</span>
      <div className="flex-1">
        <div className="font-semibold">{props.title}</div>
        <div>{props.children}</div>
      </div>
      <button
        type="button"
        aria-label="Dispensar"
        onClick={props.onDismiss}
        className="rounded p-0.5 hover:bg-black/5"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

interface RankingTableProps {
  ranking: RecebedorStats[];
  /** true quando o período filtrado cobre um único dia (rótulos "no dia"). */
  umDia: boolean;
  /** true no período "Hoje": Total/Pendentes refletem a carga das 6h. */
  modoHoje: boolean;
}

function RankingTable({ ranking, umDia, modoHoje }: RankingTableProps) {
  const escopo = umDia ? 'no dia' : 'no período';
  const totalTitle = modoHoje
    ? 'Pendentes às 6h da manhã de hoje (carga do dia)'
    : 'Total = Distribuídos + Pendentes anteriores (= Concluídos + Pendentes)';
  const pendentesTitle = modoHoje
    ? 'Dos pendentes às 6h, quantos ainda não foram concluídos (cai em tempo real)'
    : 'Não concluídos até às 23h59 do último dia do período (congelado nos dias passados)';
  return (
    <section className="rounded-lg border border-gray-200 bg-surface shadow-sm">
      <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-secondary">
          Ranking por recebedor
        </h2>
        <span className="text-xs text-ink-secondary">
          Ordenado por concluídos
        </span>
      </header>
      {ranking.length === 0 ? (
        <div className="flex items-center justify-center px-4 py-8 text-sm text-ink-secondary">
          Sem recebedores ativos.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-ink-secondary">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Recebedor</th>
                <th
                  className="px-3 py-2 text-right"
                  title={`Processos atribuídos ao recebedor ${escopo} filtrado (por data de atribuição)`}
                >
                  Distrib. {escopo}
                </th>
                <th
                  className="px-3 py-2 text-right"
                  title="Backlog: processos ainda não concluídos às 23h59 da véspera do início do período (registro histórico — não diminui se forem concluídos depois)"
                >
                  Pend. anteriores
                </th>
                <th className="px-3 py-2 text-right" title={totalTitle}>
                  Total
                </th>
                <th
                  className="px-3 py-2 text-right"
                  title="Concluídos no período por data de conclusão, em tempo real (mesmo que atribuídos em outra data)"
                >
                  Concluídos
                </th>
                <th className="px-3 py-2 text-right" title={pendentesTitle}>
                  Pendentes
                </th>
                <th className="px-3 py-2 text-right">Atrasados</th>
                <th className="px-3 py-2 text-right">Urgentes</th>
                <th className="px-3 py-2 text-right">Prioridades</th>
                <th className="px-3 py-2 text-right">Manuais</th>
                <th className="px-3 py-2">% Conclusão</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {ranking.map((s, idx) => (
                <tr key={s.uid} className="text-ink-primary">
                  <td className="px-3 py-2 align-middle">
                    <PositionMedal position={idx + 1} />
                  </td>
                  <td className="px-3 py-2 align-middle">
                    <div className="flex items-center gap-2">
                      <Avatar nome={s.nome} />
                      <span className="font-medium">{s.nome}</span>
                    </div>
                  </td>
                  <td
                    className="px-3 py-2 text-right tabular-nums"
                    title={`Atribuídos ${escopo}`}
                  >
                    {formatInt(s.distribuidosNoPeriodo)}
                  </td>
                  <td
                    className="px-3 py-2 text-right tabular-nums text-amber-700"
                    title="Pendentes até a véspera do período (backlog)"
                  >
                    {formatInt(s.pendentesAnteriores)}
                  </td>
                  <td
                    className="px-3 py-2 text-right tabular-nums font-medium"
                    title={totalTitle}
                  >
                    {formatInt(s.total)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-700">
                    {formatInt(s.concluidos)}
                  </td>
                  <td
                    className="px-3 py-2 text-right tabular-nums text-amber-700"
                    title={pendentesTitle}
                  >
                    {formatInt(s.pendentes)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${
                      s.atrasados > 0 ? 'text-rose-700' : 'text-ink-secondary'
                    }`}
                  >
                    {formatInt(s.atrasados)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {s.urgentes > 0 ? (
                      <span className="inline-flex items-center gap-1 text-brand-primary-dark">
                        <Flame className="h-3.5 w-3.5" />
                        {formatInt(s.urgentes)}
                      </span>
                    ) : (
                      <span className="text-ink-secondary">0</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {s.prioridades > 0 ? (
                      <span className="inline-flex items-center gap-1 text-brand-primary-dark">
                        <Star className="h-3.5 w-3.5" />
                        {formatInt(s.prioridades)}
                      </span>
                    ) : (
                      <span className="text-ink-secondary">0</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatInt(s.manuais)}
                  </td>
                  <td className="w-48 px-3 py-2 align-middle">
                    <PctBar pct={s.pctConclusao} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

interface PendentesTip {
  x: number;
  y: number;
  nome: string;
  diaLabel: string;
  total: number;
  detalhe: PendentesOrigemDia[];
}

interface PendentesSeisHorasPanelProps {
  dados: PendentesSeisHorasPorDia;
  periodoLabel: string;
}

function PendentesSeisHorasPanel({
  dados,
  periodoLabel,
}: PendentesSeisHorasPanelProps) {
  const { dias, diasLabel, porRecebedor, totalPorDia } = dados;
  const [tip, setTip] = useState<PendentesTip | null>(null);
  return (
    <section className="rounded-lg border border-gray-200 bg-surface shadow-sm">
      <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-secondary">
          Pendentes às 6h por recebedor
        </h2>
        <span className="text-xs text-ink-secondary">{periodoLabel}</span>
      </header>
      {dias.length === 0 || porRecebedor.length === 0 ? (
        <div className="flex items-center justify-center px-4 py-8 text-sm text-ink-secondary">
          Sem dados no período.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-ink-secondary">
              <tr>
                <th className="sticky left-0 z-10 bg-gray-50 px-3 py-2">
                  Recebedor
                </th>
                {diasLabel.map((label, i) => (
                  <th
                    key={dias[i]}
                    className="px-3 py-2 text-right tabular-nums"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {porRecebedor.map((r) => (
                <tr key={r.uid} className="text-ink-primary">
                  <td className="sticky left-0 z-10 bg-surface px-3 py-2 align-middle">
                    <div className="flex items-center gap-2">
                      <Avatar nome={r.nome} />
                      <span className="font-medium">{r.nome}</span>
                    </div>
                  </td>
                  {r.porDia.map((n, i) => (
                    <td
                      key={dias[i]}
                      onMouseEnter={
                        n > 0
                          ? (e) =>
                              setTip({
                                x: e.clientX,
                                y: e.clientY,
                                nome: r.nome,
                                diaLabel: diasLabel[i],
                                total: n,
                                detalhe: r.detalhePorDia[i],
                              })
                          : undefined
                      }
                      onMouseMove={
                        n > 0
                          ? (e) =>
                              setTip((t) =>
                                t ? { ...t, x: e.clientX, y: e.clientY } : t
                              )
                          : undefined
                      }
                      onMouseLeave={n > 0 ? () => setTip(null) : undefined}
                      className={`px-3 py-2 text-right tabular-nums ${
                        n > 0
                          ? 'cursor-help text-amber-700 hover:bg-amber-50'
                          : 'text-ink-secondary'
                      }`}
                    >
                      {formatInt(n)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200 bg-gray-50 font-semibold text-ink-primary">
                <td className="sticky left-0 z-10 bg-gray-50 px-3 py-2">
                  Total
                </td>
                {totalPorDia.map((n, i) => (
                  <td
                    key={dias[i]}
                    className="px-3 py-2 text-right tabular-nums"
                  >
                    {formatInt(n)}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {tip && <PendentesTooltip tip={tip} />}
    </section>
  );
}

function PendentesTooltip({ tip }: { tip: PendentesTip }) {
  // Posiciona perto do cursor (fixed = relativo à viewport), com flip quando
  // perto da borda direita/inferior para não vazar da tela.
  const margin = 14;
  const estWidth = 230;
  const estHeight = 60 + tip.detalhe.length * 18;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
  const left =
    tip.x + margin + estWidth > vw ? tip.x - margin - estWidth : tip.x + margin;
  const top =
    tip.y + margin + estHeight > vh
      ? Math.max(8, tip.y - margin - estHeight)
      : tip.y + margin;
  return (
    <div
      className="pointer-events-none fixed z-50 max-w-[260px] rounded-md bg-gray-900 px-3 py-2 text-xs text-white shadow-lg"
      style={{ left, top }}
    >
      <div className="mb-1 font-semibold">
        {tip.nome} · {tip.diaLabel}
      </div>
      <div className="mb-1 text-amber-300">
        {formatInt(tip.total)} pendentes
      </div>
      <ul className="space-y-0.5">
        {tip.detalhe.map((d) => (
          <li
            key={d.origemIso}
            className="flex justify-between gap-3 tabular-nums"
          >
            <span className="text-gray-300">de {d.origemLabel}</span>
            <span className="font-medium">{formatInt(d.count)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface TempoMedioPanelProps {
  stats: TempoMedioRecebedorStats[];
  periodoLabel: string;
  now: Date;
}

type TempoMedioSortKey =
  | 'nome'
  | 'processosMedidos'
  | 'mediaMs'
  | 'menorMs'
  | 'maiorMs';

type TempoMedioSortDir = 'asc' | 'desc';

function TempoMedioPanel({ stats, periodoLabel, now }: TempoMedioPanelProps) {
  const [sort, setSort] = useState<{
    key: TempoMedioSortKey;
    dir: TempoMedioSortDir;
  }>({ key: 'mediaMs', dir: 'asc' });
  const [pdfFontDialogOpen, setPdfFontDialogOpen] = useState(false);
  const [pdfFontSize, setPdfFontSize] = useState('');
  const medidos = stats.filter((s) => s.processosMedidos > 0);
  const totalProcessos = medidos.reduce((sum, s) => sum + s.processosMedidos, 0);
  const totalMs = medidos.reduce(
    (sum, s) => sum + (s.mediaMs ?? 0) * s.processosMedidos,
    0
  );
  const mediaGeral = totalProcessos > 0 ? totalMs / totalProcessos : null;
  const sortedStats = useMemo(
    () => sortTempoMedioStats(stats, sort.key, sort.dir),
    [stats, sort.key, sort.dir]
  );

  function handleSort(key: TempoMedioSortKey) {
    setSort((current) => {
      if (current.key === key) {
        return {
          key,
          dir: current.dir === 'asc' ? 'desc' : 'asc',
        };
      }
      return {
        key,
        dir: key === 'processosMedidos' ? 'desc' : 'asc',
      };
    });
  }

  function openPdfFontDialog() {
    setPdfFontSize(getTempoMedioPdfDefaultFontSize(stats.length).toFixed(1));
    setPdfFontDialogOpen(true);
  }

  function confirmPdfExport() {
    const parsedFontSize = Number.parseFloat(pdfFontSize.replace(',', '.'));
    const tableFontSize = Number.isFinite(parsedFontSize)
      ? Math.max(
          TEMPO_MEDIO_PDF_FONT_MIN,
          Math.min(TEMPO_MEDIO_PDF_FONT_MAX, parsedFontSize)
        )
      : getTempoMedioPdfDefaultFontSize(stats.length);
    setPdfFontDialogOpen(false);
    void exportTempoMedioPdf(sortedStats, periodoLabel, now, tableFontSize);
  }

  return (
    <>
      <section className="rounded-lg border border-gray-200 bg-surface shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-secondary">
            Tempo médio de conclusão
          </h2>
          <p className="mt-0.5 text-xs text-ink-secondary">
            Do clique em iniciar até a conclusão. {periodoLabel}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-gray-50 px-2.5 py-1 text-xs font-semibold text-ink-secondary ring-1 ring-gray-200">
            Média geral: {formatDurationMs(mediaGeral)}
          </span>
          <button
            type="button"
            onClick={openPdfFontDialog}
            className="inline-flex min-h-10 items-center gap-2 rounded-md border border-gray-300 bg-surface px-3 py-2 text-sm font-medium text-ink-primary hover:bg-gray-50"
          >
            <Download className="h-4 w-4" />
            Exportar PDF
          </button>
        </div>
      </header>

      {stats.length === 0 ? (
        <div className="flex items-center justify-center px-4 py-8 text-sm text-ink-secondary">
          Sem recebedores ativos.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-ink-secondary">
              <tr>
                <SortableTempoMedioTh
                  label="Recebedor"
                  sortKey="nome"
                  activeKey={sort.key}
                  dir={sort.dir}
                  onSort={handleSort}
                />
                <SortableTempoMedioTh
                  label="Processos medidos"
                  sortKey="processosMedidos"
                  activeKey={sort.key}
                  dir={sort.dir}
                  align="right"
                  onSort={handleSort}
                />
                <SortableTempoMedioTh
                  label="Tempo médio"
                  sortKey="mediaMs"
                  activeKey={sort.key}
                  dir={sort.dir}
                  align="right"
                  onSort={handleSort}
                />
                <SortableTempoMedioTh
                  label="Mais rápido"
                  sortKey="menorMs"
                  activeKey={sort.key}
                  dir={sort.dir}
                  align="right"
                  onSort={handleSort}
                />
                <SortableTempoMedioTh
                  label="Mais lento"
                  sortKey="maiorMs"
                  activeKey={sort.key}
                  dir={sort.dir}
                  align="right"
                  onSort={handleSort}
                />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedStats.map((s) => (
                <tr key={s.uid} className="text-ink-primary">
                  <td className="px-3 py-2 align-middle">
                    <div className="flex items-center gap-2">
                      <Avatar nome={s.nome} />
                      <span className="font-medium">{s.nome}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatInt(s.processosMedidos)}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-ink-primary">
                    {formatDurationMs(s.mediaMs)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-secondary">
                    {formatDurationMs(s.menorMs)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-secondary">
                    {formatDurationMs(s.maiorMs)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </section>

      <Modal
        open={pdfFontDialogOpen}
        title="Gerar PDF"
        description="Escolha o tamanho da fonte da tabela no PDF."
        size="sm"
        onClose={() => setPdfFontDialogOpen(false)}
        footer={
          <>
            <button
              type="button"
              onClick={() => setPdfFontDialogOpen(false)}
              className="rounded-md border border-gray-200 px-3 py-2 text-sm font-medium text-ink-primary hover:bg-gray-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirmPdfExport}
              className="inline-flex items-center gap-2 rounded-md bg-brand-primary px-3 py-2 text-sm font-semibold text-white hover:bg-brand-primary-dark"
            >
              <Download className="h-4 w-4" />
              Gerar PDF
            </button>
          </>
        }
      >
        <label className="block text-sm font-medium text-ink-primary">
          Tamanho da fonte do PDF
          <input
            type="number"
            min={4}
            max={8}
            step={0.1}
            value={pdfFontSize}
            onChange={(e) => setPdfFontSize(e.target.value)}
            className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-ink-primary focus:border-brand-primary focus:ring-1 focus:ring-brand-primary"
          />
        </label>
        <p className="mt-2 text-xs text-ink-secondary">
          O valor atual vem pré-selecionado. Use entre 4 e 8 para manter a tabela em uma página.
        </p>
      </Modal>
    </>
  );
}

interface SortableTempoMedioThProps {
  label: string;
  sortKey: TempoMedioSortKey;
  activeKey: TempoMedioSortKey;
  dir: TempoMedioSortDir;
  align?: 'left' | 'right';
  onSort: (key: TempoMedioSortKey) => void;
}

function SortableTempoMedioTh({
  label,
  sortKey,
  activeKey,
  dir,
  align = 'left',
  onSort,
}: SortableTempoMedioThProps) {
  const active = activeKey === sortKey;
  const Icon = !active ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      className="px-3 py-2"
      aria-sort={
        active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'
      }
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex min-h-8 w-full items-center gap-1.5 rounded px-1 text-xs font-semibold uppercase tracking-wide text-ink-secondary hover:bg-gray-100 hover:text-ink-primary ${
          align === 'right' ? 'justify-end text-right' : 'justify-start text-left'
        } ${active ? 'text-ink-primary' : ''}`}
        aria-label={`Ordenar por ${label}`}
      >
        <span>{label}</span>
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      </button>
    </th>
  );
}

function PositionMedal({ position }: { position: number }) {
  const medal =
    position === 1 ? '🥇' : position === 2 ? '🥈' : position === 3 ? '🥉' : null;
  return (
    <span className="inline-flex h-6 w-6 items-center justify-center text-base">
      {medal ?? <span className="text-xs text-ink-secondary">{position}</span>}
    </span>
  );
}

function Avatar({ nome }: { nome: string }) {
  const initials = nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <span
      aria-hidden
      className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-primary text-xs font-semibold text-white"
    >
      {initials || '?'}
    </span>
  );
}

function PctBar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
        <div
          className="h-full rounded-full bg-state-success"
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="w-10 text-right text-xs tabular-nums text-ink-secondary">
        {clamped.toFixed(0)}%
      </span>
    </div>
  );
}

interface ChartCardProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}

function ChartCard(props: ChartCardProps) {
  return (
    <div
      className={`rounded-lg border border-gray-200 bg-surface p-4 shadow-sm ${
        props.className ?? ''
      }`}
    >
      <header className="mb-3">
        <h3 className="text-sm font-semibold text-ink-primary">
          {props.title}
        </h3>
        {props.subtitle && (
          <p className="text-xs text-ink-secondary">{props.subtitle}</p>
        )}
      </header>
      {props.children}
    </div>
  );
}

function ChartEmpty() {
  return (
    <div className="flex h-40 items-center justify-center text-sm text-ink-secondary">
      Sem dados para exibir.
    </div>
  );
}

function LoadingCard() {
  return (
    <div className="flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-surface px-4 py-12 text-sm text-ink-secondary">
      <Loader2 className="h-4 w-4 animate-spin" />
      Carregando dados de produtividade...
    </div>
  );
}

function EmptyCard() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-gray-200 bg-surface px-4 py-12 text-sm text-ink-secondary">
      <FileText className="h-8 w-8 text-ink-secondary" />
      <span>Nenhum processo no período selecionado.</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plain helpers (kept inside module so they don't leak into the public lib API)
// ---------------------------------------------------------------------------

function formatInt(n: number): string {
  return new Intl.NumberFormat('pt-BR').format(n);
}

// formatDurationMs movido para @/lib/produtividade (fonte única, compartilhada
// com a página de produtividade do recebedor).

function sortTempoMedioStats(
  stats: TempoMedioRecebedorStats[],
  key: TempoMedioSortKey,
  dir: TempoMedioSortDir
): TempoMedioRecebedorStats[] {
  return stats.slice().sort((a, b) => {
    const nullable = key === 'mediaMs' || key === 'menorMs' || key === 'maiorMs';
    const valueA = getTempoMedioSortValue(a, key);
    const valueB = getTempoMedioSortValue(b, key);

    if (nullable) {
      if (valueA === null && valueB !== null) return 1;
      if (valueA !== null && valueB === null) return -1;
      if (valueA === null && valueB === null) {
        return a.nome.localeCompare(b.nome, 'pt-BR');
      }
    }

    let cmp = 0;
    if (typeof valueA === 'string' && typeof valueB === 'string') {
      cmp = valueA.localeCompare(valueB, 'pt-BR');
    } else {
      cmp = Number(valueA) - Number(valueB);
    }

    if (cmp !== 0) return dir === 'asc' ? cmp : -cmp;
    return a.nome.localeCompare(b.nome, 'pt-BR');
  });
}

function getTempoMedioSortValue(
  stat: TempoMedioRecebedorStats,
  key: TempoMedioSortKey
): string | number | null {
  if (key === 'nome') return stat.nome;
  return stat[key];
}

function getTempoMedioPdfRowHeight(rowCount: number): number {
  if (rowCount <= 0) return 6;
  const availableRowsHeight =
    TEMPO_MEDIO_PDF_PAGE_HEIGHT_MM -
    TEMPO_MEDIO_PDF_MARGIN_TOP_MM -
    TEMPO_MEDIO_PDF_MARGIN_BOTTOM_MM -
    TEMPO_MEDIO_PDF_HEADER_HEIGHT_MM -
    TEMPO_MEDIO_PDF_TABLE_HEADER_HEIGHT_MM;
  return Math.min(
    TEMPO_MEDIO_PDF_MAX_ROW_HEIGHT_MM,
    availableRowsHeight / rowCount
  );
}

function getTempoMedioPdfDefaultFontSize(rowCount: number): number {
  return Math.max(4.2, Math.min(7.2, getTempoMedioPdfRowHeight(rowCount) * 1.05));
}

async function exportTempoMedioPdf(
  stats: TempoMedioRecebedorStats[],
  periodoLabel: string,
  now: Date,
  tableFontSize: number
): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 10;
  const marginTop = TEMPO_MEDIO_PDF_MARGIN_TOP_MM;
  const tableWidth = pageWidth - marginX * 2;
  let y = marginTop;

  const medidos = stats.filter((s) => s.processosMedidos > 0);
  const totalProcessos = medidos.reduce((sum, s) => sum + s.processosMedidos, 0);
  const totalMs = medidos.reduce(
    (sum, s) => sum + (s.mediaMs ?? 0) * s.processosMedidos,
    0
  );
  const mediaGeral = totalProcessos > 0 ? totalMs / totalProcessos : null;

  doc.setProperties({
    title: 'Tempo médio de conclusão por recebedor',
    subject: periodoLabel,
    creator: 'SIG - NURGE',
  });

  const columns = [
    { label: 'Recebedor', x: marginX, width: 138, align: 'left' },
    { label: 'Medidos', x: marginX + 138, width: 34, align: 'right' },
    { label: 'Média', x: marginX + 172, width: 35, align: 'right' },
    { label: 'Mais rápido', x: marginX + 207, width: 35, align: 'right' },
    { label: 'Mais lento', x: marginX + 242, width: 35, align: 'right' },
  ] as const;
  const headerHeight = TEMPO_MEDIO_PDF_HEADER_HEIGHT_MM;
  const tableHeaderHeight = TEMPO_MEDIO_PDF_TABLE_HEADER_HEIGHT_MM;
  const rowHeight = getTempoMedioPdfRowHeight(stats.length);
  const bodyFontSize = Math.max(
    TEMPO_MEDIO_PDF_FONT_MIN,
    Math.min(TEMPO_MEDIO_PDF_FONT_MAX, tableFontSize)
  );
  const headerFontSize = Math.max(5.8, Math.min(7, bodyFontSize));
  const rowTextOffset = Math.max(2.2, Math.min(4.35, rowHeight * 0.7));

  function textInColumn(
    text: string,
    column: (typeof columns)[number],
    textY: number,
    options?: { bold?: boolean; fontSize?: number }
  ) {
    doc.setFont('helvetica', options?.bold ? 'bold' : 'normal');
    doc.setFontSize(options?.fontSize ?? bodyFontSize);
    const x =
      column.align === 'right'
        ? column.x + column.width - 3
        : column.x + 3;
    doc.text(text, x, textY, {
      align: column.align === 'right' ? 'right' : 'left',
    });
  }

  function drawDocumentHeader() {
    doc.setTextColor(31, 41, 55);
    doc.setFillColor(196, 30, 58);
    doc.rect(marginX, y - 3, 1.5, 9, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('Tempo médio de conclusão por recebedor', marginX + 4, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(
      `Média geral: ${formatDurationMs(mediaGeral)}`,
      pageWidth - marginX,
      y,
      { align: 'right' }
    );
    y += headerHeight;
  }

  function drawTableHeader() {
    const headerY = y;
    doc.setFillColor(245, 245, 245);
    doc.rect(marginX, headerY, tableWidth, tableHeaderHeight, 'F');
    doc.setDrawColor(220, 220, 220);
    doc.rect(marginX, headerY, tableWidth, tableHeaderHeight);
    doc.setTextColor(75, 85, 99);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(headerFontSize);
    for (const col of columns) {
      textInColumn(col.label, col, headerY + 4.1, {
        bold: true,
        fontSize: headerFontSize,
      });
    }
    y = headerY + tableHeaderHeight;
  }

  drawDocumentHeader();
  drawTableHeader();
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(bodyFontSize);
  doc.setTextColor(31, 41, 55);

  stats.forEach((s, index) => {
    const rowY = y;
    if (index % 2 === 1) {
      doc.setFillColor(250, 250, 250);
      doc.rect(marginX, rowY, tableWidth, rowHeight, 'F');
    }

    doc.setTextColor(31, 41, 55);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(bodyFontSize);
    doc.text(
      truncatePdfText(doc, s.nome, columns[0].width - 6),
      columns[0].x + 3,
      rowY + rowTextOffset
    );
    textInColumn(
      formatInt(s.processosMedidos),
      columns[1],
      rowY + rowTextOffset
    );
    textInColumn(
      formatDurationMs(s.mediaMs),
      columns[2],
      rowY + rowTextOffset,
      { bold: true }
    );
    textInColumn(
      formatDurationMs(s.menorMs),
      columns[3],
      rowY + rowTextOffset
    );
    textInColumn(
      formatDurationMs(s.maiorMs),
      columns[4],
      rowY + rowTextOffset
    );

    y += rowHeight;
    doc.setDrawColor(235, 235, 235);
    doc.line(marginX, y, pageWidth - marginX, y);
  });

  if (stats.length === 0) {
    doc.setTextColor(75, 85, 99);
    doc.text('Sem recebedores ativos no período.', marginX + 3, y + 6);
  }

  doc.save(`tempo-medio-recebedores-${formatDateBr(now, 'yyyy-MM-dd')}.pdf`);
}

function truncatePdfText(
  doc: { getTextWidth: (text: string) => number },
  text: string,
  maxWidth: number
): string {
  if (doc.getTextWidth(text) <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && doc.getTextWidth(`${out}...`) > maxWidth) {
    out = out.slice(0, -1).trimEnd();
  }
  return `${out}...`;
}

function pct(part: number, total: number): string {
  if (total === 0) return '0';
  return ((part / total) * 100).toFixed(0);
}

function todayIso(d: Date): string {
  return localIso(d);
}

/**
 * Lista de dias ISO ("YYYY-MM-DD", ascendente) do período selecionado, sem
 * passar de hoje — usada pelo painel de pendentes às 6h. Limitada a 92 dias
 * para não explodir o número de colunas em períodos custom muito longos.
 */
function diasDoPeriodo(
  modo: PeriodoMode,
  now: Date,
  customStart: string,
  customEnd: string
): string[] {
  const hoje = localIso(now);
  let startIso: string;
  if (modo === 'hoje') {
    startIso = hoje;
  } else if (modo === 'semana') {
    // Segunda-feira da semana atual.
    const dow = now.getDay(); // 0=Dom..6=Sáb
    const back = dow === 0 ? 6 : dow - 1;
    const seg = new Date(now);
    seg.setDate(seg.getDate() - back);
    startIso = localIso(seg);
  } else if (modo === 'mes') {
    startIso = firstOfMonthIso(now);
  } else {
    startIso = customStart || hoje;
  }

  let endIso = modo === 'custom' ? customEnd || hoje : hoje;
  if (endIso > hoje) endIso = hoje; // nunca mostra dias futuros
  if (startIso > endIso) return [];

  const dias: string[] = [];
  let cursor = startIso;
  // Cap defensivo de 92 dias.
  for (let i = 0; i < 92 && cursor <= endIso; i += 1) {
    dias.push(cursor);
    cursor = addIsoDays(cursor, 1);
  }
  return dias;
}

function firstOfMonthIso(d: Date): string {
  const out = new Date(d);
  out.setDate(1);
  return localIso(out);
}

function mesAtualIso(now: Date): PeriodoIso {
  const start = new Date(now);
  start.setDate(1);
  start.setHours(0, 0, 0, 0);

  // First day of next month — exclusive end matches getProcessosByPeriodo's
  // half-open range semantics.
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);

  return { start: localIso(start), end: localIso(end) };
}

function localIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addIsoDays(iso: string, days: number): string {
  if (!iso) return '';
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return localIso(date);
}

function isValidPeriodo(p: PeriodoIso): boolean {
  return Boolean(p.start) && Boolean(p.end) && p.start < p.end;
}

function mergeProcessosPeriodoComAbertos(
  processosPeriodo: Processo[],
  processosAbertos: Processo[],
  modo: PeriodoMode,
  hojeIso: string
): Processo[] {
  if (modo === 'custom') return processosPeriodo;

  // No modo "hoje" o período carregado é a semana inteira (realtime); aqui
  // narrowamos para os atribuídos hoje antes de unir os abertos.
  const base =
    modo === 'hoje'
      ? processosPeriodo.filter(
          (p) => localIso(p.diaAtribuicao.toDate()) === hojeIso
        )
      : processosPeriodo;

  const byId = new Map<string, Processo>();
  for (const processo of base) byId.set(processo.id, processo);
  for (const processo of processosAbertos) byId.set(processo.id, processo);
  return Array.from(byId.values());
}

function buildPeriodoLabel(
  modo: PeriodoMode,
  now: Date,
  customStart: string,
  customEnd: string
): string {
  if (modo === 'hoje') {
    return `Hoje, ${formatDateBr(now, 'dd/MM/yyyy')}`;
  }
  if (modo === 'semana') {
    const semanaIso = getSemanaIso(now);
    return `Semana ${semanaIso}`;
  }
  if (modo === 'mes') {
    return `Mês de ${formatDateBr(now, "MMMM 'de' yyyy")}`;
  }
  if (!customStart || !customEnd) return 'Período personalizado';
  // Render as DD/MM/YYYY for readability.
  return `${formatDateLikely(customStart)} – ${formatDateLikely(customEnd)}`;
}

function formatDateLikely(iso: string): string {
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}
