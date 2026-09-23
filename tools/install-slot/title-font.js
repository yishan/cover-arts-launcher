import { LAUNCHER_GB2312_LEVEL_ONE } from "./title-glyphs.js";

export const LAUNCHER_TITLE_MAX_BYTES = 64;

const encoder = new TextEncoder();
const commonChinese = new Set(LAUNCHER_GB2312_LEVEL_ONE);

export function launcherGlyphSupported(character) {
  const codePoint = character.codePointAt(0);
  return (codePoint >= 0x20 && codePoint <= 0x7e) ||
    (codePoint >= 0x3000 && codePoint <= 0x303f) ||
    (codePoint >= 0xff01 && codePoint <= 0xff5e) ||
    commonChinese.has(character);
}

export function fitLauncherTitle(value) {
  let result = "";
  for (const character of String(value ?? "").trim()) {
    if (encoder.encode(result + character).length > LAUNCHER_TITLE_MAX_BYTES) break;
    result += character;
  }
  return result;
}

export function inspectLauncherTitle(value) {
  const title = String(value ?? "").trim();
  const bytes = encoder.encode(title).length;
  const unsupported = [];
  const seen = new Set();
  for (const character of title) {
    if (!launcherGlyphSupported(character) && !seen.has(character)) {
      seen.add(character);
      unsupported.push({
        character,
        codePoint: `U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`,
      });
    }
  }
  return {
    title,
    bytes,
    empty: !title,
    tooLong: bytes > LAUNCHER_TITLE_MAX_BYTES,
    unsupported,
    valid: Boolean(title) && bytes <= LAUNCHER_TITLE_MAX_BYTES && unsupported.length === 0,
  };
}

export function requireLauncherTitle(value) {
  const result = inspectLauncherTitle(value);
  if (result.empty) throw new Error("标题不能为空。");
  if (result.tooLong) throw new Error(`标题为 ${result.bytes} bytes，设备最多支持 ${LAUNCHER_TITLE_MAX_BYTES} bytes。`);
  if (result.unsupported.length) {
    const glyphs = result.unsupported.map(({ character, codePoint }) => `${character} (${codePoint})`).join("、");
    throw new Error(`标题包含设备字体未收录的字符：${glyphs}`);
  }
  return result.title;
}
