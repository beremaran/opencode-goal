import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createGoalState } from "../src/lifecycle.js";
import { FileGoalStore } from "../src/state.js";

test("persists, loads, and clears a goal atomically", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "opencode-goal-state-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const store = new FileGoalStore(directory);
  const goal = createGoalState({
    sessionID: "ses_123",
    directory: "/workspace",
    objective: "tests pass",
    tokenBudget: 5_000,
    startedMessageID: "asst_goal",
    now: 10,
    goalId: "goal_123",
  });

  await store.set(goal);
  assert.deepEqual(await store.get("ses_123"), goal);

  const stored = JSON.parse(
    await readFile(path.join(directory, "ses_123.json"), "utf8"),
  );
  assert.equal(stored.objective, "tests pass");
  assert.equal(stored.startedMessageID, "asst_goal");

  await store.clear("ses_123");
  assert.equal(await store.get("ses_123"), undefined);
});

test("treats corrupt state as absent", async (context) => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "opencode-goal-corrupt-"),
  );
  context.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, "ses_bad.json"), "{not json", "utf8");

  const store = new FileGoalStore(directory);
  assert.equal(await store.get("ses_bad"), undefined);
});
