import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { GoalPlugin } from "../src/index.js";
import type { TranscriptMessage } from "../src/types.js";

function user(id: string, created: number, text: string): TranscriptMessage {
  return {
    info: {
      id,
      role: "user",
      time: { created },
      agent: "build",
      model: { providerID: "test", modelID: "worker" },
    },
    parts: [{ type: "text", text }],
  };
}

function assistant(
  id: string,
  created: number,
  text: string,
): TranscriptMessage {
  return {
    info: {
      id,
      role: "assistant",
      time: { created },
      tokens: {
        input: 100,
        output: 20,
        reasoning: 5,
        cache: { read: 0, write: 0 },
      },
    },
    parts: [{ type: "text", text }],
  };
}

test("sets, evaluates, continues, and completes a session goal", async (context) => {
  const stateDirectory = await mkdtemp(
    path.join(tmpdir(), "opencode-goal-plugin-"),
  );
  context.after(() => rm(stateDirectory, { recursive: true, force: true }));

  const decisions = [
    { complete: false, reason: "The lint step has not passed yet." },
    { complete: true, reason: "Tests and lint are both reported passing." },
  ];
  const continuations: unknown[] = [];
  const deletedEvaluators: string[] = [];
  let evaluatorCount = 0;
  let messages: TranscriptMessage[] = [];

  const client = {
    app: {
      log: async () => ({ data: true }),
    },
    config: {
      get: async () => ({ data: { small_model: "test/evaluator" } }),
    },
    tui: {
      showToast: async () => ({ data: true }),
    },
    session: {
      create: async () => ({ data: { id: `eval_${++evaluatorCount}` } }),
      delete: async ({ path: inputPath }: { path: { id: string } }) => {
        deletedEvaluators.push(inputPath.id);
        return { data: true };
      },
      messages: async () => ({ data: messages }),
      status: async () => ({ data: {} }),
      prompt: async () => ({
        data: {
          parts: [
            {
              type: "text",
              text: JSON.stringify(decisions.shift()),
            },
          ],
        },
      }),
      promptAsync: async (request: unknown) => {
        continuations.push(request);
        return { data: undefined };
      },
    },
  };

  const hooks = await GoalPlugin(
    {
      client,
      project: { id: "project-test" },
      directory: "/workspace",
      worktree: "/workspace",
      serverUrl: new URL("http://localhost:4096"),
      experimental_workspace: { register: () => undefined },
      $: {},
    } as never,
    { stateDirectory },
  );

  const config: Record<string, unknown> = {};
  await hooks.config?.(config as never);
  assert.equal(
    (config.command as Record<string, { description: string }>).goal
      ?.description,
    "Set, inspect, pause, resume, or clear a persistent goal",
  );

  const output = {
    parts: [{ type: "text", text: "<goal-command>" }],
  };
  await hooks["command.execute.before"]?.(
    {
      command: "goal",
      sessionID: "ses_parent",
      arguments: "tests and lint pass",
    },
    output as never,
  );
  assert.match(
    output.parts[0]?.text ?? "",
    /<objective>tests and lint pass<\/objective>/,
  );

  const started = Date.now() + 10;
  messages = [
    user("usr_1", started, "tests and lint pass"),
    assistant("asst_1", started + 1, "Tests pass. Lint still fails."),
  ];
  await hooks.event?.({
    event: { type: "session.idle", properties: { sessionID: "ses_parent" } },
  } as never);

  assert.equal(continuations.length, 1);
  assert.equal(deletedEvaluators.length, 1);
  assert.match(JSON.stringify(continuations[0]), /lint step has not passed/);

  const active = await hooks.tool?.get_goal?.execute({}, {
    sessionID: "ses_parent",
  } as never);
  assert.match(String(active), /"status": "active"/);
  assert.match(String(active), /"turns": 1/);

  messages = [
    ...messages,
    user("usr_2", started + 2, "goal continuation"),
    assistant("asst_2", started + 3, "Tests and lint both pass."),
  ];
  await hooks.event?.({
    event: { type: "session.idle", properties: { sessionID: "ses_parent" } },
  } as never);

  assert.equal(continuations.length, 1);
  assert.equal(deletedEvaluators.length, 2);
  const complete = await hooks.tool?.get_goal?.execute({}, {
    sessionID: "ses_parent",
  } as never);
  assert.match(String(complete), /"status": "complete"/);
  assert.match(String(complete), /"turns": 2/);
});

test("pauses an active goal when OpenCode reports an interrupted message", async (context) => {
  const stateDirectory = await mkdtemp(
    path.join(tmpdir(), "opencode-goal-interrupt-"),
  );
  context.after(() => rm(stateDirectory, { recursive: true, force: true }));

  const client = {
    app: { log: async () => ({ data: true }) },
    tui: { showToast: async () => ({ data: true }) },
    session: {},
  };
  const hooks = await GoalPlugin(
    {
      client,
      project: { id: "project-interrupt" },
      directory: "/workspace",
    } as never,
    { stateDirectory },
  );

  await hooks["command.execute.before"]?.(
    {
      command: "goal",
      sessionID: "ses_interrupt",
      arguments: "finish the migration",
    },
    { parts: [{ type: "text", text: "" }] } as never,
  );
  await hooks.event?.({
    event: {
      type: "session.error",
      properties: {
        sessionID: "ses_interrupt",
        error: { name: "MessageAbortedError", data: { message: "aborted" } },
      },
    },
  } as never);

  const status = await hooks.tool?.get_goal?.execute({}, {
    sessionID: "ses_interrupt",
  } as never);
  assert.match(String(status), /"status": "paused"/);
  assert.match(String(status), /session was interrupted/);
});
