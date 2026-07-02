import { useEffect } from 'react';

/**
 * Sets `document.title` to `${title} — NURGE Processos` while the calling
 * component is mounted. Restores the previous title on unmount so navigation
 * away from a page does not leave a stale label in the browser tab.
 */
export function usePageTitle(title: string): void {
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} — NURGE Processos`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
