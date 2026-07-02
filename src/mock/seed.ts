/**
 * DADOS 100% FICTÍCIOS — showcase de UI.
 *
 * Nada aqui é real: nomes, e-mails, números de processo, sentenciados, comarcas
 * e datas foram inventados apenas para demonstrar a interface. Qualquer
 * semelhança com pessoas ou processos reais é mera coincidência.
 *
 * Este arquivo alimenta o "banco em memória" (`src/mock/db.ts`) que substitui o
 * Firebase no showcase público. Sem rede, sem credenciais, sem backend.
 */
import { Timestamp } from 'firebase/firestore';
import { addDiasUteis, getSemanaIso, nowInSp } from '@/lib/datetime';
import type {
  Agrupador,
  ConfigSistema,
  DiaSemana,
  Distribuicao,
  GlobalNotice,
  HistoricoEntry,
  Processo,
  ProcessoStatus,
  SuporteComentario,
  SuporteNotificacao,
  SuporteTicket,
  User,
} from '@/types';

// ---------------------------------------------------------------------------
// Helpers de data/tempo (tudo derivado do "agora" do navegador).
// ---------------------------------------------------------------------------

const BASE = nowInSp();

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** Timestamp a `days` dias (e `hour`h) do agora. */
function ts(days: number, hour = 9): Timestamp {
  const d = addDays(BASE, days);
  d.setHours(hour, (Math.abs(days * 7) % 60), 0, 0);
  return Timestamp.fromDate(d);
}

const NOW = Timestamp.fromDate(BASE);

// ---------------------------------------------------------------------------
// Personas de demonstração (login sem Google — ver src/services/firebase/auth.ts)
// ---------------------------------------------------------------------------

export const DEMO_DISTRIBUIDOR_UID = 'demo-distribuidor';
export const DEMO_RECEBEDOR_UID = 'demo-recebedor';
export const DEMO_DISTRIBUIDOR_EMAIL = 'distribuidor.demo@exemplo.com';
export const DEMO_RECEBEDOR_EMAIL = 'recebedor.demo@exemplo.com';

// ---------------------------------------------------------------------------
// Usuários (inventados)
// ---------------------------------------------------------------------------

function makeUser(u: Partial<User> & Pick<User, 'uid' | 'displayName' | 'email' | 'role'>): User {
  return {
    photoURL: null,
    approved: true,
    approvedByUid: DEMO_DISTRIBUIDOR_UID,
    approvedAt: ts(-40),
    agrupadoresMode: 'todos',
    agrupadoresPermitidos: [],
    ativo: true,
    createdAt: ts(-60),
    updatedAt: ts(-2),
    ...u,
  };
}

export const seedUsers: User[] = [
  makeUser({
    uid: DEMO_DISTRIBUIDOR_UID,
    displayName: 'Marina (Distribuidor Demo)',
    email: DEMO_DISTRIBUIDOR_EMAIL,
    role: 'distribuidor',
  }),
  makeUser({
    uid: 'dist-2',
    displayName: 'Roberto Camargo',
    email: 'roberto.camargo@exemplo.com',
    role: 'distribuidor',
  }),
  makeUser({
    uid: DEMO_RECEBEDOR_UID,
    displayName: 'Bruno (Recebedor Demo)',
    email: DEMO_RECEBEDOR_EMAIL,
    role: 'recebedor',
  }),
  makeUser({ uid: 'rec-ana', displayName: 'Ana Beatriz Nunes', email: 'ana.nunes@exemplo.com', role: 'recebedor' }),
  makeUser({ uid: 'rec-carlos', displayName: 'Carlos Eduardo Ramos', email: 'carlos.ramos@exemplo.com', role: 'recebedor' }),
  makeUser({ uid: 'rec-daniela', displayName: 'Daniela Figueiredo', email: 'daniela.figueiredo@exemplo.com', role: 'recebedor' }),
  makeUser({ uid: 'rec-eduardo', displayName: 'Eduardo Tavares', email: 'eduardo.tavares@exemplo.com', role: 'recebedor' }),
  makeUser({
    uid: 'rec-fernanda',
    displayName: 'Fernanda Lopes',
    email: 'fernanda.lopes@exemplo.com',
    role: 'recebedor',
    agrupadoresMode: 'especificos',
    agrupadoresPermitidos: ['agr-a', 'agr-b'],
  }),
  makeUser({ uid: 'rec-gustavo', displayName: 'Gustavo Henrique Dias', email: 'gustavo.dias@exemplo.com', role: 'recebedor', ativo: false }),
  // Usuário pendente (mostra o fluxo de aprovação em /distribuidor/usuarios).
  makeUser({
    uid: 'pend-1',
    displayName: 'Helena Prado',
    email: 'helena.prado@exemplo.com',
    role: 'pendente',
    approved: false,
    approvedByUid: null,
    approvedAt: null,
    agrupadoresMode: null,
    createdAt: ts(-1),
    updatedAt: ts(-1),
  }),
];

