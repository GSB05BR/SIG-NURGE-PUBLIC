import type { UserRole } from '@/types';

interface RoleBadgeProps {
  role: UserRole;
}

const ROLE_LABEL: Record<UserRole, string> = {
  pendente: 'Pendente',
  recebedor: 'Recebedor',
  distribuidor: 'Distribuidor',
};

const ROLE_CLASSES: Record<UserRole, string> = {
  pendente: 'bg-gray-100 text-gray-700 border-gray-200',
  recebedor: 'bg-state-info-bg text-state-info border-state-info-border',
  distribuidor:
    'bg-brand-primary-light text-brand-primary-dark border-brand-primary/30',
};

/** Badge de role com cor: pendente=cinza, recebedor=azul, distribuidor=bordô. */
export default function RoleBadge({ role }: RoleBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${ROLE_CLASSES[role]}`}
    >
      {ROLE_LABEL[role]}
    </span>
  );
}
