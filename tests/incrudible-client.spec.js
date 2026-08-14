import { expect, test } from "./setup.js";
import { mountSchema } from "./helpers/index.js";
import {
  autofillWorkflow,
  conditionalValuesWorkflow,
  criteriaWorkflow,
  nestedCheckboxWorkflow,
  nestedInterpolationWorkflow,
  reviewWorkflow,
} from "./fixtures/index.js";

test("loads and initializes the production bundle", async ({ page, app }) => {
  const exports = await page.evaluate(() => ({
    hasApp: typeof window.APP?.init === "function",
    hasDays: typeof window.DAYS?.daysElapsed === "function",
  }));

  expect(exports).toEqual({ hasApp: true, hasDays: true });
});

test("handles date policies and image upload validation", async ({ page, app }) => {
  const result = await page.evaluate(async () => {
    const holiday = (date) => date === "2026-07-20";
    const dates = {
      forward: DAYS.daysElapsed("2026-07-17", "2026-07-20"),
      reverse: DAYS.daysElapsed("2026-07-20", "2026-07-17"),
      business: DAYS.daysElapsed("2026-07-17", "2026-07-20", {
        businessDays: true,
      }),
      holiday: DAYS.daysElapsed("2026-07-17", "2026-07-20", {
        businessDays: true,
        isHoliday: holiday,
      }),
      leap: DAYS.daysElapsed("2024-02-28", "2024-03-01"),
      invalid: Number.isNaN(DAYS.daysElapsed("2026-02-30", "2026-03-01")),
    };

    const upload = await APP.imageToUpload(
      new File(["hello"], "proof.png", { type: "image/png" }),
    );

    let nonImageError;
    try {
      await APP.imageToUpload(
        new File(["hello"], "proof.txt", { type: "text/plain" }),
      );
    } catch (error) {
      nonImageError = error.message;
    }

    const OriginalFileReader = window.FileReader;
    window.FileReader = class {
      constructor() {
        throw new Error("FileReader should not start");
      }
    };

    let oversizedError;
    try {
      await APP.imageToUpload(
        new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.png", {
          type: "image/png",
        }),
      );
    } catch (error) {
      oversizedError = error.message;
    } finally {
      window.FileReader = OriginalFileReader;
    }

    return { dates, nonImageError, oversizedError, upload };
  });

  expect(result).toEqual({
    dates: {
      forward: 3,
      reverse: -3,
      business: 1,
      holiday: 0,
      leap: 2,
      invalid: true,
    },
    nonImageError: "Select an image file.",
    oversizedError: "Select an image no larger than 10 MiB.",
    upload: {
      name: "proof.png",
      mimeType: "image/png",
      base64: "aGVsbG8=",
    },
  });
});

test("runs a rendered workflow with rules, validation, and preview", async ({
  page,
  app,
}) => {
  await page.evaluate(() => {
    APP.workflowLabel = "Review";
  });
  await mountSchema(page, reviewWorkflow);

  await expect(page.locator("#reason")).toBeDisabled();
  await expect(page.locator("#contact")).toBeDisabled();
  expect(
    await page.locator("#app-form").evaluate((form) => form.checkValidity()),
  ).toBe(false);

  await page.locator("#review-date").fill("2026-07-27");
  await page
    .locator("#outcome")
    .selectOption({ label: "Customer unavailable" });
  await expect(page.locator("#outcome-reason")).toBeEnabled();
  await expect(page.locator("#preview-list")).toContainText(
    "Customer unavailable on 2026-07-27 (reviewed 2026-07-27)",
  );
  expect(
    await page
      .locator("#outcome")
      .evaluate((control) => new FormData(control.form).get(control.name)),
  ).toBe("Customer unavailable on !{#review-date}");
  expect(
    await page.locator("#app-form").evaluate((form) => form.checkValidity()),
  ).toBe(true);

  await page.locator("#urgent").check();
  await expect(page.locator("#confirm-modal")).toHaveAttribute("open", "");
  await expect(page.locator("#confirm-modal-header")).toHaveText(
    "Confirm escalation",
  );
  await expect(page.locator("#urgent").locator("xpath=..")).toContainText(
    "Escalate immediately.",
  );
  await page.locator("#confirm-modal-cancel-button").click();
  await expect(page.locator("#reason")).toBeEnabled();
  await expect(page.locator("#contact")).toBeEnabled();
  expect(
    await page.locator("#app-form").evaluate((form) => form.checkValidity()),
  ).toBe(false);

  await page.locator("#reason").fill("Customer blocked");
  await page.locator("#contact").fill("On-call manager");
  expect(
    await page.locator("#app-form").evaluate((form) => form.checkValidity()),
  ).toBe(true);

  await page.locator("#urgent").uncheck();
  await expect(page.locator("#reason")).toBeDisabled();
  await expect(page.locator("#contact")).toBeDisabled();
  const submittedNames = await page
    .locator("#app-form")
    .evaluate((form) => [...new FormData(form)].map(([name]) => name));
  expect(submittedNames).not.toContain("reason");
  expect(submittedNames).not.toContain("contact");
});