const RECEBEDORES = seedUsers.filter((u) => u.role === 'recebedor' && u.ativo);

// ---------------------------------------------------------------------------
// Agrupadores (inventados)
// ---------------------------------------------------------------------------

export const seedAgrupadores: Agrupador[] = [
  { id: 'agr-a', nome: 'Comarca Central', prazoDiasUteisOverride: null, ativo: true, createdAt: ts(-90) },
  { id: 'agr-b', nome: 'Comarca Norte', prazoDiasUteisOverride: 8, ativo: true, createdAt: ts(-90) },
  { id: 'agr-c', nome: 'Comarca Sul', prazoDiasUteisOverride: null, ativo: true, createdAt: ts(-90) },
  { id: 'agr-d', nome: 'Comarca Leste', prazoDiasUteisOverride: 12, ativo: true, createdAt: ts(-90) },
  { id: 'agr-e', nome: 'Regime Fechado', prazoDiasUteisOverride: null, ativo: false, createdAt: ts(-90) },
];

const AGR_ATIVOS = seedAgrupadores.filter((a) => a.ativo);

// ---------------------------------------------------------------------------
// Processos (inventados) — gerados com variedade de status/semana/recebedor.
// ---------------------------------------------------------------------------

const NOMES_SENTENCIADOS = [
  'José Antônio da Silva', 'Marcos Vinícius Pereira', 'Rafael Augusto Costa',
  'Luiz Fernando Souza', 'Paulo Sérgio Almeida', 'André Luís Rocha',
  'Ricardo Gomes Martins', 'Fábio Henrique Barbosa', 'Diego Nascimento Cruz',
  'Thiago Moreira Lima', 'Rodrigo Santos Ferreira', 'Wesley Oliveira Pinto',
  'Alexandre Dias Cardoso', 'Vinícius Araújo Melo', 'Gabriel Mendes Teixeira',
  'Bruno Carvalho Freitas', 'Leonardo Ribeiro Nunes', 'Matheus Correia Lopes',
];

const COMARCAS = ['Belo Horizonte', 'Uberlândia', 'Contagem', 'Juiz de Fora', 'Betim', 'Montes Claros'];
const DIAS: DiaSemana[] = ['segunda', 'terca', 'quarta', 'quinta', 'sexta'];

function numeroSei(seq: number): string {
  const a = String(1000000 + seq * 137).padStart(7, '0').slice(0, 7);
  const b = String((seq * 7) % 100).padStart(2, '0');
  const c = String((seq * 3) % 1000).padStart(3, '0');
  return `${a}-${b}.2024.8.13.0${c}`;
}

interface GenSpec {
  status: ProcessoStatus;
  recebedorUid: string | null;
  diaOffset: number; // dias relativos ao agora p/ diaAtribuicao
  urgente?: boolean;
  concluidoOffset?: number | null;
  iniciadoOffset?: number | null;
  devolvido?: boolean;
}

