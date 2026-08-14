/**
 * @file incrudible-client — shared client framework for InCRUDibly-based
 * Apps Script apps. `APP` is the only export; it's the house for
 * everything (DOM accessors as live getters, render helpers, rule state),
 * so a consumer only ever needs
 * `import { APP } from "incrudible-client";`. This module has no knowledge
 * of any single app's workflow-acquisition logic (free-text search vs. a
 * fixed link list) — that stays in each app's own Client.html, calling
 * into APP.
 */

import { DAYS } from "./values/days.js";
import {
  RULE_KEYS,
  actionTypes,
  actions,
  createInitialState,
  createStore,
  reducer,
} from "./state.js";

export { DAYS };

/**
 * Local-storage key the chosen theme persists under. Bracketed so it can't
 * collide with a consuming app's own keys.
 *
 * @type {string}
 */
const THEME_STORAGE_KEY = "[incrudible:theme]";

/**
 * The `/pattern/flags` shape, capturing source and flags. Both a rule's
 * test and a dependency key may take it; anything else is compared
 * literally, which is what lets a literal key be looked up directly
 * rather than matched against every control in the form.
 *
 * @type {RegExp}
 */
const PATTERN_KEY = /^\/(.*)\/([a-z]*)$/;

/**
 * Application order per criteria rule set, keyed by the rule object it was
 * derived from. The store replaces that object wholesale when a family is
 * assigned, so a stale entry becomes unreachable on its own and the cache
 * needs no invalidating.
 *
 * @type {WeakMap<object, string[]>}
 */
const criteriaOrders = new WeakMap();

/**
 * The single store every accessor on APP reads through and every setter
 * dispatches into.
 *
 * @type {ReturnType<typeof createStore>}
 */
const store = createStore(reducer, createInitialState());

/**
 * Backing object for APP.rules. Populated below with one store-backed
 * accessor per rule family, so assigning a family routes through the
 * reducer instead of mutating a plain property.
 *
 * @type {Record<(typeof RULE_KEYS)[number], Record<string, Rule[] | Dependency[]>>}
 */
const rules = {};

/**
 * Resolves the theme to start in: an explicit stored choice wins, and with
 * nothing stored the OS preference decides.
 *
 * @returns {"dark" | "light"} The preferred theme.
 */
const resolvePreferredTheme = () => {
  /**
   * The persisted choice, or null when the user has never picked one —
   * the two cases are distinct, since only the latter defers to the OS.
   *
   * @type {string | null}
   */
  const stored = localStorage.getItem(THEME_STORAGE_KEY);

  return stored === "dark" ||
    (stored === null &&
      window.matchMedia("(prefers-color-scheme: dark)").matches)
    ? "dark"
    : "light";
};

/**
 * Gives every known rule family a store-backed accessor, so the direct
 * property assignment consumers already write dispatches through the
 * reducer. Only these keys are backed; anything else assigned to APP.rules
 * becomes an inert own property.
 *
 * @type {(typeof RULE_KEYS)[number]}
 */
for (const name of RULE_KEYS) {
  Object.defineProperty(rules, name, {
    enumerable: true,
    /**
     * @returns {Record<string, Rule[] | Dependency[]>} The family's current rules.
     */
    get: () => store.getState().rules[name],
    /**
     * @param {Record<string, Rule[] | Dependency[]>} value - Rules keyed by control id or name.
     */
    set: (value) => store.dispatch(actions.setRule(name, value)),
  });
}

/**
 * Validation constraints carried by a schema entry. Scalar controls apply
 * these to the element itself; list entries mirror them onto the fieldset
 * as data attributes and onto every row's input.
 *
 * @typedef {object} Constraints
 * @property {boolean} [required] - Marks the control required.
 * @property {number} [minLength] - Minimum value length.
 * @property {number} [maxLength] - Maximum value length.
 * @property {string} [pattern] - Regular-expression source the value must match.
 * @property {number | string} [min] - Lower bound, for numeric and date types.
 * @property {number | string} [max] - Upper bound, for numeric and date types.
 */

/**
 * A single rule dependency: the id or name of a control, paired with the
 * test its value must satisfy. A rule holding several must satisfy all of
 * them. Controls that are disabled — including anything a rule has already
 * hidden — are invisible to resolution, so a dependency on one fails.
 *
 * @typedef {[string, string | boolean]} Dependency
 */

/**
 * The variant and markdown body of a rendered alert.
 *
 * @typedef {object} AlertContent
 * @property {string} variant - GitHub alert variant (`note`, `tip`, `important`, `warning`, `caution`).
 * @property {string} message - Markdown body.
 */

/**
 * One authored rule. `test` is matched against the values of the control
 * the rule is keyed to and `when` against the rest of the form; a rule
 * omitting both always passes. Whichever payload property it carries is
 * what distinguishes the family — an alert rule carries `alert`, a wizard
 * rule `wizard`, and so on.
 *
 * Criteria and requisition rules are the exception: those are authored as
 * bare `Dependency[]`, with no wrapper and nothing to contribute beyond
 * whether they pass.
 *
 * @typedef {object} Rule
 * @property {string | boolean} [test] - Test against the keyed control's values.
 * @property {Dependency[]} [when] - Dependencies that must also pass.
 * @property {AlertContent} [alert] - Alert to render, for an alert rule.
 * @property {SchemaEntry} [wizard] - Entry to reveal, for a wizard rule.
 * @property {string} [footnote] - Text appended to the previewed value, for a footnote rule.
 * @property {string} [value] - Value to write, for an autofill rule.
 * @property {{
 *   type: "message" | "confirm",
 *   message: string,
 *   header?: string,
 *   variant?: string,
 * }} [modal] - Dialog to open, for a modal rule.
 * @property {{
 *   header?: string,
 *   resource?: {
 *     type?: "doc" | "form" | "pdf",
 *     id?: string,
 *   },
 * }} [article] - Article to embed, for an article rule.
 */

/**
 * One rendered preview row: the group heading it falls under, its label,
 * and its value. A boolean checkbox contributes an empty label and moves
 * its own label into the value slot.
 *
 * @typedef {[string | undefined, string, string]} PreviewRow
 */

/**
 * One control in a schema. `type` selects the renderer: `list` and
 * `list:*` build a repeatable fieldset, `fieldset` a legend-titled group
 * of `members`, and everything else a labeled control. An entry carrying
 * `wizards` is additionally wrapped in a wizard container.
 *
 * @typedef {object} SchemaEntry
 * @property {string} type - Control type, or `fieldset`, `list`, or `list:<itemType>`.
 * @property {string} id - Element id; rule keys and `!{#id}` references resolve against it.
 * @property {string} [name] - Submission name; an entry without one is omitted from submission and preview.
 * @property {string} [label] - Markdown label text.
 * @property {string} [hint] - Markdown tooltip shown beside the label.
 * @property {number} [width] - Grid span, defaulting to 1.
 * @property {Constraints} [constraints] - Validation constraints.
 * @property {boolean} [disabled] - Renders the control disabled.
 * @property {boolean} [readonly] - Renders the control read-only.
 * @property {string | string[]} [defaultValue] - Initial value; an array preselects listbox options.
 * @property {string} [placeholder] - Placeholder text.
 * @property {string} [autocomplete] - Autocomplete token.
 * @property {number | string} [step] - Step for numeric and date types.
 * @property {string} [inputMode] - Virtual-keyboard hint; currency defaults to `decimal`.
 * @property {string[]} [list] - Suggestions, rendered as a datalist.
 * @property {number} [rows] - Visible rows, for a textarea.
 * @property {number} [size] - Visible rows, for a listbox.
 * @property {boolean} [collapsed] - Renders a listbox collapsed.
 * @property {boolean} [multiple] - Lets an image input accept several files.
 * @property {string} [value] - Submitted value for a checkbox or radio; a checkbox without one submits `"true"`.
 * @property {boolean} [checked] - Starts a checkbox or radio checked.
 * @property {boolean} [freeform] - Marks a checkbox or radio as paired with a free-text field.
 * @property {SchemaEntry[]} [members] - Child entries, for a fieldset.
 * @property {Array<{
 *   value: string,
 *   label?: string,
 *   icon?: string,
 * }>} [options] - Options for a select or listbox; a value-less option renders as a placeholder.
 * @property {Array<{
 *   test?: string | boolean,
 *   when?: Dependency[],
 *   wizard: SchemaEntry,
 * }>} [wizards] - Entries revealed as this control's value changes.
 * @property {Array<{
 *   test?: string | boolean,
 *   when?: Dependency[],
 *   alert: AlertContent,
 * }>} [alerts] - Alerts rendered beneath the control.
 */

