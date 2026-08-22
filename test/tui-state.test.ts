import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {createGoalState} from "../src/core/goal.js";
import {FileGoalStore, scopedStateDirectory,} from "../src/storage/goal-store.js";
import {loadSessionGoal} from "../src/ui/state.js";

test("loads the server goal from the matching TUI session scope", async (context) => {
    const root = await mkdtemp(path.join(tmpdir(), "opencode-goal-tui-"));
    context.after(() => rm(root, {recursive: true, force: true}));

    const session = {
        id: "ses_123",
        projectID: "project_123",
        directory: "/workspace",
    };
    const goal = createGoalState({
        sessionID: session.id,
        directory: session.directory,
        objective: "show progress in the sidebar",
        now: 1_000,
        goalId: "goal_123",
    });
    const store = new FileGoalStore(
        scopedStateDirectory(root, session.projectID, session.directory),
    );
    await store.set(goal);

    assert.deepEqual(await loadSessionGoal(root, session), goal);
});
