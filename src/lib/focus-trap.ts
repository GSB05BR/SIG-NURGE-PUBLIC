/**
 * Lógica pura do focus trap, isolada para teste em ambiente Node (sem DOM).
 *
 * Dado o número de elementos focáveis, o índice do elemento atualmente focado
 * e se Shift está pressionado, devolve o índice do próximo elemento que deve
 * receber o foco ao pressionar Tab — ciclando nas bordas (último -> primeiro
 * com Tab; primeiro -> último com Shift+Tab).
 */
export function nextFocusIndex(
  count: number,
  currentIndex: number,
  shiftKey: boolean
): number {
  if (count <= 0) return -1;
  // Quando o foco está fora da lista (currentIndex === -1), Tab vai para o
  // primeiro e Shift+Tab para o último.
  if (currentIndex < 0) {
    return shiftKey ? count - 1 : 0;
  }
  if (shiftKey) {
    return currentIndex === 0 ? count - 1 : currentIndex - 1;
  }
  return currentIndex === count - 1 ? 0 : currentIndex + 1;
}

/** Seletor CSS dos elementos considerados focáveis dentro de um diálogo. */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');
