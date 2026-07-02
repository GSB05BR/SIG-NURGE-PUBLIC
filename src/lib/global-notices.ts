import type { GlobalNotice, NoticeTargetRole, User, UserRole } from '@/types';

export const NOTICE_TARGET_ROLES: NoticeTargetRole[] = [
  'recebedores',
  'distribuidores',
];

export const NOTICE_TARGET_ROLE_LABELS: Record<NoticeTargetRole, string> = {
  recebedores: 'Recebedores',
  distribuidores: 'Distribuidores',
};

const ALLOWED_TAGS = new Set([
  'p',
  'strong',
  'em',
  'u',
  'a',
  'ul',
  'ol',
  'li',
  'br',
  'img',
  'span',
]);

const BLOCKED_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'template',
  'svg',
  'math',
]);

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function roleToNoticeTarget(role: UserRole | null | undefined): NoticeTargetRole | null {
  if (role === 'recebedor') return 'recebedores';
  if (role === 'distribuidor') return 'distribuidores';
  return null;
}

export function normalizeNoticeTargetRoles(
  targetRoles: readonly string[] | null | undefined
): NoticeTargetRole[] {
  const normalized = Array.from(
    new Set(
      (targetRoles ?? []).filter((role): role is NoticeTargetRole =>
        NOTICE_TARGET_ROLES.includes(role as NoticeTargetRole)
      )
    )
  );
  return normalized.length > 0 ? normalized : [...NOTICE_TARGET_ROLES];
}

export function makeNoticeDismissalKey(
  noticeId: string,
  noticeVersion: number
): string {
  return `${noticeId}_v${noticeVersion}`;
}

export function noticeTargetsRole(
  notice: Pick<GlobalNotice, 'targetRoles'>,
  role: UserRole | null | undefined
): boolean {
  const target = roleToNoticeTarget(role);
  if (!target) return false;
  const normalized = normalizeNoticeTargetRoles(notice.targetRoles);
  return normalized.includes(target);
}

/**
 * Normaliza a lista de destinatários individuais (uids): só strings,
 * sem espaços, sem vazios e sem duplicatas.
 */
export function normalizeTargetUserUids(
  uids: readonly string[] | null | undefined
): string[] {
  return Array.from(
    new Set(
      (uids ?? [])
        .filter((uid): uid is string => typeof uid === 'string')
        .map((uid) => uid.trim())
        .filter((uid) => uid.length > 0)
    )
  );
}

/**
 * Decide se um aviso atinge um usuário. Quando há envio individual
 * (`targetUserUids` não vazio) ele tem precedência e o papel é ignorado;
 * caso contrário, cai no alvo por papel (`noticeTargetsRole`).
 */
export function noticeTargetsUser(
  notice: Pick<GlobalNotice, 'targetRoles' | 'targetUserUids'>,
  user: Pick<User, 'uid' | 'role'> | null | undefined
): boolean {
  if (!user) return false;
  const uids = normalizeTargetUserUids(notice.targetUserUids);
  if (uids.length > 0) {
    return uids.includes(user.uid);
  }
  return noticeTargetsRole(notice, user.role);
}

/**
 * Deriva os papéis (alvo de aviso) representados por um conjunto de usuários.
 * Usado no envio individual para manter `targetRoles` coerente com quem foi
 * selecionado. Ignora papéis sem alvo correspondente (ex.: `pendente`).
 */
export function targetRolesForUsers(
  users: ReadonlyArray<Pick<User, 'role'>>
): NoticeTargetRole[] {
  const targets = users
    .map((u) => roleToNoticeTarget(u.role))
    .filter((target): target is NoticeTargetRole => target !== null);
  return Array.from(new Set(targets));
}

export function plainTextToNoticeHtml(text: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return '';
  return paragraphs
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function safeHref(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^(https?:|mailto:|tel:)/i.test(trimmed)) return trimmed;
  if (/^\/(?!\/)/.test(trimmed) || /^#/.test(trimmed)) return trimmed;
  return null;
}

function safeImageSrc(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (
    /^data:image\/(png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/=]+$/i.test(trimmed)
  ) {
    return trimmed;
  }
  return null;
}

function safeTextAlign(styleValue: string | null): string | null {
  if (!styleValue) return null;
  const match = styleValue.match(/text-align\s*:\s*(left|center|right|justify)/i);
  return match ? `text-align:${match[1].toLowerCase()}` : null;
}

function safeCssColor(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const hex = trimmed.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const raw = hex[1].toLowerCase();
    if (raw.length === 3) {
      return `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`;
    }
    return `#${raw}`;
  }

  const rgb = trimmed.match(
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0|1|0?\.\d+))?\s*\)$/i
  );
  if (!rgb) return null;

  const channels = rgb.slice(1, 4).map((part) => Number.parseInt(part, 10));
  if (channels.some((channel) => Number.isNaN(channel) || channel < 0 || channel > 255)) {
    return null;
  }
  return `rgb(${channels.join(', ')})`;
}

function safeTextColor(styleValue: string | null, colorAttr: string | null): string | null {
  const attrColor = safeCssColor(colorAttr);
  if (attrColor) return attrColor;
  if (!styleValue) return null;
  const match = styleValue.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i);
  return safeCssColor(match?.[1] ?? null);
}

