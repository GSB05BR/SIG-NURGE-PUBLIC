import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from '@/App';
import { useAuthStore } from '@/store/authStore';
import '@/index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

// Boot the auth listener BEFORE the first render so RouteGuard sees
// `loading: true` while Firebase resolves the initial auth state.
useAuthStore.getState().init();

createRoot(rootElement).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