test("resolves conditional value references", async ({ page, app }) => {
  await mountSchema(page, {
    ...conditionalValuesWorkflow,
    listeners: false,
  });

  const inactive = await page.evaluate(() =>
    APP.formHelpers.resolveValueReferences(
      '!{[["gate",true],"From !{#source}"]}',
      document.querySelector("#conditional-select"),
    ),
  );
  const malformed = await page.evaluate(() =>
    APP.formHelpers.resolveValueReferences(
      '!{[["gate",true],42]}',
      document.querySelector("#conditional-select"),
    ),
  );
  const singleQuotedInactive = await page.evaluate(() =>
    APP.formHelpers.resolveValueReferences(
      "!{[['gate',true],'From !{#source}']}",
      document.querySelector("#conditional-select"),
    ),
  );

  expect(inactive).toBe("");
  expect(singleQuotedInactive).toBe("");
  expect(malformed).toBe('!{[["gate",true],42]}');

  await page.locator("#source").fill("case 123");
  await page.locator("#conditional-select").selectOption({ label: "Direct" });
  await page.evaluate(() => APP.formHelpers.renderPreview());

  await expect(page.locator("#preview-list")).toContainText("Direct case 123");

  await page.locator("#gate").check();
  await page.locator("#conditional-select").selectOption({
    label: "Conditional",
  });
  await page.evaluate(() => APP.formHelpers.renderPreview());

  await expect(page.locator("#preview-list")).toContainText("From case 123");
  expect(
    await page
      .locator("#conditional-select")
      .evaluate((control) => new FormData(control.form).get(control.name)),
  ).toBe('!{[["gate",true],"From !{#source}"]}');

  await page.locator("#conditional-select").selectOption({
    label: "Single quoted conditional",
  });
  await page.evaluate(() => APP.formHelpers.renderPreview());

  await expect(page.locator("#preview-list")).toContainText("From case 123");
});

test("gates a conditional token on a string test", async ({ page, app }) => {
  await mountSchema(page, {
    schema: [
      { type: "text", id: "gate", name: "gate", label: "Gate" },
      { type: "text", id: "source", name: "source", label: "Source" },
    ],
    preview: false,
  });

  const resolve = () =>
    page.evaluate(() =>
      APP.formHelpers.resolveValueReferences(
        '!{[["gate","yes"],"From !{#source}"]}',
        document.querySelector("#source"),
      ),
    );

  await page.locator("#source").fill("case 7");
  // The dependency takes a string rather than a boolean, so it passes only
  // on an exact value match — not merely on the control having one.
  await page.locator("#gate").fill("no");
  expect(await resolve()).toBe("");

  await page.locator("#gate").fill("yes");
  expect(await resolve()).toBe("From case 7");
});