type NoticeImageAlignment = 'left' | 'center' | 'right';

function safeFontSize(styleValue: string | null): string | null {
  if (!styleValue) return null;
  const match = styleValue.match(
    /(?:^|;)\s*font-size\s*:\s*(\d{1,3}(?:\.\d+)?)px/i
  );
  if (!match) return null;
  const px = Number.parseFloat(match[1]);
  if (Number.isNaN(px) || px < 8 || px > 96) return null;
  return `font-size:${match[1]}px`;
}

function safeImageDimension(
  styleValue: string | null,
  prop: 'width' | 'height'
): { value: string; unit: 'px' | '%' } | null {
  if (!styleValue) return null;
  const match = styleValue.match(
    new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*(\\d{1,4}(?:\\.\\d+)?)\\s*(px|%)`, 'i')
  );
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  const unit = match[2].toLowerCase() as 'px' | '%';
  if (Number.isNaN(value) || value <= 0) return null;
  if (unit === '%' && value > 100) return null;
  if (unit === 'px' && value > 4000) return null;
  return { value: match[1], unit };
}

function safeImageAlign(styleValue: string | null): NoticeImageAlignment {
  if (!styleValue) return 'left';
  const marginLeftAuto = /margin-left\s*:\s*auto/i.test(styleValue);
  const marginRightAuto = /margin-right\s*:\s*auto/i.test(styleValue);
  if (marginLeftAuto && marginRightAuto) return 'center';
  if (marginLeftAuto) return 'right';
  return 'left';
}

export function sanitizeNoticeHtml(input: string): string {
  if (!input.trim()) return '';
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    return plainTextToNoticeHtml(input);
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(input, 'text/html');
  const out = document.implementation.createHTMLDocument('');

  function sanitizeNode(node: Node): Node | null {
    if (node.nodeType === Node.TEXT_NODE) {
      return out.createTextNode(node.textContent ?? '');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }

    const element = node as HTMLElement;
    const rawTag = element.tagName.toLowerCase();
    if (BLOCKED_TAGS.has(rawTag)) {
      return out.createDocumentFragment();
    }

    const tag =
      rawTag === 'b'
          ? 'strong'
          : rawTag === 'i'
            ? 'em'
            : rawTag === 'font'
              ? 'span'
              : rawTag === 'div'
                ? 'p'
                : rawTag;

    const children = Array.from(element.childNodes)
      .map(sanitizeNode)
      .filter((child): child is Node => child !== null);

    if (!ALLOWED_TAGS.has(tag)) {
      const fragment = out.createDocumentFragment();
      children.forEach((child) => fragment.appendChild(child));
      return fragment;
    }

    const clean = out.createElement(tag);
    if (tag === 'a') {
      const href = safeHref(element.getAttribute('href'));
      if (href) {
        clean.setAttribute('href', href);
        clean.setAttribute('target', '_blank');
        clean.setAttribute('rel', 'noopener noreferrer');
      }
    }
    if (tag === 'img') {
      const src = safeImageSrc(element.getAttribute('src'));
      if (!src) return out.createDocumentFragment();
      clean.setAttribute('src', src);
      clean.setAttribute('alt', element.getAttribute('alt') ?? '');
      const imgStyle = element.getAttribute('style');
      const width = safeImageDimension(imgStyle, 'width');
      const height = safeImageDimension(imgStyle, 'height');
      const imgStyles = ['max-width:100%', 'display:block'];
      if (width) imgStyles.push(`width:${width.value}${width.unit}`);
      if (width?.unit === 'px' && height?.unit === 'px') {
        // Redimensionamento livre: preserva a proporção escolhida de forma
        // responsiva — a altura acompanha a largura (que respeita max-width).
        imgStyles.push(`aspect-ratio:${width.value} / ${height.value}`);
      }
      imgStyles.push('height:auto');
      const align = safeImageAlign(imgStyle);
      if (align === 'center') {
        imgStyles.push('margin-left:auto', 'margin-right:auto');
      } else if (align === 'right') {
        imgStyles.push('margin-left:auto', 'margin-right:0');
      } else {
        imgStyles.push('margin-left:0', 'margin-right:auto');
      }
      clean.setAttribute('style', imgStyles.join(';'));
      return clean;
    }
    const safeStyles: string[] = [];
    if (tag === 'p' || tag === 'li') {
      const textAlign = safeTextAlign(element.getAttribute('style'));
      if (textAlign) safeStyles.push(textAlign);
    }
    if (tag !== 'img') {
      const color = safeTextColor(
        element.getAttribute('style'),
        element.getAttribute('color')
      );
      if (color) safeStyles.push(`color:${color}`);
      const fontSize = safeFontSize(element.getAttribute('style'));
      if (fontSize) safeStyles.push(fontSize);
    }
    if (safeStyles.length > 0) {
      clean.setAttribute('style', safeStyles.join(';'));
    }
    children.forEach((child) => clean.appendChild(child));
    return clean;
  }

  const fragment = out.createDocumentFragment();
  Array.from(doc.body.childNodes).forEach((node) => {
    const clean = sanitizeNode(node);
    if (clean) fragment.appendChild(clean);
  });
  const wrapper = out.createElement('div');
  wrapper.appendChild(fragment);
  return wrapper.innerHTML;
}
