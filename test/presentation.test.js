const assert = require("node:assert/strict");
const test = require("node:test");
const { normalizeQuotaPayload } = require("../src/plugin/nan-quota.js");
const { MODEL_LABELS, presentUsage } = require("../src/plugin/presentation.js");

const IDLE_VIEW = { state: 0, rows: [], message: null, footer: "" };

function usage(models, periodStart = "2026-09-01") {
  return { kind: "usage", ...normalizeQuotaPayload({ periodStart, models }) };
}

function quota(model, cap, remaining) {
  return { model, cap, remaining };
}

test("returns the idle view for a missing status", () => {
  assert.deepEqual(presentUsage(), IDLE_VIEW);
  assert.deepEqual(presentUsage(null), IDLE_VIEW);
  assert.deepEqual(presentUsage(0), IDLE_VIEW);
  assert.deepEqual(presentUsage("", IDLE_VIEW), IDLE_VIEW);
});

test("maps every unavailable reason to one centred message", () => {
  const expected = {
    not_configured: "ADD API KEY",
    unauthorized: "AUTH ERROR",
    forbidden: "FORBIDDEN",
    rate_limited: "RATE LIMIT",
    timeout: "TIMEOUT",
    network: "NETWORK",
    malformed_response: "BAD DATA",
    quota_unavailable: "NO QUOTA",
    request_failed: "API ERROR",
  };
  for (const [reason, message] of Object.entries(expected)) {
    assert.deepEqual(presentUsage({ kind: "unavailable", reason }), {
      state: 3,
      rows: [],
      message,
      footer: "",
    });
  }
});

test("falls back to the API error message for an unknown or absent reason", () => {
  for (const status of [
    { kind: "unavailable", reason: "unexpected_reason" },
    { kind: "unavailable" },
    { kind: "unavailable", reason: "toString" },
    {},
    { kind: "idle" },
  ]) {
    assert.deepEqual(presentUsage(status), { state: 3, rows: [], message: "API ERROR", footer: "" });
  }
});

test("presents a full three-row view with the frozen shape", () => {
  const view = presentUsage(
    usage([
      quota("glm5.3", 1000000000, 919000000),
      quota("glm5.2", 1000000000, 750000000),
      quota("deepseek-v4-flash", 500000000, 500000000),
    ]),
    { nanApiKey: "configured-value", selectedModels: ["glm5.3", "glm5.2", "deepseek-v4-flash"] },
  );

  assert.deepEqual(view, {
    state: 1,
    rows: [
      { modelId: "glm5.3", label: "glm5.3", percent: 92, remainingPercent: 91.9 },
      { modelId: "glm5.2", label: "glm5.2", percent: 75, remainingPercent: 75 },
      { modelId: "deepseek-v4-flash", label: "deepseek v4", percent: 100, remainingPercent: 100 },
    ],
    message: null,
    footer: "FROM SEP 1",
  });
  assert.deepEqual(Object.keys(view.rows[0]), ["modelId", "label", "percent", "remainingPercent"]);
});

test("keeps the exact unrounded percentage alongside the rounded one", () => {
  const view = presentUsage(usage([quota("glm5.3", 1000000000, 919000000)]));
  assert.ok(Math.abs(view.rows[0].remainingPercent - 91.9) < 1e-9);
  assert.equal(view.rows[0].percent, 92);
});

test("warns at exactly ten remaining percent", () => {
  const boundary = presentUsage(usage([quota("glm5.3", 1000000, 100000)]));
  assert.equal(boundary.state, 2);
  assert.equal(boundary.rows[0].remainingPercent, 10);
  assert.equal(boundary.rows[0].percent, 10);

  const above = presentUsage(usage([quota("glm5.3", 1000000, 100001)]));
  assert.equal(above.state, 1);
});

test("uses the unrounded value for the warning threshold", () => {
  const roundedDown = presentUsage(usage([quota("glm5.3", 1000000, 104000)]));
  assert.equal(roundedDown.rows[0].percent, 10);
  assert.equal(roundedDown.state, 1);

  const roundedUp = presentUsage(usage([quota("glm5.3", 1000000, 95000)]));
  assert.equal(roundedUp.rows[0].percent, 10);
  assert.equal(roundedUp.state, 2);
});

test("warns when any rendered row is at or below the threshold", () => {
  const view = presentUsage(
    usage([
      quota("glm5.3", 1000000, 900000),
      quota("glm5.2", 1000000, 50000),
      quota("deepseek-v4-flash", 1000000, 800000),
    ]),
  );
  assert.equal(view.state, 2);
  assert.equal(view.rows.length, 3);
});

test("rounds the displayed percentage and clamps it to the display range", () => {
  const view = presentUsage(
    usage([quota("over-cap", 1000, 1500), quota("low", 1000000, 10000)]),
  );
  assert.equal(view.rows[0].percent, 100);
  assert.equal(view.rows[0].remainingPercent, 100);
  assert.equal(view.rows[1].percent, 1);
  assert.equal(view.rows[1].remainingPercent, 1);
});