let seq = 0;
function makeProcesso(spec: GenSpec): Processo {
  seq += 1;
  const agr = AGR_ATIVOS[seq % AGR_ATIVOS.length];
  const dia = DIAS[seq % DIAS.length];
  const diaAtribuicao = ts(spec.diaOffset, 10);
  const diaAtribDate = diaAtribuicao.toDate();
  const prazoFinal = Timestamp.fromDate(addDiasUteis(diaAtribDate, agr.prazoDiasUteisOverride ?? 10, []));
  const concluido = spec.concluidoOffset != null;
  const nome = NOMES_SENTENCIADOS[seq % NOMES_SENTENCIADOS.length];
  const comarca = COMARCAS[seq % COMARCAS.length];
  return {
    id: `proc-${seq}`,
    numero: numeroSei(seq),
    agrupadorId: agr.id,
    agrupadorNome: agr.nome,
    urgente: spec.urgente ?? false,
    prioridade: spec.urgente ?? false,
    regime: seq % 4 === 0 ? 'fechado' : 'aberto',
    recebedorUid: spec.recebedorUid,
    diaSemana: dia,
    status: spec.status,
    origem: seq % 3 === 0 ? 'manual' : 'sei_json',
    distribuicaoId: spec.recebedorUid ? 'dist-atual' : null,
    diaAtribuicao,
    prazoFinal,
    semanaIso: getSemanaIso(diaAtribDate),
    concluidoEm: concluido ? ts(spec.concluidoOffset as number, 15) : null,
    iniciadoEm: spec.iniciadoOffset != null ? ts(spec.iniciadoOffset, 11) : concluido ? ts((spec.concluidoOffset as number) - 1, 11) : null,
    devolvido: spec.devolvido ?? null,
    observacaoInicio: spec.iniciadoOffset != null ? 'Análise iniciada (demo).' : null,
    observacaoConclusao: concluido ? 'Implantação registrada (demo).' : null,
    dadosConclusao: concluido
      ? {
          guiaExecucaoNumero: `GEP-${1000 + seq}`,
          sentenciadoNome: nome,
          tipoPena: 'privativa_liberdade',
          regimeCondenacao: 'semiaberto',
          situacaoPrisao: 'preso_guia_recolhimento',
          atividade: 'implantacao',
          execucaoPenalNumero: numeroSei(seq + 500),
          comarca,
          beneficiosPendentes: seq % 5 === 0 ? ['progressao_semiaberto_vencida'] : [],
        }
      : null,
    ordemCsv: seq,
    adicionadoPorUid: DEMO_DISTRIBUIDOR_UID,
    observacao: `${nome} — ${comarca} (dados fictícios)`,
    idProcedimento: `${20240000 + seq}`,
    seiUrl: null,
    seiHistoricoUrl: null,
    tooltip: null,
    unidadeOrigem: { nome: `Vara de Execuções Penais de ${comarca}`, sigla: `VEP-${comarca.slice(0, 3).toUpperCase()}` },
    primeiraEntradaNurgeEm: ts(spec.diaOffset - 5, 8),
    ultimoResponsavelNurge: spec.recebedorUid
      ? { login: spec.recebedorUid, nome: seedUsers.find((u) => u.uid === spec.recebedorUid)?.displayName ?? 'Recebedor' }
      : null,
    ciclosNurge: [],
    createdAt: ts(spec.diaOffset - 5, 8),
    updatedAt: ts(spec.diaOffset, 12),
  };
}

function recForIndex(i: number): string {
  return RECEBEDORES[i % RECEBEDORES.length].uid;
}

const processos: Processo[] = [];

// Não atribuídos (estoque sem recebedor) — telas: Não atribuídos / Processos.
for (let i = 0; i < 7; i += 1) {
  processos.push(makeProcesso({ status: 'nao_atribuido', recebedorUid: null, diaOffset: -3 + i, urgente: i % 4 === 0 }));
}

// Pendentes desta semana (distribuídos, ainda não iniciados).
for (let i = 0; i < 12; i += 1) {
  processos.push(makeProcesso({ status: 'pendente', recebedorUid: recForIndex(i), diaOffset: [-1, 0, 1, 2][i % 4], urgente: i % 6 === 0 }));
}

// Em andamento (iniciados) — inclui a persona recebedor demo.
for (let i = 0; i < 8; i += 1) {
  processos.push(makeProcesso({
    status: 'em_andamento',
    recebedorUid: i < 3 ? DEMO_RECEBEDOR_UID : recForIndex(i),
    diaOffset: [-2, -1, 0][i % 3],
    iniciadoOffset: -1,
    urgente: i === 0,
  }));
}

// Alguns pendentes/atrasados da persona recebedor demo (para o Dashboard/Atrasados).
processos.push(makeProcesso({ status: 'pendente', recebedorUid: DEMO_RECEBEDOR_UID, diaOffset: -8, urgente: true }));
processos.push(makeProcesso({ status: 'pendente', recebedorUid: DEMO_RECEBEDOR_UID, diaOffset: -1 }));

