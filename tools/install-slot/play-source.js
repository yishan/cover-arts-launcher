export const OFFICIAL_PLAY_ORIGIN = "https://ai-passport.folotoy.cn";
import { fitLauncherTitle, inspectLauncherTitle } from "./title-font.js";

function localized(value) {
  if (typeof value === "string") return value.trim();
  return String(value?.zh ?? value?.en ?? "").trim();
}

function launcherTitle(value, playId) {
  const candidates = typeof value === "string"
    ? [value]
    : [value?.zh, value?.en];
  const normalized = candidates.map((candidate) => fitLauncherTitle(candidate)).filter(Boolean);
  return normalized.find((candidate) => inspectLauncherTitle(candidate).valid)
    ?? normalized[0]
    ?? `Play ${playId}`;
}

function requiredString(value, label) {
  const result = String(value ?? "").trim();
  if (!result) throw new Error(`Official Play response is missing ${label}.`);
  return result;
}

export function normalizeOfficialPlay(payload) {
  const play = payload?.play ?? payload;
  if (!play || typeof play !== "object") throw new Error("Official Play response is invalid.");
  const playId = requiredString(play.projectId ?? play.id, "id");
  const title = localized(play.title);
  if (!title) throw new Error("Official Play response is missing title.");
  const firmwareUrl = requiredString(play.downloadUrl ?? play.firmware?.url, "firmware URL");
  const firmwareSha256 = requiredString(play.firmwareSha256 ?? play.firmware?.sha256, "firmware SHA-256").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(firmwareSha256)) throw new Error("Official firmware SHA-256 is invalid.");

  return {
    playId,
    sourceId: `play:${playId}`,
    title,
    deviceTitle: launcherTitle(play.title, playId),
    version: String(play.shareVersion ?? play.version ?? play.revisionId ?? "").trim(),
    coverUrl: String(play.image ?? play.thumbnail ?? "").trim(),
    firmwareUrl,
    firmwareSha256,
  };
}

export function officialPlayApiPath(value) {
  const input = new URL(value, OFFICIAL_PLAY_ORIGIN);
  if (input.origin !== OFFICIAL_PLAY_ORIGIN) throw new Error("Only official AI Passport Play URLs are accepted.");
  const id = input.pathname.match(/^\/(?:en\/)?plays\/(\d+)\/?$/)?.[1]
    ?? input.pathname.match(/^\/api\/plays\/id\/(\d+)\/?$/)?.[1];
  if (id) return `/api/plays/id/${id}`;
  const slug = input.pathname.match(/^\/(?:en\/)?plays\/([a-z0-9-]+)\/?$/)?.[1];
  if (slug) return `/api/plays/${slug}`;
  if (/^\/api\/plays\/[a-z0-9-]+\/?$/.test(input.pathname)) return input.pathname;
  throw new Error("Use an official Play detail URL or public Play API URL.");
}

export function managerApiUrl(path, locationLike = globalThis.location) {
  if (locationLike?.protocol === "file:") return `http://127.0.0.1:4173${path}`;
  return path;
}
