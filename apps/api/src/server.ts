import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { DuckDBValue } from "@duckdb/node-api";
import { clerkAuthenticator, requireOwner } from "./auth.ts";
import { buildCache } from "./cache.ts";
import {
  currentBuildId,
  dataDir,
  isMotherDuck,
  query as uncachedQuery,
  warehouse,
  WarehouseUnavailable,
} from "./db.ts";
import { allowedHosts, isLocalOnly, parseAllowedHosts } from "./hosts.ts";
import { createApi } from "./routes.ts";
import type { ApiError } from "./types.ts";

const env = process.env;
const hosts = parseAllowedHosts(env.DUCKBILL_ALLOWED_HOSTS);
const hostname = env.DUCKBILL_API_HOST ?? "127.0.0.1";
// The Host check alone can't protect a server others can reach: they choose the header.
const exposed = !isLocalOnly(hosts) || !["127.0.0.1", "localhost", "::1"].includes(hostname);

const app = new Hono();

// For the platform's health check, which uses its own Host header. Returns no data.
app.get("/healthz", (c) => c.text("ok"));

// Only answer requests addressed to localhost (or DUCKBILL_ALLOWED_HOSTS, comma-separated).
app.use(allowedHosts(hosts));

// Sign-in is required whenever Clerk is configured, and always when the server
// binds beyond loopback or answers a non-local hostname: without auth it refuses to start.
if (env.CLERK_SECRET_KEY) {
  if (!env.CLERK_PUBLISHABLE_KEY || !env.DUCKBILL_OWNER_USER_ID) {
    throw new Error("CLERK_SECRET_KEY needs CLERK_PUBLISHABLE_KEY and DUCKBILL_OWNER_USER_ID");
  }
  const authenticate = clerkAuthenticator({
    secretKey: env.CLERK_SECRET_KEY,
    publishableKey: env.CLERK_PUBLISHABLE_KEY,
    authorizedParties: hosts.map((host) => `https://${host}`),
  });
  app.use("/api/*", requireOwner(env.DUCKBILL_OWNER_USER_ID, authenticate));
} else if (exposed) {
  throw new Error(
    `Refusing to listen on ${hostname} for ${hosts.join(", ")} without auth: set CLERK_SECRET_KEY`,
  );
}

// Results are cached until a new dbt build is published (see cache.ts). Locally
// the build id is checked on every request, so a rebuild shows up at once.
const cache = buildCache({
  currentBuildId,
  checkEveryMs: Number(env.DUCKBILL_CACHE_CHECK_SECONDS ?? (isMotherDuck ? 600 : 0)) * 1000,
});

function query<T>(sql: string, params: Record<string, DuckDBValue> = {}): Promise<T[]> {
  return cache.get(sql + JSON.stringify(params), () => uncachedQuery<T>(sql, params));
}

app.route("/", createApi(query, isMotherDuck ? warehouse : dataDir));

app.onError((err, c) => {
  if (err instanceof WarehouseUnavailable) {
    return c.json<ApiError>(
      {
        error: err.message,
        hint: "Run `pnpm demo` for synthetic data, or `pnpm monzo:login` to import from Monzo.",
      },
      503,
    );
  }
  console.error(err);
  return c.json<ApiError>({ error: "Internal error" }, 500);
});

// The built dashboard, when present (`pnpm --filter @duckbill/web build`), with
// unknown paths falling back to index.html for client-side routing.
app.all("/api/*", (c) => c.json<ApiError>({ error: "Not found" }, 404));
const webDist = fileURLToPath(new URL("../../web/dist", import.meta.url));
if (existsSync(resolve(webDist, "index.html"))) {
  app.use("*", serveStatic({ root: webDist }));
  app.get("*", serveStatic({ root: webDist, path: "index.html" }));
}

const port = Number(env.PORT ?? env.DUCKBILL_API_PORT ?? 8787);
serve({ fetch: app.fetch, hostname, port }, () => {
  console.log(`duckbill api on http://${hostname}:${port} (data: ${warehouse})`);
});
