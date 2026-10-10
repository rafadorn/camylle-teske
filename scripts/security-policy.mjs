export function securityMeta(supabaseURL = '') {
  let backend = '', imageOrigin = '';
  if (supabaseURL) {
    const url = new URL(supabaseURL);
    if (url.protocol !== 'https:') throw new Error('O backend precisa usar HTTPS.');
    backend = ` ${url.origin} wss://${url.host}`;
    imageOrigin = ` ${url.origin}`;
  }
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    `connect-src 'self'${backend}`,
    `img-src 'self' data: blob:${imageOrigin}`,
    "font-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; ');
  return `<meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer">`;
}
