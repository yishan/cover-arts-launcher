import {
  fetchOfficial,
  OFFICIAL_PROXY_CACHE_CONTROL,
  OFFICIAL_PROXY_CORS_ORIGIN,
  officialContentType,
  officialResourceUrl,
  officialUpstreamError,
  proxyErrorMessage,
} from "./official-proxy-core.js";

export { officialResourceUrl };

export async function proxyOfficial(response, target, { json = false, fetchImpl = fetch } = {}) {
  const upstream = await fetchOfficial(target, { json, fetchImpl });
  const contentType = officialContentType(upstream, { json });
  const body = upstream.ok
    ? Buffer.from(await upstream.arrayBuffer())
    : Buffer.from(JSON.stringify({ error: officialUpstreamError(upstream) }));

  response.statusCode = upstream.ok ? 200 : upstream.status;
  response.setHeader("content-type", upstream.ok ? contentType : "application/json; charset=utf-8");
  response.setHeader("content-length", body.length);
  response.setHeader("cache-control", OFFICIAL_PROXY_CACHE_CONTROL);
  response.setHeader("access-control-allow-origin", OFFICIAL_PROXY_CORS_ORIGIN);
  response.end(body);
}

export function sendProxyError(response, error, status = 400) {
  const body = Buffer.from(JSON.stringify({ error: proxyErrorMessage(error) }));
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("content-length", body.length);
  response.setHeader("cache-control", OFFICIAL_PROXY_CACHE_CONTROL);
  response.setHeader("access-control-allow-origin", OFFICIAL_PROXY_CORS_ORIGIN);
  response.end(body);
}

export function requestQuery(request, name) {
  const origin = `https://${request.headers?.host ?? "localhost"}`;
  return new URL(request.url ?? "/", origin).searchParams.get(name) ?? "";
}
