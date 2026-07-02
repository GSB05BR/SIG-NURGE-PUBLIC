import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { Agrupador, AgrupadoresMode } from '@/types';

export interface AgrupadoresSelectResult {
  mode: AgrupadoresMode;
  agrupadoresIds: string[];
}

interface AgrupadoresSelectModalProps {
  open: boolean;
  title?: string;
  description?: string;
  /** Lista de agrupadores disponíveis para seleção (todos, ativos e inativos). */
  agrupadores: Agrupador[];
  /** Modo inicial a apresentar. */
  initialMode: AgrupadoresMode;
  /** IDs iniciais selecionados (usados no modo "específicos"). */
  initialSelectedIds: string[];
  /** Texto do botão de confirmar. Default: "Salvar". */
  confirmLabel?: string;
  /** Disparado quando o usuário descarta o modal (cancelar/Esc). */
  onCancel: () => void;
  /** Disparado quando o usuário confirma. */
  onConfirm: (result: AgrupadoresSelectResult) => void | Promise<void>;
  /** Trava o modal enquanto a ação de confirmação está em andamento. */
  busy?: boolean;
}

/**
 * Modal reutilizável para configurar agrupadores permitidos de um usuário.
 *
 * Estrutura:
 * - Radio: Todos os agrupadores / Agrupadores específicos
 * - No modo "específicos", lista pesquisável com checkboxes
 * - Botões de selecionar/desmarcar todos
 * - Confirma via botão; descarta com Cancelar ou Esc
 */
export default function AgrupadoresSelectModal({
  open,
  title = 'Configurar origens',
  description,
  agrupadores,
  initialMode,
  initialSelectedIds,
  confirmLabel = 'Salvar',
  onCancel,
  onConfirm,
  busy = false,
}: AgrupadoresSelectModalProps) {
  const [mode, setMode] = useState<AgrupadoresMode>(initialMode);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(initialSelectedIds)
  );
  const [search, setSearch] = useState('');
  const firstFocusRef = useRef<HTMLInputElement | null>(null);

  // Reset state every time the modal opens.
  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setSelectedIds(new Set(initialSelectedIds));
      setSearch('');
    }
  }, [open, initialMode, initialSelectedIds]);

  // Foco no primeiro radio ao abrir.
  useEffect(() => {
    if (open && firstFocusRef.current) {
      firstFocusRef.current.focus();
    }
  }, [open]);

  // Esc fecha o modal.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        onCancel();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onCancel, busy]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sorted = [...agrupadores].sort((a, b) =>
      a.nome.localeCompare(b.nome)
    );
    if (!q) return sorted;
    return sorted.filter((a) => a.nome.toLowerCase().includes(q));
  }, [agrupadores, search]);

  const visibleIds = useMemo(() => filtered.map((a) => a.id), [filtered]);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllVisible() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      visibleIds.forEach((id) => next.add(id));
      return next;
    });
  }

  function clearAllVisible() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      visibleIds.forEach((id) => next.delete(id));
      return next;
    });
  }

  function handleConfirm() {
    const ids = mode === 'todos' ? [] : Array.from(selectedIds);
    void onConfirm({ mode, agrupadoresIds: ids });
  }

  if (!open) return null;

  const canConfirm =
    mode === 'todos' || (mode === 'especificos' && selectedIds.size > 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="agrupadores-modal-title"
    >
      <div
        className="absolute inset-0 bg-black/50"
        aria-hidden="true"
        onClick={() => {
          if (!busy) onCancel();
        }}
      />

      <div className="relative w-full max-w-lg rounded-lg bg-surface shadow-xl">
        <div className="flex items-start justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <h2
              id="agrupadores-modal-title"
              className="text-lg font-semibold text-ink-primary"
            >
              {title}
            </h2>
            {description && (
              <p className="mt-1 text-sm text-ink-secondary">{description}</p>
            )}
          </div>
          <button
            type="button"
            aria-label="Fechar"
            className="rounded p-1 text-ink-secondary hover:bg-gray-100"
            onClick={() => {
              if (!busy) onCancel();
            }}
            disabled={busy}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          <fieldset className="space-y-2">
            <legend className="sr-only">Modo de permissão</legend>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                ref={firstFocusRef}
                type="radio"
                name="agrupadores-mode"
                value="todos"
                checked={mode === 'todos'}
                onChange={() => setMode('todos')}
                className="h-4 w-4 accent-brand-primary"
                disabled={busy}
              />
              <span className="text-sm text-ink-primary">
                Todas as origens
              </span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="agrupadores-mode"
                value="especificos"
                checked={mode === 'especificos'}
                onChange={() => setMode('especificos')}
                className="h-4 w-4 accent-brand-primary"
                disabled={busy}
              />
              <span className="text-sm text-ink-primary">
                Origens específicas
              </span>
            </label>
          </fieldset>

          {mode === 'especificos' && (
            <div className="mt-4">
              <div className="relative mb-2">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar origem..."
                  className="w-full rounded-md border border-gray-200 bg-surface py-2 pl-8 pr-3 text-sm text-ink-primary outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20"
                  aria-label="Buscar origem"
                />
              </div>

              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="text-ink-secondary">
                  {selectedIds.size} selecionado(s)
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={selectAllVisible}
                    className="text-brand-primary hover:underline disabled:opacity-50"
                    disabled={busy || allVisibleSelected || filtered.length === 0}
                  >
                    Selecionar todos
                  </button>
                  <span className="text-gray-300">|</span>
                  <button
                    type="button"
                    onClick={clearAllVisible}
                    className="text-ink-secondary hover:underline disabled:opacity-50"
                    disabled={busy || filtered.length === 0}
                  >
                    Desmarcar todos
                  </button>
                </div>
              </div>

              {filtered.length === 0 ? (
                <p className="rounded-md border border-dashed border-gray-200 px-3 py-6 text-center text-sm text-ink-secondary">
                  Nenhuma origem encontrada.
                </p>
              ) : (
                <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
                  {filtered.map((a) => {
                    const checked = selectedIds.has(a.id);
                    return (
                      <li key={a.id}>
                        <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-gray-50">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggle(a.id)}
                            className="h-4 w-4 accent-brand-primary"
                            disabled={busy}
                          />
                          <span className="flex-1 text-sm text-ink-primary">
                            {a.nome}
                          </span>
                          {!a.ativo && (
                            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-ink-secondary">
                              inativo
                            </span>
                          )}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-3">
          <button
            type="button"
            onClick={() => {
              if (!busy) onCancel();
            }}
            disabled={busy}
            className="rounded-md border border-gray-200 px-3 py-2 text-sm font-medium text-ink-primary hover:bg-gray-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm || busy}
            className="rounded-md bg-brand-primary px-3 py-2 text-sm font-semibold text-white hover:bg-brand-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Salvando...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
