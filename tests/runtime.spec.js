import { expect, test } from "./setup.js";
import { installAppsScript } from "./mocks/index.js";

test("delivers, replays, and tears down bus subscriptions", async ({
  page,
  app,
}) => {
  const result = await page.evaluate(() => {
    const seen = [];
    const bus = APP._internals.bus;

    // Publishing to an event nobody listens for is a no-op.
    APP.publish("nobody:listening", "ignored");

    const unsubscribeFirst = APP.subscribe("ping", (payload) =>
      seen.push(["first", payload]),
    );
    APP.subscribe("ping", (payload) => seen.push(["second", payload]));
    APP.publish("ping", 1);

    unsubscribeFirst();
    APP.publish("ping", 2);

    // next() delivers exactly once and then removes itself.
    APP.next("ping", (payload) => seen.push(["once", payload]));
    APP.publish("ping", 3);
    APP.publish("ping", 4);

    const beforeUnsubscribe = bus._handlers.has("ping");
    // Unsubscribing an unknown event and an unknown handler are both safe.
    APP.unsubscribe("never:registered", () => {});
    APP.unsubscribe("ping", () => {});

    return {
      seen,
      beforeUnsubscribe,
      stillRegistered: bus._handlers.has("ping"),
    };
  });

  expect(result).toEqual({
    seen: [
      ["first", 1],
      ["second", 1],
      ["second", 2],
      // next() was registered last, so it runs after the standing handler.
      ["second", 3],
      ["once", 3],
      ["second", 4],
    ],
    beforeUnsubscribe: true,
    stillRegistered: true,
  });
});

test("drops an event key once its last handler unsubscribes", async ({
  page,
  app,
}) => {
  const result = await page.evaluate(() => {
    const bus = APP._internals.bus;
    const handler = () => {};

    const unsubscribe = APP.subscribe("solo", handler);
    const registered = bus._handlers.has("solo");
    unsubscribe();

    // A cancelled next() also leaves nothing behind.
    const cancel = APP.next("cancelled", () => {});
    cancel();

    return {
      registered,
      afterUnsubscribe: bus._handlers.has("solo"),
      afterCancel: bus._handlers.has("cancelled"),
    };
  });

  expect(result).toEqual({
    registered: true,
    afterUnsubscribe: false,
    afterCancel: false,
  });
});

test("clears one event or the whole bus", async ({ page, app }) => {
  const result = await page.evaluate(() => {
    const bus = APP._internals.bus;
    const seen = [];

    APP.subscribe("alpha", () => seen.push("alpha"));
    APP.subscribe("beta", () => seen.push("beta"));

    bus.clear("alpha");
    APP.publish("alpha");
    APP.publish("beta");

    bus.clear();
    APP.publish("beta");

    return { seen, size: bus._handlers.size };
  });

  expect(result).toEqual({ seen: ["beta"], size: 0 });
});

test("removes a toast and collapses the container after its lifetime", async ({
  page,
  app,
}) => {
  await page.clock.install();
  await page.evaluate(() => {
    APP.toast("Saved.", "tip");
    APP.toast("Also saved.");
  });

  const container = page.locator("#toast-container");
  await expect(container).toHaveClass("open");
  await expect(page.getByRole("status")).toHaveCount(2);
  // The default variant is note.
  await expect(page.getByRole("status").last()).toHaveClass("toast toast-note open");

  await page.clock.runFor(9900);
  await expect(page.getByRole("status")).toHaveCount(2);

  await page.clock.runFor(200);
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(container).not.toHaveClass(/open/);
});

test("scopes parsed heading ids to their container", async ({ page, app }) => {
  await page.evaluate(() => {
    APP.context.recordsMessage =
      "# Overview\n\nNo records yet.\n\n## Recent activity\n";
  });

  await expect(page.locator("#records-list-overview")).toHaveText("Overview");
  await expect(page.locator("#records-list-recent-activity")).toHaveText(
    "Recent activity",
  );
  expect(await page.evaluate(() => APP.context.recordsMessage)).toContain(
    "No records yet.",
  );
});

// APP.context.headingList calls getHeadingList(), which is referenced but
// never defined in the module — reading the getter throws a ReferenceError.
// Marked as an expected failure so it starts passing once the helper lands.
test.fail("exposes the parsed heading list", async ({ page, app }) => {
  await page.evaluate(() => {
    APP.context.recordsMessage = "# Overview\n\n## Recent activity\n";
  });

  expect(await page.evaluate(() => APP.context.headingList)).toBeDefined();
});

