import type {
  GoalCommand,
  GoalPluginOptions,
  ResolvedGoalPluginOptions,
} from "./types.js";

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
  const defaultTokenBudget = positiveInteger(input.defaultTokenBudget);
  const defaultMaxTurns = positiveInteger(input.defaultMaxTurns);

  if (evaluatorModel) resolved.evaluatorModel = evaluatorModel;
  if (evaluatorAgent) resolved.evaluatorAgent = evaluatorAgent;
  if (stateDirectory) resolved.stateDirectory = stateDirectory;
  if (defaultTokenBudget) resolved.defaultTokenBudget = defaultTokenBudget;
  if (defaultMaxTurns) resolved.defaultMaxTurns = defaultMaxTurns;

  return resolved;
}

export function parseTokenCount(raw: string): number | undefined {
  const match = raw.trim().match(/^(\d+(?:\.\d+)?)([kKmM])?$/);
  if (!match) return undefined;

  const value = Number(match[1]);
  const suffix = match[2]?.toLowerCase();
  const multiplier = suffix === "k" ? 1_000 : suffix === "m" ? 1_000_000 : 1;
  const result = value * multiplier;

  if (!Number.isSafeInteger(result) || result <= 0) return undefined;
  return result;
}

type SetDefaults = Pick<
  ResolvedGoalPluginOptions,
  "defaultTokenBudget" | "defaultMaxTurns"
>;

export function parseGoalCommand(
  rawArguments: string,
  defaults: SetDefaults,
): GoalCommand {
  let rest = rawArguments.trim();

  if (!rest) return { action: "status" };
  if (rest === "help" || rest === "--help" || rest === "-h")
    return { action: "help" };
  if (rest === "clear" || rest === "cancel") return { action: "clear" };
  if (rest === "pause") return { action: "pause" };
  if (rest === "resume") return { action: "resume" };

  let tokenBudget = defaults.defaultTokenBudget;
  let maxTurns = defaults.defaultMaxTurns;

  while (rest.startsWith("--")) {
    const tokenMatch = rest.match(/^--tokens(?:=|\s+)(\S+)(?:\s+|$)/);
    if (tokenMatch) {
      const parsed = parseTokenCount(tokenMatch[1] ?? "");
      if (!parsed) {
        return {
          action: "invalid",
          message:
            "`--tokens` must be a positive integer, optionally ending in k or m.",
        };
      }
      tokenBudget = parsed;
      rest = rest.slice(tokenMatch[0].length).trim();
      continue;
    }

    const turnsMatch = rest.match(/^--max-turns(?:=|\s+)(\S+)(?:\s+|$)/);
    if (turnsMatch) {
      const parsed = Number(turnsMatch[1]);
      if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        return {
          action: "invalid",
          message: "`--max-turns` must be a positive integer.",
        };
      }
      maxTurns = parsed;
      rest = rest.slice(turnsMatch[0].length).trim();
      continue;
    }

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
  if (tokenBudget) result.tokenBudget = tokenBudget;
  if (maxTurns) result.maxTurns = maxTurns;
  return result;
}
