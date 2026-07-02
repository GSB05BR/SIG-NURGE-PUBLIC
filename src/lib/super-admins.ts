/**
 * Super-admin email helpers backed by the `VITE_SUPER_ADMINS` env var.
 *
 * The env var is a CSV of emails. Comparison is always case-insensitive
 * with whitespace trimmed.
 *
 * Note: Firestore rules cannot read environment variables. The actual
 * authoritative super-admin list in Firestore lives at
 * `/configuracoes/super_admins.emails`. The env var seeds that doc on
 * first super-admin login (see authStore.init).
 */

const RAW = (import.meta.env.VITE_SUPER_ADMINS ?? '') as string;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Returns the lower-cased, trimmed list of super-admin emails from env. */
export function getSuperAdminEmails(): string[] {
  return RAW.split(',')
    .map((e) => normalizeEmail(e))
    .filter((e) => e.length > 0);
}

/** Case-insensitive membership check against `VITE_SUPER_ADMINS`. */
export function isSuperAdminEmail(
  email: string | null | undefined
): boolean {
  if (!email) return false;
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  return getSuperAdminEmails().includes(normalized);
}

/**
 * Convenience alias for `isSuperAdminEmail`. Use when the variable in scope
 * is the email field of a user document and the caller wants the name to
 * make it explicit: "this user (looked up by uid → email) is a super-admin".
 */
export function isSuperAdminUidEmail(
  email: string | null | undefined
): boolean {
  return isSuperAdminEmail(email);
}
