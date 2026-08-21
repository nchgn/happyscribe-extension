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

  el("reveal").addEventListener("click", toggleReveal);
  el("verify").addEventListener("click", verify);
  el("save").addEventListener("click", save);
  el("clear").addEventListener("click", clear);

  await renderShortcut();
  paintProgress(settings);
}

function toggleReveal() {
  const input = el("apiKey");
  const hidden = input.type === "password";
  input.type = hidden ? "text" : "password";
  el("reveal").textContent = hidden ? "Hide" : "Show";
}

async function verify() {
  const apiKey = el("apiKey").value.trim();
  if (!apiKey) return status("Paste your key first.", "err");

  status("Checking the key…");
  try {
    const data = await listOrganizations(apiKey);
    const orgs = data?.organizations ?? [];
    if (!orgs.length) {
      return status("The key works, but it belongs to no organization.", "err");
    }

    setOrganizations(orgs, el("organizationId").value || orgs[0].id);
    status(
      orgs.length === 1
        ? "Key verified. Save to finish."
        : `Key verified. Pick one of ${orgs.length} organizations, then save.`,
      "ok"
    );
  } catch (error) {
    status(error.message, "err");
  }
}

function setOrganizations(orgs, selectedId) {
  knownOrganizations = orgs;
  const select = el("organizationId");
  select.innerHTML = "";

  if (!orgs.length) {
    select.disabled = true;
    select.appendChild(new Option("Verify your key to load organizations", ""));
    return;
  }

  select.disabled = false;
  for (const org of orgs) {
    select.appendChild(new Option(org.role ? `${org.name} · ${org.role}` : org.name, String(org.id)));
  }
  if (selectedId != null) select.value = String(selectedId);
}

async function save() {
  const apiKey = el("apiKey").value.trim();
  const organizationId = el("organizationId").value;

  if (!apiKey) return status("Paste your key first.", "err");
  if (!organizationId) return status("Verify the key, then pick an organization.", "err");

  const chosen = knownOrganizations.find((o) => String(o.id) === organizationId);

  const saved = {
    apiKey,
    organizationId: Number(organizationId),
    organizationName: chosen?.name ?? "",
    botName: el("botName").value.trim() || "Notetaker",
    language: el("language").value.trim() || "auto",
    recordingTrigger: el("recordingTrigger").value,
    summaryTemplate: el("summaryTemplate").value.trim()
  };

  await saveSettings(saved);
  paintProgress(saved);
  status("Saved.", "ok");
}

async function clear() {
  await clearCredentials();
  el("apiKey").value = "";
  el("apiKey").type = "password";
  el("reveal").textContent = "Show";
  setOrganizations([], null);
  paintProgress({ apiKey: "", organizationId: null });
  status("Credentials cleared.", "ok");
}

/**
 * The spine reflects what is actually stored, not what is typed: it answers
 * "is this armed?", which is the only question this page exists to settle.
 */
function paintProgress({ apiKey, organizationId }) {
  const hasKey = Boolean(apiKey);
  const hasOrg = Boolean(organizationId);

  el("step-key").dataset.state = hasKey ? "done" : "todo";
  el("step-org").dataset.state = hasOrg ? "done" : "todo";

  // Nothing stored yet means nothing to clear, so the control stays out of the way.
  el("clear").hidden = !hasKey && !hasOrg;

  const ready = hasKey && hasOrg;
  el("payoff").dataset.ready = String(ready);
  // Surfaces only once the extension is actually set up, so it never competes
  // with the job the page is here to do.
  el("brainNotice").hidden = !ready;
  el("payoffText").textContent = ready
    ? "Armed. In a Meet, Zoom or Teams tab, press"
    : "Finish both steps to arm the shortcut.";
  el("payoffKeys").hidden = !ready;
}

/**
 * Read the real binding rather than hardcoding it — the user may have rebound it
 * in chrome://extensions/shortcuts, and a page that lies about the shortcut is
 * worse than one that stays quiet.
 */
async function renderShortcut() {
  const mac = navigator.userAgent.includes("Mac");
  let combo = mac ? "Command+Shift+H" : "Ctrl+Shift+H";

  try {
    const commands = await chrome.commands.getAll();
    const found = commands.find((c) => c.name === "invite-notetaker");
    if (found?.shortcut) combo = found.shortcut;
  } catch {
    // Fall back to the manifest's suggested binding.
  }

  const symbols = { Command: "⌘", Shift: "⇧", Ctrl: mac ? "⌃" : "Ctrl", MacCtrl: "⌃", Alt: mac ? "⌥" : "Alt" };
  const keys = combo.split("+").map((k) => symbols[k] ?? k);

  const target = el("payoffKeys");
  target.textContent = "";
  for (const key of keys) {
    const kbd = document.createElement("kbd");
    kbd.textContent = key;
    target.appendChild(kbd);
  }
}

function status(message, kind = "") {
  const node = el("status");
  node.textContent = message;
  node.className = kind;
}
