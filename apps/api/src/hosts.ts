import type { MiddlewareHandler } from "hono";

const DEFAULT_ALLOWED_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

// True when every allowed host is a loopback name, i.e. not reachable by others.
export function isLocalOnly(hosts: string[]): boolean {
  return hosts.every((host) => DEFAULT_ALLOWED_HOSTS.includes(host));
}

// Hostnames from a comma-separated list such as DUCKBILL_ALLOWED_HOSTS, or the
// localhost defaults when it is unset or empty.
export function parseAllowedHosts(value: string | undefined): string[] {
  const hosts = (value ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return hosts.length > 0 ? hosts : DEFAULT_ALLOWED_HOSTS;
}

// The hostname part of a Host header, lowercased, without any port.
// "[::1]:8787" -> "[::1]", "localhost:5173" -> "localhost".
export function hostname(header: string): string {
  const host = header.trim().toLowerCase();
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end === -1 ? host : host.slice(0, end + 1);
  }
  const colon = host.indexOf(":");
  return colon === -1 ? host : host.slice(0, colon);
}

// Rejects requests whose Host header isn't an allowed hostname (any port), which
// blocks DNS-rebinding attacks from pages in the user's browser.
export function allowedHosts(hosts: string[]): MiddlewareHandler {
  const allowed = new Set(hosts);
  return async (c, next) => {
    const header = c.req.header("host");
    if (!header || !allowed.has(hostname(header))) {
      return c.json({ error: "Host not allowed" }, 403);
    }
    await next();
  };
}