export const APP = {
  /**
   * Local-storage key the chosen theme persists under.
   *
   * @type {string}
   */
  THEME_STORAGE_KEY,
  /**
   * Local-storage key today's records persist under. The stored value
   * carries its own date, so a collection from an earlier day is discarded
   * rather than shown.
   *
   * @type {string}
   */
  RECORDS_STORAGE_KEY: "[incrudible:records]",

  /**
   * Read/write access to the records panel's rendered content.
   *
   * @namespace
   */
  context: {
    /**
     * @returns {Array<{
     *   id: string,
     *   level: number,
     *   text: string,
     * }>} Headings parsed out of the rendered content.
     */
    get headingList() {
      return getHeadingList();
    },
    /**
     * @returns {string | undefined} Plain text of the records panel.
     */
    get recordsMessage() {
      return APP.recordsList?.textContent;
    },
    /**
     * Renders markdown into the records panel, scoping heading ids to the
     * container so they can't collide with the rest of the page.
     *
     * @param {string} text - Markdown to render.
     */
    set recordsMessage(text) {
      APP.parse(APP.recordsList, text);
    },
  },
  /**
   * Tab navigation.
   *
   * @namespace
   */
  navigator: {
    /**
     * Selects a tab, revealing its panel and hiding the rest.
     *
     * @param {string} id - The target panel's element id.
     */
    selectTab: (id) => {
      store.dispatch(actions.setSelectedTab(id));
    },
  },
  /**
   * Rule state, one property per family (wizardRules, criteriaRules, and
   * their feedback-scoped counterparts). Existing consumers assign these
   * properties directly; the stable facade keeps that API while routing
   * every update through the rules reducer.
   *
   * @type {Record<(typeof RULE_KEYS)[number], Record<string, Rule[] | Dependency[]>>}
   */
  rules,

  /**
   * @returns {HTMLAnchorElement | null} The sidenav link for the flow
   * currently being worked.
   */
  get activeFlowLink() {
    return this.sidenav?.querySelector("a[data-path].active");
  },
  /**
   * @returns {HTMLElement | null} Alert region for app-wide messages.
   */
  get appAlerts() {
    return document.getElementById("app-alerts");
  },
  /**
   * @returns {number} Length of the preview's plain-text rendering.
   */
  get charCount() {
    return APP.copyText.length;
  },
  /**
   * @returns {HTMLElement | null} Control that closes the feedback drawer.
   */
  get closeFeedbackDrawer() {
    return document.getElementById("close-feedback-drawer");
  },
  /**
   * @returns {HTMLElement | null} Control that collapses the notepad.
   */
  get closeNotepad() {
    return document.getElementById("close-notepad");
  },
  /**
   * @returns {HTMLDialogElement | null} The confirm dialog.
   */
  get confirmModal() {
    return document.getElementById("confirm-modal");
  },
  /**
   * @returns {HTMLElement | null} The confirm dialog's dismissing button.
   */
  get confirmModalCancel() {
    return document.getElementById("confirm-modal-cancel-button");
  },
  /**
   * @returns {HTMLElement | null} The confirm dialog's close control.
   */
  get confirmModalClose() {
    return document.getElementById("confirm-modal-close");
  },
  /**
   * @returns {HTMLElement | null} The confirm dialog's accepting button.
   */
  get confirmModalConfirm() {
    return document.getElementById("confirm-modal-confirm-button");
  },
  /**
   * @returns {HTMLElement | null} Heading element of the confirm dialog.
   */
  get confirmModalHeader() {
    return document.getElementById("confirm-modal-header");
  },
  /**
   * @returns {HTMLElement | null} Body element of the confirm dialog.
   */
  get confirmModalMessage() {
    return document.getElementById("confirm-modal-message");
  },
  /**
   * @returns {HTMLButtonElement | null} Button that copies the preview to the
   * clipboard.
   */
  get copyPreview() {
    return document.getElementById("copy-preview");
  },
  /**
   * @returns {string} The preview rendered as one pipe-separated line.
   */
  get copyText() {
    return APP._internals.form.copyText;
  },
  /**
   * @returns {HTMLElement[]} Every navigation dropdown, open or closed.
   */
  get dropdowns() {
    return Array.from(document.querySelectorAll(".nav-dropdown"));
  },
  /**
   * @returns {HTMLElement | null} Alert region inside the feedback drawer.
   */
  get feedbackAlerts() {
    return document.getElementById("feedback-alerts");
  },
  /**
   * @returns {HTMLElement | null} The feedback drawer surface.
   */
  get feedbackDrawer() {
    return document.getElementById("feedback-drawer");
  },
  /**
   * @returns {HTMLFormElement | null} The feedback form.
   */
  get feedbackForm() {
    return document.getElementById("feedback-form");
  },
  /**
   * @returns {HTMLElement | null} Container init renders the feedback schema
   * into.
   */
  get feedbackFormControls() {
    return document.getElementById("feedback-form-controls");
  },
  /**
   * @returns {HTMLFormElement | null} The main submission form.
   */
  get form() {
    return document.getElementById("app-form");
  },
  /**
   * @returns {HTMLElement | null} Alert region for form-scoped messages.
   */
  get formAlerts() {
    return document.getElementById("form-alerts");
  },
  /**
   * @returns {HTMLElement | null} Container a consumer renders its schema
   * into.
   */
  get formControls() {
    return document.getElementById("form-controls");
  },
  /**
   * Grouped accessors over the form's controls, plus the preview, alert,
   * modal, article, and wizard sync entry points a consumer drives.
   *
   * @returns {typeof APP._internals.form} The internal form helper namespace.
   */
  get formHelpers() {
    return APP._internals.form;
  },
  /**
   * @returns {HTMLElement | null} Disclosure wrapping the preview list.
   */
  get formPreview() {
    return document.getElementById("form-preview");
  },
  /**
   * @returns {boolean} Whether the blocking overlay is currently raised.
   */
  get loading() {
    return store.getState().ui.loading;
  },
  /**
   * Raises or clears the overlay, publishing the matching overlay event.
   *
   * @param {boolean} loading - True to raise the overlay.
   */
  set loading(loading) {
    store.dispatch(actions.setLoading(loading));
    this.publish(loading ? "overlay:show" : "overlay:hide");
  },
  /**
   * @returns {HTMLDialogElement | null} The message dialog.
   */
  get messageModal() {
    return document.getElementById("message-modal");
  },
  /**
   * @returns {HTMLElement | null} The message dialog's close control.
   */
  get messageModalClose() {
    return document.getElementById("message-modal-close");
  },
  /**
   * @returns {HTMLElement | null} The message dialog's dismissing button.
   */
  get messageModalDismiss() {
    return document.getElementById("message-modal-dismiss-button");
  },
  /**
   * @returns {HTMLElement | null} Heading element of the message dialog.
   */
  get messageModalHeader() {
    return document.getElementById("message-modal-header");
  },
  /**
   * @returns {HTMLElement | null} Body element of the message dialog.
   */
  get messageModalMessage() {
    return document.getElementById("message-modal-message");
  },
  /**
   * @returns {HTMLElement | null} The draggable notepad surface.
   */
  get notepad() {
    return document.getElementById("notepad");
  },
  /**
   * @returns {HTMLElement | null} Drag handle along the notepad's top edge.
   */
  get notepadHandle() {
    return document.getElementById("notepad-handle");
  },
  /**
   * @returns {HTMLElement | null} Control that opens the feedback drawer.
   */
  get openFeedbackDrawer() {
    return document.getElementById("open-feedback-drawer");
  },
  /**
   * @returns {HTMLElement | null} Control that expands the notepad.
   */
  get openNotepad() {
    return document.getElementById("open-notepad");
  },
  /**
   * @returns {HTMLElement | null} The blocking overlay element.
   */
  get overlay() {
    return document.getElementById("app-overlay");
  },
  /**
   * Immutable snapshot of the preview rows, each `[group, label, value]`.
   * Both the outer array and every row are frozen, so a consumer can hold
   * one without it drifting as the form changes.
   *
   * @returns {ReadonlyArray<Readonly<PreviewRow>>} Frozen rows.
   */
  get preview() {
    return Object.freeze(
      APP._internals.form.preview.map((row) => Object.freeze(row)),
    );
  },
  /**
   * @returns {HTMLElement | null} Definition list the preview renders into.
   */
  get previewList() {
    return document.getElementById("preview-list");
  },
  /**
   * Records submitted today, as persisted in local storage. Public proxy
   * onto _internals — third parties (each app's own Client.html) read this
   * instead of reaching into _internals directly.
   *
   * @returns {Array<{
   *   record: Record<string, unknown>,
   *   entries?: Array<[string, string]>,
   * }>} Today's records, or an empty array.
   */
  get records() {
    return APP._internals.records;
  },
  /**
   * @returns {HTMLElement | null} Container for the records-tab message.
   */
  get recordsList() {
    return document.getElementById("records-list");
  },
  /**
   * @returns {HTMLElement | null} The side navigation drawer.
   */
  get sidenav() {
    return document.getElementById("sidenav");
  },
  /**
   * @returns {HTMLElement | null} Control that closes the side navigation.
   */
  get sidenavClose() {
    return document.getElementById("close-sidenav");
  },
  /**
   * Every control that opens the side navigation: the dedicated button
   * plus anything targeting the drawer by id.
   *
   * @returns {Array<HTMLElement | null>} The opening controls.
   */
  get sideNavControllers() {
    return [
      document.getElementById("open-sidenav"),
      ...document.querySelectorAll(
        `:is(button, a)[data-drawer-target="${this.sidenav.id}"]`,
      ),
    ];
  },
  /**
   * @returns {HTMLElement | null} The tablist container.
   */
  get tablist() {
    return document.querySelector('[role="tablist"]');
  },
  /**
   * @returns {HTMLElement[]} Every tab in the tablist, in document order.
   */
  get tabs() {
    return Array.from(this.tablist?.querySelectorAll('[role="tab"]') ?? []);
  },
  /**
   * @returns {"dark" | "light"} Active theme, falling back to the OS
   * preference.
   */
  get theme() {
    return store.getState().ui.theme ?? resolvePreferredTheme();
  },
  /**
   * Sets the theme and persists it. Anything other than `"dark"` is
   * normalized to `"light"`.
   *
   * @param {string} mode - Requested theme.
   */
  set theme(mode) {
    store.dispatch(actions.setTheme(mode));
  },
  /**
   * @returns {HTMLInputElement | null} Checkbox bound to the active theme.
   */
  get themeToggle() {
    return document.getElementById("theme-toggle");
  },
  /**
   * @returns {HTMLElement | null} Container toasts are appended to.
   */
  get toastContainer() {
    return document.getElementById("toast-container");
  },
  /**
   * @returns {HTMLElement | null} The top navigation bar.
   */
  get topnav() {
    return document.getElementById("topnav");
  },
  /**
   * @returns {HTMLElement | null} Control that expands the top navigation.
   */
  get topnavToggle() {
    return document.getElementById("topnav-collapse-toggle");
  },
  /**
   * Immutable snapshot of what the form would submit, keyed by control
   * name. Multi-value controls keep every entry.
   *
   * Value references are resolved here, so this agrees with what the
   * preview showed. The control's own value keeps its `!{#id}` tokens, so
   * the form still round-trips and a re-render does not bake in whatever
   * the references happened to resolve to.
   *
   * @returns {Readonly<Record<string, ReadonlyArray<FormDataEntryValue>>>} Frozen values.
   */
  get values() {
    /**
     * What the form would submit right now. An empty set stands in when
     * there is no form, so the getter always returns the same shape.
     *
     * @type {FormData}
     */
    const data = APP.form ? new FormData(APP.form) : new FormData();
    /**
     * Distinct submitted names — keys() repeats a name once per value, and
     * each is collected in full below.
     *
     * @type {Set<string>}
     */
    const names = new Set(data.keys());
    /**
     * The control behind each submitted name — the one actually holding a
     * value, since a radio group or repeated checkbox has several sharing
     * the name and only one produced the entry. It supplies both the
     * resolution context and the footnote rules.
     *
     * @type {Map<string, HTMLElement>}
     */
    const contexts = new Map();

    for (const control of Array.from(APP.form?.elements ?? [])) {
      if (!control.name) {
        continue;
      }

      const chosen = contexts.get(control.name);

      if (!chosen || !APP._internals.getValue(chosen).length) {
        contexts.set(control.name, control);
      }
    }

    return Object.freeze(
      Object.fromEntries(
        Array.from(names, (name) => {
          /**
           * The control that produced this entry, or undefined once it has
           * been removed from the document.
           *
           * @type {HTMLElement | undefined}
           */
          const context = contexts.get(name);
          /**
           * The name's footnote, resolved once and appended to each of its
           * values — the same annotation the preview shows.
           *
           * @type {string}
           */
          const footnote = context ? getFootnote(context) : "";

          return [
            name,
            Object.freeze(
              data.getAll(name).map((value) => {
                // A File carries no references to resolve, and neither
                // does an entry whose control has since been removed.
                if (typeof value !== "string" || !context) {
                  return value;
                }

                const resolved =
                  APP._internals.form.resolveValueReferences(value, context);

                return footnote ? `${resolved} (${footnote})` : resolved;
              }),
            ),
          ];
        }),
      ),
    );
  },
  /**
   * The active workflow — a rich alert object for queue, a plain label
   * string for static. Each app's own mountWorkflow/resetWorkflow read
   * and write this; it's a real accessor (not a plain data property) so
   * that access always goes through APP rather than reaching into
   * _internals directly.
   *
   * @returns {Record<string, unknown> | string | undefined} The active workflow.
   */
  get workflow() {
    return store.getState().workflow.current;
  },
  /**
   * Replaces the active workflow.
   *
   * @param {Record<string, unknown> | string | undefined} value - The workflow to make active.
   */
  set workflow(value) {
    store.dispatch(actions.setWorkflow(value));
  },
  /**
   * @returns {HTMLElement | null} Container for the embedded workflow article.
   */
  get workflowArticle() {
    return document.getElementById("workflow-article");
  },
  /**
   * @returns {HTMLIFrameElement | null} Frame the article resource loads into.
   */
  get workflowArticleFrame() {
    return document.getElementById("workflow-article-frame");
  },
  /**
   * @returns {HTMLElement | null} Heading element of the workflow article.
   */
  get workflowArticleHeader() {
    return document.getElementById("workflow-article-header");
  },
  /**
   * @returns {string} Display label for the active workflow.
   */
  get workflowLabel() {
    return store.getState().workflow.label;
  },
  /**
   * Replaces the active workflow's display label.
   *
   * @param {string} value - The new label.
   */
  set workflowLabel(value) {
    store.dispatch(actions.setWorkflowLabel(value));
  },

  /**
   * Prepends a markdown alert to one of the three alert regions, keeping
   * at most two so a region can't grow without bound.
   *
   * @param {"app" | "feedback" | "form"} key - Target region; anything unrecognized falls back to the form region.
   * @param {AlertContent} content - Alert variant and markdown body.
   */
  alert: (key, content) => {
    /**
     * The region to prepend into. An unrecognized key falls back to the
     * form region rather than throwing.
     *
     * @type {HTMLElement}
     */
    const root =
      key === "app"
        ? APP.appAlerts
        : key === "feedback"
          ? APP.feedbackAlerts
          : APP.formAlerts;
    /**
     * Alerts already in the region, oldest last — the newest is prepended,
     * so trimming from the end drops the stalest.
     *
     * @type {NodeListOf<HTMLElement>}
     */
    const alerts = root.querySelectorAll(".markdown-alert");

    if (alerts.length >= 2) {
      alerts[alerts.length - 1].remove();
    }

    root.insertAdjacentHTML("afterbegin", APP._internals.alertMarkup(content));
  },

  /**
   * Bare `<input>` builder shared by renderFormControl's labeled-control
   * path and by list-control entries (which need their own id/name per
   * entry, so they can't go through renderFormControl/applyShared
   * directly). Defaults land on attribute-backed properties so they
   * survive serialization to HTML.
   *
   * @param {string} type - Schema type; `currency`, `datetime`, and `image` map onto text, datetime-local, and file.
   * @param {Omit<Constraints, "required">} [constraints] - Validation constraints; required is applied by the caller.
   * @param {string} [value] - Default value; ignored for image inputs.
   * @param {boolean} [multiple] - Whether an image input accepts several files.
   * @returns {HTMLInputElement} The configured input.
   */
  buildInput: (type, constraints = {}, value, multiple = false) => {
    /**
     * The input being built.
     *
     * @type {HTMLInputElement}
     */
    const input = document.createElement("input");
    input.type =
      type === "currency"
        ? "text"
        : type === "datetime"
          ? "datetime-local"
          : type === "image"
            ? "file"
            : type;

    if (["currency", "number"].includes(type)) {
      input.dataset.type = type;
    }

    if (type === "image") {
      input.accept = "image/*";
      input.multiple = multiple;
    }

    if (value != null && type !== "image") {
      input.defaultValue = value;
    }

    if (constraints.minLength != null) {
      input.minLength = constraints.minLength;
    }

    if (constraints.maxLength != null) {
      input.maxLength = constraints.maxLength;
    }

    if (constraints.pattern) {
      input.pattern = constraints.pattern;
    }

    if (constraints.min != null) {
      input.min = constraints.min;
    }

    if (constraints.max != null) {
      input.max = constraints.max;
    }

    return input;
  },

  /**
   * Opens the confirm dialog. The outcome arrives as a `confirm:accepted`
   * or `confirm:cancelled` event carrying `detail`, rather than a promise,
   * so a consumer subscribes once instead of awaiting each call.
   *
   * @param {string} message - Markdown body.
   * @param {object} [options] - Dialog options.
   * @param {string} [options.header] - Markdown heading.
   * @param {string} [options.confirmText] - Label for the accepting button.
   * @param {string} [options.cancelText] - Label for the dismissing button.
   * @param {string} [options.variant] - Alert variant styling the dialog.
   * @param {*} [options.detail] - Payload republished with the outcome event.
   * @param {string} [options.action] - Form action to set while the dialog is open; cleared when omitted.
   */
  confirm: (
    message,
    {
      header = "Confirm Action",
      confirmText = "OK",
      cancelText = "Cancel",
      variant,
      detail,
      action,
    } = {},
  ) => {
    APP._internals.prepareModal(
      APP.confirmModal,
      APP.confirmModalHeader,
      APP.confirmModalMessage,
      { header, message, variant },
    );
    APP.confirmModalConfirm.textContent = confirmText;
    APP.confirmModalCancel.textContent = cancelText;

    if (action) {
      APP.form.action = action;
    } else {
      APP.form.removeAttribute("action");
    }

    APP._internals.confirmDetail = detail;
    APP.confirmModal.returnValue = "";
    APP.confirmModal.showModal();
    APP.publish("modal:opened");
  },

  /**
   * Reads an image file into the base64 envelope an Apps Script upload
   * expects. Rejects non-images and anything over 10 MiB before touching
   * the reader.
   *
   * @param {File} file - The selected file.
   * @returns {Promise<{
   *   name: string,
   *   mimeType: string,
   *   base64: string,
   * }>} The upload envelope.
   * @throws {Error} If the file is not an image, is too large, or cannot be read.
   */
  imageToUpload: (file) => {
    /**
     * Upper bound on an upload, matching the Apps Script payload ceiling.
     *
     * @type {number}
     */
    const maxImageBytes = 10 * 1024 * 1024;

    if (!file?.type?.startsWith("image/")) {
      return Promise.reject(new Error("Select an image file."));
    }

    if (file.size > maxImageBytes) {
      return Promise.reject(
        new Error("Select an image no larger than 10 MiB."),
      );
    }

    return new Promise((resolve, reject) => {
      /**
       * Reader producing the data URL the payload is cut from.
       *
       * @type {FileReader}
       */
      const reader = new FileReader();

      reader.addEventListener("load", () => {
        const [, base64] = `${reader.result}`.split(",", 2);
        resolve({ name: file.name, mimeType: file.type, base64 });
      });
      reader.addEventListener("error", () => reject(reader.error));
      reader.readAsDataURL(file);
    });
  },

  /**
   * Boots the client: seeds workflow and feedback rule state, hydrates the
   * theme, renders the feedback schema if one was supplied, and wires every
   * navigation, surface, dialog, form, and app-event listener. Call once,
   * after the document is ready.
   *
   * @param {object} [options] - Boot options.
   * @param {{
   *   schema: SchemaEntry[],
   *   rules?: {
   *     wizards?: Record<string, Rule[]>,
   *     criteria?: Record<string, Dependency[]>,
   *     alerts?: Record<string, Rule[]>,
   *     requisitions?: Record<string, Dependency[]>,
   *     autofills?: Record<string, Rule[]>,
   *     modals?: Record<string, Rule[]>,
   *   },
   * }} [options.feedback] - Feedback form schema and its rule families; omit to leave the feedback form empty.
   * @param {string} [options.workflowLabel] - Initial workflow label.
   * @param {(data: *) => void} [options.onWorkflowLoaded] - Called when a workflow finishes loading.
   * @param {(detail: *) => void} [options.onAppInit] - Called on the app:init event.
   * @param {() => void} [options.onFormReset] - Called after the main form resets.
   * @param {() => void} [options.onRecordsTab] - Called when the records tab is selected.
   */
  init: ({
    feedback,
    workflowLabel = "",
    onWorkflowLoaded,
    onAppInit,
    onFormReset,
    onRecordsTab,
  } = {}) => {
    store.dispatch(
      actions.initialize(
        workflowLabel,
        feedback
          ? {
              feedbackWizardRules: feedback.rules?.wizards || {},
              feedbackCriteriaRules: feedback.rules?.criteria || {},
              feedbackAlertRules: feedback.rules?.alerts || {},
              feedbackRequisitionRules: feedback.rules?.requisitions || {},
              feedbackAutofillRules: feedback.rules?.autofills || {},
              feedbackModalRules: feedback.rules?.modals || {},
            }
          : {},
      ),
    );
    store.dispatch(actions.hydrateTheme(resolvePreferredTheme()));

    if (feedback) {
      APP.feedbackFormControls.replaceChildren(
        APP.renderEntries(feedback.schema),
      );
    }

    if (localStorage.getItem(APP.THEME_STORAGE_KEY)) {
      document.documentElement.dataset.theme = APP.theme;
    }

    if (APP.themeToggle) {
      APP.themeToggle.checked = APP.theme === "dark";
    }

    setupNavigation();
    setupSurfaces();
    setupDialogs();
    setupForms(onFormReset);
    setupAppEvents({ onWorkflowLoaded, onAppInit, onRecordsTab });
  },

  /**
   * Evaluates a rule test against a control's values.
   *
   * @param {string | boolean | undefined} test - `/pattern/flags` matches by regex, a plain string by equality, a boolean by presence or absence, and `undefined` by presence.
   * @param {string[]} values - Values to test.
   * @returns {boolean} Whether the test passes.
   */
  match: (test, values) => {
    return APP._internals.match(test, values);
  },

  /**
   * Subscribes to the next occurrence of an event only, then unsubscribes.
   *
   * @param {string} event - Event name.
   * @param {(payload: *) => void} callback - Handler for the next occurrence.
   * @returns {() => void} Cancels the subscription before it fires.
   */
  next: (event, callback) => {
    return APP._internals.bus.next(event, callback);
  },

  /**
   * Opens the message dialog.
   *
   * @param {string} message - Markdown body.
   * @param {object} [options] - Dialog options.
   * @param {string} [options.header] - Markdown heading.
   * @param {string} [options.dismissText] - Label for the dismissing button.
   * @param {string} [options.variant] - Alert variant styling the dialog.
   */
  notify: (
    message,
    { header = "Notice", dismissText = "OK", variant } = {},
  ) => {
    APP._internals.prepareModal(
      APP.messageModal,
      APP.messageModalHeader,
      APP.messageModalMessage,
      { header, message, variant },
    );
    APP.messageModalDismiss.textContent = dismissText;
    APP.messageModal.showModal();
    APP.publish("modal:opened");
  },

  /**
   * Renders markdown into an element, prefixing every heading id with the
   * container's own id so repeated content can't produce duplicate anchors.
   *
   * @param {HTMLElement} root - Destination element.
   * @param {string} markdown - Markdown source.
   */
  parse: (root, markdown) => {
    root.innerHTML = marked.parse(markdown);

    /**
     * Heading level being scoped, covering h1 through h6.
     *
     * @type {number}
     */
    for (let l = 1; l <= 6; l++) {
      root.querySelectorAll(`h${l}[id]`).forEach((heading) => {
        heading.id = `${root.id}-${heading.id}`;
      });
    }
  },

  /**
   * Publishes an event to every current subscriber. Publishing an event
   * nobody listens for is a no-op.
   *
   * @param {string} event - Event name.
   * @param {*} [payload] - Value passed to each handler.
   */
  publish: (event, payload) => {
    APP._internals.bus.publish(event, payload);
  },

  /**
   * Builds the empty container that syncAlerts fills for a control.
   *
   * @param {Pick<SchemaEntry, "id">} entry - Schema entry owning the alerts.
   * @returns {HTMLElement} The alert container, tagged with the control id.
   */
  renderControlAlerts: (entry) => {
    /**
     * The empty container syncAlerts later fills.
     *
     * @type {HTMLDivElement}
     */
    const container = document.createElement("div");
    container.className = "control-alerts";
    container.dataset.controlId = entry.id;
    return container;
  },

  /**
   * Builds the suggestion list an entry's `list` option refers to.
   *
   * @param {Required<Pick<SchemaEntry, "id" | "list">>} entry - Schema entry supplying suggestions.
   * @returns {HTMLDataListElement} The datalist, id'd as `${entry.id}-list`.
   */
  renderDatalist: (entry) => {
    /**
     * The suggestion list.
     *
     * @type {HTMLDataListElement}
     */
    const datalist = document.createElement("datalist");
    datalist.id = `${entry.id}-list`;

    entry.list.forEach((item) => {
      /**
       * One suggestion.
       *
       * @type {HTMLOptionElement}
       */
      const option = document.createElement("option");
      option.value = item;
      datalist.append(option);
    });

    return datalist;
  },

  /**
   * Renders a whole schema into one fragment, ready to hand to
   * replaceChildren.
   *
   * @param {SchemaEntry[]} entries - Schema entries.
   * @returns {DocumentFragment} The rendered controls.
   */
  renderEntries: (entries) => {
    /**
     * Collects the rendered entries for a single insertion.
     *
     * @type {DocumentFragment}
     */
    const fragment = document.createDocumentFragment();
    fragment.append(...entries.map((entry) => APP.renderEntry(entry)));
    return fragment;
  },

  /**
   * Renders one schema entry, dispatching on its type: `list`/`list:*`
   * become a repeatable fieldset, `fieldset` a legend-titled group of
   * members, an entry carrying `wizards` a wizard container, and anything
   * else a plain labeled control.
   *
   * A checkbox or radio wizard controller renders as the container's
   * preceding sibling rather than its first child, so the container can be
   * collapsed on its own while nothing is eligible to reveal.
   *
   * @param {SchemaEntry} entry - Schema entry.
   * @param {{
   *   test?: string | boolean,
   *   when?: Dependency[],
   * }} [rule] - Owning rule; its presence starts the entry hidden.
   * @returns {HTMLElement | DocumentFragment} The rendered entry.
   */
  renderEntry: (entry, rule) => {
    if (entry.type === "list" || entry.type.startsWith("list:")) {
      /**
       * Type of each row's input: a bare `list` holds text, while
       * `list:<type>` names the type after the colon.
       *
       * @type {string}
       */
      const itemType = entry.type === "list" ? "text" : entry.type.slice(5);
      /**
       * The entry's constraints, mirrored onto the fieldset as data
       * attributes and applied to each row's input.
       *
       * @type {Constraints}
       */
      const v = entry.constraints || {};

      /**
       * The list container.
       *
       * @type {HTMLFieldSetElement}
       */
      const fieldset = document.createElement("fieldset");
      fieldset.className = `list w-${entry.width || 1}`;
      fieldset.id = entry.id;

      if (entry.name) {
        fieldset.dataset.name = entry.name;
      }

      if (itemType !== "text") {
        fieldset.dataset.type = itemType;
      }

      if (entry.disabled) {
        fieldset.disabled = true;
      }

      if (rule) {
        fieldset.hidden = true;
      }

      /**
       * Wrapper carrying the list's own label and controls.
       *
       * @type {HTMLLabelElement}
       */
      const label = document.createElement("label");
      label.className = "form-control";

      /**
       * Label row, extended below with the "Add" button.
       *
       * @type {HTMLSpanElement}
       */
      const toolbar = createLabelToolbar(entry);

      /**
       * Holds one `<li>` per entry row.
       *
       * @type {HTMLUListElement}
       */
      const list = document.createElement("ul");

      /**
       * Builds one entry `<li>`. Reused for the always-present first entry
       * (not removable) and for every entry the "Add" button creates later
       * (removable) — both need the exact same input construction, just
       * closing over this one render's entry/itemType/v rather than
       * round-tripping through the fieldset's dataset.
       *
       * @param {number} index - Row position, used for the id.
       * @param {boolean} removable - Whether to append a remove button.
       * @returns {HTMLLIElement} The entry row.
       */
      const buildEntry = (index, removable) => {
        /**
         * The row itself.
         *
         * @type {HTMLLIElement}
         */
        const entryLi = document.createElement("li");

        /**
         * The row's input, built straight from the item type. Every row
         * shares the list's own name — the standard HTML multi-value
         * pattern — so FormData.getAll(name) collects every entry as one
         * array; only the id is indexed, to stay unique per row.
         *
         * @type {HTMLInputElement}
         */
        const input = APP.buildInput(itemType, v);
        input.id = `${entry.id}-${index}`;

        if (entry.name) {
          input.name = entry.name;
        }

        // Rows are built here rather than through the shared path, so the
        // same rule holds explicitly: a checkbox row reports presence and
        // cannot meaningfully be required.
        input.required = Boolean(v.required) && itemType !== "checkbox";
        entryLi.append(input);

        if (removable) {
          /**
           * Removes this row and announces it, so the fieldset can
           * reindex the rows that remain.
           *
           * @type {HTMLButtonElement}
           */
          const removeButton = document.createElement("button");

          removeButton.type = "button";
          removeButton.className = "list-remove";
          removeButton.setAttribute("aria-label", "Remove");
          removeButton.textContent = "×";

          removeButton.addEventListener("click", () => {
            entryLi.remove();
            fieldset.dispatchEvent(new CustomEvent("item-removed"));
            APP.formHelpers.renderPreview();
          });

          entryLi.append(removeButton);
        }

        return entryLi;
      };

      /**
       * Appends a removable row, numbered from the current row count.
       *
       * @type {HTMLButtonElement}
       */
      const addButton = document.createElement("button");

      addButton.type = "button";
      addButton.className = "list-add";
      addButton.textContent = "+ Add";

      addButton.addEventListener("click", () => {
        /**
         * The row just appended. A consumer's own render-time wiring never
         * runs on it — this row didn't exist yet when that pass happened —
         * so the one thing every list row needs regardless of consumer,
         * keeping #preview-list current, is wired here directly rather
         * than left for something outside the library to notice and do.
         *
         * @type {HTMLLIElement}
         */
        const addedLi = buildEntry(list.querySelectorAll("li").length, true);

        addedLi
          .querySelector("input")
          .addEventListener("input", () => APP.formHelpers.renderPreview());

        list.append(addedLi);
      });

      toolbar.append(addButton);
      label.append(toolbar);
      list.append(buildEntry(0, false));

      fieldset.addEventListener("item-removed", () => {
        list.querySelectorAll("li").forEach((entryLi, index) => {
          /**
           * The surviving row's input, re-id'd to close the gap. Every
           * row already shares the same name, so nothing there needs
           * renumbering.
           *
           * @type {HTMLInputElement}
           */
          entryLi.querySelector("input").id = `${entry.id}-${index}`;
        });
      });

      fieldset.append(label, list);

      return fieldset;
    }

    if (entry.type === "fieldset") {
      /**
       * The grouping container.
       *
       * @type {HTMLFieldSetElement}
       */
      const fieldset = document.createElement("fieldset");

      if (entry.id) {
        fieldset.id = entry.id;
      }

      if (entry.disabled) {
        fieldset.disabled = true;
      }

      /**
       * The group's title. Doubles as the preview's group heading, which
       * reads it back from the legend.
       *
       * @type {HTMLLegendElement}
       */
      const legend = document.createElement("legend");
      legend.innerHTML = entry.label;

      fieldset.append(
        legend,
        ...entry.members.map((member) => APP.renderEntry(member)),
      );

      return fieldset;
    }

    if (!(entry.wizards && entry.wizards.length && entry.type !== "textarea")) {
      return APP.renderFormControl(entry, rule);
    }

    /**
     * The wizard container. Its data-type records the controller's type,
     * which is how the sync later knows whether the controller is a
     * sibling or its first child.
     *
     * @type {HTMLFieldSetElement}
     */
    const fieldset = document.createElement("fieldset");
    fieldset.dataset.type = entry.type;

    if (rule) {
      fieldset.hidden = true;
    }

    /**
     * The rendered wizard entries. An item may be bare (shown while the
     * controller is checked) or wrapped as `{ wizard, test }` with an
     * explicit test, so the wrapper is passed along as the owning rule to
     * start the entry hidden.
     *
     * @type {Array<HTMLElement | DocumentFragment>}
     */
    const children = (entry.wizards || []).map((r) =>
      APP.renderEntry(r.wizard || r, r.wizard ? r : {}),
    );

    // A checkbox/radio controller never gets its own box regardless of
    // nesting (see the :has(input[type=checkbox],[type=radio]) rule), so
    // unlike other control types there's no double-boxing to avoid by
    // nesting it inside the fieldset.
    if (["checkbox", "radio"].includes(entry.type)) {
      fieldset.className = "wizard w-1";
      fieldset.hidden = true;
      fieldset.append(...children);

      /**
       * The controlling checkbox or radio, rendered unhidden.
       *
       * @type {HTMLLabelElement}
       */
      const controller = APP.renderFormControl(entry);
      /**
       * Pairs the controller with its container as siblings.
       *
       * @type {DocumentFragment}
       */
      const group = document.createDocumentFragment();
      group.append(controller, fieldset);

      return group;
    }

    fieldset.className = `wizard w-${entry.width || 1}`;

    fieldset.append(
      APP.renderFormControl(Object.assign({}, entry, { width: 1 })),
      ...children,
    );

    return fieldset;
  },

  /**
   * Renders a single labeled control — input, textarea, select, listbox,
   * checkbox, or radio — wrapped in its `.form-control` label with the
   * shared toolbar, optional hint tooltip, and alert container.
   *
   * @param {SchemaEntry} entry - Schema entry.
   * @param {{
   *   test?: string | boolean,
   *   when?: Dependency[],
   * }} [rule] - Owning rule; its presence starts the label hidden.
   * @returns {HTMLLabelElement} The labeled control.
   */
  renderFormControl: (entry, rule) => {
    /**
     * The entry's constraints, defaulted so each branch below can read
     * through without guarding.
     *
     * @type {Constraints}
     */
    const v = entry.constraints || {};
    /**
     * The entry's initial value. An array preselects several listbox
     * options; a scalar matches a single option or fills a plain control.
     *
     * @type {string | string[] | undefined}
     */
    const val = entry.defaultValue;

    /**
     * Applies the identity and state every control type shares. Elements
     * are serialized to HTML at the end, so defaults must land on
     * attribute-backed properties (defaultValue/defaultChecked/
     * defaultSelected), not the live ones outerHTML would drop.
     *
     * @param {HTMLElement} element - The control being built.
     */
    const applyShared = (element) => {
      element.id = entry.id;

      if (entry.name) {
        element.name = entry.name;
      }

      if (entry.disabled) {
        element.disabled = true;
      }

      if (entry.readonly && "readOnly" in element) {
        element.readOnly = true;
      }

      // A checkbox reports presence, so requiring one leaves it a single
      // valid state and asks nothing — the flag is dropped rather than
      // rendered, here and in the requisition sync alike.
      if (v.required && element.type !== "checkbox") {
        element.required = true;
      }
    };

    /**
     * Collects whatever this entry's type renders.
     *
     * @type {DocumentFragment}
     */
    const fragment = document.createDocumentFragment();

    switch (entry.type) {
      case "text":
      case "email":
      case "search":
      case "tel":
      case "password":
      case "url":
      case "image":
      case "currency":
      case "number":
      case "date":
      case "datetime":
      case "time": {
        /**
         * The control itself.
         *
         * @type {HTMLInputElement}
         */
        const input = APP.buildInput(entry.type, v, val, entry.multiple);

        applyShared(input);

        if (entry.placeholder) {
          input.placeholder = entry.placeholder;
        }

        if (entry.autocomplete) {
          input.autocomplete = entry.autocomplete;
        }

        if (entry.step != null) {
          input.step = entry.step;
        }

        if (entry.inputMode) {
          input.inputMode = entry.inputMode;
        } else if (entry.type === "currency") {
          input.inputMode = "decimal";
        }

        /**
         * Decorative slot the stylesheet fills per input type.
         *
         * @type {HTMLElement}
         */
        const icon = document.createElement("i");
        icon.setAttribute("aria-hidden", "true");
        fragment.append(icon, input);

        if (entry.list) {
          input.setAttribute("list", `${entry.id}-list`);
          fragment.append(APP.renderDatalist(entry));
        }

        break;
      }
      case "textarea": {
        /**
         * The control itself.
         *
         * @type {HTMLTextAreaElement}
         */
        const textarea = document.createElement("textarea");
        applyShared(textarea);

        if (val != null) {
          textarea.defaultValue = val;
        }

        if (entry.placeholder) {
          textarea.placeholder = entry.placeholder;
        }

        if (entry.autocomplete) {
          textarea.autocomplete = entry.autocomplete;
        }

        if (entry.rows != null) {
          textarea.rows = entry.rows;
        }

        if (v.minLength != null) {
          textarea.minLength = v.minLength;
        }

        if (v.maxLength != null) {
          textarea.maxLength = v.maxLength;
        }

        fragment.append(textarea);
        break;
      }
      case "select":
      case "listbox": {
        /**
         * The control itself, shared by the select and listbox types.
         *
         * @type {HTMLSelectElement}
         */
        const select = document.createElement("select");

        applyShared(select);

        if (entry.type === "listbox") {
          select.multiple = true;

          if (entry.size != null) {
            select.size = entry.size;
          }

          if (entry.collapsed) {
            select.className = "collapsed";
          }
        }

        if (entry.type === "select") {
          /**
           * The closed state's trigger.
           *
           * @type {HTMLButtonElement}
           */
          const button = document.createElement("button");
          button.type = "button";
          button.className = "select-button";

          /**
           * Mirrors the chosen option's rich content while closed.
           *
           * @type {HTMLElement}
           */
          const content = document.createElement("selectedcontent");
          content.className = "select-content";

          button.append(content);
          select.append(button);
        }

        entry.options?.forEach((option) => {
          /**
           * The rendered option.
           *
           * @type {HTMLOptionElement}
           */
          const element = document.createElement("option");
          element.value = option.value;

          if (!option.value) {
            element.className = "select-placeholder";
          }

          if (
            Array.isArray(val)
              ? val.indexOf(option.value) !== -1
              : option.value === val
          ) {
            element.defaultSelected = true;
          }

          if (option.icon) {
            /**
             * Holds the option's icon markup.
             *
             * @type {HTMLSpanElement}
             */
            const icon = document.createElement("span");
            icon.className = "icon";
            icon.setAttribute("aria-hidden", "true");
            icon.innerHTML = option.icon;
            element.append(icon);
          }

          /**
           * The option's display text, falling back to its value. Reading
           * this back is how getValue reports selections by label.
           *
           * @type {HTMLSpanElement}
           */
          const optionLabel = document.createElement("span");
          optionLabel.className = "option-label";
          optionLabel.innerHTML = option.label || option.value;

          element.append(optionLabel);
          select.append(element);
        });

        fragment.append(select);
        break;
      }
      case "checkbox":
      case "radio": {
        /**
         * The control itself.
         *
         * @type {HTMLInputElement}
         */
        const input = document.createElement("input");
        input.type = entry.type;
        applyShared(input);

        if (entry.freeform) {
          input.className = "freeform";
        }

        if (entry.value != null) {
          input.defaultValue = entry.value;
        } else if (entry.type === "checkbox") {
          input.defaultValue = "true";
        }

        if (entry.checked || entry.defaultChecked) {
          input.defaultChecked = true;
        }

        fragment.append(input);
        break;
      }
    }

    /**
     * The wrapper every control shares. Its `for` is what the wizard sync
     * follows to find a container's controlling control.
     *
     * @type {HTMLLabelElement}
     */
    const label = document.createElement("label");
    label.className = `form-control w-${entry.width || 1}`;
    label.htmlFor = entry.id;

    if (rule) {
      label.hidden = true;
    }

    /**
     * The label row, appended ahead of the control.
     *
     * @type {HTMLSpanElement}
     */
    const toolbar = createLabelToolbar(entry);

    if (entry.alerts?.length) {
      label.append(APP.renderControlAlerts(entry));
    }

    label.append(toolbar, fragment);

    return label;
  },

  /**
   * Shared google.script.run envelope: overlay toggle, `{ success, data,
   * error }` unwrap, and a `${prefix}${message}` toast on either failure
   * path — a transport error or a response the server marked unsuccessful.
   *
   * @param {string} method - Server function name.
   * @param {*[]} args - Arguments forwarded to it.
   * @param {object} options - Call options.
   * @param {boolean} [options.loading] - Whether to raise the overlay for the call's duration.
   * @param {string} [options.variant] - Toast variant used on failure.
   * @param {string} [options.prefix] - Prepended to any failure message.
   * @param {(data: *) => void} options.onData - Receives the unwrapped payload on success.
   */
  runServer: (
    method,
    args,
    { loading = true, variant = "caution", prefix = "", onData },
  ) => {
    /**
     * Shared failure path for both a transport error and a response the
     * server marked unsuccessful: drops the overlay if this call raised
     * one, then surfaces the prefixed message as a toast.
     *
     * @param {string} message - Failure message, before prefixing.
     */
    const fail = (message) => {
      if (loading) {
        APP.loading = false;
      }

      APP.toast(`${prefix}${message}`, variant);
    };

    if (loading) {
      APP.loading = true;
    }

    google.script.run
      .withSuccessHandler((response) => {
        if (!response || typeof response !== "object") {
          fail("The server returned no response.");
          return;
        }

        if (!response.success) {
          fail(
            typeof response.error === "string"
              ? response.error
              : response.error?.message ||
                  "The server could not complete the request.",
          );
          return;
        }

        if (loading) {
          APP.loading = false;
        }

        onData(response.data);
      })
      .withFailureHandler((error) => fail(error.message))
      [method](...args);
  },

  /**
   * Opens whichever dialog a rule's modal descriptor asks for.
   *
   * @param {{
   *   type: "message" | "confirm",
   *   message: string,
   *   header?: string,
   *   variant?: string,
   * }} [modal] - Which dialog to open, and its markdown content.
   * @returns {boolean} False when the descriptor is missing or its type is unrecognized.
   */
  showModal: (modal) => {
    return APP._internals.showModal(modal);
  },

  /**
   * Subscribes to an event until the returned function is called.
   *
   * @param {string} event - Event name.
   * @param {(payload: *) => void} callback - Handler, run on every occurrence.
   * @returns {() => void} Unsubscribes the handler.
   */
  subscribe: (event, callback) => {
    return APP._internals.bus.subscribe(event, callback);
  },

  /**
   * Loads the feedback records from the server into state. No-ops when the
   * page has no feedback form.
   */
  syncFeedbackRecords: () => {
    APP._internals.feedback.syncRecords();
  },

  /**
   * Shows a transient status message, removed after three seconds.
   *
   * @param {string} message - Text to display.
   * @param {string} [variant] - Toast variant.
   */
  toast: (message, variant = "note") => {
    /**
     * The toast element. `role="status"` announces it to assistive tech
     * without stealing focus.
     *
     * @type {HTMLDivElement}
     */
    const toast = document.createElement("div");
    toast.className = `toast toast-${variant} open`;
    toast.setAttribute("role", "status");

    /**
     * Decorative slot the stylesheet fills per variant.
     *
     * @type {HTMLElement}
     */
    const icon = document.createElement("i");
    icon.className = "toast-icon";
    icon.setAttribute("aria-hidden", "true");

    /**
     * The message, set as text so it can't inject markup.
     *
     * @type {HTMLSpanElement}
     */
    const text = document.createElement("span");
    text.textContent = message;

    toast.append(icon, text);
    APP.toastContainer.append(toast);
    APP.toastContainer.classList.add("open");

    setTimeout(() => {
      toast.remove();
      if (!APP.toastContainer.childElementCount) {
        APP.toastContainer.classList.remove("open");
      }
    }, 3000);
  },

  /**
   * The current calendar day in America/New_York, matching the
   * submitted-at display. Records persist across browser restarts but are
   * scoped to this value, so a fresh day starts a fresh collection rather
   * than showing stale rows.
   *
   * @returns {string} ISO calendar date (`YYYY-MM-DD`).
   */
  today: () => {
    /**
     * The day's fields in America/New_York, read as parts rather than as
     * formatted text. Asking a locale to render the ISO shape depends on
     * that locale's data being present, which is not guaranteed — an
     * engine missing it falls back to another pattern and silently
     * returns a different string. Since this value is compared as a
     * storage key, the format is assembled here instead of borrowed.
     *
     * @type {Record<string, string>}
     */
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        // Pinned so a non-Gregorian calendar or non-Latin digits cannot
        // reach the fields below.
        calendar: "gregory",
        numberingSystem: "latn",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
        .formatToParts(new Date())
        .map(({ type, value }) => [type, value]),
    );

    return `${parts.year}-${parts.month}-${parts.day}`;
  },

  /**
   * Opens or closes a navigation dropdown, keeping its button's
   * aria-expanded in step.
   *
   * @param {HTMLElement} target - The dropdown element.
   * @param {boolean} [open] - Forces a state; omit to toggle.
   * @returns {boolean} Whether the dropdown ended up open.
   */
  toggleDropdown: (target, open = undefined) => {
    /**
     * The resulting state. Passing `open` through to toggle forces it;
     * omitting it flips whatever the dropdown was.
     *
     * @type {boolean}
     */
    const opened = target.classList.toggle("open", open);

    target
      .querySelector(".dropdown-button")
      ?.setAttribute("aria-expanded", opened ? "true" : "false");

    return opened;
  },

  /**
   * Removes a handler. Unknown events and unregistered handlers are
   * ignored rather than treated as errors.
   *
   * @param {string} event - Event name.
   * @param {(payload: *) => void} callback - The handler to remove.
   */
  unsubscribe: (event, callback) => {
    APP._internals.bus.unsubscribe(event, callback);
  },

  /**
   * Implementation the public members proxy onto. A consumer should reach
   * for the public equivalents; these are exposed for tests and for the
   * few cases an app genuinely needs the unwrapped form.
   *
   * @namespace
   */
  _internals: {
    /**
     * @returns {*} Payload republished with the confirm dialog's outcome.
     */
    get confirmDetail() {
      return store.getState().modal.confirmDetail;
    },
    /**
     * Stashes the payload to republish when the confirm dialog closes.
     *
     * @param {*} value - Arbitrary payload.
     */
    set confirmDetail(value) {
      store.dispatch(actions.setConfirmDetail(value));
    },
    /**
     * Records read back from local storage, scoped to the current
     * America/New_York day — a stored collection from any other date is
     * discarded rather than shown.
     *
     * @returns {Array<{
     *   record: Record<string, unknown>,
     *   entries?: Array<[string, string]>,
     * }>} Today's records, or an empty array.
     */
    get records() {
      /**
       * The stored envelope — the records plus the day they belong to.
       * Parsed from `"null"` when absent, so a missing key behaves the
       * same as a stale one.
       *
       * @type {{
       *   date: string,
       *   records: Array<{
       *     record: Record<string, unknown>,
       *     entries?: Array<[string, string]>,
       *   }>,
       * } | null}
       */
      const stored = JSON.parse(
        localStorage.getItem(APP.RECORDS_STORAGE_KEY) ?? "null",
      );

      return stored?.date === APP.today() ? stored.records : [];
    },
    /**
     * @returns {Record<string, unknown> | string | undefined} The active workflow.
     */
    get workflow() {
      return store.getState().workflow.current;
    },
    /**
     * Replaces the active workflow.
     *
     * @param {Record<string, unknown> | string | undefined} value - The workflow to make active.
     */
    set workflow(value) {
      store.dispatch(actions.setWorkflow(value));
    },
    /**
     * Renders an alert as a GitHub-flavored markdown alert, indenting every
     * line of the body so a multi-line message stays inside the blockquote.
     *
     * @param {AlertContent} content - Alert variant and markdown body.
     * @returns {string} The rendered HTML.
     */
    alertMarkup: ({ variant, message }) =>
      marked.parse(
        `> [!${variant.toUpperCase()}]\n> ${message.replaceAll("\n", "\n> ")}`,
      ),
    /**
     * Reads a control's values for rule matching. A checkbox or radio
     * contributes its value only while checked, and a select reports its
     * options' labels rather than their values — rules are authored
     * against what the user sees.
     *
     * @param {HTMLElement} control - The control to read.
     * @param {HTMLFormElement} [targetForm] - Form the control belongs to.
     * @returns {string[]} Zero or more values.
     */
    getValue: (control, targetForm = APP.form) => {
      if (["checkbox", "radio"].includes(control.type)) {
        return control.checked ? [control.value] : [];
      }

      if (control instanceof HTMLSelectElement) {
        return Array.from(control.selectedOptions).map(
          (option) => option.label.trim() || option.value,
        );
      }

      return [control.value];
    },
    /**
     * Collapses the article surface and drops the frame's source, so a
     * hidden article isn't still holding a loaded document.
     */
    hideArticle: () => {
      APP.workflowArticleFrame?.removeAttribute("src");
      APP.workflowArticle?.setAttribute("hidden", "");
    },
    /**
     * Evaluates a rule test against a control's values.
     *
     * @param {string | boolean | undefined} test - `/pattern/flags` matches by regex, a plain string by equality, a boolean by presence or absence, and `undefined` by presence.
     * @param {string[]} values - Values to test.
     * @returns {boolean} Whether any value satisfies the test.
     */
    match: (test, values) => {
      if (test === undefined) {
        return values.length > 0;
      }

      if (typeof test === "boolean") {
        return values.length > 0 === test;
      }

      /**
       * Captures the source and flags of a `/pattern/flags` test. A test
       * that doesn't take this shape is compared literally instead.
       *
       * @type {RegExpExecArray | null}
       */
      const match = PATTERN_KEY.exec(test);

      return values.some((v) =>
        match ? new RegExp(match[1], match[2]).test(v) : v === test,
      );
    },
    /**
     * Fills a dialog's heading and body with rendered markdown and swaps
     * its variant class, clearing whichever variant the previous use left
     * behind.
     *
     * @param {HTMLDialogElement} dialog - The dialog to prepare.
     * @param {HTMLElement} headerElement - Element receiving the heading.
     * @param {HTMLElement} messageElement - Element receiving the body.
     * @param {{
     *   header: string,
     *   message: string,
     *   variant?: string,
     * }} content - Markdown heading and body, plus the variant to apply.
     */
    prepareModal: (dialog, headerElement, messageElement, content) => {
      const { header, message, variant } = content;
      headerElement.innerHTML = marked.parseInline(header);
      APP.parse(messageElement, message);

      /**
       * Variant being considered. Every one is toggled, so whichever the
       * previous use left behind is cleared as this one is applied.
       *
       * @type {string}
       */
      for (const name of ["note", "tip", "important", "warning", "caution"]) {
        dialog.classList.toggle(`modal-${name}`, name === variant);
      }
    },
    /**
     * Points the article frame at a Google-hosted resource and reveals the
     * surface. The source is only reassigned when it actually changes, so
     * a repeated sync doesn't reload the document.
     *
     * @param {{
     *   header?: string,
     *   resource?: {
     *     type?: "doc" | "form" | "pdf",
     *     id?: string,
     *   },
     * }} [article] - Heading and the resource to embed.
     * @returns {boolean} False when the id is missing or blank, the type is unsupported, or the article surface is absent.
     */
    showArticle: ({ header = "Additional workflow", resource = {} } = {}) => {
      if (typeof resource.id !== "string" || !resource.id.trim()) {
        return false;
      }

      /**
       * The resource id, trimmed so surrounding whitespace can't reach the
       * embed URL.
       *
       * @type {string}
       */
      const id = resource.id.trim();
      /**
       * The embed URL, left unassigned until the resource type selects
       * one — an unsupported type returns instead.
       *
       * @type {string}
       */
      let src;

      switch (resource.type) {
        case "doc": {
          src = `https://docs.google.com/document/d/${id}/preview`;
          break;
        }
        case "form": {
          src = `https://docs.google.com/forms/d/e/${id}/viewform?embedded=true`;
          break;
        }
        case "pdf": {
          src = `https://drive.google.com/file/d/${id}/preview`;
          break;
        }
        default: {
          return false;
        }
      }

      if (
        !APP.workflowArticle ||
        !APP.workflowArticleHeader ||
        !APP.workflowArticleFrame
      ) {
        return false;
      }

      APP.workflowArticleHeader.innerHTML = marked.parseInline(header);
      APP.workflowArticleFrame.title =
        APP.workflowArticleHeader.textContent || "Workflow";

      if (APP.workflowArticleFrame.getAttribute("src") !== src) {
        APP.workflowArticleFrame.src = src;
      }

      APP.workflowArticle.hidden = false;
      return true;
    },
    /**
     * Opens whichever dialog a rule's modal descriptor asks for.
     *
     * @param {{
     *   type: "message" | "confirm",
     *   message: string,
     *   header?: string,
     *   variant?: string,
     * }} [modal] - Which dialog to open, and its markdown content.
     * @returns {boolean} False when the descriptor is missing or its type is unrecognized.
     */
    showModal: (modal) => {
      if (modal?.type === "message") {
        APP.notify(modal.message, modal);
      } else if (modal?.type === "confirm") {
        APP.confirm(modal.message, modal);
      } else {
        return false;
      }

      return true;
    },
    /**
     * Resolves a rule's dependencies against the current form state. Every
     * dependency must pass, and resolution fails closed: a key matching no
     * enabled control returns false rather than defaulting to visible.
     *
     * A key is matched against control ids first, then names; when several
     * controls share a name their values are pooled, so any one of them
     * satisfying the test is enough.
     *
     * A rule carrying no dependencies passes without touching the form at
     * all — the common case, and the reason this returns before doing any
     * work rather than after.
     *
     * @param {Dependency[] | Map<string, string | boolean>} [dependencies] - Dependencies to satisfy.
     * @param {HTMLFormElement} [targetForm] - Form to resolve against.
     * @returns {boolean} Whether every dependency passes.
     */
    when: (dependencies = new Map(), targetForm = APP.form) => {
      /**
       * How many dependencies there are, read from whichever shape the
       * caller passed. Most rules carry none, and resolving one is far
       * costlier than counting them.
       *
       * @type {number}
       */
      const count = dependencies.size ?? dependencies.length ?? 0;

      if (!count) {
        return true;
      }

      for (const [key, test] of dependencies) {
        if (!dependencyPasses(key, test, targetForm)) {
          return false;
        }
      }

      return true;
    },
    /**
     * Publish/subscribe hub backing the public event methods.
     *
     * @namespace
     */
    bus: {
      /**
       * Subscribers by event name. An event's entry is removed once its
       * last handler unsubscribes, so the map tracks live subscriptions
       * rather than every event ever seen.
       *
       * @type {Map<string, Set<(payload: *) => void>>}
       */
      _handlers: new Map(),
      /**
       * Drops subscriptions wholesale.
       *
       * @param {string} [event] - Event to clear; omit to clear every event.
       */
      clear(event) {
        if (event === undefined) {
          this._handlers.clear();
          return;
        }

        this._handlers.delete(event);
      },
      /**
       * Subscribes to the next occurrence only, unsubscribing before the
       * handler runs so a handler that republishes can't re-enter.
       *
       * @param {string} event - Event name.
       * @param {(payload: *) => void} callback - Handler for the next occurrence.
       * @returns {() => void} Cancels the subscription before it fires.
       */
      next(event, callback) {
        /**
         * Captured so the wrapper can cancel itself before handing off,
         * which is what makes this fire exactly once.
         *
         * @type {() => void}
         */
        const unsubscribe = this.subscribe(event, (payload) => {
          unsubscribe();
          callback(payload);
        });

        return unsubscribe;
      },
      /**
       * Notifies every current subscriber, in registration order. The
       * handler set is copied first, so a handler that subscribes or
       * unsubscribes doesn't disturb the run in progress.
       *
       * @param {string} event - Event name.
       * @param {*} [payload] - Value passed to each handler.
       */
      publish(event, payload) {
        /**
         * Subscribers for this event, absent when nobody listens.
         *
         * @type {Set<(payload: *) => void> | undefined}
         */
        const handlers = this._handlers.get(event);

        if (handlers === undefined) {
          return;
        }

        /**
         * Subscriber being notified.
         *
         * @type {(payload: *) => void}
         */
        for (const handler of [...handlers]) {
          handler(payload);
        }
      },
      /**
       * Registers a handler for every occurrence of an event.
       *
       * @param {string} event - Event name.
       * @param {(payload: *) => void} callback - Handler to register.
       * @returns {() => void} Unsubscribes the handler.
       */
      subscribe(event, callback) {
        if (!this._handlers.get(event)) {
          this._handlers.set(event, new Set());
        }

        this._handlers.get(event)?.add(callback);

        return () => {
          this.unsubscribe(event, callback);
        };
      },
      /**
       * Removes a handler, dropping the event's entry once its last
       * handler goes so the map doesn't accumulate empty sets. Unknown
       * events and unregistered handlers are ignored.
       *
       * @param {string} event - Event name.
       * @param {(payload: *) => void} callback - The handler to remove.
       */
      unsubscribe(event, callback) {
        /**
         * Subscribers for this event, absent when nobody listens.
         *
         * @type {Set<(payload: *) => void> | undefined}
         */
        const handlers = this._handlers.get(event);

        if (!handlers) {
          return;
        }

        handlers.delete(callback);

        if (!handlers.size) {
          this._handlers.delete(event);
        }
      },
    },
    /**
     * Feedback record state and its server round trip.
     *
     * @namespace
     */
    feedback: {
      /**
       * @returns {Array<{ id: string }> | undefined} Loaded feedback records, or undefined
       * before the first load.
       */
      get records() {
        return store.getState().feedback.records;
      },
      /**
       * Replaces the loaded records.
       *
       * @param {Array<{ id: string }>} value - The records to store.
       */
      set records(value) {
        store.dispatch(actions.setFeedbackRecords(value));
      },
      /**
       * Loads the feedback records from the server. No-ops without a
       * feedback form, and never raises the overlay — this runs alongside
       * whatever the user is already doing.
       */
      syncRecords: () => {
        if (!APP.feedbackForm) {
          return;
        }

        APP.runServer("getFeedback", [], {
          loading: false,
          variant: "warning",
          prefix: "Couldn't load feedback records: ",
          onData: (records) => {
            APP._internals.feedback.records = records;
          },
        });
      },
    },
    /**
     * Grouped views over the main form's controls, plus the sync and
     * render entry points a consumer drives on input and change.
     *
     * @namespace
     */
    form: {
      /**
       * @returns {HTMLInputElement[]} Every checkbox.
       */
      get checkboxes() {
        return this.inputs.filter((control) => control.type === "checkbox");
      },
      /**
       * @returns {number} Length of the preview's plain-text rendering.
       */
      get charCount() {
        return this.copyText.length;
      },
      /**
       * @returns {string} The preview rendered as one pipe-separated line.
       */
      get copyText() {
        /**
         * The rows flattened to one line. Group headings are dropped —
         * the copied text is a flat summary, not the grouped display.
         *
         * @type {string}
         */
        const rowText = this.preview
          .map(([, label, value]) => `${label}: ${value}`)
          .join(" | ");

        return rowText;
      },
      /**
       * @returns {HTMLInputElement[]} Currency inputs, which render as text
       * and are marked by data-type.
       */
      get currencyInputs() {
        return this.inputs.filter(
          (control) => control.dataset.type === "currency",
        );
      },
      /**
       * @returns {HTMLInputElement[]} Every date input.
       */
      get dateInputs() {
        return this.inputs.filter((control) => control.type === "date");
      },
      /**
       * @returns {HTMLInputElement[]} Every datetime-local input.
       */
      get datetimeInputs() {
        return this.inputs.filter(
          (control) => control.type === "datetime-local",
        );
      },
      /**
       * @returns {HTMLSelectElement[]} Every select, single or multiple.
       */
      get dropdowns() {
        return this.elements.filter(
          (control) => control instanceof HTMLSelectElement,
        );
      },
      /**
       * @returns {HTMLElement[]} Every listed element the form owns, fieldsets
       * included.
       */
      get elements() {
        return Array.from(APP.form?.elements ?? []);
      },
      /**
       * @returns {HTMLInputElement[]} Every email input.
       */
      get emailInputs() {
        return this.inputs.filter((control) => control.type === "email");
      },
      /**
       * @returns {HTMLFieldSetElement[]} Grouping fieldsets only — wizard and
       * list containers are excluded.
       */
      get fieldsets() {
        return this.elements.filter(
          (control) =>
            control instanceof HTMLFieldSetElement &&
            !control.classList.contains("wizard") &&
            !control.classList.contains("list"),
        );
      },
      /**
       * @returns {Array<HTMLInputElement | HTMLSelectElement |
       * HTMLTextAreaElement>} Every value-bearing control.
       */
      get formControls() {
        return [...this.inputs, ...this.dropdowns, ...this.textAreas];
      },
      /**
       * @returns {HTMLInputElement[]} Every input, of any type.
       */
      get inputs() {
        return this.elements.filter(
          (control) => control instanceof HTMLInputElement,
        );
      },
      /**
       * @returns {HTMLSelectElement[]} Multi-select dropdowns.
       */
      get listboxes() {
        return this.dropdowns.filter((control) => control.multiple);
      },
      /**
       * @returns {HTMLFieldSetElement[]} Repeatable list containers.
       */
      get lists() {
        return this.elements.filter(
          (control) =>
            control instanceof HTMLFieldSetElement &&
            control.classList.contains("list"),
        );
      },
      /**
       * Drops every added list row, leaving each list with the one entry
       * it renders with. A form reset clears values but not added rows, so
       * this runs alongside it.
       */
      resetLists() {
        this.lists.forEach((list) => {
          list.querySelectorAll(".list-remove").forEach((button) => {
            button.closest("li")?.remove();
          });
        });
      },
      /**
       * @returns {HTMLInputElement[]} Number inputs, excluding currency.
       */
      get numberInputs() {
        return this.inputs.filter(
          (control) =>
            control.type === "number" && control.dataset.type !== "currency",
        );
      },
      /**
       * @returns {HTMLInputElement[]} Every password input.
       */
      get passwordInputs() {
        return this.inputs.filter((control) => control.type === "password");
      },
      /**
       * Builds the preview rows in document order. A control contributes
       * nothing unless it has a name, is enabled, and holds a value; a
       * list contributes one bulleted row for all its entries; a checked
       * boolean checkbox contributes its label in place of its value.
       * Values resolve their `!{#id}` references and pick up any matching
       * footnote before landing in a row.
       *
       * @returns {PreviewRow[]} The rows, unfrozen.
       */
      get preview() {
        /**
         * Rows accumulated in document order, so the preview reads in the
         * same sequence as the form.
         *
         * @type {PreviewRow[]}
         */
        const rows = [];

        /**
         * The element being considered, walked in document order so the
         * preview reads in the same sequence as the form. Fieldsets
         * arrive alongside controls, which is how list rows are folded
         * into a single row.
         *
         * @type {HTMLElement}
         */
        for (const control of this.elements) {
          if (control instanceof HTMLFieldSetElement) {
            if (
              !this.lists.includes(control) ||
              !control.dataset.name ||
              control.disabled
            ) {
              continue;
            }

            /**
             * The list's filled rows, trimmed. Blank rows drop out, and a
             * list left entirely blank contributes no row at all.
             *
             * @type {string[]}
             */
            const values = Array.from(control.querySelectorAll("input"))
              .map((input) => input.value.trim())
              .filter(Boolean);

            if (!values.length) {
              continue;
            }

            /**
             * The list's label, falling back to its name below.
             *
             * @type {string | undefined}
             */
            const label = control
              .querySelector(".label-text")
              ?.textContent?.trim();

            /**
             * The enclosing group's legend. The list's own fieldset is
             * skipped by the selector, so this finds the group above it.
             *
             * @type {string | undefined}
             */
            const group = control
              .closest("fieldset:not(.wizard):not(.list)")
              ?.querySelector(":scope > legend")
              ?.textContent?.trim();

            rows.push([
              group,
              label || control.dataset.name,
              values.map((v) => `- ${v}`).join("\n"),
            ]);

            continue;
          }

          if (
            control.closest("fieldset.list") ||
            !control.name ||
            control.disabled
          ) {
            continue;
          }

          /**
           * The control's contribution, read differently per type: a
           * checkbox or radio yields its value only while checked, and a
           * select yields its selected options.
           *
           * @type {string}
           */
          let value;

          if (["checkbox", "radio"].includes(control.type)) {
            if (!control.checked) {
              continue;
            }

            value = this.resolveValueReferences(control.value, control);
          } else if (control.tagName === "SELECT") {
            if (control.multiple) {
              value = Array.from(control.selectedOptions)
                .map((option) =>
                  this.resolveValueReferences(option.value, control),
                )
                .filter(Boolean)
                .join(", ");
            } else {
              /**
               * The single selection, absent when nothing is chosen.
               *
               * @type {HTMLOptionElement | undefined}
               */
              const option = control.selectedOptions[0];
              value = option
                ? this.resolveValueReferences(option.value, control)
                : "";
            }
          } else {
            value = control.value;
          }

          value = value.trim();

          if (!value) {
            continue;
          }

          /**
           * Every passing footnote for this control, joined — a control
           * may carry several, and all that match are appended.
           *
           * @type {string | undefined}
           */
          const footnote = getFootnote(control);

          if (footnote) {
            value = `${value} (${footnote})`;
          }

          /**
           * The control's label, falling back to its name below.
           *
           * @type {string | undefined}
           */
          const label = control
            .closest(".form-control")
            ?.querySelector(".label-text")
            ?.textContent?.trim();

          /**
           * The enclosing group's legend, if the control sits in one.
           * Wizard and list containers are skipped — only a real grouping
           * fieldset heads a preview section.
           *
           * @type {string | undefined}
           */
          const group = control
            .closest("fieldset:not(.wizard):not(.list)")
            ?.querySelector(":scope > legend")
            ?.textContent?.trim();

          if (control.type === "checkbox" && value === "true") {
            rows.push([group, "", label || control.name]);
          } else {
            rows.push([group, label || control.name, value]);
          }
        }

        return rows;
      },
      /**
       * @returns {HTMLInputElement[]} Every radio, across all groups.
       */
      get radios() {
        return this.inputs.filter((control) => control.type === "radio");
      },
      /**
       * @returns {HTMLInputElement[]} Every search input.
       */
      get searchInputs() {
        return this.inputs.filter((control) => control.type === "search");
      },
      /**
       * @returns {HTMLSelectElement[]} Single-select dropdowns.
       */
      get selects() {
        return this.dropdowns.filter((control) => !control.multiple);
      },
      /**
       * @returns {HTMLInputElement[]} Every telephone input.
       */
      get telInputs() {
        return this.inputs.filter((control) => control.type === "tel");
      },
      /**
       * @returns {HTMLTextAreaElement[]} Every textarea.
       */
      get textAreas() {
        return this.elements.filter(
          (control) => control instanceof HTMLTextAreaElement,
        );
      },
      /**
       * @returns {HTMLInputElement[]} Text inputs, currency included —
       * currency renders as type text.
       */
      get textInputs() {
        return this.inputs.filter((control) => control.type === "text");
      },
      /**
       * @returns {HTMLInputElement[]} Every time input.
       */
      get timeInputs() {
        return this.inputs.filter((control) => control.type === "time");
      },
      /**
       * @returns {HTMLInputElement[]} Every URL input.
       */
      get urlInputs() {
        return this.inputs.filter((control) => control.type === "url");
      },
      /**
       * Resolves the reference tokens inside an authored value.
       *
       * A conditional token uses quoted rule data:
       * `!{[["nameMatcher", test], "text"]}`. The text is omitted unless
       * the dependency passes, then its ordinary `!{#id}` tokens resolve.
       * A malformed conditional is left in place rather than swallowed.
       *
       * Interpolation follows references through the controls they name,
       * so a value can point at a control whose own value interpolates
       * another. `resolvedIds` breaks the cycle a self- or
       * mutually-referential chain would otherwise create, leaving the
       * offending token untouched.
       *
       * @param {string} value - The authored value.
       * @param {HTMLElement} control - Control the value belongs to; supplies the owning form and document.
       * @param {Set<string>} [resolvedIds] - Ids already resolved on this chain.
       * @returns {string} The value with its tokens resolved.
       */
      resolveValueReferences(value, control, resolvedIds = new Set()) {
        if (typeof value !== "string") {
          return value;
        }

        /**
         * The value with its conditional tokens resolved, run first so any
         * `!{#id}` tokens the surviving text contains are picked up by the
         * interpolation pass below.
         *
         * @type {string}
         */
        const conditional = value.replaceAll(
          /!\{\[\[\s*(["'])((?:\\.|(?!\1)[^\\])*)\1\s*,\s*(?:(["'])((?:\\.|(?!\3)[^\\])*)\3|(true|false))\s*\]\s*,\s*(["'])((?:\\.|(?!\6)[^\\])*)\6\s*\]\}/g,
          (
            token,
            nameQuote,
            name,
            testQuote,
            stringTest,
            booleanTest,
            textQuote,
            text,
          ) => {
            try {
              /**
               * Unescapes one quoted token from the conditional's rule
               * data. Single-quoted source is converted to double-quoted
               * first so JSON.parse can handle both dialects.
               *
               * @param {string} quote - The quote character the token used.
               * @param {string} string - Raw token body, still escaped.
               * @returns {string} The decoded value.
               */
              const decode = (quote, string) =>
                JSON.parse(
                  `"${
                    quote === "'"
                      ? string
                          .replaceAll(/(?<!\\)"/g, '\\"')
                          .replaceAll("\\'", "'")
                      : string
                  }"`,
                );
              /**
               * The decoded dependency the conditional gates on. A
               * boolean test arrives unquoted, a string test quoted.
               *
               * @type {Dependency}
               */
              const dependency = [
                decode(nameQuote, name),
                testQuote
                  ? decode(testQuote, stringTest)
                  : booleanTest === "true",
              ];
              /**
               * The text emitted only while the dependency passes.
               *
               * @type {string}
               */
              const content = decode(textQuote, text);

              if (
                typeof dependency[0] !== "string" ||
                !["string", "boolean"].includes(typeof dependency[1]) ||
                typeof content !== "string"
              ) {
                return token;
              }

              return APP._internals.when([dependency], control.form)
                ? content
                : "";
            } catch {
              return token;
            }
          },
        );

        return conditional.replaceAll(/!\{#([^}]+)\}/g, (token, id) => {
          if (resolvedIds.has(id)) {
            return token;
          }

          /**
           * The control the token names. A missing or empty one leaves
           * the token in place rather than resolving to nothing.
           *
           * @type {HTMLElement | null}
           */
          const source = control.ownerDocument?.getElementById(id);

          return source?.value
            ? this.resolveValueReferences(
                source.value,
                source,
                new Set(resolvedIds).add(id),
              )
            : token;
        });
      },
      /**
       * Renders the preview rows into the definition list, emitting a
       * group heading only where the group changes, and disabling the copy
       * button while there is nothing to copy.
       */
      renderPreview() {
        /**
         * The rows to render, read once so the pass sees a stable
         * snapshot.
         *
         * @type {ReadonlyArray<Readonly<PreviewRow>>}
         */
        const rows = APP.preview;
        /**
         * The group heading most recently emitted, so a run of rows
         * sharing a group produces one heading rather than one apiece.
         *
         * @type {string | undefined}
         */
        let currentGroup;

        APP.previewList.replaceChildren(
          ...rows.flatMap(([group, label, value]) => {
            /**
             * The nodes this row contributes.
             *
             * @type {HTMLElement[]}
             */
            const elements = [];

            if (group && group !== currentGroup) {
              /**
               * Section heading, emitted only where the group changes.
               *
               * @type {HTMLElement}
               */
              const heading = document.createElement("dt");
              heading.className = "preview-group";
              heading.textContent = group;
              elements.push(heading);
            }

            currentGroup = group;

            if (label) {
              /**
               * The row's label. Omitted for a boolean checkbox, whose
               * own label stands in as the value.
               *
               * @type {HTMLElement}
               */
              const term = document.createElement("dt");
              term.textContent = label;
              elements.push(term);
            }

            /**
             * The row's value.
             *
             * @type {HTMLElement}
             */
            const detail = document.createElement("dd");
            detail.textContent = value;

            elements.push(detail);

            return elements;
          }),
        );

        APP.copyPreview.disabled = rows.length === 0;
      },
      /**
       * Refills every alert container from its control's rules, replacing
       * what was there rather than appending, so a value change swaps the
       * alert instead of stacking one on the last.
       *
       * @param {HTMLFormElement} [targetForm] - Form to sync; the feedback form selects the feedback-scoped rules.
       */
      syncAlerts(targetForm = APP.form) {
        /**
         * Which form is being synced, which selects the rule scope.
         *
         * @type {boolean}
         */
        const isFeedback = targetForm === APP.feedbackForm;
        /**
         * Alert rules for that scope.
         *
         * @type {Record<string, Rule[]>}
         */
        const rules = isFeedback
          ? APP.rules.feedbackAlertRules
          : APP.rules.alertRules;

        targetForm.querySelectorAll(".control-alerts").forEach((container) => {
          /**
           * The control this container belongs to, found by the id the
           * container recorded when it was rendered. Null once the
           * control has been removed from the document.
           *
           * @type {HTMLElement | null}
           */
          const control = document.getElementById(container.dataset.controlId);
          /**
           * Rules owned by the control, keyed by id first and then by
           * name.
           *
           * @type {Rule[] | undefined}
           */
          const activeRules =
            control && (rules[control.id] ?? rules[control.name]);

          if (!activeRules || !control) {
            return;
          }

          /**
           * The control's current values, tested against each rule.
           *
           * @type {string[]}
           */
          const values = APP._internals.getValue(control, targetForm);

          container.replaceChildren();

          activeRules
            .filter(
              (r) =>
                APP._internals.match(r.test, values) &&
                APP._internals.when(r.when, targetForm),
            )
            .forEach((r) => {
              container.insertAdjacentHTML(
                "beforeend",
                APP._internals.alertMarkup(r.alert),
              );
            });
        });
      },
      /**
       * Opens the dialog the changed control's first passing modal rule
       * asks for. Driven by an event rather than swept over the form, so
       * only the control the user just touched can raise a dialog.
       *
       * @param {Event} [e] - The change event; ignored without a target carrying an id or name.
       */
      syncModals(e) {
        /**
         * The control the user just changed. Only it can raise a dialog,
         * so a target with neither an id nor a name ends the sync.
         *
         * @type {HTMLElement | undefined}
         */
        const target = e?.target;

        if (!(target?.id || target?.name)) {
          return;
        }

        /**
         * Modal rules for the target's form scope.
         *
         * @type {Record<string, Rule[]>}
         */
        const rules =
          target.form === APP.feedbackForm
            ? APP.rules.feedbackModalRules
            : APP.rules.modalRules;
        /**
         * Rules owned by the target, keyed by id first and then by name.
         *
         * @type {Rule[] | undefined}
         */
        const activeRules = rules[target.id] ?? rules[target.name];

        if (!activeRules) {
          return;
        }

        /**
         * The target's current values.
         *
         * @type {string[]}
         */
        const values = APP._internals.getValue(target);
        /**
         * The first rule that passes. Only one dialog opens per change,
         * so later matches are ignored.
         *
         * @type {Rule | undefined}
         */
        const rule = activeRules.find(
          (r) =>
            APP._internals.match(r.test, values) &&
            APP._internals.when(r.when, target.form),
        );

        if (!rule) {
          return;
        }

        APP._internals.showModal(rule.modal);
      },
      /**
       * Shows the first article whose rule passes, and hides the surface
       * when none does or the resource can't be embedded. At most one
       * article is ever displayed.
       *
       * @param {HTMLFormElement} [targetForm] - Form to resolve rules against.
       */
      syncArticles(targetForm = APP.form) {
        /**
         * Article rules. These are app-scoped only — the feedback form
         * has no article surface.
         *
         * @type {Record<string, Rule[]>}
         */
        const rules = APP.rules.articleRules;
        /**
         * The first passing article across every key. At most one article
         * is shown, so the rest are discarded.
         *
         * @type {Rule | undefined}
         */
        const rule = Object.entries(rules)
          .flatMap(([key, articles]) =>
            articles.filter((article) => {
              /**
               * Values pooled across every control the key resolves to.
               *
               * @type {string[]}
               */
              const values = getRuleTargets(targetForm, key).flatMap(
                (control) => APP._internals.getValue(control, targetForm),
              );

              return (
                APP._internals.match(article.test, values) &&
                APP._internals.when(article.when, targetForm)
              );
            }),
          )
          .at(0);

        if (!rule || !APP._internals.showArticle(rule.article)) {
          APP._internals.hideArticle();
          return;
        }
      },
      /**
       * The single entry point that brings the form back in step with its
       * rules: wizards and criteria first, driven to a fixed point
       * together, then autofills and requisitions.
       *
       * Wizard and criteria visibility both read the `disabled` state the
       * other writes, so applying each once in a fixed order would leave
       * whichever ran first deciding against state the other had not
       * corrected yet. Repeating until nothing moves makes the outcome
       * independent of the order rules were authored in.
       *
       * @param {Event} [e] - The originating event, forwarded to modal syncing; syncing itself sweeps the whole form.
       * @param {HTMLFormElement} [targetForm] - Form to sync; the feedback form selects the feedback-scoped rules.
       */
      syncWizards(e, targetForm = APP.form) {
        /**
         * Applies one wizard container's rules, revealing each target
         * whose rule currently passes.
         *
         * @param {HTMLFieldSetElement} fieldset - The wizard container.
         * @returns {boolean} Whether any target's visibility changed.
         */
        const syncFieldset = (fieldset) => {
          /**
           * A checkbox/radio controller renders as the fieldset's
           * preceding sibling; every other control type still renders as
           * its first child (see renderEntry).
           *
           * @type {boolean}
           */
          const external = ["checkbox", "radio"].includes(
            fieldset.dataset.type,
          );
          /**
           * The label driving this container.
           *
           * @type {HTMLElement | null}
           */
          const controller = getWizardController(fieldset);
          /**
           * The control that label points at, whose value decides what
           * the container reveals.
           *
           * @type {HTMLElement | null}
           */
          const control = document.getElementById(controller?.htmlFor ?? "");

          if (!(control?.id || control?.name)) {
            return false;
          }

          /**
           * Whether this pass moved anything, so the caller knows if the
           * fixed point has settled.
           *
           * @type {boolean}
           */
          let changed = false;
          /**
           * The controller's current values.
           *
           * @type {string[]}
           */
          const values = APP._internals.getValue(control, targetForm);
          /**
           * Wizard rules for this form's scope.
           *
           * @type {Record<string, Rule[]>}
           */
          const rules =
            targetForm === APP.feedbackForm
              ? APP.rules.feedbackWizardRules
              : APP.rules.wizardRules;
          /**
           * Rules owned by the controller, keyed by id first and then by
           * name. Their order matches the targets below positionally.
           *
           * @type {Rule[]}
           */
          const activeRules = rules[control.id] ?? rules[control.name] ?? [];

          /**
           * The container's direct children that can be revealed.
           *
           * @type {HTMLElement[]}
           */
          const wizards = Array.from(
            fieldset.querySelectorAll(
              ":scope > :is(.form-control, fieldset.wizard, fieldset.list)",
            ),
          );

          /**
           * The children each rule actually governs, aligned to
           * activeRules by position. An embedded controller is dropped
           * (it is the container's own first child, not a target), as is
           * a checkbox or radio controller paired with its own nested
           * container — that pair is governed as one unit by the nested
           * container's own sync.
           *
           * @type {HTMLElement[]}
           */
          const targets = (external ? wizards : wizards.slice(1)).filter(
            (wizard) =>
              !(
                wizard.matches(".form-control") &&
                wizard.querySelector(
                  'input:is([type="checkbox"], [type="radio"])',
                ) &&
                wizard.nextElementSibling?.matches(
                  'fieldset.wizard[data-type="checkbox"], fieldset.wizard[data-type="radio"]',
                )
              ),
          );

          /**
           * Each target's outcome, kept so the shell check below can read
           * what this loop already worked out rather than resolving every
           * rule's dependencies a second time.
           *
           * @type {(boolean | undefined)[]}
           */
          const resolved = [];

          targets.forEach((wizard, i) => {
            /**
             * The rule governing this target, matched by position.
             * Absent when there are more targets than rules.
             *
             * @type {Rule | undefined}
             */
            const rule = activeRules[i];
            /**
             * Whether the target should be revealed: it needs a rule
             * whose test matches and whose dependencies all pass.
             *
             * @type {boolean | undefined}
             */
            const show =
              rule &&
              APP._internals.match(rule.test, values) &&
              APP._internals.when(rule.when, targetForm);

            resolved.push(show);

            if (wizard.hidden !== !show) {
              changed = true;
            }

            if (!show && !wizard.hidden) {
              resetControls(wizard);
            }

            wizard.hidden = !show;

            if (wizard instanceof HTMLFieldSetElement) {
              wizard.disabled = !show;
            } else {
              wizard
                .querySelectorAll("input, select, textarea")
                .forEach((control) => (control.disabled = !show));
            }
          });

          if (!external) {
            return changed;
          }

          /**
           * Whether anything is currently eligible to reveal. When
           * nothing is, the shell is collapsed and disabled — so nothing
           * inside can still submit a stale value — rather than left as
           * an empty box beside the controller.
           *
           * Reached only in the external case: elsewhere the controller
           * is this fieldset's own first child, and hiding the fieldset
           * would take the controller with it.
           *
           * Rules the loop above already settled are read back from it;
           * only rules with no target of their own — which still count
           * toward the shell — are resolved here.
           *
           * @type {boolean}
           */
          const anyShown = activeRules.some((rule, i) =>
            i < resolved.length
              ? Boolean(resolved[i])
              : APP._internals.match(rule.test, values) &&
                APP._internals.when(rule.when, targetForm),
          );
          if (fieldset.hidden !== !anyShown) {
            changed = true;
          }

          if (!anyShown && !fieldset.hidden) {
            resetControls(fieldset);
          }

          fieldset.hidden = !anyShown;
          fieldset.disabled = !anyShown;

          return changed;
        };

        /**
         * Every wizard container in the form, collected once and reused
         * across passes.
         *
         * @type {HTMLFieldSetElement[]}
         */
        const wizards = Array.from(
          targetForm?.querySelectorAll("fieldset.wizard") ?? [],
        );

        /**
         * How many criteria rules are in play, which bounds how far a
         * dependency chain can propagate.
         *
         * @type {number}
         */
        const criteriaCount = Object.keys(
          targetForm === APP.feedbackForm
            ? APP.rules.feedbackCriteriaRules
            : APP.rules.criteriaRules,
        ).length;
        /**
         * Pass ceiling: enough for a chain spanning every wizard and
         * criteria rule to propagate, plus one to confirm nothing moved.
         * Also stops mutually contradictory rules from spinning.
         *
         * @type {number}
         */
        const limit = wizards.length + criteriaCount + 1;

        /**
         * Which pass this is. Bounded rather than looping until settled
         * so contradictory rules terminate.
         *
         * @type {number}
         */
        for (let pass = 0; pass <= limit; pass++) {
          /**
           * Whether this pass moved anything anywhere.
           *
           * @type {boolean}
           */
          let changed = false;

          /**
           * The wizard container being synced this pass.
           *
           * @type {HTMLFieldSetElement}
           */
          for (const fieldset of wizards) {
            if (syncFieldset(fieldset)) {
              changed = true;
            }
          }

          if (syncCriteria(targetForm)) {
            changed = true;
          }

          if (!changed) {
            break;
          }
        }

        syncAutofills(targetForm);
        syncRequisitions(targetForm);
      },
    },
  },
};

