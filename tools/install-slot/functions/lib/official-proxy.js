import {
  prepareOfficialResponse,
  OFFICIAL_PROXY_CACHE_CONTROL,
  OFFICIAL_PROXY_CORS_ORIGIN,
  officialResourceUrl,
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

export async function proxyOfficial(target, options = {}) {
  const result = await prepareOfficialResponse(target, options);
  return new Response(result.body, {
    status: result.status,
    headers: { ...responseHeaders(result.contentType), "cache-control": result.cacheControl },
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
