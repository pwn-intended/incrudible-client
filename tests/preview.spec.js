import { expect, test } from "./setup.js";
import { mountSchema } from "./helpers/index.js";

test("groups preview rows under their fieldset legends", async ({ page, app }) => {
  await mountSchema(page, {
    schema: [
      {
        type: "fieldset",
        id: "customer",
        label: "Customer",
        members: [
          { type: "text", id: "customer-name", name: "customerName", label: "Name" },
          { type: "text", id: "customer-ref", name: "customerRef", label: "Reference" },
        ],
      },
      {
        type: "fieldset",
        id: "resolution",
        label: "Resolution",
        members: [
          { type: "text", id: "outcome", name: "outcome", label: "Outcome" },
        ],
      },
      { type: "text", id: "loose", name: "loose", label: "Ungrouped" },
    ],
  });

  await page.locator("#customer-name").fill("Ada");
  await page.locator("#customer-ref").fill("REF-1");
  await page.locator("#outcome").fill("Resolved");
  await page.locator("#loose").fill("Standalone");

  expect(await page.evaluate(() => APP.preview)).toEqual([
    ["Customer", "Name", "Ada"],
    ["Customer", "Reference", "REF-1"],
    ["Resolution", "Outcome", "Resolved"],
    [undefined, "Ungrouped", "Standalone"],
  ]);

  // One heading per group, emitted only when the group changes.
  expect(
    await page
      .locator("#preview-list .preview-group")
      .evaluateAll((nodes) => nodes.map((node) => node.textContent)),
  ).toEqual(["Customer", "Resolution"]);
});

test("renders list entries as a single bulleted preview row", async ({
  page,
  app,
}) => {
  await mountSchema(page, {
    schema: [
      { type: "list", id: "tags", name: "tags", label: "Tags" },
      { type: "list", id: "unnamed", label: "Unnamed list" },
      { type: "list", id: "empty", name: "empty", label: "Empty list" },
    ],
  });

  await page.locator("#tags-0").fill("alpha");

  // A row added after mount gets no special treatment from the caller —
  // filling it fires the same input event as any other row, and that
  // alone has to be enough to bring the preview up to date.
  await page.locator("#tags .list-add").click();
  await page.locator("#tags-1").fill("  beta  ");
  await page.locator("#unnamed-0").fill("hidden from preview");

  // Blank entries drop out, values are trimmed, and a name-less or empty
  // list contributes no row at all.
  expect(await page.evaluate(() => APP.preview)).toEqual([
    [undefined, "Tags", "- alpha\n- beta"],
  ]);
  await expect(page.locator("#preview-list")).toContainText("alpha");
  await expect(page.locator("#preview-list")).toContainText("beta");

  // Removing a row drops its value from the preview immediately too —
  // no stale entry left behind from before the row disappeared.
  await page.locator("#tags-1").locator("xpath=..").locator(".list-remove").click();
  expect(await page.evaluate(() => APP.preview)).toEqual([
    [undefined, "Tags", "- alpha"],
  ]);
  await expect(page.locator("#preview-list")).not.toContainText("beta");

  // A disabled list is excluded even when it holds values.
  await page.evaluate(() => {
    document.getElementById("tags").disabled = true;
    APP.formHelpers.renderPreview();
  });
  expect(await page.evaluate(() => APP.preview)).toEqual([]);
  await expect(page.locator("#copy-preview")).toBeDisabled();
});

test("previews a row added after mount even when the first entry is blank", async ({
  page,
  app,
}) => {
  await mountSchema(page, {
    schema: [{ type: "list", id: "tags", name: "tags", label: "Tags" }],
  });

  // The first entry stays blank; only the appended row gets a value.
  // Nothing but that row's own input event drives the refresh.
  await page.locator("#tags .list-add").click();
  await page.locator("#tags-1").fill("beta");

  expect(await page.evaluate(() => APP.preview)).toEqual([
    [undefined, "Tags", "- beta"],
  ]);
  await expect(page.locator("#preview-list")).toContainText("beta");
});