/**
 * Applies one criteria rule, hiding or revealing every control the key
 * resolves to and disabling what it hides, so nothing hidden can still
 * submit a stale value.
 *
 * A wizard container whose controller this rule owns follows the
 * controller: an embedded controller drags its container in both
 * directions, while an external one only collapses it — reopening is the
 * wizard sync's call, since the controller's own value decides it.
 *
 * @param {HTMLFormElement} targetForm - Form to apply against.
 * @param {string} key - Control id, control name, or list data-name the rule targets.
 * @param {Dependency[]} criteria - Dependencies that must all pass for the target to show.
 * @returns {boolean} Whether any target's visibility changed.
 */
function applyCriterion(targetForm, key, criteria) {
  /**
   * Everything this rule governs. Resolved before its dependencies are:
   * a key addressing nothing has no outcome to apply, so there is no
   * point deciding one.
   *
   * @type {HTMLElement[]}
   */
  const ruleTargets = getRuleTargets(targetForm, key);

  if (!ruleTargets.length) {
    return false;
  }

  /**
   * Whether the rule's dependencies currently pass, decided once and
   * applied to every target the key resolves to.
   *
   * @type {boolean}
   */
  const show = APP._internals.when(criteria, targetForm);
  /**
   * Whether applying this rule moved anything.
   *
   * @type {boolean}
   */
  let changed = false;

  ruleTargets.forEach((target) => {
    /**
     * What actually gets hidden: a fieldset target hides itself, while a
     * plain control hides its whole labeled wrapper so the label goes
     * with it.
     *
     * @type {HTMLElement | null}
     */
    const node =
      target instanceof HTMLFieldSetElement
        ? target
        : target.closest(".form-control");

    if (!node) {
      return;
    }

    /**
     * Whether this rule is closing over something currently open, which is
     * the moment its values stop being reachable and have to go.
     *
     * @type {boolean}
     */
    const closing = !show && !node.hidden;

    if (node.hidden !== !show) {
      changed = true;
    }

    node.hidden = !show;

    if (closing) {
      resetControls(node);
    }

    if (node instanceof HTMLFieldSetElement) {
      node.disabled = !show;
      return;
    }

    node
      .querySelectorAll("input, select, textarea")
      .forEach((control) => (control.disabled = !show));

    /**
     * The container this control sits inside as its controller, if any.
     * An embedded controller's container follows it in both directions —
     * hiding the controller must take the box with it.
     *
     * @type {HTMLElement | null}
     */
    const embeddedWizard = node.parentElement?.matches("fieldset.wizard")
      ? node.parentElement
      : null;
    /**
     * The container this control drives, embedded or as a sibling.
     *
     * @type {HTMLElement | null}
     */
    const wizard = embeddedWizard ??
      (node.nextElementSibling?.matches("fieldset.wizard")
        ? node.nextElementSibling
        : null);

    if (wizard && getWizardController(wizard) === node) {
      if (embeddedWizard || !show) {
        wizard.hidden = !show;
        wizard.disabled = !show;
      }
    }
  });

  return changed;
}

