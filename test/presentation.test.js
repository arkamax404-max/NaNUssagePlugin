const assert = require("node:assert/strict");
const test = require("node:test");
const { normalizeQuotaPayload } = require("../src/plugin/nan-quota.js");
const { MODEL_LABELS, formatResetDay, presentUsage } = require("../src/plugin/presentation.js");

const IDLE_VIEW = { state: 0, rows: [], message: null, footer: "" };

function usage(models, periodStart = "2026-09-01") {
  return { kind: "usage", ...normalizeQuotaPayload({ periodStart, models }) };
}

function quota(model, cap, remaining, tokensUsed, periodEnd) {
  return { model, cap, remaining, tokensUsed, periodEnd };
}

test("returns the idle view for a missing status", () => {
  assert.deepEqual(presentUsage(), IDLE_VIEW);
  assert.deepEqual(presentUsage(null), IDLE_VIEW);
  assert.deepEqual(presentUsage(0), IDLE_VIEW);
  assert.deepEqual(presentUsage("", IDLE_VIEW), IDLE_VIEW);
});

test("maps every unavailable reason to one centred message and an empty footer", () => {
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
      quota("glm5.3", 1000000000, 750000000, 250000000, "2026-09-30"),
      quota("glm5.2", 1000000000, 900000000, 100000000, "2026-09-30"),
      quota("deepseek-v4-flash", 500000000, 500000000, 0, "2026-09-30"),
    ]),
    { nanApiKey: "configured-value", selectedModels: ["glm5.3", "glm5.2", "deepseek-v4-flash"] },
  );

  assert.deepEqual(view, {
    state: 1,
    rows: [
      { modelId: "glm5.3", label: "glm5.3", percent: 25, consumedPercent: 25, remainingPercent: 75 },
      { modelId: "glm5.2", label: "glm5.2", percent: 10, consumedPercent: 10, remainingPercent: 90 },
      { modelId: "deepseek-v4-flash", label: "deepseek v4", percent: 0, consumedPercent: 0, remainingPercent: 100 },
    ],
    message: null,
    footer: "RESET SEP 30",
  });
  assert.deepEqual(Object.keys(view.rows[0]), [
    "modelId",
    "label",
    "percent",
    "consumedPercent",
    "remainingPercent",
  ]);
});

test("keeps the exact unrounded consumption alongside the rounded one", () => {
  const view = presentUsage(usage([quota("glm5.3", 1000000000, 81000000, 919000000)]));
  assert.equal(view.rows[0].consumedPercent, 91.9);
  assert.equal(view.rows[0].percent, 92);
  assert.equal(view.rows[0].remainingPercent, 8.1);
  assert.equal(view.state, 2);
});

test("rounds the displayed consumption and clamps it to the display range", () => {
  const over = presentUsage({
    kind: "usage",
    models: [{ id: "over", consumedPercent: 140.6, remainingPercent: 50 }],
  });
  assert.equal(over.rows[0].consumedPercent, 140.6);
  assert.equal(over.rows[0].percent, 100);
  assert.equal(over.state, 1);

  const below = presentUsage({
    kind: "usage",
    models: [{ id: "below", consumedPercent: -5.4, remainingPercent: 50 }],
  });
  assert.equal(below.rows[0].percent, 0);

  const rounding = presentUsage({
    kind: "usage",
    models: [{ id: "half", consumedPercent: 0.5, remainingPercent: 50 }],
  });
  assert.equal(rounding.rows[0].percent, 1);
});

test("warns at exactly ten remaining percent even when consumption is tiny", () => {
  const boundary = presentUsage(usage([quota("glm5.3", 1000000, 100000, 2000)]));
  assert.equal(boundary.rows[0].remainingPercent, 10);
  assert.equal(boundary.rows[0].consumedPercent, 0.2);
  assert.equal(boundary.rows[0].percent, 0);
  assert.equal(boundary.state, 2);

  const above = presentUsage(usage([quota("glm5.3", 1000000, 100001, 999000)]));
  assert.equal(above.rows[0].remainingPercent, 10.0001);
  assert.equal(above.rows[0].consumedPercent, 99.9);
  assert.equal(above.rows[0].percent, 100);
  assert.equal(above.state, 1);
});

