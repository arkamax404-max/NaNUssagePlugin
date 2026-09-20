const assert = require("node:assert/strict");
const test = require("node:test");
const {
  AUTOMATIC_POLL_INTERVAL_MS,
  beginRefresh,
  canApplyRefreshResult,
  credentialsChanged,
  finishRefresh,
  isRefreshCurrent,
  sameModels,
  settingsChanged,
  shouldPoll,
} = require("../src/plugin/main.js");

const MODELS = ["deepseek-v4-flash", "glm5.3-flash", "mimo-v2.5"];

test("polls the quota endpoint every five minutes", () => {
  assert.equal(AUTOMATIC_POLL_INTERVAL_MS, 300000);
  assert.equal(AUTOMATIC_POLL_INTERVAL_MS, 5 * 60 * 1000);
});

test("requires the module without starting the host", () => {
  assert.equal(typeof beginRefresh, "function");
  assert.equal(typeof credentialsChanged, "function");
  assert.equal(typeof sameModels, "function");
  assert.equal(typeof settingsChanged, "function");
  assert.equal(typeof shouldPoll, "function");
});

test("detects a changed api key", () => {
  assert.equal(credentialsChanged({ nanApiKey: "old" }, { nanApiKey: "new" }), true);
  assert.equal(credentialsChanged({ nanApiKey: "" }, { nanApiKey: "new" }), true);
  assert.equal(credentialsChanged({ nanApiKey: "new" }, { nanApiKey: "" }), true);
  assert.equal(credentialsChanged({ nanApiKey: "same" }, { nanApiKey: "same" }), false);
});

test("treats a model-selection change as a settings change", () => {
  const base = { nanApiKey: "key", selectedModels: MODELS };

  assert.equal(settingsChanged(base, { ...base, selectedModels: ["glm5.2"] }), true);
  assert.equal(settingsChanged(base, { ...base, selectedModels: [...MODELS].reverse() }), true);
  assert.equal(settingsChanged(base, { ...base, selectedModels: [...MODELS, "glm5.2"] }), true);
  assert.equal(settingsChanged(base, { ...base, selectedModels: MODELS.slice(1) }), true);
});

test("detects a changed api key through settingsChanged", () => {
  const base = { nanApiKey: "key", selectedModels: MODELS };

  assert.equal(settingsChanged(base, { ...base, nanApiKey: "other" }), true);
  assert.equal(settingsChanged(base, { ...base }), false);
});

test("treats an equal model list as unchanged even in a distinct array", () => {
  const current = { nanApiKey: "key", selectedModels: MODELS };
  const next = { nanApiKey: "key", selectedModels: ["deepseek-v4-flash", "glm5.3-flash", "mimo-v2.5"] };

  assert.notEqual(current.selectedModels, next.selectedModels);
  assert.equal(settingsChanged(current, next), false);
  assert.equal(settingsChanged(current, { ...current, selectedModels: [] }), true);
});

test("handles a non-array model list on either side", () => {
  const list = { nanApiKey: "key", selectedModels: MODELS };

  assert.equal(settingsChanged({ nanApiKey: "key" }, { nanApiKey: "key" }), false);
  assert.equal(settingsChanged(list, { nanApiKey: "key", selectedModels: undefined }), true);
  assert.equal(settingsChanged({ nanApiKey: "key", selectedModels: undefined }, list), true);
  assert.equal(settingsChanged({ nanApiKey: "key", selectedModels: "glm5.3" }, { nanApiKey: "key", selectedModels: "glm5.3" }), false);
  assert.equal(settingsChanged({ nanApiKey: "key", selectedModels: "glm5.3" }, { nanApiKey: "key", selectedModels: "glm5.2" }), true);
  assert.equal(settingsChanged({ nanApiKey: "key", selectedModels: null }, { nanApiKey: "key", selectedModels: [] }), true);
});

test("polls only an active action that carries an api key", () => {
  assert.equal(shouldPoll({ active: true, settings: { nanApiKey: "key" } }), true);
  assert.equal(shouldPoll({ active: false, settings: { nanApiKey: "key" } }), false);
  assert.equal(shouldPoll({ active: true, settings: { nanApiKey: "" } }), false);
  assert.equal(shouldPoll({ active: true, settings: {} }), false);
  assert.equal(shouldPoll({ active: true }), false);
  assert.equal(shouldPoll({ active: true, settings: { nanApiKey: 42 } }), true);
});

