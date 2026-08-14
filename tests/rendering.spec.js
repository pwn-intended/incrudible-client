import { expect, test } from "./setup.js";
import { describeControl, renderSchema } from "./helpers/index.js";

// Renders a schema and returns a serialized description of the result,
// keeping the assertions in Node rather than spreading evaluate() calls
// across every case.
test("maps every scalar entry type onto the right input type", async ({
  page,
  app,
}) => {
  await renderSchema(
    page,
    [
      "text",
      "email",
      "search",
      "tel",
      "password",
      "url",
      "date",
      "datetime",
      "time",
      "number",
      "currency",
      "image",
    ].map((type) => ({
      type,
      id: `field-${type}`,
      name: type,
      label: type,
    })),
  );

  const types = await page.evaluate(() =>
    Object.fromEntries(
      Array.from(document.querySelectorAll("#form-controls input")).map(
        (input) => [input.id, input.type],
      ),
    ),
  );

  expect(types).toEqual({
    "field-text": "text",
    "field-email": "email",
    "field-search": "search",
    "field-tel": "tel",
    "field-password": "password",
    "field-url": "url",
    "field-date": "date",
    "field-datetime": "datetime-local",
    "field-time": "time",
    "field-number": "number",
    "field-currency": "text",
    "field-image": "file",
  });
});

test("marks currency and number inputs for downstream formatting", async ({
  page,
  app,
}) => {
  await renderSchema(page, [
    { type: "currency", id: "amount", name: "amount", label: "Amount" },
    { type: "number", id: "count", name: "count", label: "Count" },
    { type: "text", id: "plain", name: "plain", label: "Plain" },
  ]);

  // Currency renders as text, so dataset.type is the only way a consumer
  // can tell it apart — and it gets a numeric keypad by default.
  const amount = await describeControl(page, "amount");
  expect(amount.type).toBe("text");
  expect(amount.dataType).toBe("currency");
  expect(amount.inputMode).toBe("decimal");

  expect((await describeControl(page, "count")).dataType).toBe("number");
  expect((await describeControl(page, "plain")).dataType).toBeNull();

  // An explicit inputMode wins over the currency default.
  await renderSchema(page, [
    {
      type: "currency",
      id: "amount",
      name: "amount",
      label: "Amount",
      inputMode: "numeric",
    },
  ]);
  expect((await describeControl(page, "amount")).inputMode).toBe("numeric");

  // The currency/number helpers select on those markers.
  expect(
    await page.evaluate(() =>
      APP.formHelpers.currencyInputs.map((control) => control.id),
    ),
  ).toEqual(["amount"]);
});

test("applies constraints and presentation attributes to inputs", async ({
  page,
  app,
}) => {
  await renderSchema(page, [
    {
      type: "text",
      id: "code",
      name: "code",
      label: "Code",
      placeholder: "ABC-123",
      autocomplete: "off",
      width: 3,
      hint: "Uppercase letters, a dash, then digits.",
      constraints: {
        required: true,
        minLength: 3,
        maxLength: 7,
        pattern: "[A-Z]{3}-\\d{3}",
      },
    },
    {
      type: "number",
      id: "score",
      name: "score",
      label: "Score",
      step: 5,
      constraints: { min: 0, max: 100 },
      disabled: true,
    },
    {
      type: "text",
      id: "locked",
      name: "locked",
      label: "Locked",
      readonly: true,
      defaultValue: "fixed",
    },
  ]);

  const code = await describeControl(page, "code");
  expect(code).toMatchObject({
    required: true,
    minLength: 3,
    maxLength: 7,
    pattern: "[A-Z]{3}-\\d{3}",
    placeholder: "ABC-123",
    autocomplete: "off",
  });

  const score = await describeControl(page, "score");
  expect(score).toMatchObject({ min: "0", max: "100", step: "5", disabled: true });

  const locked = await describeControl(page, "locked");
  expect(locked).toMatchObject({ readOnly: true, value: "fixed" });

  // Width lands on the label, and a hint renders a tooltip beside the text.
  await expect(page.locator('label[for="code"]')).toHaveClass("form-control w-3");
  await expect(page.locator('label[for="code"] .tooltip-text')).toHaveText(
    "Uppercase letters, a dash, then digits.",
  );
  await expect(page.locator('label[for="score"] .tooltip')).toHaveCount(0);
  await expect(page.locator('label[for="score"]')).toHaveClass(
    "form-control w-1",
  );
});

