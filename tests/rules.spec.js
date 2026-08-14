import { expect, test } from "./setup.js";
import { mountSchema } from "./helpers/index.js";

test("fails closed on a dependency naming no control at all", async ({
  page,
  app,
}) => {
  await mountSchema(page, {
    schema: [
      {
        type: "text",
        id: "present",
        name: "present",
        label: "Present",
        criteria: [["missing-control", true]],
      },
    ],
  });

  // An unresolvable dependency hides the field rather than defaulting to
  // visible, and says nothing about it either way.
  await expect(page.locator("#present")).toBeHidden();
  expect(app.consoleWarnings).toEqual([]);
});

test("resolves a chain of dependent criteria in a single sync", async ({
  page,
  app,
}) => {
  await mountSchema(page, {
    schema: [
      {
        type: "checkbox",
        id: "show-details",
        name: "showDetails",
        label: "Show details",
      },
      {
        type: "select",
        id: "detail-type",
        name: "detailType",
        label: "Detail type",
        options: [
          { label: "Choose", value: "" },
          { label: "Expedited", value: "expedited" },
        ],
        criteria: [["show-details", true]],
      },
      {
        type: "textarea",
        id: "expedite-reason",
        name: "expediteReason",
        label: "Expedite reason",
        // Gated on a control that is itself gated, so this only settles in
        // one sync if rules apply in dependency order.
        criteria: [["detail-type", "Expedited"]],
      },
    ],
  });

  // "detail-type" is rendered and real — just disabled by its own rule,
  // which is an ordinary link in a chain. Resolution fails closed on it.
  await expect(page.locator("#detail-type")).toBeHidden();
  await expect(page.locator("#expedite-reason")).toBeHidden();

  await page.locator("#show-details").check();
  await expect(page.locator("#detail-type")).toBeVisible();

  await page.locator("#detail-type").selectOption("expedited");
  await expect(page.locator("#expedite-reason")).toBeVisible();

  // Collapsing the root takes the whole chain with it in the same sync.
  await page.locator("#show-details").uncheck();
  await expect(page.locator("#detail-type")).toBeHidden();
  await expect(page.locator("#expedite-reason")).toBeHidden();

  expect(app.consoleWarnings).toEqual([]);
});

test("fails closed on a dependency inside a criteria-gated fieldset", async ({
  page,
  app,
}) => {
  await mountSchema(page, {
    schema: [
      {
        type: "checkbox",
        id: "requires-shipping",
        name: "requiresShipping",
        label: "Requires shipping",
      },
      {
        type: "fieldset",
        id: "shipping-details",
        label: "Shipping details",
        // A whole group can be gated, which takes its members with it.
        criteria: [["requires-shipping", true]],
        members: [
          {
            type: "select",
            id: "shipping-method",
            name: "shippingMethod",
            label: "Shipping method",
            options: [
              { label: "Choose", value: "" },
              { label: "Expedited", value: "expedited" },
            ],
          },
        ],
      },
      {
        type: "textarea",
        id: "expedite-reason",
        name: "expediteReason",
        label: "Expedite reason",
        // Depends on a control reachable only while its group is open.
        criteria: [["shipping-method", "Expedited"]],
      },
    ],
  });

  await page.locator("#requires-shipping").check();
  await page.locator("#shipping-method").selectOption("expedited");
  await expect(page.locator("#expedite-reason")).toBeVisible();

  // Closing the group must take the dependent control with it: a control
  // reachable only through a hidden fieldset is no more available than one
  // hidden in its own right.
  await page.locator("#requires-shipping").uncheck();
  await expect(page.locator("#shipping-details")).toBeHidden();
  await expect(page.locator("#expedite-reason")).toBeHidden();

  expect(app.consoleWarnings).toEqual([]);
});

