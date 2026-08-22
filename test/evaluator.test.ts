import assert from "node:assert/strict";
import test from "node:test";
import {parseEvaluation, parseModelRef} from "../src/plugin/evaluator.js";

test("parses strict and fenced evaluator output", () => {
    assert.deepEqual(
        parseEvaluation('{"complete":true,"reason":"All required tests passed."}'),
        {
            complete: true,
            reason: "All required tests passed.",
        },
    );
    assert.deepEqual(
        parseEvaluation(
            '```json\n{"complete":false,"reason":"Lint was not run."}\n```',
        ),
        {
            complete: false,
            reason: "Lint was not run.",
        },
    );
});

test("rejects malformed evaluator output", () => {
    assert.equal(parseEvaluation("yes"), undefined);
    assert.equal(
        parseEvaluation('{"complete":"yes","reason":"done"}'),
        undefined,
    );
    assert.equal(parseEvaluation('{"complete":true,"reason":""}'), undefined);
});

test("parses provider/model references without losing nested model names", () => {
    assert.deepEqual(parseModelRef("openrouter/anthropic/claude-haiku"), {
        providerID: "openrouter",
        modelID: "anthropic/claude-haiku",
    });
    assert.equal(parseModelRef("missing-model"), undefined);
});
