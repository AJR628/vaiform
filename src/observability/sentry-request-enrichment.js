import * as Sentry from '@sentry/node';

function hasPrefix(value, prefix) {
  return typeof value === 'string' && value.startsWith(prefix);
}

function deriveFlow(path) {
  if (hasPrefix(path, '/api/admin/finalize') || hasPrefix(path, '/admin/finalize')) {
    return 'admin-finalize';
  }
  if (hasPrefix(path, '/stripe/webhook')) {
    return 'webhook';
  }
  if (hasPrefix(path, '/api/story')) {
    return 'story';
  }
  if (hasPrefix(path, '/api/shorts')) {
    return 'shorts';
  }
  if (hasPrefix(path, '/api/checkout')) {
    return 'checkout';
  }
  if (hasPrefix(path, '/api/caption')) {
    return 'caption';
  }
  if (hasPrefix(path, '/api/usage')) {
    return 'usage';
  }
  if (hasPrefix(path, '/api/whoami')) {
    return 'whoami';
  }
  if (hasPrefix(path, '/api/users') || hasPrefix(path, '/api/user')) {
    return 'users';
  }
  return 'other';
}

export default function sentryRequestEnrichment(req, _res, next) {
  if (!Sentry.isEnabled()) {
    return next();
  }

  const path = typeof req?.path === 'string' ? req.path : null;
  const scope = Sentry.getIsolationScope();

  scope.setTags({
    surface: 'backend-api',
    service: 'api',
    request_id: req?.id ?? 'missing',
    flow: deriveFlow(path),
  });

  scope.setContext('vaiform_request', {
    method: req?.method ?? null,
    path,
    hasAuthorizationHeader: Boolean(req?.headers?.authorization ?? req?.headers?.Authorization),
  });

  return next();
}