test("clears what a control held once a rule hides it", async ({
  page,
  app,
}) => {
  await mountSchema(page, {
    schema: [
      {
        type: "checkbox",
        id: "show-details",
        name: "showDetails",
        label: "Show details",
      },
      {
        type: "text",
        id: "detail-notes",
        name: "detailNotes",
        label: "Detail notes",
        criteria: [["show-details", true]],
      },
      {
        type: "select",
        id: "detail-type",
        name: "detailType",
        label: "Detail type",
        options: [
          { label: "Choose", value: "" },
          { label: "Expedited", value: "expedited" },
        ],
        criteria: [["show-details", true]],
      },
      {
        type: "checkbox",
        id: "detail-urgent",
        name: "detailUrgent",
        label: "Urgent",
        criteria: [["show-details", true]],
      },
      {
        type: "text",
        id: "detail-owner",
        name: "detailOwner",
        label: "Detail owner",
        // An authored default comes back as authored, not blanked.
        defaultValue: "unassigned",
        criteria: [["show-details", true]],
      },
    ],
  });

  await page.locator("#show-details").check();
  await page.locator("#detail-notes").fill("written while open");
  await page.locator("#detail-type").selectOption("expedited");
  await page.locator("#detail-urgent").check();
  await page.locator("#detail-owner").fill("Ada");

  // Hiding must not park a value out of sight, where nobody can see or
  // correct it and where it would reappear intact on the way back.
  await page.locator("#show-details").uncheck();
  await expect(page.locator("#detail-notes")).toHaveValue("");
  await expect(page.locator("#detail-type")).toHaveValue("");
  await expect(page.locator("#detail-urgent")).not.toBeChecked();
  await expect(page.locator("#detail-owner")).toHaveValue("unassigned");

  // Nothing hidden contributes to submission either.
  expect(
    await page
      .locator("#app-form")
      .evaluate((form) => [...new FormData(form).keys()]),
  ).not.toContain("detailNotes");
  expect(
    await page
      .locator("#app-form")
      .evaluate((form) => [...new FormData(form).keys()]),
  ).not.toContain("detailOwner");

  await page.locator("#show-details").check();
  await expect(page.locator("#detail-notes")).toHaveValue("");
  await expect(page.locator("#detail-owner")).toHaveValue("unassigned");
});

test("never marks a checkbox required, however it is asked", async ({
  page,
  app,
}) => {
  await mountSchema(page, {
    schema: [
      { type: "checkbox", id: "gate", name: "gate", label: "Gate" },
      // Asked for by the schema outright.
      {
        type: "checkbox",
        id: "confirm-accuracy",
        name: "confirmAccuracy",
        label: "I confirm this is accurate",
        constraints: { required: true },
      },
      // Asked for by a rule, and by one sharing a name with siblings.
      ...["alpha", "beta"].map((value) => ({
        type: "checkbox",
        id: `${value}-flag`,
        name: "flags",
        label: `${value} flag`,
        value,
        requisitions: [["gate", true]],
      })),
      // A text control still honours both routes, so this is about the
      // control type rather than requisitions being ignored wholesale.
      {
        type: "text",
        id: "reason",
        name: "reason",
        label: "Reason",
        requisitions: [["gate", true]],
      },
    ],
  });

  await page.locator("#gate").check();

  for (const id of ["confirm-accuracy", "alpha-flag", "beta-flag"]) {
    await expect(page.locator(`#${id}`)).not.toHaveAttribute("required", "");
  }

  await expect(page.locator("#reason")).toHaveAttribute("required", "");

  // Nothing ticked, and the form still validates once the one control that
  // can meaningfully be required is filled.
  await page.locator("#reason").fill("checked by hand");
  expect(
    await page.locator("#app-form").evaluate((form) => form.checkValidity()),
  ).toBe(true);
});

