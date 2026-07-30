import assert from "node:assert/strict";
import test from "node:test";
import {
  parseGoalCommand,
  parseTokenCount,
  resolveOptions,
} from "../src/options.js";

test("parses goal lifecycle commands", () => {
  const defaults = resolveOptions(undefined);

  assert.deepEqual(parseGoalCommand("", defaults), { action: "status" });
  assert.deepEqual(parseGoalCommand("pause", defaults), { action: "pause" });
  assert.deepEqual(parseGoalCommand("resume", defaults), { action: "resume" });
  assert.deepEqual(parseGoalCommand("clear", defaults), { action: "clear" });
  assert.deepEqual(parseGoalCommand("cancel", defaults), { action: "clear" });
});

test("parses an objective with explicit budgets", () => {
  const result = parseGoalCommand(
    "--tokens 125k --max-turns=12 all tests pass",
    resolveOptions(undefined),
  );

  assert.deepEqual(result, {
    action: "set",
    objective: "all tests pass",
    tokenBudget: 125_000,
    maxTurns: 12,
  });
});

test("supports human-readable token counts", () => {
  assert.equal(parseTokenCount("10k"), 10_000);
  assert.equal(parseTokenCount("1.5m"), 1_500_000);
  assert.equal(parseTokenCount("0"), undefined);
  assert.equal(parseTokenCount("many"), undefined);
});

test("rejects invalid and unknown options", () => {
  assert.deepEqual(
    parseGoalCommand("--tokens nope finish", resolveOptions(undefined)),
    {
      action: "invalid",
      message:
        "`--tokens` must be a positive integer, optionally ending in k or m.",
    },
  );
  assert.deepEqual(
    parseGoalCommand("--surprise finish", resolveOptions(undefined)),
    {
      action: "invalid",
      message: "Unknown goal option: --surprise",
    },
  );
});
