import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Inbox,
  Loader2,
  MessageSquare,
  Plus,
  Search,
  Send,
  Trash2,
} from 'lucide-react';
import { useAuth } from '@/store/authStore';
import { usePageTitle } from '@/lib/usePageTitle';
import { formatDateBr } from '@/lib/datetime';
import {
  SUPORTE_STATUS_OPTIONS,
  getSuporteStatusBadgeClass,
  getSuporteStatusLabel,
  getSuporteTipoLabel,
  podeGerenciarSuporte,
} from '@/lib/suporte';
import {
  adicionarComentario,
  criarChamado,
  excluirChamado,
  excluirComentario,
  mudarStatus,
  subscribeChamado,
  subscribeChamados,
  subscribeComentarios,
} from '@/services/firebase/suporte';
import { useAnexos, arquivosDeImagemDoClipboard } from '@/components/suporte/useAnexos';
import AnexoUploader from '@/components/suporte/AnexoUploader';
import AnexoList from '@/components/suporte/AnexoList';
import Modal from '@/components/Modal';
import ConfirmDialog, {
  type ConfirmDialogState,
} from '@/components/ConfirmDialog';
import Toast, { type ToastState } from '@/components/Toast';
import type {
  SuporteComentario,
  SuporteStatus,
  SuporteTicket,
  SuporteTipo,
} from '@/types';

function readErr(e: unknown): string {
  return e instanceof Error ? e.message : 'Ocorreu um erro inesperado.';
}

function StatusBadge({ status }: { status: SuporteStatus }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.3px] ${getSuporteStatusBadgeClass(
        status
      )}`}
    >
      {getSuporteStatusLabel(status)}
    </span>
  );
}

function TipoBadge({ tipo }: { tipo: SuporteTipo }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        tipo === 'sugestao'
          ? 'bg-brand-primary/10 text-brand-primary'
          : 'bg-slate-100 text-slate-700'
      }`}
    >
      {getSuporteTipoLabel(tipo)}
    </span>
  );
}

