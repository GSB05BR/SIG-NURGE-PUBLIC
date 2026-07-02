import type { Timestamp } from 'firebase/firestore';

// ----- Enums (string unions) -----

export type UserRole = 'pendente' | 'recebedor' | 'distribuidor';

export type NoticeTargetRole = 'recebedores' | 'distribuidores';

export type AgrupadoresMode = 'todos' | 'especificos';

export type ProcessoStatus =
  | 'nao_atribuido'
  | 'pendente'
  | 'em_andamento'
  | 'em_coordenacao'
  | 'em_espera'
  | 'concluido';

export type ProcessoOrigem = 'sei_json' | 'csv' | 'manual';

export type ProcessoRegime = 'aberto' | 'fechado';

export type BeneficioPendenteConclusao =
  | 'progressao_semiaberto_vencida'
  | 'progressao_aberto_vencida'
  | 'livramento_condicional_vencido'
  | 'ppl_regime_aberto_preso'
  | 'prd_sursis_preso'
  | 'termino_pena'
  | 'indulto'
  | 'comutacao';

export type ConclusaoTipoPena =
  | 'privativa_liberdade'
  | 'privativa_liberdade_sursis'
  | 'restritiva_direitos'
  | 'medida_seguranca';

export type ConclusaoRegimeCondenacao =
  | 'fechado'
  | 'semiaberto'
  | 'aberto'
  | 'indefinido_medida_seguranca';

export type ConclusaoSituacaoPrisao =
  | 'preso_guia_recolhimento'
  | 'preso_outro_processo'
  | 'nao_preso';

export type ConclusaoAtividade =
  | 'cadastro_implantacao'
  | 'implantacao'
  | 'pendencia';

export interface DadosConclusaoProcesso {
  guiaExecucaoNumero: string;
  sentenciadoNome: string;
  tipoPena: ConclusaoTipoPena;
  regimeCondenacao: ConclusaoRegimeCondenacao;
  situacaoPrisao: ConclusaoSituacaoPrisao;
  atividade: ConclusaoAtividade;
  execucaoPenalNumero: string;
  comarca: string;
  beneficiosPendentes: BeneficioPendenteConclusao[];
}

export type DiaSemana = 'segunda' | 'terca' | 'quarta' | 'quinta' | 'sexta';

export type DistribuicaoStatus =
  | 'rascunho'
  | 'simulada'
  | 'confirmada'
  | 'descartada';

export type HistoricoTipo =
  | 'aprovacao_usuario'
  | 'rejeicao_usuario'
  | 'mudanca_role'
  | 'mudanca_permissao'
  | 'importacao_sei_json'
  | 'atribuicao_processos'
  | 'desatribuicao_processo'
  | 'distribuicao_csv'
  | 'adicao_manual'
  | 'exclusao_processos'
  | 'iniciar_processo'
  | 'concluir_processo'
  | 'envio_coordenacao'
  | 'devolucao_coordenacao'
  | 'conclusao_coordenacao'
  | 'espera_coordenacao'
  | 'reabrir_processo'
  | 'renovacao_prazo_processo'
  | 'marcar_processo_urgente'
  | 'desmarcar_processo_urgente'
  | 'aviso_global_criacao'
  | 'aviso_global_atualizacao'
  | 'aviso_global_status'
  | 'aviso_global_exclusao'
  | 'mudanca_prazo_agrupador'
  | 'mudanca_config_sistema'
  | 'criacao_agrupador'
  | 'toggle_ativo_agrupador'
  | 'toggle_ativo_usuario';

// ----- Domain interfaces -----

