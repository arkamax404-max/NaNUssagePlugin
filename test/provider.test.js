const assert = require("node:assert/strict");
const test = require("node:test");
const {
  NAN_QUOTA_URL,
  REQUEST_TIMEOUT_MS,
  NanQuotaProvider,
  normalizeUsagePayload,
} = require("../src/plugin/nan-quota-provider.js");

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

const UNAVAILABLE = { kind: "unavailable", reason: "quota_unavailable" };
const MALFORMED = { kind: "unavailable", reason: "malformed_response" };

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

function jsonResponse(status, payload) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => payload,
  };
}

function captureFetch(response) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return response;
  };
  return { fetchImpl, calls };
}

function providerReturning(response) {
  return captureFetch(response);
}

test("exports the endpoint and the ten second timeout", () => {
  assert.equal(NAN_QUOTA_URL, "https://cloud-api.nan.builders/api/usage/quota");
  assert.equal(REQUEST_TIMEOUT_MS, 10000);
});

test("treats a blank, whitespace-only or non-string key as not configured", async () => {
  for (const key of ["", "   ", "\t\n", null, undefined, 42, {}, [], true]) {
    const { fetchImpl, calls } = providerReturning(jsonResponse(200, quotaPayload()));
    const provider = new NanQuotaProvider(key, fetchImpl);

    assert.deepEqual(await provider.getUsage(), {
      kind: "unavailable",
      reason: "not_configured",
    });
    assert.equal(calls.length, 0);
  }
});

test("treats a missing fetch implementation as a network failure", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = undefined;
    const provider = new NanQuotaProvider("nan-key");

    assert.deepEqual(await provider.getUsage(), {
      kind: "unavailable",
      reason: "network",
    });
  } finally {
    globalThis.fetch = original;
  }
});

test("treats a non-function fetch implementation as a network failure", async () => {
  for (const fetchImpl of [null, 0, "", "fetch", {}, [], true]) {
    const provider = new NanQuotaProvider("nan-key", fetchImpl);

    assert.deepEqual(await provider.getUsage(), {
      kind: "unavailable",
      reason: "network",
    });
  }
});

test("requests the quota endpoint with the trimmed bearer key", async () => {
  const { fetchImpl, calls } = providerReturning(jsonResponse(200, quotaPayload()));
  const provider = new NanQuotaProvider("  nan-secret  ", fetchImpl);
  const result = await provider.getUsage();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, NAN_QUOTA_URL);
  assert.equal(calls[0].options.method, "GET");
  assert.deepEqual(calls[0].options.headers, {
    Accept: "application/json",
    Authorization: "Bearer nan-secret",
  });
  assert.notEqual(calls[0].options.signal, undefined);
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal(result.kind, "usage");
});

test("maps a successful response to a usage result", async () => {
  const { fetchImpl } = providerReturning(jsonResponse(200, quotaPayload()));
  const provider = new NanQuotaProvider("nan-key", fetchImpl);
  const result = await provider.getUsage();

  assert.equal(result.kind, "usage");
  assert.equal(result.periodStart, "2026-09-01");
  assert.deepEqual(
    result.models.map((model) => model.id),
    ["glm5.3", "glm5.2", "deepseek-v4-flash"],
  );
  assert.deepEqual(Object.keys(result.models[0]), MODEL_FIELDS);
  assert.equal(result.models[0].cap, 1000000000);
  assert.equal(result.models[0].tokensUsed, 919000000);
  assert.ok(Math.abs(result.models[0].remainingPercent - 8.1) < 1e-9);
  assert.equal(result.models[0].windowHours, 4);
  assert.equal(result.models[2].remainingPercent, 100);
});

test("passes a null periodStart straight through", async () => {
  const payload = quotaPayload();
  delete payload.periodStart;
  const { fetchImpl } = providerReturning(jsonResponse(200, payload));
  const provider = new NanQuotaProvider("nan-key", fetchImpl);
  const result = await provider.getUsage();

  assert.equal(result.kind, "usage");
  assert.equal(result.periodStart, null);
});

test("maps the authentication and throttling statuses to their reasons", async () => {
  const cases = [
    [401, "unauthorized"],
    [403, "forbidden"],
    [429, "rate_limited"],
  ];

  for (const [status, reason] of cases) {
    const { fetchImpl, calls } = providerReturning(jsonResponse(status, {}));
    const provider = new NanQuotaProvider("nan-key", fetchImpl);

    assert.deepEqual(await provider.getUsage(), { kind: "unavailable", reason });
    assert.equal(calls.length, 1);
  }
});

test("maps a generic server error to request_failed", async () => {
  const { fetchImpl } = providerReturning(jsonResponse(500, {}));
  const provider = new NanQuotaProvider("nan-key", fetchImpl);

  assert.deepEqual(await provider.getUsage(), {
    kind: "unavailable",
    reason: "request_failed",
  });
});