test("configures image inputs for single and multiple selection", async ({
  page,
  app,
}) => {
  await renderSchema(page, [
    {
      type: "image",
      id: "proof",
      name: "proof",
      label: "Proof",
      defaultValue: "ignored",
    },
    {
      type: "image",
      id: "gallery",
      name: "gallery",
      label: "Gallery",
      multiple: true,
    },
  ]);

  const proof = await describeControl(page, "proof");
  expect(proof).toMatchObject({ accept: "image/*", multiple: false });
  // A file input can't carry a default value; it must be dropped.
  expect(proof.value).toBe("");
  expect((await describeControl(page, "gallery")).multiple).toBe(true);
});

test("renders a datalist for entries that supply suggestions", async ({
  page,
  app,
}) => {
  await renderSchema(page, [
    {
      type: "text",
      id: "team",
      name: "team",
      label: "Team",
      list: ["Alpha", "Bravo", "Charlie"],
    },
    { type: "text", id: "freeform", name: "freeform", label: "Freeform" },
  ]);

  expect((await describeControl(page, "team")).list).toBe("team-list");
  await expect(page.locator("datalist#team-list option")).toHaveCount(3);
  expect(
    await page.evaluate(() =>
      Array.from(document.querySelectorAll("#team-list option")).map(
        (option) => option.value,
      ),
    ),
  ).toEqual(["Alpha", "Bravo", "Charlie"]);
  expect((await describeControl(page, "freeform")).list).toBeNull();
});

test("renders textareas with their own constraint set", async ({ page, app }) => {
  await renderSchema(page, [
    {
      type: "textarea",
      id: "summary",
      name: "summary",
      label: "Summary",
      rows: 6,
      placeholder: "What happened?",
      autocomplete: "off",
      defaultValue: "Prefilled",
      constraints: { required: true, minLength: 10, maxLength: 500 },
    },
  ]);

  const summary = await describeControl(page, "summary");
  expect(summary).toMatchObject({
    tag: "TEXTAREA",
    value: "Prefilled",
    required: true,
    minLength: 10,
    maxLength: 500,
    placeholder: "What happened?",
    autocomplete: "off",
  });
  await expect(page.locator("#summary")).toHaveAttribute("rows", "6");

  // A textarea never becomes a wizard container even when wizards exist.
  await renderSchema(page, [
    {
      type: "textarea",
      id: "notes",
      name: "notes",
      label: "Notes",
      wizards: [
        { test: true, wizard: { type: "text", id: "extra", label: "Extra" } },
      ],
    },
  ]);
  await expect(page.locator("#form-controls fieldset.wizard")).toHaveCount(0);
  await expect(page.locator("#extra")).toHaveCount(0);
});

test("renders selects with rich options and a customizable-select shell", async ({
  page,
  app,
}) => {
  await renderSchema(page, [
    {
      type: "select",
      id: "priority",
      name: "priority",
      label: "Priority",
      defaultValue: "high",
      options: [
        { label: "Choose", value: "" },
        { label: "High", value: "high", icon: "<svg></svg>" },
        { value: "low" },
      ],
    },
  ]);

  await expect(
    page.locator("#priority > button.select-button > selectedcontent"),
  ).toHaveCount(1);
  await expect(page.locator('#priority option[value=""]')).toHaveClass(
    "select-placeholder",
  );
  await expect(
    page.locator('#priority option[value="high"] .icon'),
  ).toHaveCount(1);
  // A label-less option falls back to its value for display text.
  await expect(
    page.locator('#priority option[value="low"] .option-label'),
  ).toHaveText("low");
  await expect(page.locator("#priority")).toHaveValue("high");
});

test("renders listboxes with multi-selection defaults", async ({ page, app }) => {
  await renderSchema(page, [
    {
      type: "listbox",
      id: "regions",
      name: "regions",
      label: "Regions",
      size: 4,
      collapsed: true,
      defaultValue: ["north", "south"],
      options: [
        { label: "North", value: "north" },
        { label: "South", value: "south" },
        { label: "East", value: "east" },
      ],
    },
  ]);

  const regions = await describeControl(page, "regions");
  expect(regions).toMatchObject({ tag: "SELECT", multiple: true, className: "collapsed" });
  await expect(page.locator("#regions")).toHaveAttribute("size", "4");
  // A listbox gets no customizable-select button.
  await expect(page.locator("#regions button.select-button")).toHaveCount(0);

  expect(
    await page.evaluate(() =>
      Array.from(document.querySelector("#regions").selectedOptions).map(
        (option) => option.value,
      ),
    ),
  ).toEqual(["north", "south"]);
  expect(
    await page.evaluate(() =>
      APP.formHelpers.listboxes.map((control) => control.id),
    ),
  ).toEqual(["regions"]);
});

