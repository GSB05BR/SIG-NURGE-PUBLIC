import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  BellRing,
  ClipboardCheck,
  ClipboardList,
  Database,
  History,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Megaphone,
  Menu,
  Moon,
  Plus,
  Settings,
  Sun,
  TrendingUp,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { useAuth, useAuthActions } from '@/store/authStore';
import { subscribeProcessosNaCoordenacao } from '@/services/firebase/processos';
import { subscribeConfigSistema } from '@/services/firebase/sistema-config';
import {
  marcarNotificacaoLida,
  marcarTodasNotificacoesLidas,
  subscribeNotificacoes,
} from '@/services/firebase/suporte';
import GlobalNoticeOverlay from '@/components/GlobalNoticeOverlay';
import NotificationBell from '@/components/NotificationBell';
import Modal from '@/components/Modal';
import { useDialogA11y } from '@/lib/useDialogA11y';
import type { ConfigSistema, Processo, SuporteNotificacao } from '@/types';

interface NavItem {
  to: string;
  label: string;
  shortLabel?: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
}

const DISTRIBUIDOR_NAV: NavItem[] = [
  { to: '/distribuidor', label: 'Visão Geral', icon: LayoutDashboard, end: true },
  {
    to: '/distribuidor/meus-processos',
    label: 'Meus Processos',
    shortLabel: 'Meus',
    icon: ClipboardList,
  },
  {
    to: '/distribuidor/meu-historico',
    label: 'Meu Histórico',
    shortLabel: 'Meu Hist.',
    icon: History,
  },
  { to: '/distribuidor/usuarios', label: 'Usuários', icon: Users },
  {
    to: '/distribuidor/importar-sei',
    label: 'Importar SEI',
    shortLabel: 'Importar',
    icon: Upload,
  },
  {
    to: '/distribuidor/nao-atribuidos',
    label: 'Não atribuídos',
    shortLabel: 'Fila',
    icon: Database,
  },
  {
    to: '/distribuidor/estatisticas-fila',
    label: 'Estatísticas da fila',
    shortLabel: 'Estat. Fila',
    icon: BarChart3,
  },
  {
    to: '/distribuidor/manual',
    label: 'Adicionar Manual',
    shortLabel: 'Manual',
    icon: Plus,
  },
  { to: '/distribuidor/processos', label: 'Processos', icon: ClipboardList },
  { to: '/distribuidor/avisos', label: 'Avisos', icon: Megaphone },
  {
    to: '/distribuidor/coordenacao',
    label: 'Coordenação',
    shortLabel: 'Coord.',
    icon: ClipboardCheck,
  },
  {
    to: '/distribuidor/produtividade',
    label: 'Produtividade',
    shortLabel: 'Produt.',
    icon: TrendingUp,
  },
  { to: '/distribuidor/historico', label: 'Histórico', icon: History },
  { to: '/distribuidor/suporte', label: 'Suporte', icon: LifeBuoy },
  {
    to: '/distribuidor/configuracoes',
    label: 'Configurações',
    shortLabel: 'Config.',
    icon: Settings,
  },
];

const RECEBEDOR_NAV: NavItem[] = [
  { to: '/recebedor', label: 'Meus Processos', icon: ClipboardList, end: true },
  { to: '/recebedor/historico', label: 'Histórico', icon: History },
  {
    to: '/recebedor/produtividade',
    label: 'Produtividade',
    shortLabel: 'Produt.',
    icon: TrendingUp,
  },
  { to: '/recebedor/suporte', label: 'Suporte', icon: LifeBuoy },
];

