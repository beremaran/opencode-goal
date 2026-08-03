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
import { formatDuration } from "./lifecycle.js";
import { resolveOptions } from "./options.js";
import { defaultStateRoot } from "./state.js";
import {
  compactCount,
  goalElapsedMilliseconds,
  goalLimitProgress,
  goalStatusLabel,
  snippet,
} from "./tui-format.js";
import { loadSessionGoal } from "./tui-state.js";
import type { GoalState, GoalStatus } from "./types.js";

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

const plugin: TuiPluginModule & { id: string } = {
  id: PLUGIN_ID,
  tui,
};

export default plugin;
