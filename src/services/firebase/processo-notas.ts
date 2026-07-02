/**
 * Anotações pessoais do usuário sobre um processo, servidas pelo banco EM
 * MEMÓRIA do showcase (`src/mock/db.ts`).
 *
 * Sem Firestore: as notas vivem em `db.processoNotas`, privadas por `autorUid`
 * (uma nota por par autor+processo). As assinaturas públicas são idênticas às do
 * app original — `subscribeProcessoNotas` devolve um mapa `processoId -> texto`,
 * e salvar com texto vazio apaga a nota.
 */
import { Timestamp, type Unsubscribe } from 'firebase/firestore';
import { db, mockId, type ProcessoNotaDoc } from '@/mock/db';

/** Nota atual do usuário para um processo (uma por par autor+processo). */
function notaAtual(uid: string, processoId: string): ProcessoNotaDoc | undefined {
  return db.processoNotas.find(
    (n) => n.autorUid === uid && n.processoId === processoId
  )[0];
}

/** Assina as anotações do usuário e devolve um mapa processoId -> texto. */
export function subscribeProcessoNotas(
  uid: string,
  cb: (map: Record<string, string>) => void
): Unsubscribe {
  return db.processoNotas.subscribe(
    (items) => {
      const map: Record<string, string> = {};
      for (const n of items) {
        if (n.texto) map[n.processoId] = n.texto;
      }
      cb(map);
    },
    (n) => n.autorUid === uid
  );
}

/** Salva (ou apaga, se vazio) a anotação do usuário para um processo. */
export async function salvarProcessoNota(
  uid: string,
  processoId: string,
  texto: string
): Promise<void> {
  const limpo = texto.trim();
  const existente = notaAtual(uid, processoId);
  if (!limpo) {
    if (existente) db.processoNotas.remove(existente.id);
    return;
  }
  const agora = Timestamp.now();
  if (existente) {
    db.processoNotas.update(existente.id, { texto: limpo, atualizadoEm: agora });
    return;
  }
  const nova: ProcessoNotaDoc = {
    id: mockId('nota'),
    processoId,
    texto: limpo,
    autorUid: uid,
    autorNome: db.users.find((u) => u.uid === uid)[0]?.displayName ?? '',
    criadoEm: agora,
    atualizadoEm: agora,
  };
  db.processoNotas.insert(nova);
}

export async function removerProcessoNota(
  uid: string,
  processoId: string
): Promise<void> {
  const existente = notaAtual(uid, processoId);
  if (existente) db.processoNotas.remove(existente.id);
}
