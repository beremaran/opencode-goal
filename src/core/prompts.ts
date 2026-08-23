import {goalSummary} from "./goal.js";
import type {GoalState} from "./types.js";

export function escapeXmlText(input: string): string {
    return input.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function progressContext(goal: GoalState): string {
    return [`turns_used=${goal.turns}`, `tokens_used=${goal.tokensUsed}`].join(" ");
}

export function activeGoalContext(goal: GoalState): string {
    return `<active-goal>
<objective>${escapeXmlText(goal.objective)}</objective>
<progress>${progressContext(goal)}</progress>
</active-goal>

The goal is active. Follow these rules:
- Keep working until the objective is complete.
- Do not claim completion without concrete evidence.
- Call update_goal with status "complete" only when the objective is genuinely complete.
- Call update_goal with status "blocked" only after the same external blocker has prevented progress for at least three goal turns.`;
}

export function startingPrompt(goal: GoalState): string {
    return `<goal>
<objective>${escapeXmlText(goal.objective)}</objective>
<progress>${progressContext(goal)}</progress>
</goal>

Start working on this goal now.

- Keep working until the completion condition is genuinely satisfied.
- Make concrete progress and verify the result.
- Include the strongest practical evidence in your response.
- Do not stop because the work is difficult, lengthy, or would benefit from another turn.
- If the goal is complete, call update_goal with status "complete" and a short, evidence-based reason before ending your turn.
- Mark the goal "blocked" only after the same external blocker has prevented progress for at least three goal turns.`;
}

export function continuationPrompt(goal: GoalState): string {
    return `<goal-continuation>
<objective>${escapeXmlText(goal.objective)}</objective>
<progress>${progressContext(goal)}</progress>
<evaluation>${escapeXmlText(goal.lastReason ?? "The completion condition is not yet established.")}</evaluation>
</goal-continuation>

The goal is still active. Continue working on it.

The last evaluator reason is in <evaluation>. Address it directly.
- Make concrete progress.
- Verify the result.
- Include the evidence in your response.
- Do not repeat your plan or ask whether to continue.
- If the goal is complete, call update_goal with status "complete" and a short, evidence-based reason.
- Mark the goal "blocked" only after the same external blocker has prevented progress for at least three goal turns.`;
}

export function statusPrompt(goal: GoalState | undefined): string {
    if (!goal) {
        return "Report that there is no goal for this session. Do not start unrelated work.";
    }
    return `Report the current goal status briefly. Do not start unrelated work:

${goalSummary(goal)}`;
}

export function helpPrompt(): string {
    return `Explain this plugin's /goal commands briefly:

/goal <completion condition>
/goal
/goal pause
/goal resume
/goal clear

Mention that an independent evaluator checks active goals after each turn. Active goals continue automatically until they are complete, paused, cleared, or blocked.`;
}

export function actionPrompt(message: string): string {
    return `Tell the user: ${message}

Do not start unrelated work.`;
}

export const EVALUATOR_SYSTEM_PROMPT = `You are an independent evaluator for a long-running coding goal.

Decide whether the completion condition is fully satisfied using only evidence in the transcript.
- Do not call tools.
- Do not assume unreported work succeeded.
- If the condition requires tests, builds, or checks, require transcript evidence that they ran and passed.
- If any required work remains, set "complete" to false.

Return exactly one JSON object with no markdown:
{"complete":false,"reason":"one short, actionable sentence"}`;

export function evaluatorPrompt(goal: GoalState, transcript: string): string {
    const claim = goal.completionClaim
        ? `\nThe working agent claimed completion: ${goal.completionClaim.reason}\n`
        : "";
    return `<completion-condition>
${escapeXmlText(goal.objective)}
</completion-condition>
${claim}
<transcript>
${transcript}
</transcript>

Check whether the completion condition is fully satisfied. Return the required JSON object.`;
}
