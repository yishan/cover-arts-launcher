import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const toolRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(toolRoot, "../..");
const outputRoot = resolve(process.argv[2] ?? join(toolRoot, "dist-skill-site"));
const sourceSkill = join(repositoryRoot, "skills", "ai-passport-cover-arts-launcher");
const skillOutput = join(outputRoot, "skills", "ai-passport-cover-arts-launcher");
const publicFiles = [
  "index.html",
  "app.js",
  "cover-bank.js",
  "cover-convert.js",
  "cover-image.js",
  "device-reset.js",
  "extract-app-image.js",
  "play-source.js",
  "slot-inspector.js",
  "slot-install.js",
  "system-install.js",
  "title-font.js",
  "title-glyphs.js",
  "trust-record.js",
];

await rm(outputRoot, { recursive: true, force: true });
await mkdir(join(outputRoot, "skills"), { recursive: true });
for (const file of publicFiles) {
  await cp(join(toolRoot, file), join(outputRoot, file));
}
await cp(join(toolRoot, "vendor"), join(outputRoot, "vendor"), { recursive: true });
await cp(join(toolRoot, "api"), join(outputRoot, "api"), { recursive: true });
await cp(join(toolRoot, "skills", "index.html"), join(outputRoot, "skills", "index.html"));
await cp(sourceSkill, skillOutput, { recursive: true });

await writeFile(join(outputRoot, "package.json"), `${JSON.stringify({
  private: true,
  type: "module",
}, null, 2)}\n`);

await writeFile(join(outputRoot, "vercel.json"), `${JSON.stringify({
  cleanUrls: true,
  trailingSlash: false,
  rewrites: [{ source: "/skills", destination: "/skills/index.html" }],
}, null, 2)}\n`);

const archive = spawnSync("zip", ["-rq", "ai-passport-cover-arts-launcher.zip", "ai-passport-cover-arts-launcher"], {
  cwd: join(outputRoot, "skills"),
  encoding: "utf8",
});
if (archive.status !== 0) {
  throw new Error(`zip failed: ${archive.stderr || archive.stdout || `exit ${archive.status}`}`);
}

console.log(`Built Play Manager and public Skill site: ${outputRoot}`);
