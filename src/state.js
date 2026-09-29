export const RULE_KEYS = Object.freeze([
  "modalRules",
  "articleRules",
  "alertRules",
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
]);

export const actionTypes = Object.freeze({
  hydrateTheme: "ui/hydrateTheme",
  initialize: "app/initialize",
  prependFeedbackRecord: "feedback/prependRecord",
  setConfirmDetail: "modal/setConfirmDetail",
  setFeedbackRecords: "feedback/setRecords",
  setLoading: "ui/setLoading",
  setWorkflow: "workflow/set",
  setWorkflowLabel: "workflow/setLabel",
  setRule: "rules/set",
  setSelectedTab: "ui/setSelectedTab",
  setTheme: "ui/setTheme",
});

export const actions = Object.freeze({
  hydrateTheme: (theme) => ({
    type: actionTypes.hydrateTheme,
    payload: theme,
  }),
  initialize: (workflowLabel, feedbackRules = {}) => ({
    type: actionTypes.initialize,
    payload: { workflowLabel, feedbackRules },
  }),
  prependFeedbackRecord: (record) => ({
    type: actionTypes.prependFeedbackRecord,
    payload: record,
  }),
  setConfirmDetail: (detail) => ({
    type: actionTypes.setConfirmDetail,
    payload: detail,
  }),
  setFeedbackRecords: (records) => ({
    type: actionTypes.setFeedbackRecords,
    payload: records,
  }),
  setLoading: (loading) => ({
    type: actionTypes.setLoading,
    payload: Boolean(loading),
  }),
  setWorkflow: (workflow) => ({
    type: actionTypes.setWorkflow,
    payload: workflow,
  }),
  setWorkflowLabel: (label) => ({
    type: actionTypes.setWorkflowLabel,
    payload: label,
  }),
  setRule: (name, rules) => ({
    type: actionTypes.setRule,
    payload: { name, rules },
  }),
  setSelectedTab: (id) => ({
    type: actionTypes.setSelectedTab,
    payload: id,
  }),
  setTheme: (theme) => ({
    type: actionTypes.setTheme,
    payload: theme === "dark" ? "dark" : "light",
  }),
});

const initialRules = () =>
  Object.fromEntries(RULE_KEYS.map((name) => [name, {}]));

export const createInitialState = ({ theme } = {}) => ({
  workflow: {
    current: undefined,
    label: "",
  },
  rules: initialRules(),
  ui: {
    theme,
    loading: false,
    selectedTab: undefined,
  },
  feedback: {
    records: undefined,
  },
  modal: {
    confirmDetail: undefined,
  },
});

const workflowReducer = (state, action) => {
  switch (action.type) {
    case actionTypes.initialize: {
      return { ...state, label: action.payload.workflowLabel };
    }
    case actionTypes.setWorkflow: {
      return { ...state, current: action.payload };
    }
    case actionTypes.setWorkflowLabel: {
      return { ...state, label: action.payload };
    }
    default: {
      return state;
    }
  }
};

const rulesReducer = (state, action) => {
  switch (action.type) {
    case actionTypes.initialize: {
      const entries = Object.entries(action.payload.feedbackRules).filter(
        ([name]) => RULE_KEYS.includes(name),
      );

      return entries.length
        ? { ...state, ...Object.fromEntries(entries) }
        : state;
    }
    case actionTypes.setRule: {
      return RULE_KEYS.includes(action.payload.name)
        ? { ...state, [action.payload.name]: action.payload.rules }
        : state;
    }
    default: {
      return state;
    }
  }
};

const uiReducer = (state, action) => {
  switch (action.type) {
    case actionTypes.hydrateTheme: {
      return state.theme === action.payload
        ? state
        : { ...state, theme: action.payload };
    }
    case actionTypes.setLoading: {
      return state.loading === action.payload
        ? state
        : { ...state, loading: action.payload };
    }
    case actionTypes.setSelectedTab: {
      return state.selectedTab === action.payload
        ? state
        : { ...state, selectedTab: action.payload };
    }
    case actionTypes.setTheme: {
      return state.theme === action.payload
        ? state
        : { ...state, theme: action.payload };
    }
    default: {
      return state;
    }
  }
};

const feedbackReducer = (state, action) => {
  switch (action.type) {
    case actionTypes.prependFeedbackRecord: {
      return state.records
        ? { ...state, records: [action.payload, ...state.records] }
        : state;
    }
    case actionTypes.setFeedbackRecords: {
      return { ...state, records: action.payload };
    }
    default: {
      return state;
    }
  }
};

const modalReducer = (state, action) => {
  if (action.type !== actionTypes.setConfirmDetail) {
    return state;
  }

  return state.confirmDetail === action.payload
    ? state
    : { ...state, confirmDetail: action.payload };
};

export const reducer = (state = createInitialState(), action) => {
  const workflow = workflowReducer(state.workflow, action);
  const rules = rulesReducer(state.rules, action);
  const ui = uiReducer(state.ui, action);
  const feedback = feedbackReducer(state.feedback, action);
  const modal = modalReducer(state.modal, action);

  return workflow === state.workflow &&
    rules === state.rules &&
    ui === state.ui &&
    feedback === state.feedback &&
    modal === state.modal
    ? state
    : { ...state, workflow, rules, ui, feedback, modal };
};

export const createStore = (reduce, initialState = reduce(undefined, {})) => {
  let state = initialState;
  const listeners = new Set();

  return {
    dispatch(action) {
      const previousState = state;
      state = reduce(state, action);

      for (const listener of [...listeners]) {
        listener(state, previousState, action);
      }

      return action;
    },
    getState() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