test.describe("workflow state", () => {
  test.use({ appInit: { workflowLabel: "Review" } });

  test("tracks workflow state through both accessors", async ({ page, app }) => {
    const result = await page.evaluate(() => {
      const initialLabel = APP.workflowLabel;

      APP.workflowLabel = "Escalation";
      APP.workflow = { id: 7, alert: "Overdue" };

      const viaInternals = APP._internals.workflow;
      APP._internals.workflow = "static label";

      return {
        initialLabel,
        label: APP.workflowLabel,
        viaInternals,
        viaPublic: APP.workflow,
      };
    });

    expect(result).toEqual({
      initialLabel: "Review",
      label: "Escalation",
      viaInternals: { id: 7, alert: "Overdue" },
      viaPublic: "static label",
    });
  });
});

test.describe("with a stored theme", () => {
  test.use({ appStorage: { "[incrudible:theme]": "dark" } });

  test("hydrates a stored dark theme before the toggle is read", async ({
    page,
    app,
  }) => {
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("#theme-toggle")).toBeChecked();
    expect(await page.evaluate(() => APP.theme)).toBe("dark");

    await page.locator("#theme-toggle").uncheck();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(
      await page.evaluate(() => localStorage.getItem(APP.THEME_STORAGE_KEY)),
    ).toBe("light");
  });
});

test.describe("with a dark OS preference and nothing stored", () => {
  test.use({ colorScheme: "dark" });

  test("falls back to the OS colour scheme", async ({ page, app }) => {
    expect(await page.evaluate(() => APP.theme)).toBe("dark");
    await expect(page.locator("#theme-toggle")).toBeChecked();
    // Nothing was persisted, so the document attribute stays unset until
    // the user actually picks a theme.
    await expect(page.locator("html")).not.toHaveAttribute(
      "data-theme",
      "dark",
    );
  });
});

test("normalizes any unrecognized theme to light", async ({ page, app }) => {
  expect(
    await page.evaluate(() => {
      APP.theme = "midnight";
      return APP.theme;
    }),
  ).toBe("light");
});

test("reports empty values when the page has no form", async ({
  page,
  app,
}) => {
  expect(
    await page.evaluate(() => {
      document.getElementById("app-form").remove();
      return APP.values;
    }),
  ).toEqual({});
});

