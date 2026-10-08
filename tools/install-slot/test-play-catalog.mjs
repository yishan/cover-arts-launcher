import assert from "node:assert/strict";
import test from "node:test";

import {
  PLAY_CATEGORIES,
  normalizeOfficialCatalog,
  officialPlayCatalogApiPath,
} from "./play-catalog.js";

test("builds a fixed-origin official catalog query for title search and category browsing", () => {
  assert.equal(
    officialPlayCatalogApiPath({ query: "  国旗猜猜看  ", category: "games", limit: 12, offset: 0 }),
    "/api/plays?tag=&bootstrap=true&q=%E5%9B%BD%E6%97%97%E7%8C%9C%E7%8C%9C%E7%9C%8B&category=games&sort=relevance&period=all&limit=12&offset=0",
  );
  assert.equal(
    officialPlayCatalogApiPath({ category: "all", limit: 12, offset: 12 }),
    "/api/plays?tag=&bootstrap=false&q=&category=all&sort=newest&period=all&limit=12&offset=12",
  );
});

test("catalog query rejects unsupported filters and excessive input", () => {
  assert.throws(() => officialPlayCatalogApiPath({ category: "unknown" }), /category/i);
  assert.throws(() => officialPlayCatalogApiPath({ query: "x".repeat(121) }), /120/);
  assert.throws(() => officialPlayCatalogApiPath({ limit: 51 }), /limit/i);
  assert.throws(() => officialPlayCatalogApiPath({ offset: -1 }), /offset/i);
});

test("normalizes official catalog cards without treating author as a search field", () => {
  const catalog = normalizeOfficialCatalog({
    ok: true,
    plays: [{
      id: 702,
      projectId: 702,
      title: { zh: "国旗猜猜看", en: "Flag Match" },
      author: "Yishan",
      category: "games",
      image: "/api/media/plays/flag-match.webp?v=1",
      firmwareSize: 1238288,
    }],
    pagination: { total: 1, hasMore: false },
    categoryCounts: { games: 1, developer: 0 },
  });

  assert.deepEqual(catalog, {
    plays: [{
      playId: "702",
      title: "国旗猜猜看",
      author: "Yishan",
      category: "games",
      categoryLabel: "游戏与互动",
      coverUrl: "/api/media/plays/flag-match.webp?v=1",
      firmwareSize: 1238288,
      detailUrl: "https://ai-passport.folotoy.cn/plays/702/",
    }],
    total: 1,
    hasMore: false,
    categoryCounts: { games: 1, developer: 0 },
  });
  assert.deepEqual(PLAY_CATEGORIES.map(({ key }) => key), [
    "all", "games", "productivity", "information", "learning", "media", "social", "developer",
  ]);
});

test("catalog normalization fails closed on malformed list responses", () => {
  assert.throws(() => normalizeOfficialCatalog({ plays: null }), /invalid/i);
  assert.throws(() => normalizeOfficialCatalog({ plays: [], pagination: { total: -1, hasMore: false } }), /pagination/i);
  assert.throws(() => normalizeOfficialCatalog({
    plays: [{ id: null, title: { zh: "" } }],
    pagination: { total: 1, hasMore: false },
  }), /id|title/i);
});
