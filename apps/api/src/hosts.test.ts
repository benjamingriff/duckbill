import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import { allowedHosts, parseAllowedHosts } from "./hosts.ts";

function appWith(hosts: string[]): Hono {
  const app = new Hono();
  app.use(allowedHosts(hosts));
  app.get("/", (c) => c.text("ok"));
  return app;
}

async function statusFor(app: Hono, host: string | undefined): Promise<number> {
  const headers = new Headers();
  if (host !== undefined) headers.set("host", host);
  const res = await app.request("http://placeholder/", { headers });
  return res.status;
}

test("allows localhost hostnames on any port by default", async () => {
  const app = appWith(parseAllowedHosts(undefined));
  for (const host of ["localhost", "localhost:8787", "127.0.0.1:5173", "[::1]:8787", "LOCALHOST"]) {
    assert.equal(await statusFor(app, host), 200, host);
  }
});

test("rejects other hosts, including rebinding lookalikes", async () => {
  const app = appWith(parseAllowedHosts(undefined));
  for (const host of ["evil.example:8787", "localhost.evil.example", "127.0.0.1.nip.io", ""]) {
    assert.equal(await statusFor(app, host), 403, host);
  }
});

test("DUCKBILL_ALLOWED_HOSTS replaces the defaults", async () => {
  const app = appWith(parseAllowedHosts(" duckbill.example , Other.example "));
  assert.equal(await statusFor(app, "duckbill.example:443"), 200);
  assert.equal(await statusFor(app, "other.example"), 200);
  assert.equal(await statusFor(app, "localhost:8787"), 403);
});
