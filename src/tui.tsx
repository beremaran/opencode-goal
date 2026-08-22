/** @jsxImportSource @opentui/solid */
import type {
  TuiPlugin,
  TuiPluginApi,
  TuiPluginModule,
  TuiTheme,
} from "@opencode-ai/plugin/tui";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import { createGoalState, formatDuration } from "./lifecycle.js";
import { parseGoalCommand, resolveOptions } from "./options.js";
import { defaultStateRoot } from "./state.js";
import {
  compactCount,
  goalElapsedMilliseconds,
  goalLimitProgress,
  goalStatusLabel,
  snippet,
} from "./tui-format.js";
import { loadSessionGoal } from "./tui-state.js";
import {
  actionPrompt,
  continuationPrompt,
  helpPrompt,
  startingPrompt,
  statusPrompt,
} from "./prompts.js";
import { FileGoalStore, scopedStateDirectory } from "./state.js";
import type {
  GoalState,
  GoalStatus,
  ResolvedGoalPluginOptions,
} from "./types.js";

const PLUGIN_ID = "opencode-goal.tui";
const REFRESH_DELAY_MS = 150;
const ACTIVE_POLL_MS = 1_000;

type TuiColor = TuiTheme["current"]["text"];

function statusColor(theme: TuiTheme["current"], status: GoalStatus): TuiColor {
  switch (status) {
    case "active":
    case "complete":
      return theme.success;
    case "paused":
    case "budget_limited":
    case "turn_limited":
      return theme.warning;
    case "blocked":
      return theme.error;
  }
}

function GoalSidebar(props: {
  api: TuiPluginApi;
  sessionID: string;
  stateRoot: string;
}) {
  const [goal, setGoal] = createSignal<GoalState>();
  const [open, setOpen] = createSignal(true);
  const [now, setNow] = createSignal(Date.now());
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let requestID = 0;

  const refresh = async (): Promise<void> => {
    const currentRequest = ++requestID;
    const session = props.api.state.session.get(props.sessionID);
    if (!session) {
      setGoal(undefined);
      return;
    }

    const next = await loadSessionGoal(props.stateRoot, session);
    if (currentRequest === requestID) setGoal(next);
  };

  const scheduleRefresh = (): void => {
    if (refreshTimer !== undefined) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      void refresh();
    }, REFRESH_DELAY_MS);
  };

  createEffect(() => {
    void props.api.state.ready;
    void props.api.state.session.get(props.sessionID);
    void refresh();
  });

  const onSessionEvent = (event: {
    properties: { sessionID: string };
  }): void => {
    if (event.properties.sessionID === props.sessionID) scheduleRefresh();
  };

  const unsubscribe = [
    props.api.event.on("message.updated", onSessionEvent),
    props.api.event.on("session.updated", onSessionEvent),
    props.api.event.on("session.status", onSessionEvent),
    props.api.event.on("session.idle", onSessionEvent),
  ];

  const interval = setInterval(() => {
    setNow(Date.now());
    if (goal()?.status === "active") void refresh();
  }, ACTIVE_POLL_MS);

  onCleanup(() => {
    requestID += 1;
    if (refreshTimer !== undefined) clearTimeout(refreshTimer);
    clearInterval(interval);
    for (const dispose of unsubscribe) dispose();
  });

  const limits = createMemo(() => {
    const current = goal();
    return current ? goalLimitProgress(current) : [];
  });

  return (
    <Show when={goal()}>
      {(current) => (
        <box>
          <box
            flexDirection="row"
            gap={1}
            onMouseDown={() => setOpen((value) => !value)}
          >
            <text fg={props.api.theme.current.text}>{open() ? "▼" : "▶"}</text>
            <text fg={props.api.theme.current.text}>
              <b>Goal</b>
            </text>
            <text fg={statusColor(props.api.theme.current, current().status)}>
              • {goalStatusLabel(current().status)}
            </text>
          </box>

          <Show when={open()}>
            <text fg={props.api.theme.current.textMuted}>
              {snippet(current().objective, 160)}
            </text>

            <Show
              when={limits().length > 0}
              fallback={
                <text fg={props.api.theme.current.textMuted}>
                  {current().turns.toLocaleString()} turns ·{" "}
                  {compactCount(current().tokensUsed)} tokens
                </text>
              }
            >
              <For each={limits()}>
                {(limit) => (
                  <text fg={props.api.theme.current.textMuted}>
                    {limit.label} [{limit.bar}] {compactCount(limit.used)} /{" "}
                    {compactCount(limit.total)} ({limit.percent}%)
                  </text>
                )}
              </For>
            </Show>

            <text fg={props.api.theme.current.textMuted}>
              {formatDuration(goalElapsedMilliseconds(current(), now()))}{" "}
              elapsed
            </text>

            <Show when={current().lastReason}>
              {(reason) => (
                <text fg={props.api.theme.current.textMuted}>
                  Last: {snippet(reason(), 160)}
                </text>
              )}
            </Show>
          </Show>
        </box>
      )}
    </Show>
  );
}

