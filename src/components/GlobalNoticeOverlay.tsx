import { useEffect, useMemo, useState } from 'react';
import { BellRing, Loader2, X } from 'lucide-react';
import {
  dismissGlobalNotice,
  listenGlobalNotices,
  listenUserNoticeDismissals,
} from '@/services/firebase/global-notices';
import {
  makeNoticeDismissalKey,
  noticeTargetsUser,
  sanitizeNoticeHtml,
} from '@/lib/global-notices';
import type { GlobalNotice, User } from '@/types';

interface GlobalNoticeOverlayProps {
  user: User | null;
}

function readErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Falha ao registrar leitura do aviso.';
}

export default function GlobalNoticeOverlay({ user }: GlobalNoticeOverlayProps) {
  const [notices, setNotices] = useState<GlobalNotice[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.uid || !user.approved || user.role === 'pendente') {
      setNotices([]);
      setDismissed(new Set());
      setBusyKey(null);
      setError(null);
      return;
    }

    const unsubNotices = listenGlobalNotices(
      (next) => {
        setNotices(next);
        setError(null);
      },
      (err) => setError(readErrorMessage(err))
    );
    const unsubDismissals = listenUserNoticeDismissals(
      user.uid,
      (next) => setDismissed(next),
      (err) => setError(readErrorMessage(err))
    );

    return () => {
      unsubNotices();
      unsubDismissals();
      setNotices([]);
      setDismissed(new Set());
      setBusyKey(null);
      setError(null);
    };
  }, [user?.approved, user?.role, user?.uid]);

  const visibleNotices = useMemo(() => {
    if (!user) return [];
    return notices.filter((notice) => {
      if (!notice.active) return false;
      if (!noticeTargetsUser(notice, user)) return false;
      return !dismissed.has(
        makeNoticeDismissalKey(notice.id, notice.noticeVersion)
      );
    });
  }, [dismissed, notices, user]);

  const current = visibleNotices[0] ?? null;
  const currentKey = current
    ? makeNoticeDismissalKey(current.id, current.noticeVersion)
    : null;

  async function handleDismiss() {
    if (!current || !currentKey || !user?.uid) return;
    setBusyKey(currentKey);
    setError(null);
    try {
      await dismissGlobalNotice(current.id, current.noticeVersion, user.uid);
      setDismissed((prev) => new Set(prev).add(currentKey));
    } catch (err) {
      setError(readErrorMessage(err));
    } finally {
      setBusyKey(null);
    }
  }

  if (!current || !currentKey) return null;

  const isBusy = busyKey === currentKey;
  const safeBodyHtml = sanitizeNoticeHtml(current.bodyHtml);

  return (
    <div className="global-notice-overlay" role="dialog" aria-modal="true">
      <div className="global-notice-backdrop" aria-hidden="true" />
      <section
        className="global-notice-panel"
        aria-labelledby="global-notice-title"
      >
        <div className="global-notice-header">
          <div className="global-notice-icon" aria-hidden="true">
            <BellRing className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 id="global-notice-title" className="global-notice-title">
              {current.title}
            </h2>
            {visibleNotices.length > 1 && (
              <p className="global-notice-count">
                Mais {visibleNotices.length - 1} aviso
                {visibleNotices.length - 1 === 1 ? '' : 's'} pendente
                {visibleNotices.length - 1 === 1 ? '' : 's'}.
              </p>
            )}
          </div>
          <button
            type="button"
            className="global-notice-close"
            aria-label="Fechar aviso"
            onClick={() => {
              void handleDismiss();
            }}
            disabled={isBusy}
          >
            {isBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <X className="h-4 w-4" />
            )}
          </button>
        </div>

        <div
          className="global-notice-body"
          dangerouslySetInnerHTML={{ __html: safeBodyHtml }}
        />

        {error && <p className="global-notice-error">{error}</p>}

        <div className="global-notice-actions">
          <button
            type="button"
            className="global-notice-primary"
            onClick={() => {
              void handleDismiss();
            }}
            disabled={isBusy}
          >
            {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Entendi / Fechar
          </button>
        </div>
      </section>
    </div>
  );
}