test("renders checkbox and radio values, defaults, and freeform styling", async ({
  page,
  app,
}) => {
  await renderSchema(page, [
    { type: "checkbox", id: "plain-check", name: "plainCheck", label: "Plain" },
    {
      type: "checkbox",
      id: "valued-check",
      name: "valuedCheck",
      label: "Valued",
      value: "yes",
      checked: true,
    },
    {
      type: "checkbox",
      id: "default-checked",
      name: "defaultChecked",
      label: "Default checked",
      defaultChecked: true,
    },
    {
      type: "radio",
      id: "freeform-radio",
      name: "choice",
      label: "Freeform",
      value: "other",
      freeform: true,
    },
    { type: "radio", id: "bare-radio", name: "choice", label: "Bare" },
  ]);

  // A bare checkbox submits "true" rather than the browser default "on".
  expect((await describeControl(page, "plain-check")).value).toBe("true");
  expect(await describeControl(page, "valued-check")).toMatchObject({
    value: "yes",
  });
  await expect(page.locator("#valued-check")).toBeChecked();
  await expect(page.locator("#default-checked")).toBeChecked();
  await expect(page.locator("#freeform-radio")).toHaveClass("freeform");
  expect((await describeControl(page, "freeform-radio")).value).toBe("other");
  // Only a checkbox gets the "true" default; a value-less radio keeps the
  // browser's own "on".
  expect((await describeControl(page, "bare-radio")).value).toBe("on");

  expect(
    await page.evaluate(() =>
      APP.formHelpers.checkboxes.map((control) => control.id),
    ),
  ).toEqual(["plain-check", "valued-check", "default-checked"]);
  expect(
    await page.evaluate(() =>
      APP.formHelpers.radios.map((control) => control.id),
    ),
  ).toEqual(["freeform-radio", "bare-radio"]);
});

test("renders grouped fieldsets with a legend and nested members", async ({
  page,
  app,
}) => {
  await renderSchema(page, [
    {
      type: "fieldset",
      id: "contact-group",
      label: "Contact <em>details</em>",
      members: [
        { type: "text", id: "contact-name", name: "contactName", label: "Name" },
        {
          type: "email",
          id: "contact-email",
          name: "contactEmail",
          label: "Email",
        },
      ],
    },
    {
      type: "fieldset",
      label: "Disabled group",
      disabled: true,
      members: [
        { type: "text", id: "disabled-member", name: "disabledMember", label: "Member" },
      ],
    },
  ]);

  await expect(page.locator("#contact-group > legend")).toHaveText(
    "Contact details",
  );
  await expect(page.locator("#contact-group #contact-name")).toHaveCount(1);
  await expect(page.locator("#contact-group #contact-email")).toHaveCount(1);
  await expect(page.locator("#disabled-member")).toBeDisabled();

  // Group fieldsets are the only ones the helper reports — wizard and list
  // fieldsets are excluded by class.
  expect(
    await page.evaluate(() =>
      APP.formHelpers.fieldsets.map((control) => control.id),
    ),
  ).toEqual(["contact-group", ""]);
});

test("renders typed lists with their constraints on the fieldset", async ({
  page,
  app,
}) => {
  await renderSchema(page, [
    {
      type: "list:number",
      id: "amounts",
      name: "amounts",
      label: "Amounts",
      width: 2,
      disabled: true,
      constraints: {
        required: true,
        minLength: 1,
        maxLength: 9,
        pattern: "\\d+",
        min: 0,
        max: 500,
      },
    },
    { type: "list", id: "plain-list", label: "Plain list" },
  ]);

  const amounts = await page.evaluate(() => {
    const fieldset = document.getElementById("amounts");
    const input = fieldset.querySelector("input");

    return {
      className: fieldset.className,
      dataset: { ...fieldset.dataset },
      disabled: fieldset.disabled,
      inputType: input.type,
      inputId: input.id,
      inputName: input.name,
      inputRequired: input.required,
      inputMin: input.getAttribute("min"),
      inputMax: input.getAttribute("max"),
      inputPattern: input.getAttribute("pattern"),
    };
  });

  expect(amounts).toEqual({
    className: "list w-2",
    // The container carries identity only. Constraints live on the rows
    // they actually validate, which is where the row builder reads them.
    dataset: { name: "amounts", type: "number" },
    disabled: true,
    inputType: "number",
    inputId: "amounts-0",
    inputName: "amounts",
    inputRequired: true,
    inputMin: "0",
    inputMax: "500",
    inputPattern: "\\d+",
  });

  // A plain list defaults to text items, and a name-less list leaves its
  // entries unnamed so nothing is submitted for it.
  const plain = await page.evaluate(() => {
    const fieldset = document.getElementById("plain-list");
    const input = fieldset.querySelector("input");

    return {
      className: fieldset.className,
      dataset: { ...fieldset.dataset },
      inputType: input.type,
      inputName: input.name,
    };
  });
  expect(plain).toEqual({
    className: "list w-1",
    dataset: {},
    inputType: "text",
    inputName: "",
  });

  expect(
    await page.evaluate(() => APP.formHelpers.lists.map((list) => list.id)),
  ).toEqual(["amounts", "plain-list"]);
});