/**
 * Writes text to the clipboard, reporting either outcome as a toast. A
 * rejected write is reported rather than rethrown — a denied clipboard
 * permission is a normal condition, not a failure worth breaking on.
 *
 * @param {string} text - Text to copy.
 */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    APP.toast("Copied to clipboard.", "tip");
  } catch (_error) {
    APP.toast("Couldn't copy to clipboard.", "caution");
  }
}

/**
 * Builds the label row every control shares: its text, plus a tooltip when
 * the entry carries a hint. Both render as markup, so a label or hint may
 * contain inline HTML.
 *
 * @param {Pick<SchemaEntry, "label" | "hint">} entry - Entry supplying the label text and optional hint.
 * @returns {HTMLSpanElement} The toolbar.
 */
function createLabelToolbar({ label, hint }) {
  /**
   * The label row.
   *
   * @type {HTMLSpanElement}
   */
  const toolbar = document.createElement("span");
  toolbar.className = "label-toolbar";

  /**
   * The label text. Read back by the preview to title each row, so its
   * class is load-bearing rather than presentational.
   *
   * @type {HTMLSpanElement}
   */
  const labelText = document.createElement("span");
  labelText.className = "label-text";
  labelText.innerHTML = label;
  toolbar.append(labelText);

  if (hint) {
    /**
     * Wraps the hint's trigger and text.
     *
     * @type {HTMLSpanElement}
     */
    const tooltip = document.createElement("span");
    tooltip.className = "tooltip";

    /**
     * Decorative trigger the stylesheet fills.
     *
     * @type {HTMLElement}
     */
    const tooltipIcon = document.createElement("i");
    tooltipIcon.className = "tooltip-icon";
    tooltipIcon.setAttribute("aria-hidden", "true");
    tooltip.append(tooltipIcon);

    /**
     * The hint itself, rendered as markup.
     *
     * @type {HTMLSpanElement}
     */
    const tooltipText = document.createElement("span");
    tooltipText.className = "tooltip-text";
    tooltipText.innerHTML = hint;

    tooltip.append(tooltipText);
    toolbar.append(tooltip);
  }

  return toolbar;
}

