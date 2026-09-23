import { OFFICIAL_PLAY_ORIGIN, officialPlayApiPath } from "../play-source.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("allow", "GET");
    return response.status(405).json({ error: "Method not allowed." });
  }

  try {
    const value = Array.isArray(request.query.url) ? request.query.url[0] : request.query.url;
    const target = new URL(officialPlayApiPath(value ?? ""), OFFICIAL_PLAY_ORIGIN);
    const upstream = await fetch(target, {
      redirect: "follow",
      headers: { accept: "application/json" },
    });
    const finalUrl = new URL(upstream.url);
    if (finalUrl.origin !== OFFICIAL_PLAY_ORIGIN) {
      throw new Error("Official play API redirected outside the allowed origin.");
    }

    response.setHeader("cache-control", "no-store");
    response.setHeader("access-control-allow-origin", "*");
    response.status(upstream.status);
    response.setHeader("content-type", "application/json; charset=utf-8");
    return response.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    response.setHeader("cache-control", "no-store");
    response.setHeader("access-control-allow-origin", "*");
    return response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
