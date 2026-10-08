import { OFFICIAL_PLAY_ORIGIN } from "./play-source.js";

export const PLAY_CATEGORIES = Object.freeze([
  Object.freeze({ key: "all", label: "全部玩法" }),
  Object.freeze({ key: "games", label: "游戏与互动" }),
  Object.freeze({ key: "productivity", label: "效率与工具" }),
  Object.freeze({ key: "information", label: "信息与展示" }),
  Object.freeze({ key: "learning", label: "学习与创作" }),
  Object.freeze({ key: "media", label: "音乐与影像" }),
  Object.freeze({ key: "social", label: "活动与社交" }),
  Object.freeze({ key: "developer", label: "开发者实验" }),
]);

const categoryByKey = new Map(PLAY_CATEGORIES.map((category) => [category.key, category]));

function integerInRange(value, name, minimum, maximum) {
  const number = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new Error(`Catalog ${name} must be between ${minimum} and ${maximum}.`);
  }
  return number;
}

function localized(value) {
  if (typeof value === "string") return value.trim();
  return String(value?.zh ?? value?.en ?? "").trim();
}

export function officialPlayCatalogApiPath({ query = "", category = "all", limit = 12, offset = 0 } = {}) {
  query = String(query ?? "").trim();
  if (query.length > 120) throw new Error("Catalog query must not exceed 120 characters.");
  category = String(category ?? "all").trim().toLowerCase();
  if (!categoryByKey.has(category)) throw new Error("Catalog category is not supported.");
  limit = integerInRange(limit, "limit", 1, 50);
  offset = integerInRange(offset, "offset", 0, 100000);
  const parameters = new URLSearchParams({
    tag: "",
    bootstrap: String(offset === 0),
    q: query,
    category,
    sort: query ? "relevance" : "newest",
    period: "all",
    limit: String(limit),
    offset: String(offset),
  });
  return `/api/plays?${parameters}`;
}

export function normalizeOfficialCatalog(payload) {
  if (!payload || !Array.isArray(payload.plays)) throw new Error("Official catalog response is invalid.");
  const total = payload.pagination?.total;
  const hasMore = payload.pagination?.hasMore;
  if (!Number.isSafeInteger(total) || total < 0 || typeof hasMore !== "boolean") {
    throw new Error("Official catalog pagination is invalid.");
  }
  const plays = payload.plays.map((play) => {
    const playId = String(play?.projectId ?? play?.id ?? "").trim();
    const title = localized(play?.title);
    if (!/^\d+$/.test(playId)) throw new Error("Official catalog play id is invalid.");
    if (!title) throw new Error(`Official catalog play ${playId} title is invalid.`);
    const category = categoryByKey.has(play.categoryKey ?? play.category)
      ? (play.categoryKey ?? play.category)
      : "developer";
    const firmwareSize = Number.isSafeInteger(play.firmwareSize) && play.firmwareSize >= 0
      ? play.firmwareSize
      : 0;
    return {
      playId,
      title,
      author: String(play.author ?? play.authorProfile?.name ?? "未知作者").trim() || "未知作者",
      category,
      categoryLabel: categoryByKey.get(category).label,
      coverUrl: String(play.image ?? play.thumbnail ?? "").trim(),
      firmwareSize,
      detailUrl: `${OFFICIAL_PLAY_ORIGIN}/plays/${playId}/`,
    };
  });
  const categoryCounts = {};
  if (payload.categoryCounts && typeof payload.categoryCounts === "object") {
    for (const category of PLAY_CATEGORIES.slice(1)) {
      const count = payload.categoryCounts[category.key];
      if (Number.isSafeInteger(count) && count >= 0) categoryCounts[category.key] = count;
    }
  }
  return { plays, total, hasMore, categoryCounts };
}