test("submits interpolated values while the control keeps its token", async ({
  page,
  app,
}) => {
  await mountSchema(page, {
    schema: [
      { type: "text", id: "source", name: "source", label: "Source" },
      {
        type: "select",
        id: "outcome",
        name: "outcome",
        label: "Outcome",
        options: [
          { label: "Choose", value: "" },
          { label: "Referred", value: "Referred to !{#source}" },
        ],
      },
      {
        type: "checkbox",
        id: "flagged",
        name: "flagged",
        label: "Flagged",
        value: "Flagged by !{#source}",
      },
    ],
  });

  await page.locator("#source").fill("desk 4");
  await page.locator("#outcome").selectOption({ label: "Referred" });
  await page.locator("#flagged").check();

  // APP.values is the submission view, so it agrees with the preview the
  // user just approved rather than shipping the raw template.
  expect(await page.evaluate(() => APP.values)).toEqual({
    source: ["desk 4"],
    outcome: ["Referred to desk 4"],
    flagged: ["Flagged by desk 4"],
  });
  await expect(page.locator("#preview-list")).toContainText("Referred to desk 4");

  // The control itself keeps the token, so the form round-trips and a
  // re-render cannot bake in a stale resolution.
  expect(
    await page
      .locator("#outcome")
      .evaluate((control) => new FormData(control.form).get(control.name)),
  ).toBe("Referred to !{#source}");

  await page.locator("#source").fill("desk 9");
  expect(await page.evaluate(() => APP.values.outcome)).toEqual([
    "Referred to desk 9",
  ]);
});

test("submits footnotes alongside the value that earned them", async ({
  page,
  app,
}) => {
  await mountSchema(page, {
    schema: [
      { type: "text", id: "reviewer", name: "reviewer", label: "Reviewer" },
      ...["first", "second"].map((value) => ({
        type: "radio",
        id: `${value}-option`,
        name: "option",
        label: `${value} option`,
        value,
        // Indexed against the option that owns it, since group members
        // each carry their own id. An unchecked radio has no value, so the
        // rule only earns its footnote when that option is the one picked.
        ...(value === "second"
          ? {
              footnotes: [
                { test: "second", footnote: "checked by !{#reviewer}" },
              ],
            }
          : {}),
      })),
    ],
  });

  await page.locator("#reviewer").fill("Ada");
  await page.locator("#first-option").check();

  // The rule tests "second", so the first option earns no footnote.
  expect(await page.evaluate(() => APP.values.option)).toEqual(["first"]);

  // A radio group shares one name across several controls; the footnote
  // comes from whichever is actually checked, and matches the preview.
  await page.locator("#second-option").check();
  expect(await page.evaluate(() => APP.values.option)).toEqual([
    "second (checked by Ada)",
  ]);
  await expect(page.locator("#preview-list")).toContainText(
    "second (checked by Ada)",
  );
});

test("stops a circular interpolation chain without recursing", async ({
  page,
  app,
}) => {
  await mountSchema(page, {
    schema: [
      { type: "text", id: "alpha", name: "alpha", label: "Alpha" },
      { type: "text", id: "beta", name: "beta", label: "Beta" },
    ],
    preview: false,
  });

  await page.locator("#alpha").fill("alpha sees !{#beta}");
  await page.locator("#beta").fill("beta sees !{#alpha}");

  // Each id resolves once per chain; the token that would close the loop
  // is left as written rather than expanded forever.
  expect(
    await page.evaluate(() =>
      APP.formHelpers.resolveValueReferences(
        "start !{#alpha}",
        document.querySelector("#alpha"),
      ),
    ),
  ).toBe("start alpha sees beta sees !{#alpha}");
});

test("keeps a nameless wizard source out of its interpolated preview", async ({
  page,
  app,
}) => {
  await mountSchema(page, {
    ...nestedInterpolationWorkflow,
    syncOnInput: true,
  });

  await expect(page.locator("#interpolator")).toBeHidden();
  await expect(page.locator("#interpolated")).toBeHidden();
  await expect(page.locator("#nested-interpolated")).toBeHidden();

  await page.locator("#invoke-interpolator").check();
  await expect(page.locator("#interpolator")).toBeVisible();
  await page.locator("#interpolator").selectOption({ label: "the-label" });
  await expect(page.locator("#interpolated")).toBeVisible();
  await expect(page.locator("#interpolated")).toBeEnabled();
  await page.locator("#interpolated").selectOption({ label: "nested-label" });
  await expect(page.locator("#nested-interpolated")).toBeVisible();
  await expect(page.locator("#nested-interpolated")).toBeEnabled();
  await expect(page.locator("#preview-list dd")).toHaveText(
    "Text that interpolates its wizard interpolates !{#nested-interpolated}",
  );

  await page.locator("#nested-interpolated").fill("2026-07-30");

  expect(
    await page.evaluate(() =>
      APP.formHelpers.resolveValueReferences(
        "Text that interpolates !{#interpolated}",
        document.createElement("select"),
      ),
    ),
  ).toBe("Text that interpolates its wizard interpolates 2026-07-30");
  expect(await page.evaluate(() => APP.preview)).toEqual([
    [
      undefined,
      "Entry1",
      "Text that interpolates its wizard interpolates 2026-07-30",
    ],
  ]);
  expect(
    await page
      .locator("#app-form")
      .evaluate((form) => [...new FormData(form)].map(([name]) => name)),
  ).toEqual(["entry1"]);
  await expect(page.locator("#preview-list")).not.toContainText("Interpolated:");
  await expect(page.locator("#preview-list")).not.toContainText(
    "Nested interpolated:",
  );
});

