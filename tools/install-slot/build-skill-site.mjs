import { cp, mkdir, readdir, rm, utimes } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const toolRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(toolRoot, "../..");
const sourceSkill = join(repositoryRoot, "skills", "ai-passport-cover-arts-launcher");
const publicSkillsRoot = join(toolRoot, "skills");
const publicSkill = join(publicSkillsRoot, "ai-passport-cover-arts-launcher");
const archiveName = "ai-passport-cover-arts-launcher.zip";
const archiveTimestamp = new Date("2000-01-01T00:00:00.000Z");

async function normalizeTimestamps(path) {
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) await normalizeTimestamps(child);
    else await utimes(child, archiveTimestamp, archiveTimestamp);
  }
  await utimes(path, archiveTimestamp, archiveTimestamp);
}

await mkdir(publicSkillsRoot, { recursive: true });
await rm(publicSkill, { recursive: true, force: true });
await rm(join(publicSkillsRoot, archiveName), { force: true });
await cp(sourceSkill, publicSkill, { recursive: true });
await normalizeTimestamps(publicSkill);

const archive = spawnSync("zip", ["-rqX", archiveName, "ai-passport-cover-arts-launcher"], {
  cwd: publicSkillsRoot,
  encoding: "utf8",
});
if (archive.status !== 0) {
  throw new Error(`zip failed: ${archive.stderr || archive.stdout || `exit ${archive.status}`}`);
}

console.log(`Synced public Skill and ZIP from ${sourceSkill}`);
