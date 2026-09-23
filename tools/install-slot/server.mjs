import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OFFICIAL_PLAY_ORIGIN, officialPlayApiPath } from "./play-source.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = resolve(root, "../..");
const publicSkillRoot = join(repositoryRoot, "skills", "ai-passport-cover-arts-launcher");
const builtSiteRoot = join(root, "dist-skill-site");
const port = Number.parseInt(process.env.PORT ?? "4173", 10);
const officialOrigin = OFFICIAL_PLAY_ORIGIN;
const types = new Map([
  [".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"], [".css", "text/css; charset=utf-8"],
  [".bin", "application/octet-stream"], [".webp", "image/webp"],
  [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml"], [".md", "text/markdown; charset=utf-8"],
  [".yaml", "text/yaml; charset=utf-8"], [".yml", "text/yaml; charset=utf-8"],
  [".c", "text/plain; charset=utf-8"], [".h", "text/plain; charset=utf-8"],
  [".zip", "application/zip"],
]);

function containedPath(base, requestedPath) {
  const target = resolve(base, `.${requestedPath}`);
  const remainder = relative(base, target);
  if (remainder.startsWith("..") || remainder === "..") throw new Error("Invalid path.");
  return target;
}

function localStaticPath(pathname) {
  if (pathname === "/skills" || pathname === "/skills/") {
    return join(root, "skills", "index.html");
  }
  const skillPrefix = "/skills/ai-passport-cover-arts-launcher/";
  if (pathname.startsWith(skillPrefix)) {
    return containedPath(publicSkillRoot, pathname.slice(skillPrefix.length - 1));
  }
  if (pathname === "/skills/ai-passport-cover-arts-launcher.zip") {
    return join(builtSiteRoot, "skills", "ai-passport-cover-arts-launcher.zip");
  }
  return containedPath(root, pathname);
}

function playApiUrl(value) {
  return new URL(officialPlayApiPath(value), officialOrigin);
}

function officialResourceUrl(value) {
  const target = new URL(value, officialOrigin);
  if (target.origin !== officialOrigin || !target.pathname.startsWith("/api/")) {
    throw new Error("Only official /api/ firmware and image resources are proxied.");
  }
  return target;
}

async function proxy(response, target, { json = false } = {}) {
  const upstream = await fetch(target, { redirect: "follow", headers: { accept: json ? "application/json" : "*/*" } });
  const finalUrl = new URL(upstream.url);
  if (finalUrl.origin !== officialOrigin) throw new Error("Official resource redirected outside the allowed origin.");
  if (!upstream.ok) {
    response.writeHead(upstream.status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" });
    response.end(JSON.stringify({ error: `Official service returned HTTP ${upstream.status}.` }));
    return;
  }
  const headers = {
    "content-type": json ? "application/json; charset=utf-8" : (upstream.headers.get("content-type") ?? "application/octet-stream"),
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  };
  const contentLength = upstream.headers.get("content-length");
  if (contentLength) headers["content-length"] = contentLength;
  response.writeHead(200, headers);
  response.end(Buffer.from(await upstream.arrayBuffer()));
}

async function handle(request, response) {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  try {
    if (requestUrl.pathname === "/api/play") {
      await proxy(response, playApiUrl(requestUrl.searchParams.get("url") ?? ""), { json: true });
      return;
    }
    if (requestUrl.pathname === "/api/resource") {
      await proxy(response, officialResourceUrl(requestUrl.searchParams.get("url") ?? ""));
      return;
    }
    const pathname = requestUrl.pathname === "/" ? "/index.html" : decodeURIComponent(requestUrl.pathname);
    const localPath = localStaticPath(pathname);
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
