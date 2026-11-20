import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCache } from "./cache.ts";

function setup(checkEveryMs: number) {
  const state = { build: "b1" as string | null, clock: 0, buildChecks: 0, loads: 0 };
  const cache = buildCache({
    checkEveryMs,
    now: () => state.clock,
    currentBuildId: async () => {
      state.buildChecks++;
      return state.build;
    },
  });
  const load = () => cache.get("q", async () => ++state.loads);
  return { state, load };
}

test("serves cached results until the build id changes", async () => {
  const { state, load } = setup(0);
  assert.equal(await load(), 1);
  assert.equal(await load(), 1);
  state.build = "b2";
  assert.equal(await load(), 2);
});

test("checks the build id at most once per interval", async () => {
  const { state, load } = setup(600_000);
  await load();
  state.build = "b2";
  state.clock = 599_999;
  assert.equal(await load(), 1, "a new build isn't seen before the next check");
  state.clock = 600_000;
  assert.equal(await load(), 2);
  assert.equal(state.buildChecks, 2);
});

test("doesn't cache without a build id", async () => {
  const { state, load } = setup(0);
  state.build = null;
  await load();
  assert.equal(await load(), 2);
});
