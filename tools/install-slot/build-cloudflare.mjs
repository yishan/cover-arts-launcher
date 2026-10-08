import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const toolRoot = dirname(fileURLToPath(import.meta.url));
const outputRoot = join(toolRoot, "dist");

const publicFiles = [
  "LICENSE.meta-pass.txt",
  "app.js",
  "cover-bank.js",
  "cover-convert.js",
  "cover-image.js",
  "device-reset.js",
  "dynamic-layout.js",
  "dynamic-sidecar.js",
  "dynamic-slot-inspector.js",
  "extract-app-image.js",
  "favicon.svg",
  "index.html",
  "play-source.js",
  "play-catalog.js",
  "serial-transport.js",
  "slot-inspector.js",
  "slot-install.js",
  "styles.css",
  "system-install.js",
  "title-font.js",
  "title-glyphs.js",
  "trust-record.js",
];

const publicDirectories = ["skills", "vendor"];

const headers = `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), serial=(self)
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'
`;

const redirects = "/skills /skills/index.html 200\n";

const routes = `${JSON.stringify({ version: 1, include: ["/api/*"], exclude: [] }, null, 2)}\n`;

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

for (const file of publicFiles) {
  await cp(join(toolRoot, file), join(outputRoot, file));
}
for (const directory of publicDirectories) {
  await cp(join(toolRoot, directory), join(outputRoot, directory), { recursive: true });
}

await writeFile(join(outputRoot, "_headers"), headers);
await writeFile(join(outputRoot, "_redirects"), redirects);
await writeFile(join(outputRoot, "_routes.json"), routes);

console.log(`Prepared Cloudflare Pages assets in ${outputRoot}`);
