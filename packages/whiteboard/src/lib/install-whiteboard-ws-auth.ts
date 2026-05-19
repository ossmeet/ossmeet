// Use a Symbol on window instead of a module-level boolean so the guard
// survives HMR reloads (the module is re-executed but window persists).
const INSTALLED_SYMBOL = Symbol.for("ossmeet.wsauth.installed");

export function installWhiteboardWebSocketAuth(): void {
  if (
    typeof window === "undefined" ||
    typeof WebSocket === "undefined" ||
    (window as unknown as Record<symbol, boolean>)[INSTALLED_SYMBOL]
  ) {
    return;
  }

  const OriginalWebSocket = window.WebSocket;

  function normalizeProtocols(protocols?: string | string[]): string[] | undefined {
    if (protocols == null) return undefined;
    return Array.isArray(protocols) ? protocols : [protocols];
  }

  function shouldRewrite(url: URL): boolean {
    return (
      url.pathname === "/connect" &&
      (url.searchParams.has("token") || new URLSearchParams(url.hash.slice(1)).has("token"))
    );
  }

  const WrappedWebSocket = new Proxy(OriginalWebSocket, {
    construct(Target, args) {
      const [rawUrl, rawProtocols] = args as [string | URL, string | string[] | undefined];
      const url = new URL(String(rawUrl), window.location.href);

      if (!shouldRewrite(url)) {
        return new Target(rawUrl, rawProtocols);
      }

      const hashParams = new URLSearchParams(url.hash.slice(1));
      const token = url.searchParams.get("token") ?? hashParams.get("token");
      if (!token) {
        return new Target(rawUrl, rawProtocols);
      }

      url.searchParams.delete("token");
      hashParams.delete("token");
      url.hash = hashParams.toString() ? `#${hashParams.toString()}` : "";
      const protocols = normalizeProtocols(rawProtocols) ?? [];
      protocols.unshift(token);
      // accept "ossmeet-wb" in the server's Sec-WebSocket-Protocol response
      // so the JWT is not echoed back. Bun requires the accepted protocol to be one
      // of the requested protocols, so we include both.
      protocols.push("ossmeet-wb");
      return new Target(url.toString(), protocols);
    },
  });

  window.WebSocket = WrappedWebSocket as typeof WebSocket;
  (window as unknown as Record<symbol, boolean>)[INSTALLED_SYMBOL] = true;
}
