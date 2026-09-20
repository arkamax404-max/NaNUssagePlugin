function parsePercent(remaining, cap) {
  if (!Number.isFinite(remaining) || !Number.isFinite(cap)) return null;
  if (cap <= 0 || remaining < 0) return null;
  return Math.max(0, Math.min(100, remaining / cap * 100));
}

function normalizeQuotaPayload(payload) {
  const periodStart = nonEmptyString(payload?.periodStart);
  const entries = Array.isArray(payload?.models) ? payload.models : [];
  const models = [];
  const seen = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const model = nonEmptyString(entry.model);
    if (model === null) continue;
    const id = model.trim();
    if (id === "" || seen.has(id)) continue;
    seen.add(id);
    const cap = nonNegativeNumber(entry.cap);
    const remaining = nonNegativeNumber(entry.remaining);
    models.push({
      id,
      cap,
      tokensUsed: nonNegativeNumber(entry.tokensUsed),
      remaining,
      remainingPercent: parsePercent(remaining, cap),
      updatedAt: nonEmptyString(entry.updatedAt),
      periodEnd: nonEmptyString(entry.periodEnd),
      windowHours: positiveNumber(entry.windowHours),
      fullWindowTokens: finiteNumber(entry.fullWindowTokens),
    });
  }
  return { periodStart, models };
}

function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function finiteNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function nonNegativeNumber(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function positiveNumber(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

module.exports = { normalizeQuotaPayload, parsePercent };
