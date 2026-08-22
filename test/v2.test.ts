import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import rootPlugin from "../src/index.js";
import v2Plugin, {setupV2} from "../src/v2.js";
import {FileGoalStore, scopedStateDirectory,} from "../src/storage/goal-store.js";

type TestEvent = {
    type: string;
    id?: string;
    created?: number;
    data?: Record<string, unknown>;
};

function eventQueue() {
    const values: TestEvent[] = [];
    const waiters: Array<(result: IteratorResult<TestEvent>) => void> = [];
    let closed = false;

    return {
        push(value: TestEvent) {
            const resolve = waiters.shift();
            if (resolve) resolve({value, done: false});
            else values.push(value);
        },
        subscribe(): AsyncIterable<TestEvent> {
            return {
                [Symbol.asyncIterator]() {
                    return {
                        next() {
                            if (values.length > 0) {
                                return Promise.resolve({
                                    value: values.shift() as TestEvent,
                                    done: false,
                                });
                            }
                            if (closed)
                                return Promise.resolve({value: undefined, done: true});
                            return new Promise<IteratorResult<TestEvent>>((resolve) =>
                                waiters.push(resolve),
                            );
                        },
                        return() {
                            closed = true;
                            for (const resolve of waiters.splice(0))
                                resolve({value: undefined, done: true});
                            return Promise.resolve({value: undefined, done: true});
                        },
                    };
                },
            };
        },
    };
}

test("exposes a dual-runtime root and an explicit V2 entrypoint", () => {
    assert.equal(typeof rootPlugin, "object");
    assert.equal(rootPlugin.id, "opencode-goal");
    assert.equal(typeof rootPlugin.server, "function");
    assert.equal(typeof rootPlugin.setup, "function");
    assert.equal(v2Plugin.id, "opencode-goal");
    assert.equal(typeof v2Plugin.setup, "function");
});

test("registers and executes V2 goal tools", async (context) => {
    const stateDirectory = await mkdtemp(
        path.join(tmpdir(), "opencode-goal-v2-"),
    );
    context.after(() => rm(stateDirectory, {recursive: true, force: true}));

    const tools = new Map<string, unknown>();
    let contextHook: ((event: unknown) => Promise<void>) | undefined;
    const session = {
        async get() {
            return {
                id: "ses_v2",
                projectID: "project_v2",
                location: {directory: "/workspace"},
                model: {providerID: "test", id: "worker"},
            };
        },
        async hook(_name: string, callback: (event: unknown) => Promise<void>) {
            contextHook = callback;
        },
        async create() {
            throw new Error("not used");
        },
        async generate() {
            throw new Error("not used");
        },
        async prompt() {
            throw new Error("not used");
        },
    };

    const cleanup = await setupV2({
        options: {stateDirectory},
        session,
        tool: {
            async transform(callback: (draft: { add(tool: unknown): void }) => void) {
                callback({
                    add(tool: unknown) {
                        tools.set((tool as { name: string }).name, tool);
                    },
                });
            },
        },
        event: {
            subscribe: async function* () {
            },
        },
    });
    context.after(() => cleanup());

    assert.deepEqual(
        [...tools.keys()],
        ["create_goal", "get_goal", "update_goal"],
    );
    assert.equal(typeof contextHook, "function");

    const createDefinition = tools.get("create_goal") as {
        input: {properties: Record<string, unknown>};
    };
    assert.deepEqual(Object.keys(createDefinition.input.properties), ["objective"]);

    const create = tools.get("create_goal") as {
        execute(
            input: Record<string, unknown>,
            context: Record<string, unknown>,
        ): Promise<{ content: string }>;
    };
    const created = await create.execute(
        {objective: "the V2 build passes"},
        {sessionID: "ses_v2", messageID: "msg_v2", agent: "build", id: "call"},
    );
    assert.match(created.content, /Goal created/);

    const store = new FileGoalStore(
        scopedStateDirectory(stateDirectory, "project_v2", "/workspace"),
    );
    const goal = await store.get("ses_v2");
    assert.equal(goal?.status, "active");
    assert.equal(goal?.startedMessageID, "msg_v2");

    const contextOutput = {
        sessionID: "ses_v2",
        system: [] as Array<{ type: "text"; text: string }>,
        messages: [],
        tools: {},
    };
    await contextHook?.(contextOutput);
    assert.match(contextOutput.system[0]?.text ?? "", /active-goal/);
});

test("evaluates and completes a V2 goal from idle events", async (context) => {
    const stateDirectory = await mkdtemp(
        path.join(tmpdir(), "opencode-goal-v2-idle-"),
    );
    context.after(() => rm(stateDirectory, {recursive: true, force: true}));

    const events = eventQueue();
    const tools = new Map<string, unknown>();
    const session = {
        async get() {
            return {
                id: "ses_v2_idle",
                projectID: "project_v2",
                location: {directory: "/workspace"},
                model: {providerID: "test", id: "worker"},
            };
        },
        async hook() {
        },
        async create() {
            return {
                id: "eval_v2",
                projectID: "project_v2",
                location: {directory: "/workspace"},
            };
        },
        async generate() {
            return {
                text: JSON.stringify({complete: true, reason: "verified"}),
            };
        },
        async prompt() {
        },
    };

    const cleanup = await setupV2({
        options: {stateDirectory},
        session,
        tool: {
            async transform(callback: (draft: { add(tool: unknown): void }) => void) {
                callback({
                    add(tool: unknown) {
                        tools.set((tool as { name: string }).name, tool);
                    },
                });
            },
        },
        event: {subscribe: events.subscribe},
    });
    context.after(() => cleanup());

    const create = tools.get("create_goal") as {
        execute(
            input: Record<string, unknown>,
            toolContext: Record<string, unknown>,
        ): Promise<{ content: string }>;
    };
    await create.execute(
        {objective: "the V2 idle evaluation passes"},
        {
            sessionID: "ses_v2_idle",
            messageID: "msg_v2_idle",
            agent: "build",
            id: "call",
        },
    );

    const now = Date.now();
    events.push({
        type: "session.inbox.enqueued",
        id: "inbox_v2",
        created: now,
        data: {
            sessionID: "ses_v2_idle",
            inboxID: "inbox_v2",
            item: {type: "user", payload: {text: "work toward goal"}},
        },
    });
    events.push({
        type: "session.step.started",
        created: now + 1,
        data: {
            sessionID: "ses_v2_idle",
            assistantMessageID: "assistant_v2",
            agent: "build",
            model: {providerID: "test", id: "worker"},
        },
    });
    events.push({
        type: "session.text.ended",
        created: now + 2,
        data: {
            sessionID: "ses_v2_idle",
            assistantMessageID: "assistant_v2",
            text: "All checks passed.",
        },
    });
    events.push({
        type: "session.step.ended",
        created: now + 3,
        data: {
            sessionID: "ses_v2_idle",
            assistantMessageID: "assistant_v2",
            tokens: {
                input: 10,
                output: 5,
                reasoning: 0,
                cache: {read: 0, write: 0},
            },
        },
    });
    events.push({
        type: "session.idle",
        created: now + 4,
        data: {sessionID: "ses_v2_idle"},
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    const store = new FileGoalStore(
        scopedStateDirectory(stateDirectory, "project_v2", "/workspace"),
    );
    assert.equal((await store.get("ses_v2_idle"))?.status, "complete");
});
