import { getSettings, hsFetch, detectMeetingUrl, buildMeetingPayload } from "./api.js";

const COLORS = {
  pending: "#525252",
  success: "#15803d",
  warning: "#b45309",
  error: "#b91c1c"
};

chrome.action.onClicked.addListener((tab) => invite(tab));

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "invite-notetaker") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  invite(tab);
});

// The badge is cleared by navigation rather than by a timer. A service worker is
// terminated when idle and takes any pending setTimeout with it, which would
// leave a stale result on the icon forever.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") badge(tabId, "", COLORS.pending);
});

async function invite(tab) {
  const settings = await getSettings();

  if (!settings.apiKey || !settings.organizationId) {
    await badge(tab?.id, "!", COLORS.warning);
    notify("Setup needed", "Add your API key and organization in the extension options.");
    chrome.runtime.openOptionsPage();
    return;
  }

  const meetingUrl = detectMeetingUrl(tab?.url);
  if (!meetingUrl) {
    await badge(tab?.id, "?", COLORS.warning);
    notify("No meeting here", "This tab is not a Google Meet, Zoom or Teams meeting.");
    return;
  }

  await badge(tab?.id, "...", COLORS.pending);

  try {
    const meeting = await hsFetch("/meetings", {
      method: "POST",
      apiKey: settings.apiKey,
      body: buildMeetingPayload(meetingUrl, settings)
    });

    // HappyScribe dispatches only one active bot per normalized meeting_url, so
    // firing the shortcut twice on the same call is harmless.
    await badge(tab?.id, "OK", COLORS.success);
    if (settings.notifyOnSuccess) {
      notify("Notetaker on its way", `Status: ${meeting?.status ?? "queued"}`);
    }
  } catch (error) {
    await badge(tab?.id, "ERR", COLORS.error);
    notify("Could not invite the notetaker", error.message);
    // error.payload holds the API's response body. The request headers, and so
    // the key, are never logged.
    console.error("[happyscribe-extension]", error.status, error.payload ?? error);
  }
}

async function badge(tabId, text, color) {
  if (tabId == null) return;
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color });
    await chrome.action.setBadgeText({ tabId, text });
  } catch {
    // The tab was closed while the request was in flight.
  }
}

function notify(title, message) {
  chrome.notifications.create(
    {
      type: "basic",
      title,
      message: message || "",
      iconUrl: "icon128.png"
    },
    () => void chrome.runtime.lastError
  );
}
