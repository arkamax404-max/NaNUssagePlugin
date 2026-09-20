function parsePercent(value, cap) {
  if (!Number.isFinite(value) || !Number.isFinite(cap)) return null;
  if (cap <= 0 || value < 0) return null;
  return Math.max(0, Math.min(100, value / cap * 100));
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
    const tokensUsed = nonNegativeNumber(entry.tokensUsed);
    const remainingPercent = parsePercent(remaining, cap);
    models.push({
      id,
      cap,
      tokensUsed,
      remaining,
      remainingPercent,
      consumedPercent: consumedPercentOf(tokensUsed, cap, remainingPercent),
      updatedAt: nonEmptyString(entry.updatedAt),
      periodEnd: nonEmptyString(entry.periodEnd),
      windowHours: positiveNumber(entry.windowHours),
      fullWindowTokens: finiteNumber(entry.fullWindowTokens),
    });
  }
  return { periodStart, models };
}

// The key shows consumed quota, so the figure comes from tokensUsed when the
// payload can support it and only falls back to the remaining complement.
function consumedPercentOf(tokensUsed, cap, remainingPercent) {
  const consumed = parsePercent(tokensUsed, cap);
  if (consumed !== null) return consumed;
  return Number.isFinite(remainingPercent) ? 100 - remainingPercent : null;
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
