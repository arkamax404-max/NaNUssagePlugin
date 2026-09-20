const DEFAULT_SETTINGS = Object.freeze({
  nanApiKey: "",
  selectedModels: Object.freeze([]),
});
const KNOWN_MODELS = Object.freeze([
  "deepseek-v4-flash",
  "glm5.3-flash",
  "mimo-v2.5",
  "qwen3.8-flash",
  "glm5.2",
  "glm5.3",
]);

function normalizeSettings(value = {}) {
  return {
    nanApiKey: typeof value?.nanApiKey === "string" ? value.nanApiKey.trim() : "",
    selectedModels: normalizeSelectedModels(value?.selectedModels),
  };
}

function normalizeSelectedModels(value) {
  if (!Array.isArray(value)) return [];
  const models = [];
  const seen = new Set();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const id = entry.trim();
    if (id === "" || seen.has(id)) continue;
    seen.add(id);
    models.push(id);
  }
  return models;
}

module.exports = { DEFAULT_SETTINGS, KNOWN_MODELS, normalizeSettings };
