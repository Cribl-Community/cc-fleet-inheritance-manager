/** Keys Cribl adds to list responses that change without the definition itself changing. */
const VOLATILE_KEYS = new Set(['mtime', 'modified', 'pendingTask', 'loadTime', 'version']);

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalize);
  }

  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;

    return Object.keys(record)
      .filter((key) => !key.startsWith('__') && !VOLATILE_KEYS.has(key))
      .sort()
      .reduce<Record<string, unknown>>((normalized, key) => {
        normalized[key] = normalize(record[key]);
        return normalized;
      }, {});
  }

  return value;
}

/** JSON with sorted keys and Cribl bookkeeping fields removed, so equal definitions produce equal text. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(normalize(value)) ?? 'undefined';
}

/** Short FNV-1a hash (plus length) of a definition, for comparing the same object across fleets. */
export function fingerprintContent(value: unknown): string {
  const text = stableStringify(value);
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `${(hash >>> 0).toString(16).padStart(8, '0')}-${text.length}`;
}