/**
 * Criteria rule keys in the order they should be applied: shallowest
 * dependency chain first.
 *
 * A rule's depth is one more than the deepest rule it depends on, and a
 * dependency naming no rule of its own is a root at zero. Applying them in
 * that order means a rule reads `disabled` state its dependencies have
 * already settled this pass, so a chain the length of the form resolves in
 * one pass rather than one pass per link.
 *
 * Keys of equal depth keep their authored order, since sorting is stable.
 *
 * Depth follows from the rules alone and never from the DOM, so the result
 * is memoized against the rule object itself.
 *
 * @param {Record<string, Dependency[]>} [rules] - Criteria rules for one form's scope.
 * @returns {string[]} The rule keys, shallowest first.
 */
function criteriaOrder(rules) {
  if (!rules) {
    return [];
  }

  /**
   * The order already worked out for this exact rule object, if it has
   * been applied before.
   *
   * @type {string[] | undefined}
   */
  const memoized = criteriaOrders.get(rules);

  if (memoized) {
    return memoized;
  }

  /**
   * Depth per key, filled in as the recursion settles each one.
   *
   * @type {Map<string, number>}
   */
  const depths = new Map();
  /**
   * Keys on the current path, so a dependency cycle stops instead of
   * recurring forever. A key already being visited counts as a root —
   * contradictory rules remain the pass ceiling's problem, not this
   * function's.
   *
   * @type {Set<string>}
   */
  const visiting = new Set();
  /**
   * How deep one key's dependency chain runs.
   *
   * @param {string} key - Rule key to measure.
   * @returns {number} The key's depth.
   */
  const depth = (key) => {
    if (depths.has(key)) {
      return depths.get(key);
    }

    /**
     * What the key depends on. A key with none — including one naming a
     * control no rule is keyed to — is a root.
     *
     * @type {Dependency[] | undefined}
     */
    const dependencies = rules[key];

    if (!dependencies?.length || visiting.has(key)) {
      return 0;
    }

    visiting.add(key);

    /**
     * One past the deepest dependency.
     *
     * @type {number}
     */
    const measured =
      1 + Math.max(...dependencies.map(([dependency]) => depth(dependency)));

    visiting.delete(key);
    depths.set(key, measured);

    return measured;
  };
  /**
   * The keys, shallowest first.
   *
   * @type {string[]}
   */
  const ordered = Object.keys(rules).sort((a, b) => depth(a) - depth(b));

  criteriaOrders.set(rules, ordered);

  return ordered;
}