test("resolves rules keyed by a list fieldset's submission name", async ({
  page,
  app,
}) => {
  await mountSchema(page, {
    schema: [
      { type: "checkbox", id: "show-tags", name: "showTags", label: "Show tags" },
      // A list renders as a fieldset carrying the entry's id, so a rule on
      // it resolves to the container rather than to its rows.
      {
        type: "list",
        id: "tag-list",
        name: "tags",
        label: "Tags",
        criteria: [["show-tags", true]],
        requisitions: [["show-tags", true]],
      },
    ],
  });

  const list = page.locator("#tag-list");
  await expect(list).toBeHidden();
  await expect(list).toHaveAttribute("disabled", "");

  await page.locator("#show-tags").check();
  await expect(list).toBeVisible();
  await expect(list).not.toHaveAttribute("disabled", "");

  await page.locator("#show-tags").uncheck();
  await expect(list).toBeHidden();
});

test("ignores autofill and requisition rules for ineligible targets", async ({
  page,
  app,
}) => {
  await mountSchema(page, {
    schema: [
      { type: "checkbox", id: "gate", name: "gate", label: "Gate" },
      // None of these targets accept a scalar autofill value.
      {
        type: "checkbox",
        id: "flag",
        name: "flag",
        label: "Flag",
        autofills: [{ value: "true", when: [["gate", true]] }],
      },
      {
        type: "image",
        id: "proof",
        name: "proof",
        label: "Proof",
        autofills: [{ value: "ignored", when: [["gate", true]] }],
      },
      {
        type: "listbox",
        id: "regions",
        name: "regions",
        label: "Regions",
        options: [{ label: "North", value: "north" }],
        autofills: [{ value: "north", when: [["gate", true]] }],
      },
      {
        type: "text",
        id: "off",
        name: "off",
        label: "Disabled target",
        disabled: true,
        autofills: [{ value: "ignored", when: [["gate", true]] }],
      },
      {
        type: "list",
        id: "codes",
        name: "codes",
        label: "Codes",
        autofills: [{ value: "ignored", when: [["gate", true]] }],
        // A fieldset is not a settable requisition target either.
        requisitions: [["gate", true]],
      },
    ],
  });

  await page.locator("#gate").check();

  await expect(page.locator("#flag")).not.toBeChecked();
  await expect(page.locator("#proof")).toHaveValue("");
  await expect(page.locator("#regions")).toHaveValue("");
  await expect(page.locator("#off")).toHaveValue("");
  await expect(page.locator("#codes-0")).toHaveValue("");
  await expect(page.locator("#codes")).not.toHaveAttribute("required", "");
});

test("skips autofill rules whose dependencies never pass", async ({ page, app }) => {
  await mountSchema(page, {
    schema: [
      { type: "checkbox", id: "gate", name: "gate", label: "Gate" },
      {
        type: "text",
        id: "target",
        name: "target",
        label: "Target",
        autofills: [{ value: "filled", when: [["gate", false]] }],
      },
    ],
    // This case is specifically about the rule reapplying mid-edit, which
    // only happens in an app that syncs on every keystroke.
    syncOnInput: true,
  });

  // gate is unchecked, so the false-test rule matches and fills.
  await expect(page.locator("#target")).toHaveValue("filled");

  // While a rule still matches it is reapplied on every sync, so an edit
  // made under that condition is overwritten.
  await page.locator("#target").fill("manual");
  await expect(page.locator("#target")).toHaveValue("filled");

  // Once no rule matches, the target is left alone entirely — the previous
  // autofill is not cleared, and later edits stick.
  await page.locator("#gate").check();
  await expect(page.locator("#target")).toHaveValue("filled");
  await page.locator("#target").fill("manual");
  await expect(page.locator("#target")).toHaveValue("manual");
});

