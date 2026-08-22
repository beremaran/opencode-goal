import assert from "node:assert/strict";
import test from "node:test";
import {createGoalState} from "../src/core/goal.js";
import {
    compactCount,
    goalElapsedMilliseconds,
    goalStatusLabel,
    snippet,
} from "../src/ui/format.js";

test("formats goal status and compact counts", () => {
    assert.equal(goalStatusLabel("active"), "active");
    assert.equal(goalStatusLabel("blocked"), "blocked");
    assert.equal(compactCount(999), "999");
    assert.equal(compactCount(1_500), "1.5k");
    assert.equal(compactCount(2_000_000), "2m");
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
