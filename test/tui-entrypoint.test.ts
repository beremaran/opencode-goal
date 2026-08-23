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
    assert.equal((contribution as {order?: number} | undefined)?.order, 450);
    assert.equal(
        typeof (
            contribution as {
                slots?: {sidebar_content?: unknown};
            }
        ).slots?.sidebar_content,
        "function",
    );
});

test("defers V2 keymap registration until the sidebar renders", async () => {
    let layerCalls = 0;
    await plugin.setup({
        options: {},
        keymap: {
            layer() {
                layerCalls += 1;
            },
        },
        ui: {
            slot() {
                return () => {};
            },
        },
    });

    assert.equal(layerCalls, 0);
});