test("uses the unrounded remaining value for the warning threshold", () => {
  const roundedDown = presentUsage(usage([quota("glm5.3", 1000000, 104000, 896000)]));
  assert.equal(roundedDown.rows[0].remainingPercent, 10.4);
  assert.equal(roundedDown.rows[0].percent, 90);
  assert.equal(roundedDown.state, 1);

  const roundedUp = presentUsage(usage([quota("glm5.3", 1000000, 95000, 905000)]));
  assert.equal(roundedUp.rows[0].remainingPercent, 9.5);
  assert.equal(roundedUp.rows[0].percent, 91);
  assert.equal(roundedUp.state, 2);
});

test("warns when any rendered row is at or below the threshold", () => {
  const view = presentUsage(
    usage([
      quota("glm5.3", 1000000, 900000, 100000),
      quota("glm5.2", 1000000, 50000, 950000),
      quota("deepseek-v4-flash", 1000000, 800000, 200000),
    ]),
  );
  assert.equal(view.state, 2);
  assert.equal(view.rows.length, 3);
});

test("does not warn on a row whose remaining value is unknown", () => {
  const view = presentUsage({
    kind: "usage",
    models: [{ id: "unknown-remaining", consumedPercent: 42, remainingPercent: null }],
  });
  assert.equal(view.rows.length, 1);
  assert.equal(view.rows[0].consumedPercent, 42);
  assert.equal(view.rows[0].percent, 42);
  assert.equal(view.rows[0].remainingPercent, null);
  assert.equal(view.state, 1);
});

