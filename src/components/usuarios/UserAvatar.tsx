import { useState } from 'react';

interface UserAvatarProps {
  displayName: string;
  photoURL: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<UserAvatarProps['size']>, string> = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
};

function computeInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  const initials = `${first}${second}`.toUpperCase();
  return initials || '?';
}

/**
 * Avatar do usuário: foto se disponível, caso contrário iniciais sobre fundo
 * bordô. Faz fallback para iniciais se a foto falhar ao carregar.
 */
export default function UserAvatar({
  displayName,
  photoURL,
  size = 'md',
  className = '',
}: UserAvatarProps) {
  const [errored, setErrored] = useState(false);
  const sizeClass = SIZE_CLASSES[size];
  const initials = computeInitials(displayName);

  if (photoURL && !errored) {
    return (
      <img
        src={photoURL}
        alt={displayName}
        className={`${sizeClass} shrink-0 rounded-full object-cover ${className}`}
        onError={() => setErrored(true)}
      />
    );
  }

  return (
    <div
      className={`${sizeClass} shrink-0 select-none rounded-full bg-brand-primary font-semibold text-white flex items-center justify-center ${className}`}
      aria-label={displayName}
    >
      {initials}
    </div>
  );
}