/**
 * Whether one dependency passes against the current form state.
 *
 * A literal key is resolved through the form's own named-access
 * collection, which indexes controls by id and name — a lookup rather
 * than a walk over every control in the form. Only a regex key, which may
 * match several distinct names at once, still has to scan, and it scans
 * the distinct names rather than the whole form.
 *
 * An id match wins outright; failing that, the values of every control
 * sharing the name are pooled, so one member satisfying the test is
 * enough for the group. Disabled controls are invisible either way, which
 * is what makes a rule fail closed when it depends on something another
 * rule has hidden.
 *
 * @param {string} key - Control id or name, or a "/pattern/flags" regex matched against names.
 * @param {string | boolean} test - The test the matched values must satisfy.
 * @param {HTMLFormElement} [targetForm] - Form to resolve against.
 * @returns {boolean} Whether the dependency passes.
 */
function dependencyPasses(key, test, targetForm) {
  if (!PATTERN_KEY.test(key)) {
    /**
     * Enabled controls the form indexes under this key, by id or name.
     * Excluding disabled ones is what makes a rule fail closed when it
     * depends on something another rule has hidden. Matched rather than
     * read off `disabled`, which ignores a disabled fieldset ancestor.
     *
     * @type {HTMLElement[]}
     */
    const named = namedControls(key, targetForm).filter(
      (control) => !control.matches(":disabled"),
    );
    /**
     * A control whose id is the key. An id match wins outright — the name
     * tier is only consulted when there is none.
     *
     * @type {HTMLElement | undefined}
     */
    const idMatch = named.find((control) => control.id === key);

    if (idMatch) {
      return APP._internals.match(
        test,
        APP._internals.getValue(idMatch, targetForm),
      );
    }

    // Whatever is left matched on name, so it is already the one group a
    // literal key can address — no name tier to iterate.
    return (
      named.length > 0 &&
      APP._internals.match(
        test,
        named.flatMap((control) =>
          APP._internals.getValue(control, targetForm),
        ),
      )
    );
  }

  /**
   * The controls a regex key may resolve against: addressable, and
   * enabled.
   *
   * @type {HTMLElement[]}
   */
  const enabled = Array.from(targetForm?.elements ?? []).filter(
    (control) => (control.id || control.name) && !control.matches(":disabled"),
  );
  /**
   * Distinct names among those controls, so a group sharing a name is
   * considered once rather than per member.
   *
   * @type {Set<string>}
   */
  const uniques = new Set(enabled.map((control) => control.name));

  return [...uniques].some((name) => {
    if (!name || !APP._internals.match(key, [name])) {
      return false;
    }

    /**
     * Values pooled across every control sharing the name, so one member
     * satisfying the test is enough for the group.
     *
     * @type {string[]}
     */
    const values = enabled
      .filter((control) => control.name === name)
      .flatMap((control) => APP._internals.getValue(control, targetForm));

    return APP._internals.match(test, values);
  });
}