export default function AppLayout() {
  const { userDoc, firebaseUser } = useAuth();
  const { signOut } = useAuthActions();
  const location = useLocation();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [config, setConfig] = useState<ConfigSistema | null>(null);
  const [coordenacaoAtivos, setCoordenacaoAtivos] = useState<Processo[]>([]);
  const [coordenacaoAlertQueue, setCoordenacaoAlertQueue] = useState<
    Processo[]
  >([]);
  const coordenacaoSeenIdsRef = useRef<Set<string> | null>(null);
  const shouldReceiveCoordenacaoAlertRef = useRef(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'light';
    return window.localStorage.getItem('theme') === 'dark' ? 'dark' : 'light';
  });
  const [suporteNotificacoes, setSuporteNotificacoes] = useState<
    SuporteNotificacao[]
  >([]);

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.dataset.theme = 'dark';
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    window.localStorage.setItem('theme', theme);
  }, [theme]);

  const isDistribuidor = userDoc?.role === 'distribuidor';
  const isRecebedor = userDoc?.role === 'recebedor';
  const shouldReceiveCoordenacaoAlert = Boolean(
    isDistribuidor &&
      userDoc?.uid &&
      config?.coordenacaoNotificacaoDistribuidorUids.includes(userDoc.uid)
  );
  const navItems = isDistribuidor
    ? DISTRIBUIDOR_NAV
    : isRecebedor
      ? RECEBEDOR_NAV
      : [];
  const roleLabel = isDistribuidor
    ? 'Distribuidor'
    : isRecebedor
      ? 'Recebedor'
      : 'Pendente';

  const displayName =
    userDoc?.displayName ?? firebaseUser?.displayName ?? 'Usuário';
  const email = userDoc?.email ?? firebaseUser?.email ?? '';
  const photoURL = userDoc?.photoURL ?? firebaseUser?.photoURL ?? null;
  const coordenacaoAttentionCount = coordenacaoAtivos.length;
  const activeCoordenacaoAlert = coordenacaoAlertQueue[0] ?? null;

  const meUid = userDoc?.uid ?? null;
  const isAprovado = isDistribuidor || isRecebedor;
  const suporteBase = isDistribuidor
    ? '/distribuidor/suporte'
    : '/recebedor/suporte';
  const suporteUnreadCount = suporteNotificacoes.filter((n) => !n.lida).length;

  useEffect(() => {
    if (!isDistribuidor) {
      setConfig(null);
      return;
    }
    const unsub = subscribeConfigSistema((next) => setConfig(next));
    return () => unsub();
  }, [isDistribuidor]);

  useEffect(() => {
    shouldReceiveCoordenacaoAlertRef.current = shouldReceiveCoordenacaoAlert;
    if (!shouldReceiveCoordenacaoAlert) {
      setCoordenacaoAlertQueue([]);
    }
  }, [shouldReceiveCoordenacaoAlert]);

  useEffect(() => {
    if (!isDistribuidor) {
      setCoordenacaoAtivos([]);
      coordenacaoSeenIdsRef.current = null;
      return;
    }

    const unsub = subscribeProcessosNaCoordenacao((list) => {
      setCoordenacaoAtivos(list);
      const currentIds = new Set(list.map((processo) => processo.id));
      const previousIds = coordenacaoSeenIdsRef.current;
      if (previousIds === null) {
        coordenacaoSeenIdsRef.current = currentIds;
        return;
      }

      const novos = list.filter((processo) => !previousIds.has(processo.id));
      coordenacaoSeenIdsRef.current = currentIds;
      if (novos.length === 0 || !shouldReceiveCoordenacaoAlertRef.current) {
        return;
      }

      setCoordenacaoAlertQueue((current) => {
        const queuedIds = new Set(current.map((processo) => processo.id));
        const uniqueNovos = novos.filter(
          (processo) => !queuedIds.has(processo.id)
        );
        return uniqueNovos.length > 0 ? [...current, ...uniqueNovos] : current;
      });
    }, (err) =>
      // Listener apenas do badge/alerta de coordenação: não bloqueia o layout.
      // Em caso de falha (permissão/índice/rede), apenas logamos para não
      // derrubar a navegação.
      console.error('[AppLayout] subscribeProcessosNaCoordenacao:', err)
    );

    return () => {
      unsub();
      setCoordenacaoAtivos([]);
      coordenacaoSeenIdsRef.current = null;
    };
  }, [isDistribuidor]);

  // Notificações de Suporte (sino + bolinha na aba), para qualquer aprovado.
  useEffect(() => {
    if (!meUid || !isAprovado) {
      setSuporteNotificacoes([]);
      return;
    }
    const unsub = subscribeNotificacoes(meUid, (list) =>
      setSuporteNotificacoes(list)
    );
    return () => unsub();
  }, [meUid, isAprovado]);

  // Abrir a aba Suporte marca todas as notificações como lidas (some a bolinha).
  useEffect(() => {
    if (!meUid) return;
    if (location.pathname.endsWith('/suporte') && suporteUnreadCount > 0) {
      void marcarTodasNotificacoesLidas(meUid);
    }
  }, [location.pathname, meUid, suporteUnreadCount]);

  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <div className="flex min-h-screen flex-col bg-gray-100">
      <a href="#app" className="skip-link">
        Pular para o conteúdo principal
      </a>

      <header className="sticky top-0 z-30 bg-brand-primary text-white shadow-md">
        <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            {navItems.length > 0 && (
              <button
                type="button"
                aria-label="Abrir menu"
                className="inline-flex h-10 w-10 items-center justify-center rounded-md text-white/90 hover:bg-white/15 lg:hidden"
                onClick={() => setDrawerOpen(true)}
              >
                <Menu className="h-5 w-5" />
              </button>
            )}
            <img
              src={`${import.meta.env.BASE_URL}logo.png`}
              alt="TJMG"
              className="h-9 w-8 shrink-0 object-contain"
            />
            <span className="truncate text-lg font-bold tracking-tight">
              SIG - NURGE
            </span>
          </div>

          {navItems.length > 0 && (
            <nav className="app-nav-scroll hidden min-w-0 flex-1 items-center gap-0.5 overflow-x-auto lg:flex">
              {navItems.map((item) => (
                <NavBarLink
                  key={item.to}
                  item={item}
                  variant="top"
                  attentionCount={
                    item.to === '/distribuidor/coordenacao'
                      ? coordenacaoAttentionCount
                      : item.to === suporteBase
                        ? suporteUnreadCount
                        : 0
                  }
                />
              ))}
            </nav>
          )}

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <div className="hidden items-center gap-2 text-right 2xl:flex">
              <div className="leading-tight">
                <div className="max-w-[180px] truncate text-sm font-semibold">
                  {displayName}
                </div>
                <div className="max-w-[180px] truncate text-xs text-white/80">
                  {email}
                </div>
              </div>
              <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">
                {roleLabel}
              </span>
            </div>
            {photoURL ? (
              <img
                src={photoURL}
                alt=""
                aria-hidden="true"
                className="h-8 w-8 rounded-full ring-1 ring-white/30"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div
                aria-hidden="true"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-xs font-semibold ring-1 ring-white/25"
              >
                {initials || '?'}
              </div>
            )}
            {isAprovado && meUid && (
              <NotificationBell
                notificacoes={suporteNotificacoes}
                onAbrir={(n) => {
                  void marcarNotificacaoLida(meUid, n.id);
                  navigate(`${suporteBase}?ticket=${n.ticketId}`);
                }}
                onMarcarTodas={() => {
                  void marcarTodasNotificacoesLidas(meUid);
                }}
              />
            )}
            <button
              type="button"
              onClick={() =>
                setTheme((current) =>
                  current === 'dark' ? 'light' : 'dark'
                )
              }
              className="inline-flex h-10 w-10 items-center justify-center rounded-md text-white/90 hover:bg-white/15"
              aria-label={
                theme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro'
              }
            >
              {theme === 'dark' ? (
                <Sun className="h-5 w-5" />
              ) : (
                <Moon className="h-5 w-5" />
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                void signOut();
              }}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-white/25 px-3 text-sm font-semibold text-white hover:bg-white/15"
              aria-label="Sair"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sair</span>
            </button>
          </div>
        </div>
      </header>

      {drawerOpen && (
        <NavDrawer
          navItems={navItems}
          coordenacaoAttentionCount={coordenacaoAttentionCount}
          suporteBase={suporteBase}
          suporteUnreadCount={suporteUnreadCount}
          onClose={() => setDrawerOpen(false)}
        />
      )}

      {activeCoordenacaoAlert && (
        <CoordenacaoAlertModal
          processo={activeCoordenacaoAlert}
          pendingCount={Math.max(0, coordenacaoAlertQueue.length - 1)}
          onClose={() =>
            setCoordenacaoAlertQueue((current) => current.slice(1))
          }
          onOpen={() => {
            setCoordenacaoAlertQueue((current) => current.slice(1));
            navigate('/distribuidor/coordenacao');
          }}
        />
      )}

      <GlobalNoticeOverlay user={userDoc} />

      <main id="app" className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <Outlet />
      </main>
    </div>
  );
}

