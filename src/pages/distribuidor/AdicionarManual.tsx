import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MutableRefObject,
} from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CalendarClock,
  ClipboardList,
  Database,
  Eraser,
  Flame,
  Info,
  Loader2,
  Plus,
  ShieldAlert,
  Star,
  UserRoundCheck,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/store/authStore';
import { subscribeAllUsers } from '@/services/firebase/users';
import { subscribeAgrupadores } from '@/services/firebase/agrupadores';
import { subscribeConfigSistema } from '@/services/firebase/sistema-config';
import { createProcessoManual } from '@/services/firebase/processos';
import {
  addDiasUteis,
  formatDateBr,
  nowInSp,
  proximaOcorrenciaDia,
} from '@/lib/datetime';
import { usePageTitle } from '@/lib/usePageTitle';
import type {
  Agrupador,
  ConfigSistema,
  DiaSemana,
  ProcessoRegime,
  User,
} from '@/types';
import Toast, { type ToastState } from '@/components/Toast';

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

/** Flexible CNJ regex (allows leading whitespace stripped). */
const CNJ_REGEX = /^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/;

const DIA_LABEL_SHORT: Record<DiaSemana, string> = {
  segunda: 'Segunda',
  terca: 'Terça',
  quarta: 'Quarta',
  quinta: 'Quinta',
  sexta: 'Sexta',
};

const REGIME_LABEL: Record<ProcessoRegime, string> = {
  aberto: 'Regime aberto',
  fechado: 'Regime fechado',
};

const ORIGEM_OPCIONAL_LABEL = 'Sem origem';

type Quando = 'hoje' | DiaSemana;

const QUANDO_OPCOES: ReadonlyArray<{ value: Quando; label: string }> = [
  { value: 'hoje', label: 'Hoje' },
  { value: 'segunda', label: 'Segunda-feira' },
  { value: 'terca', label: 'Terça-feira' },
  { value: 'quarta', label: 'Quarta-feira' },
  { value: 'quinta', label: 'Quinta-feira' },
  { value: 'sexta', label: 'Sexta-feira' },
];

function readErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Ocorreu um erro inesperado.';
}

/** Maps a JS getDay() in 0..6 to our DiaSemana, returning null for Sat/Sun. */
function diaSemanaFromDate(date: Date): DiaSemana | null {
  switch (date.getDay()) {
    case 1:
      return 'segunda';
    case 2:
      return 'terca';
    case 3:
      return 'quarta';
    case 4:
      return 'quinta';
    case 5:
      return 'sexta';
    default:
      return null;
  }
}

interface AtribuicaoCalculada {
  /** Date the processo will be assigned to (zeroed time, SP TZ). */
  diaAtribuicao: Date;
  /** DiaSemana stored in Firestore (always Mon-Fri). */
  diaSemana: DiaSemana;
  /** Whether "Hoje" was rolled forward because today is Sat/Sun. */
  rolledForwardFromWeekend: boolean;
}

/**
 * Resolves the Quando option to a concrete diaAtribuicao + diaSemana.
 *
 * - "hoje": uses today (SP TZ). If today is Sat/Sun, rolls forward to Monday.
 * - DiaSemana: uses next occurrence of that weekday (today if today matches).
 */
function resolverAtribuicao(quando: Quando, base: Date): AtribuicaoCalculada {
  if (quando === 'hoje') {
    const dia = diaSemanaFromDate(base);
    if (dia !== null) {
      return {
        diaAtribuicao: base,
        diaSemana: dia,
        rolledForwardFromWeekend: false,
      };
    }
    // Sat/Sun: roll forward to next Monday.
    const segunda = proximaOcorrenciaDia('segunda', base);
    return {
      diaAtribuicao: segunda,
      diaSemana: 'segunda',
      rolledForwardFromWeekend: true,
    };
  }
  const target = proximaOcorrenciaDia(quando, base);
  return {
    diaAtribuicao: target,
    diaSemana: quando,
    rolledForwardFromWeekend: false,
  };
}

function recebedorPodeReceberAgrupador(
  recebedor: User,
  agrupadorId: string
): boolean {
  if (
    recebedor.role === 'distribuidor' &&
    recebedor.agrupadoresMode !== 'especificos'
  ) {
    return true;
  }
  if (recebedor.agrupadoresMode === 'todos') return true;
  if (recebedor.agrupadoresMode === 'especificos') {
    return recebedor.agrupadoresPermitidos.includes(agrupadorId);
  }
  return false;
}

