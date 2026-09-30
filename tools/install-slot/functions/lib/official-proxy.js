import {
  fetchOfficial,
  OFFICIAL_PROXY_CACHE_CONTROL,
  OFFICIAL_PROXY_CORS_ORIGIN,
  officialContentType,
  officialResourceUrl,
  officialUpstreamError,
  proxyErrorMessage,
} from "../../lib/official-proxy-core.js";

export { officialResourceUrl };

function responseHeaders(contentType) {
  return {
    "access-control-allow-origin": OFFICIAL_PROXY_CORS_ORIGIN,
    "cache-control": OFFICIAL_PROXY_CACHE_CONTROL,
    "content-type": contentType,
  };
}

export async function proxyOfficial(target, { json = false, fetchImpl = fetch } = {}) {
  const upstream = await fetchOfficial(target, { json, fetchImpl });
  if (!upstream.ok) {
    return proxyErrorResponse(officialUpstreamError(upstream), upstream.status);
  }
  return new Response(upstream.body, {
    status: 200,
    headers: responseHeaders(officialContentType(upstream, { json })),
  });
}

export function proxyErrorResponse(error, status = 400, extraHeaders = {}) {
  return Response.json(
    { error: proxyErrorMessage(error) },
    {
      status,
      headers: {
        ...responseHeaders("application/json; charset=utf-8"),
        ...extraHeaders,
      },
    },
  );
}

export function requestQuery(request, name) {
  return new URL(request.url).searchParams.get(name) ?? "";
}