test("toggles checkbox wizard containers on change", async ({ page, app }) => {
  await mountSchema(page, { ...nestedCheckboxWorkflow, listeners: false });

  const container = page.locator(
    'label.form-control[for="include-details"] + fieldset.wizard',
  );
  const nestedContainer = page.locator(
    'label.form-control[for="include-detail-notes"] + fieldset.wizard',
  );
  await expect(container).toHaveClass(/w-1/);
  await expect(container).toHaveAttribute("hidden", "");
  await expect(container).toBeHidden();
  await expect(nestedContainer).toHaveAttribute("hidden", "");
  await expect(nestedContainer).toBeHidden();

  await page.locator("#include-details").check();
  await expect(container).not.toHaveAttribute("hidden", "");
  await expect(container).toBeVisible();
  await expect(page.locator("#include-detail-notes")).toBeVisible();
  await expect(nestedContainer).toHaveAttribute("hidden", "");
  await expect(nestedContainer).toBeHidden();

  await page.locator("#include-detail-notes").check();
  await expect(nestedContainer).not.toHaveAttribute("hidden", "");
  await expect(nestedContainer).toBeVisible();

  await page.locator("#include-detail-notes").uncheck();
  await expect(nestedContainer).toHaveAttribute("hidden", "");
  await expect(nestedContainer).toBeHidden();

  await page.locator("#include-details").uncheck();
  await expect(container).toHaveAttribute("hidden", "");
  await expect(container).toBeHidden();
  await expect(nestedContainer).toHaveAttribute("hidden", "");
  await expect(nestedContainer).toBeHidden();
  await expect(page.locator("#include-detail-notes")).not.toBeVisible();
});

