const assert = require("node:assert/strict");
const test = require("node:test");
const { selectModels } = require("../src/plugin/selection.js");

function model(id, tokensUsed) {
  return { id, tokensUsed };
}

function ids(models) {
  return models.map((item) => item.id);
}

const CATALOGUE = [
  model("glm5.3", 30),
  model("glm5.2", 50),
  model("glm5.3-flash", 10),
  model("deepseek-v4-flash", 40),
];

test("keeps the explicit selection order", () => {
  assert.deepEqual(ids(selectModels(CATALOGUE, ["glm5.3-flash", "glm5.3"])), [
    "glm5.3-flash",
    "glm5.3",
    "glm5.2",
  ]);
});

test("skips an unknown id without consuming a slot", () => {
  assert.deepEqual(ids(selectModels(CATALOGUE, ["ghost-model", "glm5.3-flash"])), [
    "glm5.3-flash",
    "glm5.2",
    "deepseek-v4-flash",
  ]);
});

test("drops stale ids and auto-fills the empty slots", () => {
  assert.deepEqual(ids(selectModels(CATALOGUE, ["glm5.1", "mimo-v2.5", "glm5.3"])), [
    "glm5.3",
    "glm5.2",
    "deepseek-v4-flash",
  ]);
});

test("auto-fills by descending tokensUsed", () => {
  assert.deepEqual(ids(selectModels(CATALOGUE, [])), ["glm5.2", "deepseek-v4-flash", "glm5.3"]);
  assert.deepEqual(ids(selectModels(CATALOGUE)), ["glm5.2", "deepseek-v4-flash", "glm5.3"]);
});

test("sorts a null or absent tokensUsed after every finite value", () => {
  const models = [model("unknown-count", null), model("counted", 5), model("uncounted")];
  assert.deepEqual(ids(selectModels(models, [])), ["counted", "unknown-count", "uncounted"]);
});

test("keeps the original order when tokensUsed ties", () => {
  const models = [model("first", 10), model("second", 10), model("third", 10), model("fourth", 10)];
  assert.deepEqual(ids(selectModels(models, [])), ["first", "second", "third"]);
});

test("truncates a selection longer than the default limit", () => {
  const selected = ["deepseek-v4-flash", "glm5.3", "glm5.2", "glm5.3-flash"];
  assert.deepEqual(ids(selectModels(CATALOGUE, selected)), [
    "deepseek-v4-flash",
    "glm5.3",
    "glm5.2",
  ]);
});

test("honours an explicit limit and falls back safely", () => {
  assert.deepEqual(ids(selectModels(CATALOGUE, [], 1)), ["glm5.2"]);
  assert.deepEqual(ids(selectModels(CATALOGUE, [], 2)), ["glm5.2", "deepseek-v4-flash"]);
  for (const limit of [0, -1, 2.5, "2", null, Number.NaN]) {
    assert.equal(selectModels(CATALOGUE, [], limit).length, 3);
  }
});

test("emits a repeated selected id only once", () => {
  assert.deepEqual(ids(selectModels(CATALOGUE, ["glm5.3", "glm5.3", "glm5.3"])), [
    "glm5.3",
    "glm5.2",
    "deepseek-v4-flash",
  ]);
});

test("treats a non-array selectedIds as an empty selection", () => {
  for (const selectedIds of [undefined, null, "glm5.3", 42, {}]) {
    assert.deepEqual(ids(selectModels(CATALOGUE, selectedIds)), [
      "glm5.2",
      "deepseek-v4-flash",
      "glm5.3",
    ]);
  }
});

test("ignores a non-string selected id without consuming a slot", () => {
  assert.deepEqual(ids(selectModels(CATALOGUE, [42, null, undefined, {}, "glm5.3"])), [
    "glm5.3",
    "glm5.2",
    "deepseek-v4-flash",
  ]);
});

test("returns an empty selection for an empty or unusable model list", () => {
  assert.deepEqual(selectModels([], ["glm5.3"]), []);
  assert.deepEqual(selectModels(undefined, ["glm5.3"]), []);
  assert.deepEqual(selectModels("glm5.3", ["glm5.3"]), []);
});

test("ignores list entries without a usable id", () => {
  const models = [null, "glm5.3", 42, {}, { id: "" }, { id: 42 }, model("glm5.2", 1)];
  assert.deepEqual(ids(selectModels(models, [])), ["glm5.2"]);
});

test("returns the original model objects", () => {
  const selected = selectModels(CATALOGUE, ["glm5.3"]);
  assert.equal(selected[0], CATALOGUE[0]);
});

test("never returns more than the limit", () => {
  const models = Array.from({ length: 8 }, (_item, index) => model(`m${index}`, 8 - index));
  const selectedIds = models.map((item) => item.id);
  for (const limit of [1, 2, 3, 5, 8]) {
    assert.equal(selectModels(models, selectedIds, limit).length, limit);
  }
  assert.equal(selectModels(models, selectedIds).length, 3);
  assert.equal(selectModels(models, []).length, 3);
});
