import assert from "node:assert/strict";
import test from "node:test";
import plugin from "../src/tui.js";

test("registers a goal contribution between Todo and Files", async () => {
  let contribution: unknown;
  const api = {
    slots: {
      register(value: unknown) {
        contribution = value;
        return "opencode-goal.tui";
      },
    },
  };

  await plugin.tui(api as never, undefined, {} as never);

  assert.equal(plugin.id, "opencode-goal.tui");
  assert.equal((contribution as { order?: number } | undefined)?.order, 450);
  assert.equal(
    typeof (
      contribution as {
        slots?: { sidebar_content?: unknown };
      }
    ).slots?.sidebar_content,
    "function",
  );
});
