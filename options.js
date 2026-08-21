import { getSettings, saveSettings, clearCredentials, listOrganizations } from "./api.js";

const el = (id) => document.getElementById(id);
const fields = ["apiKey", "botName", "language", "recordingTrigger", "summaryTemplate"];

let knownOrganizations = [];

init();

async function init() {
  const settings = await getSettings();
  for (const f of fields) el(f).value = settings[f] ?? "";

  // Show the remembered organization by name without a network call. The name is
  // cached purely for this; only the id is ever sent to the API.
  if (settings.organizationId) {
    setOrganizations(
      [{ id: settings.organizationId, name: settings.organizationName || `Organization ${settings.organizationId}` }],
      settings.organizationId
    );
  }

  el("reveal").addEventListener("click", () => {
    const input = el("apiKey");
    const hidden = input.type === "password";
    input.type = hidden ? "text" : "password";
    el("reveal").textContent = hidden ? "Hide" : "Show";
  });

  el("verify").addEventListener("click", verify);
  el("save").addEventListener("click", save);
  el("clear").addEventListener("click", clear);
}

async function verify() {
  const apiKey = el("apiKey").value.trim();
  if (!apiKey) return status("Paste your API key first.", "err");

  status("Verifying…");
  try {
    const data = await listOrganizations(apiKey);
    const orgs = data?.organizations ?? [];
    if (!orgs.length) return status("The key works but belongs to no organization.", "err");

    setOrganizations(orgs, el("organizationId").value || orgs[0].id);
    status(`Key verified · ${orgs.length} organization(s) available.`, "ok");
  } catch (error) {
    status(error.message, "err");
  }
}

function setOrganizations(orgs, selectedId) {
  knownOrganizations = orgs;
  const select = el("organizationId");
  select.innerHTML = "";
  for (const org of orgs) {
    const option = document.createElement("option");
    option.value = String(org.id);
    option.textContent = org.role ? `${org.name} (${org.role})` : org.name;
    select.appendChild(option);
  }
  if (selectedId != null) select.value = String(selectedId);
}

async function save() {
  const apiKey = el("apiKey").value.trim();
  const organizationId = el("organizationId").value;

  if (!apiKey) return status("The API key is missing.", "err");
  if (!organizationId) return status("Verify the key and pick an organization.", "err");

  const chosen = knownOrganizations.find((o) => String(o.id) === organizationId);

  await saveSettings({
    apiKey,
    organizationId: Number(organizationId),
    organizationName: chosen?.name ?? "",
    botName: el("botName").value.trim() || "Notetaker",
    language: el("language").value.trim() || "auto",
    recordingTrigger: el("recordingTrigger").value,
    summaryTemplate: el("summaryTemplate").value.trim()
  });

  status("Saved. Open a Meet, Zoom or Teams tab and press the shortcut.", "ok");
}

async function clear() {
  await clearCredentials();
  el("apiKey").value = "";
  setOrganizations([], null);
  el("organizationId").innerHTML = '<option value="">— verify your key to load organizations —</option>';
  status("Credentials removed from this device.", "ok");
}

function status(message, kind = "") {
  const node = el("status");
  node.textContent = message;
  node.className = kind;
}
