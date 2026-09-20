const { normalizeQuotaPayload } = require("./nan-quota.js");
const { UsageProvider } = require("./usage-provider.js");

const NAN_QUOTA_URL = "https://cloud-api.nan.builders/api/usage/quota";
const REQUEST_TIMEOUT_MS = 10_000;

class NanQuotaProvider extends UsageProvider {
  constructor(apiKey, fetchImpl = globalThis.fetch) {
    super();
    this.apiKey = typeof apiKey === "string" ? apiKey.trim() : "";
    this.fetchImpl = fetchImpl;
  }

  async getUsage() {
    if (!this.apiKey) return unavailable("not_configured");
    if (typeof this.fetchImpl !== "function") return unavailable("network");

    let response;
    try {
      response = await this.fetchImpl(NAN_QUOTA_URL, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      return unavailable(error?.name === "TimeoutError" ? "timeout" : "network");
    }

    if (response.status === 401) return unavailable("unauthorized");
    if (response.status === 403) return unavailable("forbidden");
    if (response.status === 429) return unavailable("rate_limited");
    if (!response.ok) return unavailable("request_failed");

    let payload;
    try {
      payload = await response.json();
    } catch {
      return unavailable("malformed_response");
    }
    return normalizeUsagePayload(payload);
  }
}

function normalizeUsagePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return unavailable("malformed_response");
  if (!Array.isArray(payload.models)) return unavailable("malformed_response");

  const normalized = normalizeQuotaPayload(payload);
  if (normalized.models.length === 0) return unavailable("quota_unavailable");

  return {
    kind: "usage",
    periodStart: normalized.periodStart,
    models: normalized.models,
  };
}

function unavailable(reason) {
  return { kind: "unavailable", reason };
}

module.exports = { NAN_QUOTA_URL, REQUEST_TIMEOUT_MS, NanQuotaProvider, normalizeUsagePayload };