// Em coordenação / em espera — tela Coordenação.
for (let i = 0; i < 5; i += 1) {
  const p = makeProcesso({ status: i % 2 === 0 ? 'em_coordenacao' : 'em_espera', recebedorUid: i === 0 ? DEMO_RECEBEDOR_UID : recForIndex(i), diaOffset: -4, iniciadoOffset: -3 });
  p.coordenacaoEnviadoEm = ts(-3, 14);
  p.coordenacaoEnviadoPorUid = p.recebedorUid;
  p.coordenacaoEnviadoPorNome = seedUsers.find((u) => u.uid === p.recebedorUid)?.displayName ?? 'Recebedor';
  p.coordenacaoUltimaObservacao = 'Encaminhado para orientação da coordenação (demo).';
  processos.push(p);
}

// Semana passada e próxima (para as abas da Visão Geral).
for (let i = 0; i < 6; i += 1) {
  processos.push(makeProcesso({ status: 'pendente', recebedorUid: recForIndex(i), diaOffset: -7 + (i % 5) - 5 }));
  processos.push(makeProcesso({ status: 'pendente', recebedorUid: recForIndex(i + 2), diaOffset: 7 + (i % 5) }));
}

// Concluídos ao longo do mês (produtividade / histórico) — vários por recebedor.
for (let i = 0; i < 22; i += 1) {
  const rec = i < 6 ? DEMO_RECEBEDOR_UID : recForIndex(i);
  const off = -Math.floor(i * 1.2) - 1;
  processos.push(makeProcesso({
    status: 'concluido',
    recebedorUid: rec,
    diaOffset: off - 2,
    iniciadoOffset: off - 1,
    concluidoOffset: off,
    devolvido: i % 4 === 0,
    urgente: i % 7 === 0,
  }));
}

export const seedProcessos: Processo[] = processos;

// ---------------------------------------------------------------------------
// Distribuições (inventadas)
// ---------------------------------------------------------------------------

function contagemDiaria(base: number) {
  return { segunda: base, terca: base, quarta: base, quinta: base, sexta: base };
}

export const seedDistribuicoes: Distribuicao[] = [
  {
    id: 'dist-atual',
    semanaIso: getSemanaIso(BASE),
    dataBaseIso: undefined,
    fileName: 'distribuicao-demo-semana-atual.json',
    totalProcessos: 34,
    configuracaoDiaria: contagemDiaria(4),
    status: 'confirmada',
    excedeuQuota: false,
    resumo: {
      porDia: { segunda: 8, terca: 7, quarta: 6, quinta: 7, sexta: 6 },
      porAgrupador: { 'Comarca Central': 10, 'Comarca Norte': 8, 'Comarca Sul': 9, 'Comarca Leste': 7 },
      porRecebedor: Object.fromEntries(RECEBEDORES.map((r, i) => [r.uid, 4 + (i % 3)])),
      urgentes: 5,
      prioridades: 5,
      naoAtribuidos: 7,
    },
    criadoPorUid: DEMO_DISTRIBUIDOR_UID,
    criadoEm: ts(-2, 9),
    confirmadoEm: ts(-2, 9),
  },
  {
    id: 'dist-anterior',
    semanaIso: getSemanaIso(addDays(BASE, -7)),
    fileName: 'distribuicao-demo-semana-passada.json',
    totalProcessos: 28,
    configuracaoDiaria: contagemDiaria(3),
    status: 'confirmada',
    excedeuQuota: true,
    resumo: {
      porDia: { segunda: 6, terca: 6, quarta: 5, quinta: 6, sexta: 5 },
      porAgrupador: { 'Comarca Central': 9, 'Comarca Norte': 6, 'Comarca Sul': 7, 'Comarca Leste': 6 },
      porRecebedor: Object.fromEntries(RECEBEDORES.map((r, i) => [r.uid, 3 + (i % 2)])),
      urgentes: 3,
      prioridades: 3,
      naoAtribuidos: 2,
    },
    criadoPorUid: DEMO_DISTRIBUIDOR_UID,
    criadoEm: ts(-9, 9),
    confirmadoEm: ts(-9, 9),
  },
];

// ---------------------------------------------------------------------------
// Avisos globais (inventados)
// ---------------------------------------------------------------------------

