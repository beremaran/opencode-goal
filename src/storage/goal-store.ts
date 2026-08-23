import {createHash, randomUUID} from "node:crypto";
import {homedir} from "node:os";
import path from "node:path";
import {mkdir, readFile, rename, unlink, writeFile} from "node:fs/promises";
import {z} from "zod";
import {GOAL_STATUSES, type GoalState} from "../core/types.js";

const goalStateSchema = z.object({
    version: z.literal(1),
    goalId: z.string().min(1),
    sessionID: z.string().min(1),
    directory: z.string(),
    objective: z.string().refine((value) => value.trim().length > 0),
    status: z.enum(GOAL_STATUSES),
    createdAt: z.number(),
    updatedAt: z.number(),
    completedAt: z.number().optional().catch(undefined),
    turns: z.int().nonnegative(),
    tokensUsed: z.int().nonnegative(),
    startedMessageID: z.string().min(1).optional(),
    lastEvaluatedMessageID: z.string().optional().catch(undefined),
    lastReason: z.string().optional().catch(undefined),
    completionClaim: z.record(z.string(), z.unknown()).optional().catch(undefined),
    transcript: z.array(z.unknown()).optional().catch(undefined),
});

export function parseGoalState(value: unknown): GoalState | undefined {
    const parsed = goalStateSchema.safeParse(value);
    return parsed.success ? (parsed.data as GoalState) : undefined;
}

function safeSegment(value: string): string {
    if (/^[a-zA-Z0-9._-]+$/.test(value)) {
        return value;
    }
    return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

export function defaultStateRoot(): string {
    const xdg = process.env.XDG_STATE_HOME?.trim();
    return xdg ? path.join(xdg, "opencode-goal") : path.join(homedir(), ".local", "state", "opencode-goal");
}

export function scopedStateDirectory(root: string, projectID: string | undefined, directory: string): string {
    const scope = projectID?.trim() || directory;
    return path.join(root, safeSegment(scope));
}

export class FileGoalStore {
    constructor(private readonly directory: string) {}

    async get(sessionID: string): Promise<GoalState | undefined> {
        try {
            const contents = await readFile(this.file(sessionID), "utf8");
            return parseGoalState(JSON.parse(contents));
        } catch (error) {
            if (isNodeError(error) && error.code === "ENOENT") {
                return undefined;
            }
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
            if (isNodeError(error) && error.code === "ENOENT") {
                return;
            }
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
