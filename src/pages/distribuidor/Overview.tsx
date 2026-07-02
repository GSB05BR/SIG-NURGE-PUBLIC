import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Clock,
  Flame,
  History as HistoryIcon,
  PlayCircle,
  Plus,
  Star,
  Upload,
  UserCheck,
} from 'lucide-react';
import { useAuth } from '@/store/authStore';
import {
  useProcessosAbertos,
  useProcessosAbertosError,
  useProcessosSemana,
  useProcessosSemanaError,
  retryAbertos,
  retrySemana,
} from '@/store/processosStore';
import { ErrorState } from '@/components/ErrorState';
import { subscribeAllUsers } from '@/services/firebase/users';
import { subscribeHistorico } from '@/services/firebase/historico';
import {
  calcularKPIs,
  calcularPorRecebedor,
  calcularEmAbertoPorRecebedor,
  calcularAlertas,
  LIMITE_ATRASADOS,
} from '@/lib/produtividade';
import type { EmAbertoPorRecebedor } from '@/lib/produtividade';
import {
  HISTORICO_TIPO_LABELS,
  getHistoricoTipoCor,
  resumirPayload,
} from '@/lib/historico-helpers';
import {
  formatDateBr,
  getSemanaIso,
  nowInSp,
} from '@/lib/datetime';
import { isAtrasado } from '@/lib/processo-helpers';
import { usePageTitle } from '@/lib/usePageTitle';
import type { HistoricoEntry, Processo, User } from '@/types';
import type { DiaSemana } from '@/types';

type PendenciasSemanaMode = 'passada' | 'atual' | 'proxima';

const DIAS_SEMANA: DiaSemana[] = [
  'segunda',
  'terca',
  'quarta',
  'quinta',
  'sexta',
];

const DIA_LABEL_SHORT: Record<DiaSemana, string> = {
  segunda: 'Seg',
  terca: 'Ter',
  quarta: 'Qua',
  quinta: 'Qui',
  sexta: 'Sex',
};

// Linha do painel "Pendências por recebedor": carga em aberto do recebedor na
// semana, total + quebra por dia. Reusa o tipo da função pura em produtividade.
type PendenciaRecebedor = EmAbertoPorRecebedor;

