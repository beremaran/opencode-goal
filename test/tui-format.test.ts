import assert from "node:assert/strict";
import test from "node:test";
import { createGoalState } from "../src/lifecycle.js";
import {
  compactCount,
  goalElapsedMilliseconds,
  goalLimitProgress,
  goalStatusLabel,
  progressBar,
  snippet,
} from "../src/tui-format.js";

test("formats goal status and compact counts", () => {
  assert.equal(goalStatusLabel("budget_limited"), "token limit");
  assert.equal(goalStatusLabel("turn_limited"), "turn limit");
  assert.equal(compactCount(999), "999");
  assert.equal(compactCount(1_500), "1.5k");
  assert.equal(compactCount(2_000_000), "2m");
});

test("builds budget progress without implying completion progress", () => {
  const goal = {
    ...createGoalState({
      sessionID: "ses_123",
      directory: "/workspace",
      objective: "ship the sidebar",
      tokenBudget: 100_000,
      maxTurns: 20,
      now: 1_000,
      goalId: "goal_123",
    }),
    turns: 5,
    tokensUsed: 25_000,
  };

  assert.deepEqual(goalLimitProgress(goal), [
    {
      label: "Turns",
      used: 5,
      total: 20,
      percent: 25,
      bar: "███░░░░░░░",
    },
    {
      label: "Tokens",
      used: 25_000,
      total: 100_000,
      percent: 25,
      bar: "███░░░░░░░",
    },
  ]);
  assert.equal(progressBar(150, 100, 4), "████");
});

test("freezes elapsed time after a goal stops", () => {
  const active = createGoalState({
    sessionID: "ses_123",
    directory: "/workspace",
    objective: "ship the sidebar",
    now: 1_000,
    goalId: "goal_123",
  });
  assert.equal(goalElapsedMilliseconds(active, 6_000), 5_000);

  const complete = {
    ...active,
    status: "complete" as const,
    updatedAt: 5_000,
    completedAt: 4_000,
  };
  assert.equal(goalElapsedMilliseconds(complete, 20_000), 3_000);
});

test("normalizes and truncates sidebar text", () => {
  assert.equal(snippet("  one\n two   three  "), "one two three");
  assert.equal(snippet("abcdefgh", 5), "abcd…");
});