/**
 * The resolved footnote a control contributes, or an empty string when no
 * rule applies. Rules are keyed by the control's id first and then by its
 * name, and every rule that passes contributes, joined in authored order.
 *
 * @param {HTMLElement} control - The control the rules are keyed to.
 * @returns {string} The resolved footnote.
 */
function getFootnote(control) {
  return (
    (
      APP.rules.footnoteRules[control.id] ??
      APP.rules.footnoteRules[control.name]
    )
      ?.filter(
        (r) =>
          APP._internals.match(r.test, APP._internals.getValue(control)) &&
          APP._internals.when(r.when, control.form),
      )
      .map((r) =>
        APP._internals.form.resolveValueReferences(r.footnote, control),
      )
      .join(" ") ?? ""
  );
}

/**
 * The single control a rule key targets, for rules that can only act on
 * one — autofills and requisitions, which write a value or a required
 * flag.
 *
 * @param {HTMLFormElement} targetForm - Form to resolve against.
 * @param {string} key - Control id, control name, or list data-name.
 * @returns {HTMLElement | undefined} The first match, or undefined.
 */
function getRuleTarget(targetForm, key) {
  return (
    getRuleTargets(targetForm, key)[0] ??
    Array.from(
      targetForm?.querySelectorAll("fieldset.list[data-name]") ?? [],
    ).find(
      (element) => element.dataset.name === key,
    )
  );
}

/**
 * Every control a rule key targets, resolved in precedence order: an
 * element id first, then a shared control name, then a list fieldset's
 * data-name. The first tier to match wins outright, so an id-keyed rule
 * never spills onto controls that merely share a name.
 *
 * @param {HTMLFormElement} targetForm - Form to resolve against.
 * @param {string} key - Control id, control name, or list data-name.
 * @returns {HTMLElement[]} The matching controls, possibly empty.
 */
function getRuleTargets(targetForm, key) {
  /**
   * Controls the form indexes under the key, by id or name. Unlike
   * dependency resolution, disabled controls are kept — a rule still
   * governs what it has hidden.
   *
   * @type {HTMLElement[]}
   */
  const named = namedControls(key, targetForm);
  /**
   * A control whose id is the key. The lookup does not say which of id or
   * name matched, so precedence is decided here — over a handful of
   * controls rather than the whole form.
   *
   * @type {HTMLElement | undefined}
   */
  const idMatch = named.find((control) => control.id === key);

  if (idMatch) {
    return [idMatch];
  }

  if (named.length) {
    return named;
  }

  return Array.from(
    targetForm?.querySelectorAll("fieldset.list[data-name]") ?? [],
  ).filter((element) => element.dataset.name === key);
}

/**
 * The label whose control drives a wizard container. A checkbox or radio
 * controller renders as the container's preceding sibling; every other
 * type renders as its first child (see renderEntry).
 *
 * @param {HTMLFieldSetElement} fieldset - The wizard container.
 * @returns {HTMLElement | null} The controlling label.
 */
function getWizardController(fieldset) {
  return ["checkbox", "radio"].includes(fieldset.dataset.type)
    ? fieldset.previousElementSibling
    : fieldset.querySelector(":scope > .form-control");
}

/**
 * The controls a form indexes under one key.
 *
 * `form.elements` indexes its members by both id and name, so a literal
 * key resolves through it directly instead of walking every control. The
 * collection yields a single element, a list when several share the name,
 * or nothing — and it does not say which of the two matched, so callers
 * that care about id-over-name precedence re-check that on the result.
 *
 * Disabled controls are returned too: whether they count is the caller's
 * policy, and the two callers disagree. Dependency resolution excludes
 * them so a rule fails closed, while a rule still governs the targets it
 * has itself hidden.
 *
 * @param {string} key - Control id or name.
 * @param {HTMLFormElement} [targetForm] - Form to resolve against.
 * @returns {HTMLElement[]} The matching controls, possibly empty.
 */
function namedControls(key, targetForm) {
  /**
   * What the collection indexes under the key: one element, a list of
   * them, or nothing.
   *
   * @type {HTMLElement | RadioNodeList | null}
   */
  const named = targetForm?.elements?.namedItem?.(key) ?? null;

  if (!named) {
    return [];
  }

  return named instanceof HTMLElement ? [named] : Array.from(named);
}

/**
 * Restores a control, or everything inside a container, to the state the
 * schema authored.
 *
 * A rule hiding something must not leave a value behind it: the control is
 * gone from the user's view, so a value it still holds is one nobody can
 * see, correct, or account for — and it would reappear intact if the rule
 * later reveals the control again. Defaults are restored rather than
 * blanked so an entry that authored `value` or `checked` comes back as
 * authored, which is what a form reset does.
 *
 * @param {HTMLElement} node - A control, or a container holding some.
 * @returns {void}
 */
