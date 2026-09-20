const { selectModels } = require("./selection.js");

const MODEL_LABELS = Object.freeze({
  "deepseek-v4-flash": "deepseek v4",
  "glm5.3-flash": "glm5.3 flash",
  "glm5.3": "glm5.3",
  "glm5.2": "glm5.2",
  "mimo-v2.5": "mimo 2.5",
  "qwen3.8-flash": "qwen 3.8",
});

const UNAVAILABLE_MESSAGES = Object.freeze({
  not_configured: "ADD API KEY",
  unauthorized: "AUTH ERROR",
  forbidden: "FORBIDDEN",
  rate_limited: "RATE LIMIT",
  timeout: "TIMEOUT",
  network: "NETWORK",
  malformed_response: "BAD DATA",
  quota_unavailable: "NO QUOTA",
  request_failed: "API ERROR",
});

function presentUsage(status, settings) {
  if (!status) return { state: 0, rows: [], message: null, footer: "" };
  if (status.kind !== "usage") return unavailableView(status.reason);

  const resetDay = formatResetDay(firstParseablePeriodEnd(status.models));
  const models = Array.isArray(status.models)
    ? status.models.filter((model) => Number.isFinite(model?.consumedPercent))
    : [];
  const selected = selectModels(models, settings?.selectedModels, 3);
  if (selected.length === 0) return unavailableView("quota_unavailable");

  const rows = selected.map((model) => ({
    modelId: model.id,
    label: modelLabel(model.id),
    percent: clampPercent(model.consumedPercent),
    consumedPercent: model.consumedPercent,
    remainingPercent: model.remainingPercent,
  }));
  return {
    state: rows.some((row) => Number.isFinite(row.remainingPercent) && row.remainingPercent <= 10) ? 2 : 1,
    rows,
    message: null,
    footer: resetDay,
  };
}

function modelLabel(id) {
  return Object.hasOwn(MODEL_LABELS, id) ? MODEL_LABELS[id] : id;
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatResetDay(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const month = date.toLocaleString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase();
  return `RESET ${month} ${date.getUTCDate()}`;
}

// The reset day does not depend on which three models are displayed, so it is
// read from every model of the status, before filtering and selection.
function firstParseablePeriodEnd(models) {
  if (!Array.isArray(models)) return null;
  for (const model of models) {
    const periodEnd = model?.periodEnd;
    if (typeof periodEnd === "string" && !Number.isNaN(new Date(periodEnd).getTime())) return periodEnd;
  }
  return null;
}

function unavailableView(reason) {
  const message = Object.hasOwn(UNAVAILABLE_MESSAGES, reason)
    ? UNAVAILABLE_MESSAGES[reason]
    : UNAVAILABLE_MESSAGES.request_failed;
  return { state: 3, rows: [], message, footer: "" };
}

module.exports = { MODEL_LABELS, formatResetDay, presentUsage };
