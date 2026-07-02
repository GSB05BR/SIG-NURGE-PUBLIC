interface StatusBadgeProps {
  approved: boolean;
  ativo: boolean;
}

/**
 * Badge de status do usuário. Mostra duas pílulas: aprovação e atividade.
 * - Aprovado/Pendente
 * - Ativo/Inativo
 */
export default function StatusBadge({ approved, ativo }: StatusBadgeProps) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
          approved
            ? 'bg-state-success-bg text-state-success'
            : 'bg-state-warning-bg text-state-warning'
        }`}
      >
        {approved ? 'Aprovado' : 'Pendente'}
      </span>
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
          ativo
            ? 'bg-state-success-bg text-state-success'
            : 'bg-state-danger-bg text-state-danger'
        }`}
      >
        {ativo ? 'Ativo' : 'Inativo'}
      </span>
    </div>
  );
}
