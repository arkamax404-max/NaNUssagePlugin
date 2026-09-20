function selectModels(models, selectedIds, limit = 3) {
  const list = Array.isArray(models) ? models : [];
  const size = Number.isInteger(limit) && limit > 0 ? limit : 3;
  if (list.length === 0) return [];

  const index = new Map();
  for (const model of list) {
    const id = modelId(model);
    if (id === null || index.has(id)) continue;
    index.set(id, model);
  }

  const selected = [];
  const emitted = new Set();
  const ids = Array.isArray(selectedIds) ? selectedIds : [];
  for (const id of ids) {
    if (selected.length >= size) break;
    if (typeof id !== "string" || emitted.has(id)) continue;
    const model = index.get(id);
    if (!model) continue;
    emitted.add(id);
    selected.push(model);
  }

  if (selected.length >= size) return selected;

  const rest = [];
  const remaining = new Set(emitted);
  for (const model of list) {
    const id = modelId(model);
    if (id === null || remaining.has(id)) continue;
    remaining.add(id);
    rest.push(model);
  }
  rest.sort(compareByTokensUsed);

  for (const model of rest) {
    if (selected.length >= size) break;
    selected.push(model);
  }
  return selected;
}

function modelId(model) {
  if (!model || typeof model.id !== "string" || model.id === "") return null;
  return model.id;
}

function compareByTokensUsed(left, right) {
  const a = Number.isFinite(left?.tokensUsed) ? left.tokensUsed : null;
  const b = Number.isFinite(right?.tokensUsed) ? right.tokensUsed : null;
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

module.exports = { selectModels };
