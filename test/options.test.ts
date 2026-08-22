import assert from "node:assert/strict";
import test from "node:test";
import {parseGoalCommand} from "../src/core/options.js";

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
    assert.deepEqual(
        parseGoalCommand("--surprise finish"),
        {
            action: "invalid",
            message: "Unknown goal option: --surprise",
        },
    );
});
