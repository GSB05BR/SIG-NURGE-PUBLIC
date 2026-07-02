import { FileText, X } from 'lucide-react';
import type { SuporteAnexo } from '@/types';

interface AnexoListProps {
  anexos: SuporteAnexo[];
  onRemove?: (index: number) => void;
}

/** Mostra anexos (imagem como thumbnail, PDF como chip). Read-only por padrão;
 *  com `onRemove` exibe o botão de remover (usado durante a edição). */
export default function AnexoList({ anexos, onRemove }: AnexoListProps) {
  if (anexos.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-2">
      {anexos.map((anexo, idx) => (
        <li key={`${anexo.storagePath}-${idx}`} className="relative">
          {anexo.tipoArquivo === 'image' ? (
            <a
              href={anexo.url}
              target="_blank"
              rel="noreferrer"
              title={anexo.nome}
              className="block h-20 w-20 overflow-hidden rounded-md border border-gray-200 bg-gray-50"
            >
              <img
                src={anexo.url}
                alt={anexo.nome}
                className="h-full w-full object-cover"
              />
            </a>
          ) : (
            <a
              href={anexo.url}
              target="_blank"
              rel="noreferrer"
              title={anexo.nome}
              className="inline-flex h-20 max-w-[12rem] items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 text-sm font-medium text-ink-primary hover:bg-gray-100"
            >
              <FileText className="h-5 w-5 shrink-0 text-state-danger" />
              <span className="truncate">{anexo.nome}</span>
            </a>
          )}
          {onRemove && (
            <button
              type="button"
              aria-label={`Remover ${anexo.nome}`}
              onClick={() => onRemove(idx)}
              className="absolute -right-1.5 -top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-state-danger text-white shadow hover:bg-rose-700"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
