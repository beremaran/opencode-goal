import assert from "node:assert/strict";
import test from "node:test";
import {goalCommandPrompt} from "../src/core/commands.js";
import {createGoalState} from "../src/core/goal.js";
import {parseGoalCommand} from "../src/core/options.js";
import type {GoalState} from "../src/core/types.js";

test("parses goal lifecycle commands", () => {
    assert.deepEqual(parseGoalCommand(""), {action: "status"});
    assert.deepEqual(parseGoalCommand("pause"), {action: "pause"});
    assert.deepEqual(parseGoalCommand("resume"), {action: "resume"});
    assert.deepEqual(parseGoalCommand("clear"), {action: "clear"});
    assert.deepEqual(parseGoalCommand("cancel"), {action: "clear"});
});

test("parses an objective", () => {
    assert.deepEqual(parseGoalCommand("all tests pass"), {
        action: "set",
        objective: "all tests pass",
    });
});

test("rejects invalid and unknown options", () => {
    assert.deepEqual(parseGoalCommand("--surprise finish"), {
        action: "invalid",
        message: "Unknown goal option: --surprise",
    });
});

test("handles goal command actions", async () => {
    let current: GoalState | undefined;
    const store = {
        get: async () => current,
        set: async (goal: GoalState) => {
            current = goal;
        },
        clear: async () => {
            current = undefined;
        },
    };

    await goalCommandPrompt(store, "ses_test", "/workspace", {action: "status"});
    await goalCommandPrompt(store, "ses_test", "/workspace", {action: "help"});
    await goalCommandPrompt(store, "ses_test", "/workspace", {action: "invalid", message: "bad option"});
    await goalCommandPrompt(store, "ses_test", "/workspace", {action: "clear"});
    await goalCommandPrompt(store, "ses_test", "/workspace", {action: "pause"});
    await goalCommandPrompt(store, "ses_test", "/workspace", {action: "resume"});

    await goalCommandPrompt(store, "ses_test", "/workspace", {action: "set", objective: "ship it"});
    assert.equal(current?.status, "active");
    await goalCommandPrompt(store, "ses_test", "/workspace", {action: "pause"});
    assert.equal(current?.status, "paused");
    await goalCommandPrompt(store, "ses_test", "/workspace", {action: "resume"});
    assert.equal(current?.status, "active");

    current = createGoalState({sessionID: "ses_test", directory: "/workspace", objective: "done", now: 1});
    current.status = "complete";
    await goalCommandPrompt(store, "ses_test", "/workspace", {action: "resume"});
});
