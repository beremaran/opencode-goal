import {createGoalState, remainingTokens} from "./lifecycle.js";
import {
  activeGoalContext,
  budgetLimitPrompt,
  continuationPrompt,
  EVALUATOR_SYSTEM_PROMPT,
  evaluatorPrompt,
} from "./prompts.js";
import {resolveOptions} from "./options.js";
import {defaultStateRoot, FileGoalStore, scopedStateDirectory,} from "./state.js";
import {buildTranscript, latestAssistant, totalGoalTokens,} from "./transcript.js";
import type {
  EvaluationDecision,
  GoalState,
  ModelRef,
  ResolvedGoalPluginOptions,
  TranscriptMessage,
  TranscriptPart,
} from "./types.js";
import {parseEvaluation, parseModelRef} from "./evaluator.js";

type V2Model = {
    providerID: string;
    id: string;
    variant?: string;
};

type V2SessionInfo = {
    id: string;
    projectID: string;
    model?: V2Model;
    agent?: string;
    location: { directory: string };
};

type V2SessionDomain = {
    create(input: Record<string, unknown>): Promise<V2SessionInfo>;
    get(input: { sessionID: string }): Promise<V2SessionInfo>;
    generate(input: {
        sessionID: string;
        prompt: string;
    }): Promise<{ text: string }>;
    prompt(input: { sessionID: string; text: string }): Promise<unknown>;
    hook(
        name: "context",
        callback: (event: {
            sessionID: string;
            system: Array<{ type: "text"; text: string }>;
            messages: unknown[];
            tools: Record<string, unknown>;
        }) => Promise<void> | void,
    ): Promise<unknown>;
    remove?: (input: { sessionID: string }) => Promise<void>;
};

type V2Event = {
    type: string;
    id?: string;
    created?: number;
    data?: Record<string, unknown>;
};

type V2Context = {
    options: Readonly<Record<string, unknown>>;
    session: V2SessionDomain;
    event: {
        subscribe(options?: { signal?: AbortSignal }): AsyncIterable<V2Event>;
    };
    tool: {
        transform(
            callback: (draft: { add(tool: V2ToolDefinition): void }) => void,
        ): Promise<unknown>;
    };
};

type V2ToolContext = {
    sessionID: string;
    messageID: string;
    agent: string;
    id: string;
    progress(update: Record<string, unknown>): Promise<void>;
};

type V2ToolResult = {
    content: string;
};

type V2ToolDefinition = {
    name: string;
    description: string;
    input: Record<string, unknown>;
    options?: {
        codemode?: boolean;
    };
    execute(
        input: Record<string, unknown>,
        context: V2ToolContext,
    ): Promise<V2ToolResult>;
};

type TranscriptTracker = {
    messages: Map<string, TranscriptMessage>;
    toolNames: Map<string, string>;
    toolParts: Map<string, TranscriptPart>;
};

function asContext(value: unknown): V2Context {
    return value as V2Context;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === "object" && value !== null
        ? (value as Record<string, unknown>)
        : undefined;
}

function stringValue(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value)
        ? value
        : undefined;
}

function v2Model(value: unknown): ModelRef | undefined {
    const record = asRecord(value);
    const providerID = stringValue(record?.providerID);
    const modelID = stringValue(record?.id) ?? stringValue(record?.modelID);
    if (!providerID || !modelID) return undefined;
    return {providerID, modelID};
}

function modelForV2(value: ModelRef | undefined): V2Model | undefined {
    if (!value) return undefined;
    return {providerID: value.providerID, id: value.modelID};
}

function eventSessionID(event: V2Event): string | undefined {
    return stringValue(event.data?.sessionID);
}

function eventTime(event: V2Event): number {
    return numberValue(event.created) ?? Date.now();
}

function trackerFor(
    trackers: Map<string, TranscriptTracker>,
    sessionID: string,
): TranscriptTracker {
    const current = trackers.get(sessionID);
    if (current) return current;
    const created: TranscriptTracker = {
        messages: new Map(),
        toolNames: new Map(),
        toolParts: new Map(),
    };
    trackers.set(sessionID, created);
    return created;
}

