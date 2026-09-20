const ACTION_UUID = "com.ulanzi.ulanzistudio.nanusage.usage";
const KNOWN_MODELS = ["deepseek-v4-flash", "glm5.3-flash", "mimo-v2.5", "qwen3.8-flash", "glm5.2", "glm5.3"];
const form = document.querySelector("#settings");
const status = document.querySelector("#status");
const keyStatus = document.querySelector("#key-status");
const clearKey = document.querySelector("#clear-key");
const models = document.querySelector("#models");
const checkboxById = new Map();
let settings = { nanApiKey: "", selectedModels: [] };

for (const id of KNOWN_MODELS) {
  const choice = document.createElement("label");
  choice.className = "choice";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.name = "selectedModels";
  checkbox.value = id;
  choice.appendChild(checkbox);
  choice.appendChild(document.createTextNode(id));
  models.appendChild(choice);
  checkboxById.set(id, checkbox);
}

$UD.on("connected", () => { status.textContent = "Settings are stored with this key."; });
for (const event of ["add", "paramfromapp", "didReceiveSettings"]) {
  $UD.on(event, (message) => {
    const incoming = message.param || message.settings;
    if (!incoming) return;
    settings = { ...settings, ...incoming };
    applySettings();
  });
}
form.addEventListener("change", () => saveSettings());
clearKey.addEventListener("click", () => {
  settings.nanApiKey = "";
  form.elements.nanApiKey.value = "";
  saveSettings(true);
  status.textContent = "Saved key cleared.";
});

function saveSettings(clearing = false) {
  const enteredKey = form.elements.nanApiKey.value.trim();
  settings = {
    ...settings,
    nanApiKey: clearing ? "" : enteredKey || settings.nanApiKey,
    selectedModels: selectedModelIds(),
  };
  $UD.sendParamFromPlugin(settings);
  form.elements.nanApiKey.value = "";
  renderKeyStatus();
  if (!clearing) status.textContent = "Saved. Press the key to refresh.";
}

function applySettings() {
  form.elements.nanApiKey.value = "";
  const selected = Array.isArray(settings.selectedModels) ? settings.selectedModels : [];
  for (const [id, checkbox] of checkboxById) checkbox.checked = selected.includes(id);
  renderKeyStatus();
}

function selectedModelIds() {
  return KNOWN_MODELS.filter((id) => checkboxById.get(id).checked);
}

function renderKeyStatus() {
  keyStatus.textContent = settings.nanApiKey ? "NaN API key configured (masked)." : "No NaN API key configured.";
}

$UD.connect(ACTION_UUID);