test("falls back to the list name when no label text is rendered", async ({
  page,
  app,
}) => {
  await mountSchema(page, {
    schema: [{ type: "list", id: "tags", name: "tags", label: "Tags" }],
  });

  await page.locator("#tags-0").fill("alpha");
  await page.evaluate(() => {
    document.querySelector("#tags .label-text").remove();
    APP.formHelpers.renderPreview();
  });

  expect(await page.evaluate(() => APP.preview)).toEqual([
    [undefined, "tags", "- alpha"],
  ]);
});

test("previews a checked boolean checkbox as its label alone", async ({
  page,
  app,
}) => {
  await mountSchema(page, {
    schema: [
      { type: "checkbox", id: "urgent", name: "urgent", label: "Urgent" },
      {
        type: "checkbox",
        id: "valued",
        name: "valued",
        label: "Valued",
        value: "escalated",
      },
    ],
  });

  await page.locator("#urgent").check();
  await page.locator("#valued").check();

  // A "true" checkbox has no meaningful value, so the label becomes the
  // detail and the term is dropped; a valued one keeps both.
  expect(await page.evaluate(() => APP.preview)).toEqual([
    [undefined, "", "Urgent"],
    [undefined, "Valued", "escalated"],
  ]);
  // A row with no label is copied as its value alone, with no leading
  // "label:" separator.
  expect(await page.evaluate(() => APP.copyText)).toBe(
    "Urgent | Valued: escalated",
  );

  const terms = page.locator("#preview-list dt");
  await expect(terms).toHaveCount(1);
  await expect(terms).toHaveText("Valued");
});

test("joins multi-select values and skips empty selections", async ({
  page,
  app,
}) => {
  await mountSchema(page, {
    schema: [
      {
        type: "listbox",
        id: "regions",
        name: "regions",
        label: "Regions",
        options: [
          { label: "North", value: "north" },
          { label: "South", value: "south" },
          { label: "Blank", value: "" },
        ],
      },
      {
        type: "select",
        id: "priority",
        name: "priority",
        label: "Priority",
        options: [
          { label: "Choose", value: "" },
          { label: "High", value: "high" },
        ],
      },
    ],
  });

  // Nothing selected yet: the empty select contributes no row.
  expect(await page.evaluate(() => APP.preview)).toEqual([]);

  await page.locator("#regions").selectOption(["north", "south", ""]);
  await page.locator("#priority").selectOption("high");
  await page.evaluate(() => APP.formHelpers.renderPreview());

  expect(await page.evaluate(() => APP.preview)).toEqual([
    [undefined, "Regions", "north, south"],
    [undefined, "Priority", "high"],
  ]);
});

test("skips a select that has nothing to select", async ({ page, app }) => {
  await mountSchema(page, {
    schema: [
      { type: "select", id: "empty", name: "empty", label: "Empty", options: [] },
      { type: "text", id: "note", name: "note", label: "Note" },
    ],
  });

  await page.locator("#note").fill("kept");
  await page.evaluate(() => APP.formHelpers.renderPreview());

  // With no options there is no selection to read, so the select drops out
  // rather than contributing an empty row.
  expect(await page.evaluate(() => APP.preview)).toEqual([
    [undefined, "Note", "kept"],
  ]);
});

test("appends every matching footnote, gated by dependencies", async ({
  page,
  app,
}) => {
  await mountSchema(page, {
    schema: [
      { type: "text", id: "reviewer", name: "reviewer", label: "Reviewer" },
      { type: "checkbox", id: "audited", name: "audited", label: "Audited" },
      {
        type: "text",
        id: "case-id",
        name: "caseId",
        label: "Case",
        // Every rule that passes contributes, each in its own parentheses.
        footnotes: [
          { test: "/^C-/", footnote: "assigned to !{#reviewer}" },
          {
            test: "/^C-/",
            footnote: "audited",
            when: [["audited", true]],
          },
          { test: "no-match", footnote: "never shown" },
        ],
      },
    ],
  });

  await page.locator("#reviewer").fill("Ada");
  await page.locator("#case-id").fill("C-42");
  await page.evaluate(() => APP.formHelpers.renderPreview());

  expect(await page.evaluate(() => APP.preview)).toEqual([
    [undefined, "Reviewer", "Ada"],
    [undefined, "Case", "C-42 (assigned to Ada)"],
  ]);

  await page.locator("#audited").check();
  await page.evaluate(() => APP.formHelpers.renderPreview());
  await expect(page.locator("#preview-list")).toContainText(
    "C-42 (assigned to Ada) (audited)",
  );

  // A value that fails every footnote test keeps its bare value.
  await page.locator("#case-id").fill("X-1");
  await page.evaluate(() => APP.formHelpers.renderPreview());
  await expect(page.locator("#preview-list")).toContainText("X-1");
  await expect(page.locator("#preview-list")).not.toContainText("X-1 (");
});