function assistantFor(
    tracker: TranscriptTracker,
    event: V2Event,
): TranscriptMessage | undefined {
    const data = event.data;
    const id = stringValue(data?.assistantMessageID);
    if (!id) return undefined;
    const existing = tracker.messages.get(id);
    if (existing) return existing;

    const info: TranscriptMessage["info"] = {
        id,
        role: "assistant",
        time: {created: eventTime(event)},
    };
    const agent = stringValue(data?.agent);
    const model = v2Model(data?.model);
    if (agent) info.agent = agent;
    if (model) info.model = model;
    const message: TranscriptMessage = {
        info,
        parts: [],
    };
    tracker.messages.set(id, message);
    return message;
}

function addTextPart(message: TranscriptMessage, text: string): void {
    if (!text) return;
    const previous = message.parts.at(-1);
    if (previous?.type === "text") {
        previous.text = `${previous.text ?? ""}${text}`;
        return;
    }
    message.parts.push({type: "text", text});
}

function toolPart(
    message: TranscriptMessage,
    tracker: TranscriptTracker,
    callID: string,
    name?: string,
): TranscriptPart {
    const existing = tracker.toolParts.get(callID);
    if (existing) return existing;

    const tool = name ?? tracker.toolNames.get(callID) ?? "unknown";
    tracker.toolNames.set(callID, tool);
    const part: TranscriptPart = {
        type: "tool",
        tool,
        state: {status: "running"},
    };
    message.parts.push(part);
    tracker.toolParts.set(callID, part);
    return part;
}

function textFromContent(value: unknown): string {
    if (!Array.isArray(value)) return "";
    return value
        .map((item) => {
            const record = asRecord(item);
            return record?.type === "text" ? (stringValue(record.text) ?? "") : "";
        })
        .filter(Boolean)
        .join("\n");
}

function captureEvent(
    trackers: Map<string, TranscriptTracker>,
    event: V2Event,
): void {
    const sessionID = eventSessionID(event);
    if (!sessionID) return;
    const tracker = trackerFor(trackers, sessionID);
    const data = event.data ?? {};

    if (event.type === "session.inbox.enqueued") {
        const item = asRecord(data.item);
        const payload = asRecord(item?.payload);
        if (item?.type !== "user" || !payload) return;
        const text = stringValue(payload.text);
        if (!text) return;
        const id =
            stringValue(data.inboxID) ?? event.id ?? `user-${eventTime(event)}`;
        tracker.messages.set(id, {
            info: {
                id,
                role: "user",
                time: {created: eventTime(event)},
            },
            parts: [{type: "text", text}],
        });
        return;
    }

    if (event.type === "session.step.started") {
        assistantFor(tracker, event);
        return;
    }

    if (event.type === "session.text.delta") {
        const message = assistantFor(tracker, event);
        const text = stringValue(data.delta);
        if (message && text) addTextPart(message, text);
        return;
    }

    if (event.type === "session.text.ended") {
        const message = assistantFor(tracker, event);
        const text = stringValue(data.text);
        if (message && text) {
            const last = message.parts.at(-1);
            if (last?.type === "text") last.text = text;
            else message.parts.push({type: "text", text});
        }
        return;
    }

    if (event.type === "session.tool.input.started") {
        const callID = stringValue(data.id);
        const name = stringValue(data.name);
        if (callID && name) tracker.toolNames.set(callID, name);
        const message = assistantFor(tracker, event);
        if (message && callID) toolPart(message, tracker, callID, name);
        return;
    }

    if (event.type === "session.tool.called") {
        const message = assistantFor(tracker, event);
        const callID = stringValue(data.id);
        if (message && callID) toolPart(message, tracker, callID);
        return;
    }

    if (
        event.type === "session.tool.success" ||
        event.type === "session.tool.failed"
    ) {
        const message = assistantFor(tracker, event);
        const callID = stringValue(data.id);
        if (!message || !callID) return;
        const part = toolPart(message, tracker, callID);
        const state = part.state ?? {};
        if (event.type === "session.tool.success") {
            state.status = "completed";
            const output = textFromContent(data.content);
            if (output) state.output = output;
        } else {
            state.status = "error";
            const error = asRecord(data.error);
            const messageText = stringValue(error?.message);
            if (messageText) state.error = messageText;
        }
        part.state = state;
        return;
    }

    if (event.type === "session.step.ended") {
        const message = assistantFor(tracker, event);
        if (!message) return;
        const tokens = asRecord(data.tokens);
        if (tokens) {
            const input = numberValue(tokens.input) ?? 0;
            const output = numberValue(tokens.output) ?? 0;
            const reasoning = numberValue(tokens.reasoning) ?? 0;
            message.info.tokens = {
                input,
                output,
                reasoning,
                cache: {
                    read: numberValue(asRecord(tokens.cache)?.read) ?? 0,
                    write: numberValue(asRecord(tokens.cache)?.write) ?? 0,
                },
            };
        }
    }
}