test.describe("criteria workflow", () => {
  test.beforeEach(async ({ page, app }) => {
    await mountSchema(page, { ...criteriaWorkflow, listeners: false });
  });

  test("renders the schema as actual form elements", async ({ page, app }) => {
    await expect(page.locator('#show-options[type="checkbox"]')).toHaveCount(1);
    await expect(page.locator('input[type="radio"][name="option"]')).toHaveCount(
      3,
    );
    await expect(page.locator("textarea#approval-notes")).toHaveCount(1);
    await expect(page.locator("fieldset#conditional-tags")).toHaveCount(1);
    await expect(page.locator('input#conditional-tags-0[name="tags"]')).toHaveCount(
      1,
    );
    await expect(page.locator('#include-details[type="checkbox"]')).toHaveCount(
      1,
    );
    await expect(page.locator('input#detail-notes[type="text"]')).toHaveCount(1);
    await expect(page.locator("select#conditional-mode")).toHaveCount(1);
    await expect(page.locator('input#mode-notes[type="text"]')).toHaveCount(1);
  });

  test("applies one criteria rule to every matching element", async ({ page, app }) => {
    const options = page.locator('input[type="radio"][name="option"]');

    await expect(options).toHaveCount(3);
    for (const option of await options.all()) {
      await expect(option).toBeHidden();
      await expect(option).toBeDisabled();
    }

    await page.locator("#show-options").check();
    for (const option of await options.all()) {
      await expect(option).toBeVisible();
      await expect(option).toBeEnabled();
    }

    await page.locator("#second-option").check();
    expect(
      await page
        .locator("#app-form")
        .evaluate((form) => new FormData(form).get("option")),
    ).toBe("second");

    await page.locator("#show-options").uncheck();
    for (const option of await options.all()) {
      await expect(option).toBeHidden();
      await expect(option).toBeDisabled();
    }
    expect(
      await page
        .locator("#app-form")
        .evaluate((form) => new FormData(form).has("option")),
    ).toBe(false);
  });

  test("keeps id-owned criteria independent when names match", async ({ page, app }) => {
    const first = page.locator("#first-detail");
    const second = page.locator("#second-detail");

    await expect(first).toBeHidden();
    await expect(second).toBeHidden();

    await page.locator("#show-first").check();
    await expect(first).toBeVisible();
    await expect(second).toBeHidden();

    await page.locator("#show-second").check();
    await expect(first).toBeVisible();
    await expect(second).toBeVisible();

    await page.locator("#show-first").uncheck();
    await expect(first).toBeHidden();
    await expect(second).toBeVisible();
  });

  test("requires every authored criterion", async ({ page, app }) => {
    const notes = page.locator("#approval-notes");

    await expect(notes).toBeHidden();
    await page.locator("#first-approval").check();
    await expect(notes).toBeHidden();
    await page.locator("#second-approval").check();
    await expect(notes).toBeVisible();
    await expect(notes).toBeEnabled();
    await page.locator("#first-approval").uncheck();
    await expect(notes).toBeHidden();
    await expect(notes).toBeDisabled();
  });

  test("applies criteria to rendered list fieldsets", async ({ page, app }) => {
    const list = page.locator("#conditional-tags");
    const firstTag = page.locator("#conditional-tags-0");

    await expect(list).toBeHidden();
    await expect(list).toHaveAttribute("disabled", "");
    await page.locator("#show-tags").check();
    await expect(list).toBeVisible();
    await expect(list).not.toHaveAttribute("disabled", "");
    await firstTag.fill("alpha");
    expect(
      await page
        .locator("#app-form")
        .evaluate((form) => new FormData(form).get("tags")),
    ).toBe("alpha");
    await page.locator("#show-tags").uncheck();
    await expect(list).toBeHidden();
    await expect(list).toHaveAttribute("disabled", "");
    expect(
      await page
        .locator("#app-form")
        .evaluate((form) => new FormData(form).has("tags")),
    ).toBe(false);
  });

  test("composes criteria with nested wizard behavior", async ({ page, app }) => {
    const controller = page.locator("#include-details");
    const detail = page.locator("#detail-notes");

    await expect(controller).toBeHidden();
    await expect(detail).toBeHidden();
    await page.locator("#show-details").check();
    await expect(controller).toBeVisible();
    await expect(controller).toBeEnabled();
    await expect(detail).toBeHidden();

    await controller.check();
    await expect(detail).toBeVisible();
    await expect(detail).toBeEnabled();
    await detail.fill("Rendered nested detail");
    expect(
      await page
        .locator("#app-form")
        .evaluate((form) => new FormData(form).get("detailNotes")),
    ).toBe("Rendered nested detail");

    await page.locator("#show-details").uncheck();
    await expect(controller).toBeHidden();
    await expect(controller).toBeDisabled();
    await expect(detail).toBeHidden();
    await expect(detail).toBeDisabled();
    expect(
      await page
        .locator("#app-form")
        .evaluate((form) => new FormData(form).has("detailNotes")),
    ).toBe(false);

    // Re-opening brings the controller back reset, so its wizard stays
    // closed and the detail it held is gone rather than waiting behind it.
    await page.locator("#show-details").check();
    await expect(controller).toBeVisible();
    await expect(controller).not.toBeChecked();
    await expect(detail).toBeHidden();

    await controller.check();
    await expect(detail).toBeVisible();
    await expect(detail).toHaveValue("");
  });

  test("composes criteria with an embedded wizard controller", async ({
    page,
    app,
  }) => {
    const mode = page.locator("#conditional-mode");
    const notes = page.locator("#mode-notes");

    await expect(mode).toBeHidden();
    await expect(mode).toBeDisabled();
    await expect(notes).toBeHidden();
    await page.locator("#show-mode").check();
    await expect(mode).toBeVisible();
    await expect(mode).toBeEnabled();
    await expect(notes).toBeHidden();

    await mode.selectOption({ label: "Detailed" });
    await expect(notes).toBeVisible();
    await expect(notes).toBeEnabled();
    await notes.fill("Embedded wizard detail");

    await page.locator("#show-mode").uncheck();
    await expect(mode).toBeHidden();
    await expect(mode).toBeDisabled();
    await expect(notes).toBeHidden();
    await expect(notes).toBeDisabled();
    expect(
      await page
        .locator("#app-form")
        .evaluate((form) => new FormData(form).has("modeNotes")),
    ).toBe(false);
  });
});

