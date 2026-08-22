export const GOAL_STATUSES = [
    "active",
    "paused",
    "complete",
    "blocked",
] as const;

export type GoalStatus = (typeof GOAL_STATUSES)[number];

export type CompletionClaim = {
    reason: string;
    createdAt: number;
};

export type GoalState = {
    version: 1;
    goalId: string;
    sessionID: string;
    directory: string;
    objective: string;
    status: GoalStatus;
    createdAt: number;
    updatedAt: number;
    completedAt?: number;
    turns: number;
    tokensUsed: number;
    /** Message that created the goal when it was started by a model tool. */
    startedMessageID?: string;
    lastEvaluatedMessageID?: string;
    lastReason?: string;
    completionClaim?: CompletionClaim;
    /** V2 event-backed transcript retained when the V2 client cannot list messages. */
    transcript?: TranscriptMessage[];
};

export type EvaluationDecision = {
    complete: boolean;
    reason: string;
    error?: boolean;
};

export type GoalPluginOptions = {
    /**
     * Model used by the independent completion evaluator, in provider/model form.
     * Falls back to OpenCode's small_model and then the parent session model.
     */
    evaluatorModel?: string;
    /** Optional agent name for evaluator turns. */
    evaluatorAgent?: string;
    /** Override the persistent state root. */
    stateDirectory?: string;
    /** Maximum transcript characters sent to the evaluator. */
    maxTranscriptChars?: number;
    /** Delay before an automatic continuation, allowing user steering to win. */
    continuationDelayMs?: number;
    /** Delete temporary evaluator sessions after each decision. */
    deleteEvaluatorSessions?: boolean;
};

export type ResolvedGoalPluginOptions = {
    evaluatorModel?: string;
    evaluatorAgent?: string;
    stateDirectory?: string;
    maxTranscriptChars: number;
    continuationDelayMs: number;
    deleteEvaluatorSessions: boolean;
};

export type GoalCommand =
    | { action: "status" }
    | { action: "help" }
    | { action: "clear" }
    | { action: "pause" }
    | { action: "resume" }
    | {
    action: "set";
    objective: string;
}
    | { action: "invalid"; message: string };

export type ModelRef = {
    providerID: string;
    modelID: string;
};

export type TranscriptPart = {
    type: string;
    text?: string;
    tool?: string;
    state?: {
        status?: string;
        title?: string;
        output?: string;
        error?: string;
    };
    files?: string[];
};

export type TranscriptMessage = {
    info: {
        id: string;
        role: "user" | "assistant";
        time: {
            created: number;
        };
        agent?: string;
        model?: ModelRef;
        tokens?: {
            input: number;
            output: number;
            reasoning: number;
            cache?: {
                read: number;
                write: number;
            };
        };
    };
    parts: TranscriptPart[];
};
