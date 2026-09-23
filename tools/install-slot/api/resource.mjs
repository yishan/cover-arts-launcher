import { OFFICIAL_PLAY_ORIGIN } from "../play-source.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("allow", "GET");
    return response.status(405).json({ error: "Method not allowed." });
  }

  try {
    const value = Array.isArray(request.query.url) ? request.query.url[0] : request.query.url;
    const target = new URL(value ?? "", OFFICIAL_PLAY_ORIGIN);
    if (target.origin !== OFFICIAL_PLAY_ORIGIN || !target.pathname.startsWith("/api/")) {
      throw new Error("Only official /api/ firmware and image resources are proxied.");
    }

    const upstream = await fetch(target, { redirect: "follow", headers: { accept: "*/*" } });
    const finalUrl = new URL(upstream.url);
    if (finalUrl.origin !== OFFICIAL_PLAY_ORIGIN) {
      throw new Error("Official resource redirected outside the allowed origin.");
    }

    response.setHeader("cache-control", "no-store");
    response.setHeader("access-control-allow-origin", "*");
    response.status(upstream.status);
    response.setHeader("content-type", upstream.headers.get("content-type") ?? "application/octet-stream");
    return response.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    response.setHeader("cache-control", "no-store");
    response.setHeader("access-control-allow-origin", "*");
    return response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