test("gates footnotes on a checkbox and an input elsewhere in the same form", async ({
  page,
  app,
}) => {
  await mountSchema(page, {
    schema: [
      { type: "checkbox", id: "fc4", name: "fc4", label: "FC4" },
      { type: "text", id: "fc2", name: "fc2", label: "FC2" },
      {
        type: "text",
        id: "target1",
        name: "target1",
        label: "Target1",
        footnotes: [
          {
            test: "/.*/",
            when: [["fc4", true]],
            footnote: "A remote-controlled checkbox footnote",
          },
        ],
      },
      {
        type: "text",
        id: "target2",
        name: "target2",
        label: "Target2",
        footnotes: [
          // `/.*/` matches an empty string too, so it can't gate on
          // presence — `/.+/` (one or more characters) is what actually
          // withholds the footnote until fc2 has content.
          {
            test: "exact-value",
            when: [["fc2", "/.+/"]],
            footnote: "A remote-controlled input footnote",
          },
        ],
      },
    ],
  });

  await page.locator("#target1").fill("some value");
  await page.locator("#target2").fill("exact-value");
  await page.evaluate(() => APP.formHelpers.renderPreview());

  // Neither dependency is satisfied yet, so both stay bare.
  expect(await page.evaluate(() => APP.preview)).toEqual([
    [undefined, "Target1", "some value"],
    [undefined, "Target2", "exact-value"],
  ]);

  await page.locator("#fc4").check();
  await page.locator("#fc2").fill("anything");
  await page.evaluate(() => APP.formHelpers.renderPreview());

  expect(await page.evaluate(() => APP.preview)).toEqual([
    [undefined, "", "FC4"],
    [undefined, "FC2", "anything"],
    [undefined, "Target1", "some value (A remote-controlled checkbox footnote)"],
    [undefined, "Target2", "exact-value (A remote-controlled input footnote)"],
  ]);
});

test("gates footnotes on dependencies that are themselves wizard-revealed", async ({
  page,
  app,
}) => {
  await mountSchema(page, {
    schema: [
      {
        type: "checkbox",
        id: "invoke1",
        name: "invoke1",
        label: "Invoke1",
        wizards: [
          {
            test: true,
            wizard: { type: "checkbox", id: "fc4", name: "fc4", label: "FC4" },
          },
        ],
      },
      {
        type: "checkbox",
        id: "invoke2",
        name: "invoke2",
        label: "Invoke2",
        wizards: [
          {
            test: true,
            wizard: {
              type: "text",
              id: "fc2",
              name: "fc2",
              label: "FC2",
              // Interpolates another field's value, as in the live case.
              defaultValue: "seen: !{#invoke2}",
            },
          },
        ],
      },
      {
        type: "text",
        id: "target1",
        name: "target1",
        label: "Target1",
        footnotes: [
          {
            test: "/.*/",
            when: [["fc4", true]],
            footnote: "A remote-controlled checkbox footnote",
          },
        ],
      },
      {
        type: "text",
        id: "target2",
        name: "target2",
        label: "Target2",
        footnotes: [
          {
            test: "exact-value",
            when: [["fc2", "/.+/"]],
            footnote: "A remote-controlled input footnote",
          },
        ],
      },
    ],
  });

  await page.locator("#target1").fill("some value");
  await page.locator("#target2").fill("exact-value");
  await page.evaluate(() => APP.formHelpers.renderPreview());

  // Neither invoker is checked yet, so fc4/fc2 don't exist to satisfy
  // either dependency.
  expect(await page.evaluate(() => APP.preview)).toEqual([
    [undefined, "Target1", "some value"],
    [undefined, "Target2", "exact-value"],
  ]);

  await page.locator("#invoke1").check();
  await page.locator("#fc4").check();
  await page.locator("#invoke2").check();
  await page.evaluate(() => APP.formHelpers.renderPreview());

  expect(await page.evaluate(() => APP.preview)).toEqual([
    [undefined, "", "Invoke1"],
    [undefined, "", "FC4"],
    [undefined, "", "Invoke2"],
    [undefined, "FC2", "seen: true"],
    [undefined, "Target1", "some value (A remote-controlled checkbox footnote)"],
    [undefined, "Target2", "exact-value (A remote-controlled input footnote)"],
  ]);
});