function liveMessages(
    trackers: Map<string, TranscriptTracker>,
    sessionID: string,
): TranscriptMessage[] {
    return [...(trackers.get(sessionID)?.messages.values() ?? [])].sort(
        (a, b) => a.info.time.created - b.info.time.created,
    );
}

function mergeMessages(
    saved: TranscriptMessage[] | undefined,
    live: TranscriptMessage[],
): TranscriptMessage[] {
    const byID = new Map<string, TranscriptMessage>();
    for (const message of saved ?? []) byID.set(message.info.id, message);
    for (const message of live) byID.set(message.info.id, message);
    return [...byID.values()].sort(
        (a, b) => a.info.time.created - b.info.time.created,
    );
}

function statusPayload(goal: GoalState | undefined): string {
    if (!goal) return JSON.stringify({goal: null});
    return JSON.stringify(
        {goal, remainingTokens: remainingTokens(goal) ?? null},
        null,
        2,
    );
}

async function sessionStore(
    context: V2Context,
    sessionID: string,
    options: ResolvedGoalPluginOptions,
): Promise<{ store: FileGoalStore; session: V2SessionInfo }> {
    const session = await context.session.get({sessionID});
    const root = options.stateDirectory ?? defaultStateRoot();
    return {
        store: new FileGoalStore(
            scopedStateDirectory(root, session.projectID, session.location.directory),
        ),
        session,
    };
}

function evaluatorModel(
    configured: string | undefined,
    session: V2SessionInfo,
): ModelRef | undefined {
    return parseModelRef(configured) ?? v2Model(session.model);
}

async function evaluateGoalV2(
    context: V2Context,
    parent: V2SessionInfo,
    goal: GoalState,
    messages: TranscriptMessage[],
    options: ResolvedGoalPluginOptions,
): Promise<EvaluationDecision> {
    const transcript = buildTranscript(
        messages,
        goal.createdAt,
        options.maxTranscriptChars,
        goal.startedMessageID,
    );
    const model = evaluatorModel(options.evaluatorModel, parent);

    let evaluator: V2SessionInfo;
    try {
        evaluator = await context.session.create({
            title: `[goal evaluator] ${goal.objective.slice(0, 60)}`,
            location: {directory: parent.location.directory},
            ...(options.evaluatorAgent ? {agent: options.evaluatorAgent} : {}),
            ...(model ? {model: modelForV2(model)} : {}),
        });
    } catch {
        return {
            complete: false,
            reason:
                "Completion evaluation could not start; continue and surface clearer verification evidence.",
            error: true,
        };
    }

    try {
        const response = await context.session.generate({
            sessionID: evaluator.id,
            prompt: `${EVALUATOR_SYSTEM_PROMPT}\n\n${evaluatorPrompt(goal, transcript)}`,
        });
        const parsed = parseEvaluation(response.text);
        return (
            parsed ?? {
                complete: false,
                reason:
                    "The evaluator returned no valid decision; continue and surface explicit completion evidence.",
                error: true,
            }
        );
    } catch {
        return {
            complete: false,
            reason:
                "Completion evaluation failed; continue and surface explicit verification evidence.",
            error: true,
        };
    } finally {
        if (options.deleteEvaluatorSessions && context.session.remove) {
            await context.session
                .remove({sessionID: evaluator.id})
                .catch(() => undefined);
        }
    }
}

async function continueParent(
    context: V2Context,
    goal: GoalState,
    text: string,
): Promise<void> {
    await context.session
        .prompt({
            sessionID: goal.sessionID,
            text,
        })
        .catch(() => undefined);
}

