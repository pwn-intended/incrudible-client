import { deriveRules } from "./rules.js";

/**
 * Renders a schema into #form-controls and wires the consumer-level
 * listeners an app installs on top of the library.
 *
 * Rules are derived from the schema rather than passed alongside it. A
 * server builds one from the other on every response, so the two cannot
 * disagree in production; accepting them separately here would let a test
 * describe a payload that cannot exist, and would stop exercising the
 * derivation at all. Author entry-level `criteria`, `wizards`, `alerts`
 * and the rest on the schema, exactly as a real workflow config does.
 *
 * Deliberately does NOT call syncWizards from those listeners: APP.init
 * already installs a `change` handler that does it, so adding another
 * would run the rule sync twice per interaction. That matters — the rule
 * sync mutates the `disabled` state its own dependency resolution reads,
 * so a second pass silently repairs ordering faults a real single-pass app
 * would show.
 *
 * @param {import("@playwright/test").Page} page - The page to mount into.
 * @param {object} options - Mount options.
 * @param {object[]} options.schema - Schema entries to render, carrying their own rules.
 * @param {boolean} [options.preview] - Re-render the preview on input and change.
 * @param {boolean} [options.syncOnInput] - Also sync rules on every keystroke, for tests that need it.
 * @param {boolean} [options.listeners] - Attach consumer listeners at all; false leaves only the library's own handlers, which is what a single-pass app has.
 * @returns {Promise<void>} Resolves once the schema is mounted and synced.
 */
const mountSchema = async (
  page,
  { schema, preview = true, syncOnInput = false, listeners = true },
) =>
  page.evaluate(
    ({ schema, rules, preview, syncOnInput, listeners }) => {
      for (const [name, value] of Object.entries(rules)) {
        APP.rules[name] = value;
      }

      APP.formControls.replaceChildren(APP.renderEntries(schema));

      if (listeners) {
        APP.formHelpers.formControls.forEach((control) => {
          control.addEventListener("input", () => {
            if (syncOnInput) {
              APP.formHelpers.syncWizards();
            }

            if (preview) {
              APP.formHelpers.renderPreview();
            }
          });
          control.addEventListener("change", (event) => {
            APP.formHelpers.syncModals(event);
            APP.formHelpers.syncAlerts();
            APP.formHelpers.syncArticles();

            if (preview) {
              APP.formHelpers.renderPreview();
            }
          });
        });
      }

      // Mount-time sync is independent of the listeners: a schema is
      // brought in step with its rules either way, and `preview` alone
      // decides whether the preview is rendered.
      APP.formHelpers.syncWizards();
      APP.formHelpers.syncAlerts();

      if (preview) {
        APP.formHelpers.renderPreview();
      }
    },
    {
      schema,
      rules: deriveRules(schema),
      preview,
      syncOnInput,
      listeners,
    },
  );

/**
 * Renders a schema and returns the resulting markup, for tests asserting
 * on what the renderers produce rather than on behavior.
 *
 * @param {import("@playwright/test").Page} page - The page to render into.
 * @param {object[]} schema - Schema entries to render.
 * @returns {Promise<string>} The rendered markup.
 */
const renderSchema = (page, schema) =>
  page.evaluate((entries) => {
    APP.formControls.replaceChildren(APP.renderEntries(entries));
    return APP.formControls.innerHTML;
  }, schema);

/**
 * Serializes the attributes and state of one rendered control, keeping
 * assertions in Node rather than spreading evaluate() calls across every
 * rendering case.
 *
 * @param {import("@playwright/test").Page} page - The page holding the control.
 * @param {string} id - The control's element id.
 * @returns {Promise<Record<string, unknown>>} The control's attributes and state.
 */
const describeControl = (page, id) =>
  page.evaluate((controlId) => {
    const control = document.getElementById(controlId);

    return {
      tag: control.tagName,
      type: control.type,
      dataType: control.dataset.type ?? null,
      value: control.value,
      name: control.name,
      className: control.className,
      required: control.required,
      disabled: control.disabled,
      readOnly: "readOnly" in control ? control.readOnly : null,
      minLength: "minLength" in control ? control.minLength : null,
      maxLength: "maxLength" in control ? control.maxLength : null,
      pattern: control.getAttribute("pattern"),
      min: control.getAttribute("min"),
      max: control.getAttribute("max"),
      step: control.getAttribute("step"),
      placeholder: control.getAttribute("placeholder"),
      autocomplete: control.getAttribute("autocomplete"),
      inputMode: control.getAttribute("inputmode"),
      accept: control.getAttribute("accept"),
      multiple: control.multiple ?? null,
      list: control.getAttribute("list"),
    };
  }, id);

export { describeControl, mountSchema, renderSchema };
