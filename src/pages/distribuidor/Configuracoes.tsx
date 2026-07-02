import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Loader2, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useAuth } from '@/store/authStore';
import {
  subscribeConfigSistema,
  updateConfigSistema,
} from '@/services/firebase/sistema-config';
import { subscribeAllUsers } from '@/services/firebase/users';
import { getSuperAdminEmails } from '@/lib/super-admins';
import { usePageTitle } from '@/lib/usePageTitle';
import type { ConfigSistema, User } from '@/types';
import Toast, { type ToastState } from '@/components/Toast';

// ---------------------------------------------------------------------------
// Brazilian national holidays for 2026 (pre-population suggestion).
// Used only when the user opens the page with an empty array.
// ---------------------------------------------------------------------------

const FERIADOS_BR_2026: string[] = [
  '2026-01-01', // Confraternização Universal
  '2026-02-16', // Carnaval (segunda)
  '2026-02-17', // Carnaval (terça)
  '2026-04-03', // Sexta-Feira Santa
  '2026-04-21', // Tiradentes
  '2026-05-01', // Dia do Trabalho
  '2026-06-04', // Corpus Christi
  '2026-09-07', // Independência
  '2026-10-12', // N.ª Sr.ª Aparecida
  '2026-11-02', // Finados
  '2026-11-15', // Proclamação da República
  '2026-11-20', // Consciência Negra
  '2026-12-25', // Natal
];

const FERIADOS_BR_2026_LABELS: Record<string, string> = {
  '2026-01-01': 'Confraternização Universal',
  '2026-02-16': 'Carnaval (segunda)',
  '2026-02-17': 'Carnaval (terça)',
  '2026-04-03': 'Sexta-Feira Santa',
  '2026-04-21': 'Tiradentes',
  '2026-05-01': 'Dia do Trabalho',
  '2026-06-04': 'Corpus Christi',
  '2026-09-07': 'Independência',
  '2026-10-12': 'Nossa Senhora Aparecida',
  '2026-11-02': 'Finados',
  '2026-11-15': 'Proclamação da República',
  '2026-11-20': 'Consciência Negra',
  '2026-12-25': 'Natal',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Ocorreu um erro inesperado.';
}

