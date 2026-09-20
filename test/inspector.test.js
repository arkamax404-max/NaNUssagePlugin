const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { KNOWN_MODELS } = require("../src/plugin/settings.js");

const root = join(__dirname, "..");
const pluginRoot = join(root, "com.ulanzi.nanusage.ulanziPlugin");
const inspectorRoot = join(pluginRoot, "property-inspector");
const inspectorSource = readFileSync(join(inspectorRoot, "usage", "inspector.js"), "utf8");
const inspectorMarkup = readFileSync(join(inspectorRoot, "usage", "inspector.html"), "utf8");
const manifest = JSON.parse(readFileSync(join(pluginRoot, "manifest.json"), "utf8"));

// SHA-256 of the reference shim at
// GHCopilotUssagePlugin/com.ulanzi.githubcopilotusage.ulanziPlugin/property-inspector/lib/host-api.js.
// Recorded so the suite stays hermetic on a fresh clone while still failing on any edit.
const HOST_API_SHA256 = "0302ee74d6835ceb57e1c37bf78730d43a8c50d98fc5a7d979ddb4e3692b39a2";
const REFERENCE_PLUGIN_ROOT = join(root, "..", "GHCopilotUssagePlugin", "com.ulanzi.githubcopilotusage.ulanziPlugin");

class TextNode {
  constructor(text) {
    this.nodeType = 3;
    this.textContent = String(text);
  }
}

function matches(node, selector) {
  const parsed = /^([a-z]+)(?:\[name="([^"]+)"\])?(:checked)?$/.exec(selector);
  if (!parsed) throw new Error(`unsupported selector: ${selector}`);
  const [, tagName, name, checked] = parsed;
  if (node.nodeType !== 1 || node.nodeName !== tagName) return false;
  if (name !== undefined && node.name !== name) return false;
  if (checked !== undefined && !node.checked) return false;
  return true;
}

class Element {
  constructor(tagName) {
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.childNodes = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.checked = false;
    this.value = "";
    this.className = "";
    this.text = "";
  }

  get nodeName() {
    return this.tagName.toLowerCase();
  }

  set type(value) {
    this.attributes.set("type", String(value));
  }
  get type() {
    return this.attributes.get("type") ?? "";
  }

  set name(value) {
    this.attributes.set("name", String(value));
  }
  get name() {
    return this.attributes.get("name") ?? "";
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  appendChild(child) {
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  set textContent(value) {
    this.childNodes = [];
    this.text = String(value);
  }

  get textContent() {
    if (this.childNodes.length === 0) return this.text;
    return this.childNodes.map((child) => child.textContent).join("");
  }

  addEventListener(name, handler) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(handler);
  }

  fire(name, payload) {
    for (const handler of this.listeners.get(name) || []) handler(payload);
  }

  querySelectorAll(selector) {
    const found = [];
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType !== 1) continue;
        if (matches(child, selector)) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }
}

function buildDocument() {
  const registry = new Map();
  const byId = new Map();
  const document = {
    createElement: (tagName) => new Element(tagName),
    createTextNode: (text) => new TextNode(text),
    querySelector(selector) {
      const parsed = /^#([\w-]+)$/.exec(selector);
      if (!parsed) throw new Error(`unsupported selector: ${selector}`);
      if (!registry.has(parsed[1])) throw new Error(`missing stub element: ${selector}`);
      return registry.get(parsed[1]);
    },
    register(id, element) {
      registry.set(id, element);
      byId.set(id, element);
      element.setAttribute("id", id);
    },
    byId,
  };
  return document;
}

// Hand-built stub of the elements inspector.html declares, because Node has no DOM.
function buildDom() {
  const document = buildDocument();
  const form = document.createElement("form");
  document.register("settings", form);

  const keyInput = document.createElement("input");
  keyInput.type = "password";
  keyInput.name = "nanApiKey";
  form.elements = { nanApiKey: keyInput };
  form.appendChild(keyInput);

  const models = document.createElement("div");
  document.register("models", models);
  form.appendChild(models);

  const clearKey = document.createElement("button");
  document.register("clear-key", clearKey);
  form.appendChild(clearKey);

  const keyStatus = document.createElement("output");
  document.register("key-status", keyStatus);
  form.appendChild(keyStatus);

  const status = document.createElement("output");
  status.textContent = "Connecting…";
  document.register("status", status);
  form.appendChild(status);

  return { document, form, keyInput, models, clearKey, keyStatus, status };
}