export const seedNotices: GlobalNotice[] = [
  {
    id: 'notice-1',
    title: 'Bem-vindo ao showcase do SIG-NURGE',
    bodyHtml:
      '<p>Esta é uma <strong>demonstração pública da interface</strong>. Todos os dados são fictícios e gerados apenas para ilustração.</p><p>Explore as telas livremente — nada é salvo em servidor.</p>',
    targetRoles: ['recebedores', 'distribuidores'],
    targetUserUids: null,
    active: true,
    noticeVersion: 1,
    createdAtMs: BASE.getTime() - 3 * 86400000,
    createdAt: ts(-3),
    updatedAt: ts(-3),
    createdByUid: DEMO_DISTRIBUIDOR_UID,
    createdByName: 'Marina (Distribuidor Demo)',
    updatedByUid: DEMO_DISTRIBUIDOR_UID,
  },
  {
    id: 'notice-2',
    title: 'Prazos da próxima semana',
    bodyHtml: '<p>Lembrete fictício: confira os prazos dos processos em andamento.</p>',
    targetRoles: ['recebedores'],
    targetUserUids: null,
    active: false,
    noticeVersion: 1,
    createdAtMs: BASE.getTime() - 10 * 86400000,
    createdAt: ts(-10),
    updatedAt: ts(-10),
    createdByUid: DEMO_DISTRIBUIDOR_UID,
    createdByName: 'Marina (Distribuidor Demo)',
    updatedByUid: DEMO_DISTRIBUIDOR_UID,
  },
];

// ---------------------------------------------------------------------------
// Histórico (inventado)
// ---------------------------------------------------------------------------

export const seedHistorico: HistoricoEntry[] = [
  { id: 'h1', tipo: 'importacao_sei_json', acaoPorUid: DEMO_DISTRIBUIDOR_UID, acaoPorNome: 'Marina (Distribuidor Demo)', alvoUid: null, processoId: null, payload: { total: 34, arquivo: 'demo.json' }, timestamp: ts(-2, 9) },
  { id: 'h2', tipo: 'atribuicao_processos', acaoPorUid: DEMO_DISTRIBUIDOR_UID, acaoPorNome: 'Marina (Distribuidor Demo)', alvoUid: 'rec-ana', processoId: null, payload: { quantidade: 6 }, timestamp: ts(-2, 10) },
  { id: 'h3', tipo: 'aprovacao_usuario', acaoPorUid: DEMO_DISTRIBUIDOR_UID, acaoPorNome: 'Marina (Distribuidor Demo)', alvoUid: 'rec-eduardo', processoId: null, payload: { email: 'eduardo.tavares@exemplo.com' }, timestamp: ts(-5, 11) },
  { id: 'h4', tipo: 'concluir_processo', acaoPorUid: DEMO_RECEBEDOR_UID, acaoPorNome: 'Bruno (Recebedor Demo)', alvoUid: null, processoId: 'proc-40', payload: { numero: numeroSei(40) }, timestamp: ts(-1, 15) },
  { id: 'h5', tipo: 'marcar_processo_urgente', acaoPorUid: DEMO_DISTRIBUIDOR_UID, acaoPorNome: 'Marina (Distribuidor Demo)', alvoUid: null, processoId: 'proc-8', payload: {}, timestamp: ts(-1, 16) },
  { id: 'h6', tipo: 'aviso_global_criacao', acaoPorUid: DEMO_DISTRIBUIDOR_UID, acaoPorNome: 'Marina (Distribuidor Demo)', alvoUid: null, processoId: null, payload: { title: 'Bem-vindo ao showcase do SIG-NURGE' }, timestamp: ts(-3, 9) },
];

// ---------------------------------------------------------------------------
// Suporte (inventado)
// ---------------------------------------------------------------------------