test("clears an autofill target when the rule resolves to nothing", async ({
  page,
  app,
}) => {
  await mountSchema(page, {
    schema: [
      { type: "checkbox", id: "gate", name: "gate", label: "Gate" },
      {
        type: "text",
        id: "target",
        name: "target",
        label: "Target",
        autofills: [{ value: undefined, when: [["gate", true]] }],
      },
    ],
  });

  await page.locator("#target").fill("manual");
  await page.locator("#gate").check();

  // A rule with no value stringifies to empty rather than "undefined".
  await expect(page.locator("#target")).toHaveValue("");
});

test("requires every dependency across controls sharing a name", async ({
  page,
  app,
}) => {
  await mountSchema(page, {
    schema: [
      ...["alpha", "beta"].map((value) => ({
        type: "checkbox",
        id: `${value}-flag`,
        name: "flags",
        label: `${value} flag`,
        value,
      })),
      {
        type: "text",
        id: "detail",
        name: "detail",
        label: "Detail",
        criteria: [["flags", "beta"]],
      },
    ],
  });

  const detail = page.locator("#detail");
  await expect(detail).toBeHidden();

  // Values are pooled across every control with the name, so checking the
  // matching one is enough.
  await page.locator("#alpha-flag").check();
  await expect(detail).toBeHidden();

  await page.locator("#beta-flag").check();
  await expect(detail).toBeVisible();

  await page.locator("#beta-flag").uncheck();
  await expect(detail).toBeHidden();
});

test("ignores disabled controls when resolving dependencies", async ({
  page,
  app,
}) => {
  await mountSchema(page, {
    schema: [
      { type: "checkbox", id: "outer", name: "outer", label: "Outer" },
      {
        type: "checkbox",
        id: "inner",
        name: "inner",
        label: "Inner",
        criteria: [["outer", true]],
      },
      {
        type: "text",
        id: "detail",
        name: "detail",
        label: "Detail",
        criteria: [["inner", true]],
      },
    ],
  });

  await page.locator("#outer").check();
  await page.locator("#inner").check();
  await expect(page.locator("#detail")).toBeVisible();

  // Hiding `inner` disables it, which removes it from dependency
  // resolution and collapses everything that depended on it.
  await page.locator("#outer").uncheck();
  await expect(page.locator("#inner")).toBeDisabled();
  await expect(page.locator("#detail")).toBeHidden();
});

test("re-reveals a chained criteria target in the same sync", async ({
  page,
  app,
}) => {
  // Deliberately no extra listeners: APP.init installs a single `change`
  // handler on the app form, so each interaction triggers exactly one
  // sync pass. Wiring `input` as well would sync twice and mask an
  // ordering fault behind the second pass.
  await page.evaluate(() => {
    APP.rules.criteriaRules = {
      // `detail` depends on `gate`, which is itself criteria-gated. Rule
      // order puts the dependent first, which is what a consumer gets by
      // authoring rules in schema order.
      detail: [["gate", true]],
      gate: [["outer", true]],
    };
    APP.formControls.replaceChildren(
      APP.renderEntries([
        { type: "checkbox", id: "outer", name: "outer", label: "Outer" },
        { type: "checkbox", id: "gate", name: "gate", label: "Gate" },
        { type: "text", id: "detail", name: "detail", label: "Detail" },
      ]),
    );
    APP.formHelpers.syncWizards();
  });

  const gate = page.locator("#gate");
  const detail = page.locator("#detail");

  await page.locator("#outer").check();
  await gate.check();
  await expect(detail).toBeVisible();

  // Collapsing the chain disables `gate`, which correctly hides `detail`.
  await page.locator("#outer").uncheck();
  await expect(gate).toBeDisabled();
  await expect(detail).toBeHidden();

  // Re-opening it brings `gate` back enabled but reset, since hiding a
  // control clears what it held. `detail` therefore stays closed until the
  // dependency is satisfied again.
  await page.locator("#outer").check();
  await expect(gate).toBeEnabled();
  await expect(gate).not.toBeChecked();
  await expect(detail).toBeHidden();

  // Satisfying it re-reveals `detail` within the same sync rather than
  // needing a further interaction to settle.
  await gate.check();
  await expect(detail).toBeVisible();
});

