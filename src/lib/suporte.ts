import type {
  SuporteStatus,
  SuporteTipo,
  SuporteNotificacaoTipo,
  UserRole,
} from '@/types';

// ----- Status -----

export const SUPORTE_STATUS_OPTIONS: ReadonlyArray<{
  value: SuporteStatus;
  label: string;
}> = [
  { value: 'em_analise', label: 'Em análise' },
  { value: 'implementando', label: 'Implementando' },
  { value: 'descartado', label: 'Descartado' },
  { value: 'concluido', label: 'Concluído' },
] as const;

export function getSuporteStatusLabel(s: SuporteStatus): string {
  switch (s) {
    case 'em_analise':
      return 'Em análise';
    case 'implementando':
      return 'Implementando';
    case 'descartado':
      return 'Descartado';
    case 'concluido':
      return 'Concluído';
  }
}

export function getSuporteStatusBadgeClass(s: SuporteStatus): string {
  switch (s) {
    case 'em_analise':
      return 'bg-state-warning-bg text-state-warning ring-1 ring-orange-200';
    case 'implementando':
      return 'bg-state-info-bg text-state-info ring-1 ring-blue-200';
    case 'descartado':
      return 'bg-slate-100 text-slate-700 ring-1 ring-slate-200';
    case 'concluido':
      return 'bg-state-success-bg text-state-success ring-1 ring-green-200';
  }
}

// ----- Tipo -----

export function getSuporteTipoLabel(t: SuporteTipo): string {
  return t === 'suporte' ? 'Suporte' : 'Sugestão';
}

// ----- Permissões -----

/** Coordenação = distribuidor aprovado. Só ela gerencia (status/exclusão). */
export function podeGerenciarSuporte(role: UserRole | null | undefined): boolean {
  return role === 'distribuidor';
}

// ----- Anexos -----

export const MAX_ANEXO_BYTES = 10 * 1024 * 1024;

export const ANEXO_MIMES_ACEITOS: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
];

export function anexoTipoArquivo(mime: string): 'image' | 'pdf' | null {
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  return null;
}

export type ValidacaoAnexo = { ok: true } | { ok: false; erro: string };

export function validarAnexo(file: {
  type: string;
  size: number;
  name?: string;
}): ValidacaoAnexo {
  if (anexoTipoArquivo(file.type) === null) {
    return { ok: false, erro: 'Tipo não suportado. Use imagem ou PDF.' };
  }
  if (file.size > MAX_ANEXO_BYTES) {
    return { ok: false, erro: 'Arquivo maior que 10 MB.' };
  }
  return { ok: true };
}

// ----- Notificações -----

export function notificacaoTexto(n: {
  tipo: SuporteNotificacaoTipo;
  porNome: string;
  ticketTitulo: string;
  status?: SuporteStatus | null;
}): string {
  switch (n.tipo) {
    case 'novo_chamado':
      return `Novo chamado: ${n.ticketTitulo}`;
    case 'novo_comentario':
      return `${n.porNome} comentou em "${n.ticketTitulo}"`;
    case 'mudanca_status':
      return `${n.ticketTitulo} · ${
        n.status ? getSuporteStatusLabel(n.status) : 'status atualizado'
      }`;
  }
}
