const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function secureAuthLocation(location) {
  return Boolean(location && (location.protocol === 'https:'
    || (location.protocol === 'http:' && LOOPBACK_HOSTS.has(location.hostname))));
}

export function authOptionsForLocation(location) {
  const secure = secureAuthLocation(location);
  return { persistSession: secure, autoRefreshToken: secure, detectSessionInUrl: secure };
}

export function httpsLocation(location) {
  if (location?.protocol !== 'http:' || secureAuthLocation(location)) return null;
  const url = new URL(location.href);
  url.protocol = 'https:';
  return url.href;
}

export function sessionExpired(error) {
  return error?.status === 401
    || ['session_not_found', 'session_expired', 'refresh_token_not_found', 'refresh_token_already_used',
      'bad_jwt', 'invalid_jwt', 'not_authenticated', 'PGRST301', 'PGRST303'].includes(error?.code)
    || error?.name === 'AuthSessionMissingError'
    || /jwt expired|invalid jwt|auth session missing|invalid refresh token/i.test(error?.message || '');
}

// A renewed token keeps the same boundary. Logout and account changes invalidate pending work.
export function createAuthBoundary() {
  let version = 0, userId = null;
  return {
    get userId() { return userId; },
    capture: () => version,
    current: ticket => ticket === version,
    invalidate() { version += 1; userId = null; },
    observe(event, session) {
      const nextUser = session?.user?.id || null;
      if (event === 'SIGNED_OUT' || !nextUser) {
        if (userId !== null || event === 'SIGNED_OUT') version += 1;
        userId = null;
        return 'login';
      }
      if (event === 'PASSWORD_RECOVERY' || nextUser !== userId) {
        version += 1; userId = nextUser;
        return event === 'PASSWORD_RECOVERY' ? 'recovery' : 'enter';
      }
      return 'keep';
    },
  };
}