test("honours the explicit selection order and auto-fills to three rows", () => {
  const status = usage([
    quota("glm5.3", 1000, 1000, 30),
    quota("glm5.2", 1000, 1000, 50),
    quota("glm5.3-flash", 1000, 1000, 10),
    quota("deepseek-v4-flash", 1000, 1000, 40),
  ]);

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

test("filters a model without a drawable consumption figure before selection", () => {
  const status = usage([
    quota("no-cap", 0, 0, 0),
    quota("glm5.3", 1000, 800, 30),
    quota("glm5.2", 1000, 700, 20),
    quota("glm5.3-flash", 1000, 600, 10),
  ]);

  const view = presentUsage(status, { selectedModels: ["no-cap", "glm5.3"] });
  assert.deepEqual(
    view.rows.map((row) => row.modelId),
    ["glm5.3", "glm5.2", "glm5.3-flash"],
  );
  assert.equal(view.state, 1);
});

test("filters on consumedPercent, not on a healthy remainingPercent", () => {
  const view = presentUsage(
    {
      kind: "usage",
      models: [
        { id: "no-consumption", consumedPercent: null, remainingPercent: 80 },
        { id: "glm5.3", consumedPercent: 25, remainingPercent: 75 },
        { id: "glm5.2", consumedPercent: 20, remainingPercent: 80 },
        { id: "glm5.3-flash", consumedPercent: 10, remainingPercent: 90 },
      ],
    },
    { selectedModels: ["no-consumption", "glm5.3"] },
  );

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

test("leaves the footer empty in the quota unavailable view even when a period end exists", () => {
  assert.deepEqual(presentUsage(usage([quota("no-cap", 0, 0, 0, "2026-09-30")])), {
    state: 3,
    rows: [],
    message: "NO QUOTA",
    footer: "",
  });
});

test("derives the footer from the period end", () => {
  assert.equal(presentUsage(usage([quota("glm5.3", 1000, 1000, 0, "2026-09-30")])).footer, "RESET SEP 30");
  assert.equal(presentUsage(usage([quota("glm5.3", 1000, 1000, 0, "2026-10-15")])).footer, "RESET OCT 15");
  assert.equal(presentUsage(usage([quota("glm5.3", 1000, 1000, 0, "2026-12-31")])).footer, "RESET DEC 31");
  assert.equal(presentUsage(usage([quota("glm5.3", 1000, 1000, 0, "2026-10-01T00:00:00Z")])).footer, "RESET OCT 1");
});

test("takes the reset day from a model that is not displayed", () => {
  const status = usage([
    quota("glm5.3", 1000, 1000, 30),
    quota("glm5.2", 1000, 1000, 20),
    quota("deepseek-v4-flash", 1000, 1000, 10),
    quota("qwen3.8-flash", 1000, 1000, 1, "2026-09-30"),
  ]);

  const first = presentUsage(status, { selectedModels: ["glm5.3", "glm5.2", "deepseek-v4-flash"] });
  assert.deepEqual(
    first.rows.map((row) => row.modelId),
    ["glm5.3", "glm5.2", "deepseek-v4-flash"],
  );
  assert.equal(first.footer, "RESET SEP 30");

  const second = presentUsage(status, { selectedModels: ["qwen3.8-flash"] });
  assert.deepEqual(
    second.rows.map((row) => row.modelId),
    ["qwen3.8-flash", "glm5.3", "glm5.2"],
  );
  assert.equal(second.footer, "RESET SEP 30");
});

test("uses the first parsable period end across every model", () => {
  const view = presentUsage(
    usage([
      quota("glm5.3", 1000, 1000, 30, "not-a-date"),
      quota("glm5.2", 1000, 1000, 20),
      quota("deepseek-v4-flash", 1000, 1000, 10, "2026-09-30"),
    ]),
  );
  assert.equal(view.footer, "RESET SEP 30");
});

test("leaves the footer empty when no model carries a parsable period end", () => {
  const absent = presentUsage(usage([quota("glm5.3", 1000, 1000, 0)]));
  assert.equal(absent.footer, "");
  assert.equal(absent.state, 1);

  for (const periodEnd of [null, undefined, "", "not-a-date", "2026-13-01", "31/12/2026", 20260930]) {
    const view = presentUsage(usage([quota("glm5.3", 1000, 1000, 0, periodEnd)]));
    assert.equal(view.footer, "");
    assert.equal(view.state, 1);
  }
});

test("formats the reset day in en-US and UTC without local zone drift", () => {
  assert.equal(formatResetDay("2026-09-30"), "RESET SEP 30");
  assert.equal(formatResetDay("2026-09-30T00:00:00Z"), "RESET SEP 30");
  assert.equal(formatResetDay("2026-10-01T00:00:00Z"), "RESET OCT 1");
  // 22:30Z is already the next calendar day in every zone east of UTC+1:30 and
  // 01:30Z is still the previous day west of UTC-1:30, so together they pin the
  // UTC calendar whatever TZ the machine runs in.
  assert.equal(formatResetDay("2026-09-30T22:30:00Z"), "RESET SEP 30");
  assert.equal(formatResetDay("2026-10-01T01:30:00Z"), "RESET OCT 1");

  for (const value of [null, undefined, "", "not-a-date", "2026-13-01", "31/12/2026"]) {
    assert.equal(formatResetDay(value), "");
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
  const status = usage([quota("glm5.3", 1000, 900, 100, "2026-09-30"), quota("glm5.2", 1000, 800, 200, "2026-09-30")]);
  const view = presentUsage(status);
  assert.equal(view.rows.length, 2);
  assert.equal(view.state, 1);
  assert.equal(view.footer, "RESET SEP 30");
});

test("never throws for an arbitrary status", () => {
  for (const status of [
    undefined,
    null,
    0,
    "",
    [],
    { kind: "usage" },
    { kind: "usage", models: "glm5.3" },
    { kind: "usage", models: [null, 42, {}, { id: "no-percent" }, { id: "glm5.3", consumedPercent: 10 }] },
  ]) {
    assert.doesNotThrow(() => presentUsage(status));
  }
  assert.doesNotThrow(() => presentUsage({ kind: "usage", models: [null, {}] }, {}));
});