test("re-reveals a wizard gated by a criteria-controlled dependency", async ({
  page,
  app,
}) => {
  // Single-pass wiring again: the library's own change handler only.
  await page.evaluate(() => {
    const wizards = [
      {
        test: true,
        when: [["gate", true]],
        wizard: {
          type: "text",
          id: "detail",
          name: "detail",
          label: "Detail",
        },
      },
    ];

    APP.rules.criteriaRules = { gate: [["outer", true]] };
    APP.rules.wizardRules = { trigger: wizards };
    APP.formControls.replaceChildren(
      APP.renderEntries([
        { type: "checkbox", id: "outer", name: "outer", label: "Outer" },
        { type: "checkbox", id: "gate", name: "gate", label: "Gate" },
        {
          type: "checkbox",
          id: "trigger",
          name: "trigger",
          label: "Trigger",
          wizards,
        },
      ]),
    );
    APP.formHelpers.syncWizards();
  });

  const gate = page.locator("#gate");
  const detail = page.locator("#detail");

  await page.locator("#outer").check();
  await gate.check();
  await page.locator("#trigger").check();
  await expect(detail).toBeVisible();

  // Disabling the wizard's dependency collapses it.
  await page.locator("#outer").uncheck();
  await expect(gate).toBeDisabled();
  await expect(detail).toBeHidden();

  // Restoring the dependency brings `gate` back enabled but reset, so the
  // wizard stays closed until it is satisfied again.
  await page.locator("#outer").check();
  await expect(gate).toBeEnabled();
  await expect(gate).not.toBeChecked();
  await expect(detail).toBeHidden();

  // Satisfying it must bring the wizard back in this sync — the wizard
  // pass runs before criteria re-reads `gate`, so this only holds if both
  // are driven to a fixed point.
  await gate.check();
  await expect(detail).toBeVisible();
});

test("starts a list hidden when a wizard owns it", async ({ page, app }) => {
  const wizards = [
    {
      test: true,
      wizard: { type: "list", id: "notes", name: "notes", label: "Notes" },
    },
  ];

  await mountSchema(page, {
    schema: [
      {
        type: "checkbox",
        id: "add-notes",
        name: "addNotes",
        label: "Add notes",
        wizards,
      },
    ],
    listeners: false,
  });

  // A list reached through a wizard renders hidden and disabled, so its
  // rows submit nothing until the controller reveals it.
  const list = page.locator("#notes");
  await expect(list).toBeHidden();
  await expect(list).toHaveAttribute("disabled", "");

  await page.locator("#add-notes").check();
  await expect(list).toBeVisible();
  await expect(page.locator("#notes-0")).toBeEnabled();

  await page.locator("#notes-0").fill("first");
  expect(
    await page
      .locator("#app-form")
      .evaluate((form) => new FormData(form).get("notes")),
  ).toBe("first");
});

test("routes each rule family through the store independently", async ({
  page,
  app,
}) => {
  expect(
    await page.evaluate(() => {
      const families = Object.keys(APP.rules);

      APP.rules.alertRules = { a: [] };
      // Only the known families have store-backed accessors; anything else
      // becomes an inert own property on the facade.
      APP.rules.notARule = { b: [] };

      return {
        families,
        alertRules: APP.rules.alertRules,
        untouchedFamily: APP.rules.wizardRules,
        unknownIsInert:
          Object.getOwnPropertyDescriptor(APP.rules, "notARule").get ===
          undefined,
      };
    }),
  ).toEqual({
    families: [
      "modalRules",
      "articleRules",
      "alertRules",
      "footnoteRules",
      "wizardRules",
      "criteriaRules",
      "requisitionRules",
      "autofillRules",
      "feedbackWizardRules",
      "feedbackCriteriaRules",
      "feedbackRequisitionRules",
      "feedbackAutofillRules",
      "feedbackAlertRules",
      "feedbackModalRules",
    ],
    alertRules: { a: [] },
    untouchedFamily: {},
    unknownIsInert: true,
  });
});