async function handleIdle(
    context: V2Context,
    sessionID: string,
    options: ResolvedGoalPluginOptions,
    trackers: Map<string, TranscriptTracker>,
    processing: Set<string>,
): Promise<void> {
    if (processing.has(sessionID)) return;
    processing.add(sessionID);
    try {
        const {store, session} = await sessionStore(context, sessionID, options);
        const goal = await store.get(sessionID);
        if (!goal || goal.status !== "active") return;

        const messages = mergeMessages(
            goal.transcript,
            liveMessages(trackers, sessionID),
        );
        const assistant = latestAssistant(
            messages,
            goal.createdAt,
            goal.startedMessageID,
        );
        if (!assistant || assistant.info.id === goal.lastEvaluatedMessageID) return;

        const progress: GoalState = {
            ...goal,
            transcript: messages,
            turns: goal.turns + 1,
            tokensUsed: totalGoalTokens(
                messages,
                goal.createdAt,
                goal.startedMessageID,
            ),
            updatedAt: Date.now(),
            lastEvaluatedMessageID: assistant.info.id,
        };
        await store.set(progress);

        const decision = await evaluateGoalV2(
            context,
            session,
            progress,
            messages,
            options,
        );
        const current = await store.get(sessionID);
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
            await store.set(paused);
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
            await store.set(completed);
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
            await store.set(limited);
            await continueParent(context, limited, budgetLimitPrompt(limited));
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
            await store.set(limited);
            await continueParent(context, limited, budgetLimitPrompt(limited));
            return;
        }

        const continuing: GoalState = {
            ...current,
            lastReason: decision.reason,
            updatedAt: Date.now(),
        };
        delete continuing.completionClaim;
        await store.set(continuing);
        if (options.continuationDelayMs > 0) {
            await new Promise<void>((resolve) =>
                setTimeout(resolve, options.continuationDelayMs),
            );
        }
        const latest = await store.get(sessionID);
        if (
            !latest ||
            latest.goalId !== continuing.goalId ||
            latest.status !== "active"
        ) {
            return;
        }
        await continueParent(context, latest, continuationPrompt(latest));
    } finally {
        processing.delete(sessionID);
    }
}

async function pauseAfterInterrupt(
    context: V2Context,
    sessionID: string,
    options: ResolvedGoalPluginOptions,
): Promise<void> {
    const {store} = await sessionStore(context, sessionID, options);
    const goal = await store.get(sessionID);
    if (!goal || goal.status !== "active") return;
    await store.set({
        ...goal,
        status: "paused",
        updatedAt: Date.now(),
        lastReason: "Paused because the session was interrupted.",
    });
}

function inputSchema(properties: Record<string, unknown>, required: string[]) {
    return {
        type: "object",
        properties,
        required,
        additionalProperties: false,
    };
}

function result(content: string): V2ToolResult {
    return {content};
}