test("syncs conditional requisitions and autofills", async ({ page, app }) => {
  await mountSchema(page, {
    ...autofillWorkflow,
    preview: false,
    syncOnInput: true,
  });

  await expect(page.locator("#conditional-note")).not.toHaveAttribute(
    "required",
    "",
  );

  await page.locator("#source").fill("case 123");
  await page.locator("#mode").selectOption("auto");
  await expect(page.locator("#autofilled-note")).toHaveValue("First case 123");
  await expect(page.locator("#autofilled-select")).toHaveValue("auto");
  await expect(page.locator("#autofilled-textarea")).toHaveValue("");
  await expect(page.locator("#autofilled-checkbox")).not.toBeChecked();

  await page.locator("#mode").selectOption("");
  await expect(page.locator("#autofilled-note")).toHaveValue("First case 123");

  await page.locator("#mode").selectOption("required");
  await expect(page.locator("#conditional-note")).toHaveAttribute(
    "required",
    "",
  );
  expect(
    await page.locator("#app-form").evaluate((form) => form.checkValidity()),
  ).toBe(false);

  await page.locator("#conditional-note").fill("Provided");
  expect(
    await page.locator("#app-form").evaluate((form) => form.checkValidity()),
  ).toBe(true);
});

test("does not render an empty checkbox wizard shell", async ({ page, app }) => {
  await page.evaluate(() => {
    const schema = [
      {
        type: "select",
        id: "choice",
        name: "choice",
        label: "Choice",
        options: [
          { label: "Choose", value: "" },
          { label: "Show", value: "show" },
        ],
        wizards: [
          {
            test: "Show",
            wizard: {
              type: "checkbox",
              id: "follow-up",
              name: "followUp",
              label: "Follow up",
            },
          },
        ],
      },
    ];

    APP.rules.wizardRules = { choice: schema[0].wizards };
    APP.rules.criteriaRules = {};
    APP.formControls.replaceChildren(APP.renderEntries(schema));
    APP.formHelpers.syncWizards();
  });

  const caller = page.locator('label.form-control[for="follow-up"]');
  const shell = page.locator(
    'label.form-control[for="follow-up"] + fieldset.wizard',
  );
  await expect(caller).toHaveAttribute("hidden", "");
  await expect(shell).toHaveCount(0);

  await page.locator("#choice").selectOption("show");
  await page.evaluate(() => APP.formHelpers.syncWizards());
  await expect(caller).not.toHaveAttribute("hidden", "");
  await expect(shell).toHaveCount(0);

  await page.locator("#choice").selectOption("");
  await page.evaluate(() => APP.formHelpers.syncWizards());
  await expect(caller).toHaveAttribute("hidden", "");
  await expect(shell).toHaveCount(0);
});

test("exposes immutable preview state", async ({ page, app }) => {
  const state = await page.evaluate(() => {
    APP.formControls.replaceChildren(
      APP.renderEntries([
        {
          type: "text",
          id: "case-number",
          name: "caseNumber",
          label: "Case Number",
        },
      ]),
    );
    document.querySelector("#case-number").value = "12345";

    const initialValues = APP.values;
    const initialPreview = APP.preview;
    const initialCopyText = APP.copyText;

    document.querySelector("#case-number").value = "67890";
    const currentValues = APP.values;
    const currentPreview = APP.preview;

    return {
      snapshots: {
        initialValues,
        currentValues,
        initialPreview,
        currentPreview,
        initialCopyText,
        valuesFrozen:
          Object.isFrozen(currentValues) &&
          Object.isFrozen(currentValues.caseNumber),
        previewFrozen:
          Object.isFrozen(currentPreview) && Object.isFrozen(currentPreview[0]),
        charCount: APP.charCount,
        copyTextLength: APP.copyText.length,
      },
    };
  });

  expect(state.snapshots).toEqual({
    initialValues: { caseNumber: ["12345"] },
    currentValues: { caseNumber: ["67890"] },
    initialPreview: [[undefined, "Case Number", "12345"]],
    currentPreview: [[undefined, "Case Number", "67890"]],
    initialCopyText: "Case Number: 12345",
    valuesFrozen: true,
    previewFrozen: true,
    charCount: state.snapshots.copyTextLength,
    copyTextLength: state.snapshots.copyTextLength,
  });
});

