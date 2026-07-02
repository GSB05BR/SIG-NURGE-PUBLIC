import { useEffect, useRef, useState } from 'react';
import { MoreVertical, Power, Settings2, ShieldCheck, UserCog } from 'lucide-react';
import type { User } from '@/types';

export interface UserActionsMenuProps {
  user: User;
  /** Indica se o usuário é super-admin (não pode ter role/ativo alterados). */
  isSuperAdminTarget: boolean;
  /** Indica se este é o próprio distribuidor logado (não pode auto-modificar). */
  isSelf: boolean;
  onEditAgrupadores: (user: User) => void;
  onChangeRole: (user: User, newRole: 'recebedor' | 'distribuidor') => void;
  onToggleAtivo: (user: User) => void;
}

/**
 * Dropdown de ações para uma linha de usuário na tabela.
 *
 * Regras de bloqueio:
 * - Super-admins: não podem ter role alterado nem ser desativados
 * - Self (próprio distribuidor logado): não pode rebaixar nem desativar a si mesmo
 * - Pendentes: não têm ações disponíveis (são tratados na seção "Pendentes")
 */
export default function UserActionsMenu({
  user,
  isSuperAdminTarget,
  isSelf,
  onEditAgrupadores,
  onChangeRole,
  onToggleAtivo,
}: UserActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Fechar ao clicar fora.
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('mousedown', handler);
    window.addEventListener('keydown', onEsc);
    return () => {
      window.removeEventListener('mousedown', handler);
      window.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const isPendente = user.role === 'pendente';
  const isRecebedor = user.role === 'recebedor';
  const isDistribuidor = user.role === 'distribuidor';

  // Para usuários pendentes, não exibimos esse menu — a seção dedicada cuida deles.
  if (isPendente) {
    return (
      <span className="text-xs text-ink-secondary">
        Use a seção "Pendentes"
      </span>
    );
  }

  // Botões de role: alternam recebedor <-> distribuidor.
  const roleSwitchTo: 'recebedor' | 'distribuidor' = isRecebedor
    ? 'distribuidor'
    : 'recebedor';
  const roleSwitchLabel = isRecebedor
    ? 'Mudar para Distribuidor'
    : 'Mudar para Recebedor';

  const roleDisabled = isSuperAdminTarget || isSelf;
  const ativoDisabled = isSuperAdminTarget || isSelf;

  function close() {
    setOpen(false);
  }

  return (
    <div className="relative inline-block text-left" ref={containerRef}>
      <button
        type="button"
        aria-label={`Ações para ${user.displayName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className="rounded p-1.5 text-ink-secondary hover:bg-gray-100 hover:text-ink-primary"
        onClick={() => setOpen((v) => !v)}
      >
        <MoreVertical className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="menu"
          aria-orientation="vertical"
          className="absolute right-0 z-20 mt-1 w-60 origin-top-right rounded-md border border-gray-200 bg-surface shadow-lg focus:outline-none"
        >
          <div className="py-1">
            {isRecebedor && (
              <MenuItem
                icon={<Settings2 className="h-4 w-4" />}
                label="Editar origens"
                onClick={() => {
                  close();
                  onEditAgrupadores(user);
                }}
              />
            )}

            <MenuItem
              icon={
                isRecebedor ? (
                  <ShieldCheck className="h-4 w-4" />
                ) : (
                  <UserCog className="h-4 w-4" />
                )
              }
              label={roleSwitchLabel}
              disabled={roleDisabled}
              disabledTooltip={
                isSuperAdminTarget
                  ? 'Super-admins não podem ter role alterado'
                  : isSelf
                  ? 'Você não pode alterar seu próprio role'
                  : undefined
              }
              onClick={() => {
                close();
                onChangeRole(user, roleSwitchTo);
              }}
            />

            <MenuItem
              icon={<Power className="h-4 w-4" />}
              label={user.ativo ? 'Desativar' : 'Ativar'}
              danger={user.ativo}
              disabled={ativoDisabled}
              disabledTooltip={
                isSuperAdminTarget
                  ? 'Super-admins não podem ser desativados'
                  : isSelf
                  ? 'Você não pode desativar a si mesmo'
                  : undefined
              }
              onClick={() => {
                close();
                onToggleAtivo(user);
              }}
            />

            {/* Distribuidor sem agrupadores específicos: oferece "Editar agrupadores" tb.
                Útil caso queira restringir o distribuidor a um subconjunto. */}
            {isDistribuidor && !isSuperAdminTarget && (
              <MenuItem
                icon={<Settings2 className="h-4 w-4" />}
                label="Editar origens"
                onClick={() => {
                  close();
                  onEditAgrupadores(user);
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface MenuItemProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  disabledTooltip?: string;
  danger?: boolean;
}

function MenuItem({
  icon,
  label,
  onClick,
  disabled = false,
  disabledTooltip,
  danger = false,
}: MenuItemProps) {
  const baseClass = disabled
    ? 'text-ink-secondary cursor-not-allowed'
    : danger
    ? 'text-state-danger hover:bg-rose-50'
    : 'text-ink-primary hover:bg-gray-50';

  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? disabledTooltip : undefined}
      className={`flex w-full items-center gap-2 px-3 py-2 text-sm ${baseClass}`}
    >
      <span className="text-ink-secondary">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
    </button>
  );
}