type V2TuiSession = {
  id: string;
  projectID: string;
  location: { directory: string };
};

type V2TuiContext = {
  options: Readonly<Record<string, unknown>>;
  client: {
    session: {
      prompt(input: { sessionID: string; text: string }): Promise<unknown>;
    };
  };
  data: {
    on(
      type: string,
      handler: (event: { type: string; data?: { sessionID?: string } }) => void,
    ): () => void;
    session: {
      get(sessionID: string): V2TuiSession | undefined;
      sync(sessionID: string): Promise<void>;
    };
  };
  keymap: {
    layer(
      input: () => {
        commands: Array<{
          id: string;
          title: string;
          description: string;
          slash: { name: string; aliases?: string[]; arguments: true };
          run(input?: string): void | Promise<void>;
        }>;
      },
    ): void;
  };
  ui: {
    router: {
      current():
        | { type: "session"; sessionID: string }
        | { type: string; sessionID?: string };
    };
    slot(input: {
      append: "sidebar.content";
      render(props: { sessionID: string }): unknown;
    }): () => void;
  };
};

function V2GoalSidebar(props: {
  context: V2TuiContext;
  sessionID: string;
  stateRoot: string;
}) {
  const [goal, setGoal] = createSignal<GoalState>();
  const [now, setNow] = createSignal(Date.now());
  let requestID = 0;

  const refresh = async (): Promise<void> => {
    const currentRequest = ++requestID;
    const session = props.context.data.session.get(props.sessionID);
    if (!session) {
      setGoal(undefined);
      return;
    }
    const next = await loadSessionGoal(props.stateRoot, {
      id: session.id,
      projectID: session.projectID,
      directory: session.location.directory,
    });
    if (currentRequest === requestID) setGoal(next);
  };

  createEffect(() => {
    props.context.data.session.get(props.sessionID);
    void refresh();
  });

  const unsubscribe = props.context.data.on("session.idle", (event) => {
    if (event.data?.sessionID === props.sessionID) void refresh();
  });
  const interval = setInterval(() => {
    setNow(Date.now());
    if (goal()?.status === "active") void refresh();
  }, ACTIVE_POLL_MS);

  onCleanup(() => {
    requestID += 1;
    clearInterval(interval);
    unsubscribe();
  });

  const limits = createMemo(() => {
    const current = goal();
    return current ? goalLimitProgress(current) : [];
  });

  return (
    <Show when={goal()}>
      {(current) => (
        <box>
          <text>
            <b>Goal</b> · {goalStatusLabel(current().status)}
          </text>
          <text>{snippet(current().objective, 160)}</text>
          <Show
            when={limits().length > 0}
            fallback={
              <text>
                {current().turns.toLocaleString()} turns ·{" "}
                {compactCount(current().tokensUsed)} tokens
              </text>
            }
          >
            <For each={limits()}>
              {(limit) => (
                <text>
                  {limit.label} [{limit.bar}] {compactCount(limit.used)} /{" "}
                  {compactCount(limit.total)} ({limit.percent}%)
                </text>
              )}
            </For>
          </Show>
          <text>
            {formatDuration(goalElapsedMilliseconds(current(), now()))} elapsed
          </text>
          <Show when={current().lastReason}>
            {(reason) => <text>Last: {snippet(reason(), 160)}</text>}
          </Show>
        </box>
      )}
    </Show>
  );
}

