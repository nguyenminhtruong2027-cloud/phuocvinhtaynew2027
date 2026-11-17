/**
 * Deduplicate rows by string `id` preserving the latest occurrence's data
 * in original first-seen order (or appending new items cleanly).
 */
export function dedupeById<T extends { id?: string | null }>(rows: T[]): T[] {
  if (!Array.isArray(rows) || rows.length <= 1) return rows || [];
  const seen = new Map<string, number>();
  const result: T[] = [];
  for (const row of rows) {
    const id = row?.id ? String(row.id) : '';
    if (!id) {
      result.push(row);
      continue;
    }
    const existingIdx = seen.get(id);
    if (existingIdx !== undefined) {
      result[existingIdx] = row;
    } else {
      seen.set(id, result.length);
      result.push(row);
    }
  }
  return result;
}
