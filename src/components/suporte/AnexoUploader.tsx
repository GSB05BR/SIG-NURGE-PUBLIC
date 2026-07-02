import { useRef } from 'react';
import { Loader2, Paperclip } from 'lucide-react';
import AnexoList from './AnexoList';
import { ANEXO_MIMES_ACEITOS } from '@/lib/suporte';
import type { SuporteAnexo } from '@/types';

interface AnexoUploaderProps {
  anexos: SuporteAnexo[];
  uploading: boolean;
  erro: string | null;
  onPick: (files: File[]) => void;
  onRemove: (index: number) => void;
  disabled?: boolean;
}

/** Botão de anexar + previews. O paste de prints é tratado no textarea pai. */
export default function AnexoUploader({
  anexos,
  uploading,
  erro,
  onPick,
  onRemove,
  disabled = false,
}: AnexoUploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled || uploading}
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-surface px-3 py-2 text-xs font-semibold text-ink-primary hover:bg-gray-50 disabled:opacity-50"
        >
          {uploading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Paperclip className="h-3.5 w-3.5" />
          )}
          Anexar imagem/PDF
        </button>
        <span className="text-[11px] text-ink-secondary">
          ou cole um print (Ctrl+V) no campo de texto
        </span>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ANEXO_MIMES_ACEITOS.join(',')}
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) onPick(files);
            e.target.value = '';
          }}
        />
      </div>

      {erro && <p className="mt-1 text-xs text-state-danger">{erro}</p>}

      <AnexoList anexos={anexos} onRemove={disabled ? undefined : onRemove} />
    </div>
  );
}
