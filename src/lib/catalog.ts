export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export interface CatalogEntry {
  key: string;
  source: string;
}

export interface PlaceholderCheck {
  missing: string[];
  extra: string[];
}

export { placeholders, checkPlaceholders } from './compositeFormat';

export function flattenCatalog(catalog: JsonObject): CatalogEntry[] {
  const out: CatalogEntry[] = [];

  function visit(value: JsonValue, prefix: string) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, child] of Object.entries(value)) {
        visit(child, prefix ? `${prefix}.${key}` : key);
      }
      return;
    }

    if (typeof value === 'string') out.push({ key: prefix, source: value });
  }

  visit(catalog, '');
  return out;
}

export function flattenValues(catalog: JsonObject | null): Map<string, string> {
  if (!catalog) return new Map();
  return new Map(flattenCatalog(catalog).map((entry) => [entry.key, entry.source]));
}

export function unflattenValues(entries: Array<{ key: string; value: string }>): JsonObject {
  const root: JsonObject = {};

  for (const entry of entries) {
    const parts = entry.key.split('.');
    let cursor = root;
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      if (i === parts.length - 1) {
        cursor[part] = entry.value;
      } else {
        const next = cursor[part];
        if (!next || typeof next !== 'object' || Array.isArray(next)) {
          cursor[part] = {};
        }
        cursor = cursor[part] as JsonObject;
      }
    }
  }

  return root;
}

export function isLanguageCode(value: string): boolean {
  return /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value);
}

export function displayNameForLanguage(code: string): string {
  try {
    return new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}