test("rejects a stringified active flag and a missing action", () => {
  assert.equal(shouldPoll({ active: "true", settings: { nanApiKey: "key" } }), false);
  assert.equal(shouldPoll(undefined), false);
  assert.equal(shouldPoll(null), false);
  assert.equal(shouldPoll({}), false);
});

test("snapshots the revision and settings when a refresh begins", () => {
  const action = { active: true, revision: 4, settings: { nanApiKey: "key", selectedModels: MODELS } };
  const snapshot = beginRefresh(action);

  assert.equal(action.refreshing, true);
  assert.equal(snapshot.revision, 4);
  assert.equal(snapshot.settings, action.settings);
});

test("refuses a second concurrent refresh", () => {
  const action = { active: true, revision: 1, settings: {} };

  assert.notEqual(beginRefresh(action), null);
  assert.equal(beginRefresh(action), null);
  assert.equal(action.refreshing, true);
});

test("refuses a refresh without an action", () => {
  assert.equal(beginRefresh(undefined), null);
  assert.equal(beginRefresh(null), null);
});

test("recognises a current refresh attempt", () => {
  assert.equal(isRefreshCurrent({ revision: 3 }, { revision: 3 }), true);
  assert.equal(isRefreshCurrent({ revision: 3 }, { revision: 4 }), false);
});

test("rejects an incomplete refresh identity", () => {
  assert.equal(isRefreshCurrent(undefined, { revision: 3 }), false);
  assert.equal(isRefreshCurrent({ revision: 3 }, undefined), false);
  assert.equal(isRefreshCurrent(null, null), false);
  assert.equal(isRefreshCurrent({}, {}), true);
});

test("applies a result only for the bound action and revision", () => {
  const action = { active: true, revision: 2, settings: {} };
  const contexts = new Map([["context", action]]);

  assert.equal(canApplyRefreshResult(contexts, "context", action, { revision: 2 }), true);
  assert.equal(canApplyRefreshResult(contexts, "context", action, { revision: 1 }), false);
  assert.equal(canApplyRefreshResult(contexts, "context", { ...action }, { revision: 2 }), false);
  assert.equal(canApplyRefreshResult(contexts, "missing", action, { revision: 2 }), false);
});

test("refuses a result for a replaced action", () => {
  const action = { active: true, revision: 2, settings: {} };
  const replacement = { active: true, revision: 3, settings: {} };
  const contexts = new Map([["context", action]]);

  contexts.set("context", replacement);
  assert.equal(canApplyRefreshResult(contexts, "context", action, { revision: 2 }), false);
  assert.equal(canApplyRefreshResult(contexts, "context", replacement, { revision: 3 }), true);
});

test("clears the refreshing flag and tolerates a missing action", () => {
  const action = { refreshing: true };

  finishRefresh(action);
  assert.equal(action.refreshing, false);
  assert.equal(finishRefresh(undefined), undefined);
  assert.equal(finishRefresh(null), undefined);
});

test("compares model lists by length, order and value", () => {
  assert.equal(sameModels([], []), true);
  assert.equal(sameModels(MODELS, MODELS), true);
  assert.equal(sameModels(["glm5.2", "glm5.3"], ["glm5.2", "glm5.3"]), true);
  assert.equal(sameModels(MODELS, [...MODELS]), true);
});

test("treats a reordered or resized model list as different", () => {
  assert.equal(sameModels(["glm5.2", "glm5.3"], ["glm5.3", "glm5.2"]), false);
  assert.equal(sameModels(MODELS, MODELS.slice(1)), false);
  assert.equal(sameModels(MODELS, [...MODELS, "glm5.2"]), false);
  assert.equal(sameModels(["glm5.2"], ["glm5.3"]), false);
});

test("compares a non-array model value by identity", () => {
  assert.equal(sameModels(undefined, undefined), true);
  assert.equal(sameModels(null, null), true);
  assert.equal(sameModels("glm5.3", "glm5.3"), true);
  assert.equal(sameModels("glm5.3", "glm5.2"), false);
  assert.equal(sameModels(undefined, []), false);
  assert.equal(sameModels([], undefined), false);
  assert.equal(sameModels(null, "glm5.3"), false);
  assert.equal(sameModels(["glm5.3"], "glm5.3"), false);
  assert.equal(sameModels({ length: 1, 0: "glm5.3" }, ["glm5.3"]), false);
});
