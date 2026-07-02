import { useEffect, useState } from 'react';
import { getHistoricoSeiProcesso } from '@/services/firebase/processos';
import type { EventoNurge, Processo } from '@/types';

/**
 * Lê o histórico SEI de um processo para telas de DETALHE (item 7).
 *
 * A partir do item 7 o histórico vive no subdoc `processos/{id}/detalhes/historico`
 * e não no doc principal. Este hook prefere o histórico inline (docs legados) e,
 * quando ausente, busca o subdoc — apenas quando `enabled` é true, para que
 * listas/cards só paguem a leitura se o usuário realmente abrir os detalhes.
 *
 * @param enabled permite adiar a busca (ex.: só quando um <details> é expandido).
 */
export function useHistoricoSei(
  processo: Pick<Processo, 'id' | 'historicoSei'>,
  enabled = true
): { eventos: EventoNurge[]; loading: boolean } {
  const inline =
    processo.historicoSei && processo.historicoSei.length > 0
      ? processo.historicoSei
      : null;
  const [eventos, setEventos] = useState<EventoNurge[] | null>(inline);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || inline) return;
    let cancelled = false;
    setLoading(true);
    getHistoricoSeiProcesso(processo.id, processo.historicoSei)
      .then((list) => {
        if (!cancelled) setEventos(list);
      })
      .catch(() => {
        if (!cancelled) setEventos([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [processo.id, enabled, inline]);

  return { eventos: eventos ?? [], loading };
}
