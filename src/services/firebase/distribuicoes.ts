/**
 * Distribuições — versão do showcase (banco em memória).
 *
 * Reescrito para ler/escrever o `MockCollection` em `src/mock/db.ts`, mantendo
 * exatamente as mesmas assinaturas públicas do serviço original de Firestore.
 * Sem rede, sem credenciais e sem persistência: tudo vive na aba do navegador.
 *
 * No app original o fluxo de distribuição por CSV está desativado (as funções
 * lançavam erro). Aqui, para demonstrar a interface, elas operam sobre dados
 * fictícios e NUNCA lançam.
 */
import { Timestamp, type Unsubscribe } from 'firebase/firestore';
import { db, mockId } from '@/mock/db';
import type {
  Distribuicao,
  DistribuicaoConfiguracaoDiaria,
  DistribuicaoConfiguracaoPorRecebedor,
  DistribuicaoResumo,
  Processo,
  ProcessoRegime,
} from '@/types';

export interface CreateDistribuicaoRascunhoInput {
  semanaIso: string;
  dataBaseIso: string;
  dataFinalIso: string;
  regime: ProcessoRegime;
  fileName: string;
  totalProcessos: number;
  configuracaoDiaria: DistribuicaoConfiguracaoDiaria;
  configuracaoPorRecebedor: DistribuicaoConfiguracaoPorRecebedor;
  resumo: DistribuicaoResumo;
  excedeuQuota: boolean;
  criadoPorUid: string;
}

/** Ordena distribuições por `criadoEm` desc (como o `orderBy` do original). */
function porCriadoEmDesc(a: Distribuicao, b: Distribuicao): number {
  return (b.criadoEm?.toMillis() ?? 0) - (a.criadoEm?.toMillis() ?? 0);
}

/**
 * Cria uma distribuição em rascunho e retorna o id do novo documento.
 */
export async function createDistribuicaoRascunho(
  input: CreateDistribuicaoRascunhoInput
): Promise<string> {
  const id = mockId('dist');
  const distribuicao: Distribuicao = {
    id,
    semanaIso: input.semanaIso,
    dataBaseIso: input.dataBaseIso,
    dataFinalIso: input.dataFinalIso,
    regime: input.regime,
    fileName: input.fileName,
    totalProcessos: input.totalProcessos,
    configuracaoDiaria: input.configuracaoDiaria,
    configuracaoPorRecebedor: input.configuracaoPorRecebedor,
    status: 'rascunho',
    excedeuQuota: input.excedeuQuota,
    resumo: input.resumo,
    criadoPorUid: input.criadoPorUid,
    criadoEm: Timestamp.now(),
    confirmadoEm: null,
  };
  db.distribuicoes.insert(distribuicao);
  return id;
}

/**
 * Confirma uma distribuição: marca o documento como `confirmada`. No showcase
 * não gravamos os processos preparados nem histórico — apenas atualizamos o
 * status para exibir o fluxo.
 */
export async function confirmarDistribuicao(
  distribuicaoId: string,
  processosPreparados: Omit<Processo, 'id' | 'createdAt' | 'updatedAt'>[],
  byUid: string,
  byNome: string
): Promise<void> {
  void processosPreparados;
  void byUid;
  void byNome;
  db.distribuicoes.update(distribuicaoId, {
    status: 'confirmada',
    confirmadoEm: Timestamp.now(),
  });
}

/**
 * Apaga a última distribuição (best-effort). Remove a mais recente e a devolve;
 * se não houver nenhuma, devolve um placeholder fictício. NUNCA lança.
 */
export async function apagarUltimaDistribuicaoComProcessos(
  byUid: string,
  byNome: string
): Promise<{ distribuicao: Distribuicao; totalProcessos: number }> {
  void byNome;
  const [maisRecente] = [...db.distribuicoes.all()].sort(porCriadoEmDesc);
  if (maisRecente) {
    db.distribuicoes.remove(maisRecente.id);
    return {
      distribuicao: maisRecente,
      totalProcessos: maisRecente.totalProcessos,
    };
  }

  const placeholder: Distribuicao = {
    id: mockId('dist'),
    semanaIso: '',
    fileName: 'sem-distribuicao.json',
    totalProcessos: 0,
    configuracaoDiaria: { segunda: 0, terca: 0, quarta: 0, quinta: 0, sexta: 0 },
    status: 'descartada',
    excedeuQuota: false,
    resumo: {
      porDia: {},
      porAgrupador: {},
      porRecebedor: {},
      urgentes: 0,
      prioridades: 0,
      naoAtribuidos: 0,
    },
    criadoPorUid: byUid,
    criadoEm: Timestamp.now(),
    confirmadoEm: null,
  };
  return { distribuicao: placeholder, totalProcessos: 0 };
}

/** Assina todas as distribuições ordenadas por `criadoEm` desc. */
export function subscribeDistribuicoes(
  callback: (list: Distribuicao[]) => void
): Unsubscribe {
  return db.distribuicoes.subscribe((list) => {
    callback([...list].sort(porCriadoEmDesc));
  });
}