function resetControls(node) {
  /**
   * The controls to restore: the node itself when it is one, otherwise
   * everything it contains.
   *
   * @type {HTMLElement[]}
   */
  const controls = node.matches("input, select, textarea")
    ? [node]
    : Array.from(node.querySelectorAll("input, select, textarea"));

  controls.forEach((control) => {
    if (control instanceof HTMLSelectElement) {
      Array.from(control.options).forEach((option) => {
        option.selected = option.defaultSelected;
      });
      return;
    }

    if (["checkbox", "radio"].includes(control.type)) {
      control.checked = control.defaultChecked;
      return;
    }

    // A file input rejects any value but the empty string, which is also
    // its default, so this stays valid for every remaining type.
    control.value = control.defaultValue;
  });
}

/**
 * Subscribes the framework's own handlers to the event bus and forwards
 * the lifecycle events a consumer asked to hear about.
 *
 * @param {object} callbacks - Consumer lifecycle callbacks.
 * @param {(data: *) => void} [callbacks.onWorkflowLoaded] - Called when a workflow finishes loading.
 * @param {(detail: *) => void} [callbacks.onAppInit] - Called on the app:init event.
 * @param {() => void} [callbacks.onRecordsTab] - Called when the records tab is selected.
 */
function setupAppEvents({ onWorkflowLoaded, onAppInit, onRecordsTab }) {
  APP.subscribe("overlay:show", () => store.dispatch(actions.setLoading(true)));

  APP.subscribe("overlay:hide", () =>
    store.dispatch(actions.setLoading(false)),
  );

  APP.subscribe("tab:change", ({ id }) => {
    if (id === "panel-records") {
      onRecordsTab?.();
    }
  });

  APP.subscribe("record:created", () => {
    APP.form?.reset();
    APP.toast("Submission received.", "tip");
  });

  APP.subscribe("feedback:submitted", (record) => {
    store.dispatch(actions.prependFeedbackRecord(record));
    APP.feedbackForm?.reset();
    APP.notify(
      `Thanks for the feedback! Keep this ID for reference:\n<span class="copyable"><code>${record.id}</code><button type="button" class="copy-button" data-copy="${record.id}" aria-label="Copy ID"><i class="copy-icon" aria-hidden="true"></i></button></span>`,
      { header: "Feedback submitted", variant: "tip" },
    );
  });

  APP.subscribe("workflow:loaded", (data) => onWorkflowLoaded?.(data));
  APP.subscribe("app:init", (onInit) => onAppInit?.(onInit));
}

/**
 * Wires both dialogs: their closing controls, the confirm dialog's
 * accept/dismiss outcome events, and the copy buttons a message body may
 * contain. The outcome is read from the dialog's returnValue on close, so
 * dismissing with Escape reports the same result as the cancel button.
 */
function setupDialogs() {
  [APP.messageModalDismiss, APP.messageModalClose].forEach((button) =>
    button?.addEventListener("click", () => APP.messageModal.close()),
  );

  APP.confirmModalConfirm?.addEventListener("click", () =>
    APP.confirmModal.close("confirm"),
  );

  [APP.confirmModalCancel, APP.confirmModalClose].forEach((button) =>
    button?.addEventListener("click", () => APP.confirmModal.close("cancel")),
  );

  APP.confirmModal?.addEventListener("close", () => {
    APP.publish(
      APP.confirmModal.returnValue === "confirm"
        ? "confirm:accepted"
        : "confirm:cancelled",
      APP._internals.confirmDetail,
    );

    store.dispatch(actions.setConfirmDetail(undefined));
    APP.publish("modal:closed");
  });

  APP.messageModal?.addEventListener("close", () =>
    APP.publish("modal:closed"),
  );

  APP.messageModal?.addEventListener("click", async (event) => {
    /**
     * The copy button the click landed on, if any — a message body may
     * embed one, and clicks elsewhere in the dialog are ignored.
     *
     * @type {HTMLElement | null}
     */
    const button = event.target.closest(".copy-button");

    if (!button) {
      return;
    }

    await copyToClipboard(button.dataset.copy);
  });
}

/**
 * Wires both forms. The main form syncs its rules on change; the feedback
 * form additionally syncs on input, since it has no consumer driving it.
 * Reset handling waits a frame — the browser clears values after the event
 * fires, so syncing any sooner would read the outgoing values.
 *
 * @param {() => void} [onFormReset] - Consumer callback run after the main form resets.
 */
function setupForms(onFormReset) {
  APP.form?.addEventListener("change", (event) =>
    APP._internals.form.syncWizards(event),
  );

  APP.form?.addEventListener("reset", () =>
    requestAnimationFrame(() => {
      APP._internals.form.resetLists();
      onFormReset?.();
    }),
  );

  APP.feedbackForm?.addEventListener("input", (event) =>
    APP._internals.form.syncWizards(event, APP.feedbackForm),
  );

  APP.feedbackForm?.addEventListener("change", (event) => {
    APP._internals.form.syncWizards(event, APP.feedbackForm);
    APP._internals.form.syncModals(event);
    APP._internals.form.syncAlerts(APP.feedbackForm);
  });

  APP._internals.form.syncWizards(undefined, APP.feedbackForm);

  APP.feedbackForm?.addEventListener("reset", () =>
    requestAnimationFrame(() => {
      APP._internals.form.syncWizards(undefined, APP.feedbackForm);
      APP._internals.form.syncAlerts(APP.feedbackForm);
    }),
  );

  APP.copyPreview?.addEventListener("click", async () => {
    if (!APP.form.reportValidity()) {
      return;
    }

    const { charCount, copyText } = APP;

    if (charCount) {
      await copyToClipboard(copyText);
    }
  });

  APP.themeToggle?.addEventListener("change", () => {
    APP.theme = APP.themeToggle.checked ? "dark" : "light";
  });
}

/**
 * Wires navigation: tabs and their arrow/Home/End keyboard handling, the
 * dropdowns and the document-level clicks and Escape presses that close
 * them, the top-nav toggle, and the side-nav open and close controls.
 * Also suppresses navigation for `javascript:` links, which exist only to
 * carry a data attribute.
 */
function setupNavigation() {
  document.addEventListener("click", (event) => {
    if (event.target.closest?.('a[href^="javascript:"]')) {
      event.preventDefault();
    }
  });

  APP.tabs.forEach((tab, index) => {
    tab.addEventListener("click", () =>
      APP.navigator.selectTab(tab.dataset.tabId),
    );

    tab.addEventListener("keydown", (event) => {
      /**
       * Index of the final tab, which both End and the arrow keys' wrap
       * behavior are expressed against.
       *
       * @type {number}
       */
      const last = APP.tabs.length - 1;
      /**
       * The tab to move to, left unassigned for keys this handler does
       * not act on — those return without preventing the default.
       *
       * @type {number}
       */
      let next;

      switch (event.key) {
        case "ArrowRight": {
          next = index === last ? 0 : index + 1;
          break;
        }
        case "ArrowLeft": {
          next = index === 0 ? last : index - 1;
          break;
        }
        case "Home": {
          next = 0;
          break;
        }
        case "End": {
          next = last;
          break;
        }
        default: {
          return;
        }
      }

      event.preventDefault();
      APP.navigator.selectTab(APP.tabs[next].dataset.tabId);
      APP.tabs[next].focus();
    });
  });

  APP.dropdowns.forEach((dropdown) => {
    dropdown
      .querySelector(".dropdown-button")
      ?.addEventListener("click", () => APP.toggleDropdown(dropdown));
  });

  APP.topnavToggle?.addEventListener("click", (event) => {
    event.preventDefault();
    APP.topnav?.classList.toggle("expanded");
  });

  APP.sideNavControllers.forEach((element) =>
    element?.addEventListener("click", (event) => {
      event.preventDefault();
      APP.sidenav?.classList.add("open");
    }),
  );

  APP.sidenavClose?.addEventListener("click", (event) => {
    event.preventDefault();
    APP.sidenav?.classList.remove("open");
  });

  document.addEventListener("click", (event) => {
    APP.dropdowns
      .filter((dropdown) => !dropdown.contains(event.target))
      .forEach((dropdown) => APP.toggleDropdown(dropdown, false));
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      APP.dropdowns.forEach((dropdown) => APP.toggleDropdown(dropdown, false));
    }
  });
}

/**
 * Wires the feedback drawer and the notepad, including the notepad's
 * pointer drag. The drag takes pointer capture so it survives the cursor
 * leaving the handle, and ignores non-primary buttons and presses landing
 * on the close button.
 */
function setupSurfaces() {
  APP.openFeedbackDrawer?.addEventListener("click", (event) => {
    event.preventDefault();
    APP.feedbackDrawer?.classList.add("open");
  });

  APP.closeFeedbackDrawer?.addEventListener("click", (event) => {
    event.preventDefault();
    APP.feedbackDrawer?.classList.remove("open");
    APP.feedbackForm?.reset();
  });

  APP.closeNotepad?.addEventListener("click", () =>
    APP.notepad.classList.add("closed"),
  );

  APP.openNotepad?.addEventListener("click", () =>
    APP.notepad.classList.remove("closed"),
  );

  APP.notepadHandle?.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target === APP.closeNotepad) {
      return;
    }

    /**
     * The notepad's position at the moment the drag starts, measured once
     * so the grab offset stays fixed for the whole gesture.
     *
     * @type {DOMRect}
     */
    const rect = APP.notepad.getBoundingClientRect();
    /**
     * Where inside the notepad the pointer took hold, so the drag moves
     * the panel by its grab point rather than snapping a corner to the
     * cursor.
     *
     * @type {number}
     */
    const grabX = event.clientX - rect.left;
    /**
     * Vertical counterpart to grabX.
     *
     * @type {number}
     */
    const grabY = event.clientY - rect.top;
    APP.notepad.style.right = "auto";
    APP.notepad.style.bottom = "auto";

    /**
     * Repositions the notepad to follow the pointer.
     *
     * @param {PointerEvent} move - The move event.
     */
    const onPointerMove = (move) => {
      APP.notepad.style.left = move.clientX - grabX + "px";
      APP.notepad.style.top = move.clientY - grabY + "px";
    };
    /**
     * Ends the drag, releasing capture and removing both listeners so the
     * notepad stops tracking the pointer.
     *
     * @param {PointerEvent} up - The release event.
     */
    const onPointerUp = (up) => {
      APP.notepadHandle.releasePointerCapture(up.pointerId);
      APP.notepadHandle.removeEventListener("pointermove", onPointerMove);
      APP.notepadHandle.removeEventListener("pointerup", onPointerUp);
    };

    APP.notepadHandle.setPointerCapture(event.pointerId);
    APP.notepadHandle.addEventListener("pointermove", onPointerMove);
    APP.notepadHandle.addEventListener("pointerup", onPointerUp);
  });
}

/**
 * Writes each autofill rule's value into its target, using the first rule
 * whose dependencies pass. Only a scalar target can be filled — checkbox,
 * file, radio, multi-select, and disabled controls are skipped.
 *
 * A matching rule reapplies on every sync, so a value the user types while
 * its condition still holds is overwritten; once no rule matches the
 * target is left alone entirely, and the last filled value stays put.
 *
 * @param {HTMLFormElement} targetForm - Form to sync; the feedback form selects the feedback-scoped rules.
 */
function syncAutofills(targetForm) {
  /**
   * Autofill rules for this form's scope.
   *
   * @type {Record<string, Rule[]>}
   */
  const rules =
    targetForm === APP.feedbackForm
      ? APP.rules.feedbackAutofillRules
      : APP.rules.autofillRules;

  Object.entries(rules).forEach(([key, autofills]) => {
    /**
     * The control to fill.
     *
     * @type {HTMLElement | undefined}
     */
    const target = getRuleTarget(targetForm, key);
    /**
     * Whether the target can hold a scalar value at all. Checkbox, file,
     * radio, and multi-select targets are excluded — an autofill writes
     * one value, which none of them can accept meaningfully.
     *
     * @type {boolean}
     */
    const eligible =
      (target instanceof HTMLInputElement &&
        !["checkbox", "file", "radio"].includes(target.type)) ||
      (target instanceof HTMLSelectElement && !target.multiple);

    if (!eligible || target.disabled) {
      return;
    }

    /**
     * The first rule whose dependencies pass. With none matching the
     * target is left untouched rather than cleared.
     *
     * @type {Rule | undefined}
     */
    const rule = autofills.find((autofill) =>
      APP._internals.when(autofill.when, targetForm),
    );

    if (!rule) {
      return;
    }

    target.value = APP._internals.form.resolveValueReferences(rule.value, target) ?? "";
  });
}

/**
 * Runs one pass over every criteria rule and reports whether anything
 * moved. The caller in syncWizards drives this to a fixed point alongside
 * the wizard sync, since the two read each other's `disabled` writes.
 *
 * @param {HTMLFormElement} targetForm - Form to sync; the feedback form selects the feedback-scoped rules.
 * @returns {boolean} Whether any target's visibility changed this pass.
 */
function syncCriteria(targetForm) {
  /**
   * Criteria rules for this form's scope.
   *
   * @type {Record<string, Dependency[]>}
   */
  const rules =
    targetForm === APP.feedbackForm
      ? APP.rules.feedbackCriteriaRules
      : APP.rules.criteriaRules;
  /**
   * Whether this pass moved anything, reported so the caller can tell a
   * settled pass from one that still has work.
   *
   * @type {boolean}
   */
  let changed = false;

  for (const key of criteriaOrder(rules)) {
    if (applyCriterion(targetForm, key, rules[key])) {
      changed = true;
    }
  }

  return changed;
}

/**
 * Toggles each requisition rule's target between required and optional as
 * its dependencies pass or fail. Only a control that can carry the flag is
 * eligible; a fieldset target is skipped.
 *
 * @param {HTMLFormElement} targetForm - Form to sync; the feedback form selects the feedback-scoped rules.
 */
function syncRequisitions(targetForm) {
  /**
   * Requisition rules for this form's scope.
   *
   * @type {Record<string, Dependency[]>}
   */
  const rules =
    targetForm === APP.feedbackForm
      ? APP.rules.feedbackRequisitionRules
      : APP.rules.requisitionRules;

  Object.entries(rules).forEach(([key, requisitions]) => {
    /**
     * The control to mark required or optional.
     *
     * @type {HTMLElement | undefined}
     */
    const target = getRuleTarget(targetForm, key);

    if (
      !(
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement
      )
    ) {
      return;
    }

    // A checkbox reports presence, so requiring one leaves it a single
    // valid state: every record that submits at all carries the same
    // value, and the control asks nothing. Requisitions skip them.
    if (target.type === "checkbox") {
      return;
    }

    target.required = APP._internals.when(requisitions, targetForm);
  });
}

store.subscribe((state, _previousState, action) => {
  if (action.type === actionTypes.setLoading) {
    APP.overlay?.classList.toggle("active", state.ui.loading);
  }

  if (action.type === actionTypes.setTheme) {
    document.documentElement.dataset.theme = state.ui.theme;
    localStorage.setItem(APP.THEME_STORAGE_KEY, state.ui.theme);

    if (APP.themeToggle) {
      APP.themeToggle.checked = state.ui.theme === "dark";
    }
  }

  if (action.type === actionTypes.setSelectedTab) {
    APP.tabs.forEach((tab) => {
      /**
       * Whether this is the newly selected tab, which drives its ARIA
       * state, its place in the roving tabindex, and its panel's
       * visibility together.
       *
       * @type {boolean}
       */
      const selected = tab.dataset.tabId === state.ui.selectedTab;
      tab.setAttribute("aria-selected", selected ? "true" : "false");
      tab.tabIndex = selected ? 0 : -1;
      document.getElementById(tab.dataset.tabId).hidden = !selected;
    });

    APP.publish("tab:change", { id: state.ui.selectedTab });
  }
});