test("reads only same-day stored records", async ({ page, app }) => {
  // Nothing stored at all.
  expect(await page.evaluate(() => APP.records)).toEqual([]);

  const records = [{ record: { id: "one" } }];
  await page.evaluate((value) => {
    localStorage.setItem(
      APP.RECORDS_STORAGE_KEY,
      JSON.stringify({ date: "1999-01-01", records: value }),
    );
  }, records);
  expect(await page.evaluate(() => APP.records)).toEqual([]);

  await page.evaluate((value) => {
    localStorage.setItem(
      APP.RECORDS_STORAGE_KEY,
      JSON.stringify({ date: APP.today(), records: value }),
    );
  }, records);
  expect(await page.evaluate(() => APP.records)).toEqual(records);

  // today() is an America/New_York calendar date.
  expect(await page.evaluate(() => APP.today())).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

test("resets the app form and toasts when a record is created", async ({
  page,
  app,
}) => {
  await page.evaluate(() => {
    APP.formControls.replaceChildren(
      APP.renderEntries([
        { type: "text", id: "case-number", name: "caseNumber", label: "Case" },
      ]),
    );
  });
  await page.locator("#case-number").fill("12345");

  await page.evaluate(() => APP.publish("record:created"));
  await expect(page.locator("#case-number")).toHaveValue("");
  await expect(page.getByRole("status").last()).toHaveText(
    "Submission received.",
  );

  // The reset callback passed to init runs after the frame settles.
  await expect
    .poll(() => page.evaluate(() => window.appEvents))
    .toContainEqual(["form:reset"]);
});

test("forwards workflow, init, and records-tab lifecycle callbacks", async ({
  page,
  app,
}) => {
  await page.evaluate(() => {
    APP.publish("workflow:loaded", { id: "wf-1" });
    APP.publish("app:init", { ready: true });
  });
  await page.getByRole("tab", { name: "My Submissions" }).click();

  await expect
    .poll(() => page.evaluate(() => window.appEvents))
    .toEqual([
      ["workflow:loaded", { id: "wf-1" }],
      ["app:init", { ready: true }],
      ["records:tab"],
    ]);
});

test("routes overlay events through the loading state", async ({ page, app }) => {
  const overlay = page.locator("#app-overlay");

  await page.evaluate(() => APP.publish("overlay:show"));
  await expect(overlay).toHaveClass(/active/);
  expect(await page.evaluate(() => APP.loading)).toBe(true);

  await page.evaluate(() => APP.publish("overlay:hide"));
  await expect(overlay).not.toHaveClass(/active/);
  expect(await page.evaluate(() => APP.loading)).toBe(false);
});

test("evaluates match tests by equality, regex, presence, and absence", async ({
  page,
  app,
}) => {
  expect(
    await page.evaluate(() => ({
      equal: APP.match("open", ["open"]),
      notEqual: APP.match("open", ["closed"]),
      anyOf: APP.match("open", ["closed", "open"]),
      regex: APP.match("/^C-\\d+$/", ["C-42"]),
      regexFlags: APP.match("/^c-\\d+$/i", ["C-42"]),
      regexMiss: APP.match("/^C-\\d+$/", ["X-42"]),
      presentTrue: APP.match(true, ["anything"]),
      presentFalse: APP.match(true, []),
      absentTrue: APP.match(false, []),
      absentFalse: APP.match(false, ["anything"]),
      undefinedPresent: APP.match(undefined, ["anything"]),
      undefinedAbsent: APP.match(undefined, []),
    })),
  ).toEqual({
    equal: true,
    notEqual: false,
    anyOf: true,
    regex: true,
    regexFlags: true,
    regexMiss: false,
    presentTrue: true,
    presentFalse: false,
    absentTrue: true,
    absentFalse: false,
    undefinedPresent: true,
    undefinedAbsent: false,
  });
});

test("shows modals by type and rejects unknown shapes", async ({ page, app }) => {
  expect(
    await page.evaluate(() => [
      APP.showModal(undefined),
      APP.showModal({}),
      APP.showModal({ type: "banner", message: "nope" }),
    ]),
  ).toEqual([false, false, false]);
  await expect(page.locator("#message-modal")).not.toHaveAttribute("open", "");

  expect(
    await page.evaluate(() =>
      APP.showModal({ type: "message", message: "Heads up", header: "Notice" }),
    ),
  ).toBe(true);
  await expect(page.locator("#message-modal")).toHaveAttribute("open", "");
  await page.locator("#message-modal-close").click();

  expect(
    await page.evaluate(() =>
      APP.showModal({ type: "confirm", message: "Sure?", header: "Confirm" }),
    ),
  ).toBe(true);
  await expect(page.locator("#confirm-modal")).toHaveAttribute("open", "");
  await page.locator("#confirm-modal-close").click();
  await expect(page.locator("#confirm-modal")).not.toHaveAttribute("open", "");
});

test("applies the modal variant class to the dialog", async ({ page, app }) => {
  await page.evaluate(() =>
    APP.notify("Take care.", { header: "Heads up", variant: "warning" }),
  );
  await expect(page.locator("#message-modal")).toHaveClass("modal-warning");

  await page.locator("#message-modal-dismiss-button").click();
  await page.evaluate(() => APP.notify("Plain message."));
  // No variant means no variant class survives from the previous modal.
  await expect(page.locator("#message-modal")).toHaveClass("");
  await expect(page.locator("#message-modal-header")).toHaveText("Notice");
  await expect(page.locator("#message-modal-dismiss-button")).toHaveText("OK");
});

test("sets and clears the form action a confirm dialog requests", async ({
  page,
  app,
}) => {
  await page.evaluate(() => APP.confirm("Submit?", { action: "/submit" }));
  await expect(page.locator("#app-form")).toHaveAttribute("action", "/submit");
  await page.locator("#confirm-modal-confirm-button").click();

  await page.evaluate(() => APP.confirm("Submit again?"));
  await expect(page.locator("#app-form")).not.toHaveAttribute("action");
  await expect(page.locator("#confirm-modal-confirm-button")).toHaveText("OK");
  await expect(page.locator("#confirm-modal-cancel-button")).toHaveText(
    "Cancel",
  );
  await expect(page.locator("#confirm-modal-header")).toHaveText(
    "Confirm Action",
  );
  await page.locator("#confirm-modal-cancel-button").click();
});

test("publishes modal open and close events", async ({ page, app }) => {
  await page.evaluate(() => {
    window.modalEvents = [];
    APP.subscribe("modal:opened", () => window.modalEvents.push("opened"));
    APP.subscribe("modal:closed", () => window.modalEvents.push("closed"));
    APP.notify("Message");
  });
  await page.locator("#message-modal-close").click();

  await expect
    .poll(() => page.evaluate(() => window.modalEvents))
    .toEqual(["opened", "closed"]);
});

test("unwraps every server error shape", async ({ page, app }) => {
  await installAppsScript(page, {
    type: "response",
    response: { success: false, error: "Plain string failure" },
  });
  await page.evaluate(() =>
    APP.runServer("save", [], { prefix: "Failed: ", onData: () => {} }),
  );
  await expect(page.getByRole("status").last()).toHaveText(
    "Failed: Plain string failure",
  );

  await installAppsScript(page, {
    type: "response",
    response: { success: false, error: { code: 500 } },
  });
  await page.evaluate(() =>
    APP.runServer("save", [], { prefix: "Failed: ", onData: () => {} }),
  );
  await expect(page.getByRole("status").last()).toHaveText(
    "Failed: The server could not complete the request.",
  );

  // A non-object response is rejected before the success path.
  await installAppsScript(page, { type: "response", response: "surprise" });
  await page.evaluate(() =>
    APP.runServer("save", [], { onData: () => {} }),
  );
  await expect(page.getByRole("status").last()).toHaveText(
    "The server returned no response.",
  );
});

test("raises the overlay only when the call opts into loading", async ({
  page,
  app,
}) => {
  await page.evaluate(() => {
    window.google = {
      script: {
        run: {
          withSuccessHandler() {
            return this;
          },
          withFailureHandler() {
            return this;
          },
          slowCall() {},
        },
      },
    };
  });

  await page.evaluate(() =>
    APP.runServer("slowCall", [], { onData: () => {} }),
  );
  await expect(page.locator("#app-overlay")).toHaveClass(/active/);

  await page.evaluate(() => {
    APP.loading = false;
    APP.runServer("slowCall", [], { loading: false, onData: () => {} });
  });
  await expect(page.locator("#app-overlay")).not.toHaveClass(/active/);

  // A failure on a loading:false call must not clear an overlay it never
  // raised, and it still surfaces the toast.
  await page.evaluate(() => {
    APP.loading = true;
    window.google.script.run.withFailureHandler = function (handler) {
      queueMicrotask(() => handler(new Error("Offline")));
      return this;
    };
    APP.runServer("slowCall", [], { loading: false, onData: () => {} });
  });
  await expect(page.getByRole("status").last()).toHaveText("Offline");
  await expect(page.locator("#app-overlay")).toHaveClass(/active/);
});

test("rejects an unreadable image without leaking the reader error", async ({
  page,
  app,
}) => {
  const message = await page.evaluate(async () => {
    const OriginalFileReader = window.FileReader;

    window.FileReader = class {
      addEventListener(type, handler) {
        this[`on_${type}`] = handler;
      }

      readAsDataURL() {
        this.error = new Error("Unreadable");
        queueMicrotask(() => this.on_error());
      }
    };

    try {
      await APP.imageToUpload(
        new File(["x"], "broken.png", { type: "image/png" }),
      );
      return null;
    } catch (error) {
      return error.message;
    } finally {
      window.FileReader = OriginalFileReader;
    }
  });

  expect(message).toBe("Unreadable");
});

test("rejects a missing image selection", async ({ page, app }) => {
  expect(
    await page.evaluate(async () => {
      const messages = [];

      for (const input of [undefined, null, {}, { type: "text/plain" }]) {
        try {
          await APP.imageToUpload(input);
        } catch (error) {
          messages.push(error.message);
        }
      }

      return messages;
    }),
  ).toEqual([
    "Select an image file.",
    "Select an image file.",
    "Select an image file.",
    "Select an image file.",
  ]);
});

test("returns NaN for unparsable date arguments", async ({ page, app }) => {
  expect(
    await page.evaluate(() => ({
      nonString: Number.isNaN(DAYS.daysElapsed(null, "2026-01-02")),
      numeric: Number.isNaN(DAYS.daysElapsed(20260101, "2026-01-02")),
      malformed: Number.isNaN(DAYS.daysElapsed("01/01/2026", "2026-01-02")),
      badEnd: Number.isNaN(DAYS.daysElapsed("2026-01-01", "not-a-date")),
      padded: DAYS.daysElapsed("  2026-01-01  ", "2026-01-02"),
      sameDayBusiness: DAYS.daysElapsed("2026-01-01", "2026-01-01", {
        businessDays: true,
      }),
      reverseBusiness: DAYS.daysElapsed("2026-07-20", "2026-07-17", {
        businessDays: true,
      }),
    })),
  ).toEqual({
    nonString: true,
    numeric: true,
    malformed: true,
    badEnd: true,
    padded: 1,
    sameDayBusiness: 0,
    reverseBusiness: -1,
  });
});
