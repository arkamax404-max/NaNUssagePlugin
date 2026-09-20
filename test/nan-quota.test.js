const assert = require("node:assert/strict");
const test = require("node:test");
const { normalizeQuotaPayload, parsePercent } = require("../src/plugin/nan-quota.js");

const MODEL_FIELDS = [
  "id",
  "cap",
  "tokensUsed",
  "remaining",
  "remainingPercent",
  "consumedPercent",
  "updatedAt",
  "periodEnd",
  "windowHours",
  "fullWindowTokens",
];

function quotaPayload(overrides = {}) {
  return {
    periodStart: "2026-09-01",
    models: [
      {
        model: "glm5.3",
        tokensUsed: 919000000,
        cap: 1000000000,
        remaining: 81000000,
        updatedAt: "2026-09-19T08:00:00Z",
        periodEnd: "2026-10-01",
        windowHours: 4,
        fullWindowTokens: 200000000,
      },
      {
        model: "glm5.2",
        tokensUsed: 250000000,
        cap: 1000000000,
        remaining: 750000000,
        updatedAt: "2026-09-18T08:00:00Z",
        periodEnd: "2026-10-01",
        windowHours: 4,
        fullWindowTokens: 150000000,
      },
      {
        model: "deepseek-v4-flash",
        tokensUsed: 0,
        cap: 500000000,
        remaining: 500000000,
        updatedAt: "2026-09-19T08:00:00Z",
        periodEnd: "2026-10-01",
      },
    ],
    ...overrides,
  };
}

test("normalizes a realistic multi-model quota payload", () => {
  const result = normalizeQuotaPayload(quotaPayload());

  assert.equal(result.periodStart, "2026-09-01");
  assert.deepEqual(
    result.models.map((model) => model.id),
    ["glm5.3", "glm5.2", "deepseek-v4-flash"],
  );
  assert.deepEqual(Object.keys(result.models[0]), MODEL_FIELDS);
  assert.ok(Math.abs(result.models[0].remainingPercent - 8.1) < 1e-9);
  assert.ok(Math.abs(result.models[1].remainingPercent - 75) < 1e-9);
  assert.equal(result.models[0].tokensUsed, 919000000);
  assert.equal(result.models[2].cap, 500000000);
  assert.equal(result.models[2].tokensUsed, 0);
  assert.equal(result.models[2].remainingPercent, 100);
  assert.ok(Math.abs(result.models[0].consumedPercent - 91.9) < 1e-9);
  assert.ok(Math.abs(result.models[1].consumedPercent - 25) < 1e-9);
  assert.equal(result.models[2].consumedPercent, 0);
});

test("derives consumedPercent from tokensUsed and cap", () => {
  const { models } = normalizeQuotaPayload({
    periodStart: "2026-09-01",
    models: [
      { model: "exact", tokensUsed: 919000000, cap: 1000000000, remaining: 81000000 },
      { model: "third", tokensUsed: 1, cap: 3, remaining: 2 },
      { model: "untouched", tokensUsed: 0, cap: 1000000000, remaining: 1000000000 },
      { model: "over", tokensUsed: 1500, cap: 1000, remaining: 0 },
    ],
  });

  assert.ok(Math.abs(models[0].consumedPercent - 91.9) < 1e-9);
  assert.equal(models[1].consumedPercent, 1 / 3 * 100);
  assert.notEqual(models[1].consumedPercent, 33);
  assert.equal(models[3].consumedPercent, 100);
});

test("carries zero consumption for an untouched model, including an inactive premium entry", () => {
  const { models } = normalizeQuotaPayload({
    periodStart: "2026-09-01",
    models: [
      { model: "glm5.2", tokensUsed: 0, cap: 1000000000, remaining: 1000000000 },
      { model: "qwen3.8-flash", tokensUsed: 0, cap: 500000000, remaining: 500000000 },
    ],
  });

  assert.equal(models[0].consumedPercent, 0);
  assert.equal(models[0].remainingPercent, 100);
  assert.equal(models[1].consumedPercent, 0);
  assert.equal(models[1].remainingPercent, 100);
});

test("keeps consumedPercent and remainingPercent consistent on a well-formed payload", () => {
  const { models } = normalizeQuotaPayload(quotaPayload());
  for (const model of models) {
    assert.ok(Math.abs(model.consumedPercent + model.remainingPercent - 100) < 1e-9);
  }
});

test("falls back to the remaining complement when tokensUsed is missing or unusable", () => {
  const { models } = normalizeQuotaPayload({
    periodStart: "2026-09-01",
    models: [
      { model: "absent", cap: 1000, remaining: 190 },
      { model: "null", tokensUsed: null, cap: 1000, remaining: 190 },
      { model: "string", tokensUsed: "919", cap: 1000, remaining: 190 },
      { model: "negative", tokensUsed: -1, cap: 1000, remaining: 190 },
      { model: "nan", tokensUsed: Number.NaN, cap: 1000, remaining: 190 },
      { model: "infinite", tokensUsed: Number.POSITIVE_INFINITY, cap: 1000, remaining: 190 },
    ],
  });

  for (const model of models) {
    assert.equal(model.tokensUsed, null);
    assert.equal(model.remainingPercent, 19);
    assert.ok(Math.abs(model.consumedPercent - 81) < 1e-9);
  }
});

