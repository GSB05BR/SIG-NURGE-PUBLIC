import { Loader2 } from 'lucide-react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/store/authStore';

/**
 * Centralised route guard for all authenticated routes.
 *
 * Behaviours:
 * - loading: show a centred spinner.
 * - no Firebase user: redirect to /login (preserving destination).
 * - signed in but no Firestore user doc yet: send to waiting screen.
 * - userDoc.approved=false OR role='pendente': redirect to /aguardando-aprovacao.
 * - role='recebedor': only /recebedor/* allowed; everything else => /recebedor.
 * - role='distribuidor': everything allowed; visiting /login => /distribuidor.
 */
export default function RouteGuard() {
  const { firebaseUser, userDoc, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-elevated">
        <Loader2
          className="h-8 w-8 animate-spin text-brand-primary"
          aria-label="Carregando"
        />
      </div>
    );
  }

  if (!firebaseUser) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (!userDoc) {
    if (location.pathname === '/aguardando-aprovacao') {
      return <Outlet />;
    }
    return <Navigate to="/aguardando-aprovacao" replace />;
  }

  const path = location.pathname;
  const isPending =
    !userDoc.approved || userDoc.role === 'pendente';

  if (isPending) {
    if (path === '/aguardando-aprovacao') {
      return <Outlet />;
    }
    return <Navigate to="/aguardando-aprovacao" replace />;
  }

  // Approved user trying to hit /login: bounce to their home.
  if (path === '/login') {
    const home =
      userDoc.role === 'distribuidor' ? '/distribuidor' : '/recebedor';
    return <Navigate to={home} replace />;
  }

  if (userDoc.role === 'recebedor') {
    if (path === '/aguardando-aprovacao') {
      return <Navigate to="/recebedor" replace />;
    }
    if (!path.startsWith('/recebedor')) {
      return <Navigate to="/recebedor" replace />;
    }
    return <Outlet />;
  }

  if (userDoc.role === 'distribuidor') {
    if (path === '/aguardando-aprovacao') {
      return <Navigate to="/distribuidor" replace />;
    }
    return <Outlet />;
  }

  // Unknown role: send to waiting screen as a safe default.
  return <Navigate to="/aguardando-aprovacao" replace />;
}
