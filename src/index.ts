import {z} from "zod";
import type {Plugin, PluginInput, ToolContext, ToolResult,} from "@opencode-ai/plugin";
import {evaluateGoal} from "./evaluator.js";
import {createGoalState, remainingTokens} from "./lifecycle.js";
import {parseGoalCommand, resolveOptions} from "./options.js";
import {
  actionPrompt,
  activeGoalContext,
  budgetLimitPrompt,
  continuationPrompt,
  helpPrompt,
  startingPrompt,
  statusPrompt,
} from "./prompts.js";
import {defaultStateRoot, FileGoalStore, scopedStateDirectory,} from "./state.js";
import {latestAssistant, latestUserExecution, totalGoalTokens,} from "./transcript.js";
import type {GoalState, ResolvedGoalPluginOptions, TranscriptMessage,} from "./types.js";

const SERVICE = "opencode-goal";

// Keep the V1 implementation free of a runtime import from
// @opencode-ai/plugin. OpenCode 2 resolves that package to its V2 runtime,
// which intentionally has a different root export. The V1 helper is a thin
// structural equivalent of the package's tool() helper.
const tool = Object.assign(
    <Args extends z.ZodRawShape>(input: {
        description: string;
        args: Args;
        execute(
            args: z.infer<z.ZodObject<Args>>,
            context: ToolContext,
        ): Promise<ToolResult>;
    }) => input,
    {schema: z},
);

function replaceTextPart(
    parts: Array<{ type: string; text?: string }>,
    text: string,
): void {
    const part = parts.find((candidate) => candidate.type === "text");
    if (!part)
        throw new Error("The /goal command template did not produce a text part");
    part.text = text;
}

function asTranscriptMessages(value: unknown): TranscriptMessage[] {
    return Array.isArray(value) ? (value as TranscriptMessage[]) : [];
}

function statusPayload(goal: GoalState | undefined): string {
    if (!goal) return JSON.stringify({goal: null});
    return JSON.stringify(
        {
            goal,
            remainingTokens: remainingTokens(goal) ?? null,
        },
        null,
        2,
    );
}

