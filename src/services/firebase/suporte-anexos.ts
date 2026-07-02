/**
 * Anexos de SUPORTE — versão de showcase (SEM upload real).
 *
 * O app original enviava o arquivo para o Firebase Storage. Nesta demonstração
 * pública não há rede nem armazenamento: validamos o arquivo (mesma regra do
 * original) e devolvemos um `SuporteAnexo` com URL inócua (`about:blank`),
 * mantendo exatamente o formato esperado pela UI.
 */
import { anexoTipoArquivo, validarAnexo } from '@/lib/suporte';
import { mockId } from '@/mock/db';
import type { SuporteAnexo } from '@/types';

/** Id de pasta temporário para anexos antes de existir o ticket. */
export function novaPastaAnexoId(): string {
  return mockId('anexo');
}

function nomeSeguro(nome: string): string {
  return nome.replace(/[^\w.\-]+/g, '_').slice(-120) || 'arquivo';
}

/**
 * "Faz upload" de um anexo (imagem ou PDF) e retorna o SuporteAnexo.
 * No showcase NÃO há upload: a URL é um placeholder inócuo (`about:blank`).
 * Lança erro se o arquivo for inválido (tipo/tamanho).
 */
export async function uploadSuporteAnexo(
  file: File,
  uid: string,
  pastaId: string
): Promise<SuporteAnexo> {
  const validacao = validarAnexo(file);
  if (!validacao.ok) throw new Error(validacao.erro);

  const tipoArquivo = anexoTipoArquivo(file.type);
  if (tipoArquivo === null) throw new Error('Tipo não suportado.');

  const autoId = mockId('anexo');
  const storagePath = `suporteAnexos/${uid}/${pastaId}/${autoId}-${nomeSeguro(
    file.name
  )}`;

  return {
    nome: file.name,
    tipoArquivo,
    mime: file.type,
    tamanho: file.size,
    storagePath,
    url: 'about:blank',
  };
}
