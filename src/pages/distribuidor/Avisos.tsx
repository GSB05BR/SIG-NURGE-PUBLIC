import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  BellRing,
  Bold,
  Edit3,
  Eye,
  Image as ImageIcon,
  Italic,
  Link,
  List,
  ListOrdered,
  Loader2,
  Megaphone,
  Palette,
  PauseCircle,
  PlayCircle,
  Save,
  Trash2,
  Underline,
  Undo2,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '@/store/authStore';
import {
  createGlobalNotice,
  deleteGlobalNotice,
  listenGlobalNotices,
  setGlobalNoticeActive,
  updateGlobalNotice,
} from '@/services/firebase/global-notices';
import { subscribeAllUsers } from '@/services/firebase/users';
import {
  NOTICE_TARGET_ROLE_LABELS,
  NOTICE_TARGET_ROLES,
  escapeHtml,
  normalizeNoticeTargetRoles,
  normalizeTargetUserUids,
  plainTextToNoticeHtml,
  sanitizeNoticeHtml,
  targetRolesForUsers,
} from '@/lib/global-notices';
import { usePageTitle } from '@/lib/usePageTitle';
import type { GlobalNotice, NoticeTargetRole, User } from '@/types';
import Toast, { type ToastState } from '@/components/Toast';

const PAYLOAD_WARNING_BYTES = 900 * 1024;
const NOTICE_TEXT_COLOR_SWATCHES = [
  '#212121',
  '#c41e3a',
  '#c62828',
  '#f57f17',
  '#1565c0',
  '#2e7d32',
  '#6a1b9a',
];
const NOTICE_FONT_SIZE_OPTIONS = [
  { value: '10px', label: '10' },
  { value: '12px', label: '12' },
  { value: '14px', label: '14' },
  { value: '16px', label: '16' },
  { value: '18px', label: '18' },
  { value: '20px', label: '20' },
  { value: '24px', label: '24' },
  { value: '28px', label: '28' },
  { value: '32px', label: '32' },
  { value: '36px', label: '36' },
  { value: '40px', label: '40' },
  { value: '48px', label: '48' },
];
const NOTICE_IMAGE_SIZE_OPTIONS = [
  { value: '10%', label: '10%' },
  { value: '20%', label: '20%' },
  { value: '25%', label: '25%' },
  { value: '33%', label: '33%' },
  { value: '50%', label: '50%' },
  { value: '67%', label: '67%' },
  { value: '75%', label: '75%' },
  { value: '100%', label: '100%' },
];
const DEFAULT_NOTICE_FONT_SIZE = '16px';
const DEFAULT_NOTICE_IMAGE_SIZE = '100%';
type NoticeImageAlign = 'left' | 'center' | 'right';

function readErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Ocorreu um erro inesperado.';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatNoticeDate(notice: GlobalNotice): string {
  if (!notice.createdAtMs) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(notice.createdAtMs));
}

