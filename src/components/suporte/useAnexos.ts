import { useCallback, useState, type ClipboardEvent } from 'react';
import {
  novaPastaAnexoId,
  uploadSuporteAnexo,
} from '@/services/firebase/suporte-anexos';
import { validarAnexo } from '@/lib/suporte';
import type { SuporteAnexo } from '@/types';

/**
 * Estado de anexos para um formulário/compositor: faz upload imediato no
 * Storage e mantém a lista de SuporteAnexo já enviados.
 */
export function useAnexos(uid: string) {
  const [pastaId] = useState(() => novaPastaAnexoId());
  const [anexos, setAnexos] = useState<SuporteAnexo[]>([]);
  const [uploading, setUploading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const adicionarArquivos = useCallback(
    async (files: File[]) => {
      if (files.length === 0 || !uid) return;
      setErro(null);
      setUploading(true);
      try {
        for (const file of files) {
          const v = validarAnexo(file);
          if (!v.ok) {
            setErro(v.erro);
            continue;
          }
          const anexo = await uploadSuporteAnexo(file, uid, pastaId);
          setAnexos((prev) => [...prev, anexo]);
        }
      } catch (e) {
        setErro(e instanceof Error ? e.message : 'Falha ao enviar anexo.');
      } finally {
        setUploading(false);
      }
    },
    [uid, pastaId]
  );

  const remover = useCallback((idx: number) => {
    setAnexos((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const reset = useCallback(() => {
    setAnexos([]);
    setErro(null);
  }, []);

  return { anexos, uploading, erro, adicionarArquivos, remover, reset };
}

/** Extrai arquivos de imagem de um evento de colar (paste). */
export function arquivosDeImagemDoClipboard(e: ClipboardEvent): File[] {
  const items = e.clipboardData?.items;
  if (!items) return [];
  const files: File[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    if (it.kind === 'file' && it.type.startsWith('image/')) {
      const f = it.getAsFile();
      if (f) files.push(f);
    }
  }
  return files;
}
