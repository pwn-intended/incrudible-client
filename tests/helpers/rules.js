/**
 * Mirrors the server's buildRuleMaps_ (Code.gs), which indexes a schema's
 * entry-level rule collections into the lookup tables the client is handed.
 *
 * The client never receives a schema and a rule set as separate inputs —
 * every server response builds one from the other, so `rules` is a pure
 * function of `schema`. Tests that author both by hand can express payloads
 * the server cannot produce, and stop testing the wiring that derives one
 * from the other. Deriving them here keeps a test honest to the contract.
 *
 * Kept deliberately close to the original, structure for structure, so the
 * two can be diffed by eye when the server changes.
 *
 * @param {object[]} schema - Workflow controls whose conditional rules should be indexed.
 * @returns {Record<string, Record<string, object[]>>} Rule maps in the server's own shape.
 */
const buildRuleMaps = (schema) => {
  /**
   * Rule collection names carried directly on an entry.
   *
   * @type {string[]}
   */
  const keys = [
    "modals",
    "articles",
    "alerts",
    "wizards",
    "autofills",
  ];
  /**
   * Per-rule-kind lookup tables keyed by the controlling field's id, or its
   * name when it has no id.
   *
   * @type {Record<string, Map<string, object[]>>}
   */
  const maps = {
    modals: new Map(),
    articles: new Map(),
    alerts: new Map(),
    wizards: new Map(),
    criteria: new Map(),
    requisitions: new Map(),
    autofills: new Map(),
  };
  /**
   * Ids already claimed by an earlier entry, and the ones claimed twice.
   * An id addresses both a rule and a dependency, so a repeat misbehaves
   * quietly rather than failing — the server rejects one outright, and a
   * test authored against one would be describing a config it refuses.
   *
   * @type {{seen: Set<string>, repeated: Set<string>}}
   */
  const ids = { seen: new Set(), repeated: new Set() };
  /**
   * Indexes one entry, then the wizards and members nested beneath it.
   *
   * @param {object} entry - Control whose direct and nested rule sets should be collected.
   * @returns {void}
   */
  const walk = (entry) => {
    if (entry.id) {
      if (ids.seen.has(entry.id)) {
        ids.repeated.add(entry.id);
      }

      ids.seen.add(entry.id);
    }

    // A name addresses a rule set only when there is no id to address it
    // by. Options in a group each carry their own id but share one name,
    // so registering under both would let the last option overwrite the
    // shared key and have its rules applied to the first option's control.
    if (entry.id && entry.criteria?.length) {
      maps.criteria.set(entry.id, entry.criteria);
    } else if (entry.name && entry.criteria?.length) {
      maps.criteria.set(entry.name, entry.criteria);
    }

    if (entry.id && entry.requisitions?.length) {
      maps.requisitions.set(entry.id, entry.requisitions);
    } else if (entry.name && entry.requisitions?.length) {
      maps.requisitions.set(entry.name, entry.requisitions);
    }

    for (const key of keys) {
      const rules = entry[key];

      if (entry.id && rules?.length) {
        maps[key].set(entry.id, rules);
      } else if (entry.name && rules?.length) {
        maps[key].set(entry.name, rules);
      }
    }

    for (const rule of [...(entry.wizards || [])]) {
      walk(rule.wizard || rule);
    }

    for (const member of entry.members || []) {
      walk(member);
    }
  };

  schema.forEach((entry) => {
    walk(entry);
  });

  if (ids.repeated.size) {
    throw new Error(
      `Workflow schema reuses control ids: ${[...ids.repeated].sort().join(", ")}. An id addresses a control's rules and any dependency on it, so a repeat applies one control's rules to another.`,
    );
  }

  return Object.fromEntries(
    Object.entries(maps).map(([key, map]) => [key, Object.fromEntries(map)]),
  );
};

/**
 * The server's rule-map names, paired with the APP.rules property each is
 * assigned to. Mirrors the consuming app's own wiring, so a test installs
 * rules exactly where a real workflow load would put them.
 *
 * @type {Record<string, string>}
 */
const RULE_MAP_PROPERTIES = {
  modals: "modalRules",
  articles: "articleRules",
  alerts: "alertRules",
  wizards: "wizardRules",
  criteria: "criteriaRules",
  requisitions: "requisitionRules",
  autofills: "autofillRules",
};

/**
 * The rule families a schema implies, keyed the way APP.rules expects them.
 *
 * @param {object[]} schema - Workflow controls to derive rules from.
 * @returns {Record<string, Record<string, object[]>>} Rules ready to assign onto APP.rules.
 */
const deriveRules = (schema) =>
  Object.fromEntries(
    Object.entries(buildRuleMaps(schema)).map(([key, value]) => [
      RULE_MAP_PROPERTIES[key],
      value,
    ]),
  );

export { buildRuleMaps, deriveRules, RULE_MAP_PROPERTIES };