function buildHostShim() {
  const handlers = new Map();
  const calls = { connect: [], sent: [] };
  return {
    calls,
    on(name, handler) {
      if (!handlers.has(name)) handlers.set(name, []);
      handlers.get(name).push(handler);
    },
    connect(uuid) {
      calls.connect.push(uuid);
    },
    sendParamFromPlugin(param) {
      calls.sent.push(param);
    },
    dispatch(name, payload) {
      for (const handler of handlers.get(name) || []) handler(payload);
    },
  };
}

function loadInspector() {
  const dom = buildDom();
  const host = buildHostShim();
  const context = vm.createContext({ document: dom.document, $UD: host });
  vm.runInContext(inspectorSource, context, { filename: "inspector.js" });
  return {
    ...dom,
    host,
    // Top-level const bindings live in the context's global lexical scope, so they are readable
    // through a follow-up script and stay exactly what the inspector itself declared.
    actionUuid: vm.runInContext("ACTION_UUID", context),
    declaredModels: Array.from(vm.runInContext("KNOWN_MODELS", context)),
  };
}

// Arrays created inside the vm are cross-realm, so every vm array is copied into this realm first.
function sameArray(actual) {
  return Array.from(actual);
}

test("renders the six known models as checkboxes in catalogue order", () => {
  const dom = loadInspector();
  dom.host.dispatch("connected", {});

  assert.equal(dom.status.textContent, "Settings are stored with this key.");
  const boxes = dom.models.querySelectorAll('input[name="selectedModels"]');
  assert.equal(boxes.length, 6);
  assert.deepEqual(boxes.map((box) => box.value), [...KNOWN_MODELS]);
  assert.deepEqual(boxes.map((box) => box.type), Array(6).fill("checkbox"));
  assert.deepEqual(boxes.map((box) => box.textContent), Array(6).fill(""));
});

test("sends the checked models in catalogue order, not click order", () => {
  const dom = loadInspector();
  const boxes = dom.models.querySelectorAll('input[name="selectedModels"]');
  for (const id of ["glm5.3", "mimo-v2.5", "deepseek-v4-flash"]) {
    boxes.find((box) => box.value === id).checked = true;
  }
  assert.equal(dom.models.querySelectorAll('input[name="selectedModels"]:checked').length, 3);

  dom.form.fire("change");

  assert.equal(dom.host.calls.sent.length, 1);
  assert.deepEqual(sameArray(dom.host.calls.sent[0].selectedModels), [
    "deepseek-v4-flash",
    "mimo-v2.5",
    "glm5.3",
  ]);
  assert.equal(dom.keyInput.value, "");
});

test("preserves the stored key when the key field is left empty", () => {
  const dom = loadInspector();
  dom.host.dispatch("paramfromapp", {
    param: { nanApiKey: "nan-secret", selectedModels: ["glm5.2"] },
  });
  assert.equal(dom.keyStatus.textContent, "NaN API key configured (masked).");

  dom.form.fire("change");

  const sent = dom.host.calls.sent.at(-1);
  assert.equal(sent.nanApiKey, "nan-secret");
  assert.equal(dom.status.textContent, "Saved. Press the key to refresh.");
});

test("never writes the saved key back into the password field", () => {
  const dom = loadInspector();

  for (const event of ["add", "paramfromapp", "didReceiveSettings"]) {
    dom.host.dispatch(event, { param: { nanApiKey: "nan-secret" }, settings: { nanApiKey: "nan-secret" } });
    assert.equal(dom.keyInput.value, "");
    assert.equal(dom.keyInput.type, "password");
  }
  assert.equal(dom.keyStatus.textContent, "NaN API key configured (masked).");
});

