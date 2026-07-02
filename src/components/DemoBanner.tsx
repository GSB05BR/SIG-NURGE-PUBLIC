import { useState } from 'react';
import { Info, X } from 'lucide-react';

/**
 * Faixa fixa de aviso: deixa claro, em qualquer tela, que este é um showcase de
 * interface com dados 100% fictícios. Dispensável (por sessão).
 */
export default function DemoBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[100] border-t border-amber-300 bg-amber-50/95 backdrop-blur supports-[backdrop-filter]:bg-amber-50/80">
      <div className="mx-auto flex max-w-5xl items-start gap-3 px-4 py-2.5 text-amber-900">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p className="flex-1 text-xs leading-relaxed sm:text-sm">
          <strong>Demonstração de interface (SIG-NURGE).</strong> Todos os dados
          — nomes, processos, sentenciados, datas — são fictícios e gerados
          apenas para ilustrar a UI. Projeto independente, sem vínculo com
          qualquer instituição. Nada é enviado a servidores.
        </p>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dispensar aviso"
          className="rounded p-1 text-amber-700 hover:bg-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
