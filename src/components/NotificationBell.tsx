import { useEffect, useRef, useState } from 'react';
import { Bell, Check } from 'lucide-react';
import { formatDateBr } from '@/lib/datetime';
import { notificacaoTexto } from '@/lib/suporte';
import type { SuporteNotificacao } from '@/types';

interface NotificationBellProps {
  notificacoes: SuporteNotificacao[];
  onAbrir: (n: SuporteNotificacao) => void;
  onMarcarTodas: () => void;
}

export default function NotificationBell({
  notificacoes,
  onAbrir,
  onMarcarTodas,
}: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const naoLidas = notificacoes.filter((n) => !n.lida).length;

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-md text-white/90 hover:bg-white/15"
        aria-label={
          naoLidas > 0
            ? `Notificações: ${naoLidas} não lida${naoLidas === 1 ? '' : 's'}`
            : 'Notificações'
        }
      >
        <Bell className="h-5 w-5" />
        {naoLidas > 0 && (
          <span className="absolute right-1 top-1 inline-flex h-4 min-w-4 animate-pulse items-center justify-center rounded-full bg-state-danger px-1 text-[10px] font-bold text-white">
            {naoLidas > 9 ? '9+' : naoLidas}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 max-w-[90vw] overflow-hidden rounded-lg border border-gray-200 bg-surface text-ink-primary shadow-xl">
          <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2">
            <span className="text-sm font-semibold">Notificações</span>
            {naoLidas > 0 && (
              <button
                type="button"
                onClick={() => {
                  onMarcarTodas();
                }}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-primary hover:underline"
              >
                <Check className="h-3.5 w-3.5" />
                Marcar todas como lidas
              </button>
            )}
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {notificacoes.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-ink-secondary">
                Nenhuma notificação.
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {notificacoes.map((n) => {
                  const ms = n.criadoEm.toMillis();
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(false);
                          onAbrir(n);
                        }}
                        className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-gray-50 ${
                          n.lida ? '' : 'bg-brand-primary/5'
                        }`}
                      >
                        <span className="flex w-full items-start gap-2">
                          {!n.lida && (
                            <span
                              aria-hidden="true"
                              className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-state-danger"
                            />
                          )}
                          <span className="min-w-0 flex-1 text-sm">
                            {notificacaoTexto(n)}
                          </span>
                        </span>
                        {ms > 0 && (
                          <span className="pl-4 text-[11px] text-ink-secondary">
                            {formatDateBr(n.criadoEm.toDate(), 'dd/MM HH:mm')}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