test("carries a footnote into every value that interpolates its control", async ({
  page,
  app,
}) => {
  await mountSchema(page, {
    schema: [
      { type: "text", id: "text-1", name: "text1", label: "Text1" },
      { type: "checkbox", id: "checkbox-1", label: "Checkbox1" },
      {
        type: "text",
        id: "parent",
        name: "parent",
        label: "Parent",
        defaultValue: "Asked !{#fn-select}",
      },
      // Nameless, so it has no row of its own: its value, footnote
      // included, only ever reaches the preview through the parent.
      {
        type: "select",
        id: "fn-select",
        label: "FnSelect",
        options: [
          { label: "d", value: "Who" },
          { label: "e", value: "What" },
        ],
        footnotes: [
          {
            test: "e",
            when: [["text-1", "/.+/"]],
            footnote: "Blah blah blah",
          },
          {
            test: "/.+/",
            when: [["checkbox-1", true]],
            footnote: "Abrakadabra alakazam",
          },
        ],
      },
    ],
  });

  await page.locator("#fn-select").selectOption({ label: "e" });
  await page.evaluate(() => APP.formHelpers.renderPreview());

  // The dependency is empty, so the interpolated value stays bare.
  expect(await page.evaluate(() => APP.preview)).toEqual([
    [undefined, "Parent", "Asked What"],
  ]);

  await page.locator("#text-1").fill("anything");
  await page.evaluate(() => APP.formHelpers.renderPreview());

  expect(await page.evaluate(() => APP.preview)).toEqual([
    [undefined, "Text1", "anything"],
    [undefined, "Parent", "Asked What (Blah blah blah)"],
  ]);
  expect(await page.evaluate(() => APP.values.parent)).toEqual([
    "Asked What (Blah blah blah)",
  ]);

  // A second passing rule gets its own parentheses, in authored order.
  await page.locator("#checkbox-1").check();
  await page.evaluate(() => APP.formHelpers.renderPreview());

  expect(await page.evaluate(() => APP.values.parent)).toEqual([
    "Asked What (Blah blah blah) (Abrakadabra alakazam)",
  ]);
  await expect(page.locator("#preview-list")).toContainText(
    "Asked What (Blah blah blah) (Abrakadabra alakazam)",
  );
});

test("excludes unnamed and disabled controls from the preview", async ({
  page,
  app,
}) => {
  await mountSchema(page, {
    schema: [
      { type: "text", id: "named", name: "named", label: "Named" },
      { type: "text", id: "anonymous", label: "Anonymous" },
      {
        type: "text",
        id: "switched-off",
        name: "switchedOff",
        label: "Switched off",
        disabled: true,
        defaultValue: "ignored",
      },
      {
        type: "text",
        id: "whitespace",
        name: "whitespace",
        label: "Whitespace",
        defaultValue: "   ",
      },
    ],
  });

  await page.locator("#named").fill("kept");
  await page.locator("#anonymous").fill("dropped");
  await page.evaluate(() => APP.formHelpers.renderPreview());

  expect(await page.evaluate(() => APP.preview)).toEqual([
    [undefined, "Named", "kept"],
  ]);
});

test("enables the copy button only while the preview has rows", async ({
  page,
  app,
}) => {
  await mountSchema(page, {
    schema: [{ type: "text", id: "note", name: "note", label: "Note" }],
  });

  await expect(page.locator("#copy-preview")).toBeDisabled();

  await page.locator("#note").fill("Something");
  await expect(page.locator("#copy-preview")).toBeEnabled();

  await page.locator("#note").fill("");
  await expect(page.locator("#copy-preview")).toBeDisabled();
  expect(await page.evaluate(() => APP.charCount)).toBe(0);
});
