import type { HistoricoEntry, HistoricoTipo } from '@/types';
import { formatDadosConclusao } from '@/lib/conclusao';

/**
 * Friendly pt-BR labels for every HistoricoTipo. Used in filters and badges.
 */
export const HISTORICO_TIPO_LABELS: Record<HistoricoTipo, string> = {
  aprovacao_usuario: 'Aprovação de usuário',
  rejeicao_usuario: 'Rejeição de usuário',
  mudanca_role: 'Mudança de papel',
  mudanca_permissao: 'Mudança de permissão',
  importacao_sei_json: 'Importação SEI JSON',
  atribuicao_processos: 'Atribuição de processos',
  desatribuicao_processo: 'Retorno para fila',
  distribuicao_csv: 'Distribuição legada',
  adicao_manual: 'Adição manual',
  exclusao_processos: 'Exclusão de processos',
  iniciar_processo: 'Início de processo',
  concluir_processo: 'Conclusão de processo',
  envio_coordenacao: 'Envio para coordenação',
  devolucao_coordenacao: 'Devolução da coordenação',
  conclusao_coordenacao: 'Conclusão pela coordenação',
  espera_coordenacao: 'Espera na coordenação',
  reabrir_processo: 'Reabertura de processo',
  renovacao_prazo_processo: 'Renovação de prazo de processo',
  marcar_processo_urgente: 'Marcação de urgência',
  desmarcar_processo_urgente: 'Remoção de urgência',
  aviso_global_criacao: 'Criação de aviso',
  aviso_global_atualizacao: 'Atualização de aviso',
  aviso_global_status: 'Ativação/pausa de aviso',
  aviso_global_exclusao: 'Exclusão de aviso',
  mudanca_prazo_agrupador: 'Mudança de prazo de origem',
  mudanca_config_sistema: 'Mudança de configuração',
  criacao_agrupador: 'Criação de origem',
  toggle_ativo_agrupador: 'Ativação/desativação de origem',
  toggle_ativo_usuario: 'Ativação/desativação de usuário',
};

/** Lista de todos os tipos para uso em multi-select. */
export const HISTORICO_TIPOS_TODOS: HistoricoTipo[] = [
  'aprovacao_usuario',
  'rejeicao_usuario',
  'mudanca_role',
  'mudanca_permissao',
  'importacao_sei_json',
  'atribuicao_processos',
  'desatribuicao_processo',
  'distribuicao_csv',
  'adicao_manual',
  'exclusao_processos',
  'iniciar_processo',
  'concluir_processo',
  'envio_coordenacao',
  'devolucao_coordenacao',
  'conclusao_coordenacao',
  'espera_coordenacao',
  'reabrir_processo',
  'renovacao_prazo_processo',
  'marcar_processo_urgente',
  'desmarcar_processo_urgente',
  'aviso_global_criacao',
  'aviso_global_atualizacao',
  'aviso_global_status',
  'aviso_global_exclusao',
  'mudanca_prazo_agrupador',
  'mudanca_config_sistema',
  'criacao_agrupador',
  'toggle_ativo_agrupador',
  'toggle_ativo_usuario',
];

/**
 * Tailwind classes for a small badge per histórico tipo.
 *
 * Mapping (per spec):
 *  - aprovação    → verde (emerald)
 *  - rejeição     → vermelho (rose)
 *  - distribuição → bordô (brand)
 *  - manual       → azul
 *  - mudanças     → amarelo
 */
