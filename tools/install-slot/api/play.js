import { OFFICIAL_PLAY_ORIGIN, officialPlayApiPath } from "../play-source.js";
import { proxyOfficial, requestQuery, sendProxyError } from "../lib/official-proxy.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("allow", "GET");
    sendProxyError(response, "Method not allowed.", 405);
    return;
  }

  try {
    const target = new URL(officialPlayApiPath(requestQuery(request, "url")), OFFICIAL_PLAY_ORIGIN);
    await proxyOfficial(response, target, { json: true });
  } catch (error) {
    sendProxyError(response, error);
  }
}