test("leaves consumedPercent null when neither route can produce it", () => {
  const { models } = normalizeQuotaPayload({
    periodStart: "2026-09-01",
    models: [
      { model: "zero-cap", tokensUsed: 0, cap: 0, remaining: 0 },
      { model: "negative-cap", tokensUsed: 10, cap: -1, remaining: 10 },
      { model: "no-cap", tokensUsed: 10, remaining: 10 },
      { model: "string-cap", tokensUsed: 10, cap: "100", remaining: 10 },
      { model: "nan-cap", tokensUsed: 10, cap: Number.NaN, remaining: 10 },
      { model: "infinite-cap", tokensUsed: 10, cap: Number.POSITIVE_INFINITY, remaining: 10 },
    ],
  });

  for (const model of models) {
    assert.equal(model.remainingPercent, null);
    assert.equal(model.consumedPercent, null);
  }
});

test("derives consumedPercent even when the remaining value is unusable", () => {
  const { models } = normalizeQuotaPayload({
    periodStart: "2026-09-01",
    models: [
      { model: "negative-remaining", tokensUsed: 250, cap: 1000, remaining: -1 },
      { model: "absent-remaining", tokensUsed: 250, cap: 1000 },
    ],
  });

  for (const model of models) {
    assert.equal(model.remainingPercent, null);
    assert.ok(Math.abs(model.consumedPercent - 25) < 1e-9);
  }
});

test("prefers tokensUsed when tokensUsed and remaining disagree", () => {
  const { models } = normalizeQuotaPayload({
    periodStart: "2026-09-01",
    models: [
      { model: "ahead", tokensUsed: 900, cap: 1000, remaining: 800 },
      { model: "behind", tokensUsed: 2000, cap: 1000000, remaining: 100000 },
    ],
  });

  assert.equal(models[0].remainingPercent, 80);
  assert.ok(Math.abs(models[0].consumedPercent - 90) < 1e-9);
  assert.equal(models[1].remainingPercent, 10);
  assert.ok(Math.abs(models[1].consumedPercent - 0.2) < 1e-9);
});

test("carries the premium window fields only on the models that have them", () => {
  const { models } = normalizeQuotaPayload(quotaPayload());
  const premium = models.find((model) => model.id === "glm5.3");
  const flash = models.find((model) => model.id === "deepseek-v4-flash");

  assert.equal(premium.windowHours, 4);
  assert.equal(premium.fullWindowTokens, 200000000);
  assert.equal(flash.windowHours, null);
  assert.equal(flash.fullWindowTokens, null);
});

test("normalizes a windowHours of zero or a non-numeric window field as absent", () => {
  const { models } = normalizeQuotaPayload({
    periodStart: "2026-09-01",
    models: [
      { model: "glm5.3", cap: 100, remaining: 100, windowHours: 0, fullWindowTokens: Number.NaN },
      { model: "glm5.2", cap: 100, remaining: 100, windowHours: "4", fullWindowTokens: "200" },
    ],
  });

  assert.equal(models[0].windowHours, null);
  assert.equal(models[0].fullWindowTokens, null);
  assert.equal(models[1].windowHours, null);
  assert.equal(models[1].fullWindowTokens, null);
});

test("returns an empty result for an absent or non-object payload", () => {
  for (const payload of [undefined, null, 42, "quota", true]) {
    assert.deepEqual(normalizeQuotaPayload(payload), { periodStart: null, models: [] });
  }
});

test("treats an absent or non-array models value as no models", () => {
  for (const models of [undefined, null, "glm5.3", 42, {}]) {
    assert.deepEqual(normalizeQuotaPayload({ periodStart: "2026-09-01", models }), {
      periodStart: "2026-09-01",
      models: [],
    });
  }
  assert.deepEqual(normalizeQuotaPayload({ periodStart: "2026-09-01", models: [] }), {
    periodStart: "2026-09-01",
    models: [],
  });
});

test("reads periodStart only when it is a non-empty string", () => {
  assert.equal(normalizeQuotaPayload({}).periodStart, null);
  assert.equal(normalizeQuotaPayload({ periodStart: "" }).periodStart, null);
  assert.equal(normalizeQuotaPayload({ periodStart: 20260901 }).periodStart, null);
  assert.equal(normalizeQuotaPayload({ periodStart: "2026-10-01" }).periodStart, "2026-10-01");
});

test("skips entries without a usable model id", () => {
  const { models } = normalizeQuotaPayload({
    periodStart: "2026-09-01",
    models: [null, "glm5.3", 42, [], {}, { model: "" }, { model: "   " }, { model: 42 }, { model: "glm5.2", cap: 10, remaining: 10 }],
  });

  assert.deepEqual(
    models.map((model) => model.id),
    ["glm5.2"],
  );
});

