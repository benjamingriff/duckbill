import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import { requireOwner } from "./auth.ts";

function app(signedInAs: string | null | Error) {
  const app = new Hono();
  app.use(
    "/api/*",
    requireOwner("user_owner", async () => {
      if (signedInAs instanceof Error) throw signedInAs;
      return signedInAs;
    }),
  );
  app.get("/api/data", (c) => c.text("secret"));
  return app;
}

test("lets the owner through", async () => {
  const res = await app("user_owner").request("/api/data");
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "secret");
});

test("rejects other signed-in users with their own id as a hint", async () => {
  const res = await app("user_other").request("/api/data");
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: "Not allowed", hint: "Signed in as user_other" });
});

test("rejects requests without a session, or when verification fails", async () => {
  assert.equal((await app(null).request("/api/data")).status, 401);
  assert.equal((await app(new Error("jwks unreachable")).request("/api/data")).status, 401);
});
