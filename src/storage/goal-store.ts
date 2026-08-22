import {createHash, randomUUID} from "node:crypto";
import {homedir} from "node:os";
import path from "node:path";
import {mkdir, readFile, rename, unlink, writeFile} from "node:fs/promises";
import {GOAL_STATUSES, type GoalState} from "../core/types.js";

export interface GoalStore {
    get(sessionID: string): Promise<GoalState | undefined>;

    set(goal: GoalState): Promise<void>;

    clear(sessionID: string): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalPositiveInteger(value: unknown): value is number | undefined {
    return (
        value === undefined || (Number.isSafeInteger(value) && Number(value) > 0)
    );
}

export function parseGoalState(value: unknown): GoalState | undefined {
    if (!isRecord(value)) return undefined;
    if (value.version !== 1) return undefined;
    if (typeof value.goalId !== "string" || !value.goalId) return undefined;
    if (typeof value.sessionID !== "string" || !value.sessionID) return undefined;
    if (typeof value.directory !== "string") return undefined;
    if (typeof value.objective !== "string" || !value.objective.trim())
        return undefined;
    if (
        typeof value.status !== "string" ||
        !GOAL_STATUSES.includes(value.status as GoalState["status"])
    ) {
        return undefined;
    }
    if (!Number.isFinite(value.createdAt) || !Number.isFinite(value.updatedAt)) {
        return undefined;
    }
    if (!Number.isSafeInteger(value.turns) || Number(value.turns) < 0)
        return undefined;
    if (!Number.isSafeInteger(value.tokensUsed) || Number(value.tokensUsed) < 0) {
        return undefined;
    }
    if (!optionalPositiveInteger(value.tokenBudget)) return undefined;
    if (!optionalPositiveInteger(value.maxTurns)) return undefined;
    if (
        value.startedMessageID !== undefined &&
        (typeof value.startedMessageID !== "string" || !value.startedMessageID)
    ) {
        return undefined;
    }
    if (value.transcript !== undefined && !Array.isArray(value.transcript)) {
        return undefined;
    }

    return value as GoalState;
}

function safeSegment(value: string): string {
    if (/^[a-zA-Z0-9._-]+$/.test(value)) return value;
    return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

export function defaultStateRoot(): string {
    const xdg = process.env.XDG_STATE_HOME?.trim();
    return xdg
        ? path.join(xdg, "opencode-goal")
        : path.join(homedir(), ".local", "state", "opencode-goal");
}

export function scopedStateDirectory(
    root: string,
    projectID: string | undefined,
    directory: string,
): string {
    const scope = projectID?.trim() || directory;
    return path.join(root, safeSegment(scope));
}

export class FileGoalStore implements GoalStore {
    constructor(private readonly directory: string) {
    }

    async get(sessionID: string): Promise<GoalState | undefined> {
        try {
            const contents = await readFile(this.file(sessionID), "utf8");
            return parseGoalState(JSON.parse(contents));
        } catch (error) {
            if (isNodeError(error) && error.code === "ENOENT") return undefined;
            return undefined;
        }
    }

    async set(goal: GoalState): Promise<void> {
        await mkdir(this.directory, {recursive: true, mode: 0o700});
        const destination = this.file(goal.sessionID);
        const temporary = `${destination}.${randomUUID()}.tmp`;
        await writeFile(temporary, `${JSON.stringify(goal, null, 2)}\n`, {
            encoding: "utf8",
            mode: 0o600,
        });
        await rename(temporary, destination);
    }

    async clear(sessionID: string): Promise<void> {
        try {
            await unlink(this.file(sessionID));
        } catch (error) {
            if (isNodeError(error) && error.code === "ENOENT") return;
            throw error;
        }
    }

    private file(sessionID: string): string {
        return path.join(this.directory, `${safeSegment(sessionID)}.json`);
    }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error;
}

export class MemoryGoalStore implements GoalStore {
    private readonly values = new Map<string, GoalState>();

    async get(sessionID: string): Promise<GoalState | undefined> {
        return this.values.get(sessionID);
    }

    async set(goal: GoalState): Promise<void> {
        this.values.set(goal.sessionID, structuredClone(goal));
    }

    async clear(sessionID: string): Promise<void> {
        this.values.delete(sessionID);
    }
}