/** Validates a YYYY-MM-DD date string. */
function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00`);
  return !Number.isNaN(d.getTime());
}

function formatIsoToBr(s: string): string {
  if (!isValidIsoDate(s)) return s;
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

function sortDates(arr: string[]): string[] {
  return [...arr].sort((a, b) => a.localeCompare(b));
}

function sortTextValues(arr: string[]): string[] {
  return [...arr].sort((a, b) =>
    a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })
  );
}

function sameStringSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = sortTextValues(a);
  const sortedB = sortTextValues(b);
  return sortedA.every((value, index) => value === sortedB[index]);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Configuracoes() {
  usePageTitle('Configurações');
  const { firebaseUser, userDoc } = useAuth();

  const [config, setConfig] = useState<ConfigSistema | null>(null);
  const [users, setUsers] = useState<User[] | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  // Local editable state for prazo card.
  const [prazoText, setPrazoText] = useState<string>('');
  const [savingPrazo, setSavingPrazo] = useState(false);

  // Local editable state for feriados card.
  const [feriados, setFeriados] = useState<string[]>([]);
  const [newDate, setNewDate] = useState<string>('');
  const [savingFeriados, setSavingFeriados] = useState(false);

  // Local editable state for coordination notifications.
  const [coordenacaoNotificacaoUids, setCoordenacaoNotificacaoUids] =
    useState<string[]>([]);
  const [savingCoordenacaoNotificacoes, setSavingCoordenacaoNotificacoes] =
    useState(false);

  const meUid = firebaseUser?.uid ?? null;
  const meNome =
    userDoc?.displayName ?? firebaseUser?.displayName ?? 'Usuário';

  // Track whether we've hydrated local state at least once. After the first
  // snapshot, subsequent real-time updates only refresh `config` (so the user's
  // in-progress edits are not clobbered, and the "save" button can be enabled
  // by comparing against the latest server value).
  const hydratedRef = useRef(false);

  // Subscribe to config.
  useEffect(() => {
    const unsub = subscribeConfigSistema((next) => {
      setConfig(next);
      if (!hydratedRef.current) {
        hydratedRef.current = true;
        setPrazoText(String(next.prazoPadraoDiasUteis));
        setFeriados(sortDates(next.feriadosNacionais));
        setCoordenacaoNotificacaoUids(
          sortTextValues(next.coordenacaoNotificacaoDistribuidorUids)
        );
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = subscribeAllUsers((list) => setUsers(list));
    return () => unsub();
  }, []);

  // Auto-dismiss toast.
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(id);
  }, [toast]);

  function showSuccess(message: string) {
    setToast({ kind: 'success', message });
  }

  function showError(message: string) {
    setToast({ kind: 'error', message });
  }

  // ----- Prazo card -----

  const prazoTextTrim = prazoText.trim();
  const prazoNumber =
    prazoTextTrim === '' ? NaN : Number.parseInt(prazoTextTrim, 10);
  const prazoInvalid =
    prazoTextTrim === '' || Number.isNaN(prazoNumber) || prazoNumber < 1;
  const prazoChanged =
    !prazoInvalid &&
    config !== null &&
    prazoNumber !== config.prazoPadraoDiasUteis;

  async function handleSavePrazo() {
    if (!meUid) {
      showError('Usuário não autenticado.');
      return;
    }
    if (prazoInvalid) {
      showError('Informe um número inteiro maior ou igual a 1.');
      return;
    }
    setSavingPrazo(true);
    try {
      await updateConfigSistema(
        { prazoPadraoDiasUteis: prazoNumber },
        meUid,
        meNome
      );
      showSuccess('Prazo padrão salvo.');
    } catch (err) {
      showError(`Falha ao salvar prazo: ${readErrorMessage(err)}`);
    } finally {
      setSavingPrazo(false);
    }
  }

  // ----- Feriados card -----

  const feriadosSorted = useMemo(() => sortDates(feriados), [feriados]);

  const feriadosChanged = useMemo(() => {
    if (!config) return false;
    const a = sortDates(config.feriadosNacionais);
    const b = feriadosSorted;
    if (a.length !== b.length) return true;
    return a.some((v, i) => v !== b[i]);
  }, [config, feriadosSorted]);

  function handleAddDate() {
    if (!isValidIsoDate(newDate)) {
      showError('Selecione uma data válida.');
      return;
    }
    if (feriados.includes(newDate)) {
      showError('Essa data já está na lista.');
      return;
    }
    setFeriados((prev) => sortDates([...prev, newDate]));
    setNewDate('');
  }

  function handleRemoveDate(date: string) {
    setFeriados((prev) => prev.filter((d) => d !== date));
  }

  function handlePrePopulate2026() {
    setFeriados((prev) => {
      const merged = new Set([...prev, ...FERIADOS_BR_2026]);
      return sortDates(Array.from(merged));
    });
  }

  async function handleSaveFeriados() {
    if (!meUid) {
      showError('Usuário não autenticado.');
      return;
    }
    setSavingFeriados(true);
    try {
      await updateConfigSistema(
        { feriadosNacionais: feriadosSorted },
        meUid,
        meNome
      );
      showSuccess('Feriados nacionais salvos.');
    } catch (err) {
      showError(`Falha ao salvar feriados: ${readErrorMessage(err)}`);
    } finally {
      setSavingFeriados(false);
    }
  }

  // ----- Coordenação notifications card -----

  const distribuidoresNotificacao = useMemo(
    () =>
      (users ?? [])
        .filter(
          (user) =>
            user.role === 'distribuidor' &&
            user.approved === true &&
            user.ativo !== false
        )
        .sort((a, b) =>
          a.displayName.localeCompare(b.displayName, 'pt-BR', {
            sensitivity: 'base',
          })
        ),
    [users]
  );

  const coordenacaoNotificacaoChanged = useMemo(() => {
    if (!config) return false;
    return !sameStringSet(
      config.coordenacaoNotificacaoDistribuidorUids,
      coordenacaoNotificacaoUids
    );
  }, [config, coordenacaoNotificacaoUids]);

  const coordenacaoNotificacaoSelected = useMemo(
    () => new Set(coordenacaoNotificacaoUids),
    [coordenacaoNotificacaoUids]
  );

  function toggleCoordenacaoNotificacaoUid(uid: string) {
    setCoordenacaoNotificacaoUids((prev) => {
      if (prev.includes(uid)) {
        return prev.filter((value) => value !== uid);
      }
      return sortTextValues([...prev, uid]);
    });
  }

  function selectAllCoordenacaoNotificacoes() {
    setCoordenacaoNotificacaoUids(
      sortTextValues(distribuidoresNotificacao.map((user) => user.uid))
    );
  }

  function clearCoordenacaoNotificacoes() {
    setCoordenacaoNotificacaoUids([]);
  }

  async function handleSaveCoordenacaoNotificacoes() {
    if (!meUid) {
      showError('Usuário não autenticado.');
      return;
    }
    setSavingCoordenacaoNotificacoes(true);
    try {
      await updateConfigSistema(
        {
          coordenacaoNotificacaoDistribuidorUids: sortTextValues(
            coordenacaoNotificacaoUids
          ),
        },
        meUid,
        meNome
      );
      showSuccess('Avisos da coordenação salvos.');
    } catch (err) {
      showError(`Falha ao salvar avisos: ${readErrorMessage(err)}`);
    } finally {
      setSavingCoordenacaoNotificacoes(false);
    }
  }

  // ----- Super-admins card (read-only) -----

  const superAdminEmails = useMemo(() => getSuperAdminEmails(), []);

  // ----- Render -----

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-ink-primary">
          Configurações do sistema
        </h1>
        <p className="text-sm text-ink-secondary">
          Defina o prazo padrão, os feriados nacionais, os avisos da coordenação e visualize quem é super-administrador.
        </p>
      </header>

      <Toast toast={toast} onDismiss={() => setToast(null)} />

      {config === null ? (
        <div className="flex items-center justify-center rounded-lg border border-gray-200 bg-surface px-4 py-12 text-sm text-ink-secondary">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Carregando configurações...
        </div>
      ) : (
        <>
          {/* Prazo padrão */}
          <section className="space-y-4 rounded-lg border border-gray-200 bg-surface p-5 shadow-sm">
            <div>
              <h2 className="text-base font-semibold text-ink-primary">
                Prazo padrão de processos
              </h2>
              <p className="mt-1 text-sm text-ink-secondary">
                Prazo aplicado a origens que não tenham override próprio.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label
                  htmlFor="prazo-padrao"
                  className="block text-sm font-medium text-ink-primary"
                >
                  Prazo padrão (dias úteis)
                </label>
                <input
                  id="prazo-padrao"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={prazoText}
                  onChange={(e) => setPrazoText(e.target.value)}
                  disabled={savingPrazo}
                  className="mt-1 w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm text-ink-primary focus:border-brand-primary focus:ring-1 focus:ring-brand-primary disabled:opacity-50"
                />
                {prazoInvalid && (
                  <p className="mt-1 text-xs text-state-danger">
                    Informe um número inteiro maior ou igual a 1.
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={handleSavePrazo}
                disabled={savingPrazo || prazoInvalid || !prazoChanged}
                className="rounded-md bg-brand-primary px-3 py-2 text-sm font-semibold text-white hover:bg-brand-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingPrazo ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </section>

          {/* Feriados nacionais */}
          <section className="space-y-4 rounded-lg border border-gray-200 bg-surface p-5 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-ink-primary">
                  Feriados nacionais
                </h2>
                <p className="mt-1 text-sm text-ink-secondary">
                  Datas que serão excluídas do cálculo de prazos em dias úteis.
                </p>
              </div>
              {feriados.length === 0 && (
                <button
                  type="button"
                  onClick={handlePrePopulate2026}
                  className="self-start rounded-md border border-brand-primary px-3 py-2 text-sm font-medium text-brand-primary hover:bg-brand-primary-light/40 sm:self-auto"
                >
                  Pré-popular feriados de 2026
                </button>
              )}
            </div>

            {/* List */}
            {feriadosSorted.length === 0 ? (
              <div className="rounded-md border border-dashed border-gray-200 bg-surface px-4 py-8 text-center text-sm text-ink-secondary">
                Nenhum feriado cadastrado. Adicione manualmente abaixo ou
                pré-popule com a lista oficial de 2026.
              </div>
            ) : (
              <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
                {feriadosSorted.map((d) => {
                  const label = FERIADOS_BR_2026_LABELS[d];
                  return (
                    <li
                      key={d}
                      className="flex items-center justify-between gap-3 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <span className="text-sm font-medium text-ink-primary">
                          {formatIsoToBr(d)}
                        </span>
                        {label && (
                          <span className="ml-2 text-xs text-ink-secondary">
                            {label}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveDate(d)}
                        disabled={savingFeriados}
                        className="inline-flex items-center gap-1 rounded-md p-1.5 text-ink-secondary hover:bg-rose-50 hover:text-state-danger disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label={`Remover ${formatIsoToBr(d)}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Add row */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label
                  htmlFor="feriado-novo"
                  className="block text-sm font-medium text-ink-primary"
                >
                  Adicionar feriado
                </label>
                <input
                  id="feriado-novo"
                  type="date"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  disabled={savingFeriados}
                  className="mt-1 w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm text-ink-primary focus:border-brand-primary focus:ring-1 focus:ring-brand-primary disabled:opacity-50"
                />
              </div>
              <button
                type="button"
                onClick={handleAddDate}
                disabled={savingFeriados || !newDate}
                className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-surface px-3 py-2 text-sm font-medium text-ink-primary hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
                Adicionar
              </button>
            </div>

            <div className="flex justify-end border-t border-gray-200 pt-3">
              <button
                type="button"
                onClick={handleSaveFeriados}
                disabled={savingFeriados || !feriadosChanged}
                className="rounded-md bg-brand-primary px-3 py-2 text-sm font-semibold text-white hover:bg-brand-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingFeriados ? 'Salvando...' : 'Salvar feriados'}
              </button>
            </div>
          </section>

          {/* Avisos da coordenação */}
          <section className="space-y-4 rounded-lg border border-gray-200 bg-surface p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <Bell className="mt-0.5 h-5 w-5 text-brand-primary" />
                <div>
                  <h2 className="text-base font-semibold text-ink-primary">
                    Avisos da coordenação
                  </h2>
                  <p className="mt-1 text-sm text-ink-secondary">
                    Distribuidores selecionados receberão uma janela imediata
                    quando um processo for enviado para coordenação.
                  </p>
                </div>
              </div>
              <span className="self-start rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-ink-secondary">
                {coordenacaoNotificacaoUids.length} selecionado
                {coordenacaoNotificacaoUids.length === 1 ? '' : 's'}
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={selectAllCoordenacaoNotificacoes}
                disabled={
                  savingCoordenacaoNotificacoes ||
                  users === null ||
                  distribuidoresNotificacao.length === 0
                }
                className="rounded-md border border-gray-300 bg-surface px-3 py-2 text-sm font-medium text-ink-primary hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Selecionar todos
              </button>
              <button
                type="button"
                onClick={clearCoordenacaoNotificacoes}
                disabled={
                  savingCoordenacaoNotificacoes ||
                  coordenacaoNotificacaoUids.length === 0
                }
                className="rounded-md border border-gray-300 bg-surface px-3 py-2 text-sm font-medium text-ink-primary hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Limpar seleção
              </button>
            </div>

            {users === null ? (
              <div className="flex items-center rounded-md border border-gray-200 px-4 py-6 text-sm text-ink-secondary">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Carregando distribuidores...
              </div>
            ) : distribuidoresNotificacao.length === 0 ? (
              <div className="rounded-md border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-ink-secondary">
                Nenhum distribuidor ativo encontrado.
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto rounded-md border border-gray-200">
                <ul className="divide-y divide-gray-100">
                  {distribuidoresNotificacao.map((user) => {
                    const checked = coordenacaoNotificacaoSelected.has(
                      user.uid
                    );
                    return (
                      <li key={user.uid}>
                        <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-gray-50">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              toggleCoordenacaoNotificacaoUid(user.uid)
                            }
                            disabled={savingCoordenacaoNotificacoes}
                            className="h-4 w-4 rounded border-gray-300 text-brand-primary focus:ring-brand-primary"
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-ink-primary">
                              {user.displayName}
                            </span>
                            <span className="block truncate text-xs text-ink-secondary">
                              {user.email}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <div className="flex justify-end border-t border-gray-200 pt-3">
              <button
                type="button"
                onClick={handleSaveCoordenacaoNotificacoes}
                disabled={
                  savingCoordenacaoNotificacoes ||
                  !coordenacaoNotificacaoChanged
                }
                className="rounded-md bg-brand-primary px-3 py-2 text-sm font-semibold text-white hover:bg-brand-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingCoordenacaoNotificacoes
                  ? 'Salvando...'
                  : 'Salvar avisos'}
              </button>
            </div>
          </section>

          {/* Super-administradores (read-only) */}
          <section className="space-y-4 rounded-lg border border-gray-200 bg-surface p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 text-brand-primary" />
              <div>
                <h2 className="text-base font-semibold text-ink-primary">
                  Super-administradores
                </h2>
                <p className="mt-1 text-sm text-ink-secondary">
                  Super-administradores são definidos via configuração de ambiente e entram automaticamente como Distribuidores aprovados.
                </p>
              </div>
            </div>

            {superAdminEmails.length === 0 ? (
              <div className="rounded-md border border-dashed border-gray-200 bg-surface px-4 py-6 text-center text-sm text-ink-secondary">
                Nenhum super-administrador definido na variável{' '}
                <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs">
                  VITE_SUPER_ADMINS
                </code>
                .
              </div>
            ) : (
              <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
                {superAdminEmails.map((email) => (
                  <li
                    key={email}
                    className="flex items-center justify-between px-3 py-2 text-sm text-ink-primary"
                  >
                    <span className="truncate">{email}</span>
                    <span className="ml-3 inline-flex items-center rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                      super-admin
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
