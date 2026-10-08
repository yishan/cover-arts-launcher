import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { OFFICIAL_PLAY_ORIGIN, officialPlayApiPath } from "./play-source.js";
import { officialPlayCatalogApiPath } from "./play-catalog.js";
import { officialResourceUrl, proxyOfficial } from "./lib/official-proxy.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number.parseInt(process.env.PORT ?? "4173", 10);
const officialOrigin = OFFICIAL_PLAY_ORIGIN;
const types = new Map([
  [".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"], [".css", "text/css; charset=utf-8"],
  [".bin", "application/octet-stream"], [".webp", "image/webp"],
  [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml"], [".md", "text/markdown; charset=utf-8"],
  [".yaml", "text/yaml; charset=utf-8"], [".zip", "application/zip"],
]);

function playApiUrl(value) {
  return new URL(officialPlayApiPath(value), officialOrigin);
}

async function handle(request, response) {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  try {
    if (requestUrl.pathname === "/api/play") {
      await proxyOfficial(response, playApiUrl(requestUrl.searchParams.get("url") ?? ""), { json: true });
      return;
    }
    if (requestUrl.pathname === "/api/catalog") {
      if (request.method !== "GET") {
        response.writeHead(405, { allow: "GET", "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "Method not allowed." }));
        return;
      }
      const target = new URL(officialPlayCatalogApiPath({
        query: requestUrl.searchParams.get("q") ?? "",
        category: requestUrl.searchParams.get("category") ?? "all",
        limit: requestUrl.searchParams.get("limit") ?? 12,
        offset: requestUrl.searchParams.get("offset") ?? 0,
      }), officialOrigin);
      await proxyOfficial(response, target, { json: true });
      return;
    }
    if (requestUrl.pathname === "/api/resource") {
      await proxyOfficial(response, officialResourceUrl(requestUrl.searchParams.get("url") ?? ""));
      return;
    }
    const pathname = requestUrl.pathname === "/"
      ? "/index.html"
      : requestUrl.pathname === "/skills" || requestUrl.pathname === "/skills/"
        ? "/skills/index.html"
        : decodeURIComponent(requestUrl.pathname);
    const localPath = normalize(join(root, pathname));
    if (!localPath.startsWith(root)) throw new Error("Invalid path.");
    const info = await stat(localPath);
    if (!info.isFile()) throw new Error("Not a file.");
    response.writeHead(200, {
      "content-type": types.get(extname(localPath)) ?? "application/octet-stream",
      "content-length": info.size,
      "cache-control": "no-store",
    });
    createReadStream(localPath).pipe(response);
  } catch (error) {
    const status = error?.code === "ENOENT" ? 404 : 400;
    const apiRequest = requestUrl.pathname.startsWith("/api/");
    response.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(apiRequest ? { "access-control-allow-origin": "*" } : {}),
    });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
}

createServer(handle).listen(port, "127.0.0.1", () => {
  console.log(`Play Manager: http://127.0.0.1:${port}`);
});
