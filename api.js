export const API_BASE = "https://www.happyscribe.com/api/v1";

const DEFAULTS = {
  apiKey: "",
  organizationId: null,
  organizationName: "",
  language: "auto",
  botName: "Notetaker",
  recordingTrigger: "call_join",
  summaryTemplate: "",
  notifyOnSuccess: true
};

export async function getSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored };
}

export async function saveSettings(patch) {
  await chrome.storage.local.set(patch);
}

export async function clearCredentials() {
  await chrome.storage.local.remove(["apiKey", "organizationId", "organizationName"]);
}

/**
 * Every request goes through the service worker or the options page, never a
 * content script. Not for CORS reasons — the API's policy is permissive and
 * answers a chrome-extension:// preflight with `allow-origin: *` — but because
 * the user's key must never enter the context of a page we do not control.
 */
export async function hsFetch(path, { method = "GET", body, apiKey, timeoutMs = 15000 } = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      // Without this, a hung request leaves the UI stuck in its pending state
      // with nothing to tell the user.
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    const err = new Error(
      timedOut
        ? `No response from the HappyScribe API after ${Math.round(timeoutMs / 1000)}s.`
        : `Could not reach the HappyScribe API: ${error?.message ?? "network error"}`
    );
    err.status = 0;
    throw err;
  }

  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }

  if (!res.ok) {
    const err = new Error(apiErrorMessage(res.status, payload));
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

function apiErrorMessage(status, payload) {
  // The API uses two error envelopes: a scalar `error` (401) and an `errors`
  // array (422). Both have to be read.
  const detail =
    payload?.error?.message ||
    payload?.error ||
    payload?.message ||
    (Array.isArray(payload?.errors) ? payload.errors.join(", ") : null);

  if (status === 401 || status === 403) {
    // A bad key answers {"error":"Unauthorized","status":401}, which tells the
    // user nothing actionable. This is the one case where we do not pass the
    // API's own wording through.
    return "Invalid API key, or no access to that organization. Check it in the options page.";
  }
  if (status === 429) {
    const retry = payload?.retry_in_seconds;
    return retry ? `Rate limit reached. Retry in ${retry}s.` : "Rate limit reached.";
  }
  return detail || `HappyScribe API error ${status}.`;
}

export function listOrganizations(apiKey) {
  return hsFetch("/organizations", { apiKey });
}

/**
 * Returns the join URL to send to HappyScribe, or null when the tab is not a
 * supported meeting.
 *
 * The query string is treated asymmetrically on purpose. Meet carries no join
 * secret there, only per-profile noise (authuser, pli) that would defeat the
 * API's deduplication of the same call, so it is stripped. Zoom's `?pwd=` and
 * Teams' `?context=` are load-bearing — drop them and the bot is refused at the
 * door — so those are preserved.
 */
export function detectMeetingUrl(rawUrl) {
  if (!rawUrl) return null;

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();

  if (host === "meet.google.com") {
    return /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/i.test(url.pathname)
      ? `https://meet.google.com${url.pathname}`
      : null;
  }

  if (host.endsWith("zoom.us") || host.endsWith("zoomgov.com")) {
    return /^\/(j|w|my|s)\//.test(url.pathname) ? url.toString() : null;
  }

  if (host === "teams.microsoft.com" || host === "teams.live.com") {
    return /meetup-join|\/meet\//.test(url.pathname) ? url.toString() : null;
  }

  return null;
}

export function buildMeetingPayload(meetingUrl, settings) {
  const payload = {
    organization_id: Number(settings.organizationId),
    meeting_url: meetingUrl,
    language: settings.language || "auto",
    settings: {
      bot_name: settings.botName || "Notetaker",
      recording_trigger: settings.recordingTrigger || "call_join"
    }
  };
  if (settings.summaryTemplate) {
    payload.settings.summary_template = settings.summaryTemplate;
  }
  return payload;
}
