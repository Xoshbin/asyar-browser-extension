const COMMON_TLDS = new Set([
  'com', 'org', 'net', 'io', 'dev', 'app', 'co', 'edu', 'gov', 'mil',
  'biz', 'info', 'uk', 'us', 'de', 'fr', 'jp', 'cn', 'ru', 'br', 'au',
  'ca', 'me', 'tv', 'so', 'sh', 'xyz', 'ai', 'gg', 'tech', 'cloud',
]);

const SCHEME_RE = /^[a-z][a-z0-9+\-.]*:\/\//i;
const FILE_RE = /^file:\/\//i;
const IP_RE = /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/;

export function isUrlLike(input: string): boolean {
  const s = input.trim();
  if (!s || /\s/.test(s)) return false;

  if (FILE_RE.test(s) || SCHEME_RE.test(s)) return true;
  if (IP_RE.test(s)) return true;

  // hostname.tld[/path...] with a known TLD
  const hostPart = s.split(/[\/?#]/)[0];
  if (!hostPart.includes('.')) return false;
  const segments = hostPart.split('.');
  if (segments.some((seg) => seg.length === 0)) return false; // rejects "example." and ".com"
  const tld = segments[segments.length - 1].toLowerCase();
  return COMMON_TLDS.has(tld);
}

export function normaliseUrl(input: string): string {
  const s = input.trim();
  if (SCHEME_RE.test(s) || FILE_RE.test(s)) return s;
  return `https://${s}`;
}
