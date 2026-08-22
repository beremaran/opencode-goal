import {randomUUID} from "node:crypto";
import type {GoalState} from "./types.js";

export type CreateGoalInput = {
    sessionID: string;
    directory: string;
    objective: string;
    startedMessageID?: string;
    now?: number;
    goalId?: string;
};

export function createGoalState(input: CreateGoalInput): GoalState {
    const now = input.now ?? Date.now();
    const state: GoalState = {
        version: 1,
        goalId: input.goalId ?? randomUUID(),
        sessionID: input.sessionID,
        directory: input.directory,
        objective: input.objective.trim(),
        status: "active",
        createdAt: now,
        updatedAt: now,
        turns: 0,
        tokensUsed: 0,
    };
    if (input.startedMessageID) state.startedMessageID = input.startedMessageID;
    return state;
}

export function formatDuration(milliseconds: number): string {
    const seconds = Math.max(Math.floor(milliseconds / 1_000), 0);
    const hours = Math.floor(seconds / 3_600);
    const minutes = Math.floor((seconds % 3_600) / 60);
    const rest = seconds % 60;

    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${rest}s`;
    return `${rest}s`;
}

export function goalSummary(goal: GoalState, now = Date.now()): string {
    const reason = goal.lastReason ? `\nLast evaluation: ${goal.lastReason}` : "";

    return (
        [
            `Goal status: ${goal.status}`,
            `Objective: ${goal.objective}`,
            `Progress: ${goal.turns} turns; ${goal.tokensUsed.toLocaleString()} tokens; ${formatDuration(now - goal.createdAt)} elapsed`,
        ].join("\n") + reason
    );
}
