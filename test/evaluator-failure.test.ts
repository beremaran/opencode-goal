import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {GoalPlugin} from "../src/index.js";
import type {TranscriptMessage} from "../src/types.js";

test("pauses rather than looping when the completion evaluator cannot start", async (context) => {
    const stateDirectory = await mkdtemp(
        path.join(tmpdir(), "opencode-goal-evaluator-failure-"),
    );
    context.after(() => rm(stateDirectory, {recursive: true, force: true}));

    let messages: TranscriptMessage[] = [];
    let continuationCount = 0;
    const client = {
        app: {log: async () => ({data: true})},
        config: {get: async () => ({data: {}})},
        tui: {showToast: async () => ({data: true})},
        session: {
            messages: async () => ({data: messages}),
            create: async () => ({data: undefined}),
            status: async () => ({data: {}}),
            promptAsync: async () => {
                continuationCount += 1;
                return {data: undefined};
            },
        },
    };

    const hooks = await GoalPlugin(
        {
            client,
            project: {id: "project-evaluator-failure"},
            directory: "/workspace",
        } as never,
        {stateDirectory},
    );
    await hooks["command.execute.before"]?.(
        {
            command: "goal",
            sessionID: "ses_failure",
            arguments: "finish the task",
        },
        {parts: [{type: "text", text: ""}]} as never,
    );
    const created = Date.now() + 10;
    messages = [
        {
            info: {
                id: "usr_failure",
                role: "user",
                time: {created},
                agent: "build",
                model: {providerID: "test", modelID: "worker"},
            },
            parts: [{type: "text", text: "finish the task"}],
        },
        {
            info: {
                id: "asst_failure",
                role: "assistant",
                time: {created: created + 1},
                tokens: {
                    input: 10,
                    output: 5,
                    reasoning: 0,
                    cache: {read: 0, write: 0},
                },
            },
            parts: [{type: "text", text: "Some work remains."}],
        },
    ];
    await hooks.event?.({
        event: {type: "session.idle", properties: {sessionID: "ses_failure"}},
    } as never);

    const status = await hooks.tool?.get_goal?.execute({}, {
        sessionID: "ses_failure",
    } as never);
    assert.match(String(status), /"status": "paused"/);
    assert.match(String(status), /evaluation could not start/);
    assert.equal(continuationCount, 0);
});
