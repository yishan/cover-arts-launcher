import { OFFICIAL_PLAY_ORIGIN } from "../play-source.js";
import { compactOfficialCatalog } from "../play-catalog.js";

export const OFFICIAL_PROXY_CACHE_CONTROL = "no-store";
export const OFFICIAL_PROXY_CORS_ORIGIN = "*";

export function officialResourceSha(value = "") {
  if (!value) return "";
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error("Invalid firmware SHA-256.");
  return value.toLowerCase();
}

function cachePolicy(target, contentType, { fresh, expectedSha, json }) {
  if (fresh) return "no-store";
  if (json && target.pathname === "/api/plays") return "public, max-age=30, s-maxage=300";
  if (json && target.pathname.startsWith("/api/plays/")) return "public, max-age=0, s-maxage=60";
  if (target.pathname.startsWith("/api/media/") && contentType.startsWith("image/")) {
    return target.searchParams.has("v")
      ? "public, max-age=86400, s-maxage=604800"
      : "public, max-age=60, s-maxage=3600";
  }
  if (expectedSha && (target.pathname.startsWith("/api/download/") || target.pathname.endsWith(".bin"))) {
    return "public, max-age=3600, s-maxage=86400";
  }
  return "no-store";
}

// Both deployment adapters use the same compact payload and cache contract.
// A caller-supplied hash is not trusted until the complete response matches it.
export async function prepareOfficialResponse(target, options = {}) {
  const expectedSha = officialResourceSha(options.expectedSha);
  const upstream = await fetchOfficial(target, options);
  if (!upstream.ok) {
    return { status: upstream.status, contentType: "application/json; charset=utf-8",
      cacheControl: "no-store", body: new TextEncoder().encode(JSON.stringify({ error: officialUpstreamError(upstream) })) };
  }
  const contentType = officialContentType(upstream, options);
  let body = new Uint8Array(await upstream.arrayBuffer());
  if (expectedSha) {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", body));
    const actual = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    if (actual !== expectedSha) throw new Error("Official firmware SHA-256 mismatch; refresh the play metadata.");
  }
  if (options.json && target.pathname === "/api/plays") {
    const payload = compactOfficialCatalog(JSON.parse(new TextDecoder().decode(body)));
    body = new TextEncoder().encode(JSON.stringify(payload));
  }
  return { status: 200, contentType, body,
    cacheControl: cachePolicy(target, contentType, { ...options, expectedSha }) };
}

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
    cache: "no-store",
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
