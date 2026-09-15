import {evaluatorPrompt} from "../core/prompts.js";
import {buildTranscript} from "../core/transcript.js";
import type {EvaluationDecision, GoalState, ModelRef, TranscriptMessage} from "../core/types.js";

export function parseModelRef(value: string | undefined): ModelRef | undefined {
    if (!value) {
        return undefined;
    }

    const [providerID, ...modelParts] = value.split("/");
    const modelID = modelParts.join("/");

    if (!providerID || !modelID) {
        return undefined;
    }

    return {providerID, modelID};
}

export function parseEvaluation(text: string): EvaluationDecision | undefined {
    const trimmed = text.trim();
    const fenced = trimmed.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i)?.[1];
    const candidate = fenced ?? trimmed.match(/\{[\s\S]*\}/)?.[0];

    if (!candidate) {
        return undefined;
    }

    try {
        const value = JSON.parse(candidate) as Record<string, unknown>;
        if (typeof value.complete !== "boolean") {
            return undefined;
        }

        if (typeof value.reason !== "string" || !value.reason.trim()) {
            return undefined;
        }

        return {complete: value.complete, reason: value.reason.trim()};
    } catch {
        return undefined;
    }
}

export async function evaluateTranscript(
    goal: GoalState,
    messages: TranscriptMessage[],
    maxTranscriptChars: number,
    run: (prompt: string) => Promise<string>,
): Promise<EvaluationDecision> {
    const transcript = buildTranscript(messages, goal.createdAt, maxTranscriptChars, goal.startedMessageID);

    try {
        const parsed = parseEvaluation(await run(evaluatorPrompt(goal, transcript)));
        return (
            parsed ?? {
                complete: false,
                reason: "The evaluator returned no valid decision; continue and surface explicit completion evidence.",
                error: true,
            }
        );
    } catch {
        return {
            complete: false,
            reason: "Completion evaluation failed; continue and surface explicit verification evidence.",
            error: true,
        };
    }
}