test("ignores an event that carries no settings payload", () => {
  const dom = loadInspector();
  const boxes = dom.models.querySelectorAll('input[name="selectedModels"]');
  const keyStatusBefore = dom.keyStatus.textContent;

  for (const event of ["add", "paramfromapp", "didReceiveSettings"]) dom.host.dispatch(event, {});

  assert.equal(keyStatusBefore, "");
  assert.equal(dom.keyStatus.textContent, keyStatusBefore);
  assert.equal(dom.host.calls.sent.length, 0);
  assert.deepEqual(boxes.map((box) => box.checked), Array(6).fill(false));
});

test("clears the stored key from the clear button", () => {
  const dom = loadInspector();
  dom.host.dispatch("didReceiveSettings", { settings: { nanApiKey: "nan-secret", selectedModels: ["glm5.3"] } });

  dom.clearKey.fire("click");

  const sent = dom.host.calls.sent.at(-1);
  assert.equal(sent.nanApiKey, "");
  assert.deepEqual(sameArray(sent.selectedModels), ["glm5.3"]);
  assert.equal(dom.keyInput.value, "");
  assert.equal(dom.keyStatus.textContent, "No NaN API key configured.");
  assert.equal(dom.status.textContent, "Saved key cleared.");
});

test("re-applies settings that arrive after the first paint", () => {
  const dom = loadInspector();
  const boxes = dom.models.querySelectorAll('input[name="selectedModels"]');

  dom.host.dispatch("didReceiveSettings", { settings: { selectedModels: ["mimo-v2.5", "glm5.3"] } });
  assert.deepEqual(sameArray(boxes.filter((box) => box.checked).map((box) => box.value)), ["mimo-v2.5", "glm5.3"]);

  dom.host.dispatch("paramfromapp", { param: { selectedModels: ["glm5.2"] } });
  assert.deepEqual(sameArray(boxes.filter((box) => box.checked).map((box) => box.value)), ["glm5.2"]);

  dom.host.dispatch("paramfromapp", { param: { selectedModels: "glm5.2" } });
  assert.deepEqual(sameArray(boxes.filter((box) => box.checked)), []);
});

test("declares the same model catalogue as src/plugin/settings.js", () => {
  const dom = loadInspector();

  assert.deepEqual(dom.declaredModels, [...KNOWN_MODELS]);
  assert.equal(dom.declaredModels.length, 6);
  assert.equal(new Set(dom.declaredModels).size, 6);
  for (const id of dom.declaredModels) {
    assert.equal(typeof id, "string");
    assert.notEqual(id.trim(), "");
  }
});

test("uses the manifest action UUID", () => {
  const dom = loadInspector();

  assert.equal(dom.actionUuid, "com.ulanzi.ulanzistudio.nanusage.usage");
  assert.equal(dom.actionUuid, manifest.Actions[0].UUID);
  assert.equal(dom.host.calls.connect.at(-1), dom.actionUuid);
});

test("loads the host shim before the inspector script and masks the key field", () => {
  const shimIndex = inspectorMarkup.indexOf("../lib/host-api.js");
  const scriptIndex = inspectorMarkup.indexOf('src="inspector.js"');

  assert.notEqual(shimIndex, -1);
  assert.notEqual(scriptIndex, -1);
  assert.ok(shimIndex < scriptIndex, "host-api.js must be loaded before inspector.js");

  const keyInput = inspectorMarkup.match(/<input[^>]*name="nanApiKey"[^>]*>/);
  assert.notEqual(keyInput, null, "the key input must be declared in the markup");
  assert.match(keyInput[0], /type="password"/);
  assert.match(inspectorMarkup, /id="models"/);
  assert.match(inspectorMarkup, /<output id="status" role="status">Connecting…<\/output>/);
});

test("ships the reference host shim byte for byte", () => {
  const bytes = readFileSync(join(inspectorRoot, "lib", "host-api.js"));

  assert.equal(createHash("sha256").update(bytes).digest("hex"), HOST_API_SHA256);
  assert.equal(bytes.includes(13), false, "the reference shim is LF-only");
  assert.match(bytes.toString("utf8"), /window\.\$UD = \{/);

  const reference = join(REFERENCE_PLUGIN_ROOT, "property-inspector", "lib", "host-api.js");
  if (existsSync(reference)) assert.equal(bytes.equals(readFileSync(reference)), true);
});