function NavDrawer({
  navItems,
  coordenacaoAttentionCount,
  suporteBase,
  suporteUnreadCount,
  onClose,
}: {
  navItems: NavItem[];
  coordenacaoAttentionCount: number;
  suporteBase: string;
  suporteUnreadCount: number;
  onClose: () => void;
}) {
  const drawerRef = useRef<HTMLElement | null>(null);
  useDialogA11y({ enabled: true, containerRef: drawerRef, onEscape: onClose });

  return (
    <div className="fixed inset-0 z-40 lg:hidden">
      <div
        className="absolute inset-0 bg-black/50"
        aria-hidden="true"
        onClick={onClose}
      />
      <aside
        ref={drawerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Menu de navegação"
        className="absolute left-0 top-0 h-full w-72 bg-surface shadow-lg outline-none"
      >
        <div className="flex h-14 items-center justify-between border-b border-gray-200 px-4">
          <div className="flex items-center gap-2">
            <img src={`${import.meta.env.BASE_URL}logo.png`} alt="TJMG" className="h-9 w-8 object-contain" />
            <span className="font-bold text-ink-primary">SIG - NURGE</span>
          </div>
          <button
            type="button"
            aria-label="Fechar menu"
            className="inline-flex h-10 w-10 items-center justify-center rounded-md text-ink-secondary hover:bg-gray-100 hover:text-ink-primary"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex flex-col gap-1 p-3">
          {navItems.map((item) => (
            <NavBarLink
              key={item.to}
              item={item}
              variant="drawer"
              attentionCount={
                item.to === '/distribuidor/coordenacao'
                  ? coordenacaoAttentionCount
                  : item.to === suporteBase
                    ? suporteUnreadCount
                    : 0
              }
            />
          ))}
        </nav>
      </aside>
    </div>
  );
}

function NavBarLink({
  item,
  variant,
  attentionCount = 0,
}: {
  item: NavItem;
  variant: 'top' | 'drawer';
  attentionCount?: number;
}) {
  const Icon = item.icon;
  const label = variant === 'top' && item.shortLabel ? item.shortLabel : item.label;
  const hasAttention = attentionCount > 0;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      aria-label={
        hasAttention
          ? `${item.label}: ${attentionCount} ${
              attentionCount === 1 ? 'novidade' : 'novidades'
            }`
          : item.label
      }
      className={({ isActive }) =>
        variant === 'top'
          ? [
              'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-semibold',
              isActive
                ? 'bg-white/20 text-white'
                : 'text-white/85 hover:bg-white/15 hover:text-white',
              hasAttention && !isActive ? 'bg-white/10 ring-1 ring-amber-200/70' : '',
            ].join(' ')
          : [
              'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold',
              isActive
                ? 'bg-brand-primary text-white'
                : 'text-ink-primary hover:bg-brand-primary hover:text-white',
              hasAttention && !isActive ? 'ring-1 ring-amber-200' : '',
            ].join(' ')
      }
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
      {hasAttention && (
        <span
          className={
            variant === 'top'
              ? 'inline-flex h-5 min-w-5 animate-pulse items-center justify-center rounded-full bg-amber-300 px-1.5 text-[11px] font-bold text-amber-950'
              : 'ml-auto inline-flex h-5 min-w-5 animate-pulse items-center justify-center rounded-full bg-state-danger px-1.5 text-[11px] font-bold text-white'
          }
        >
          {attentionCount}
        </span>
      )}
    </NavLink>
  );
}

