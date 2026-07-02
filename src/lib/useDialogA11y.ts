import { useEffect, useRef, type RefObject } from 'react';
import { FOCUSABLE_SELECTOR, nextFocusIndex } from '@/lib/focus-trap';

interface DialogA11yOptions {
  /**
   * Quando `false`, o hook não faz nada (sem trava de scroll, sem trap, sem
   * captura de foco). Componentes que ficam montados com o diálogo fechado
   * (ex.: Modal usa `if (!open) return null` depois dos hooks) devem passar o
   * estado de abertura aqui para não prender foco enquanto fechado.
   */
  enabled: boolean;
  /** Container do diálogo onde o foco fica preso. */
  containerRef: RefObject<HTMLElement>;
  /**
   * Handler opcional de Escape. Componentes que já tratam Esc por conta
   * própria (Modal/ConfirmDialog, com gating de `busy`) devem omitir.
   */
  onEscape?: () => void;
}

// Contador por referência para a trava de scroll: diálogos aninhados não devem
// destravar o fundo enquanto algum ainda estiver aberto.
let scrollLockCount = 0;
let previousBodyOverflow = '';

function lockBodyScroll() {
  if (typeof document === 'undefined') return;
  if (scrollLockCount === 0) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLockCount += 1;
}

function unlockBodyScroll() {
  if (typeof document === 'undefined') return;
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0) {
    document.body.style.overflow = previousBodyOverflow;
  }
}

/**
 * Acessibilidade compartilhada de diálogos modais:
 * - trava o scroll do body enquanto aberto (com contagem por referência);
 * - captura o elemento previamente focado e restaura o foco ao fechar;
 * - move o foco inicial para o primeiro focável (preservando autoFocus já
 *   aplicado dentro do container);
 * - prende o Tab/Shift+Tab dentro do container (focus trap);
 * - opcionalmente fecha no Esc (para diálogos que não tratam Esc sozinhos).
 *
 * Não altera APIs públicas: é consumido internamente pelos componentes.
 */
export function useDialogA11y({
  enabled,
  containerRef,
  onEscape,
}: DialogA11yOptions) {
  // Captura do elemento previamente focado AINDA NA FASE DE RENDER — antes do
  // commitMount do React aplicar um autoFocus (ex.: o botão de confirmação do
  // ConfirmDialog) e mover o foco para dentro do diálogo. Em useEffect/
  // useLayoutEffect já seria tarde demais e restauraríamos o foco para o
  // próprio botão do diálogo. O guard `=== null` evita sobrescrever em
  // re-renders enquanto aberto; a limpeza zera para a próxima abertura.
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  if (
    enabled &&
    previouslyFocusedRef.current === null &&
    typeof document !== 'undefined'
  ) {
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
  }

  // Trava de scroll do body enquanto o diálogo estiver aberto.
  useEffect(() => {
    if (!enabled) return;
    lockBodyScroll();
    return () => unlockBodyScroll();
  }, [enabled]);

  // Foco inicial; restauração do foco anterior na limpeza.
  useEffect(() => {
    if (!enabled) return;

    const container = containerRef.current;
    // Só move o foco se ele ainda não estiver dentro do container — assim
    // preservamos um autoFocus já aplicado (ex.: ConfirmDialog).
    if (container && !container.contains(document.activeElement)) {
      const first = container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      if (first) {
        first.focus();
      } else {
        container.focus();
      }
    }

    return () => {
      previouslyFocusedRef.current?.focus?.();
      previouslyFocusedRef.current = null;
    };
    // containerRef é estável; só reagimos a enabled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // Focus trap + Esc opcional.
  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && onEscape) {
        onEscape();
        return;
      }
      if (e.key !== 'Tab') return;
      const container = containerRef.current;
      if (!container) return;
      const focusables = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (focusables.length === 0) {
        // Sem focáveis: mantém o foco no container.
        e.preventDefault();
        container.focus();
        return;
      }
      const currentIndex = focusables.indexOf(
        document.activeElement as HTMLElement
      );
      const target = nextFocusIndex(focusables.length, currentIndex, e.shiftKey);
      e.preventDefault();
      focusables[target]?.focus();
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, onEscape]);
}