test("honours the explicit selection order and auto-fills to three rows", () => {
  const status = usage([
    quota("glm5.3", 1000, 1000),
    quota("glm5.2", 1000, 1000),
    quota("glm5.3-flash", 1000, 1000),
    quota("deepseek-v4-flash", 1000, 1000),
  ]);
  status.models = status.models.map((model, index) => ({ ...model, tokensUsed: [30, 50, 10, 40][index] }));

  const view = presentUsage(status, { nanApiKey: "configured-value", selectedModels: ["glm5.3-flash"] });
  assert.deepEqual(
    view.rows.map((row) => row.modelId),
    ["glm5.3-flash", "glm5.2", "deepseek-v4-flash"],
  );
  assert.deepEqual(
    view.rows.map((row) => row.label),
    ["glm5.3 flash", "glm5.2", "deepseek v4"],
  );
});

test("filters a model without a percentage before selection and fills its slot", () => {
  const status = usage([
    quota("no-cap", 0, 0),
    quota("glm5.3", 1000, 800),
    quota("glm5.2", 1000, 700),
    quota("glm5.3-flash", 1000, 600),
  ]);
  status.models = status.models.map((model, index) => ({ ...model, tokensUsed: [90, 30, 20, 10][index] }));

  const view = presentUsage(status, { selectedModels: ["no-cap", "glm5.3"] });
  assert.deepEqual(
    view.rows.map((row) => row.modelId),
    ["glm5.3", "glm5.2", "glm5.3-flash"],
  );
  assert.equal(view.state, 1);
});

test("returns the quota unavailable view when no model is drawable", () => {
  assert.deepEqual(presentUsage(usage([])), { state: 3, rows: [], message: "NO QUOTA", footer: "" });
  assert.deepEqual(presentUsage(usage([quota("no-cap", 0, 0)])), {
    state: 3,
    rows: [],
    message: "NO QUOTA",
    footer: "",
  });
  assert.deepEqual(presentUsage({ kind: "usage", periodStart: "2026-09-01" }), {
    state: 3,
    rows: [],
    message: "NO QUOTA",
    footer: "",
  });
});

test("derives the footer from the period start", () => {
  assert.equal(presentUsage(usage([quota("glm5.3", 1000, 1000)], "2026-09-01")).footer, "FROM SEP 1");
  assert.equal(presentUsage(usage([quota("glm5.3", 1000, 1000)], "2026-10-15")).footer, "FROM OCT 15");
  assert.equal(presentUsage(usage([quota("glm5.3", 1000, 1000)], "2026-12-31")).footer, "FROM DEC 31");
});

test("leaves the footer empty for an absent or unparseable period start", () => {
  const absent = presentUsage(usage([quota("glm5.3", 1000, 1000)], null));
  assert.equal(absent.footer, "");
  assert.equal(absent.state, 1);

  for (const periodStart of ["", "not-a-date", "2026-13-01", "31/12/2026"]) {
    const view = presentUsage(usage([quota("glm5.3", 1000, 1000)], periodStart));
    assert.equal(view.footer, "");
    assert.equal(view.state, 1);
  }
});

test("labels the known models and falls back to the raw id", () => {
  assert.deepEqual(MODEL_LABELS, {
    "deepseek-v4-flash": "deepseek v4",
    "glm5.3-flash": "glm5.3 flash",
    "glm5.3": "glm5.3",
    "glm5.2": "glm5.2",
    "mimo-v2.5": "mimo 2.5",
    "qwen3.8-flash": "qwen 3.8",
  });

  const status = usage([
    quota("glm5.3-flash", 1000, 1000),
    quota("mimo-v2.5", 1000, 1000),
    quota("qwen3.8-flash", 1000, 1000),
    quota("glm5.4-experimental", 1000, 1000),
  ]);
  assert.deepEqual(
    presentUsage(status).rows.map((row) => row.label),
    ["glm5.3 flash", "mimo 2.5", "qwen 3.8"],
  );

  const unknown = presentUsage(usage([quota("glm5.4-experimental", 1000, 1000)]));
  assert.equal(unknown.rows[0].label, "glm5.4-experimental");
  assert.equal(unknown.rows[0].modelId, "glm5.4-experimental");
});

test("tolerates an absent settings object", () => {
  const status = usage([quota("glm5.3", 1000, 900), quota("glm5.2", 1000, 800)]);
  const view = presentUsage(status);
  assert.equal(view.rows.length, 2);
  assert.equal(view.state, 1);
  assert.equal(view.footer, "FROM SEP 1");
});

test("never throws for an arbitrary status", () => {
  for (const status of [undefined, null, 0, "", [], { kind: "usage" }, { kind: "usage", models: "glm5.3" }]) {
    assert.doesNotThrow(() => presentUsage(status));
  }
  assert.doesNotThrow(() => presentUsage({ kind: "usage", models: [null, {}] }, {}));
});
