import type {GoalCommand, GoalPluginOptions, ResolvedGoalPluginOptions,} from "./types.js";

const DEFAULT_MAX_TRANSCRIPT_CHARS = 48_000;

function positiveInteger(value: unknown): number | undefined {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
        return undefined;
    }
    return value;
}

function nonNegativeInteger(value: unknown): number | undefined {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        return undefined;
    }
    return value;
}

function optionalString(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

export function resolveOptions(
    raw: Record<string, unknown> | undefined,
): ResolvedGoalPluginOptions {
    const input = (raw ?? {}) as GoalPluginOptions;
    const resolved: ResolvedGoalPluginOptions = {
        maxTranscriptChars: Math.max(
            positiveInteger(input.maxTranscriptChars) ?? DEFAULT_MAX_TRANSCRIPT_CHARS,
            1_024,
        ),
        continuationDelayMs: nonNegativeInteger(input.continuationDelayMs) ?? 0,
        deleteEvaluatorSessions: input.deleteEvaluatorSessions !== false,
    };

    const evaluatorModel = optionalString(input.evaluatorModel);
    const evaluatorAgent = optionalString(input.evaluatorAgent);
    const stateDirectory = optionalString(input.stateDirectory);
    if (evaluatorModel) resolved.evaluatorModel = evaluatorModel;
    if (evaluatorAgent) resolved.evaluatorAgent = evaluatorAgent;
    if (stateDirectory) resolved.stateDirectory = stateDirectory;

    return resolved;
}

export function parseGoalCommand(
    rawArguments: string,
): GoalCommand {
    let rest = rawArguments.trim();

    if (!rest) return {action: "status"};
    if (rest === "help" || rest === "--help" || rest === "-h")
        return {action: "help"};
    if (rest === "clear" || rest === "cancel") return {action: "clear"};
    if (rest === "pause") return {action: "pause"};
    if (rest === "resume") return {action: "resume"};

    while (rest.startsWith("--")) {
        return {
            action: "invalid",
            message: `Unknown goal option: ${rest.split(/\s+/, 1)[0] ?? rest}`,
        };
    }

    if (!rest) {
        return {
            action: "invalid",
            message: "A goal needs a concrete completion condition.",
        };
    }

    const result: Extract<GoalCommand, { action: "set" }> = {
        action: "set",
        objective: rest,
    };
    return result;
}