test("keeps dynamic lists correctly indexed and resets extra rows", async ({
  page,
  app,
}) => {
  await page.evaluate(() => {
    APP.formControls.replaceChildren(
      APP.renderEntries([
        {
          type: "list",
          id: "tags",
          name: "tags",
          label: "Tags",
          constraints: { required: true },
        },
      ]),
    );
  });

  await page.locator(".list-add").click();
  await page.locator(".list-add").click();
  await page.locator("#tags-0").fill("first");
  await page.locator("#tags-1").fill("middle");
  await page.locator("#tags-2").fill("last");
  await page.getByRole("button", { name: "Remove" }).first().click();

  const rows = await page.locator("#tags input").evaluateAll((inputs) =>
    inputs.map((input) => ({
      id: input.id,
      name: input.name,
      value: input.value,
    })),
  );
  expect(rows).toEqual([
    { id: "tags-0", name: "tags", value: "first" },
    { id: "tags-1", name: "tags", value: "last" },
  ]);

  await page.locator("#app-form").evaluate((form) => form.reset());
  await expect(page.locator("#tags input")).toHaveCount(1);
});

test("synchronizes theme, loading, tabs, and current-day records", async ({
  page,
  app,
}) => {
  await page.locator("#theme-toggle").check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(
    await page.evaluate(() => localStorage.getItem(APP.THEME_STORAGE_KEY)),
  ).toBe("dark");

  await page.evaluate(() => {
    APP.loading = true;
  });
  await expect(page.locator("#app-overlay")).toHaveClass(/active/);
  await page.evaluate(() => {
    APP.loading = false;
  });
  await expect(page.locator("#app-overlay")).not.toHaveClass(/active/);

  const recordsTab = page.getByRole("tab", { name: "My Submissions" });
  await recordsTab.click();
  await expect(recordsTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#panel-records")).not.toHaveAttribute(
    "hidden",
    "",
  );
  await recordsTab.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "New Submission" })).toBeFocused();
  await expect(page.locator("#panel-form")).toBeVisible();

  const records = [{ record: { id: "one" }, entries: [["status", "open"]] }];
  await page.evaluate((value) => {
    localStorage.setItem(
      APP.RECORDS_STORAGE_KEY,
      JSON.stringify({ date: APP.today(), records: value }),
    );
  }, records);
  expect(await page.evaluate(() => APP.records)).toEqual(records);
});

test("publishes dialog outcomes and dismisses messages", async ({ page, app }) => {
  await page.evaluate(() => {
    window.dialogEvents = [];
    APP.subscribe("confirm:accepted", (detail) =>
      dialogEvents.push(["accepted", detail]),
    );
    APP.subscribe("confirm:cancelled", (detail) =>
      dialogEvents.push(["cancelled", detail]),
    );
    APP.confirm("Proceed?", {
      header: "First decision",
      detail: { id: 1 },
      confirmText: "Continue",
    });
  });
  await page.locator("#confirm-modal-cancel-button").click();
  await expect
    .poll(() => page.evaluate(() => window.dialogEvents))
    .toEqual([["cancelled", { id: 1 }]]);

  await page.evaluate(() => {
    APP.confirm("Proceed again?", {
      header: "Second decision",
      detail: { id: 2 },
    });
  });
  await page.locator("#confirm-modal-confirm-button").click();

  await expect
    .poll(() => page.evaluate(() => window.dialogEvents))
    .toEqual([
      ["cancelled", { id: 1 }],
      ["accepted", { id: 2 }],
    ]);

  await page.evaluate(() => {
    APP.notify("Finished.", { header: "Complete", dismissText: "Done" });
  });
  await expect(page.locator("#message-modal")).toHaveAttribute("open", "");
  await expect(page.locator("#message-modal-dismiss-button")).toHaveText(
    "Done",
  );
  await page.locator("#message-modal-dismiss-button").click();
  await expect(page.locator("#message-modal")).not.toHaveAttribute("open", "");
});