export interface User {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string | null;
  role: UserRole;
  approved: boolean;
  approvedByUid: string | null;
  approvedAt: Timestamp | null;
  agrupadoresMode: AgrupadoresMode | null;
  agrupadoresPermitidos: string[];
  ativo: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Agrupador {
  id: string;
  nome: string;
  prazoDiasUteisOverride: number | null;
  ativo: boolean;
  createdAt: Timestamp;
}

export interface UnidadeSei {
  nome: string;
  sigla: string;
}

export interface ResponsavelSei {
  login: string;
  nome: string;
}

export type EventoNurgeTipo =
  | 'entrada_nurge'
  | 'devolucao_origem'
  | 'atribuicao_nurge'
  | 'outro';

export interface EventoNurge {
  tipo: EventoNurgeTipo;
  dataHora: string | null;
  dataISO: string | null;
  descricao: string;
  unidade: UnidadeSei | null;
  usuario: ResponsavelSei | null;
}

export interface CicloNurge {
  entrada: EventoNurge | null;
  devolucaoOrigem: EventoNurge | null;
  retornoNurge: EventoNurge | null;
  atribuidoPara: ResponsavelSei | null;
}

export interface Processo {
  id: string;
  numero: string;
  agrupadorId: string;
  agrupadorNome: string;
  urgente: boolean;
  prioridade: boolean;
  regime: ProcessoRegime;
  recebedorUid: string | null;
  diaSemana: DiaSemana;
  status: ProcessoStatus;
  origem: ProcessoOrigem;
  distribuicaoId: string | null;
  diaAtribuicao: Timestamp;
  prazoFinal: Timestamp;
  semanaIso: string;
  concluidoEm: Timestamp | null;
  iniciadoEm: Timestamp | null;
  devolvido: boolean | null;
  /** UID do recebedor "dono" do número (definido quando ele concluiu como
   *  devolvido, a partir do lançamento). Faz o processo voltar pra mesma pessoa
   *  na redistribuição da fila. Derivado na importação SEI. */
  recebedorVinculadoUid?: string | null;
  observacaoInicio: string | null;
  observacaoConclusao: string | null;
  dadosConclusao?: DadosConclusaoProcesso | null;
  coordenacaoEnviadoEm?: Timestamp | null;
  coordenacaoEnviadoPorUid?: string | null;
  coordenacaoEnviadoPorNome?: string | null;
  coordenacaoEnviadoPorEmail?: string | null;
  coordenacaoUltimaAcaoEm?: Timestamp | null;
  coordenacaoUltimaAcaoPorUid?: string | null;
  coordenacaoUltimaAcaoPorNome?: string | null;
  coordenacaoUltimaObservacao?: string | null;
  ordemCsv: number | null;
  adicionadoPorUid: string | null;
  observacao: string | null;
  idProcedimento?: string | null;
  seiUrl?: string | null;
  seiHistoricoUrl?: string | null;
  tooltip?: string | null;
  historyMode?: string | null;
  historyCount?: number | null;
  capturedAt?: string | null;
  importacaoId?: string | null;
  unidadeOrigem?: UnidadeSei | null;
  primeiraEntradaNurgeEm?: Timestamp | null;
  primeiraDevolucaoOrigemEm?: Timestamp | null;
  ultimoRetornoNurgeEm?: Timestamp | null;
  /** Última atribuição a usuário do NURGE; twin persistido do scan do histórico. */
  ultimaAtribuicaoNurgeEm?: Timestamp | null;
  primeiroResponsavelNurge?: ResponsavelSei | null;
  /** Responsável da última atribuição NURGE; twin persistido do scan do histórico. */
  ultimoResponsavelNurge?: ResponsavelSei | null;
  ciclosNurge?: CicloNurge[];
  /**
   * Histórico SEI completo. A partir do item 7 fica no subdoc
   * `processos/{id}/detalhes/historico`; só vem inline em docs legados (ainda
   * não migrados). Use `getHistoricoSeiProcesso()` para ler com fallback.
   */
  historicoSei?: EventoNurge[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * Snapshot diário de processos pendentes, gravado pela Cloud Function às 6h
 * (America/Sao_Paulo). Doc id = data ISO "YYYY-MM-DD" da manhã em que rodou.
 * Representa os pendentes que ficaram da véspera ("pendentes de ontem").
 */
export interface PendentesSnapshot {
  /** "YYYY-MM-DD" — mesmo valor do doc id. */
  data: string;
  /** Quando a Cloud Function gravou o snapshot. */
  capturadoEm: Timestamp | null;
  /** Total geral de pendentes no momento do snapshot. */
  total: number;
  /** Pendentes por recebedorUid no momento do snapshot. */
  porRecebedor: Record<string, number>;
}

export interface DistribuicaoConfiguracaoDiaria {
  segunda: number;
  terca: number;
  quarta: number;
  quinta: number;
  sexta: number;
}

export type DistribuicaoConfiguracaoPorRecebedor = Record<
  string,
  DistribuicaoConfiguracaoDiaria
>;

export interface DistribuicaoResumo {
  porDia: Record<string, number>;
  porAgrupador: Record<string, number>;
  porRecebedor: Record<string, number>;
  urgentes: number;
  prioridades: number;
  naoAtribuidos: number;
}

export interface Distribuicao {
  id: string;
  semanaIso: string;
  dataBaseIso?: string;
  dataFinalIso?: string;
  regime?: ProcessoRegime;
  fileName: string;
  totalProcessos: number;
  configuracaoDiaria: DistribuicaoConfiguracaoDiaria;
  configuracaoPorRecebedor?: DistribuicaoConfiguracaoPorRecebedor;
  status: DistribuicaoStatus;
  excedeuQuota: boolean;
  resumo: DistribuicaoResumo;
  criadoPorUid: string;
  criadoEm: Timestamp;
  confirmadoEm: Timestamp | null;
  descartadoEm?: Timestamp | null;
  descartadoPorUid?: string | null;
}

export interface ConfigSistema {
  prazoPadraoDiasUteis: number;
  feriadosNacionais: string[];
  coordenacaoNotificacaoDistribuidorUids: string[];
  ultimaAtualizacaoUid: string;
  ultimaAtualizacaoEm: Timestamp;
}

export interface GlobalNotice {
  id: string;
  title: string;
  bodyHtml: string;
  targetRoles: NoticeTargetRole[];
  /**
   * Envio individual: uids específicos que devem receber o aviso. Quando
   * presente e não vazio, tem precedência sobre `targetRoles` (ver
   * `noticeTargetsUser`). Vazio/ausente => aviso por papel (comportamento legado).
   */
  targetUserUids?: string[] | null;
  active: boolean;
  noticeVersion: number;
  createdAtMs: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdByUid: string;
  createdByName: string;
  updatedByUid: string;
  reactivatedAtMs?: number | null;
  reactivatedAt?: Timestamp | null;
  reactivatedByUid?: string | null;
}

export interface HistoricoEntry {
  id: string;
  tipo: HistoricoTipo;
  acaoPorUid: string;
  acaoPorNome: string;
  alvoUid: string | null;
  processoId: string | null;
  payload: Record<string, unknown>;
  timestamp: Timestamp;
}

// ----- Suporte (chamados/sugestões) -----

export type SuporteTipo = 'suporte' | 'sugestao';

export type SuporteStatus =
  | 'em_analise'
  | 'implementando'
  | 'descartado'
  | 'concluido';

export interface SuporteAnexo {
  nome: string;
  tipoArquivo: 'image' | 'pdf';
  mime: string;
  tamanho: number;
  storagePath: string;
  url: string;
}

export interface SuporteTicket {
  id: string;
  tipo: SuporteTipo;
  titulo: string;
  descricao: string;
  anexos: SuporteAnexo[];
  status: SuporteStatus;
  criadoPorUid: string;
  criadoPorNome: string;
  criadoPorEmail: string;
  comentariosCount: number;
  ultimaAtividadeEm: Timestamp;
  ultimaAcaoPorUid: string;
  criadoEm: Timestamp;
  atualizadoEm: Timestamp;
}

export interface SuporteComentario {
  id: string;
  texto: string;
  anexos: SuporteAnexo[];
  autorUid: string;
  autorNome: string;
  autorRole: 'recebedor' | 'distribuidor';
  criadoEm: Timestamp;
}

export type SuporteNotificacaoTipo =
  | 'novo_chamado'
  | 'novo_comentario'
  | 'mudanca_status';

export interface SuporteNotificacao {
  id: string;
  ticketId: string;
  ticketTitulo: string;
  tipo: SuporteNotificacaoTipo;
  texto: string;
  porNome: string;
  status?: SuporteStatus | null;
  lida: boolean;
  criadoEm: Timestamp;
}