async function runV2GoalCommand(
  context: V2TuiContext,
  options: ResolvedGoalPluginOptions,
  rawInput: string | undefined,
): Promise<void> {
  const route = context.ui.router.current();
  if (route.type !== "session" || !route.sessionID) return;
  const session = context.data.session.get(route.sessionID);
  if (!session) return;

  const root = options.stateDirectory ?? defaultStateRoot();
  const store = new FileGoalStore(
    scopedStateDirectory(root, session.projectID, session.location.directory),
  );
  const raw = (rawInput ?? "").replace(/^\/goal\b/i, "").trim();
  const parsed = parseGoalCommand(raw, options);
  let prompt: string;

  if (parsed.action === "status") {
    prompt = statusPrompt(await store.get(route.sessionID));
  } else if (parsed.action === "help") {
    prompt = helpPrompt();
  } else if (parsed.action === "invalid") {
    prompt = actionPrompt(parsed.message);
  } else if (parsed.action === "clear") {
    await store.clear(route.sessionID);
    prompt = actionPrompt("The session goal was cleared.");
  } else {
    const current = await store.get(route.sessionID);
    if (parsed.action === "pause") {
      if (!current || current.status !== "active") {
        prompt = actionPrompt("There is no active goal to pause.");
      } else {
        const paused: GoalState = {
          ...current,
          status: "paused",
          updatedAt: Date.now(),
          lastReason: "Paused by the user.",
        };
        await store.set(paused);
        prompt = actionPrompt("The session goal is paused.");
      }
    } else if (parsed.action === "resume") {
      if (!current) {
        prompt = actionPrompt("There is no goal to resume.");
      } else if (current.status === "complete") {
        prompt = actionPrompt(
          "The previous goal is complete. Set a new goal to do more work.",
        );
      } else {
        const resumed: GoalState = {
          ...current,
          status: "active",
          updatedAt: Date.now(),
          lastReason: "Resumed by the user.",
        };
        await store.set(resumed);
        prompt = continuationPrompt(resumed);
      }
    } else {
      const goal = createGoalState({
        sessionID: route.sessionID,
        directory: session.location.directory,
        objective: parsed.objective,
        ...(parsed.tokenBudget ? { tokenBudget: parsed.tokenBudget } : {}),
        ...(parsed.maxTurns ? { maxTurns: parsed.maxTurns } : {}),
      });
      await store.set(goal);
      prompt = startingPrompt(goal);
    }
  }

  await context.client.session
    .prompt({ sessionID: route.sessionID, text: prompt })
    .catch(() => undefined);
}

async function setupV2Tui(value: unknown): Promise<() => void> {
  const context = value as V2TuiContext;
  const options = resolveOptions(
    context.options as Record<string, unknown> | undefined,
  );
  const stateRoot = options.stateDirectory ?? defaultStateRoot();
  context.keymap.layer(() => ({
    commands: [
      {
        id: "opencode-goal.goal",
        title: "Goal",
        description: "Set, inspect, pause, resume, or clear a persistent goal",
        slash: { name: "goal", aliases: ["g"], arguments: true },
        run: (input) => runV2GoalCommand(context, options, input),
      },
    ],
  }));
  return context.ui.slot({
    append: "sidebar.content",
    render: (props) => (
      <V2GoalSidebar
        context={context}
        sessionID={props.sessionID}
        stateRoot={stateRoot}
      />
    ),
  });
}

const tui: TuiPlugin = async (api, rawOptions) => {
  const options = resolveOptions(rawOptions);
  const stateRoot = options.stateDirectory ?? defaultStateRoot();

  api.slots.register({
    order: 450,
    slots: {
      sidebar_content(_context, props) {
        return (
          <GoalSidebar
            api={api}
            sessionID={props.session_id}
            stateRoot={stateRoot}
          />
        );
      },
    },
  });
};

const plugin: TuiPluginModule & {
  id: string;
  setup: (context: unknown) => Promise<() => void>;
} = {
  id: PLUGIN_ID,
  tui,
  setup: setupV2Tui,
};

export default plugin;
