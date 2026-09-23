export const COVER_PREVIEW_MAX_BYTES = 50 * 1024;

export function coverCropRect(width, height, targetWidth = 120, targetHeight = 160) {
  if (![width, height, targetWidth, targetHeight].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error("Cover dimensions must be positive numbers.");
  }
  const sourceRatio = width / height;
  const targetRatio = targetWidth / targetHeight;
  if (sourceRatio > targetRatio) {
    const sw = height * targetRatio;
    return { sx: (width - sw) / 2, sy: 0, sw, sh: height };
  }
  const sh = width / targetRatio;
  return { sx: 0, sy: (height - sh) / 2, sw: width, sh };
}

export function chooseCompressedCover(candidates, maxBytes = COVER_PREVIEW_MAX_BYTES) {
  const candidate = candidates.find((item) => item?.blob?.size <= maxBytes);
  if (!candidate) throw new Error("封面压缩后仍超过 50 KiB，请换一张图片。");
  return candidate;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("浏览器无法编码封面。")), type, quality);
  });
}

export async function encodeCoverPreview(canvas, {
  encode = canvasToBlob,
  maxBytes = COVER_PREVIEW_MAX_BYTES,
} = {}) {
  const candidates = [];
  for (const quality of [0.88, 0.76, 0.64, 0.52]) {
    const blob = await encode(canvas, "image/webp", quality);
    const candidate = { blob, quality };
    candidates.push(candidate);
    if (blob.size <= maxBytes) return candidate;
  }
  return chooseCompressedCover(candidates, maxBytes);
}