export function getHistoricoTipoCor(tipo: HistoricoTipo): string {
  switch (tipo) {
    case 'aprovacao_usuario':
    case 'concluir_processo':
    case 'conclusao_coordenacao':
      return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200';
    case 'rejeicao_usuario':
      return 'bg-rose-50 text-rose-700 ring-1 ring-rose-200';
    case 'distribuicao_csv':
    case 'importacao_sei_json':
    case 'atribuicao_processos':
      return 'bg-brand-primary/10 text-brand-primary ring-1 ring-brand-primary/30';
    case 'desatribuicao_processo':
    case 'devolucao_coordenacao':
    case 'desmarcar_processo_urgente':
      return 'bg-slate-100 text-slate-700 ring-1 ring-slate-200';
    case 'exclusao_processos':
    case 'marcar_processo_urgente':
      return 'bg-rose-50 text-rose-700 ring-1 ring-rose-200';
    case 'adicao_manual':
    case 'iniciar_processo':
    case 'criacao_agrupador':
    case 'envio_coordenacao':
    case 'aviso_global_criacao':
    case 'aviso_global_atualizacao':
      return 'bg-blue-50 text-blue-700 ring-1 ring-blue-200';
    case 'mudanca_role':
    case 'mudanca_permissao':
    case 'renovacao_prazo_processo':
    case 'mudanca_prazo_agrupador':
    case 'mudanca_config_sistema':
    case 'toggle_ativo_agrupador':
    case 'toggle_ativo_usuario':
    case 'reabrir_processo':
    case 'espera_coordenacao':
    case 'aviso_global_status':
      return 'bg-amber-50 text-amber-800 ring-1 ring-amber-200';
    case 'aviso_global_exclusao':
      return 'bg-rose-50 text-rose-700 ring-1 ring-rose-200';
  }
}

