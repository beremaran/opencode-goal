import {FileGoalStore, scopedStateDirectory} from "../storage/goal-store.js";
import type {GoalState} from "../core/types.js";

export type GoalSessionLocation = {
    id: string;
    projectID: string;
    directory: string;
};

export async function loadSessionGoal(
    stateRoot: string,
    session: GoalSessionLocation,
): Promise<GoalState | undefined> {
    const directory = scopedStateDirectory(
        stateRoot,
        session.projectID,
        session.directory,
    );
    return new FileGoalStore(directory).get(session.id);
}