test("syncs modals only for controls that own a rule", async ({ page, app }) => {
  await mountSchema(page, {
    schema: [
      { type: "text", id: "anonymous", label: "Anonymous" },
      {
        type: "checkbox",
        id: "watched",
        name: "watched",
        label: "Watched",
        modals: [
          {
            test: true,
            modal: { type: "message", header: "Noted", message: "Recorded." },
          },
        ],
      },
      {
        type: "checkbox",
        id: "unwatched",
        name: "unwatched",
        label: "Unwatched",
        // A rule whose test never passes must not open anything.
        modals: [
          {
            test: "never",
            modal: { type: "message", header: "Never", message: "Never." },
          },
        ],
      },
    ],
  });

  // A control with neither id-keyed nor name-keyed rules is skipped, and a
  // synthetic event with no target returns early.
  await page.evaluate(() => APP.formHelpers.syncModals());
  await page.evaluate(() => APP.formHelpers.syncModals({ target: null }));
  await page.locator("#anonymous").fill("text");
  await page.locator("#unwatched").check();
  await expect(page.locator("#message-modal")).not.toHaveAttribute("open", "");

  await page.locator("#watched").check();
  await expect(page.locator("#message-modal")).toHaveAttribute("open", "");
  await expect(page.locator("#message-modal-header")).toHaveText("Noted");
});

test("re-renders control alerts on every change", async ({ page, app }) => {
  await mountSchema(page, {
    schema: [
      {
        type: "select",
        id: "status",
        name: "status",
        label: "Status",
        options: [
          { label: "Choose", value: "" },
          { label: "Open", value: "open" },
          { label: "Blocked", value: "blocked" },
        ],
        alerts: [
          {
            test: "Blocked",
            alert: { variant: "warning", message: "Escalate this case." },
          },
          {
            test: "Open",
            alert: { variant: "note", message: "Awaiting triage." },
          },
        ],
      },
      // A container renders for any control carrying alerts, so one whose
      // rule never passes stays empty rather than never existing.
      {
        type: "text",
        id: "unruled",
        name: "unruled",
        label: "Unruled",
        alerts: [
          { test: "never-matches", alert: { variant: "note", message: "Unused." } },
        ],
      },
    ],
  });

  const alerts = page.locator('.control-alerts[data-control-id="status"]');
  await expect(alerts).toBeEmpty();

  await page.locator("#status").selectOption("blocked");
  await expect(alerts).toContainText("Escalate this case.");
  await expect(alerts).not.toContainText("Awaiting triage.");

  // Switching value replaces the previous alert rather than appending.
  await page.locator("#status").selectOption("open");
  await expect(alerts).toContainText("Awaiting triage.");
  await expect(alerts).not.toContainText("Escalate this case.");

  await page.locator("#status").selectOption("");
  await expect(alerts).toBeEmpty();
  await expect(
    page.locator('.control-alerts[data-control-id="unruled"]'),
  ).toBeEmpty();
});

test("leaves alert containers alone when their control is gone", async ({
  page,
  app,
}) => {
  await mountSchema(page, {
    schema: [
      {
        type: "text",
        id: "orphan",
        name: "orphan",
        label: "Orphan",
        alerts: [
          { test: true, alert: { variant: "note", message: "Present." } },
        ],
      },
    ],
  });

  await page.locator("#orphan").fill("value");
  await expect(page.locator(".control-alerts")).toContainText("Present.");

  // Removing the control leaves the container orphaned; syncing must not
  // throw or clear what is already rendered.
  await page.evaluate(() => {
    document.getElementById("orphan").remove();
    APP.formHelpers.syncAlerts();
  });
  await expect(page.locator(".control-alerts")).toContainText("Present.");
});
