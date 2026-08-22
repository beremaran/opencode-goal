import { createGoalState } from "./goal.js";
import { actionPrompt, continuationPrompt, helpPrompt, startingPrompt, statusPrompt } from "./prompts.js";
import type { GoalCommand, GoalState } from "./types.js";

type GoalStore = {
  get(sessionID: string): Promise<GoalState | undefined>;
  set(goal: GoalState): Promise<void>;
  clear(sessionID: string): Promise<void>;
};

export async function goalCommandPrompt(
  store: GoalStore,
  sessionID: string,
  directory: string,
  command: GoalCommand,
): Promise<string> {
  if (command.action === "status") return statusPrompt(await store.get(sessionID));
  if (command.action === "help") return helpPrompt();
  if (command.action === "invalid") return actionPrompt(command.message);
  if (command.action === "clear") {
    await store.clear(sessionID);
    return actionPrompt("The session goal was cleared.");
  }

  const current = await store.get(sessionID);
  if (command.action === "pause") {
    if (!current || current.status !== "active") return actionPrompt("There is no active goal to pause.");
    await store.set({
      ...current,
      status: "paused",
      updatedAt: Date.now(),
      lastReason: "Paused by the user.",
    });
    return actionPrompt("The session goal is paused.");
  }

  if (command.action === "resume") {
    if (!current) return actionPrompt("There is no goal to resume.");
    if (current.status === "complete")
      return actionPrompt("The previous goal is complete. Set a new goal to do more work.");
    const resumed: GoalState = {
      ...current,
      status: "active",
      updatedAt: Date.now(),
      lastReason: "Resumed by the user.",
    };
    await store.set(resumed);
    return continuationPrompt(resumed);
  }

  const goal = createGoalState({
    sessionID,
    directory,
    objective: command.objective,
  });
  await store.set(goal);
  return startingPrompt(goal);
}