function htmlToPreviewText(html: string): string {
  if (typeof document === 'undefined') return '';
  const div = document.createElement('div');
  div.innerHTML = sanitizeNoticeHtml(html);
  return (div.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export default function Avisos() {
  usePageTitle('Avisos');
  const { firebaseUser, userDoc } = useAuth();
  const editorRef = useRef<HTMLDivElement | null>(null);
  const editorWrapRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const savedEditorRangeRef = useRef<Range | null>(null);
  const selectedImageRef = useRef<HTMLImageElement | null>(null);

  const [notices, setNotices] = useState<GlobalNotice[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<ToastState | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [targetRoles, setTargetRoles] = useState<NoticeTargetRole[]>([
    ...NOTICE_TARGET_ROLES,
  ]);
  const [individualMode, setIndividualMode] = useState(false);
  const [selectedUserUids, setSelectedUserUids] = useState<string[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [textColor, setTextColor] = useState('#c41e3a');
  const [textFontSize, setTextFontSize] = useState(DEFAULT_NOTICE_FONT_SIZE);
  const [selectedImageSize, setSelectedImageSize] = useState(
    DEFAULT_NOTICE_IMAGE_SIZE
  );
  const [selectedImageAlign, setSelectedImageAlign] =
    useState<NoticeImageAlign>('center');
  const [saving, setSaving] = useState(false);
  const [busyNoticeId, setBusyNoticeId] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [resizeBox, setResizeBox] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  const meUid = firebaseUser?.uid ?? null;
  const meNome = userDoc?.displayName ?? firebaseUser?.displayName ?? 'Usuário';

  useEffect(() => {
    if (userDoc?.role !== 'distribuidor') {
      setNotices([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = listenGlobalNotices(
      (next) => {
        setNotices(next);
        setLoading(false);
      },
      (err) => {
        setToast({ kind: 'error', message: readErrorMessage(err) });
        setLoading(false);
      }
    );
    return () => unsub();
  }, [userDoc?.role]);

  // Lista de usuários para o "envio individual" (a página é só de distribuidor).
  useEffect(() => {
    if (userDoc?.role !== 'distribuidor') {
      setAllUsers([]);
      setUsersLoading(false);
      return;
    }
    setUsersLoading(true);
    const unsub = subscribeAllUsers(
      (next) => {
        setAllUsers(next);
        setUsersLoading(false);
      },
      (err) => {
        setToast({ kind: 'error', message: readErrorMessage(err) });
        setUsersLoading(false);
      }
    );
    return () => unsub();
  }, [userDoc?.role]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(id);
  }, [toast]);

  const sanitizedBodyHtml = useMemo(
    () => sanitizeNoticeHtml(bodyHtml),
    [bodyHtml]
  );

  const eligibleRecebedores = useMemo(
    () => allUsers.filter((u) => u.approved && u.ativo && u.role === 'recebedor'),
    [allUsers]
  );
  const eligibleDistribuidores = useMemo(
    () =>
      allUsers.filter((u) => u.approved && u.ativo && u.role === 'distribuidor'),
    [allUsers]
  );
  const userNameByUid = useMemo(() => {
    const map = new Map<string, string>();
    allUsers.forEach((u) => map.set(u.uid, u.displayName || u.email || u.uid));
    return map;
  }, [allUsers]);
  const selectedUsers = useMemo(
    () => allUsers.filter((u) => selectedUserUids.includes(u.uid)),
    [allUsers, selectedUserUids]
  );
  // Destinatários selecionados que não estão mais nas listas elegíveis
  // (desativados, com papel alterado ou removidos). Ficam selecionados ao
  // editar um aviso antigo, então precisam de uma forma de serem removidos.
  const orphanRecipientUids = useMemo(() => {
    const eligibleUids = new Set([
      ...eligibleRecebedores.map((u) => u.uid),
      ...eligibleDistribuidores.map((u) => u.uid),
    ]);
    return selectedUserUids.filter((uid) => !eligibleUids.has(uid));
  }, [eligibleRecebedores, eligibleDistribuidores, selectedUserUids]);

  const payloadBytes = useMemo(() => {
    const roles = individualMode
      ? targetRolesForUsers(selectedUsers)
      : targetRoles;
    const uids = individualMode ? selectedUserUids : [];
    return new Blob([
      JSON.stringify({
        title: title.trim(),
        bodyHtml: sanitizedBodyHtml,
        targetRoles: roles,
        targetUserUids: uids,
      }),
    ]).size;
  }, [
    individualMode,
    sanitizedBodyHtml,
    selectedUserUids,
    selectedUsers,
    targetRoles,
    title,
  ]);
  const payloadTooLarge = payloadBytes > PAYLOAD_WARNING_BYTES;
  const audienceSelected = individualMode
    ? selectedUserUids.length > 0
    : targetRoles.length > 0;
  const canSubmit =
    Boolean(meUid) &&
    title.trim().length > 0 &&
    sanitizedBodyHtml.trim().length > 0 &&
    audienceSelected &&
    !payloadTooLarge &&
    !saving;
  const canPreview =
    title.trim().length > 0 || sanitizedBodyHtml.trim().length > 0;

  const updateResizeBox = useCallback((img: HTMLImageElement | null) => {
    const wrap = editorWrapRef.current;
    const editor = editorRef.current;
    if (!img || !wrap || !editor || !editor.contains(img)) {
      setResizeBox(null);
      return;
    }
    const imgRect = img.getBoundingClientRect();
    const editorRect = editor.getBoundingClientRect();
    // Esconde as alças quando a imagem rolou para fora da área visível do editor.
    if (imgRect.bottom <= editorRect.top || imgRect.top >= editorRect.bottom) {
      setResizeBox(null);
      return;
    }
    const wrapRect = wrap.getBoundingClientRect();
    setResizeBox({
      left: imgRect.left - wrapRect.left,
      top: imgRect.top - wrapRect.top,
      width: imgRect.width,
      height: imgRect.height,
    });
  }, []);

  useEffect(() => {
    function reposition() {
      if (selectedImageRef.current) updateResizeBox(selectedImageRef.current);
    }
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [updateResizeBox]);

  function showSuccess(message: string) {
    setToast({ kind: 'success', message });
  }

  function showError(message: string) {
    setToast({ kind: 'error', message });
  }

  function setEditorHtml(nextHtml: string) {
    const clean = sanitizeNoticeHtml(nextHtml);
    setBodyHtml(clean);
    if (editorRef.current) {
      editorRef.current.innerHTML = clean;
    }
  }

  function resetForm() {
    setEditingId(null);
    setTitle('');
    setTargetRoles([...NOTICE_TARGET_ROLES]);
    setIndividualMode(false);
    setSelectedUserUids([]);
    setTextColor('#c41e3a');
    setTextFontSize(DEFAULT_NOTICE_FONT_SIZE);
    setSelectedImageSize(DEFAULT_NOTICE_IMAGE_SIZE);
    setSelectedImageAlign('center');
    savedEditorRangeRef.current = null;
    selectedImageRef.current = null;
    setResizeBox(null);
    setEditorHtml('');
  }

  function syncEditorState() {
    setBodyHtml(editorRef.current?.innerHTML ?? '');
    rememberEditorSelection();
  }

  function rememberEditorSelection() {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) {
      savedEditorRangeRef.current = range.cloneRange();
    }
  }

  function restoreEditorSelection() {
    const editor = editorRef.current;
    const range = savedEditorRangeRef.current;
    if (!editor || !range) return;
    const selection = window.getSelection();
    if (!selection) return;
    try {
      selection.removeAllRanges();
      selection.addRange(range);
    } catch {
      editor.focus();
    }
  }

  function execEditor(command: string, value?: string) {
    restoreEditorSelection();
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    syncEditorState();
  }

  function insertEditorHtml(html: string) {
    restoreEditorSelection();
    editorRef.current?.focus();
    document.execCommand('insertHTML', false, sanitizeNoticeHtml(html));
    syncEditorState();
  }

  function handleColorChange(color: string) {
    setTextColor(color);
    execEditor('foreColor', color);
  }

  function applyFontSizeToRange(range: Range, fontSize: string) {
    if (range.collapsed) return;
    const span = document.createElement('span');
    span.style.fontSize = fontSize;
    try {
      range.surroundContents(span);
    } catch {
      // surroundContents falha quando a seleção cruza limites de elementos;
      // nesse caso extraímos o conteúdo e o reinserimos dentro do span.
      const contents = range.extractContents();
      span.appendChild(contents);
      range.insertNode(span);
    }
    // Remove tamanhos de fonte aninhados para o novo valor prevalecer.
    span.querySelectorAll('[style*="font-size"]').forEach((el) => {
      if (el !== span && el instanceof HTMLElement) {
        el.style.removeProperty('font-size');
      }
    });
    const selection = window.getSelection();
    const after = document.createRange();
    after.selectNodeContents(span);
    selection?.removeAllRanges();
    selection?.addRange(after);
    savedEditorRangeRef.current = after.cloneRange();
  }

  function closestEditableBlock(
    node: Node,
    editor: HTMLElement
  ): HTMLElement | null {
    let current: Node | null = node;
    while (current && current !== editor) {
      if (
        current instanceof HTMLElement &&
        /^(P|LI|DIV|H[1-6])$/.test(current.tagName)
      ) {
        return current;
      }
      current = current.parentNode;
    }
    return null;
  }

  function handleFontSizeChange(fontSize: string) {
    setTextFontSize(fontSize);
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const saved = savedEditorRangeRef.current;
    let range: Range;
    if (saved && editor.contains(saved.commonAncestorContainer)) {
      if (saved.collapsed) {
        // Sem texto selecionado: aplica ao bloco onde está o cursor.
        const block = closestEditableBlock(saved.startContainer, editor);
        range = document.createRange();
        range.selectNodeContents(block ?? editor);
      } else {
        range = saved;
      }
    } else {
      // Sem cursor no editor: aplica a todo o conteúdo.
      range = document.createRange();
      range.selectNodeContents(editor);
    }
    applyFontSizeToRange(range, fontSize);
    syncEditorState();
  }

  function readImageSize(img: HTMLImageElement): string {
    const styleWidth = img.style.width;
    if (NOTICE_IMAGE_SIZE_OPTIONS.some((option) => option.value === styleWidth)) {
      return styleWidth;
    }
    return 'custom';
  }

  function readImageAlign(img: HTMLImageElement): NoticeImageAlign {
    const marginLeft = img.style.marginLeft;
    const marginRight = img.style.marginRight;
    if (marginLeft === 'auto' && (marginRight === '0px' || marginRight === '0')) {
      return 'right';
    }
    if (marginLeft === 'auto' && marginRight === 'auto') return 'center';
    return 'left';
  }

  function selectEditorImage(img: HTMLImageElement) {
    selectedImageRef.current?.classList.remove('dist-notices-image-selected');
    selectedImageRef.current = img;
    img.classList.add('dist-notices-image-selected');
    setSelectedImageSize(readImageSize(img));
    setSelectedImageAlign(readImageAlign(img));
    updateResizeBox(img);
  }

  function deselectEditorImage() {
    selectedImageRef.current?.classList.remove('dist-notices-image-selected');
    selectedImageRef.current = null;
    setResizeBox(null);
  }

  function getCurrentEditorImage(): HTMLImageElement | null {
    const editor = editorRef.current;
    if (!editor) return null;
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const anchorElement =
        selection.anchorNode instanceof Element
          ? selection.anchorNode
          : selection.anchorNode?.parentElement ?? null;
      const closestImage = anchorElement?.closest?.('img');
      if (closestImage instanceof HTMLImageElement && editor.contains(closestImage)) {
        return closestImage;
      }
      const intersectingImage = Array.from(editor.querySelectorAll('img')).find(
        (img) => range.intersectsNode(img)
      );
      if (intersectingImage) return intersectingImage;
    }
    const selected = selectedImageRef.current;
    return selected && editor.contains(selected) ? selected : null;
  }

  function applyImageAlignStyle(img: HTMLImageElement, align: NoticeImageAlign) {
    img.style.display = 'block';
    img.style.maxWidth = '100%';
    if (align === 'center') {
      img.style.marginLeft = 'auto';
      img.style.marginRight = 'auto';
    } else if (align === 'right') {
      img.style.marginLeft = 'auto';
      img.style.marginRight = '0';
    } else {
      img.style.marginLeft = '0';
      img.style.marginRight = 'auto';
    }
  }

  function handleImageSizeChange(size: string) {
    if (size === 'custom') return;
    const img = getCurrentEditorImage();
    if (!img) {
      showError('Clique em uma imagem do aviso antes de ajustar o tamanho.');
      return;
    }
    img.style.maxWidth = '100%';
    img.style.display = 'block';
    img.style.width = size;
    img.style.height = 'auto';
    img.style.removeProperty('aspect-ratio');
    applyImageAlignStyle(img, selectedImageAlign);
    selectEditorImage(img);
    setSelectedImageSize(size);
    syncEditorState();
  }

  function handleImageAlignChange(align: NoticeImageAlign) {
    const img = getCurrentEditorImage();
    if (!img) {
      showError('Clique em uma imagem do aviso antes de alinhar.');
      return;
    }
    applyImageAlignStyle(img, align);
    selectEditorImage(img);
    setSelectedImageAlign(align);
    syncEditorState();
  }

  function startImageResize(
    event: ReactMouseEvent<HTMLSpanElement>,
    corner: 'nw' | 'ne' | 'sw' | 'se'
  ) {
    event.preventDefault();
    event.stopPropagation();
    const editor = editorRef.current;
    const img = selectedImageRef.current;
    if (!editor || !img || !editor.contains(img)) return;
    const rect = img.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startW = rect.width;
    const startH = rect.height;
    const maxW = editor.clientWidth;

    function onMove(moveEvent: MouseEvent) {
      const el = selectedImageRef.current;
      if (!el) return;
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      let width = startW;
      let height = startH;
      if (corner.includes('e')) width = startW + dx;
      if (corner.includes('w')) width = startW - dx;
      if (corner.includes('s')) height = startH + dy;
      if (corner.includes('n')) height = startH - dy;
      width = Math.min(Math.max(24, Math.round(width)), maxW);
      height = Math.max(24, Math.round(height));
      el.style.maxWidth = '100%';
      el.style.display = 'block';
      el.style.width = `${width}px`;
      el.style.height = `${height}px`;
      el.style.removeProperty('aspect-ratio');
      updateResizeBox(el);
    }

    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const el = selectedImageRef.current;
      if (!el) return;
      selectEditorImage(el);
      setSelectedImageSize('custom');
      syncEditorState();
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function handleEditorClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.target instanceof HTMLImageElement) {
      selectEditorImage(event.target);
    } else {
      deselectEditorImage();
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const html = event.clipboardData.getData('text/html');
    const text = event.clipboardData.getData('text/plain');
    insertEditorHtml(html ? sanitizeNoticeHtml(html) : plainTextToNoticeHtml(text));
  }

  function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showError('Selecione um arquivo de imagem.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!result.startsWith('data:image/')) {
        showError('Não foi possível ler a imagem selecionada.');
        return;
      }
      insertEditorHtml(
        `<p><img src="${escapeHtml(result)}" alt="${escapeHtml(
          file.name
        )}" style="max-width:100%;height:auto;display:block;width:100%;margin-left:auto;margin-right:auto"></p>`
      );
      const images = editorRef.current?.querySelectorAll('img');
      const lastImage = images?.[images.length - 1];
      if (lastImage) selectEditorImage(lastImage);
    };
    reader.onerror = () => showError('Falha ao carregar imagem.');
    reader.readAsDataURL(file);
  }

  function handleAddLink() {
    const href = window.prompt('Cole o link do aviso:');
    if (!href) return;
    const selectedText = window.getSelection()?.toString() || href;
    insertEditorHtml(
      `<a href="${escapeHtml(href)}">${escapeHtml(selectedText)}</a>`
    );
  }

  function toggleTarget(role: NoticeTargetRole) {
    setTargetRoles((current) => {
      if (current.includes(role)) {
        return current.filter((item) => item !== role);
      }
      return normalizeNoticeTargetRoles([...current, role]);
    });
  }

  function toggleIndividualUser(uid: string) {
    setSelectedUserUids((current) =>
      current.includes(uid)
        ? current.filter((id) => id !== uid)
        : [...current, uid]
    );
  }

  function toggleGroup(uids: string[], allSelected: boolean) {
    setSelectedUserUids((current) => {
      const set = new Set(current);
      if (allSelected) {
        uids.forEach((uid) => set.delete(uid));
      } else {
        uids.forEach((uid) => set.add(uid));
      }
      return Array.from(set);
    });
  }

  function renderRecipientGroup(label: string, groupUsers: User[]) {
    if (groupUsers.length === 0) return null;
    const uids = groupUsers.map((u) => u.uid);
    const allSelected = uids.every((uid) => selectedUserUids.includes(uid));
    return (
      <div className="rounded-md border border-gray-200 bg-white p-2">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-ink-secondary">
            {label}
          </span>
          <button
            type="button"
            onClick={() => toggleGroup(uids, allSelected)}
            className="text-xs font-semibold text-brand-primary hover:underline"
          >
            {allSelected ? 'Limpar' : 'Selecionar todos'}
          </button>
        </div>
        <div className="flex flex-col gap-0.5">
          {groupUsers.map((u) => (
            <label
              key={u.uid}
              className="inline-flex items-center gap-2 rounded px-1 py-0.5 text-sm text-ink-primary hover:bg-gray-50"
            >
              <input
                type="checkbox"
                checked={selectedUserUids.includes(u.uid)}
                onChange={() => toggleIndividualUser(u.uid)}
              />
              <span className="truncate">{u.displayName || u.email || u.uid}</span>
            </label>
          ))}
        </div>
      </div>
    );
  }

  function renderOrphanGroup() {
    if (orphanRecipientUids.length === 0) return null;
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-2">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-amber-800">
            Selecionados (indisponíveis)
          </span>
          <button
            type="button"
            onClick={() => toggleGroup(orphanRecipientUids, true)}
            className="text-xs font-semibold text-amber-800 hover:underline"
          >
            Remover todos
          </button>
        </div>
        <div className="flex flex-col gap-0.5">
          {orphanRecipientUids.map((uid) => (
            <label
              key={uid}
              className="inline-flex items-center gap-2 rounded px-1 py-0.5 text-sm text-ink-primary hover:bg-amber-100/60"
            >
              <input
                type="checkbox"
                checked
                onChange={() => toggleIndividualUser(uid)}
              />
              <span className="truncate">{userNameByUid.get(uid) ?? uid}</span>
              <span className="shrink-0 text-xs text-amber-700">(inativo)</span>
            </label>
          ))}
        </div>
      </div>
    );
  }

  async function handleSubmit() {
    if (!meUid) {
      showError('Usuário não autenticado.');
      return;
    }
    if (individualMode && selectedUserUids.length === 0) {
      showError('Selecione pelo menos uma pessoa para o envio individual.');
      return;
    }
    if (!individualMode && targetRoles.length === 0) {
      showError('Selecione pelo menos um público.');
      return;
    }
    if (payloadTooLarge) {
      showError('O aviso está grande demais para salvar no Firestore.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        title,
        bodyHtml: sanitizedBodyHtml,
        targetRoles: individualMode
          ? targetRolesForUsers(selectedUsers)
          : targetRoles,
        targetUserUids: individualMode ? selectedUserUids : [],
        byUid: meUid,
        byNome: meNome,
      };
      if (editingId) {
        await updateGlobalNotice(editingId, payload);
        showSuccess('Aviso atualizado.');
      } else {
        await createGlobalNotice(payload);
        showSuccess('Aviso publicado.');
      }
      resetForm();
    } catch (err) {
      showError(readErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function handleEdit(notice: GlobalNotice) {
    setEditingId(notice.id);
    setTitle(notice.title);
    const uids = normalizeTargetUserUids(notice.targetUserUids);
    if (uids.length > 0) {
      setIndividualMode(true);
      setSelectedUserUids(uids);
      setTargetRoles([...NOTICE_TARGET_ROLES]);
    } else {
      setIndividualMode(false);
      setSelectedUserUids([]);
      setTargetRoles(normalizeNoticeTargetRoles(notice.targetRoles));
    }
    deselectEditorImage();
    setEditorHtml(notice.bodyHtml);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleToggleActive(notice: GlobalNotice) {
    if (!meUid) {
      showError('Usuário não autenticado.');
      return;
    }
    setBusyNoticeId(notice.id);
    try {
      await setGlobalNoticeActive(notice.id, !notice.active, {
        byUid: meUid,
        byNome: meNome,
      });
      showSuccess(notice.active ? 'Aviso pausado.' : 'Aviso reativado.');
    } catch (err) {
      showError(readErrorMessage(err));
    } finally {
      setBusyNoticeId(null);
    }
  }

  async function handleDelete(notice: GlobalNotice) {
    if (!meUid) {
      showError('Usuário não autenticado.');
      return;
    }
    const ok = window.confirm(`Excluir o aviso "${notice.title}"?`);
    if (!ok) return;
    setBusyNoticeId(notice.id);
    try {
      await deleteGlobalNotice(notice.id, { byUid: meUid, byNome: meNome });
      if (editingId === notice.id) resetForm();
      showSuccess('Aviso excluído.');
    } catch (err) {
      showError(readErrorMessage(err));
    } finally {
      setBusyNoticeId(null);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink-primary">Avisos</h1>
          <p className="text-sm text-ink-secondary">
            Publique comunicados em janela para recebedores e distribuidores.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-surface px-3 py-2 text-sm font-semibold text-ink-primary">
          <Megaphone className="h-4 w-4 text-brand-primary" />
          {notices.length} aviso{notices.length === 1 ? '' : 's'}
        </div>
      </header>

      <section className="dist-notices-grid">
        <div className="rounded-lg border border-gray-200 bg-surface p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-ink-primary">
                {editingId ? 'Editar aviso' : 'Novo aviso'}
              </h2>
              <p className="text-xs text-ink-secondary">
                O aviso ativo aparece para o público selecionado até ser fechado.
              </p>
            </div>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                disabled={saving}
                className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-ink-primary hover:bg-gray-50 disabled:opacity-60"
              >
                <X className="h-3.5 w-3.5" />
                Cancelar edição
              </button>
            )}
          </div>

          <div className="mt-4 space-y-4">
            <label className="block text-sm font-medium text-ink-primary">
              Título
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={120}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                placeholder="Título curto do aviso"
              />
            </label>

            <fieldset className="rounded-md border border-gray-200 p-3">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-secondary">
                Público
              </legend>

              <label className="mb-3 inline-flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm font-semibold text-ink-primary">
                <input
                  type="checkbox"
                  checked={individualMode}
                  onChange={(event) => setIndividualMode(event.target.checked)}
                />
                <Users className="h-4 w-4 text-brand-primary" />
                ENVIO INDIVIDUAL
              </label>

              {!individualMode ? (
                <>
                  <div className="flex flex-wrap gap-2">
                    {NOTICE_TARGET_ROLES.map((role) => (
                      <label
                        key={role}
                        className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-ink-primary"
                      >
                        <input
                          type="checkbox"
                          checked={targetRoles.includes(role)}
                          onChange={() => toggleTarget(role)}
                        />
                        {NOTICE_TARGET_ROLE_LABELS[role]}
                      </label>
                    ))}
                  </div>
                  {targetRoles.length === 0 && (
                    <p className="mt-2 text-xs font-medium text-state-danger">
                      Selecione pelo menos um público.
                    </p>
                  )}
                </>
              ) : usersLoading ? (
                <p className="flex items-center gap-2 text-sm text-ink-secondary">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Carregando pessoas…
                </p>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-ink-secondary">
                    {selectedUserUids.length} pessoa
                    {selectedUserUids.length === 1 ? '' : 's'} selecionada
                    {selectedUserUids.length === 1 ? '' : 's'}.
                  </p>
                  {renderRecipientGroup('Recebedores', eligibleRecebedores)}
                  {renderRecipientGroup('Distribuidores', eligibleDistribuidores)}
                  {renderOrphanGroup()}
                  {eligibleRecebedores.length === 0 &&
                    eligibleDistribuidores.length === 0 &&
                    orphanRecipientUids.length === 0 && (
                      <p className="text-sm text-ink-secondary">
                        Nenhum recebedor ou distribuidor ativo encontrado.
                      </p>
                    )}
                  {selectedUserUids.length === 0 && (
                    <p className="text-xs font-medium text-state-danger">
                      Selecione pelo menos uma pessoa.
                    </p>
                  )}
                </div>
              )}
            </fieldset>

            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-ink-primary">
                  Texto do aviso
                </span>
                <span
                  className={`text-xs font-medium ${
                    payloadTooLarge ? 'text-state-danger' : 'text-ink-secondary'
                  }`}
                >
                  {formatBytes(payloadBytes)}
                </span>
              </div>
              <EditorToolbar
                onCommand={execEditor}
                onLink={handleAddLink}
                onImage={() => imageInputRef.current?.click()}
                onRememberSelection={rememberEditorSelection}
                textColor={textColor}
                onColorChange={handleColorChange}
                textFontSize={textFontSize}
                onFontSizeChange={handleFontSizeChange}
                selectedImageSize={selectedImageSize}
                selectedImageAlign={selectedImageAlign}
                onImageSizeChange={handleImageSizeChange}
                onImageAlignChange={handleImageAlignChange}
              />
              <div ref={editorWrapRef} className="dist-notices-editor-wrap">
                <div
                  ref={editorRef}
                  className="dist-notices-editor"
                  contentEditable
                  role="textbox"
                  aria-multiline="true"
                  data-placeholder="Digite o texto do aviso aqui. Você também pode colar texto e inserir imagens."
                  suppressContentEditableWarning
                  onInput={syncEditorState}
                  onPaste={handlePaste}
                  onMouseUp={rememberEditorSelection}
                  onKeyUp={rememberEditorSelection}
                  onClick={handleEditorClick}
                  onBlur={() => setBodyHtml(editorRef.current?.innerHTML ?? '')}
                />
                {resizeBox && (
                  <div
                    className="dist-notices-resize-box"
                    style={{
                      left: resizeBox.left,
                      top: resizeBox.top,
                      width: resizeBox.width,
                      height: resizeBox.height,
                    }}
                  >
                    <span
                      className="dist-notices-resize-handle nw"
                      onMouseDown={(event) => startImageResize(event, 'nw')}
                    />
                    <span
                      className="dist-notices-resize-handle ne"
                      onMouseDown={(event) => startImageResize(event, 'ne')}
                    />
                    <span
                      className="dist-notices-resize-handle sw"
                      onMouseDown={(event) => startImageResize(event, 'sw')}
                    />
                    <span
                      className="dist-notices-resize-handle se"
                      onMouseDown={(event) => startImageResize(event, 'se')}
                    />
                  </div>
                )}
              </div>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageChange}
              />
              {payloadTooLarge && (
                <p className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
                  O aviso ultrapassa o limite prático de 900 KB. Reduza imagens
                  ou texto antes de salvar.
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => setShowPreview(true)}
                disabled={!canPreview}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-ink-primary hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                <Eye className="h-4 w-4" />
                Pré-visualizar
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleSubmit();
                }}
                disabled={!canSubmit}
                className="inline-flex w-full flex-1 items-center justify-center gap-2 rounded-md bg-brand-primary px-4 py-3 text-sm font-semibold text-white hover:bg-brand-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {editingId ? 'Salvar alterações' : 'Publicar aviso'}
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-surface p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-ink-primary">
              Avisos publicados
            </h2>
            {loading && <Loader2 className="h-4 w-4 animate-spin text-brand-primary" />}
          </div>

          <div className="mt-4 space-y-3">
            {!loading && notices.length === 0 && (
              <div className="rounded-md border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-ink-secondary">
                Nenhum aviso publicado.
              </div>
            )}
            {notices.map((notice) => (
              <NoticeCard
                key={notice.id}
                notice={notice}
                recipientNames={normalizeTargetUserUids(notice.targetUserUids).map(
                  (uid) => userNameByUid.get(uid) ?? uid
                )}
                busy={busyNoticeId === notice.id}
                editing={editingId === notice.id}
                onEdit={() => handleEdit(notice)}
                onToggleActive={() => {
                  void handleToggleActive(notice);
                }}
                onDelete={() => {
                  void handleDelete(notice);
                }}
              />
            ))}
          </div>
        </div>
      </section>

      {showPreview && (
        <NoticePreviewModal
          title={title}
          bodyHtml={bodyHtml}
          onClose={() => setShowPreview(false)}
        />
      )}

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

function NoticePreviewModal({
  title,
  bodyHtml,
  onClose,
}: {
  title: string;
  bodyHtml: string;
  onClose: () => void;
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  useEffect(() => {
    const container = bodyRef.current;
    if (!container) return;
    // bodyHtml já passa por sanitizeNoticeHtml (whitelist de tags/atributos).
    // O DOMParser cria um documento inerte (não executa scripts) e os nós
    // sanitizados são anexados ao DOM real, evitando innerHTML.
    const safe = sanitizeNoticeHtml(bodyHtml);
    const parsed = new DOMParser().parseFromString(
      safe || '<p style="color:#6b7280">Sem conteúdo no corpo do aviso.</p>',
      'text/html'
    );
    container.replaceChildren(...Array.from(parsed.body.childNodes));
  }, [bodyHtml]);

  return (
    <div className="global-notice-overlay" role="dialog" aria-modal="true">
      <div
        className="global-notice-backdrop"
        aria-hidden="true"
        onClick={onClose}
      />
      <section
        className="global-notice-panel"
        aria-labelledby="notice-preview-title"
      >
        <div className="global-notice-header">
          <div className="global-notice-icon" aria-hidden="true">
            <BellRing className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 id="notice-preview-title" className="global-notice-title">
              {title.trim() || 'Título do aviso'}
            </h2>
            <p className="global-notice-count">
              Pré-visualização — assim o público verá. Nada será salvo.
            </p>
          </div>
          <button
            type="button"
            className="global-notice-close"
            aria-label="Fechar pré-visualização"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div ref={bodyRef} className="global-notice-body" />

        <div className="global-notice-actions">
          <button
            type="button"
            className="global-notice-primary"
            onClick={onClose}
          >
            Fechar pré-visualização
          </button>
        </div>
      </section>
    </div>
  );
}

function EditorToolbar({
  onCommand,
  onLink,
  onImage,
  onRememberSelection,
  textColor,
  onColorChange,
  textFontSize,
  onFontSizeChange,
  selectedImageSize,
  selectedImageAlign,
  onImageSizeChange,
  onImageAlignChange,
}: {
  onCommand: (command: string, value?: string) => void;
  onLink: () => void;
  onImage: () => void;
  onRememberSelection: () => void;
  textColor: string;
  onColorChange: (color: string) => void;
  textFontSize: string;
  onFontSizeChange: (fontSize: string) => void;
  selectedImageSize: string;
  selectedImageAlign: NoticeImageAlign;
  onImageSizeChange: (size: string) => void;
  onImageAlignChange: (align: NoticeImageAlign) => void;
}) {
  return (
    <div className="dist-notices-toolbar" aria-label="Ferramentas do editor">
      <ToolbarButton title="Negrito" onClick={() => onCommand('bold')} icon={Bold} />
      <ToolbarButton
        title="Itálico"
        onClick={() => onCommand('italic')}
        icon={Italic}
      />
      <ToolbarButton
        title="Sublinhar"
        onClick={() => onCommand('underline')}
        icon={Underline}
      />
      <ToolbarDivider />
      <ColorPickerControl
        value={textColor}
        onChange={onColorChange}
        onRememberSelection={onRememberSelection}
      />
      <FontSizeControl
        value={textFontSize}
        onChange={onFontSizeChange}
        onRememberSelection={onRememberSelection}
      />
      <ToolbarDivider />
      <ToolbarButton
        title="Lista"
        onClick={() => onCommand('insertUnorderedList')}
        icon={List}
      />
      <ToolbarButton
        title="Lista numerada"
        onClick={() => onCommand('insertOrderedList')}
        icon={ListOrdered}
      />
      <ToolbarDivider />
      <ToolbarButton title="Link" onClick={onLink} icon={Link} />
      <ToolbarButton title="Inserir imagem" onClick={onImage} icon={ImageIcon} />
      <ImageLayoutControl
        size={selectedImageSize}
        align={selectedImageAlign}
        onSizeChange={onImageSizeChange}
        onAlignChange={onImageAlignChange}
        onRememberSelection={onRememberSelection}
      />
      <ToolbarDivider />
      <ToolbarButton
        title="Alinhar à esquerda"
        onClick={() => onCommand('justifyLeft')}
        icon={AlignLeft}
      />
      <ToolbarButton
        title="Centralizar"
        onClick={() => onCommand('justifyCenter')}
        icon={AlignCenter}
      />
      <ToolbarButton
        title="Alinhar à direita"
        onClick={() => onCommand('justifyRight')}
        icon={AlignRight}
      />
      <ToolbarDivider />
      <ToolbarButton title="Desfazer" onClick={() => onCommand('undo')} icon={Undo2} />
    </div>
  );
}

function FontSizeControl({
  value,
  onChange,
  onRememberSelection,
}: {
  value: string;
  onChange: (fontSize: string) => void;
  onRememberSelection: () => void;
}) {
  return (
    <select
      value={value}
      title="Tamanho da fonte"
      aria-label="Tamanho da fonte"
      className="dist-notices-toolbar-select"
      onMouseDown={onRememberSelection}
      onFocus={onRememberSelection}
      onChange={(event) => onChange(event.target.value)}
    >
      {NOTICE_FONT_SIZE_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}px
        </option>
      ))}
    </select>
  );
}

function ImageLayoutControl({
  size,
  align,
  onSizeChange,
  onAlignChange,
  onRememberSelection,
}: {
  size: string;
  align: NoticeImageAlign;
  onSizeChange: (size: string) => void;
  onAlignChange: (align: NoticeImageAlign) => void;
  onRememberSelection: () => void;
}) {
  return (
    <div className="dist-notices-image-tools" aria-label="Tamanho e alinhamento da imagem">
      <ImageIcon className="h-4 w-4 text-ink-secondary" aria-hidden="true" />
      <select
        value={size}
        title="Tamanho da imagem selecionada"
        aria-label="Tamanho da imagem selecionada"
        className="dist-notices-toolbar-select"
        onMouseDown={onRememberSelection}
        onFocus={onRememberSelection}
        onChange={(event) => onSizeChange(event.target.value)}
      >
        {!NOTICE_IMAGE_SIZE_OPTIONS.some((option) => option.value === size) && (
          <option value={size}>Livre</option>
        )}
        {NOTICE_IMAGE_SIZE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ToolbarButton
        title="Alinhar imagem à esquerda"
        onClick={() => onAlignChange('left')}
        icon={AlignLeft}
        active={align === 'left'}
      />
      <ToolbarButton
        title="Centralizar imagem"
        onClick={() => onAlignChange('center')}
        icon={AlignCenter}
        active={align === 'center'}
      />
      <ToolbarButton
        title="Alinhar imagem à direita"
        onClick={() => onAlignChange('right')}
        icon={AlignRight}
        active={align === 'right'}
      />
    </div>
  );
}

function ColorPickerControl({
  value,
  onChange,
  onRememberSelection,
}: {
  value: string;
  onChange: (color: string) => void;
  onRememberSelection: () => void;
}) {
  return (
    <div className="dist-notices-color-control" aria-label="Cor do texto">
      <Palette className="h-4 w-4 text-ink-secondary" aria-hidden="true" />
      {NOTICE_TEXT_COLOR_SWATCHES.map((color) => (
        <button
          key={color}
          type="button"
          title={`Aplicar cor ${color}`}
          aria-label={`Aplicar cor ${color}`}
          aria-pressed={value.toLowerCase() === color}
          className="dist-notices-color-swatch"
          style={{ backgroundColor: color }}
          onMouseDown={(event) => {
            event.preventDefault();
            onRememberSelection();
          }}
          onClick={() => onChange(color)}
        />
      ))}
      <label
        className="dist-notices-color-custom"
        title="Escolher cor personalizada"
      >
        <input
          type="color"
          value={value}
          aria-label="Escolher cor personalizada"
          onMouseDown={onRememberSelection}
          onFocus={onRememberSelection}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    </div>
  );
}

function ToolbarDivider() {
  return <span className="h-6 w-px bg-gray-200" aria-hidden="true" />;
}

function ToolbarButton({
  title,
  onClick,
  icon: Icon,
  active = false,
}: {
  title: string;
  onClick: () => void;
  icon: typeof Bold;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-gray-100 hover:text-ink-primary ${
        active
          ? 'bg-brand-primary-light text-brand-primary-dark'
          : 'text-ink-secondary'
      }`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

function NoticeCard({
  notice,
  recipientNames,
  busy,
  editing,
  onEdit,
  onToggleActive,
  onDelete,
}: {
  notice: GlobalNotice;
  recipientNames: string[];
  busy: boolean;
  editing: boolean;
  onEdit: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
}) {
  const preview = htmlToPreviewText(notice.bodyHtml);
  const isIndividual = recipientNames.length > 0;
  return (
    <article
      className={`rounded-lg border p-4 ${
        editing ? 'border-brand-primary bg-brand-primary/5' : 'border-gray-200 bg-white'
      }`}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-ink-primary">
              {notice.title}
            </h3>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                notice.active
                  ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                  : 'bg-amber-50 text-amber-800 ring-1 ring-amber-200'
              }`}
            >
              {notice.active ? 'Ativo' : 'Pausado'}
            </span>
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-ink-secondary">
            {preview || 'Aviso com conteúdo visual.'}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-ink-secondary">
            {isIndividual ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-primary/10 px-2 py-0.5 font-semibold text-brand-primary">
                <Users className="h-3 w-3" />
                Envio individual: {recipientNames.length}
              </span>
            ) : (
              normalizeNoticeTargetRoles(notice.targetRoles).map((role) => (
                <span
                  key={role}
                  className="rounded-full bg-gray-100 px-2 py-0.5 font-semibold text-ink-primary"
                >
                  {NOTICE_TARGET_ROLE_LABELS[role]}
                </span>
              ))
            )}
            <span>{formatNoticeDate(notice)}</span>
            <span>Autor: {notice.createdByName || '—'}</span>
          </div>
          {isIndividual && (
            <p className="mt-1 line-clamp-1 text-xs text-ink-secondary">
              {recipientNames.join(', ')}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={onEdit}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-ink-primary hover:bg-gray-50 disabled:opacity-60"
          >
            <Edit3 className="h-3.5 w-3.5" />
            Editar
          </button>
          <button
            type="button"
            onClick={onToggleActive}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-ink-primary hover:bg-gray-50 disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : notice.active ? (
              <PauseCircle className="h-3.5 w-3.5" />
            ) : (
              <PlayCircle className="h-3.5 w-3.5" />
            )}
            {notice.active ? 'Pausar' : 'Reativar'}
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md border border-rose-200 px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Excluir
          </button>
        </div>
      </div>
    </article>
  );
}
