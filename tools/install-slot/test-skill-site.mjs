import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("./", import.meta.url);
const [html, css, script, buildScript, sourceSkill, vercelConfig] = await Promise.all([
  readFile(new URL("skills/index.html", root), "utf8"),
  readFile(new URL("skills/skills.css", root), "utf8"),
  readFile(new URL("skills/skills.js", root), "utf8"),
  readFile(new URL("build-skill-site.mjs", root), "utf8"),
  readFile(new URL("../../skills/ai-passport-cover-arts-launcher/SKILL.zh_CN.md", root), "utf8"),
  readFile(new URL("vercel.json", root), "utf8"),
]);

test("Skill page inherits the CALM visual system without replacing the manager", () => {
  assert.match(html, /href="\/styles\.css"/);
  assert.match(html, /href="\/skills\/skills\.css"/);
  assert.match(html, /src="\/skills\/skills\.js"/);
  assert.match(html, /class="brand-mark"[^>]*><span>C<\/span><span>A<\/span><span>L<\/span><span>M<\/span>/);
  assert.match(html, /href="\/favicon\.svg"/);
  assert.match(css, /var\(--signal\)/);
  assert.match(css, /var\(--device\)/);
  assert.doesNotMatch(html, /<style\b/);
});

test("Skill page preserves the cover-only Up Long contract", () => {
  assert.match(html, /接入 Cover-Arts 启动器/);
  assert.match(html, /未接入情况下用户将重启设备再选择其他游戏/);
  assert.match(html, /<h3>可选增强<\/h3>/);
  assert.match(html, /在玩法封面长按上键约 1\.5 秒，即可返回玩法库。/);
  assert.match(html, /不要全局占用 Up Long/);
  assert.doesNotMatch(html, /HARD BOUNDARY|面向玩家的准确文案|player-copy/);
  assert.match(sourceSkill, /只有玩法自己的封面／开始页处于活动状态时才处理 Up Long/);
});

test("Skill page explains the optional integration outcome as step 03", () => {
  assert.match(html, /<span class="step-index"[^>]*>03<\/span>[\s\S]*?<h3 id="outcome-heading">使用 Skill 后会发生什么<\/h3>/);
  assert.match(html, /即使完全不接入，通用玩法仍可被 Cover-Arts Launcher 安装和启动，只是返回 Launcher 需要重启设备或重新上电。/);
  assert.match(html, /Skill 提供的是“封面页快捷返回”，不是安装或启动的兼容资格。/);
  assert.match(html, /Agent 检查按键系统、状态机和已有封面／开始页/);
  assert.match(html, /Skill 不自动授权烧录、commit、push 或发布/);
  assert.match(html, /BEFORE · 通用兼容/);
  assert.match(html, /AFTER · 可选增强/);
  assert.match(html, /APP_STATE_COVER/);
  assert.match(html, /不能硬编码[^<]*<code[^>]*>factory<\/code> 地址，也不能全局监听/);
  assert.match(html, /不改变玩法 UI 风格、游戏规则、分区表、标题封面或存档/);
  assert.match(html, /不增加网络依赖，也不要求 Launcher SDK/);
  assert.match(css, /\.agent-flow\s*\{[^}]*grid-template-columns:\s*repeat\(4,/s);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*\.agent-flow, \.change-grid\s*\{[^}]*grid-template-columns:\s*1fr/s);
});

test("Skill downloads, copy controls, and build source are explicit", async () => {
  for (const path of [
    "/skills/ai-passport-cover-arts-launcher.zip",
    "/skills/ai-passport-cover-arts-launcher/SKILL.md",
    "/skills/ai-passport-cover-arts-launcher/SKILL.zh_CN.md",
    "/skills/ai-passport-cover-arts-launcher/references/protocol.zh_CN.md",
  ]) assert.match(html, new RegExp(`href="${path.replaceAll("/", "\\/")}"`));
  assert.match(html, /id="copy-status"[^>]+role="status"[^>]+aria-live="polite"/);
  assert.match(script, /navigator\.clipboard/);
  assert.match(buildScript, /skills", "ai-passport-cover-arts-launcher/);
  await access(new URL("../../skills/ai-passport-cover-arts-launcher/assets/launcher_contract/launcher_contract.c", root));
});

test("Agent integration prompt prefers the short GitHub command with a ZIP fallback", () => {
  const archiveUrl = "https://calm.yishan.app/skills/ai-passport-cover-arts-launcher.zip";
  const skillUrl = "https://calm.yishan.app/skills/ai-passport-cover-arts-launcher/SKILL.md";
  const installCommand = "npx skills add yishan/ai-passport-cover-arts-launcher -y";
  const fallbackCommand = `npx skills add ${archiveUrl} --skill ai-passport-cover-arts-launcher -y`;
  const prompt = html.match(/<div class="prompt-box" id="integrate-prompt">([\s\S]*?)<\/div>/)?.[1] ?? "";

  assert.ok(prompt.includes(installCommand));
  assert.ok(prompt.includes(fallbackCommand));
  assert.ok(prompt.indexOf(installCommand) < prompt.indexOf(fallbackCommand));
  assert.match(prompt, /当前玩法项目目录/);
  assert.match(prompt, new RegExp(skillUrl.replaceAll("/", "\\/")));
  assert.match(prompt, /安装 Skill 不代表授权烧录、commit、push 或发布/);
  assert.match(html, new RegExp(`href="${skillUrl.replaceAll("/", "\\/")}"`));
  assert.match(html, /href="https:\/\/github\.com\/yishan\/ai-passport-cover-arts-launcher"/);
  assert.match(html, /href="https:\/\/www\.skills\.sh\/yishan\/ai-passport-cover-arts-launcher\/ai-passport-cover-arts-launcher"/);
  assert.doesNotMatch(`${installCommand}\n${fallbackCommand}`, /(?:^|\s)-g(?:\s|$)|--global/);
  assert.doesNotMatch(html, /cover-arts-launcher\.yishan\.app/);
});

test("legacy public domain permanently redirects to CALM", () => {
  const config = JSON.parse(vercelConfig);
  const redirects = config.redirects?.filter((entry) =>
    entry.has?.some((condition) =>
      condition.type === "host" && condition.value === "cover-arts-launcher.yishan.app")) ?? [];
  const rootRedirect = redirects.find((entry) => entry.source === "/");
  const pathRedirect = redirects.find((entry) => entry.source === "/:path*");

  assert.equal(rootRedirect?.destination, "https://calm.yishan.app/");
  assert.equal(rootRedirect?.permanent, true);
  assert.equal(pathRedirect?.destination, "https://calm.yishan.app/:path*");
  assert.equal(pathRedirect?.permanent, true);
});
