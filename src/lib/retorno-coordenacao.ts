// Lógica PURA de detecção de processos que VOLTARAM da coordenação para o
// recebedor.
//
// Contexto (melhoria #14): o distribuidor já é avisado quando um processo
// CHEGA na coordenação (ver AppLayout: diff por Set de IDs + guarda de
// inicialização). Falta o espelho do lado do recebedor: avisar quando um
// processo VOLTA da coordenação (status sai de `em_coordenacao`/`em_espera`
// e retorna para `pendente`/`em_andamento`).
//
// Diferente do distribuidor, aqui o processo NÃO entra nem sai da lista de
// abertos do recebedor (`subscribeProcessosAbertosByRecebedor` cobre os quatro
// status abertos), só MUDA de status dentro dela. Por isso a detecção é por
// diff de STATUS por id (não por presença/ausência de id).
//
// Esta função isola APENAS a decisão para ser testável sem React nem Firebase.
// O Dashboard do recebedor a consome com um ref que guarda o snapshot anterior
// de status, honrando a mesma guarda de inicialização do distribuidor (não
// alertar no primeiro snapshot).

import type { Processo, ProcessoStatus } from '@/types';

/** Status em que o processo está "na coordenação" (fora das mãos do recebedor). */
function isStatusCoordenacao(status: ProcessoStatus): boolean {
  return status === 'em_coordenacao' || status === 'em_espera';
}

/**
 * Constrói o mapa `id -> status` de um snapshot da lista de abertos. Usado para
 * registrar o estado anterior entre snapshots do listener.
 */
export function snapshotStatusPorId(
  processos: readonly Processo[]
): Map<string, ProcessoStatus> {
  const map = new Map<string, ProcessoStatus>();
  for (const p of processos) map.set(p.id, p.status);
  return map;
}

/**
 * Dado o snapshot anterior de status (por id) e a lista atual de abertos do
 * recebedor, devolve os processos que VOLTARAM da coordenação — ou seja, cujo
 * status anterior era de coordenação (`em_coordenacao`/`em_espera`) e o atual
 * já NÃO é.
 *
 * Casos que NÃO disparam (por construção):
 * - Processo novo na lista (sem status anterior) — chegada, não retorno.
 * - `pendente -> em_andamento` (recebedor clicou Iniciar).
 * - `em_andamento -> em_coordenacao` (envio PARA a coordenação).
 * - Processo que saiu da lista (concluído) — só iteramos a lista atual.
 *
 * A query do listener já filtra por `recebedorUid`, então todo processo aqui é
 * do recebedor logado — não há checagem extra de dono.
 *
 * @param previous Snapshot anterior de status por id, ou `null` no primeiro
 *   snapshot (guarda de inicialização: nunca dispara).
 * @param atuais Lista atual de processos abertos do recebedor.
 */
export function detectarRetornosDaCoordenacao(
  previous: ReadonlyMap<string, ProcessoStatus> | null,
  atuais: readonly Processo[]
): Processo[] {
  if (previous === null) return [];
  const retornos: Processo[] = [];
  for (const p of atuais) {
    const anterior = previous.get(p.id);
    if (
      anterior !== undefined &&
      isStatusCoordenacao(anterior) &&
      !isStatusCoordenacao(p.status)
    ) {
      retornos.push(p);
    }
  }
  return retornos;
}

/**
 * Monta a mensagem (PT-BR) do aviso de retorno da coordenação, agregando vários
 * processos em uma única frase (sem fila de modais).
 */
export function mensagemRetornoCoordenacao(retornos: readonly Processo[]): string {
  if (retornos.length === 1) {
    return `O processo ${retornos[0].numero} voltou da coordenação e está com você novamente.`;
  }
  return `${retornos.length} processos voltaram da coordenação e estão com você novamente.`;
}
