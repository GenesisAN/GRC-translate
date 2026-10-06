// Shared by the browser and API. .NET numbered composite formatting only.
export function tokens(value: string): string[] {
  const result: string[] = [];
  for (let i = 0; i < value.length;) {
    if (value.slice(i, i + 2) === '{{' || value.slice(i, i + 2) === '}}') {
      i += 2;
    } else if (value[i] === '{') {
      const end = value.indexOf('}', i + 1);
      const argument = end < 0 ? '' : value.slice(i + 1, end);
      if (!/^[0-9]+(?:,-?[0-9]+)?(?::[^{}]+)?$/.test(argument)) {
        throw new Error(`Invalid composite format at offset ${i}`);
      }
      result.push(argument);
      i = end + 1;
    } else if (value[i] === '}') {
      throw new Error('Unescaped closing brace');
    } else {
      i += 1;
    }
  }
  return result.sort();
}

export function placeholders(value: string): string[] {
  try { return [...new Set(tokens(value))]; }
  catch { return []; }
}

export function checkPlaceholders(source: string, target: string): { missing: string[]; extra: string[] } {
  try {
    const remaining = tokens(target);
    const missing: string[] = [];
    for (const token of tokens(source)) {
      const index = remaining.indexOf(token);
      if (index < 0) missing.push(token);
      else remaining.splice(index, 1);
    }
    return { missing, extra: remaining };
  } catch {
    return { missing: [], extra: ['Invalid braces or composite format'] };
  }
}