export default function Suporte() {
  usePageTitle('Suporte');
  const { userDoc, firebaseUser } = useAuth();
  const role = userDoc?.role ?? null;
  const uid = userDoc?.uid ?? firebaseUser?.uid ?? '';
  const nome = userDoc?.displayName ?? firebaseUser?.displayName ?? 'Usuário';
  const email = userDoc?.email ?? firebaseUser?.email ?? '';
  const isCoord = podeGerenciarSuporte(role);

  const [searchParams, setSearchParams] = useSearchParams();
  const ticketParam = searchParams.get('ticket');

  const [tickets, setTickets] = useState<SuporteTicket[] | null>(null);
  const [novoOpen, setNovoOpen] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  const [filtroStatus, setFiltroStatus] = useState<'todos' | SuporteStatus>(
    'todos'
  );
  const [filtroTipo, setFiltroTipo] = useState<'todos' | SuporteTipo>('todos');
  const [busca, setBusca] = useState('');

  useEffect(() => {
    if (!uid) return;
    const unsub = subscribeChamados({ role, uid }, setTickets);
    return () => unsub();
  }, [uid, role]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const showSuccess = (m: string) => setToast({ kind: 'success', message: m });
  const showError = (m: string) => setToast({ kind: 'error', message: m });

  const ticketsFiltrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (tickets ?? []).filter((t) => {
      if (filtroStatus !== 'todos' && t.status !== filtroStatus) return false;
      if (filtroTipo !== 'todos' && t.tipo !== filtroTipo) return false;
      if (
        termo &&
        !t.titulo.toLowerCase().includes(termo) &&
        !t.descricao.toLowerCase().includes(termo) &&
        !t.criadoPorNome.toLowerCase().includes(termo)
      ) {
        return false;
      }
      return true;
    });
  }, [tickets, filtroStatus, filtroTipo, busca]);

  function abrirChamado(id: string) {
    setSearchParams({ ticket: id });
  }
  function voltar() {
    setSearchParams({});
  }

  return (
    <div className="space-y-5">
      <div className="pointer-events-none fixed inset-x-0 top-16 z-40 flex justify-center px-4">
        <div className="pointer-events-auto">
          <Toast toast={toast} onDismiss={() => setToast(null)} />
        </div>
      </div>

      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink-primary">Suporte</h1>
          <p className="mt-1 text-sm text-ink-secondary">
            {isCoord
              ? 'Chamados e sugestões de todos os usuários.'
              : 'Abra um chamado de suporte ou envie uma sugestão.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setNovoOpen(true)}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md bg-brand-primary px-4 py-2 text-sm font-semibold text-white hover:bg-brand-primary-dark"
        >
          <Plus className="h-4 w-4" />
          Novo chamado
        </button>
      </header>

      {ticketParam ? (
        <TicketDetail
          ticketId={ticketParam}
          isCoord={isCoord}
          uid={uid}
          nome={nome}
          role={role}
          onVoltar={voltar}
          onSuccess={showSuccess}
          onError={showError}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary" />
              <input
                type="search"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por título, texto ou autor"
                className="h-10 w-full rounded-md border border-gray-300 bg-surface pl-9 pr-3 text-sm text-ink-primary"
              />
            </div>
            <select
              value={filtroTipo}
              onChange={(e) =>
                setFiltroTipo(e.target.value as 'todos' | SuporteTipo)
              }
              className="h-10 rounded-md border border-gray-300 bg-surface px-2 text-sm text-ink-primary"
            >
              <option value="todos">Todos os tipos</option>
              <option value="suporte">Suporte</option>
              <option value="sugestao">Sugestão</option>
            </select>
            <select
              value={filtroStatus}
              onChange={(e) =>
                setFiltroStatus(e.target.value as 'todos' | SuporteStatus)
              }
              className="h-10 rounded-md border border-gray-300 bg-surface px-2 text-sm text-ink-primary"
            >
              <option value="todos">Todos os status</option>
              {SUPORTE_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {tickets === null ? (
            <div className="flex items-center justify-center rounded-lg border border-gray-200 bg-surface px-4 py-12 text-sm text-ink-secondary">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Carregando chamados...
            </div>
          ) : ticketsFiltrados.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-gray-300 bg-surface px-4 py-12 text-center">
              <Inbox className="h-8 w-8 text-ink-secondary" />
              <p className="text-sm text-ink-secondary">
                {tickets.length === 0
                  ? 'Nenhum chamado ainda. Clique em "Novo chamado".'
                  : 'Nenhum chamado para os filtros selecionados.'}
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {ticketsFiltrados.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => abrirChamado(t.id)}
                    className="flex w-full flex-col gap-1.5 rounded-lg border border-gray-200 bg-surface p-3 text-left shadow-sm transition-shadow hover:shadow"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <TipoBadge tipo={t.tipo} />
                      <StatusBadge status={t.status} />
                      <span className="ml-auto text-[11px] text-ink-secondary">
                        {t.ultimaAtividadeEm.toMillis() > 0
                          ? formatDateBr(t.ultimaAtividadeEm.toDate(), 'dd/MM HH:mm')
                          : ''}
                      </span>
                    </div>
                    <span className="font-semibold text-ink-primary">
                      {t.titulo}
                    </span>
                    <span className="flex flex-wrap items-center gap-3 text-xs text-ink-secondary">
                      <span>Por {t.criadoPorNome}</span>
                      {t.comentariosCount > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <MessageSquare className="h-3.5 w-3.5" />
                          {t.comentariosCount}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {novoOpen && (
        <NovoChamadoModal
          uid={uid}
          nome={nome}
          email={email}
          onClose={() => setNovoOpen(false)}
          onCreated={(id) => {
            setNovoOpen(false);
            showSuccess('Chamado criado.');
            abrirChamado(id);
          }}
          onError={showError}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Novo chamado
// ---------------------------------------------------------------------------

function NovoChamadoModal({
  uid,
  nome,
  email,
  onClose,
  onCreated,
  onError,
}: {
  uid: string;
  nome: string;
  email: string;
  onClose: () => void;
  onCreated: (id: string) => void;
  onError: (m: string) => void;
}) {
  const [tipo, setTipo] = useState<SuporteTipo>('suporte');
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [busy, setBusy] = useState(false);
  const { anexos, uploading, erro, adicionarArquivos, remover } = useAnexos(uid);

  async function submit() {
    if (!titulo.trim()) {
      onError('Informe um título.');
      return;
    }
    setBusy(true);
    try {
      const id = await criarChamado({
        tipo,
        titulo,
        descricao,
        anexos,
        byUid: uid,
        byNome: nome,
        byEmail: email,
      });
      onCreated(id);
    } catch (e) {
      onError(readErr(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title="Novo chamado"
      description="Descreva o problema ou a sugestão. Você pode anexar prints e PDFs."
      size="lg"
      busy={busy || uploading}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-gray-300 bg-surface px-4 py-2 text-sm font-medium text-ink-primary hover:bg-gray-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || uploading}
            className="inline-flex items-center gap-2 rounded-md bg-brand-primary px-4 py-2 text-sm font-semibold text-white hover:bg-brand-primary-dark disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Abrir chamado
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <span className="mb-1 block text-sm font-medium text-ink-primary">
            Tipo
          </span>
          <div className="flex gap-2">
            {(['suporte', 'sugestao'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTipo(t)}
                className={`rounded-md border px-3 py-2 text-sm font-semibold ${
                  tipo === t
                    ? 'border-brand-primary bg-brand-primary-light text-brand-primary-dark'
                    : 'border-gray-300 bg-surface text-ink-primary hover:bg-gray-50'
                }`}
              >
                {getSuporteTipoLabel(t)}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink-primary">
            Título
          </span>
          <input
            type="text"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            maxLength={140}
            className="h-10 w-full rounded-md border border-gray-300 bg-surface px-3 text-sm text-ink-primary"
            placeholder="Resumo do chamado"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink-primary">
            Descrição
          </span>
          <textarea
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            onPaste={(e) => {
              const imgs = arquivosDeImagemDoClipboard(e);
              if (imgs.length > 0) void adicionarArquivos(imgs);
            }}
            rows={6}
            className="w-full rounded-md border border-gray-300 bg-surface px-3 py-2 text-sm text-ink-primary"
            placeholder="Descreva com detalhes. Cole prints aqui (Ctrl+V) se quiser."
          />
        </label>

        <AnexoUploader
          anexos={anexos}
          uploading={uploading}
          erro={erro}
          onPick={(files) => void adicionarArquivos(files)}
          onRemove={remover}
        />
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Detalhe do chamado
// ---------------------------------------------------------------------------

function TicketDetail({
  ticketId,
  isCoord,
  uid,
  nome,
  role,
  onVoltar,
  onSuccess,
  onError,
}: {
  ticketId: string;
  isCoord: boolean;
  uid: string;
  nome: string;
  role: string | null;
  onVoltar: () => void;
  onSuccess: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [ticket, setTicket] = useState<SuporteTicket | null | undefined>(
    undefined
  );
  const [comentarios, setComentarios] = useState<SuporteComentario[]>([]);
  const [confirm, setConfirm] = useState<ConfirmDialogState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);

  useEffect(() => subscribeChamado(ticketId, setTicket), [ticketId]);
  useEffect(() => subscribeComentarios(ticketId, setComentarios), [ticketId]);

  async function onMudarStatus(status: SuporteStatus) {
    setSavingStatus(true);
    try {
      await mudarStatus({ ticketId, status, byUid: uid });
    } catch (e) {
      onError(readErr(e));
    } finally {
      setSavingStatus(false);
    }
  }

  function confirmarExcluirChamado() {
    setConfirm({
      title: 'Excluir chamado?',
      message: 'O chamado e seus comentários serão removidos permanentemente.',
      confirmLabel: 'Excluir',
      destructive: true,
      onConfirm: async () => {
        setConfirmBusy(true);
        try {
          await excluirChamado(ticketId);
          setConfirm(null);
          onSuccess('Chamado excluído.');
          onVoltar();
        } catch (e) {
          onError(readErr(e));
        } finally {
          setConfirmBusy(false);
        }
      },
    });
  }

  function confirmarExcluirComentario(cid: string) {
    setConfirm({
      title: 'Excluir comentário?',
      message: 'O comentário será removido permanentemente.',
      confirmLabel: 'Excluir',
      destructive: true,
      onConfirm: async () => {
        setConfirmBusy(true);
        try {
          await excluirComentario(ticketId, cid);
          setConfirm(null);
        } catch (e) {
          onError(readErr(e));
        } finally {
          setConfirmBusy(false);
        }
      },
    });
  }

  if (ticket === undefined) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-gray-200 bg-surface px-4 py-12 text-sm text-ink-secondary">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Carregando chamado...
      </div>
    );
  }

  if (ticket === null) {
    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={onVoltar}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-primary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </button>
        <p className="rounded-md border border-dashed border-gray-300 bg-surface px-4 py-6 text-center text-sm text-ink-secondary">
          Chamado não encontrado ou sem acesso.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onVoltar}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-primary hover:underline"
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar para a lista
      </button>

      <article className="rounded-lg border border-gray-200 bg-surface p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <TipoBadge tipo={ticket.tipo} />
          <StatusBadge status={ticket.status} />
          <span className="ml-auto text-[11px] text-ink-secondary">
            {ticket.criadoEm.toMillis() > 0
              ? formatDateBr(ticket.criadoEm.toDate(), 'dd/MM/yyyy HH:mm')
              : ''}
          </span>
        </div>
        <h2 className="mt-2 text-lg font-semibold text-ink-primary">
          {ticket.titulo}
        </h2>
        <p className="mt-0.5 text-xs text-ink-secondary">
          Aberto por {ticket.criadoPorNome}
        </p>
        {ticket.descricao && (
          <p className="mt-3 whitespace-pre-wrap break-words text-sm text-ink-primary">
            {ticket.descricao}
          </p>
        )}
        <AnexoList anexos={ticket.anexos} />

        {isCoord && (
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-3">
            <label className="inline-flex items-center gap-2 text-sm text-ink-secondary">
              Status:
              <select
                value={ticket.status}
                disabled={savingStatus}
                onChange={(e) =>
                  void onMudarStatus(e.target.value as SuporteStatus)
                }
                className="h-9 rounded-md border border-gray-300 bg-surface px-2 text-sm text-ink-primary disabled:opacity-50"
              >
                {SUPORTE_STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={confirmarExcluirChamado}
              className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-2 text-xs font-semibold text-state-danger hover:bg-rose-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Excluir chamado
            </button>
          </div>
        )}
      </article>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-ink-primary">
          Comentários ({comentarios.length})
        </h3>
        {comentarios.length === 0 ? (
          <p className="rounded-md border border-dashed border-gray-200 bg-surface px-4 py-5 text-center text-sm italic text-ink-secondary">
            Sem comentários ainda.
          </p>
        ) : (
          <ul className="space-y-2">
            {comentarios.map((c) => (
              <li
                key={c.id}
                className="rounded-lg border border-gray-200 bg-surface p-3"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-ink-primary">
                    {c.autorNome}
                  </span>
                  <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-secondary">
                    {c.autorRole === 'distribuidor' ? 'Coordenação' : 'Recebedor'}
                  </span>
                  <span className="text-[11px] text-ink-secondary">
                    {c.criadoEm.toMillis() > 0
                      ? formatDateBr(c.criadoEm.toDate(), 'dd/MM HH:mm')
                      : ''}
                  </span>
                  {isCoord && (
                    <button
                      type="button"
                      aria-label="Excluir comentário"
                      onClick={() => confirmarExcluirComentario(c.id)}
                      className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-secondary hover:bg-rose-50 hover:text-state-danger"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {c.texto && (
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink-primary">
                    {c.texto}
                  </p>
                )}
                <AnexoList anexos={c.anexos} />
              </li>
            ))}
          </ul>
        )}

        <ComentarioComposer
          ticketId={ticketId}
          uid={uid}
          nome={nome}
          autorRole={role === 'distribuidor' ? 'distribuidor' : 'recebedor'}
          onError={onError}
        />
      </section>

      {confirm && (
        <ConfirmDialog
          state={confirm}
          busy={confirmBusy}
          onCancel={() => setConfirm(null)}
          onConfirm={confirm.onConfirm}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compositor de comentário
// ---------------------------------------------------------------------------

function ComentarioComposer({
  ticketId,
  uid,
  nome,
  autorRole,
  onError,
}: {
  ticketId: string;
  uid: string;
  nome: string;
  autorRole: 'recebedor' | 'distribuidor';
  onError: (m: string) => void;
}) {
  const [texto, setTexto] = useState('');
  const [busy, setBusy] = useState(false);
  const { anexos, uploading, erro, adicionarArquivos, remover, reset } =
    useAnexos(uid);

  async function enviar() {
    if (!texto.trim() && anexos.length === 0) {
      onError('Escreva uma mensagem ou anexe um arquivo.');
      return;
    }
    setBusy(true);
    try {
      await adicionarComentario({
        ticketId,
        texto,
        anexos,
        autorUid: uid,
        autorNome: nome,
        autorRole,
      });
      setTexto('');
      reset();
    } catch (e) {
      onError(readErr(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-surface p-3">
      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onPaste={(e) => {
          const imgs = arquivosDeImagemDoClipboard(e);
          if (imgs.length > 0) void adicionarArquivos(imgs);
        }}
        rows={3}
        className="w-full rounded-md border border-gray-300 bg-surface px-3 py-2 text-sm text-ink-primary"
        placeholder="Escreva um comentário... (cole prints com Ctrl+V)"
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <AnexoUploader
          anexos={anexos}
          uploading={uploading}
          erro={erro}
          onPick={(files) => void adicionarArquivos(files)}
          onRemove={remover}
        />
        <button
          type="button"
          onClick={() => void enviar()}
          disabled={busy || uploading}
          className="inline-flex min-h-[40px] items-center gap-2 rounded-md bg-brand-primary px-4 py-2 text-sm font-semibold text-white hover:bg-brand-primary-dark disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          Enviar
        </button>
      </div>
    </div>
  );
}