async function registerTools(
    context: V2Context,
    options: ResolvedGoalPluginOptions,
    trackers: Map<string, TranscriptTracker>,
): Promise<void> {
    await context.tool.transform((tools) => {
        tools.add({
            name: "create_goal",
            description:
                "Create a persistent goal for this session only when the user explicitly requests one. Fails if an unfinished goal already exists.",
            input: inputSchema(
                {
                    objective: {
                        type: "string",
                        minLength: 1,
                        description: "The concrete condition that makes the goal complete",
                    },
                    token_budget: {
                        type: "integer",
                        minimum: 1,
                        description: "Optional token budget",
                    },
                    max_turns: {
                        type: "integer",
                        minimum: 1,
                        description: "Optional maximum number of goal turns",
                    },
                },
                ["objective"],
            ),
            options: {codemode: false},
            async execute(input, toolContext) {
                const {store, session} = await sessionStore(
                    context,
                    toolContext.sessionID,
                    options,
                );
                const current = await store.get(toolContext.sessionID);
                if (current && current.status !== "complete") {
                    return result(
                        `Goal creation rejected: an unfinished goal is already ${current.status}. Continue it, or ask the user to clear it before replacing it.`,
                    );
                }

                const objective = stringValue(input.objective)?.trim();
                if (!objective)
                    return result("Goal creation rejected: objective is required.");
                const tokenBudget =
                    numberValue(input.token_budget) ?? options.defaultTokenBudget;
                const maxTurns =
                    numberValue(input.max_turns) ?? options.defaultMaxTurns;
                const messageID = toolContext.messageID;
                const goal = createGoalState({
                    sessionID: toolContext.sessionID,
                    directory: session.location.directory,
                    objective,
                    startedMessageID: messageID,
                    ...(tokenBudget ? {tokenBudget} : {}),
                    ...(maxTurns ? {maxTurns} : {}),
                });
                const messages = liveMessages(trackers, toolContext.sessionID);
                if (messages.length > 0) goal.transcript = messages;
                await store.set(goal);
                return result(
                    `Goal created. Continue working toward it until it is complete or genuinely blocked.\n${statusPayload(goal)}`,
                );
            },
        });

        tools.add({
            name: "get_goal",
            description:
                "Get the current persistent goal for this session, including status, budgets, usage, and the latest evaluator reason.",
            input: inputSchema({}, []),
            options: {codemode: false},
            async execute(_input, toolContext) {
                const {store} = await sessionStore(
                    context,
                    toolContext.sessionID,
                    options,
                );
                return result(statusPayload(await store.get(toolContext.sessionID)));
            },
        });

        tools.add({
            name: "update_goal",
            description:
                'Claim completion for independent verification, or mark a repeated external blocker after at least three goal turns. Status must be "complete" or "blocked".',
            input: inputSchema(
                {
                    status: {type: "string", enum: ["complete", "blocked"]},
                    reason: {type: "string", minLength: 1},
                },
                ["status", "reason"],
            ),
            options: {codemode: false},
            async execute(input, toolContext) {
                const {store} = await sessionStore(
                    context,
                    toolContext.sessionID,
                    options,
                );
                const goal = await store.get(toolContext.sessionID);
                if (!goal) return result("No goal exists for this session.");
                if (goal.status !== "active") {
                    return result(
                        `The goal is ${goal.status}, so it cannot be updated by the model.`,
                    );
                }

                const status = stringValue(input.status);
                const reason = stringValue(input.reason)?.trim();
                if (!reason || (status !== "complete" && status !== "blocked")) {
                    return result(
                        "Goal update rejected: status and reason are required.",
                    );
                }
                if (status === "blocked" && goal.turns < 2) {
                    return result(
                        `Blocked status rejected: only ${goal.turns + 1} goal turn(s) have run.`,
                    );
                }
                if (status === "blocked") {
                    const blocked: GoalState = {
                        ...goal,
                        status: "blocked",
                        updatedAt: Date.now(),
                        lastReason: reason,
                    };
                    await store.set(blocked);
                    return result(statusPayload(blocked));
                }
                const claimed: GoalState = {
                    ...goal,
                    updatedAt: Date.now(),
                    completionClaim: {reason, createdAt: Date.now()},
                };
                await store.set(claimed);
                return result(
                    "Completion claim recorded. An independent evaluator will verify it when this turn ends.",
                );
            },
        });
    });
}

export async function setupV2(value: unknown): Promise<() => void> {
    const context = asContext(value);
    const options = resolveV2Options(context.options);
    const trackers = new Map<string, TranscriptTracker>();
    const processing = new Set<string>();

    await registerTools(context, options, trackers);
    await context.session.hook("context", async (event) => {
        try {
            const {store} = await sessionStore(context, event.sessionID, options);
            const goal = await store.get(event.sessionID);
            if (goal?.status === "active") {
                event.system.push({type: "text", text: activeGoalContext(goal)});
            }
        } catch {
            // A disappearing session must not fail a model request.
        }
    });

    const controller = new AbortController();
    const stream = context.event.subscribe({signal: controller.signal});
    const iterator = stream[Symbol.asyncIterator]();
    const consume = async (): Promise<void> => {
        while (!controller.signal.aborted) {
            const next = await iterator.next();
            if (next.done) return;
            const event = next.value;
            captureEvent(trackers, event);
            const sessionID = eventSessionID(event);
            if (!sessionID) continue;

            if (event.type === "session.idle") {
                await handleIdle(
                    context,
                    sessionID,
                    options,
                    trackers,
                    processing,
                ).catch(() => undefined);
            } else if (
                event.type === "session.execution.interrupted" &&
                event.data?.reason === "user"
            ) {
                await pauseAfterInterrupt(context, sessionID, options).catch(
                    () => undefined,
                );
            } else if (event.type === "session.deleted") {
                const {store} = await sessionStore(context, sessionID, options).catch(
                    () => ({store: undefined}),
                );
                await store?.clear(sessionID);
                trackers.delete(sessionID);
            }
        }
    };
    void consume().catch(() => undefined);

    return () => {
        controller.abort();
        void iterator.return?.();
    };
}

function resolveV2Options(
    options: Readonly<Record<string, unknown>>,
): ResolvedGoalPluginOptions {
    return resolveOptions(options as Record<string, unknown>);
}

const v2Plugin = {
    id: "opencode-goal",
    setup: setupV2,
};

export default v2Plugin;