/** Strips spaces/tabs from a CNJ-ish string typed by the user. */
function normalizeNumero(raw: string): string {
  return raw.trim();
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AdicionarManual() {
  usePageTitle('Adicionar processo manual');
  const { firebaseUser, userDoc } = useAuth();
  const meUid = firebaseUser?.uid ?? null;
  const meNome =
    userDoc?.displayName ?? firebaseUser?.displayName ?? 'Usuário';

  // Real-time data
  const [users, setUsers] = useState<User[] | null>(null);
  const [agrupadores, setAgrupadores] = useState<Agrupador[] | null>(null);
  const [config, setConfig] = useState<ConfigSistema | null>(null);

  // Form state
  const [numero, setNumero] = useState('');
  const [agrupadorId, setAgrupadorId] = useState('');
  const [recebedorUid, setRecebedorUid] = useState('');
  const [regime, setRegime] = useState<ProcessoRegime>('aberto');
  const [urgente, setUrgente] = useState(false);
  const [prioridade, setPrioridade] = useState(false);
  const [quando, setQuando] = useState<Quando>('hoje');
  const [observacao, setObservacao] = useState('');
  const [manterRecebedor, setManterRecebedor] = useState(false);

  // UX state
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  const numeroInputRef = useRef<HTMLInputElement | null>(null);

  // ----- Subscriptions -----
  useEffect(() => {
    const unsubUsers = subscribeAllUsers((list) => setUsers(list));
    const unsubAgrupadores = subscribeAgrupadores((list) =>
      setAgrupadores(list)
    );
    const unsubConfig = subscribeConfigSistema((c) => setConfig(c));
    return () => {
      unsubUsers();
      unsubAgrupadores();
      unsubConfig();
    };
  }, []);

  // Auto-dismiss toast.
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(id);
  }, [toast]);

  // Auto-focus numero input on mount.
  useEffect(() => {
    numeroInputRef.current?.focus();
  }, []);

  // ----- Derived data -----

  const agrupadoresAtivos = useMemo(
    () => (agrupadores ?? []).filter((a) => a.ativo),
    [agrupadores]
  );

  const recebedoresAtivos = useMemo(
    () =>
      (users ?? []).filter(
        (u) =>
          (u.role === 'recebedor' || u.role === 'distribuidor') &&
          u.approved &&
          u.ativo
      ),
    [users]
  );

  const recebedorSelecionado = useMemo(
    () => recebedoresAtivos.find((u) => u.uid === recebedorUid) ?? null,
    [recebedoresAtivos, recebedorUid]
  );

  const agrupadorSelecionado = useMemo(
    () => agrupadoresAtivos.find((a) => a.id === agrupadorId) ?? null,
    [agrupadoresAtivos, agrupadorId]
  );

  const numeroNormalizado = normalizeNumero(numero);
  const numeroFormatoOk =
    numeroNormalizado === '' || CNJ_REGEX.test(numeroNormalizado);

  // Permission check (only meaningful when both selected).
  const permissaoOk: boolean =
    !recebedorSelecionado || !agrupadorSelecionado
      ? true
      : recebedorPodeReceberAgrupador(recebedorSelecionado, agrupadorSelecionado.id);

  // Atribuição preview
  const atribuicao = useMemo(() => {
    if (!config) return null;
    const base = nowInSp();
    const calc = resolverAtribuicao(quando, base);
    const prazoDias =
      agrupadorSelecionado?.prazoDiasUteisOverride ??
      config.prazoPadraoDiasUteis;
    const prazoFinal = addDiasUteis(
      calc.diaAtribuicao,
      prazoDias,
      config.feriadosNacionais
    );
    return {
      ...calc,
      prazoDias,
      prazoFinal,
    };
  }, [quando, agrupadorSelecionado, config]);

  // Loading / empty states
  const carregando =
    users === null || agrupadores === null || config === null;

  // Submit-enabled gate
  const camposObrigatoriosPreenchidos =
    numeroNormalizado !== '' &&
    recebedorUid !== '' &&
    atribuicao !== null;

  const submitDisabled =
    submitting ||
    !camposObrigatoriosPreenchidos ||
    !permissaoOk ||
    !meUid;

  // ----- Handlers -----

  function showSuccess(message: string) {
    setToast({ kind: 'success', message });
  }

  function showError(message: string) {
    setToast({ kind: 'error', message });
  }

  function resetForm(opts: { keepRecebedor: boolean; keepAgrupador: boolean }) {
    setNumero('');
    setRegime('aberto');
    setUrgente(false);
    setPrioridade(false);
    setQuando('hoje');
    setObservacao('');
    if (!opts.keepAgrupador) setAgrupadorId('');
    if (!opts.keepRecebedor) setRecebedorUid('');
    // Bring focus back to numero for a fast next entry.
    window.setTimeout(() => numeroInputRef.current?.focus(), 0);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitDisabled) return;
    if (!atribuicao) return;
    if (!recebedorSelecionado) return;
    if (!meUid) return;

    setSubmitting(true);
    try {
      await createProcessoManual({
        numero: numeroNormalizado,
        agrupadorId: agrupadorSelecionado?.id ?? null,
        agrupadorNome: agrupadorSelecionado?.nome ?? null,
        urgente,
        prioridade,
        regime,
        recebedorUid: recebedorSelecionado.uid,
        diaSemana: atribuicao.diaSemana,
        diaAtribuicao: atribuicao.diaAtribuicao,
        prazoFinal: atribuicao.prazoFinal,
        observacao:
          observacao.trim() === '' ? null : observacao.trim(),
        adicionadoPorUid: meUid,
        adicionadoPorNome: meNome,
      });

      showSuccess(
        `Processo adicionado para ${recebedorSelecionado.displayName} em ${
          DIA_LABEL_SHORT[atribuicao.diaSemana]
        } (${formatDateBr(atribuicao.diaAtribuicao)}).`
      );
      resetForm({
        keepRecebedor: manterRecebedor,
        keepAgrupador: manterRecebedor,
      });
    } catch (err) {
      showError(`Falha ao adicionar processo: ${readErrorMessage(err)}`);
    } finally {
      setSubmitting(false);
    }
  }

  function handleClear() {
    if (submitting) return;
    resetForm({ keepRecebedor: false, keepAgrupador: false });
  }

  // ----- Render -----

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink-primary">
            Adicionar processo manual
          </h1>
          <p className="mt-1 text-sm text-ink-secondary">
            Cadastre processos pontuais diretamente no painel de um recebedor,
            com origem opcional, regime, data de atribuição e prazo.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3 lg:w-[520px]">
          <HeaderStat
            icon={Database}
            label="Origens ativas"
            value={carregando ? '...' : agrupadoresAtivos.length}
          />
          <HeaderStat
            icon={UserRoundCheck}
            label="Recebedores"
            value={carregando ? '...' : recebedoresAtivos.length}
          />
          <HeaderStat
            icon={CalendarClock}
            label="Prazo padrão"
            value={carregando ? '...' : `${config?.prazoPadraoDiasUteis ?? 0}d`}
          />
        </div>
      </header>

      <Toast toast={toast} onDismiss={() => setToast(null)} />

      {carregando ? (
        <div className="flex items-center justify-center rounded-lg border border-gray-200 bg-surface px-4 py-12 text-sm text-ink-secondary">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Carregando dados...
        </div>
      ) : (
        <FormCard
          numero={numero}
          numeroInputRef={numeroInputRef}
          numeroFormatoOk={numeroFormatoOk}
          onNumeroChange={setNumero}
          agrupadorId={agrupadorId}
          onAgrupadorChange={setAgrupadorId}
          agrupadoresAtivos={agrupadoresAtivos}
          regime={regime}
          onRegimeChange={setRegime}
          recebedorUid={recebedorUid}
          onRecebedorChange={setRecebedorUid}
          recebedoresAtivos={recebedoresAtivos}
          recebedorSelecionado={recebedorSelecionado}
          agrupadorSelecionado={agrupadorSelecionado}
          permissaoOk={permissaoOk}
          urgente={urgente}
          onUrgenteChange={setUrgente}
          prioridade={prioridade}
          onPrioridadeChange={setPrioridade}
          quando={quando}
          onQuandoChange={setQuando}
          observacao={observacao}
          onObservacaoChange={setObservacao}
          manterRecebedor={manterRecebedor}
          onManterRecebedorChange={setManterRecebedor}
          atribuicao={atribuicao}
          submitting={submitting}
          submitDisabled={submitDisabled}
          onSubmit={handleSubmit}
          onClear={handleClear}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FormCard (presentational sub-component)
// ---------------------------------------------------------------------------

interface FormCardProps {
  numero: string;
  numeroInputRef: MutableRefObject<HTMLInputElement | null>;
  numeroFormatoOk: boolean;
  onNumeroChange: (v: string) => void;
  agrupadorId: string;
  onAgrupadorChange: (v: string) => void;
  agrupadoresAtivos: Agrupador[];
  regime: ProcessoRegime;
  onRegimeChange: (v: ProcessoRegime) => void;
  recebedorUid: string;
  onRecebedorChange: (v: string) => void;
  recebedoresAtivos: User[];
  recebedorSelecionado: User | null;
  agrupadorSelecionado: Agrupador | null;
  permissaoOk: boolean;
  urgente: boolean;
  onUrgenteChange: (v: boolean) => void;
  prioridade: boolean;
  onPrioridadeChange: (v: boolean) => void;
  quando: Quando;
  onQuandoChange: (v: Quando) => void;
  observacao: string;
  onObservacaoChange: (v: string) => void;
  manterRecebedor: boolean;
  onManterRecebedorChange: (v: boolean) => void;
  atribuicao: {
    diaAtribuicao: Date;
    diaSemana: DiaSemana;
    rolledForwardFromWeekend: boolean;
    prazoDias: number;
    prazoFinal: Date;
  } | null;
  submitting: boolean;
  submitDisabled: boolean;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  onClear: () => void;
}

function FormCard(props: FormCardProps) {
  const semAgrupadores = props.agrupadoresAtivos.length === 0;
  const semRecebedores = props.recebedoresAtivos.length === 0;

  return (
    <form
      onSubmit={props.onSubmit}
      className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]"
      noValidate
    >
      <section className="rounded-lg border border-gray-200 bg-surface p-5 shadow-sm">
        <div className="mb-5 flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-brand-primary" />
          <h2 className="text-base font-semibold text-ink-primary">
            Dados do processo
          </h2>
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <div className="xl:col-span-2">
            <label
              htmlFor="numero"
              className="block text-sm font-medium text-ink-primary"
            >
              Número do processo
            </label>
            <input
              id="numero"
              ref={props.numeroInputRef}
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={props.numero}
              onChange={(e) => props.onNumeroChange(e.target.value)}
              placeholder="0000000-00.0000.0.00.0000"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm text-ink-primary focus:border-brand-primary focus:ring-1 focus:ring-brand-primary"
              disabled={props.submitting}
              required
              aria-describedby="numero-hint"
            />
            {!props.numeroFormatoOk && (
              <div
                id="numero-hint"
                className="mt-1 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800"
                role="alert"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Formato CNJ não reconhecido. Você ainda pode salvar, mas
                  confira se o número está correto.
                </span>
              </div>
            )}
          </div>

          <div>
            <label
              htmlFor="agrupador"
              className="block text-sm font-medium text-ink-primary"
            >
              Origem{' '}
              <span className="font-normal text-ink-secondary">(opcional)</span>
            </label>
            <select
              id="agrupador"
              value={props.agrupadorId}
              onChange={(e) => props.onAgrupadorChange(e.target.value)}
              disabled={props.submitting || semAgrupadores}
              className="mt-1 w-full rounded-md border border-gray-300 bg-surface px-3 py-2 text-sm text-ink-primary focus:border-brand-primary focus:ring-1 focus:ring-brand-primary disabled:opacity-50"
            >
              <option value="">Sem origem (prazo padrão)</option>
              {props.agrupadoresAtivos.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nome}
                  {a.prazoDiasUteisOverride !== null
                    ? ` — prazo ${a.prazoDiasUteisOverride}d`
                    : ''}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-ink-secondary">
              {semAgrupadores
                ? 'Nenhuma origem ativa. O processo será salvo sem origem.'
                : 'Deixe vazio para salvar sem origem e usar o prazo padrão.'}
            </p>
          </div>

          <fieldset>
            <legend className="block text-sm font-medium text-ink-primary">
              Regime
            </legend>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {(['aberto', 'fechado'] as ProcessoRegime[]).map((option) => {
                const checked = props.regime === option;
                return (
                  <label
                    key={option}
                    className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                      checked
                        ? 'border-brand-primary bg-brand-primary-light/40 text-ink-primary'
                        : 'border-gray-300 bg-surface text-ink-primary hover:bg-gray-50'
                    } ${props.submitting ? 'opacity-50' : ''}`}
                  >
                    <input
                      type="radio"
                      name="regime"
                      checked={checked}
                      onChange={() => props.onRegimeChange(option)}
                      disabled={props.submitting}
                      className="h-4 w-4 accent-brand-primary"
                    />
                    <span>{REGIME_LABEL[option]}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="xl:col-span-2">
            <label
              htmlFor="observacao"
              className="block text-sm font-medium text-ink-primary"
            >
              Observação{' '}
              <span className="font-normal text-ink-secondary">(opcional)</span>
            </label>
            <textarea
              id="observacao"
              rows={3}
              value={props.observacao}
              onChange={(e) => props.onObservacaoChange(e.target.value)}
              disabled={props.submitting}
              placeholder="Contexto para o recebedor, se necessário."
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-ink-primary focus:border-brand-primary focus:ring-1 focus:ring-brand-primary disabled:opacity-50"
              maxLength={1000}
            />
          </div>
        </div>
      </section>

      <aside className="space-y-4">
        <section className="rounded-lg border border-gray-200 bg-surface p-5 shadow-sm">
          <div className="mb-5 flex items-center gap-2">
            <UserRoundCheck className="h-4 w-4 text-brand-primary" />
            <h2 className="text-base font-semibold text-ink-primary">
              Atribuição
            </h2>
          </div>

          <div className="space-y-4">
            <div>
              <label
                htmlFor="recebedor"
                className="block text-sm font-medium text-ink-primary"
              >
                Recebedor
              </label>
              {semRecebedores ? (
                <div className="mt-1 rounded-md border border-dashed border-gray-200 bg-surface px-3 py-3 text-sm text-ink-secondary">
                  Nenhum recebedor ativo cadastrado.
                </div>
              ) : (
                <select
                  id="recebedor"
                  value={props.recebedorUid}
                  onChange={(e) => props.onRecebedorChange(e.target.value)}
                  disabled={props.submitting}
                  required
                  className="mt-1 w-full rounded-md border border-gray-300 bg-surface px-3 py-2 text-sm text-ink-primary focus:border-brand-primary focus:ring-1 focus:ring-brand-primary disabled:opacity-50"
                >
                  <option value="">Selecione um recebedor...</option>
                  {props.recebedoresAtivos.map((u) => (
                    <option key={u.uid} value={u.uid}>
                      {u.displayName}
                      {u.email ? ` — ${u.email}` : ''}
                    </option>
                  ))}
                </select>
              )}
              {!props.permissaoOk &&
                props.recebedorSelecionado &&
                props.agrupadorSelecionado && (
                  <div
                    className="mt-2 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900"
                    role="alert"
                  >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p>
                        <span className="font-semibold">
                          {props.recebedorSelecionado.displayName}
                        </span>{' '}
                        não recebe processos da origem{' '}
                        <span className="font-semibold">
                          {props.agrupadorSelecionado.nome}
                        </span>
                        .
                      </p>
                      <p className="mt-1 text-xs text-rose-800">
                        Selecione outro recebedor ou ajuste suas permissões.
                      </p>
                    </div>
                  </div>
                )}
            </div>

            <fieldset>
              <legend className="block text-sm font-medium text-ink-primary">
                Quando atribuir
              </legend>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {QUANDO_OPCOES.map((opt) => {
                  const checked = props.quando === opt.value;
                  return (
                    <label
                      key={opt.value}
                      className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                        checked
                          ? 'border-brand-primary bg-brand-primary-light/40 text-ink-primary'
                          : 'border-gray-300 bg-surface text-ink-primary hover:bg-gray-50'
                      } ${props.submitting ? 'opacity-50' : ''}`}
                    >
                      <input
                        type="radio"
                        name="quando"
                        value={opt.value}
                        checked={checked}
                        onChange={() => props.onQuandoChange(opt.value)}
                        disabled={props.submitting}
                        className="h-4 w-4 accent-brand-primary"
                      />
                      <span>{opt.label}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <FlagSwitch
                id="urgente"
                label="Urgente"
                description="Sobe na fila do recebedor."
                icon={Flame}
                checked={props.urgente}
                disabled={props.submitting}
                onChange={props.onUrgenteChange}
              />
              <FlagSwitch
                id="prioridade"
                label="Prioridade"
                description="Destaca sem alterar prazo."
                icon={Star}
                checked={props.prioridade}
                disabled={props.submitting}
                onChange={props.onPrioridadeChange}
              />
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-gray-200 bg-surface p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-brand-primary" />
            <h2 className="text-base font-semibold text-ink-primary">Resumo</h2>
          </div>

          <div className="space-y-3 text-sm">
            <SummaryRow
              label="Processo"
              value={props.numero.trim() || 'Aguardando número'}
              mono={Boolean(props.numero.trim())}
            />
            <SummaryRow
              label="Origem"
              value={props.agrupadorSelecionado?.nome ?? ORIGEM_OPCIONAL_LABEL}
            />
            <SummaryRow label="Regime" value={REGIME_LABEL[props.regime]} />
            <SummaryRow
              label="Recebedor"
              value={props.recebedorSelecionado?.displayName ?? 'Não selecionado'}
            />
            {props.atribuicao && (
              <>
                <SummaryRow
                  label="Atribuição"
                  value={`${formatDateBr(props.atribuicao.diaAtribuicao)} (${DIA_LABEL_SHORT[props.atribuicao.diaSemana]})`}
                />
                <SummaryRow
                  label="Prazo"
                  value={`${formatDateBr(props.atribuicao.prazoFinal)} · ${props.atribuicao.prazoDias} dia${props.atribuicao.prazoDias === 1 ? '' : 's'} útil${props.atribuicao.prazoDias === 1 ? '' : 'eis'}`}
                />
              </>
            )}
          </div>

          {props.atribuicao?.rolledForwardFromWeekend && (
            <div className="mt-4 flex items-start gap-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Hoje é fim de semana. A atribuição foi movida para segunda.
              </span>
            </div>
          )}

          <label className="mt-4 flex cursor-pointer items-center gap-2 text-xs text-ink-secondary">
            <input
              type="checkbox"
              checked={props.manterRecebedor}
              onChange={(e) => props.onManterRecebedorChange(e.target.checked)}
              disabled={props.submitting}
              className="h-3.5 w-3.5 rounded border-gray-300 accent-brand-primary"
            />
            <span>Manter recebedor e origem após adicionar.</span>
          </label>

          <div className="mt-5 flex flex-col-reverse gap-2 border-t border-gray-200 pt-4 sm:flex-row lg:flex-col-reverse xl:flex-row">
            <button
              type="button"
              onClick={props.onClear}
              disabled={props.submitting}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-300 bg-surface px-3 py-2 text-sm font-medium text-ink-primary hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Eraser className="h-4 w-4" />
              Limpar
            </button>
            <button
              type="submit"
              disabled={props.submitDisabled}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-brand-primary px-4 py-2 text-sm font-semibold text-white hover:bg-brand-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
            >
              {props.submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Adicionando...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  Adicionar
                </>
              )}
            </button>
          </div>
        </section>
      </aside>
    </form>
  );
}

interface HeaderStatProps {
  icon: LucideIcon;
  label: string;
  value: number | string;
}

function HeaderStat({ icon: Icon, label, value }: HeaderStatProps) {
  return (
    <div className="rounded-md border border-gray-200 bg-surface px-3 py-2 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-medium text-ink-secondary">
        <Icon className="h-3.5 w-3.5 text-brand-primary" />
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold text-ink-primary">{value}</div>
    </div>
  );
}

interface FlagSwitchProps {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}

function FlagSwitch({
  id,
  label,
  description,
  icon: Icon,
  checked,
  disabled,
  onChange,
}: FlagSwitchProps) {
  return (
    <label
      htmlFor={id}
      className={`flex min-h-[82px] cursor-pointer items-start gap-3 rounded-md border px-3 py-3 transition-colors ${
        checked
          ? 'border-brand-primary bg-brand-primary-light/40'
          : 'border-gray-200 bg-surface hover:bg-gray-50'
      } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-brand-primary"
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-ink-primary">
          <Icon className="h-4 w-4 text-brand-primary" />
          {label}
        </span>
        <span className="mt-1 block text-xs leading-4 text-ink-secondary">
          {description}
        </span>
      </span>
    </label>
  );
}

interface SummaryRowProps {
  label: string;
  value: string;
  mono?: boolean;
}

function SummaryRow({ label, value, mono = false }: SummaryRowProps) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md bg-surface-elevated px-3 py-2">
      <span className="shrink-0 text-ink-secondary">{label}</span>
      <span
        className={`min-w-0 text-right font-semibold text-ink-primary ${
          mono ? 'break-all font-mono text-xs' : ''
        }`}
      >
        {value}
      </span>
    </div>
  );
}
