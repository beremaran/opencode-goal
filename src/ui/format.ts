import type {GoalState, GoalStatus} from "../core/types.js";

export type GoalLimitProgress = {
    label: "Turns" | "Tokens";
    used: number;
    total: number;
    percent: number;
    bar: string;
};

const STATUS_LABELS: Record<GoalStatus, string> = {
    active: "active",
    paused: "paused",
    complete: "complete",
    blocked: "blocked",
    budget_limited: "token limit",
    turn_limited: "turn limit",
};

export function goalStatusLabel(status: GoalStatus): string {
    return STATUS_LABELS[status];
}

export function compactCount(value: number): string {
    if (value < 1_000) return value.toLocaleString();

    const divisor = value < 1_000_000 ? 1_000 : 1_000_000;
    const suffix = value < 1_000_000 ? "k" : "m";
    const scaled = value / divisor;
    const digits = scaled < 10 && !Number.isInteger(scaled) ? 1 : 0;
    return `${scaled.toFixed(digits)}${suffix}`;
}

export function progressBar(used: number, total: number, width = 10): string {
    const ratio = total > 0 ? Math.min(Math.max(used / total, 0), 1) : 0;
    const filled = Math.round(ratio * width);
    return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
}

function limitProgress(
    label: GoalLimitProgress["label"],
    used: number,
    total: number,
): GoalLimitProgress {
    return {
        label,
        used,
        total,
        percent: Math.min(Math.round((used / total) * 100), 100),
        bar: progressBar(used, total),
    };
}

export function goalLimitProgress(goal: GoalState): GoalLimitProgress[] {
    const limits: GoalLimitProgress[] = [];
    if (goal.maxTurns !== undefined) {
        limits.push(limitProgress("Turns", goal.turns, goal.maxTurns));
    }
    if (goal.tokenBudget !== undefined) {
        limits.push(limitProgress("Tokens", goal.tokensUsed, goal.tokenBudget));
    }
    return limits;
}

export function goalElapsedMilliseconds(
    goal: GoalState,
    now = Date.now(),
): number {
    const stoppedAt =
        goal.status === "active" ? now : (goal.completedAt ?? goal.updatedAt);
    return Math.max(stoppedAt - goal.createdAt, 0);
}

export function snippet(value: string, maxLength = 120): string {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, Math.max(maxLength - 1, 0)).trimEnd()}…`;
}