test("maps every other non-ok status to request_failed", async () => {
  for (const status of [400, 404, 405, 422, 500, 502, 503]) {
    const { fetchImpl } = providerReturning(jsonResponse(status, quotaPayload()));
    const provider = new NanQuotaProvider("nan-key", fetchImpl);

    assert.deepEqual(await provider.getUsage(), {
      kind: "unavailable",
      reason: "request_failed",
    });
  }
});

test("maps an unparseable body to malformed_response", async () => {
  const response = {
    status: 200,
    ok: true,
    json: async () => {
      throw new SyntaxError("Unexpected token < in JSON");
    },
  };
  const provider = new NanQuotaProvider("nan-key", captureFetch(response).fetchImpl);

  assert.deepEqual(await provider.getUsage(), MALFORMED);
});

test("maps a non-object payload to malformed_response", async () => {
  for (const payload of [null, undefined, 42, "quota", true, []]) {
    const { fetchImpl } = providerReturning(jsonResponse(200, payload));
    const provider = new NanQuotaProvider("nan-key", fetchImpl);

    assert.deepEqual(await provider.getUsage(), MALFORMED);
  }
});

test("maps a missing, null or non-array models value to malformed_response", async () => {
  for (const models of [undefined, null, "glm5.3", 42, {}, true]) {
    const payload = quotaPayload();
    if (models === undefined) delete payload.models;
    else payload.models = models;

    const { fetchImpl } = providerReturning(jsonResponse(200, payload));
    const provider = new NanQuotaProvider("nan-key", fetchImpl);

    assert.deepEqual(await provider.getUsage(), MALFORMED);
  }
});

test("maps an empty models array to quota_unavailable", async () => {
  const { fetchImpl } = providerReturning(jsonResponse(200, { periodStart: "2026-09-01", models: [] }));
  const provider = new NanQuotaProvider("nan-key", fetchImpl);

  assert.deepEqual(await provider.getUsage(), UNAVAILABLE);
});

test("maps a models array with no usable entry to quota_unavailable", async () => {
  const payload = {
    periodStart: "2026-09-01",
    models: [null, "glm5.3", 42, [], {}, { model: "" }, { model: "   " }, { model: 42 }],
  };
  const { fetchImpl } = providerReturning(jsonResponse(200, payload));
  const provider = new NanQuotaProvider("nan-key", fetchImpl);

  assert.deepEqual(await provider.getUsage(), UNAVAILABLE);
});

test("maps a timed out fetch to timeout", async () => {
  const fetchImpl = async () => {
    const error = new Error("The operation was aborted due to timeout");
    error.name = "TimeoutError";
    throw error;
  };
  const provider = new NanQuotaProvider("nan-key", fetchImpl);

  assert.deepEqual(await provider.getUsage(), {
    kind: "unavailable",
    reason: "timeout",
  });
});

test("maps any other thrown fetch to network", async () => {
  const throws = [
    () => {
      throw new Error("socket hang up");
    },
    () => {
      throw new TypeError("fetch failed");
    },
    () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    },
    () => {
      throw "plain string";
    },
    () => {
      throw undefined;
    },
  ];

  for (const throwing of throws) {
    const provider = new NanQuotaProvider("nan-key", async () => throwing());

    assert.deepEqual(await provider.getUsage(), {
      kind: "unavailable",
      reason: "network",
    });
  }
});

test("never rejects for an arbitrary fetch outcome", async () => {
  const outcomes = [
    jsonResponse(200, quotaPayload()),
    jsonResponse(401, {}),
    {
      status: 200,
      ok: true,
      json: async () => {
        throw new Error("bad body");
      },
    },
  ];

  for (const response of outcomes) {
    const provider = new NanQuotaProvider("nan-key", captureFetch(response).fetchImpl);
    await assert.doesNotReject(() => provider.getUsage());
  }

  const throwing = new NanQuotaProvider("nan-key", async () => {
    throw new Error("boom");
  });
  await assert.doesNotReject(() => throwing.getUsage());
});

test("reads a non-array models value on the mapper directly", () => {
  assert.deepEqual(normalizeUsagePayload({ models: [] }), UNAVAILABLE);
  assert.deepEqual(normalizeUsagePayload({ models: null }), MALFORMED);
  assert.deepEqual(normalizeUsagePayload({ models: "glm5.3" }), MALFORMED);
  assert.deepEqual(normalizeUsagePayload({}), MALFORMED);
  assert.deepEqual(normalizeUsagePayload([]), MALFORMED);
  assert.deepEqual(normalizeUsagePayload(null), MALFORMED);
  assert.deepEqual(normalizeUsagePayload("quota"), MALFORMED);
  assert.deepEqual(normalizeUsagePayload(42), MALFORMED);
  assert.deepEqual(normalizeUsagePayload(undefined), MALFORMED);
  assert.deepEqual(normalizeUsagePayload(quotaPayload()).kind, "usage");
});
