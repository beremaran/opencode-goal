import assert from "node:assert/strict";
import test from "node:test";
import {buildTranscript, latestAssistant, totalGoalTokens,} from "../src/core/transcript.js";
import type {TranscriptMessage} from "../src/core/types.js";

const messages: TranscriptMessage[] = [
    {
        info: {id: "old", role: "user", time: {created: 5}},
        parts: [{type: "text", text: "before the goal"}],
    },
    {
        info: {id: "user", role: "user", time: {created: 10}},
        parts: [{type: "text", text: "run the tests"}],
    },
    {
        info: {
            id: "assistant",
            role: "assistant",
            time: {created: 20},
            tokens: {
                input: 100,
                output: 20,
                reasoning: 5,
                cache: {read: 1_000, write: 50},
            },
        },
        parts: [
            {type: "text", text: "I ran them."},
            {
                type: "tool",
                tool: "bash",
                state: {status: "completed", output: "12 passing"},
            },
        ],
    },
];

test("renders goal-period evidence and excludes earlier messages", () => {
    const transcript = buildTranscript(messages, 10, 10_000);

    assert.doesNotMatch(transcript, /before the goal/);
    assert.match(transcript, /\[user\]\nrun the tests/);
    assert.match(transcript, /\[tool bash completed\]\n12 passing/);
});

test("counts uncached parent-session tokens", () => {
    assert.equal(totalGoalTokens(messages, 10), 125);
    assert.equal(latestAssistant(messages, 10)?.info.id, "assistant");
});

test("anchors an agent-created goal to the tool-calling message", () => {
    const transcript = buildTranscript(messages, Date.now(), 10_000, "assistant");

    assert.doesNotMatch(transcript, /before the goal|run the tests/);
    assert.match(transcript, /I ran them/);
    assert.equal(totalGoalTokens(messages, Date.now(), "assistant"), 125);
    assert.equal(
        latestAssistant(messages, Date.now(), "assistant")?.info.id,
        "assistant",
    );
});

test("truncates from the front so recent evidence survives", () => {
    const transcript = buildTranscript(messages, 10, 60);

    assert.match(transcript, /Earlier goal transcript omitted/);
    assert.match(transcript, /12 passing/);
});