export default function Overview() {
  usePageTitle('Visão Geral');
  const { userDoc, firebaseUser } = useAuth();
  const [now, setNow] = useState<Date>(() => nowInSp());
  useEffect(() => {
    const id = window.setInterval(() => setNow(nowInSp()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const semanaIso = useMemo(() => getSemanaIso(now), [now]);
  const semanaPassadaIso = useMemo(
    () => getSemanaIso(new Date(now.getTime() - 7 * 86_400_000)),
    [now]
  );
  const proximaSemanaIso = useMemo(
    () => getSemanaIso(new Date(now.getTime() + 7 * 86_400_000)),
    [now]
  );
  const [pendenciasSemanaMode, setPendenciasSemanaMode] =
    useState<PendenciasSemanaMode>('atual');
  const pendenciasSemanaIso =
    pendenciasSemanaMode === 'passada'
      ? semanaPassadaIso
      : pendenciasSemanaMode === 'atual'
        ? semanaIso
        : proximaSemanaIso;

  // Listeners compartilhados (store global): semana atual e abertos viram uma
  // única assinatura por query, reaproveitada entre páginas e navegações.
  const processos = useProcessosSemana(semanaIso);
  const processosAbertos = useProcessosAbertos();
  const processosPendencias = useProcessosSemana(pendenciasSemanaIso);
  const abertosError = useProcessosAbertosError();
  const semanaError = useProcessosSemanaError(semanaIso);
  const [users, setUsers] = useState<User[] | null>(null);
  const [usersError, setUsersError] = useState<Error | null>(null);
  const [usersRetryKey, setUsersRetryKey] = useState(0);
  const [recentes, setRecentes] = useState<HistoricoEntry[] | null>(null);

  useEffect(() => {
    setUsersError(null);
    const unsubU = subscribeAllUsers(
      (list) => {
        setUsers(list);
        setUsersError(null);
      },
      (err) => setUsersError(err)
    );
    const unsubH = subscribeHistorico({ limit: 5 }, (list) =>
      setRecentes(list)
    );
    return () => {
      unsubU();
      unsubH();
    };
  }, [usersRetryKey]);

  // Fontes de erro = exatamente os listeners cujo `null` trava o loading desta
  // página (semana atual + abertos + users). Pendências de outra semana NÃO
  // entram: se falharem, o painel fica degradado, mas a página não some.
  const erroCarregamento = abertosError ?? semanaError ?? usersError;

  const processosOperacionais = useMemo(() => {
    if (processos === null || processosAbertos === null) return null;
    const byId = new Map<string, Processo>();
    for (const processo of processos) byId.set(processo.id, processo);
    for (const processo of processosAbertos) byId.set(processo.id, processo);
    return Array.from(byId.values());
  }, [processos, processosAbertos]);

  const isLoading =
    processos === null || processosAbertos === null || users === null;

  const displayName =
    userDoc?.displayName ?? firebaseUser?.displayName ?? 'Usuário';
  const firstName = displayName.trim().split(/\s+/)[0] ?? displayName;

  const kpis = useMemo(
    () =>
      processosOperacionais ? calcularKPIs(processosOperacionais, now) : null,
    [processosOperacionais, now]
  );

  const concluidosHoje = useMemo(() => {
    if (!processos) return 0;
    const hojeIso = formatLocalIso(now);
    let n = 0;
    for (const p of processos) {
      if (p.status !== 'concluido' || !p.concluidoEm) continue;
      const iso = formatLocalIso(p.concluidoEm.toDate());
      if (iso === hojeIso) n += 1;
    }
    return n;
  }, [processos, now]);

  const recebedorStats = useMemo(() => {
    if (!processosOperacionais || !users) return [];
    // Visão "hoje": cohort = atribuídos hoje + backlog ainda em aberto (os
    // abertos de qualquer data já entram em processosOperacionais). Alimenta os
    // alertas de muitos atrasados/pendentes.
    const hojeIso = formatLocalIso(now);
    return calcularPorRecebedor(processosOperacionais, users, {
      periodoStartIso: hojeIso,
      periodoEndIso: hojeIso,
    });
  }, [processosOperacionais, users, now]);

  const alertas = useMemo(
    () =>
      processosOperacionais
        ? calcularAlertas(recebedorStats, processosOperacionais)
        : null,
    [processosOperacionais, recebedorStats]
  );

  const urgentesPendentes = useMemo(() => {
    if (!processosOperacionais) return 0;
    let n = 0;
    for (const p of processosOperacionais) {
      if (
        p.urgente &&
        (p.status === 'pendente' ||
          p.status === 'em_andamento' ||
          p.status === 'em_coordenacao' ||
          p.status === 'em_espera' ||
          isAtrasado(p, now))
      ) {
        if (p.status !== 'concluido') n += 1;
      }
    }
    return n;
  }, [processosOperacionais, now]);

  const prioridadesPendentes = useMemo(() => {
    if (!processosOperacionais) return 0;
    let n = 0;
    for (const p of processosOperacionais) {
      if (
        p.prioridade &&
        (p.status === 'pendente' ||
          p.status === 'em_andamento' ||
          p.status === 'em_coordenacao' ||
          p.status === 'em_espera' ||
          isAtrasado(p, now))
      ) {
        if (p.status !== 'concluido') n += 1;
      }
    }
    return n;
  }, [processosOperacionais, now]);

  const pendentesAprovacao = useMemo(
    () => (users ?? []).filter((u) => u.role === 'pendente').length,
    [users]
  );

  const pendenciasPorRecebedor = useMemo<PendenciaRecebedor[]>(() => {
    if (!processosPendencias || !users) return [];
    // Conta TODA a carga em aberto (não só `pendente`): em_andamento/
    // em_coordenacao/em_espera e atrasados não ficam mais subcontados. O painel
    // continua escopado à semana (useProcessosSemana), então itens carregados de
    // semanas anteriores seguem fora — só a metodologia muda, não a janela.
    return calcularEmAbertoPorRecebedor(processosPendencias, users);
  }, [processosPendencias, users]);

  // Ordem canônica: ERRO → (data===null) loading/skeleton → conteúdo. A Visão
  // Geral usa KpiCards em skeleton (sem spinner de tela cheia), então o erro
  // substitui a tela toda para não deixar skeletons eternos.
  if (erroCarregamento) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-semibold text-ink-primary">
            Visão geral
          </h1>
          <p className="text-sm text-ink-secondary">
            Bem-vindo, {firstName}. Resumo da semana {semanaIso} (
            {formatDateBr(now)}).
          </p>
        </header>
        <ErrorState
          message="Falha ao carregar os dados da visão geral. Verifique sua conexão e tente novamente."
          onRetry={() => {
            if (abertosError) retryAbertos();
            if (semanaError) retrySemana(semanaIso);
            if (usersError) setUsersRetryKey((k) => k + 1);
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-ink-primary">
          Visão geral
        </h1>
        <p className="text-sm text-ink-secondary">
          Bem-vindo, {firstName}. Resumo da semana {semanaIso} (
          {formatDateBr(now)}).
        </p>
      </header>

      {/* KPIs */}
      <section
        aria-label="Indicadores da semana"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
          <KpiCard
            label="Pendentes"
            value={kpis?.pendentes ?? 0}
            icon={<Clock className="h-5 w-5" />}
            tone="warning"
            subtitle="Semana + abertos"
            loading={isLoading}
          />
        <KpiCard
          label="Em andamento"
          value={kpis?.emAndamento ?? 0}
            icon={<PlayCircle className="h-5 w-5" />}
            tone="info"
            subtitle="Semana + abertos"
            loading={isLoading}
          />
        <KpiCard
          label="Atrasados"
          value={kpis?.atrasados ?? 0}
          icon={<AlertTriangle className="h-5 w-5" />}
          tone="danger"
          subtitle="Não concluídos após o prazo"
          loading={isLoading}
        />
        <KpiCard
          label="Concluídos hoje"
          value={concluidosHoje}
          icon={<CheckCircle2 className="h-5 w-5" />}
          tone="success"
          subtitle={formatDateBr(now)}
          loading={isLoading}
        />
      </section>

      {/* Alerts */}
      {!isLoading && alertas && (
        <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {alertas.recebedoresMuitosAtrasados.length > 0 && (
            <AlertCard
              kind="atrasados"
              title={`${alertas.recebedoresMuitosAtrasados.length} recebedor${alertas.recebedoresMuitosAtrasados.length === 1 ? '' : 'es'} com mais de ${LIMITE_ATRASADOS} atrasados`}
              detail={alertas.recebedoresMuitosAtrasados
                .slice(0, 3)
                .map((r) => `${r.nome} (${r.atrasados})`)
                .join(' · ')}
              linkTo="/distribuidor/produtividade"
              linkLabel="Ver produtividade"
            />
          )}
          {urgentesPendentes > 0 && (
            <AlertCard
              kind="urgentes"
              title={`${urgentesPendentes} processo${urgentesPendentes === 1 ? '' : 's'} urgente${urgentesPendentes === 1 ? '' : 's'} pendente${urgentesPendentes === 1 ? '' : 's'}`}
              detail="Necessitam atenção imediata."
              linkTo="/distribuidor/processos"
              linkLabel="Ver processos"
            />
          )}
          {prioridadesPendentes > 0 && (
            <AlertCard
              kind="prioridades"
              title={`${prioridadesPendentes} processo${prioridadesPendentes === 1 ? '' : 's'} em prioridade pendente${prioridadesPendentes === 1 ? '' : 's'}`}
              detail="Entram na mesma fila de atenção dos urgentes."
              linkTo="/distribuidor/processos"
              linkLabel="Ver processos"
            />
          )}
        </section>
      )}

      {/* Quick actions */}
      <section
        aria-label="Ações rápidas"
        className="grid grid-cols-1 gap-3 md:grid-cols-4"
      >
        <ActionCard
          title="Aprovar pendentes"
          description="Usuários aguardando aprovação."
          to="/distribuidor/usuarios"
          buttonLabel="Ver usuários"
          icon={<UserCheck className="h-6 w-6 text-brand-primary" />}
          badge={
            pendentesAprovacao > 0
              ? {
                  label: `${pendentesAprovacao} pendente${pendentesAprovacao === 1 ? '' : 's'}`,
                  tone: 'warning',
                }
              : null
          }
        />
        <ActionCard
          title="Importar SEI"
          description="Carregue JSON do capturador para a fila."
          to="/distribuidor/importar-sei"
          buttonLabel="Importar JSON"
          icon={<Upload className="h-6 w-6 text-brand-primary" />}
          badge={null}
        />
        <ActionCard
          title="Não atribuídos"
          description="Distribua processos importados sem responsavel."
          to="/distribuidor/nao-atribuidos"
          buttonLabel="Abrir fila"
          icon={<ClipboardList className="h-6 w-6 text-brand-primary" />}
          badge={null}
        />
        <ActionCard
          title="Adicionar processo manual"
          description="Cadastre um processo individual."
          to="/distribuidor/manual"
          buttonLabel="Adicionar"
          icon={<Plus className="h-6 w-6 text-brand-primary" />}
          badge={null}
        />
      </section>

      <PendenciasRecebedoresSection
        loading={processosPendencias === null || users === null}
        rows={pendenciasPorRecebedor}
        semanaMode={pendenciasSemanaMode}
        semanaIso={pendenciasSemanaIso}
        onSemanaModeChange={setPendenciasSemanaMode}
      />

      {/* Last 5 historic entries */}
      <section className="rounded-lg border border-gray-200 bg-surface">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink-primary">
            <HistoryIcon className="h-4 w-4 text-ink-secondary" />
            Últimas ações
          </h2>
          <Link
            to="/distribuidor/historico"
            className="text-xs font-medium text-brand-primary hover:underline"
          >
            Ver tudo
          </Link>
        </div>
        {recentes === null ? (
          <div className="flex items-center justify-center px-4 py-6 text-sm text-ink-secondary">
            Carregando...
          </div>
        ) : recentes.length === 0 ? (
          <div className="px-4 py-6 text-sm text-ink-secondary">
            Nenhuma ação registrada ainda.
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {recentes.map((e) => (
              <li
                key={e.id}
                className="flex flex-wrap items-center gap-3 px-4 py-2.5"
              >
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${getHistoricoTipoCor(e.tipo)}`}
                >
                  {HISTORICO_TIPO_LABELS[e.tipo]}
                </span>
                <span className="flex-1 text-sm text-ink-primary">
                  {resumirPayload(e)}
                </span>
                <span className="hidden text-xs text-ink-secondary md:inline">
                  por {e.acaoPorNome}
                </span>
                <span className="text-xs text-ink-secondary">
                  {e.timestamp && typeof e.timestamp.toDate === 'function'
                    ? formatDateBr(e.timestamp.toDate(), 'dd/MM HH:mm')
                    : '—'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

type KpiTone = 'warning' | 'info' | 'danger' | 'success';

interface KpiCardProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: KpiTone;
  subtitle: string;
  loading: boolean;
}

const KPI_TONE_CLASSES: Record<KpiTone, { text: string; iconWrap: string }> = {
  warning: {
    text: 'text-state-warning-strong',
    iconWrap: 'bg-state-warning-bg text-state-warning-strong',
  },
  info: {
    text: 'text-state-info-strong',
    iconWrap: 'bg-state-info-bg text-state-info-strong',
  },
  danger: {
    text: 'text-state-danger-strong',
    iconWrap: 'bg-state-danger-bg text-state-danger-strong',
  },
  success: {
    text: 'text-state-success-strong',
    iconWrap: 'bg-state-success-bg text-state-success-strong',
  },
};

function KpiCard({ label, value, icon, tone, subtitle, loading }: KpiCardProps) {
  const classes = KPI_TONE_CLASSES[tone];
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 bg-surface p-4">
      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-ink-secondary">
          {label}
        </div>
        <div
          className={`mt-1 text-3xl font-semibold tabular-nums ${classes.text}`}
        >
          {loading ? '—' : new Intl.NumberFormat('pt-BR').format(value)}
        </div>
        <div className="mt-1 text-xs text-ink-secondary">{subtitle}</div>
      </div>
      <div
        className={`flex h-9 w-9 items-center justify-center rounded-md ${classes.iconWrap}`}
        aria-hidden="true"
      >
        {icon}
      </div>
    </div>
  );
}

interface AlertCardProps {
  kind: 'atrasados' | 'urgentes' | 'prioridades';
  title: string;
  detail: string;
  linkTo: string;
  linkLabel: string;
}

function AlertCard({ kind, title, detail, linkTo, linkLabel }: AlertCardProps) {
  const tone =
    kind === 'atrasados'
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : 'border-rose-200 bg-rose-50 text-rose-900';
  const Icon =
    kind === 'atrasados'
      ? AlertTriangle
      : kind === 'prioridades'
        ? Star
        : Flame;
  return (
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${tone}`}
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="flex-1">
        <div className="text-sm font-semibold">{title}</div>
        {detail && <div className="mt-0.5 text-xs opacity-90">{detail}</div>}
      </div>
      <Link
        to={linkTo}
        className="shrink-0 text-xs font-medium underline hover:no-underline"
      >
        {linkLabel}
      </Link>
    </div>
  );
}

interface PendenciasRecebedoresSectionProps {
  loading: boolean;
  rows: PendenciaRecebedor[];
  semanaMode: PendenciasSemanaMode;
  semanaIso: string;
  onSemanaModeChange: (mode: PendenciasSemanaMode) => void;
}

function PendenciasRecebedoresSection({
  loading,
  rows,
  semanaMode,
  semanaIso,
  onSemanaModeChange,
}: PendenciasRecebedoresSectionProps) {
  const totalSemana = rows.reduce((sum, row) => sum + row.total, 0);
  const semanaLabel =
    semanaMode === 'passada'
      ? 'semana passada'
      : semanaMode === 'atual'
        ? 'semana atual'
        : 'próxima semana';

  return (
    <section className="rounded-lg border border-gray-200 bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
        <div>
          <h2 className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-ink-secondary">
            <ClipboardList className="h-4 w-4" />
            Pendências por recebedor
          </h2>
          <p className="mt-1 text-xs text-ink-secondary">
            Processos em aberto da {semanaLabel} ({semanaIso}), separados por
            dia.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-gray-200 bg-surface p-0.5">
            <button
              type="button"
              onClick={() => onSemanaModeChange('passada')}
              className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
                semanaMode === 'passada'
                  ? 'bg-brand-primary text-white'
                  : 'text-ink-secondary hover:bg-gray-50 hover:text-ink-primary'
              }`}
              aria-pressed={semanaMode === 'passada'}
            >
              Semana passada
            </button>
            <button
              type="button"
              onClick={() => onSemanaModeChange('atual')}
              className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
                semanaMode === 'atual'
                  ? 'bg-brand-primary text-white'
                  : 'text-ink-secondary hover:bg-gray-50 hover:text-ink-primary'
              }`}
              aria-pressed={semanaMode === 'atual'}
            >
              Semana atual
            </button>
            <button
              type="button"
              onClick={() => onSemanaModeChange('proxima')}
              className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
                semanaMode === 'proxima'
                  ? 'bg-brand-primary text-white'
                  : 'text-ink-secondary hover:bg-gray-50 hover:text-ink-primary'
              }`}
              aria-pressed={semanaMode === 'proxima'}
            >
              Próxima semana
            </button>
          </div>
          <span className="rounded-full bg-brand-primary-light px-3 py-1 text-xs font-semibold text-brand-primary-dark">
            Semana: {loading ? '—' : totalSemana}
          </span>
        </div>
      </div>

      {loading ? (
        <div className="px-4 py-6 text-sm text-ink-secondary">
          Carregando pendências...
        </div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-6 text-sm text-ink-secondary">
          Nenhum recebedor ativo encontrado.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="bg-surface-elevated text-left text-xs uppercase tracking-wide text-ink-secondary">
              <tr>
                <th className="px-4 py-2 font-medium">Recebedor</th>
                <th className="px-3 py-2 text-right font-medium">Semana</th>
                {DIAS_SEMANA.map((dia) => (
                  <th
                    key={dia}
                    className="px-3 py-2 text-right font-medium"
                  >
                    {DIA_LABEL_SHORT[dia]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => (
                <tr key={row.uid} className="text-ink-primary">
                  <td className="px-4 py-2 font-medium">{row.nome}</td>
                  <td className="px-3 py-2 text-right">
                    <CountPill value={row.total} strong />
                  </td>
                  {DIAS_SEMANA.map((dia) => (
                    <td key={dia} className="px-3 py-2 text-right">
                      <CountPill value={row.porDia[dia]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function CountPill({ value, strong = false }: { value: number; strong?: boolean }) {
  const cls =
    value > 0
      ? strong
        ? 'bg-brand-primary text-white'
        : 'bg-brand-primary-light text-brand-primary-dark'
      : 'bg-gray-100 text-ink-secondary';
  return (
    <span
      className={`inline-flex min-w-8 justify-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${cls}`}
    >
      {value}
    </span>
  );
}

interface BadgeInfo {
  label: string;
  tone: 'warning' | 'success' | 'neutral';
}

interface ActionCardProps {
  title: string;
  description: string;
  to: string;
  buttonLabel: string;
  icon: React.ReactNode;
  badge: BadgeInfo | null;
}

function ActionCard({
  title,
  description,
  to,
  buttonLabel,
  icon,
  badge,
}: ActionCardProps) {
  const badgeClass =
    badge?.tone === 'warning'
      ? 'bg-amber-50 text-amber-800 ring-1 ring-amber-200'
      : badge?.tone === 'success'
      ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
      : 'bg-gray-50 text-ink-secondary ring-1 ring-gray-200';
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-surface p-4">
      <div className="flex items-start justify-between">
        <div className="flex h-12 w-12 items-center justify-center rounded-md bg-brand-primary/10">
          {icon}
        </div>
        {badge && (
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass}`}
          >
            {badge.label}
          </span>
        )}
      </div>
      <div>
        <h3 className="text-base font-semibold text-ink-primary">{title}</h3>
        <p className="mt-0.5 text-sm text-ink-secondary">{description}</p>
      </div>
      <Link
        to={to}
        className="inline-flex w-fit items-center gap-1 rounded-md bg-brand-primary px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-primary-dark"
      >
        <ClipboardList className="h-4 w-4" />
        {buttonLabel}
      </Link>
    </div>
  );
}

function formatLocalIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
