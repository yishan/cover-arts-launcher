export const OFFICIAL_PLAY_ORIGIN = "https://ai-passport.folotoy.cn";
const encoder = new TextEncoder();
const LAUNCHER_TITLE_MAX_BYTES = 64;

function localized(value) {
  if (typeof value === "string") return value.trim();
  return String(value?.zh ?? value?.en ?? "").trim();
}

function launcherTitle(value, playId) {
  const candidates = typeof value === "string"
    ? [value]
    : [value?.zh, value?.en];
  const title = candidates
    .map((candidate) => String(candidate ?? "").trim())
    .find(Boolean) ?? `Play ${playId}`;
  let bounded = "";
  for (const character of title) {
    if (encoder.encode(bounded + character).length > LAUNCHER_TITLE_MAX_BYTES) break;
    bounded += character;
  }
  return bounded || `Play ${playId}`;
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
    coverUrl: String(play.thumbnail || play.image || "").trim(),
    firmwareUrl,
    firmwareSha256,
  };
}

const PLAY_URL_GUIDANCE =
  "官方玩法详情页（例如 https://ai-passport.folotoy.cn/plays/281/）或公开 Play API（例如 https://ai-passport.folotoy.cn/api/plays/id/281）";

class OfficialPlayUrlError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "OfficialPlayUrlError";
    this.code = code;
  }
}

function isLocalFirmwarePath(value) {
  if (!/\.bin$/i.test(value)) return false;
  const scheme = value.match(/^([a-z][a-z0-9+.-]*):\/\//i)?.[1]?.toLowerCase();
  return !scheme || scheme === "file";
}

function isFirmwareFileUrl(input) {
  return /\.bin$/i.test(input.pathname) || input.pathname.startsWith("/api/download/");
}

export function officialPlayApiPath(value) {
  const raw = String(value ?? "").trim();
  if (isLocalFirmwarePath(raw)) {
    throw new OfficialPlayUrlError(
      "local-firmware-path",
      "检测到本地 .bin 固件路径。请切换到「本地文件」并选择该文件。",
    );
  }
  let input;
  try {
    input = new URL(raw, OFFICIAL_PLAY_ORIGIN);
  } catch {
    throw new OfficialPlayUrlError("unsupported-play-url", `无法识别该链接。请填写${PLAY_URL_GUIDANCE}。`);
  }
  if (isFirmwareFileUrl(input)) {
    throw new OfficialPlayUrlError(
      "firmware-file-url",
      `这是固件文件链接，不是玩法页面。请下载后切换到「本地文件」安装；也可填写${PLAY_URL_GUIDANCE}。`,
    );
  }
  if (input.origin !== OFFICIAL_PLAY_ORIGIN) {
    throw new OfficialPlayUrlError(
      "unofficial-play-url",
      `仅支持官方 AI Passport 玩法链接。请填写${PLAY_URL_GUIDANCE}。其他来源的固件请先下载，再切换到「本地文件」安装。`,
    );
  }
  const id = input.pathname.match(/^\/(?:en\/)?plays\/(\d+)\/?$/)?.[1]
    ?? input.pathname.match(/^\/api\/plays\/id\/(\d+)\/?$/)?.[1];
  if (id) return `/api/plays/id/${id}`;
  const slug = input.pathname.match(/^\/(?:en\/)?plays\/([a-z0-9-]+)\/?$/)?.[1];
  if (slug) return `/api/plays/${slug}`;
  if (/^\/api\/plays\/[a-z0-9-]+\/?$/.test(input.pathname)) return input.pathname;
  throw new OfficialPlayUrlError(
    "unsupported-play-url",
    `该官方链接不是可读取的玩法页面。请填写${PLAY_URL_GUIDANCE}。`,
  );
}

export function managerApiUrl(path, locationLike = globalThis.location) {
  if (locationLike?.protocol === "file:") return `http://127.0.0.1:4173${path}`;
  return path;
}
