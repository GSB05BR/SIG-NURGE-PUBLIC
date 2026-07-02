import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Database,
  FileText,
  Layers3,
  Loader2,
  RotateCcw,
  ShieldAlert,
  UserRoundCheck,
  UsersRound,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatDateBr, nowInSp } from '@/lib/datetime';
import {
  getResponsavelSeiLabel,
  getUltimoResponsavelNurge,
} from '@/lib/processo-helpers';
import { usePageTitle } from '@/lib/usePageTitle';
import { subscribeProcessosNaoAtribuidos } from '@/services/firebase/processos';
import { ErrorState } from '@/components/ErrorState';
import type { Processo } from '@/types';

type ChartDatum = {
  name: string;
  value: number;
  pct?: number;
};

type ProcessoRisco = {
  id: string;
  numero: string;
  origem: string;
  regime: string;
  primeiraEntrada: string;
  ultimaChegada: string;
  ultimoRetorno: string;
  diasDesdePrimeiraEntrada: number | null;
  diasUltimaChegada: number | null;
  ciclos: number;
  atual: string;
};

interface EstatisticasFilaData {
  total: number;
  aberto: number;
  fechado: number;
  urgentes: number;
  prioridades: number;
  origensDistintas: number;
  unidadesDistintas: number;
  responsaveisOriginais: number;
  responsaveisAtuais: number;
  importacoes: number;
  eventosTotal: number;
  historicoMedio: number;
  historicoMaximo: number;
  mediaDiasPrimeiraEntrada: number;
  medianaDiasPrimeiraEntrada: number;
  maxDiasPrimeiraEntrada: number;
  mediaDiasUltimaChegada: number;
  medianaDiasUltimaChegada: number;
  maxDiasUltimaChegada: number;
  semUltimaChegadaNurge: number;
  comRetornoNurge: number;
  mediaDiasNoBanco: number;
  mediaCiclos: number;
  maxCiclos: number;
  mediaEntradaRetorno: number | null;
  mediaDevolucaoRetorno: number | null;
  semPrimeiraEntrada: number;
  semDevolucaoOrigem: number;
  semRetornoNurge: number;
  semResponsavelOriginal: number;
  semResponsavelAtual: number;
  semHistoricoSei: number;
  semLinkSei: number;
  regimeData: ChartDatum[];
  origemSistemaData: ChartDatum[];
  idadeData: ChartDatum[];
  ultimaChegadaData: ChartDatum[];
  ciclosData: ChartDatum[];
  entradaMensalData: ChartDatum[];
  retornoMensalData: ChartDatum[];
  ultimaChegadaMensalData: ChartDatum[];
  topOrigensPorEspera: ChartDatum[];
  topResponsaveisAtuaisPorEspera: ChartDatum[];
  topOrigens: ChartDatum[];
  topUnidades: ChartDatum[];
  topResponsaveisAtuais: ChartDatum[];
  topResponsaveisOriginais: ChartDatum[];
  topImportacoes: ChartDatum[];
  processosRisco: ProcessoRisco[];
}

const CHART_COLORS = [
  '#C41E3A',
  '#1565C0',
  '#2E7D32',
  '#F57F17',
  '#6A1B9A',
  '#0F766E',
  '#9B1830',
  '#616161',
] as const;

const ORIGEM_LABEL: Record<Processo['origem'], string> = {
  sei_json: 'SEI JSON',
  csv: 'Legado',
  manual: 'Manual',
};

const IDADE_BUCKETS = [
  { name: '0-7 dias', min: 0, max: 7 },
  { name: '8-14 dias', min: 8, max: 14 },
  { name: '15-30 dias', min: 15, max: 30 },
  { name: '31-60 dias', min: 31, max: 60 },
  { name: '61-120 dias', min: 61, max: 120 },
  { name: '+120 dias', min: 121, max: Number.POSITIVE_INFINITY },
] as const;

const CICLO_BUCKETS = [
  { name: '0 ciclos', min: 0, max: 0 },
  { name: '1 ciclo', min: 1, max: 1 },
  { name: '2 ciclos', min: 2, max: 2 },
  { name: '3 ciclos', min: 3, max: 3 },
  { name: '4+ ciclos', min: 4, max: Number.POSITIVE_INFINITY },
] as const;