test("handles Apps Script success and both failure paths", async ({ page, app }) => {
  const installServer = (outcome) =>
    page.evaluate((value) => {
      window.serverCall = null;
      let successHandler;
      let failureHandler;
      const chain = new Proxy(
        {
          withSuccessHandler(handler) {
            successHandler = handler;
            return chain;
          },
          withFailureHandler(handler) {
            failureHandler = handler;
            return chain;
          },
        },
        {
          get(target, property) {
            if (property in target) {
              return target[property];
            }

            return (...args) => {
              window.serverCall = { method: property, args };
              queueMicrotask(() => {
                if (value.type === "transport") {
                  failureHandler(new Error(value.message));
                } else {
                  successHandler(value.response);
                }
              });
            };
          },
        },
      );

      window.google = { script: { run: chain } };
    }, outcome);

  await installServer({
    type: "success",
    response: { success: true, data: { id: 7 } },
  });
  const success = await page.evaluate(
    () =>
      new Promise((resolve) => {
        APP.runServer("save", ["value"], { onData: resolve });
      }),
  );
  expect(success).toEqual({ id: 7 });
  expect(await page.evaluate(() => window.serverCall)).toEqual({
    method: "save",
    args: ["value"],
  });
  await expect(page.locator("#app-overlay")).not.toHaveClass(/active/);

  await installServer({
    type: "response",
    response: { success: false, error: { message: "Rejected" } },
  });
  await page.evaluate(() => {
    APP.runServer("save", [], { prefix: "Couldn't save: ", onData: () => {} });
  });
  await expect(page.getByRole("status").last()).toHaveText(
    "Couldn't save: Rejected",
  );
  await expect(page.locator("#app-overlay")).not.toHaveClass(/active/);

  await installServer({ type: "response", response: null });
  await page.evaluate(() => {
    APP.runServer("save", [], { prefix: "Couldn't save: ", onData: () => {} });
  });
  await expect(page.getByRole("status").last()).toHaveText(
    "Couldn't save: The server returned no response.",
  );
  await expect(page.locator("#app-overlay")).not.toHaveClass(/active/);

  await installServer({ type: "transport", message: "Offline" });
  await page.evaluate(() => {
    APP.runServer("save", [], { prefix: "Couldn't save: ", onData: () => {} });
  });
  await expect(page.getByRole("status").last()).toHaveText(
    "Couldn't save: Offline",
  );
  await expect(page.locator("#app-overlay")).not.toHaveClass(/active/);
});

test("copies only valid preview content and reports clipboard failures", async ({
  page,
  app,
}) => {
  await page.evaluate(() => {
    APP.workflowLabel = "Review";
    APP.formControls.replaceChildren(
      APP.renderEntries([
        {
          type: "text",
          id: "case-number",
          name: "caseNumber",
          label: "Case Number",
          constraints: { required: true },
        },
        { type: "textarea", id: "notes", name: "notes", label: "Notes" },
      ]),
    );
    APP.formHelpers.formControls.forEach((control) => {
      control.addEventListener("input", () => APP.formHelpers.renderPreview());
    });
    APP.formHelpers.renderPreview();
  });

  await page.locator("#notes").fill("Context");
  await page.locator("#copy-preview").click();
  expect(await page.evaluate(() => window.clipboardWrites)).toEqual([]);
  await page.keyboard.press("Escape");

  await page.locator("#case-number").fill("12345");
  await page.locator("#copy-preview").click();
  expect(await page.evaluate(() => window.clipboardWrites)).toEqual([
    "Case Number: 12345 | Notes: Context",
  ]);
  await expect(page.getByRole("status").last()).toHaveText(
    "Copied to clipboard.",
  );

  await page.evaluate(() => {
    window.clipboardShouldFail = true;
  });
  await page.locator("#copy-preview").click();
  await expect(page.getByRole("status").last()).toHaveText(
    "Couldn't copy to clipboard.",
  );
});