async function sleep(milliseconds: number): Promise<void> {
    if (milliseconds <= 0) return;
    await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

type Logger = (
    level: "debug" | "info" | "warn" | "error",
    message: string,
    extra?: Record<string, unknown>,
) => Promise<void>;

function createLogger(client: PluginInput["client"]): Logger {
    return async (level, message, extra) => {
        await client.app
            .log({
                body: {
                    service: SERVICE,
                    level,
                    message,
                    ...(extra ? {extra} : {}),
                },
            })
            .catch(() => undefined);
    };
}

async function showToast(
    client: PluginInput["client"],
    message: string,
    variant: "info" | "success" | "warning" | "error",
): Promise<void> {
    await client.tui
        .showToast({
            body: {
                title: "Goal",
                message,
                variant,
                duration: 6_000,
            },
        })
        .catch(() => undefined);
}

function isParentBusy(statuses: unknown, sessionID: string): boolean {
    if (typeof statuses !== "object" || statuses === null) return false;
    const status = (statuses as Record<string, { type?: string }>)[sessionID];
    return Boolean(status && status.type !== "idle");
}

async function continueParent(
    client: PluginInput["client"],
    goal: GoalState,
    messages: TranscriptMessage[],
    text: string,
    log: Logger,
): Promise<void> {
    try {
        const status = await client.session.status();
        if (isParentBusy(status.data, goal.sessionID)) {
            await log(
                "debug",
                "Skipped continuation because the parent session is busy",
                {
                    sessionID: goal.sessionID,
                },
            );
            return;
        }
    } catch {
        // The status endpoint is an optimization; promptAsync remains authoritative.
    }

    const execution = latestUserExecution(messages);
    const body: {
        parts: Array<{ type: "text"; text: string }>;
        agent?: string;
        model?: { providerID: string; modelID: string };
    } = {
        parts: [{type: "text", text}],
    };
    if (execution.agent) body.agent = execution.agent;
    if (execution.model) body.model = execution.model;

    const response = await client.session.promptAsync({
        path: {id: goal.sessionID},
        body,
    });
    if (response.error) {
        await log("error", "OpenCode rejected an automatic goal continuation", {
            sessionID: goal.sessionID,
            error: String(response.error),
        });
    }
}

async function handleIdle(input: {
    client: PluginInput["client"];
    store: FileGoalStore;
    sessionID: string;
    options: ResolvedGoalPluginOptions;
    processing: Set<string>;
    log: Logger;
}): Promise<void> {
    if (input.processing.has(input.sessionID)) return;
    input.processing.add(input.sessionID);

    try {
        const goal = await input.store.get(input.sessionID);
        if (!goal || goal.status !== "active") return;

        const response = await input.client.session.messages({
            path: {id: input.sessionID},
        });
        if (response.error) {
            await input.log("error", "Failed to read goal session messages", {
                sessionID: input.sessionID,
                error: String(response.error),
            });
            return;
        }

        const messages = asTranscriptMessages(response.data);
        const assistant = latestAssistant(
            messages,
            goal.createdAt,
            goal.startedMessageID,
        );
        if (!assistant || assistant.info.id === goal.lastEvaluatedMessageID) return;

        const progress: GoalState = {
            ...goal,
            turns: goal.turns + 1,
            tokensUsed: totalGoalTokens(
                messages,
                goal.createdAt,
                goal.startedMessageID,
            ),
            updatedAt: Date.now(),
            lastEvaluatedMessageID: assistant.info.id,
        };

        await input.store.set(progress);
        const decision = await evaluateGoal({
            client: input.client,
            parentSessionID: input.sessionID,
            goal: progress,
            messages,
            options: input.options,
        });

        const current = await input.store.get(input.sessionID);
        if (
            !current ||
            current.goalId !== progress.goalId ||
            current.status !== "active"
        ) {
            return;
        }

        if (decision.error) {
            const paused: GoalState = {
                ...current,
                status: "paused",
                updatedAt: Date.now(),
                lastReason: decision.reason,
            };
            delete paused.completionClaim;
            await input.store.set(paused);
            await input.log(
                "error",
                "Goal paused because completion evaluation failed",
                {
                    sessionID: paused.sessionID,
                    reason: decision.reason,
                },
            );
            await showToast(input.client, "Goal paused: evaluator failed", "error");
            return;
        }

        if (decision.complete) {
            const completed: GoalState = {
                ...current,
                status: "complete",
                completedAt: Date.now(),
                updatedAt: Date.now(),
                lastReason: decision.reason,
            };
            delete completed.completionClaim;
            await input.store.set(completed);
            await input.log("info", "Goal completed", {
                sessionID: completed.sessionID,
                turns: completed.turns,
                tokensUsed: completed.tokensUsed,
            });
            await showToast(
                input.client,
                `Goal complete: ${decision.reason}`,
                "success",
            );
            return;
        }

        if (
            current.tokenBudget !== undefined &&
            current.tokensUsed >= current.tokenBudget
        ) {
            const limited: GoalState = {
                ...current,
                status: "budget_limited",
                updatedAt: Date.now(),
                lastReason: `Token budget reached (${current.tokensUsed.toLocaleString()} / ${current.tokenBudget.toLocaleString()}). Last evaluation: ${decision.reason}`,
            };
            delete limited.completionClaim;
            await input.store.set(limited);
            await showToast(
                input.client,
                "Goal stopped at its token budget",
                "warning",
            );
            await continueParent(
                input.client,
                limited,
                messages,
                budgetLimitPrompt(limited),
                input.log,
            );
            return;
        }

        if (current.maxTurns !== undefined && current.turns >= current.maxTurns) {
            const limited: GoalState = {
                ...current,
                status: "turn_limited",
                updatedAt: Date.now(),
                lastReason: `Turn budget reached (${current.turns} / ${current.maxTurns}). Last evaluation: ${decision.reason}`,
            };
            delete limited.completionClaim;
            await input.store.set(limited);
            await showToast(
                input.client,
                "Goal stopped at its turn budget",
                "warning",
            );
            await continueParent(
                input.client,
                limited,
                messages,
                budgetLimitPrompt(limited),
                input.log,
            );
            return;
        }

        const continuing: GoalState = {
            ...current,
            updatedAt: Date.now(),
            lastReason: decision.reason,
        };
        delete continuing.completionClaim;
        await input.store.set(continuing);
        await sleep(input.options.continuationDelayMs);

        const latest = await input.store.get(input.sessionID);
        if (
            !latest ||
            latest.goalId !== continuing.goalId ||
            latest.status !== "active"
        ) {
            return;
        }
        await continueParent(
            input.client,
            latest,
            messages,
            continuationPrompt(latest),
            input.log,
        );
    } finally {
        input.processing.delete(input.sessionID);
    }
}

const v1GoalPlugin: Plugin = async (input, rawOptions) => {
    const options = resolveOptions(rawOptions);
    const root = options.stateDirectory ?? defaultStateRoot();
    const stateDirectory = scopedStateDirectory(
        root,
        input.project.id,
        input.directory,
    );
    const store = new FileGoalStore(stateDirectory);
    const processing = new Set<string>();
    const controlTurns = new Set<string>();
    const log = createLogger(input.client);

    return {
        config: async (config) => {
            config.command ??= {};
            config.command.goal = {
                description: "Set, inspect, pause, resume, or clear a persistent goal",
                template: "<goal-command>$ARGUMENTS</goal-command>",
            };
        },

        "command.execute.before": async (command, output) => {
            if (command.command !== "goal") return;
            const parsed = parseGoalCommand(command.arguments, options);

            if (parsed.action === "status") {
                controlTurns.add(command.sessionID);
                replaceTextPart(
                    output.parts,
                    statusPrompt(await store.get(command.sessionID)),
                );
                return;
            }
            if (parsed.action === "help") {
                controlTurns.add(command.sessionID);
                replaceTextPart(output.parts, helpPrompt());
                return;
            }
            if (parsed.action === "invalid") {
                controlTurns.add(command.sessionID);
                replaceTextPart(output.parts, actionPrompt(parsed.message));
                return;
            }
            if (parsed.action === "clear") {
                controlTurns.add(command.sessionID);
                await store.clear(command.sessionID);
                replaceTextPart(
                    output.parts,
                    actionPrompt("The session goal was cleared."),
                );
                return;
            }

            const current = await store.get(command.sessionID);
            if (parsed.action === "pause") {
                controlTurns.add(command.sessionID);
                if (!current || current.status !== "active") {
                    replaceTextPart(
                        output.parts,
                        actionPrompt("There is no active goal to pause."),
                    );
                    return;
                }
                const paused: GoalState = {
                    ...current,
                    status: "paused",
                    updatedAt: Date.now(),
                    lastReason: "Paused by the user.",
                };
                await store.set(paused);
                replaceTextPart(
                    output.parts,
                    actionPrompt("The session goal is paused."),
                );
                return;
            }

            if (parsed.action === "resume") {
                if (!current) {
                    replaceTextPart(
                        output.parts,
                        actionPrompt("There is no goal to resume."),
                    );
                    return;
                }
                if (current.status === "complete") {
                    controlTurns.add(command.sessionID);
                    replaceTextPart(
                        output.parts,
                        actionPrompt(
                            "The previous goal is complete. Set a new goal to do more work.",
                        ),
                    );
                    return;
                }
                const resumed: GoalState = {
                    ...current,
                    status: "active",
                    updatedAt: Date.now(),
                    lastReason: "Resumed by the user.",
                };
                await store.set(resumed);
                replaceTextPart(output.parts, continuationPrompt(resumed));
                return;
            }

            const goal = createGoalState({
                sessionID: command.sessionID,
                directory: input.directory,
                objective: parsed.objective,
                ...(parsed.tokenBudget ? {tokenBudget: parsed.tokenBudget} : {}),
                ...(parsed.maxTurns ? {maxTurns: parsed.maxTurns} : {}),
            });
            await store.set(goal);
            replaceTextPart(output.parts, startingPrompt(goal));
        },

        "experimental.chat.system.transform": async ({sessionID}, output) => {
            if (!sessionID || controlTurns.has(sessionID)) return;
            const goal = await store.get(sessionID);
            if (goal?.status === "active")
                output.system.push(activeGoalContext(goal));
        },

        "experimental.session.compacting": async ({sessionID}, output) => {
            const goal = await store.get(sessionID);
            if (goal?.status === "active")
                output.context.push(activeGoalContext(goal));
        },

        tool: {
            create_goal: tool({
                description:
                    "Create a persistent goal for this session only when the user explicitly requests one. Fails if an unfinished goal exists; do not replace or abandon an existing goal.",
                args: {
                    objective: tool.schema
                        .string()
                        .trim()
                        .min(1)
                        .describe(
                            "The concrete condition that will make the goal complete",
                        ),
                    token_budget: tool.schema
                        .number()
                        .int()
                        .positive()
                        .optional()
                        .describe(
                            "Optional token budget; omit unless the user explicitly requested one",
                        ),
                    max_turns: tool.schema
                        .number()
                        .int()
                        .positive()
                        .optional()
                        .describe("Optional maximum number of goal turns"),
                },
                async execute(args, context) {
                    const current = await store.get(context.sessionID);
                    if (current && current.status !== "complete") {
                        return `Goal creation rejected: an unfinished goal is already ${current.status}. Continue it, or ask the user to clear it or explicitly replace it with /goal.`;
                    }

                    const tokenBudget = args.token_budget ?? options.defaultTokenBudget;
                    const maxTurns = args.max_turns ?? options.defaultMaxTurns;
                    const goal = createGoalState({
                        sessionID: context.sessionID,
                        directory: input.directory,
                        objective: args.objective,
                        startedMessageID: context.messageID,
                        ...(tokenBudget ? {tokenBudget} : {}),
                        ...(maxTurns ? {maxTurns} : {}),
                    });
                    await store.set(goal);
                    await showToast(
                        input.client,
                        `Goal created by agent: ${goal.objective.slice(0, 120)}`,
                        "info",
                    );
                    return `Goal created. Continue working toward it until it is complete or genuinely blocked.\n${statusPayload(goal)}`;
                },
            }),
            get_goal: tool({
                description:
                    "Get the current persistent goal for this session, including status, budgets, usage, and the latest evaluator reason.",
                args: {},
                async execute(_args, context) {
                    return statusPayload(await store.get(context.sessionID));
                },
            }),
            update_goal: tool({
                description:
                    'Claim that the active goal is complete for independent verification, or mark it blocked after the same external blocker has prevented progress for at least three goal turns. Status must be "complete" or "blocked".',
                args: {
                    status: tool.schema.enum(["complete", "blocked"]),
                    reason: tool.schema
                        .string()
                        .min(1)
                        .describe(
                            "Concise evidence for completion or the exact repeated blocker",
                        ),
                },
                async execute(args, context) {
                    const goal = await store.get(context.sessionID);
                    if (!goal) return "No goal exists for this session.";
                    if (goal.status !== "active") {
                        return `The goal is ${goal.status}, so it cannot be updated by the model.`;
                    }

                    if (args.status === "blocked") {
                        if (goal.turns < 2) {
                            return `Blocked status rejected: only ${goal.turns + 1} goal turn(s) have run. Continue making progress; the same blocker must recur for at least three turns.`;
                        }
                        const blocked: GoalState = {
                            ...goal,
                            status: "blocked",
                            updatedAt: Date.now(),
                            lastReason: args.reason,
                        };
                        await store.set(blocked);
                        await showToast(
                            input.client,
                            `Goal blocked: ${args.reason}`,
                            "warning",
                        );
                        return statusPayload(blocked);
                    }

                    const claimed: GoalState = {
                        ...goal,
                        updatedAt: Date.now(),
                        completionClaim: {
                            reason: args.reason,
                            createdAt: Date.now(),
                        },
                    };
                    await store.set(claimed);
                    return "Completion claim recorded. An independent evaluator will verify it when this turn ends.";
                },
            }),
        },

        event: async ({event}) => {
            if (event.type === "session.deleted") {
                controlTurns.delete(event.properties.info.id);
                await store.clear(event.properties.info.id);
                return;
            }

            if (
                event.type === "session.error" &&
                event.properties.sessionID &&
                event.properties.error?.name === "MessageAbortedError"
            ) {
                const goal = await store.get(event.properties.sessionID);
                if (goal?.status === "active") {
                    const paused: GoalState = {
                        ...goal,
                        status: "paused",
                        updatedAt: Date.now(),
                        lastReason: "Paused because the session was interrupted.",
                    };
                    await store.set(paused);
                    await showToast(
                        input.client,
                        "Goal paused after interruption",
                        "warning",
                    );
                }
                return;
            }

            if (event.type === "session.idle") {
                controlTurns.delete(event.properties.sessionID);
                await handleIdle({
                    client: input.client,
                    store,
                    sessionID: event.properties.sessionID,
                    options,
                    processing,
                    log,
                });
            }
        },
    };
};

// The package root follows OpenCode 2's object-shaped plugin contract. The
// separate ./server export keeps the callable V1 entrypoint available to the
// OpenCode 1 loader without importing either runtime API until it is used.
export const GoalPlugin = Object.assign(v1GoalPlugin, {
    id: SERVICE,
    setup: async (context: unknown) => {
        const {setupV2} = await import("./v2.js");
        return setupV2(context);
    },
});

const plugin = {
    id: SERVICE,
    server: v1GoalPlugin,
    setup: GoalPlugin.setup,
};

export default plugin;
