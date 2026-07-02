import type {
  BeneficioPendenteConclusao,
  ConclusaoAtividade,
  ConclusaoRegimeCondenacao,
  ConclusaoSituacaoPrisao,
  ConclusaoTipoPena,
  DadosConclusaoProcesso,
} from '@/types';

export const EXECUCAO_PENAL_PATTERN =
  /^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/;
export const GUIA_EXECUCAO_PATTERN = EXECUCAO_PENAL_PATTERN;

export const TIPO_PENA_OPTIONS: ReadonlyArray<{
  value: ConclusaoTipoPena;
  label: string;
}> = [
  { value: 'privativa_liberdade', label: 'Privativa de liberdade' },
  {
    value: 'privativa_liberdade_sursis',
    label: 'Privativa de liberdade com SURSIS',
  },
  { value: 'restritiva_direitos', label: 'Restritiva de direitos' },
  { value: 'medida_seguranca', label: 'Medida de segurança' },
];

export const REGIME_CONDENACAO_OPTIONS: ReadonlyArray<{
  value: ConclusaoRegimeCondenacao;
  label: string;
}> = [
  { value: 'fechado', label: 'Fechado' },
  { value: 'semiaberto', label: 'Semiaberto' },
  { value: 'aberto', label: 'Aberto' },
  {
    value: 'indefinido_medida_seguranca',
    label: 'Indefinido/medida de segurança',
  },
];

export const SITUACAO_PRISAO_OPTIONS: ReadonlyArray<{
  value: ConclusaoSituacaoPrisao;
  label: string;
}> = [
  {
    value: 'preso_guia_recolhimento',
    label: 'Preso por guia de recolhimento',
  },
  { value: 'preso_outro_processo', label: 'Preso por outro processo' },
  { value: 'nao_preso', label: 'Não preso' },
];

export const ATIVIDADE_CONCLUSAO_OPTIONS: ReadonlyArray<{
  value: ConclusaoAtividade;
  label: string;
}> = [
  { value: 'cadastro_implantacao', label: 'Cadastro/implantação' },
  { value: 'implantacao', label: 'Implantação' },
];

export const BENEFICIO_PENDENTE_OPTIONS: ReadonlyArray<{
  value: BeneficioPendenteConclusao;
  label: string;
}> = [
  {
    value: 'progressao_semiaberto_vencida',
    label: 'Progressão para Semiaberto vencida',
  },
  {
    value: 'progressao_aberto_vencida',
    label: 'Progressão para Aberto vencida',
  },
  {
    value: 'livramento_condicional_vencido',
    label: 'Livramento Condicional vencido',
  },
  {
    value: 'ppl_regime_aberto_preso',
    label: 'Condenado a PPL em Regime Aberto, Preso por esse processo',
  },
  {
    value: 'prd_sursis_preso',
    label: 'Condenado a PRD ou SURSIS, Preso por esse processo',
  },
  { value: 'termino_pena', label: 'Término de pena' },
  { value: 'indulto', label: 'Indulto' },
  { value: 'comutacao', label: 'Comutação' },
];

export const BENEFICIO_PENDENTE_LABEL: Record<
  BeneficioPendenteConclusao,
  string
> = Object.fromEntries(
  BENEFICIO_PENDENTE_OPTIONS.map((o) => [o.value, o.label])
) as Record<BeneficioPendenteConclusao, string>;

export const TIPO_PENA_LABEL: Record<ConclusaoTipoPena, string> =
  Object.fromEntries(TIPO_PENA_OPTIONS.map((o) => [o.value, o.label])) as Record<
    ConclusaoTipoPena,
    string
  >;

export const REGIME_CONDENACAO_LABEL: Record<
  ConclusaoRegimeCondenacao,
  string
> = Object.fromEntries(
  REGIME_CONDENACAO_OPTIONS.map((o) => [o.value, o.label])
) as Record<ConclusaoRegimeCondenacao, string>;

export const SITUACAO_PRISAO_LABEL: Record<
  ConclusaoSituacaoPrisao,
  string
> = Object.fromEntries(
  SITUACAO_PRISAO_OPTIONS.map((o) => [o.value, o.label])
) as Record<ConclusaoSituacaoPrisao, string>;

export const ATIVIDADE_CONCLUSAO_LABEL: Record<ConclusaoAtividade, string> = {
  cadastro_implantacao: 'Cadastro/implantação',
  implantacao: 'Implantação',
  pendencia: 'Pendência',
};

export function formatBeneficiosPendentes(
  beneficios: BeneficioPendenteConclusao[] | null | undefined
): string {
  if (!beneficios || beneficios.length === 0) return 'Nenhum';
  return beneficios
    .map((beneficio) => BENEFICIO_PENDENTE_LABEL[beneficio])
    .filter(Boolean)
    .join('; ');
}

export function formatDadosConclusao(
  dados: DadosConclusaoProcesso | null | undefined
): Array<{ label: string; value: string }> {
  if (!dados) return [];

  const partial = dados as Partial<DadosConclusaoProcesso>;
  const guia = partial.guiaExecucaoNumero ?? '';
  const execucao = partial.execucaoPenalNumero ?? guia;

  return [
    { label: 'Nº da guia', value: guia || '—' },
    { label: 'Sentenciado', value: partial.sentenciadoNome || '—' },
    {
      label: 'Tipo de pena',
      value: partial.tipoPena ? TIPO_PENA_LABEL[partial.tipoPena] : '—',
    },
    {
      label: 'Regime da condenação',
      value: partial.regimeCondenacao
        ? REGIME_CONDENACAO_LABEL[partial.regimeCondenacao]
        : '—',
    },
    {
      label: 'Situação de prisão',
      value: partial.situacaoPrisao
        ? SITUACAO_PRISAO_LABEL[partial.situacaoPrisao]
        : '—',
    },
    {
      label: 'Atividade',
      value: partial.atividade ? ATIVIDADE_CONCLUSAO_LABEL[partial.atividade] : '—',
    },
    { label: 'Nº da execução penal', value: execucao || '—' },
    { label: 'Comarca', value: partial.comarca || '—' },
    {
      label: 'Benefícios pendentes',
      value: formatBeneficiosPendentes(partial.beneficiosPendentes),
    },
  ];
}
