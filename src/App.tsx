import { lazy, Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AppLayout from '@/components/AppLayout';
import RouteGuard from '@/components/RouteGuard';
import DemoBanner from '@/components/DemoBanner';
import { useDeployReload } from '@/lib/useDeployReload';

const AguardandoAprovacao = lazy(() => import('@/pages/AguardandoAprovacao'));
const Login = lazy(() => import('@/pages/Login'));
const Usuarios = lazy(() => import('@/pages/distribuidor/Usuarios'));
const Agrupadores = lazy(() => import('@/pages/distribuidor/Agrupadores'));
const Configuracoes = lazy(() => import('@/pages/distribuidor/Configuracoes'));
const EstatisticasFila = lazy(
  () => import('@/pages/distribuidor/EstatisticasFila')
);
const ImportarSei = lazy(() => import('@/pages/distribuidor/ImportarSei'));
const NaoAtribuidos = lazy(() => import('@/pages/distribuidor/NaoAtribuidos'));
const AdicionarManual = lazy(() => import('@/pages/distribuidor/AdicionarManual'));
const Produtividade = lazy(() => import('@/pages/distribuidor/Produtividade'));
const Processos = lazy(() => import('@/pages/distribuidor/Processos'));
const Avisos = lazy(() => import('@/pages/distribuidor/Avisos'));
const Coordenacao = lazy(() => import('@/pages/distribuidor/Coordenacao'));
const Historico = lazy(() => import('@/pages/distribuidor/Historico'));
const Overview = lazy(() => import('@/pages/distribuidor/Overview'));
const RecebedorDashboard = lazy(() => import('@/pages/recebedor/Dashboard'));
const RecebedorHistorico = lazy(() => import('@/pages/recebedor/Historico'));
const RecebedorProdutividade = lazy(
  () => import('@/pages/recebedor/Produtividade')
);
const Suporte = lazy(() => import('@/pages/Suporte'));

export default function App() {
  useDeployReload();

  return (
    <>
      <DemoBanner />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<RouteGuard />}>
          <Route
            path="/aguardando-aprovacao"
            element={<AguardandoAprovacao />}
          />
          <Route element={<AppLayout />}>
            <Route path="/recebedor" element={<RecebedorDashboard />} />
            <Route
              path="/recebedor/historico"
              element={<RecebedorHistorico />}
            />
            <Route
              path="/recebedor/produtividade"
              element={<RecebedorProdutividade />}
            />
            <Route path="/recebedor/suporte" element={<Suporte />} />
            <Route path="/distribuidor/suporte" element={<Suporte />} />
            <Route path="/distribuidor" element={<Overview />} />
            <Route
              path="/distribuidor/meus-processos"
              element={<RecebedorDashboard />}
            />
            <Route
              path="/distribuidor/meu-historico"
              element={<RecebedorHistorico />}
            />
            <Route path="/distribuidor/usuarios" element={<Usuarios />} />
            <Route path="/distribuidor/agrupadores" element={<Agrupadores />} />
            <Route
              path="/distribuidor/importar-sei"
              element={<ImportarSei />}
            />
            <Route
              path="/distribuidor/nao-atribuidos"
              element={<NaoAtribuidos />}
            />
            <Route
              path="/distribuidor/estatisticas-fila"
              element={<EstatisticasFila />}
            />
            <Route
              path="/distribuidor/distribuir"
              element={
                <Navigate to="/distribuidor/estatisticas-fila" replace />
              }
            />
            <Route path="/distribuidor/manual" element={<AdicionarManual />} />
            <Route path="/distribuidor/processos" element={<Processos />} />
            <Route path="/distribuidor/avisos" element={<Avisos />} />
            <Route
              path="/distribuidor/coordenacao"
              element={<Coordenacao />}
            />
            <Route
              path="/distribuidor/produtividade"
              element={<Produtividade />}
            />
            <Route path="/distribuidor/historico" element={<Historico />} />
            <Route
              path="/distribuidor/configuracoes"
              element={<Configuracoes />}
            />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}

function RouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-elevated text-brand-primary">
      <Loader2 className="h-7 w-7 animate-spin" aria-label="Carregando" />
    </div>
  );
}
