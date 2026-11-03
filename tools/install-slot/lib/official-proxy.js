import {
  prepareOfficialResponse,
  OFFICIAL_PROXY_CACHE_CONTROL,
  OFFICIAL_PROXY_CORS_ORIGIN,
  officialResourceUrl,
  proxyErrorMessage,
} from "./official-proxy-core.js";

export { officialResourceUrl };

export async function proxyOfficial(response, target, options = {}) {
  const result = await prepareOfficialResponse(target, options);
  const body = Buffer.from(result.body);
  response.statusCode = result.status;
  response.setHeader("content-type", result.contentType);
  response.setHeader("content-length", body.length);
  response.setHeader("cache-control", result.cacheControl);
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