export const seedTickets: SuporteTicket[] = [
  {
    id: 'tk-1', tipo: 'suporte', titulo: 'Dúvida sobre prazo de um processo',
    descricao: 'Exemplo fictício de chamado de suporte aberto por um recebedor.',
    anexos: [], status: 'em_analise', criadoPorUid: DEMO_RECEBEDOR_UID,
    criadoPorNome: 'Bruno (Recebedor Demo)', criadoPorEmail: DEMO_RECEBEDOR_EMAIL,
    comentariosCount: 2, ultimaAtividadeEm: ts(-1, 14), ultimaAcaoPorUid: DEMO_DISTRIBUIDOR_UID,
    criadoEm: ts(-2, 10), atualizadoEm: ts(-1, 14),
  },
  {
    id: 'tk-2', tipo: 'sugestao', titulo: 'Sugestão: filtro por comarca',
    descricao: 'Seria útil filtrar a lista de processos por comarca (exemplo fictício).',
    anexos: [], status: 'implementando', criadoPorUid: 'rec-ana',
    criadoPorNome: 'Ana Beatriz Nunes', criadoPorEmail: 'ana.nunes@exemplo.com',
    comentariosCount: 1, ultimaAtividadeEm: ts(-3, 9), ultimaAcaoPorUid: DEMO_DISTRIBUIDOR_UID,
    criadoEm: ts(-6, 9), atualizadoEm: ts(-3, 9),
  },
  {
    id: 'tk-3', tipo: 'suporte', titulo: 'Erro ao concluir (exemplo)',
    descricao: 'Chamado fictício já concluído para demonstrar o status.',
    anexos: [], status: 'concluido', criadoPorUid: 'rec-carlos',
    criadoPorNome: 'Carlos Eduardo Ramos', criadoPorEmail: 'carlos.ramos@exemplo.com',
    comentariosCount: 0, ultimaAtividadeEm: ts(-8, 9), ultimaAcaoPorUid: DEMO_DISTRIBUIDOR_UID,
    criadoEm: ts(-10, 9), atualizadoEm: ts(-8, 9),
  },
];

/** Comentários por ticket (campo `ticketId` usado para filtrar no mock db). */
export const seedComentarios: (SuporteComentario & { ticketId: string })[] = [
  { id: 'c1', ticketId: 'tk-1', texto: 'Poderia detalhar qual processo?', anexos: [], autorUid: DEMO_DISTRIBUIDOR_UID, autorNome: 'Marina (Distribuidor Demo)', autorRole: 'distribuidor', criadoEm: ts(-2, 11) },
  { id: 'c2', ticketId: 'tk-1', texto: 'Claro, é um exemplo fictício da Comarca Central.', anexos: [], autorUid: DEMO_RECEBEDOR_UID, autorNome: 'Bruno (Recebedor Demo)', autorRole: 'recebedor', criadoEm: ts(-1, 14) },
  { id: 'c3', ticketId: 'tk-2', texto: 'Boa ideia, vamos avaliar.', anexos: [], autorUid: DEMO_DISTRIBUIDOR_UID, autorNome: 'Marina (Distribuidor Demo)', autorRole: 'distribuidor', criadoEm: ts(-3, 9) },
];

/** Notificações por usuário (campo `uid` alvo usado para filtrar no mock db). */
export const seedNotificacoes: (SuporteNotificacao & { uid: string })[] = [
  { id: 'n1', uid: DEMO_DISTRIBUIDOR_UID, ticketId: 'tk-1', ticketTitulo: 'Dúvida sobre prazo de um processo', tipo: 'novo_comentario', texto: 'Bruno comentou no chamado', porNome: 'Bruno (Recebedor Demo)', lida: false, criadoEm: ts(-1, 14) },
  { id: 'n2', uid: DEMO_DISTRIBUIDOR_UID, ticketId: 'tk-2', ticketTitulo: 'Sugestão: filtro por comarca', tipo: 'novo_chamado', texto: 'Nova sugestão registrada', porNome: 'Ana Beatriz Nunes', lida: true, criadoEm: ts(-6, 9) },
  { id: 'n3', uid: DEMO_RECEBEDOR_UID, ticketId: 'tk-1', ticketTitulo: 'Dúvida sobre prazo de um processo', tipo: 'mudanca_status', texto: 'Seu chamado está em análise', porNome: 'Marina (Distribuidor Demo)', status: 'em_analise', lida: false, criadoEm: ts(-2, 11) },
];

// ---------------------------------------------------------------------------
// Config do sistema (inventada)
// ---------------------------------------------------------------------------

export const seedConfigSistema: ConfigSistema = {
  prazoPadraoDiasUteis: 10,
  feriadosNacionais: ['2024-01-01', '2024-04-21', '2024-05-01', '2024-09-07', '2024-11-15', '2024-12-25'],
  coordenacaoNotificacaoDistribuidorUids: [DEMO_DISTRIBUIDOR_UID],
  ultimaAtualizacaoUid: DEMO_DISTRIBUIDOR_UID,
  ultimaAtualizacaoEm: NOW,
};

/** Registro de super-admins (só o distribuidor demo). */
export const seedSuperAdminEmails: Record<string, { uid: string; addedAt: Timestamp }> = {
  [DEMO_DISTRIBUIDOR_EMAIL]: { uid: DEMO_DISTRIBUIDOR_UID, addedAt: ts(-60) },
};