export default function EstatisticasFila() {
  usePageTitle('Estatísticas da fila');

  const [now, setNow] = useState<Date>(() => nowInSp());
  const [processos, setProcessos] = useState<Processo[] | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [loadRetryKey, setLoadRetryKey] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setNow(nowInSp()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    setLoadError(null);
    const unsubscribe = subscribeProcessosNaoAtribuidos(setProcessos, (err) =>
      setLoadError(err)
    );
    return () => unsubscribe();
  }, [loadRetryKey]);

  const stats = useMemo(
    () => calcularEstatisticasFila(processos ?? [], now),
    [processos, now]
  );

  const loading = processos === null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink-primary">
            Estatísticas da fila
          </h1>
          <p className="mt-1 text-sm text-ink-secondary">
            Leituras operacionais dos processos importados que ainda não foram
            atribuídos.
          </p>
        </div>
        <div className="inline-flex w-fit items-center gap-2 rounded-md border border-gray-200 bg-surface px-3 py-2 text-sm font-semibold text-ink-primary shadow-sm">
          <Database className="h-4 w-4 text-brand-primary" />
          {loading ? 'Carregando fila...' : `${stats.total} processos na fila`}
        </div>
      </div>

      {loadError ? (
        <ErrorState
          message="Falha ao carregar a fila. Verifique sua conexão e tente novamente."
          onRetry={() => setLoadRetryKey((k) => k + 1)}
        />
      ) : loading ? (
        <div className="flex min-h-[360px] items-center justify-center rounded-lg border border-gray-200 bg-surface text-brand-primary shadow-sm">
          <Loader2 className="h-7 w-7 animate-spin" aria-label="Carregando" />
        </div>
      ) : (
        <>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Total na fila"
              value={stats.total}
              detail={`${stats.origensDistintas} origens distintas`}
              icon={Database}
              tone="brand"
            />
            <MetricCard
              label="Regime aberto"
              value={stats.aberto}
              detail={`${formatPct(stats.aberto, stats.total)} da fila`}
              icon={FileText}
              tone="info"
            />
            <MetricCard
              label="Regime fechado"
              value={stats.fechado}
              detail={`${formatPct(stats.fechado, stats.total)} da fila`}
              icon={ShieldAlert}
              tone="danger"
            />
            <MetricCard
              label="Eventos SEI salvos"
              value={stats.eventosTotal}
              detail={`${formatNumber(stats.historicoMedio)} por processo em média`}
              icon={BarChart3}
              tone="purple"
            />
            <MetricCard
              label="Espera média atual"
              value={`${formatNumber(stats.mediaDiasUltimaChegada)} dias`}
              detail={`Mediana ${formatNumber(stats.medianaDiasUltimaChegada)} dias`}
              icon={Clock3}
              tone="warning"
            />
            <MetricCard
              label="Maior espera atual"
              value={`${stats.maxDiasUltimaChegada} dias`}
              detail="Desde a última chegada ao NURGE"
              icon={CalendarClock}
              tone="danger"
            />
            <MetricCard
              label="Chegadas com retorno"
              value={stats.comRetornoNurge}
              detail={`${formatPct(stats.comRetornoNurge, stats.total)} já voltaram ao NURGE`}
              icon={RotateCcw}
              tone="info"
            />
            <MetricCard
              label="Desde 1ª entrada"
              value={`${formatNumber(stats.mediaDiasPrimeiraEntrada)} dias`}
              detail={`Mediana ${formatNumber(stats.medianaDiasPrimeiraEntrada)} dias`}
              icon={Clock3}
              tone="neutral"
            />
            <MetricCard
              label="Maior espera SEI"
              value={`${stats.maxDiasPrimeiraEntrada} dias`}
              detail="Desde a 1ª entrada no NURGE"
              icon={CalendarClock}
              tone="danger"
            />
            <MetricCard
              label="Média no banco"
              value={`${formatNumber(stats.mediaDiasNoBanco)} dias`}
              detail="Desde a importação como não atribuído"
              icon={Database}
              tone="neutral"
            />
            <MetricCard
              label="Ciclos NURGE"
              value={formatNumber(stats.mediaCiclos)}
              detail={`Máximo encontrado: ${stats.maxCiclos}`}
              icon={Layers3}
              tone="success"
            />
          </section>

          <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <Panel title="Composição da fila" icon={BarChart3}>
              <div className="grid gap-4 lg:grid-cols-2">
                <ChartBlock title="Regime">
                  <DonutChart data={stats.regimeData} />
                </ChartBlock>
                <ChartBlock title="Origem do cadastro">
                  <DonutChart data={stats.origemSistemaData} />
                </ChartBlock>
              </div>
            </Panel>

            <Panel title="Tempo e ciclos" icon={Clock3}>
              <div className="grid gap-4 lg:grid-cols-2">
                <ChartBlock title="Idade desde a 1ª entrada no NURGE">
                  <HorizontalBarChart data={stats.idadeData} />
                </ChartBlock>
                <ChartBlock title="Espera desde a última chegada ao NURGE">
                  <HorizontalBarChart data={stats.ultimaChegadaData} />
                </ChartBlock>
                <ChartBlock title="Quantidade de ciclos NURGE">
                  <HorizontalBarChart data={stats.ciclosData} />
                </ChartBlock>
              </div>
            </Panel>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <Panel title="Entradas no NURGE por mês" icon={CalendarClock}>
              <VerticalBarChart data={stats.entradaMensalData} />
            </Panel>
            <Panel title="Retornos ao NURGE por mês" icon={RotateCcw}>
              <VerticalBarChart data={stats.retornoMensalData} />
            </Panel>
            <Panel title="Últimas chegadas conhecidas por mês" icon={Clock3}>
              <VerticalBarChart data={stats.ultimaChegadaMensalData} />
            </Panel>
          </section>

          <section className="grid gap-4 xl:grid-cols-4">
            <RankingPanel title="Top origens" items={stats.topOrigens} />
            <RankingPanel title="Top unidades origem" items={stats.topUnidades} />
            <RankingPanel
              title="Último responsável NURGE"
              items={stats.topResponsaveisAtuais}
            />
            <RankingPanel
              title="Chegou originalmente para"
              items={stats.topResponsaveisOriginais}
            />
            <RankingPanel
              title="Origens por espera média (dias)"
              items={stats.topOrigensPorEspera}
            />
            <RankingPanel
              title="Atuais por espera média (dias)"
              items={stats.topResponsaveisAtuaisPorEspera}
            />
          </section>

          <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <Panel title="Processos que puxam a fila" icon={AlertTriangle}>
              <ProcessosRiscoTable processos={stats.processosRisco} />
            </Panel>

            <div className="space-y-4">
              <Panel title="Integridade dos dados SEI" icon={CheckCircle2}>
                <QualityList
                  items={[
                    ['Sem 1ª entrada NURGE', stats.semPrimeiraEntrada],
                    ['Sem devolução à origem', stats.semDevolucaoOrigem, 'good'],
                    ['Sem retorno ao NURGE', stats.semRetornoNurge],
                    ['Sem responsável original', stats.semResponsavelOriginal],
                    ['Sem responsável atual', stats.semResponsavelAtual],
                    ['Sem histórico SEI salvo', stats.semHistoricoSei],
                    ['Sem link para o SEI', stats.semLinkSei],
                  ]}
                  total={stats.total}
                />
              </Panel>

              <Panel title="Outras leituras" icon={UsersRound}>
                <div className="grid gap-2 text-sm">
                  <InfoRow label="Unidades distintas" value={stats.unidadesDistintas} />
                  <InfoRow
                    label="Responsáveis originais"
                    value={stats.responsaveisOriginais}
                  />
                  <InfoRow
                    label="Responsáveis atuais"
                    value={stats.responsaveisAtuais}
                  />
                  <InfoRow label="Importações distintas" value={stats.importacoes} />
                  <InfoRow label="Urgentes marcados" value={stats.urgentes} />
                  <InfoRow label="Prioridades marcadas" value={stats.prioridades} />
                  <InfoRow
                    label="Maior histórico individual"
                    value={`${stats.historicoMaximo} eventos`}
                  />
                  <InfoRow
                    label="Média 1ª entrada → retorno"
                    value={formatNullableDays(stats.mediaEntradaRetorno)}
                  />
                  <InfoRow
                    label="Média devolução → retorno"
                    value={formatNullableDays(stats.mediaDevolucaoRetorno)}
                  />
                  <InfoRow
                    label="Sem chegada conhecida"
                    value={stats.semUltimaChegadaNurge}
                  />
                </div>
              </Panel>

              <RankingPanel
                title="Importações com maior volume"
                items={stats.topImportacoes}
              />
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function calcularEstatisticasFila(
  processos: Processo[],
  now: Date
): EstatisticasFilaData {
  const total = processos.length;
  const aberto = processos.filter((p) => p.regime === 'aberto').length;
  const fechado = total - aberto;
  const urgentes = processos.filter((p) => p.urgente).length;
  const prioridades = processos.filter((p) => p.prioridade).length;

  const diasPrimeiraEntrada: number[] = [];
  const diasUltimaChegada: number[] = [];
  const diasNoBanco: number[] = [];
  const ciclos: number[] = [];
  const entradaRetornoDias: number[] = [];
  const devolucaoRetornoDias: number[] = [];
  const historyCounts: number[] = [];

  let semPrimeiraEntrada = 0;
  let semUltimaChegadaNurge = 0;
  let semDevolucaoOrigem = 0;
  let semRetornoNurge = 0;
  let comRetornoNurge = 0;
  let semResponsavelOriginal = 0;
  let semResponsavelAtual = 0;
  let semHistoricoSei = 0;
  let semLinkSei = 0;

  for (const p of processos) {
    const primeiraEntrada = dateFromTimestamp(p.primeiraEntradaNurgeEm);
    const devolucao = dateFromTimestamp(p.primeiraDevolucaoOrigemEm);
    const retorno = dateFromTimestamp(p.ultimoRetornoNurgeEm);
    const ultimaChegada = getUltimaChegadaNurge(p);
    const createdAt = dateFromTimestamp(p.createdAt);
    const ciclosCount = p.ciclosNurge?.length ?? 0;
    // Docs novos (item 7) não trazem o histórico inline; usa historyCount nesse
    // caso. `?? ` não basta porque [].length é 0 (não-nulo) e mascararia o count.
    const historicoCount =
      p.historicoSei && p.historicoSei.length > 0
        ? p.historicoSei.length
        : p.historyCount ?? 0;

    if (primeiraEntrada) diasPrimeiraEntrada.push(diffDays(primeiraEntrada, now));
    else semPrimeiraEntrada += 1;

    if (ultimaChegada) diasUltimaChegada.push(diffDays(ultimaChegada, now));
    else semUltimaChegadaNurge += 1;

    if (createdAt) diasNoBanco.push(diffDays(createdAt, now));
    if (devolucao && retorno) devolucaoRetornoDias.push(diffDays(devolucao, retorno));
    if (primeiraEntrada && retorno) {
      entradaRetornoDias.push(diffDays(primeiraEntrada, retorno));
    }

    if (!devolucao) semDevolucaoOrigem += 1;
    if (retorno) comRetornoNurge += 1;
    else semRetornoNurge += 1;
    if (!p.primeiroResponsavelNurge) semResponsavelOriginal += 1;
    if (!getUltimoResponsavelNurge(p)) semResponsavelAtual += 1;
    if (historicoCount === 0) semHistoricoSei += 1;
    if (!p.seiUrl && !p.seiHistoricoUrl) semLinkSei += 1;

    ciclos.push(ciclosCount);
    historyCounts.push(historicoCount);
  }

  const topOrigens = topBy(processos, (p) => p.agrupadorNome || 'Sem origem');
  const topUnidades = topBy(
    processos,
    (p) => p.unidadeOrigem?.sigla || p.unidadeOrigem?.nome || 'Sem unidade'
  );
  const topResponsaveisAtuais = topBy(processos, (p) =>
    normalizeEmpty(getResponsavelSeiLabel(getUltimoResponsavelNurge(p)), 'Sem responsável')
  );
  const topResponsaveisOriginais = topBy(processos, (p) =>
    normalizeEmpty(
      getResponsavelSeiLabel(p.primeiroResponsavelNurge),
      'Sem responsável'
    )
  );
  const topImportacoes = topBy(
    processos,
    (p) => p.importacaoId || 'Sem importação vinculada',
    8
  );
  const topOrigensPorEspera = topAverageBy(
    processos,
    (p) => p.agrupadorNome || 'Sem origem',
    (p) => {
      const ultimaChegada = getUltimaChegadaNurge(p);
      return ultimaChegada ? diffDays(ultimaChegada, now) : null;
    },
    8
  );
  const topResponsaveisAtuaisPorEspera = topAverageBy(
    processos,
    (p) =>
      normalizeEmpty(
        getResponsavelSeiLabel(getUltimoResponsavelNurge(p)),
        'Sem responsável'
      ),
    (p) => {
      const ultimaChegada = getUltimaChegadaNurge(p);
      return ultimaChegada ? diffDays(ultimaChegada, now) : null;
    },
    8
  );

  return {
    total,
    aberto,
    fechado,
    urgentes,
    prioridades,
    origensDistintas: distinctCount(processos, (p) => p.agrupadorNome),
    unidadesDistintas: distinctCount(
      processos,
      (p) => p.unidadeOrigem?.sigla || p.unidadeOrigem?.nome
    ),
    responsaveisOriginais: distinctCount(
      processos,
      (p) => p.primeiroResponsavelNurge?.nome || p.primeiroResponsavelNurge?.login
    ),
    responsaveisAtuais: distinctCount(processos, (p) => {
      const r = getUltimoResponsavelNurge(p);
      return r?.nome || r?.login;
    }),
    importacoes: distinctCount(processos, (p) => p.importacaoId),
    eventosTotal: sum(historyCounts),
    historicoMedio: avg(historyCounts),
    historicoMaximo: max(historyCounts),
    mediaDiasPrimeiraEntrada: avg(diasPrimeiraEntrada),
    medianaDiasPrimeiraEntrada: median(diasPrimeiraEntrada),
    maxDiasPrimeiraEntrada: max(diasPrimeiraEntrada),
    mediaDiasUltimaChegada: avg(diasUltimaChegada),
    medianaDiasUltimaChegada: median(diasUltimaChegada),
    maxDiasUltimaChegada: max(diasUltimaChegada),
    semUltimaChegadaNurge,
    comRetornoNurge,
    mediaDiasNoBanco: avg(diasNoBanco),
    mediaCiclos: avg(ciclos),
    maxCiclos: max(ciclos),
    mediaEntradaRetorno: nullableAvg(entradaRetornoDias),
    mediaDevolucaoRetorno: nullableAvg(devolucaoRetornoDias),
    semPrimeiraEntrada,
    semDevolucaoOrigem,
    semRetornoNurge,
    semResponsavelOriginal,
    semResponsavelAtual,
    semHistoricoSei,
    semLinkSei,
    regimeData: withPct([
      { name: 'Aberto', value: aberto },
      { name: 'Fechado', value: fechado },
    ]),
    origemSistemaData: withPct(
      topBy(processos, (p) => ORIGEM_LABEL[p.origem] ?? p.origem, 6)
    ),
    idadeData: bucketData(diasPrimeiraEntrada, IDADE_BUCKETS, semPrimeiraEntrada),
    ultimaChegadaData: bucketData(
      diasUltimaChegada,
      IDADE_BUCKETS,
      semUltimaChegadaNurge
    ),
    ciclosData: bucketData(ciclos, CICLO_BUCKETS, 0),
    entradaMensalData: seriesByMonth(processos, (p) =>
      dateFromTimestamp(p.primeiraEntradaNurgeEm)
    ),
    retornoMensalData: seriesByMonth(processos, (p) =>
      dateFromTimestamp(p.ultimoRetornoNurgeEm)
    ),
    ultimaChegadaMensalData: seriesByMonth(processos, getUltimaChegadaNurge),
    topOrigensPorEspera,
    topResponsaveisAtuaisPorEspera,
    topOrigens,
    topUnidades,
    topResponsaveisAtuais,
    topResponsaveisOriginais,
    topImportacoes,
    processosRisco: processos
      .map((p) => toProcessoRisco(p, now))
      .sort((a, b) => (b.diasUltimaChegada ?? -1) - (a.diasUltimaChegada ?? -1))
      .slice(0, 12),
  };
}

function toProcessoRisco(p: Processo, now: Date): ProcessoRisco {
  const primeiraEntrada = dateFromTimestamp(p.primeiraEntradaNurgeEm);
  const retorno = dateFromTimestamp(p.ultimoRetornoNurgeEm);
  const ultimaChegada = getUltimaChegadaNurge(p);

  return {
    id: p.id,
    numero: p.numero,
    origem: p.agrupadorNome || 'Sem origem',
    regime: p.regime === 'aberto' ? 'Aberto' : 'Fechado',
    primeiraEntrada: primeiraEntrada ? formatDateBr(primeiraEntrada, 'dd/MM/yyyy') : '—',
    ultimaChegada: ultimaChegada ? formatDateBr(ultimaChegada, 'dd/MM/yyyy') : '—',
    ultimoRetorno: retorno ? formatDateBr(retorno, 'dd/MM/yyyy') : '—',
    diasDesdePrimeiraEntrada: primeiraEntrada ? diffDays(primeiraEntrada, now) : null,
    diasUltimaChegada: ultimaChegada ? diffDays(ultimaChegada, now) : null,
    ciclos: p.ciclosNurge?.length ?? 0,
    atual: normalizeEmpty(
      getResponsavelSeiLabel(getUltimoResponsavelNurge(p)),
      'Sem responsável'
    ),
  };
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number | string;
  detail: string;
  icon: typeof Database;
  tone: 'brand' | 'success' | 'warning' | 'info' | 'danger' | 'purple' | 'neutral';
}) {
  const toneClass = {
    brand: 'bg-brand-bg text-brand-primary ring-brand-primary/20',
    success: 'bg-state-success-bg text-state-success ring-state-success-border',
    warning: 'bg-state-warning-bg text-state-warning ring-state-warning-border',
    info: 'bg-state-info-bg text-state-info ring-state-info-border',
    danger: 'bg-state-danger-bg text-state-danger ring-red-200',
    purple: 'bg-state-purple-bg text-state-purple ring-state-purple-border',
    neutral: 'bg-gray-100 text-ink-secondary ring-gray-200',
  }[tone];

  return (
    <div className="rounded-lg border border-gray-200 bg-surface p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            {label}
          </div>
          <div className="mt-2 text-2xl font-semibold text-ink-primary">
            {value}
          </div>
        </div>
        <div
          className={`inline-flex h-9 w-9 items-center justify-center rounded-md ring-1 ${toneClass}`}
        >
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-3 text-xs text-ink-secondary">{detail}</div>
    </div>
  );
}

function Panel({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Database;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-surface p-4 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <Icon className="h-4 w-4 text-brand-primary" />
        <h2 className="text-base font-semibold text-ink-primary">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function ChartBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 text-sm font-semibold text-ink-primary">{title}</div>
      {children}
    </div>
  );
}

function DonutChart({ data }: { data: ChartDatum[] }) {
  const filtered = data.filter((d) => d.value > 0);
  if (filtered.length === 0) return <EmptyChart />;

  return (
    <div className="h-60">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={filtered}
            dataKey="value"
            nameKey="name"
            innerRadius={54}
            outerRadius={82}
            paddingAngle={2}
          >
            {filtered.map((_, index) => (
              <Cell
                key={index}
                fill={CHART_COLORS[index % CHART_COLORS.length]}
              />
            ))}
          </Pie>
          <Tooltip formatter={(value) => [value, 'Processos']} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function HorizontalBarChart({ data }: { data: ChartDatum[] }) {
  if (data.every((d) => d.value === 0)) return <EmptyChart />;

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 6, right: 12 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" allowDecimals={false} />
          <YAxis type="category" dataKey="name" width={92} tick={{ fontSize: 12 }} />
          <Tooltip formatter={(value) => [value, 'Processos']} />
          <Bar dataKey="value" radius={[0, 6, 6, 0]} fill="#C41E3A" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function VerticalBarChart({ data }: { data: ChartDatum[] }) {
  if (data.length === 0 || data.every((d) => d.value === 0)) {
    return <EmptyChart />;
  }

  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: -10, right: 12, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 12 }} />
          <YAxis allowDecimals={false} />
          <Tooltip formatter={(value) => [value, 'Processos']} />
          <Bar dataKey="value" radius={[6, 6, 0, 0]} fill="#C41E3A" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-56 items-center justify-center rounded-md border border-dashed border-gray-200 bg-surface-elevated text-sm text-ink-secondary">
      Sem dados suficientes.
    </div>
  );
}

function RankingPanel({
  title,
  items,
}: {
  title: string;
  items: ChartDatum[];
}) {
  const maxValue = Math.max(...items.map((item) => item.value), 1);

  return (
    <section className="rounded-lg border border-gray-200 bg-surface p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <UserRoundCheck className="h-4 w-4 text-brand-primary" />
        <h2 className="text-base font-semibold text-ink-primary">{title}</h2>
      </div>
      {items.length === 0 ? (
        <p className="rounded-md border border-dashed border-gray-200 bg-surface-elevated px-3 py-6 text-center text-sm text-ink-secondary">
          Sem dados.
        </p>
      ) : (
        <div className="space-y-3">
          {items.slice(0, 8).map((item) => (
            <div key={item.name} className="space-y-1">
              <div className="flex items-start justify-between gap-3 text-sm">
                <span className="line-clamp-2 font-medium text-ink-primary">
                  {item.name}
                </span>
                <span className="shrink-0 font-semibold text-ink-primary">
                  {item.value}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                <div
                  className="h-full rounded-full bg-brand-primary"
                  style={{ width: `${Math.max(4, (item.value / maxValue) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ProcessosRiscoTable({ processos }: { processos: ProcessoRisco[] }) {
  if (processos.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-gray-200 bg-surface-elevated px-3 py-6 text-center text-sm text-ink-secondary">
        Nenhum processo na fila.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-gray-200">
      <table className="min-w-[1120px] divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-ink-secondary">
          <tr>
            <th className="px-3 py-2 font-semibold">Processo</th>
            <th className="px-3 py-2 font-semibold">Origem</th>
            <th className="px-3 py-2 font-semibold">Regime</th>
            <th className="px-3 py-2 font-semibold">1ª entrada</th>
            <th className="px-3 py-2 font-semibold">Última chegada</th>
            <th className="px-3 py-2 font-semibold">Voltou NURGE</th>
            <th className="px-3 py-2 font-semibold">Espera atual</th>
            <th className="px-3 py-2 font-semibold">Desde 1ª</th>
            <th className="px-3 py-2 font-semibold">Ciclos</th>
            <th className="px-3 py-2 font-semibold">Atual</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-surface">
          {processos.map((p) => (
            <tr key={p.id} className="align-top hover:bg-surface-elevated">
              <td className="whitespace-nowrap px-3 py-2 font-mono text-xs font-semibold text-ink-primary">
                {p.numero}
              </td>
              <td className="max-w-[220px] px-3 py-2 text-ink-primary">
                {p.origem}
              </td>
              <td className="px-3 py-2 text-ink-secondary">{p.regime}</td>
              <td className="whitespace-nowrap px-3 py-2 text-ink-secondary">
                {p.primeiraEntrada}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-ink-secondary">
                {p.ultimaChegada}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-ink-secondary">
                {p.ultimoRetorno}
              </td>
              <td className="px-3 py-2 font-semibold text-ink-primary">
                {p.diasUltimaChegada === null ? '—' : p.diasUltimaChegada}
              </td>
              <td className="px-3 py-2 text-ink-secondary">
                {p.diasDesdePrimeiraEntrada === null
                  ? '—'
                  : p.diasDesdePrimeiraEntrada}
              </td>
              <td className="px-3 py-2 text-ink-secondary">{p.ciclos}</td>
              <td className="max-w-[200px] px-3 py-2 text-ink-primary">{p.atual}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QualityList({
  items,
  total,
}: {
  items: Array<[string, number, ('good' | 'warn')?]>;
  total: number;
}) {
  return (
    <div className="space-y-2">
      {items.map(([label, value, tone]) => {
        const isGood = tone === 'good' || value === 0;
        return (
          <div
            key={label}
            className="flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-surface-elevated px-3 py-2 text-sm"
          >
            <span className="text-ink-primary">{label}</span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                isGood
                  ? 'bg-state-success-bg text-state-success'
                  : 'bg-state-warning-bg text-state-warning'
              }`}
            >
              {value} · {formatPct(value, total)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-surface-elevated px-3 py-2">
      <span className="text-ink-secondary">{label}</span>
      <span className="font-semibold text-ink-primary">{value}</span>
    </div>
  );
}

function topBy(
  processos: Processo[],
  selector: (processo: Processo) => string | null | undefined,
  limit = 10
): ChartDatum[] {
  const map = new Map<string, number>();
  for (const p of processos) {
    const key = normalizeEmpty(selector(p), 'Não informado');
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => {
      if (a.value !== b.value) return b.value - a.value;
      return a.name.localeCompare(b.name, 'pt-BR');
    })
    .slice(0, limit);
}

function topAverageBy(
  processos: Processo[],
  selector: (processo: Processo) => string | null | undefined,
  valueSelector: (processo: Processo) => number | null,
  limit = 10
): ChartDatum[] {
  const map = new Map<string, { total: number; count: number }>();
  for (const p of processos) {
    const value = valueSelector(p);
    if (value === null) continue;
    const key = normalizeEmpty(selector(p), 'Não informado');
    const current = map.get(key) ?? { total: 0, count: 0 };
    current.total += value;
    current.count += 1;
    map.set(key, current);
  }
  return Array.from(map.entries())
    .map(([name, item]) => ({
      name,
      value: Math.round(item.total / item.count),
    }))
    .sort((a, b) => {
      if (a.value !== b.value) return b.value - a.value;
      return a.name.localeCompare(b.name, 'pt-BR');
    })
    .slice(0, limit);
}

function seriesByMonth(
  processos: Processo[],
  selector: (processo: Processo) => Date | null
): ChartDatum[] {
  const map = new Map<string, { label: string; value: number }>();
  for (const p of processos) {
    const date = selector(p);
    if (!date) continue;
    const key = formatDateBr(date, 'yyyy-MM');
    const label = formatDateBr(date, 'MM/yy');
    const current = map.get(key) ?? { label, value: 0 };
    current.value += 1;
    map.set(key, current);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([, item]) => ({ name: item.label, value: item.value }));
}

function bucketData(
  values: number[],
  buckets: readonly { name: string; min: number; max: number }[],
  missingCount: number
): ChartDatum[] {
  const data = buckets.map((bucket) => ({
    name: bucket.name,
    value: values.filter((value) => value >= bucket.min && value <= bucket.max)
      .length,
  }));
  if (missingCount > 0) data.push({ name: 'Sem data', value: missingCount });
  return data;
}

function withPct(data: ChartDatum[]): ChartDatum[] {
  const total = sum(data.map((item) => item.value));
  return data.map((item) => ({
    ...item,
    pct: total > 0 ? (item.value / total) * 100 : 0,
  }));
}

function distinctCount<T>(
  list: T[],
  selector: (item: T) => string | null | undefined
): number {
  const set = new Set<string>();
  for (const item of list) {
    const value = selector(item)?.trim();
    if (value) set.add(value);
  }
  return set.size;
}

function dateFromTimestamp(
  timestamp: Pick<Processo['createdAt'], 'toDate'> | null | undefined
): Date | null {
  if (!timestamp) return null;
  try {
    return timestamp.toDate();
  } catch {
    return null;
  }
}

function getUltimaChegadaNurge(processo: Processo): Date | null {
  return (
    dateFromTimestamp(processo.ultimoRetornoNurgeEm) ??
    dateFromTimestamp(processo.primeiraEntradaNurgeEm)
  );
}

function diffDays(start: Date, end: Date): number {
  const startDate = new Date(start);
  const endDate = new Date(end);
  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(0, 0, 0, 0);
  return Math.max(
    0,
    Math.floor((endDate.getTime() - startDate.getTime()) / 86_400_000)
  );
}

function sum(values: number[]): number {
  return values.reduce((acc, value) => acc + value, 0);
}

function avg(values: number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

function nullableAvg(values: number[]): number | null {
  return values.length === 0 ? null : avg(values);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function max(values: number[]): number {
  return values.length === 0 ? 0 : Math.max(...values);
}

function normalizeEmpty(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed !== '—' ? trimmed : fallback;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    maximumFractionDigits: value < 10 ? 1 : 0,
  }).format(value);
}

function formatPct(value: number, total: number): string {
  if (total <= 0) return '0%';
  return `${Math.round((value / total) * 100)}%`;
}

function formatNullableDays(value: number | null): string {
  return value === null ? '—' : `${formatNumber(value)} dias`;
}
