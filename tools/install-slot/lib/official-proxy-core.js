import { OFFICIAL_PLAY_ORIGIN } from "../play-source.js";

export const OFFICIAL_PROXY_CACHE_CONTROL = "no-store";
export const OFFICIAL_PROXY_CORS_ORIGIN = "*";

export function officialResourceUrl(value) {
  const target = new URL(value, OFFICIAL_PLAY_ORIGIN);
  if (target.origin !== OFFICIAL_PLAY_ORIGIN || !target.pathname.startsWith("/api/")) {
    throw new Error("Only official /api/ firmware and image resources are proxied.");
  }
  return target;
}

export async function fetchOfficial(target, { json = false, fetchImpl = fetch } = {}) {
  const upstream = await fetchImpl(target, {
    redirect: "follow",
    headers: { accept: json ? "application/json" : "*/*" },
  });
  if (!upstream.url) {
    throw new Error("Official service response did not expose its final URL.");
  }
  const finalUrl = new URL(upstream.url);
  if (finalUrl.origin !== OFFICIAL_PLAY_ORIGIN) {
    throw new Error("Official resource redirected outside the allowed origin.");
  }
  return upstream;
}

export function officialContentType(upstream, { json = false } = {}) {
  return json
    ? "application/json; charset=utf-8"
    : (upstream.headers.get("content-type") ?? "application/octet-stream");
}

export function officialUpstreamError(upstream) {
  return `Official service returned HTTP ${upstream.status}.`;
}

export function proxyErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
