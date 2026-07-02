export interface ProcessoParaFila {
  id: string;
  regime: 'aberto' | 'fechado';
  recebedorVinculadoUid?: string | null;
}

export interface FilaBucketRoteamento {
  uid: string;
  totalRestante: number;
  fechadoRestante: number;
  abertoRestante: number;
  fechado: number;
  aberto: number;
  porVinculo: number;
  processoIds: string[];
}

type Regime = 'aberto' | 'fechado';

function regimeRestante(b: FilaBucketRoteamento, regime: Regime): number {
  return regime === 'fechado' ? b.fechadoRestante : b.abertoRestante;
}

function temCota(b: FilaBucketRoteamento, regime: Regime): boolean {
  return b.totalRestante > 0 && regimeRestante(b, regime) > 0;
}

function atribui(
  b: FilaBucketRoteamento,
  processoId: string,
  regime: Regime,
  porVinculo: boolean
): void {
  b.processoIds.push(processoId);
  b.totalRestante -= 1;
  if (regime === 'fechado') {
    b.fechado += 1;
    b.fechadoRestante -= 1;
  } else {
    b.aberto += 1;
    b.abertoRestante -= 1;
  }
  if (porVinculo) b.porVinculo += 1;
}

function distribuirRegime(
  processos: ProcessoParaFila[],
  regime: Regime,
  buckets: FilaBucketRoteamento[]
): void {
  let rr = 0;
  for (const processo of processos) {
    // 1) Vínculo tem prioridade quando o dono está selecionado e tem cota.
    const dono = processo.recebedorVinculadoUid
      ? buckets.find((b) => b.uid === processo.recebedorVinculadoUid)
      : undefined;
    if (dono && temCota(dono, regime)) {
      atribui(dono, processo.id, regime, true);
      continue;
    }
    // 2) Round-robin a partir de rr, pulando buckets cheios.
    let atribuiu = false;
    for (let k = 0; k < buckets.length; k += 1) {
      const idx = (rr + k) % buckets.length;
      const b = buckets[idx];
      if (temCota(b, regime)) {
        atribui(b, processo.id, regime, false);
        rr = (idx + 1) % buckets.length;
        atribuiu = true;
        break;
      }
    }
    if (!atribuiu) break; // todas as cotas cheias → resto espera na fila
  }
}

/**
 * Distribui a fila (já ordenada por antiguidade) nos buckets, mutando-os.
 * Honra o vínculo (processo → dono) mudando só o destino: preserva o conjunto
 * distribuído e a quantidade por pessoa. Sem vínculos, é igual ao round-robin
 * por regime usado hoje.
 */
export function distribuirFilaComVinculo(
  processos: ProcessoParaFila[],
  buckets: FilaBucketRoteamento[]
): void {
  const regimes: Regime[] = ['fechado', 'aberto'];
  for (const regime of regimes) {
    distribuirRegime(
      processos.filter((p) => p.regime === regime),
      regime,
      buckets
    );
  }
}
