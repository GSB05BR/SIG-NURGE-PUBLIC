/**
 * Normalizes a string into a Firestore-safe ID:
 * - lowercase
 * - removes diacritics (accents)
 * - replaces whitespace runs with "-"
 * - keeps only [a-z0-9-]
 * - collapses multiple "-" and trims edges
 */
export function slugify(input: string): string {
  if (!input) return '';
  const normalized = input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

  const replaced = normalized
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  return replaced;
}
