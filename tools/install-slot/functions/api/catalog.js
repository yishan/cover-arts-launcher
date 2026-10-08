import { officialPlayCatalogApiPath } from "../../play-catalog.js";
import { OFFICIAL_PLAY_ORIGIN } from "../../play-source.js";
import { proxyErrorResponse, proxyOfficial, requestQuery } from "../lib/official-proxy.js";

export async function onRequest(context) {
  if (context.request.method !== "GET") {
    return proxyErrorResponse("Method not allowed.", 405, { allow: "GET" });
  }
  try {
    const target = new URL(officialPlayCatalogApiPath({
      query: requestQuery(context.request, "q"),
      category: requestQuery(context.request, "category") || "all",
      limit: requestQuery(context.request, "limit") || 12,
      offset: requestQuery(context.request, "offset") || 0,
    }), OFFICIAL_PLAY_ORIGIN);
    return await proxyOfficial(target, { json: true });
  } catch (error) {
    return proxyErrorResponse(error);
  }
}
