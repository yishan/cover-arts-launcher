import {
  officialResourceUrl,
  proxyErrorResponse,
  proxyOfficial,
  requestQuery,
} from "../lib/official-proxy.js";

export async function onRequest(context) {
  if (context.request.method !== "GET") {
    return proxyErrorResponse("Method not allowed.", 405, { allow: "GET" });
  }

  try {
    return await proxyOfficial(officialResourceUrl(requestQuery(context.request, "url")));
  } catch (error) {
    return proxyErrorResponse(error);
  }
}
