import type { PluginInput } from "@opencode-ai/plugin";
import { EVALUATOR_SYSTEM_PROMPT, evaluatorPrompt } from "./prompts.js";
import { buildTranscript, latestUserExecution } from "./transcript.js";
import type {
  EvaluationDecision,
  GoalState,
  ModelRef,
  ResolvedGoalPluginOptions,
  TranscriptMessage,
} from "./types.js";

type OpenCodeClient = PluginInput["client"];

export function parseModelRef(value: string | undefined): ModelRef | undefined {
  if (!value) return undefined;
  const [providerID, ...modelParts] = value.split("/");
  const modelID = modelParts.join("/");
  if (!providerID || !modelID) return undefined;
  return { providerID, modelID };
}

export function parseEvaluation(text: string): EvaluationDecision | undefined {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i)?.[1];
  const candidate = fenced ?? trimmed.match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) return undefined;

  try {
    const value = JSON.parse(candidate) as Record<string, unknown>;
    if (typeof value.complete !== "boolean") return undefined;
    if (typeof value.reason !== "string" || !value.reason.trim())
      return undefined;
    return { complete: value.complete, reason: value.reason.trim() };
  } catch {
    return undefined;
  }
}

function responseText(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  return parts
    .filter(
      (part): part is { type: "text"; text: string } =>
        typeof part === "object" &&
        part !== null &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string",
    )
    .map((part) => part.text)
    .join("\n");
}

async function evaluatorModel(
  client: OpenCodeClient,
  messages: TranscriptMessage[],
  configured: string | undefined,
): Promise<ModelRef | undefined> {
  const explicit = parseModelRef(configured);
  if (explicit) return explicit;

  try {
    const config = await client.config.get();
    const small = parseModelRef(config.data?.small_model);
    if (small) return small;
  } catch {
    // Fall through to the session model.
  }

  return latestUserExecution(messages).model;
}

export type EvaluateGoalInput = {
  client: OpenCodeClient;
  parentSessionID: string;
  goal: GoalState;
  messages: TranscriptMessage[];
  options: ResolvedGoalPluginOptions;
};

export async function evaluateGoal(
  input: EvaluateGoalInput,
): Promise<EvaluationDecision> {
  const transcript = buildTranscript(
    input.messages,
    input.goal.createdAt,
    input.options.maxTranscriptChars,
  );
  const model = await evaluatorModel(
    input.client,
    input.messages,
    input.options.evaluatorModel,
  );

  const created = await input.client.session.create({
    body: {
      parentID: input.parentSessionID,
      title: `[goal evaluator] ${input.goal.objective.slice(0, 60)}`,
    },
  });
  const evaluatorSessionID = created.data?.id;
  if (!evaluatorSessionID) {
    return {
      complete: false,
      reason:
        "Completion evaluation could not start; continue and surface clearer verification evidence.",
      error: true,
    };
  }

  try {
    const body: {
      system: string;
      tools: Record<string, boolean>;
      parts: Array<{ type: "text"; text: string }>;
      model?: ModelRef;
      agent?: string;
    } = {
      system: EVALUATOR_SYSTEM_PROMPT,
      tools: { "*": false },
      parts: [{ type: "text", text: evaluatorPrompt(input.goal, transcript) }],
    };
    if (model) body.model = model;
    if (input.options.evaluatorAgent) body.agent = input.options.evaluatorAgent;

    const response = await input.client.session.prompt({
      path: { id: evaluatorSessionID },
      body,
    });
    if (response.error) {
      return {
        complete: false,
        reason:
          "Completion evaluation failed because the evaluator model returned an error.",
        error: true,
      };
    }
    const parsed = parseEvaluation(responseText(response.data?.parts));
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
    if (input.options.deleteEvaluatorSessions) {
      await input.client.session
        .delete({ path: { id: evaluatorSessionID } })
        .catch(() => undefined);
    }
  }
}
