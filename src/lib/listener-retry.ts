// Lógica PURA de re-assinatura de listeners reference-counted após uma falha.
//
// Contexto (docs/otimizacao-leituras-firestore.md, item 3): o `onSnapshot` do
// Firestore é TERMINAL — depois de um erro o listener morre e NÃO se refaz
// sozinho. No store compartilhado (reference-counted) isso cria um listener
// "pegajoso": o bookkeeping ainda guarda um `unsub` (que aponta para um
// listener morto) com `refs > 0`, então navegar para fora e voltar NÃO
// re-assina. A correção é zerar o `unsub` no callback de erro e, no retry,
// só re-assinar quando houver consumidores E a assinatura estiver de fato
// morta.
//
// Esta função isola APENAS essa decisão para que seja testável sem React nem
// Firebase. O store a consome em `retryAbertos`/`retrySemana`.

/**
 * Decide se um listener reference-counted deve ser re-assinado.
 *
 * @param refs   Número de consumidores ativos da query.
 * @param hasLiveUnsub `true` se já existe uma assinatura viva (unsub != null).
 * @returns `true` somente quando há consumidores (refs > 0) e nenhuma
 *          assinatura viva — ou seja, o caso de um listener morto por erro
 *          que ainda tem quem o observe.
 */
export function shouldResubscribeListener(
  refs: number,
  hasLiveUnsub: boolean
): boolean {
  return refs > 0 && !hasLiveUnsub;
}
