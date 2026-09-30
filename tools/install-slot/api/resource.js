import { officialResourceUrl, proxyOfficial, requestQuery, sendProxyError } from "../lib/official-proxy.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("allow", "GET");
    sendProxyError(response, "Method not allowed.", 405);
    return;
  }

  try {
    await proxyOfficial(response, officialResourceUrl(requestQuery(request, "url")));
  } catch (error) {
    sendProxyError(response, error);
  }
}
