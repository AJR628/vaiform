function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function normalizeKey(key) {
  return String(key || '').toLowerCase();
}

function isSensitiveKey(key) {
  return /(authorization|cookie|set-cookie|token|api[-_]?key|secret|password|signature|credential)/i.test(
    key
  );
}

function isBlobKey(key) {
  return /(body|payload|prompt|input|text|content|caption|quote|sourcecontent|raw)/i.test(key);
}

function isUrlLike(value) {
  if (typeof value !== 'string') return false;
  return /^https?:\/\//i.test(value.trim());
}

function redactUrl(value) {
  try {
    const parsed = new URL(value);
    return `[redacted:url host=${parsed.host}]`;
  } catch {
    return '[redacted:url]';
  }
}

function redactString(value, key) {
  if (typeof value !== 'string') return value;

  const normalizedKey = normalizeKey(key);
  const trimmed = value.trim();
  if (trimmed.length === 0) return value;

  if (isSensitiveKey(normalizedKey)) {
    return `[redacted:${normalizedKey || 'secret'}]`;
  }

  if (/^bearer\s+/i.test(trimmed)) {
    return '[redacted:authorization]';
  }

  if (isUrlLike(trimmed)) {
    return redactUrl(trimmed);
  }

  if (isBlobKey(normalizedKey) && (trimmed.length > 80 || trimmed.includes('\n'))) {
    return `[redacted:text len=${trimmed.length}]`;
  }

  return value;
}

export function redactForLogs(value, key = '', seen = new WeakSet()) {
  if (value == null) return value;

  if (typeof value === 'string') {
    return redactString(value, key);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      code: value.code ?? null,
      status: value.status ?? null,
      message: redactString(value.message || String(value), 'message'),
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactForLogs(item, key, seen));
  }

  if (!isPlainObject(value)) {
    return String(value);
  }

  if (seen.has(value)) {
    return '[circular]';
  }
  seen.add(value);

  const out = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    const normalizedKey = normalizeKey(entryKey);
    if (entryValue == null) {
      out[entryKey] = entryValue;
      continue;
    }
    if (isSensitiveKey(normalizedKey)) {
      out[entryKey] = `[redacted:${normalizedKey}]`;
      continue;
    }
    out[entryKey] = redactForLogs(entryValue, normalizedKey, seen);
  }
  return out;
}

export default redactForLogs;
