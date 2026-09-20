const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DEFAULT_SETTINGS,
  KNOWN_MODELS,
  normalizeSettings,
} = require("../src/plugin/settings.js");

const EMPTY = { nanApiKey: "", selectedModels: [] };

const DOCUMENTED_MODELS = [
  "deepseek-v4-flash",
  "glm5.3-flash",
  "mimo-v2.5",
  "qwen3.8-flash",
  "glm5.2",
  "glm5.3",
];

test("defaults an undefined, null, non-object or empty value", () => {
  assert.deepEqual(normalizeSettings(), EMPTY);
  assert.deepEqual(normalizeSettings(undefined), EMPTY);
  assert.deepEqual(normalizeSettings(null), EMPTY);
  assert.deepEqual(normalizeSettings({}), EMPTY);
  assert.deepEqual(normalizeSettings(42), EMPTY);
  assert.deepEqual(normalizeSettings("settings"), EMPTY);
  assert.deepEqual(normalizeSettings(true), EMPTY);
  assert.deepEqual(normalizeSettings([]), EMPTY);
});

test("matches the exported default settings", () => {
  assert.deepEqual(normalizeSettings(), DEFAULT_SETTINGS);
  assert.equal(DEFAULT_SETTINGS.nanApiKey, "");
  assert.deepEqual(DEFAULT_SETTINGS.selectedModels, []);
});

test("trims the api key and rejects a non-string one", () => {
  assert.equal(normalizeSettings({ nanApiKey: "  nan-secret  " }).nanApiKey, "nan-secret");
  assert.equal(normalizeSettings({ nanApiKey: "\t nan-secret\n" }).nanApiKey, "nan-secret");
  assert.equal(normalizeSettings({ nanApiKey: "   " }).nanApiKey, "");
  assert.equal(normalizeSettings({ nanApiKey: "" }).nanApiKey, "");

  for (const nanApiKey of [null, undefined, 42, {}, [], true, () => {}]) {
    assert.equal(normalizeSettings({ nanApiKey }).nanApiKey, "");
  }
});

test("treats a non-array selectedModels as an empty list", () => {
  for (const selectedModels of [undefined, null, "glm5.3", 42, {}, true]) {
    assert.deepEqual(normalizeSettings({ selectedModels }).selectedModels, []);
  }
});

test("drops non-string, blank and whitespace-only entries", () => {
  const result = normalizeSettings({
    selectedModels: [null, undefined, 42, true, {}, [], "   ", "\t\n", "", "glm5.2"],
  });

  assert.deepEqual(result.selectedModels, ["glm5.2"]);
});

test("trims the retained ids", () => {
  const result = normalizeSettings({
    selectedModels: ["  glm5.3  ", " glm5.2"],
  });

  assert.deepEqual(result.selectedModels, ["glm5.3", "glm5.2"]);
});

test("deduplicates repeats and preserves first-occurrence order", () => {
  const result = normalizeSettings({
    selectedModels: ["glm5.3", "glm5.2", "glm5.3", "deepseek-v4-flash", "glm5.2", " glm5.3 "],
  });

  assert.deepEqual(result.selectedModels, ["glm5.3", "glm5.2", "deepseek-v4-flash"]);
});

test("preserves an id that is absent from the frozen catalogue", () => {
  const result = normalizeSettings({
    selectedModels: ["glm7-unreleased", "glm5.3", "retired-model-v1"],
  });

  assert.deepEqual(result.selectedModels, ["glm7-unreleased", "glm5.3", "retired-model-v1"]);
  assert.equal(result.selectedModels.includes("glm7-unreleased"), true);
  assert.equal(KNOWN_MODELS.includes("glm7-unreleased"), false);
});

test("keeps a known id and an unknown id side by side without filtering", () => {
  const result = normalizeSettings({ selectedModels: ["unknown-id", "glm5.2"] });

  assert.deepEqual(result.selectedModels, ["unknown-id", "glm5.2"]);
  assert.equal(result.selectedModels.length, 2);
});

test("does not mutate the caller value or the shared default", () => {
  const input = ["glm5.3", "glm5.3", "glm5.2"];
  const result = normalizeSettings({ nanApiKey: " key ", selectedModels: input });

  assert.deepEqual(input, ["glm5.3", "glm5.3", "glm5.2"]);
  assert.deepEqual(DEFAULT_SETTINGS, { nanApiKey: "", selectedModels: [] });
  assert.equal(DEFAULT_SETTINGS.selectedModels.length, 0);
  assert.notEqual(result.selectedModels, input);
});

test("freezes the default settings deeply enough to resist mutation", () => {
  assert.equal(Object.isFrozen(DEFAULT_SETTINGS), true);
  assert.equal(Object.isFrozen(DEFAULT_SETTINGS.selectedModels), true);

  DEFAULT_SETTINGS.nanApiKey = "leaked";
  assert.equal(DEFAULT_SETTINGS.nanApiKey, "");
  assert.throws(() => {
    DEFAULT_SETTINGS.selectedModels.push("glm5.3");
  }, TypeError);
  assert.deepEqual(DEFAULT_SETTINGS, { nanApiKey: "", selectedModels: [] });
});

test("returns a distinct array instance on every call", () => {
  const first = normalizeSettings({ selectedModels: ["glm5.3"] }).selectedModels;
  const second = normalizeSettings({ selectedModels: ["glm5.3"] }).selectedModels;
  const emptyFirst = normalizeSettings({ selectedModels: "glm5.3" }).selectedModels;
  const emptySecond = normalizeSettings({ selectedModels: null }).selectedModels;

  assert.notEqual(first, second);
  assert.deepEqual(first, second);
  assert.notEqual(emptyFirst, emptySecond);

  first.push("mutated");
  assert.deepEqual(second, ["glm5.3"]);
});

test("exposes a frozen catalogue of the six documented ids in order", () => {
  assert.equal(Object.isFrozen(KNOWN_MODELS), true);
  assert.deepEqual([...KNOWN_MODELS], DOCUMENTED_MODELS);
  assert.equal(KNOWN_MODELS.length, 6);

  for (const id of KNOWN_MODELS) {
    assert.equal(typeof id, "string");
    assert.notEqual(id.trim(), "");
  }
  assert.equal(new Set(KNOWN_MODELS).size, KNOWN_MODELS.length);

  assert.throws(() => {
    KNOWN_MODELS.push("glm7-unreleased");
  }, TypeError);
  assert.deepEqual([...KNOWN_MODELS], DOCUMENTED_MODELS);
});