function CoordenacaoAlertModal({
  processo,
  pendingCount,
  onClose,
  onOpen,
}: {
  processo: Processo;
  pendingCount: number;
  onClose: () => void;
  onOpen: () => void;
}) {
  return (
    <Modal
      open
      title="Novo processo na coordenação"
      description="Um recebedor enviou um processo para decisão da coordenação."
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-200 px-3 py-2 text-sm font-medium text-ink-primary hover:bg-gray-50"
          >
            Fechar
          </button>
          <button
            type="button"
            onClick={onOpen}
            className="inline-flex items-center gap-2 rounded-md bg-brand-primary px-3 py-2 text-sm font-semibold text-white hover:bg-brand-primary-dark"
          >
            <BellRing className="h-4 w-4" />
            Abrir coordenação
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Há processo ativo na coordenação que ainda não foi colocado em espera.
        </div>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
              Processo
            </dt>
            <dd className="mt-0.5 font-mono font-semibold text-ink-primary">
              {processo.numero}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
              Enviado por
            </dt>
            <dd className="mt-0.5 font-semibold text-ink-primary">
              {processo.coordenacaoEnviadoPorNome ?? 'Recebedor'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
              Origem
            </dt>
            <dd className="mt-0.5 text-ink-primary">
              {processo.agrupadorNome}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
              Regime
            </dt>
            <dd className="mt-0.5 text-ink-primary">
              {processo.regime === 'fechado' ? 'Fechado' : 'Aberto'}
            </dd>
          </div>
        </dl>
        {processo.coordenacaoUltimaObservacao && (
          <div className="rounded-md bg-gray-50 px-3 py-2 text-sm text-ink-secondary">
            <span className="font-semibold text-ink-primary">Observação: </span>
            {processo.coordenacaoUltimaObservacao}
          </div>
        )}
        {pendingCount > 0 && (
          <p className="text-xs font-medium text-ink-secondary">
            Mais {pendingCount} aviso{pendingCount === 1 ? '' : 's'} na fila.
          </p>
        )}
      </div>
    </Modal>
  );
}