// ---------------------------------------------------------------------------
// resumirPayload
// ---------------------------------------------------------------------------

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function asBoolean(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

function roleLabel(role: string | null): string {
  if (role === 'recebedor') return 'Recebedor';
  if (role === 'distribuidor') return 'Distribuidor';
  if (role === 'pendente') return 'Pendente';
  return role ?? '—';
}

/**
 * Returns a short pt-BR sentence describing the histórico entry, suitable
 * for the "Detalhes" column of the audit table.
 *
 * Reads only well-known keys from `entry.payload`; falls back to a generic
 * description when fields are missing — never throws.
 */
export function resumirPayload(entry: HistoricoEntry): string {
  const p = entry.payload ?? {};

  switch (entry.tipo) {
    case 'aprovacao_usuario': {
      const roleNovo = roleLabel(asString(p.roleNovo));
      return `Aprovou usuário como ${roleNovo}.`;
    }
    case 'rejeicao_usuario':
      return 'Rejeitou usuário (marcado como inativo).';
    case 'mudanca_role': {
      const ant = roleLabel(asString(p.roleAnterior));
      const novo = roleLabel(asString(p.roleNovo));
      return `Papel alterado de ${ant} para ${novo}.`;
    }
    case 'mudanca_permissao': {
      const modoAnt = asString(p.modoAnterior) ?? '—';
      const modoNovo = asString(p.modoNovo) ?? '—';
      return `Permissões: modo ${modoAnt} → ${modoNovo}.`;
    }
    case 'importacao_sei_json': {
      const total = asNumber(p.totalProcessos);
      const substituidos = asNumber(p.totalSubstituidos);
      const concluidosPreservados = asNumber(p.totalConcluidosPreservados);
      const modo = asString(p.modo);
      const destino =
        modo === 'distribuidos'
          ? 'com distribuição inicial'
          : 'como não atribuídos';
      if (typeof total === 'number') {
        const complementos: string[] = [];
        if (typeof substituidos === 'number' && substituidos > 0) {
          complementos.push(
            `${substituidos} substituído${substituidos === 1 ? '' : 's'}`
          );
        }
        if (
          typeof concluidosPreservados === 'number' &&
          concluidosPreservados > 0
        ) {
          complementos.push(
            `${concluidosPreservados} concluído${concluidosPreservados === 1 ? '' : 's'} preservado${concluidosPreservados === 1 ? '' : 's'}`
          );
        }
        const complemento =
          complementos.length > 0 ? ` (${complementos.join('; ')})` : '';
        return `Importou JSON SEI: ${total} processo${total === 1 ? '' : 's'} ${destino}${complemento}.`;
      }
      return `Importou processos do JSON SEI ${destino}.`;
    }
    case 'atribuicao_processos': {
      const total = asNumber(p.totalProcessos);
      const recebedor = asString(p.recebedorNome);
      if (typeof total === 'number') {
        return `Atribuiu ${total} processo${total === 1 ? '' : 's'} para ${recebedor ?? 'recebedor'}.`;
      }
      return `Atribuiu processos para ${recebedor ?? 'recebedor'}.`;
    }
    case 'desatribuicao_processo': {
      const numero = asString(p.numero);
      const recebedor = asString(p.recebedorNomeAnterior);
      const statusAnterior = asString(p.statusAnterior);
      const partes: string[] = [];
      if (numero) partes.push(`nº ${numero}`);
      if (recebedor) partes.push(`de ${recebedor}`);
      if (statusAnterior) partes.push(`status anterior ${statusAnterior}`);
      return partes.length
        ? `Voltou processo para a fila: ${partes.join(' — ')}.`
        : 'Voltou processo para a fila.';
    }
    case 'distribuicao_csv': {
      const total = asNumber(p.totalProcessos);
      if (typeof total === 'number') {
        return `Distribuiu legado: ${total} processo${total === 1 ? '' : 's'}.`;
      }
      return 'Distribuiu processos legados.';
    }
    case 'adicao_manual': {
      const numero = asString(p.numero);
      const agrup = asString(p.agrupadorNome);
      const partes: string[] = [];
      if (numero) partes.push(`nº ${numero}`);
      if (agrup) partes.push(agrup);
      return partes.length
        ? `Adição manual: ${partes.join(' — ')}.`
        : 'Adicionou processo manual.';
    }
    case 'exclusao_processos': {
      const total = asNumber(p.totalProcessos);
      if (typeof total === 'number') {
        return `Excluiu ${total} processo${total === 1 ? '' : 's'}.`;
      }
      return 'Excluiu processos.';
    }
    case 'iniciar_processo':
      return 'Iniciou processo (status → Em andamento).';
    case 'concluir_processo': {
      const devolvido = asBoolean(p.devolvido);
      const conclusaoSemDados = asBoolean(p.conclusaoSemDados);
      if (conclusaoSemDados === true) {
        return 'Concluiu processo sem preencher dados de conclusão.';
      }
      const dados = formatDadosConclusao(
        p.dadosConclusao as Parameters<typeof formatDadosConclusao>[0]
      );
      const execucao = dados.find(
        (item) => item.label === 'Nº da execução penal'
      );
      const comarca = dados.find((item) => item.label === 'Comarca');
      const detalhe =
        execucao || comarca
          ? ` (${[execucao?.value, comarca?.value].filter(Boolean).join(' — ')})`
          : '';
      if (devolvido === true) {
        return `Concluiu processo como devolvido${detalhe}.`;
      }
      if (devolvido === false) {
        return `Concluiu processo sem devolução${detalhe}.`;
      }
      return `Concluiu processo${detalhe}.`;
    }
    case 'envio_coordenacao': {
      const enviadoPor = asString(p.enviadoPorNome);
      return enviadoPor
        ? `Enviou processo para coordenação: ${enviadoPor}.`
        : 'Enviou processo para coordenação.';
    }
    case 'devolucao_coordenacao': {
      const enviadoPor = asString(p.enviadoPorNome);
      return enviadoPor
        ? `Coordenação devolveu processo para ${enviadoPor}.`
        : 'Coordenação devolveu processo ao recebedor.';
    }
    case 'conclusao_coordenacao':
      return 'Coordenação concluiu processo.';
    case 'espera_coordenacao':
      return 'Coordenação colocou processo em espera.';
    case 'reabrir_processo': {
      const statusNovo = asString(p.statusNovo);
      if (statusNovo === 'em_andamento') {
        return 'Reabriu processo (status → Em andamento).';
      }
      if (statusNovo === 'pendente') {
        return 'Marcou processo como pendente.';
      }
      return 'Reabriu processo.';
    }
    case 'mudanca_prazo_agrupador': {
      const ant = p.prazoAnterior;
      const novo = p.prazoNovo;
      const fmt = (v: unknown) => (v === null ? 'padrão' : String(asNumber(v) ?? '—'));
      return `Prazo da origem alterado: ${fmt(ant)} → ${fmt(novo)} dias úteis.`;
    }
    case 'renovacao_prazo_processo': {
      const numero = asString(p.numero);
      const novo = asString(p.prazoNovo);
      const dias = asNumber(p.prazoDiasUteis);
      const partes: string[] = [];
      if (numero) partes.push(`nº ${numero}`);
      if (novo) partes.push(`novo prazo ${novo}`);
      if (typeof dias === 'number') {
        partes.push(`${dias} dia${dias === 1 ? '' : 's'} úteis`);
      }
      return partes.length
        ? `Renovou prazo: ${partes.join(' — ')}.`
        : 'Renovou prazo de processo.';
    }
    case 'marcar_processo_urgente': {
      const numero = asString(p.numero);
      return numero
        ? `Marcou processo nº ${numero} como urgente.`
        : 'Marcou processo como urgente.';
    }
    case 'desmarcar_processo_urgente': {
      const numero = asString(p.numero);
      return numero
        ? `Removeu urgência do processo nº ${numero}.`
        : 'Removeu urgência do processo.';
    }
    case 'aviso_global_criacao': {
      const title = asString(p.title);
      return title ? `Publicou aviso: ${title}.` : 'Publicou aviso global.';
    }
    case 'aviso_global_atualizacao': {
      const title = asString(p.title);
      return title ? `Atualizou aviso: ${title}.` : 'Atualizou aviso global.';
    }
    case 'aviso_global_status': {
      const title = asString(p.title);
      const active = asBoolean(p.active);
      const action =
        active === true
          ? 'Reativou aviso'
          : active === false
            ? 'Pausou aviso'
            : 'Alterou aviso';
      return title ? `${action}: ${title}.` : `${action} global.`;
    }
    case 'aviso_global_exclusao': {
      const title = asString(p.title);
      return title ? `Excluiu aviso: ${title}.` : 'Excluiu aviso global.';
    }
    case 'mudanca_config_sistema': {
      const partes: string[] = [];
      const prazo = asNumber(p.prazoPadraoDiasUteis);
      if (typeof prazo === 'number') {
        partes.push(`prazo padrão = ${prazo} dia${prazo === 1 ? '' : 's'} úteis`);
      }
      if (Array.isArray(p.feriadosNacionais)) {
        partes.push(`${(p.feriadosNacionais as unknown[]).length} feriados`);
      }
      if (Array.isArray(p.coordenacaoNotificacaoDistribuidorUids)) {
        partes.push(
          `${
            (p.coordenacaoNotificacaoDistribuidorUids as unknown[]).length
          } destinatário(s) de aviso da coordenação`
        );
      }
      return partes.length
        ? `Configuração atualizada (${partes.join(', ')}).`
        : 'Configuração do sistema atualizada.';
    }
    case 'criacao_agrupador': {
      const nome = asString(p.nome);
      const origem = asString(p.origem);
      if (origem === 'seed') {
        return nome ? `Carregado padrão: ${nome}.` : 'Carregou origem padrão.';
      }
      return nome ? `Criou origem "${nome}".` : 'Criou origem.';
    }
    case 'toggle_ativo_agrupador': {
      const ativo = asBoolean(p.ativo);
      return ativo === null
        ? 'Alterou status de ativação da origem.'
        : ativo
        ? 'Reativou origem.'
        : 'Desativou origem.';
    }
    case 'toggle_ativo_usuario': {
      const ativo = asBoolean(p.ativo);
      return ativo === null
        ? 'Alterou status de ativação do usuário.'
        : ativo
        ? 'Reativou usuário.'
        : 'Desativou usuário.';
    }
  }
}
