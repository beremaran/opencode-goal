import type {GoalState, GoalStatus} from "../core/types.js";

const STATUS_LABELS: Record<GoalStatus, string> = {
    active: "active",
    paused: "paused",
    complete: "complete",
    blocked: "blocked",
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
