const { HostClient } = require("./host-client.js");
const { NanQuotaProvider } = require("./nan-quota-provider.js");
const { UsageService } = require("./usage-service.js");
const { normalizeSettings } = require("./settings.js");
const { presentUsage } = require("./presentation.js");
const { createUsageImage } = require("./usage-image-renderer.js");

const PLUGIN_UUID = "com.ulanzi.ulanzistudio.nanusage";
const AUTOMATIC_POLL_INTERVAL_MS = 5 * 60 * 1000;

function credentialsChanged(current, next) {
  return current.nanApiKey !== next.nanApiKey;
}

function sameModels(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return left === right;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function settingsChanged(current, next) {
  return credentialsChanged(current, next) || !sameModels(current.selectedModels, next.selectedModels);
}

function shouldPoll(action) {
  return action?.active === true && Boolean(action.settings?.nanApiKey);
}

function beginRefresh(action) {
  if (!action || action.refreshing) return null;
  action.refreshing = true;
  return { revision: action.revision, settings: action.settings };
}

function isRefreshCurrent(action, snapshot) {
  return Boolean(action && snapshot && action.revision === snapshot.revision);
}

function canApplyRefreshResult(contexts, context, action, snapshot) {
  return contexts.get(context) === action && isRefreshCurrent(action, snapshot);
}

function finishRefresh(action) {
  if (action) action.refreshing = false;
}

function start() {
  const contexts = new Map();
  const host = new HostClient();
  const service = new UsageService(
    (settings) => new NanQuotaProvider(settings.nanApiKey),
  );
  let pollTimer;

  host.connect(PLUGIN_UUID);
  host.on("error", (error) => console.error(`[Ulanzi host] ${error.message}`));
  host.onAdd(updateContext);
  host.onParamFromApp(updateContext);
  host.onParamFromPlugin(updateContext);
  host.onSetActive((message) => {
    const action = contexts.get(message.context);
    if (!action) return;
    action.active = message.active === true || message.active === "true";
    ensurePolling();
  });
  host.onRun((message) => {
    if (!contexts.has(message.context)) updateContext(message, false);
    refresh(message.context, true);
  });
  host.onClear((message) => {
    for (const item of message.param || []) contexts.delete(item.context);
    ensurePolling();
  });

  function updateContext(message, refreshImmediately = true) {
    const isNew = !contexts.has(message.context);
    const action = contexts.get(message.context) || { active: true, revision: 0 };
    const settings = normalizeSettings({ ...action.settings, ...message.param });
    const credentials = Boolean(action.settings && credentialsChanged(action.settings, settings));
    const changed = Boolean(action.settings && settingsChanged(action.settings, settings));
    if (isNew || credentials) {
      action.revision += 1;
      action.nextPollAt = undefined;
      if (action.refreshing) action.pendingAutomaticRefresh = true;
    }
    action.settings = settings;
    contexts.set(message.context, action);
    if (refreshImmediately && (isNew || credentials) && !action.refreshing) refresh(message.context);
    // A display-only change re-renders from the cached status: no network request, no revision
    // bump. A model-selection change moves no data, so it redraws from the last result instead of
    // asking the provider again. It is skipped while a refresh is still running, because refresh()
    // already shows the loading icon and the completion renders with the newest action.settings
    // anyway.
    else if (refreshImmediately && changed && !credentials && !action.refreshing)
      applyView(message.context, action);
    ensurePolling();
  }

  function applyView(context, action) {
    if (!action?.status || !action.active) return;
    const view = presentUsage(action.status, action.settings);
    const image = createUsageImage(view);
    if (image) host.setBaseDataIcon(context, image);
    else host.setStateIcon(context, view.state);
  }

  async function refresh(context, manual = false) {
    const action = contexts.get(context);
    if (!action) return;
    if (action.refreshing) {
      if (manual) action.pendingManualRefresh = true;
      return;
    }
    const snapshot = beginRefresh(action);
    if (!snapshot) return;
    if (action.active) host.setStateIcon(context, 0);
    try {
      const status = await service.refresh(snapshot.settings);
      if (!canApplyRefreshResult(contexts, context, action, snapshot)) return;
      action.status = status;
      action.nextPollAt = shouldPoll(action) ? Date.now() + AUTOMATIC_POLL_INTERVAL_MS : undefined;
      if (action.active) applyView(context, action);
    } finally {
      finishRefresh(action);
      if (contexts.get(context) !== action) return ensurePolling();
      if (action.pendingManualRefresh) {
        action.pendingManualRefresh = false;
        action.pendingAutomaticRefresh = false;
        refresh(context, true);
      } else if (action.pendingAutomaticRefresh) {
        action.pendingAutomaticRefresh = false;
        refresh(context);
      } else {
        ensurePolling();
      }
    }
  }

  function refreshActive() {
    const now = Date.now();
    for (const [context, action] of contexts) {
      if (shouldPoll(action) && !action.refreshing && action.nextPollAt !== undefined && action.nextPollAt <= now)
        refresh(context);
    }
    ensurePolling();
  }

  function ensurePolling() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = undefined;
    const now = Date.now();
    let nextPollAt;
    for (const action of contexts.values()) {
      if (!shouldPoll(action) || action.refreshing) continue;
      if (action.nextPollAt === undefined) action.nextPollAt = now + AUTOMATIC_POLL_INTERVAL_MS;
      nextPollAt = Math.min(nextPollAt ?? Infinity, action.nextPollAt);
    }
    if (nextPollAt !== undefined)
      pollTimer = setTimeout(refreshActive, Math.max(0, nextPollAt - now));
  }

  process.once("SIGTERM", () => process.exit(0));
  process.once("SIGINT", () => process.exit(0));
}

if (require.main === module) start();

module.exports = {
  AUTOMATIC_POLL_INTERVAL_MS,
  beginRefresh,
  canApplyRefreshResult,
  credentialsChanged,
  finishRefresh,
  isRefreshCurrent,
  sameModels,
  settingsChanged,
  shouldPoll,
};
