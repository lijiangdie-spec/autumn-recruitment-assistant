export function isTrustedLocalMutation(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const source = new URL(origin);
    const target = new URL(request.url);
    if (source.origin === target.origin) return true;
    const loopbacks = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
    return loopbacks.has(source.hostname) && loopbacks.has(target.hostname) && source.port === target.port;
  } catch {
    return false;
  }
}