test("keeps name-less list rows unnamed while reindexing", async ({ page, app }) => {
  await renderSchema(page, [{ type: "list", id: "plain-list", label: "Plain list" }]);

  await page.locator(".list-add").click();
  await page.locator(".list-add").click();
  await page.getByRole("button", { name: "Remove" }).first().click();

  expect(
    await page.locator("#plain-list input").evaluateAll((inputs) =>
      inputs.map((input) => ({ id: input.id, name: input.name })),
    ),
  ).toEqual([
    { id: "plain-list-0", name: "" },
    { id: "plain-list-1", name: "" },
  ]);
});

test("groups every control type through the form helper accessors", async ({
  page,
  app,
}) => {
  await renderSchema(page, [
    { type: "text", id: "a-text", name: "aText", label: "Text" },
    { type: "email", id: "a-email", name: "aEmail", label: "Email" },
    { type: "search", id: "a-search", name: "aSearch", label: "Search" },
    { type: "tel", id: "a-tel", name: "aTel", label: "Tel" },
    { type: "url", id: "a-url", name: "aUrl", label: "Url" },
    { type: "password", id: "a-password", name: "aPassword", label: "Password" },
    { type: "date", id: "a-date", name: "aDate", label: "Date" },
    { type: "datetime", id: "a-datetime", name: "aDatetime", label: "Datetime" },
    { type: "time", id: "a-time", name: "aTime", label: "Time" },
    { type: "number", id: "a-number", name: "aNumber", label: "Number" },
    { type: "currency", id: "a-currency", name: "aCurrency", label: "Currency" },
    { type: "textarea", id: "a-textarea", name: "aTextarea", label: "Textarea" },
    {
      type: "select",
      id: "a-select",
      name: "aSelect",
      label: "Select",
      options: [{ label: "One", value: "one" }],
    },
    {
      type: "listbox",
      id: "a-listbox",
      name: "aListbox",
      label: "Listbox",
      options: [{ label: "One", value: "one" }],
    },
  ]);

  const helpers = await page.evaluate(() => {
    const ids = (controls) => controls.map((control) => control.id);
    const helper = APP.formHelpers;

    return {
      textInputs: ids(helper.textInputs),
      emailInputs: ids(helper.emailInputs),
      searchInputs: ids(helper.searchInputs),
      telInputs: ids(helper.telInputs),
      urlInputs: ids(helper.urlInputs),
      passwordInputs: ids(helper.passwordInputs),
      dateInputs: ids(helper.dateInputs),
      datetimeInputs: ids(helper.datetimeInputs),
      timeInputs: ids(helper.timeInputs),
      numberInputs: ids(helper.numberInputs),
      currencyInputs: ids(helper.currencyInputs),
      textAreas: ids(helper.textAreas),
      selects: ids(helper.selects),
      listboxes: ids(helper.listboxes),
      dropdowns: ids(helper.dropdowns),
      formControlCount: helper.formControls.length,
    };
  });

  expect(helpers).toEqual({
    // Currency renders as type=text, so it lands in textInputs too.
    textInputs: ["a-text", "a-currency"],
    emailInputs: ["a-email"],
    searchInputs: ["a-search"],
    telInputs: ["a-tel"],
    urlInputs: ["a-url"],
    passwordInputs: ["a-password"],
    dateInputs: ["a-date"],
    datetimeInputs: ["a-datetime"],
    timeInputs: ["a-time"],
    numberInputs: ["a-number"],
    currencyInputs: ["a-currency"],
    textAreas: ["a-textarea"],
    selects: ["a-select"],
    listboxes: ["a-listbox"],
    dropdowns: ["a-select", "a-listbox"],
    formControlCount: 14,
  });
});
