import { officialPlayCatalogApiPath } from "../play-catalog.js";
import { OFFICIAL_PLAY_ORIGIN } from "../play-source.js";
import { proxyOfficial, requestQuery, sendProxyError } from "../lib/official-proxy.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("allow", "GET");
    sendProxyError(response, "Method not allowed.", 405);
    return;
  }
  try {
    const target = new URL(officialPlayCatalogApiPath({
      query: requestQuery(request, "q"),
      category: requestQuery(request, "category") || "all",
      limit: requestQuery(request, "limit") || 12,
      offset: requestQuery(request, "offset") || 0,
    }), OFFICIAL_PLAY_ORIGIN);
    await proxyOfficial(response, target, { json: true });
  } catch (error) {
    sendProxyError(response, error);
  }
}
