import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const LOCAL_HOSTNAMES = new Set(['localhost']);
const OUTBOUND_POLICY_CODES = new Set([
  'OUTBOUND_URL_INVALID',
  'OUTBOUND_URL_PROTOCOL',
  'OUTBOUND_URL_AUTH',
  'OUTBOUND_DNS_LOOKUP_FAILED',
  'OUTBOUND_TARGET_NOT_PUBLIC',
  'OUTBOUND_REDIRECT_LIMIT',
  'OUTBOUND_REDIRECT_LOCATION',
]);

function outboundError(code, message, extras = {}) {
  const err = new Error(message);
  err.code = code;
  err.status = extras.status ?? 400;
  if (extras.url) err.url = extras.url;
  if (extras.hostname) err.hostname = extras.hostname;
  if (extras.cause) err.cause = extras.cause;
  return err;
}

function normalizeHostname(hostname) {
  return String(hostname || '')
    .trim()
    .toLowerCase();
}

function isLocalHostname(hostname) {
  return (
    LOCAL_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost') || hostname.endsWith('.local')
  );
}

function isNonPublicIpv4(address) {
  const parts = String(address || '')
    .split('.')
    .map((part) => Number.parseInt(part, 10));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true;
  }

  const [a, b] = parts;

  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;

  return false;
}

function isNonPublicIpv6(address) {
  const normalized = normalizeHostname(address);
  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1] || null;
  if (mappedIpv4) {
    return isNonPublicIpv4(mappedIpv4);
  }

  if (normalized === '::1' || normalized === '::') return true;

  const firstHextetText = normalized.split(':')[0] || '0';
  const firstHextet = Number.parseInt(firstHextetText, 16);
  if (!Number.isFinite(firstHextet)) return true;

  if ((firstHextet & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((firstHextet & 0xffc0) === 0xfe80) return true; // fe80::/10

  return false;
}

function isPublicIpAddress(address, family) {
  if (family === 4) return !isNonPublicIpv4(address);
  if (family === 6) return !isNonPublicIpv6(address);
  return false;
}

async function assertPublicHost(hostname, url) {
  const normalizedHostname = normalizeHostname(hostname);
  if (!normalizedHostname) {
    throw outboundError('OUTBOUND_URL_INVALID', 'Outbound URL host is required', { url });
  }

  if (isLocalHostname(normalizedHostname)) {
    throw outboundError('OUTBOUND_TARGET_NOT_PUBLIC', 'Outbound URL must target a public host', {
      hostname: normalizedHostname,
      url,
    });
  }

  const ipFamily = isIP(normalizedHostname);
  if (ipFamily) {
    if (!isPublicIpAddress(normalizedHostname, ipFamily)) {
      throw outboundError('OUTBOUND_TARGET_NOT_PUBLIC', 'Outbound URL must target a public host', {
        hostname: normalizedHostname,
        url,
      });
    }
    return;
  }

  let records;
  try {
    records = await lookup(normalizedHostname, { all: true, verbatim: true });
  } catch (error) {
    throw outboundError(
      'OUTBOUND_DNS_LOOKUP_FAILED',
      `Unable to resolve outbound host "${normalizedHostname}"`,
      {
        hostname: normalizedHostname,
        url,
        cause: error,
      }
    );
  }

  if (!Array.isArray(records) || records.length === 0) {
    throw outboundError(
      'OUTBOUND_DNS_LOOKUP_FAILED',
      `Unable to resolve outbound host "${normalizedHostname}"`,
      {
        hostname: normalizedHostname,
        url,
      }
    );
  }

  const hasNonPublicAddress = records.some(
    (record) => !isPublicIpAddress(record?.address, record?.family)
  );
  if (hasNonPublicAddress) {
    throw outboundError('OUTBOUND_TARGET_NOT_PUBLIC', 'Outbound URL must target a public host', {
      hostname: normalizedHostname,
      url,
    });
  }
}

export async function assertPublicOutboundUrl(inputUrl) {
  let parsed;
  try {
    parsed = new URL(inputUrl);
  } catch {
    throw outboundError('OUTBOUND_URL_INVALID', 'Invalid outbound URL', { url: inputUrl });
  }

  if (parsed.protocol !== 'https:') {
    throw outboundError('OUTBOUND_URL_PROTOCOL', 'Only public https:// URLs are allowed', {
      url: parsed.toString(),
    });
  }

  if (parsed.username || parsed.password) {
    throw outboundError('OUTBOUND_URL_AUTH', 'Outbound URLs may not include credentials', {
      url: parsed.toString(),
    });
  }

  await assertPublicHost(parsed.hostname, parsed.toString());
  return parsed.toString();
}

export async function fetchWithOutboundPolicy(
  inputUrl,
  { method = 'GET', headers, signal, maxRedirects = 5 } = {}
) {
  let currentUrl = await assertPublicOutboundUrl(inputUrl);
  let currentMethod = method;
  let redirectCount = 0;

  while (true) {
    const response = await fetch(currentUrl, {
      method: currentMethod,
      headers,
      redirect: 'manual',
      ...(signal ? { signal } : {}),
    });

    if (!REDIRECT_STATUSES.has(response.status)) {
      return {
        response,
        finalUrl: currentUrl,
        redirectCount,
      };
    }

    if (redirectCount >= maxRedirects) {
      throw outboundError('OUTBOUND_REDIRECT_LIMIT', `Too many redirects (>${maxRedirects})`, {
        url: currentUrl,
      });
    }

    const location = response.headers.get('location');
    if (!location) {
      throw outboundError(
        'OUTBOUND_REDIRECT_LOCATION',
        'Redirect response missing Location header',
        { url: currentUrl }
      );
    }

    const nextUrl = new URL(location, currentUrl).toString();
    currentUrl = await assertPublicOutboundUrl(nextUrl);
    redirectCount += 1;

    if (response.status === 303 && currentMethod !== 'HEAD') {
      currentMethod = 'GET';
    }
  }
}

export async function readTextResponseWithLimit(
  response,
  {
    maxBytes,
    errorCode = 'OUTBOUND_RESPONSE_TOO_LARGE',
    errorMessage = 'Outbound response exceeded size limit',
  } = {}
) {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new Error('readTextResponseWithLimit requires a positive maxBytes value');
  }

  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength && contentLength > maxBytes) {
    throw outboundError(errorCode, errorMessage, { status: 400 });
  }

  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw outboundError(errorCode, errorMessage, { status: 400 });
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw outboundError(errorCode, errorMessage, { status: 400 });
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock?.();
  }
}

export function isOutboundPolicyError(error) {
  return OUTBOUND_POLICY_CODES.has(error?.code);
}

export default {
  assertPublicOutboundUrl,
  fetchWithOutboundPolicy,
  readTextResponseWithLimit,
  isOutboundPolicyError,
};
