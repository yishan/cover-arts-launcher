import { OFFICIAL_PLAY_ORIGIN, officialPlayApiPath } from "../../play-source.js";
import { proxyErrorResponse, proxyOfficial, requestQuery } from "../lib/official-proxy.js";

export async function onRequest(context) {
  if (context.request.method !== "GET") {
    return proxyErrorResponse("Method not allowed.", 405, { allow: "GET" });
  }

  try {
    const target = new URL(officialPlayApiPath(requestQuery(context.request, "url")), OFFICIAL_PLAY_ORIGIN);
    return await proxyOfficial(target, { json: true });
  } catch (error) {
    return proxyErrorResponse(error);
  }
}