test("trims the model id and ignores a repeated id", () => {
  const { models } = normalizeQuotaPayload({
    periodStart: "2026-09-01",
    models: [
      { model: "  glm5.3  ", cap: 100, remaining: 80 },
      { model: "glm5.3", cap: 100, remaining: 10 },
      { model: " glm5.3 ", cap: 100, remaining: 1 },
      { model: "glm5.2", cap: 100, remaining: 20 },
    ],
  });

  assert.deepEqual(
    models.map((model) => model.id),
    ["glm5.3", "glm5.2"],
  );
  assert.equal(models[0].remaining, 80);
});

test("normalizes a zero or missing cap to an unknown percentage", () => {
  const { models } = normalizeQuotaPayload({
    periodStart: "2026-09-01",
    models: [
      { model: "zero-cap", cap: 0, remaining: 0, tokensUsed: 0 },
      { model: "no-cap", remaining: 100 },
      { model: "string-cap", cap: "1000000", remaining: 100 },
      { model: "negative-cap", cap: -1, remaining: 100 },
    ],
  });

  assert.equal(models[0].cap, 0);
  assert.equal(models[0].remainingPercent, null);
  assert.equal(models[1].cap, null);
  assert.equal(models[1].remainingPercent, null);
  assert.equal(models[2].cap, null);
  assert.equal(models[2].remainingPercent, null);
  assert.equal(models[3].cap, null);
});

test("clamps a remaining value above the cap and rejects a negative one", () => {
  const { models } = normalizeQuotaPayload({
    periodStart: "2026-09-01",
    models: [
      { model: "over", cap: 100, remaining: 150, tokensUsed: 10 },
      { model: "negative", cap: 100, remaining: -5, tokensUsed: 10 },
      { model: "string", cap: 100, remaining: "50", tokensUsed: 10 },
    ],
  });

  assert.equal(models[0].remaining, 150);
  assert.equal(models[0].remainingPercent, 100);
  assert.equal(models[1].remaining, null);
  assert.equal(models[1].remainingPercent, null);
  assert.equal(models[2].remaining, null);
});

test("rejects negative and non-numeric consumption counters", () => {
  const { models } = normalizeQuotaPayload({
    periodStart: "2026-09-01",
    models: [
      { model: "negative", cap: 100, remaining: 100, tokensUsed: -1 },
      { model: "string", cap: 100, remaining: 100, tokensUsed: "10" },
      { model: "large", cap: 100, remaining: 100, tokensUsed: 999999999999 },
    ],
  });

  assert.equal(models[0].tokensUsed, null);
  assert.equal(models[1].tokensUsed, null);
  assert.equal(models[2].tokensUsed, 999999999999);
});

test("normalizes the timestamp fields defensively", () => {
  const { models } = normalizeQuotaPayload({
    periodStart: "2026-09-01",
    models: [
      { model: "empty", cap: 100, remaining: 100, updatedAt: "", periodEnd: "" },
      { model: "typed", cap: 100, remaining: 100, updatedAt: 20260919, periodEnd: null },
      { model: "present", cap: 100, remaining: 100, updatedAt: "2026-09-19T08:00:00Z", periodEnd: "2026-10-01" },
    ],
  });

  assert.equal(models[0].updatedAt, null);
  assert.equal(models[0].periodEnd, null);
  assert.equal(models[1].updatedAt, null);
  assert.equal(models[1].periodEnd, null);
  assert.equal(models[2].updatedAt, "2026-09-19T08:00:00Z");
  assert.equal(models[2].periodEnd, "2026-10-01");
});

test("keeps parsePercent exact and unrounded", () => {
  assert.ok(Math.abs(parsePercent(919, 1000) - 91.9) < 1e-9);
  assert.notEqual(parsePercent(919, 1000), 92);
  assert.equal(parsePercent(1, 3), 1 / 3 * 100);
  assert.equal(parsePercent(81000000, 1000000000), 8.1);
  assert.equal(parsePercent(919000000, 1000000000), 91.9);
});

test("parsePercent rejects every value it cannot display", () => {
  assert.equal(parsePercent(0, 100), 0);
  assert.equal(parsePercent(100, 100), 100);
  assert.equal(parsePercent(150, 100), 100);
  assert.equal(parsePercent(-1, 100), null);
  assert.equal(parsePercent(10, 0), null);
  assert.equal(parsePercent(10, -100), null);
  assert.equal(parsePercent(Number.NaN, 100), null);
  assert.equal(parsePercent(10, Number.NaN), null);
  assert.equal(parsePercent(Number.POSITIVE_INFINITY, 100), null);
  assert.equal(parsePercent(10, Number.POSITIVE_INFINITY), null);
  assert.equal(parsePercent("10", 100), null);
  assert.equal(parsePercent(null, null), null);
  assert.equal(parsePercent(), null);
});

test("never throws for an arbitrary payload", () => {
  for (const payload of [undefined, null, 0, "", [], () => {}, Symbol("quota")]) {
    assert.doesNotThrow(() => normalizeQuotaPayload(payload));
  }
  assert.doesNotThrow(() => normalizeQuotaPayload({ models: [Symbol("model")] }));
});
