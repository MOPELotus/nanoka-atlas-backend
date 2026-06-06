import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

let fatalReported = false;
let processedPageGroups = 0;
let processedAuditRows = 0;
let totalPageGroups = 0;
let totalAuditRows = 0;
let lastProgressAt = Date.now();

process.on("unhandledRejection", reportFatal);
process.on("uncaughtException", reportFatal);
process.on("SIGINT", () => reportSignal("SIGINT"));
process.on("SIGTERM", () => reportSignal("SIGTERM"));
process.on("exit", (code) => {
  if (code !== 0 && !fatalReported) {
    console.error(`page image audit exited with code ${code} before reporting a fatal error`);
  }
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const staticBase = "https://static.nanoka.cc";
const inputPath = path.join(rootDir, "data", "audits", "missing-images.zh.json");
const outputDir = path.join(rootDir, "data", "audits");
const outputPath = path.join(outputDir, "page-image-link-audit.json");
const markdownPath = path.join(outputDir, "page-image-link-audit.zh.md");

const options = parseArgs(process.argv.slice(2));
const requestTimeoutMs = readIntegerEnv("PAGE_AUDIT_TIMEOUT_MS", 60000, 1);
const requestRetries = readIntegerEnv("PAGE_AUDIT_RETRIES", readIntegerEnv("REQUEST_RETRIES", 4, 0), 0);
const progressIntervalMs = readIntegerEnv("PAGE_AUDIT_PROGRESS_INTERVAL_MS", 30000, 0);
const maxConcurrent = Number(process.env.PAGE_AUDIT_CONCURRENCY ?? 8);

const input = JSON.parse(await readFile(inputPath, "utf8"));
const rows = (input.rows ?? [])
  .filter((row) => !options.games.size || options.games.has(row.gameId))
  .filter((row) => !options.pages.size || options.pages.has(row.pageId))
  .slice(0, options.limit ?? undefined);

const pageGroups = new Map();
for (const row of rows) {
  const route = pageRoute(row);
  if (!route) {
    continue;
  }
  const key = `${row.gameId}\t${route}`;
  if (!pageGroups.has(key)) {
    pageGroups.set(key, {
      key,
      gameId: row.gameId,
      route,
      representativeUrl: buildPageUrl(row, route),
      html: null,
      fetched: null
    });
  }
}
totalPageGroups = pageGroups.size;
totalAuditRows = rows.length;

await runPool([...pageGroups.values()], maxConcurrent, async (group) => {
  group.fetched = await fetchHtml(group.representativeUrl);
  group.html = group.fetched.ok ? group.fetched.text : "";
  processedPageGroups += 1;
  maybePrintProgress();
});

const exactPageCache = new Map();
const checkCache = new Map();
const itemCache = new Map();

const auditRows = [];
await runPool(rows, maxConcurrent, async (row) => {
  const route = pageRoute(row);
  const pageUrl = route ? buildPageUrl(row, route) : null;
  const group = route ? pageGroups.get(`${row.gameId}\t${route}`) : null;
  let html = group?.html ?? "";
  let htmlSourceUrl = group?.representativeUrl ?? null;
  let htmlFetch = group?.fetched ?? null;
  let originalValueFound = htmlIncludes(html, row.originalValue);

  if (pageUrl && options.exactPages && !originalValueFound) {
    const exact = await cachedFetchHtml(pageUrl, exactPageCache);
    html = exact.ok ? exact.text : "";
    htmlSourceUrl = pageUrl;
    htmlFetch = exact;
    originalValueFound = htmlIncludes(html, row.originalValue);
  }

  const localRecordPaths = await localItemImagePaths(row, itemCache);
  const contexts = html ? contextSnippets(html, [row.originalValue, row.imageFile, row.name, String(row.recordId)], 2500) : [];
  const htmlContextPaths = uniqueBy(contexts.flatMap((snippet) => extractImageLikePaths(snippet).map((rawPath) => ({
    rawPath,
    source: "page-html-context",
    fieldPath: null
  }))), (item) => `${item.source}\t${item.rawPath}`);
  const rawPathItems = (localRecordPaths.length ? localRecordPaths : htmlContextPaths).slice(0, 120);
  const candidateSources = [];

  for (const item of rawPathItems) {
    for (const url of buildImageCandidates(row.gameId, row.pageId, item.rawPath, String(row.recordId), row.fieldPath)) {
      candidateSources.push({ ...item, url });
    }
  }

  const dedupedCandidates = dedupeCandidateSources(candidateSources)
    .filter((item) => !(row.candidates ?? []).includes(item.url))
    .slice(0, 240);

  const hits = [];
  await runPool(dedupedCandidates, 12, async (candidate) => {
    const result = await checkImageUrl(candidate.url, checkCache);
    if (result.ok) {
      hits.push({ ...candidate, ...result });
    }
  });
  const sortedHits = hits.sort((a, b) => a.url.localeCompare(b.url));
  const replacementHits = sortedHits.filter((hit) => isLikelyReplacement(row, hit));

  auditRows.push({
    gameId: row.gameId,
    game: row.game,
    pageId: row.pageId,
    page: row.page,
    recordId: row.recordId,
    name: row.name,
    fieldPath: row.fieldPath,
    field: row.field,
    originalValue: row.originalValue,
    imageFile: row.imageFile,
    imageDir: row.imageDir,
    refs: row.refs,
    itemPath: row.itemPath,
    pageUrl,
    htmlSourceUrl,
    htmlStatus: htmlFetch?.status ?? null,
    htmlOk: Boolean(htmlFetch?.ok),
    originalValueFound,
    rawPathSource: localRecordPaths.length ? "local-item-json" : "page-html-context",
    rawPathCount: rawPathItems.length,
    rawPaths: rawPathItems.slice(0, 40),
    checkedCandidateCount: dedupedCandidates.length,
    hitCount: hits.length,
    likelyReplacementHitCount: replacementHits.length,
    likelyReplacementHits: replacementHits.slice(0, 20),
    hits: sortedHits.slice(0, 40)
  });
  processedAuditRows += 1;
  maybePrintProgress();
});

auditRows.sort((a, b) => {
  if (b.hitCount !== a.hitCount) return b.hitCount - a.hitCount;
  return `${a.gameId}/${a.pageId}/${a.recordId}/${a.fieldPath}`.localeCompare(`${b.gameId}/${b.pageId}/${b.recordId}/${b.fieldPath}`);
});

const report = {
  generatedAt: new Date().toISOString(),
  source: path.relative(rootDir, inputPath).replace(/\\/g, "/"),
  options: {
    games: [...options.games],
    pages: [...options.pages],
    limit: options.limit,
    exactPages: options.exactPages
  },
  summary: {
    inputRows: rows.length,
    pageGroups: pageGroups.size,
    rowsWithPageUrl: auditRows.filter((row) => row.pageUrl).length,
    htmlOkRows: auditRows.filter((row) => row.htmlOk).length,
    originalValueFoundRows: auditRows.filter((row) => row.originalValueFound).length,
    rowsWithHits: auditRows.filter((row) => row.hitCount > 0).length,
    rowsWithLikelyReplacementHits: auditRows.filter((row) => row.likelyReplacementHitCount > 0).length,
    hitUrls: unique(auditRows.flatMap((row) => row.hits.map((hit) => hit.url))).length
  },
  rows: auditRows
};

await mkdir(outputDir, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(markdownPath, renderMarkdown(report), "utf8");

console.log(`input rows: ${report.summary.inputRows}`);
console.log(`page groups: ${report.summary.pageGroups}`);
console.log(`html ok rows: ${report.summary.htmlOkRows}`);
console.log(`original value found rows: ${report.summary.originalValueFoundRows}`);
console.log(`rows with page-derived hits: ${report.summary.rowsWithHits}`);
console.log(`rows with likely replacement hits: ${report.summary.rowsWithLikelyReplacementHits}`);
console.log(`hit urls: ${report.summary.hitUrls}`);
console.log(`report: ${path.relative(rootDir, outputPath)}`);
console.log(`markdown: ${path.relative(rootDir, markdownPath)}`);

function parseArgs(argv) {
  const parsed = {
    exactPages: false,
    games: new Set(),
    limit: null,
    pages: new Set()
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const readValue = () => {
      if (arg.includes("=")) {
        return arg.slice(arg.indexOf("=") + 1);
      }
      index += 1;
      return argv[index] ?? "";
    };

    if (arg === "--exact-pages") {
      parsed.exactPages = true;
    } else if (arg === "--game" || arg.startsWith("--game=")) {
      for (const gameId of readValue().split(",")) {
        if (gameId.trim()) parsed.games.add(gameId.trim());
      }
    } else if (arg === "--page" || arg.startsWith("--page=")) {
      for (const pageId of readValue().split(",")) {
        if (pageId.trim()) parsed.pages.add(pageId.trim());
      }
    } else if (arg === "--limit" || arg.startsWith("--limit=")) {
      const limit = Number(readValue());
      if (!Number.isInteger(limit) || limit < 1) {
        throw new Error(`Invalid --limit: ${limit}`);
      }
      parsed.limit = limit;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function pageRoute(row) {
  const pageId = row.pageId;
  const routes = {
    hsr: {
      item_all: "item",
      "currency/role": "currency/role",
      maze_boss: "boss",
      maze_peak: "peak",
      maze_extra: "story"
    },
    gi: {
      item_all: "item",
      "beyond/item_all": "beyond/item",
      "gcg/card": "gcg"
    },
    zzz: {
      item_all: "item"
    },
    nte: {}
  };

  if (routes[row.gameId]?.[pageId]) {
    return routes[row.gameId][pageId];
  }

  if (/\/(?:version|achievement|keyword|skill)$/i.test(pageId)) {
    return null;
  }

  return pageId;
}

function buildPageUrl(row, route) {
  const host = {
    hsr: "https://hsr.nanoka.cc",
    gi: "https://gi.nanoka.cc",
    zzz: "https://zzz.nanoka.cc",
    nte: "https://nte.nanoka.cc"
  }[row.gameId];
  if (!host || !route || row.recordId == null) {
    return null;
  }
  return `${host}/${route}/${encodeURIComponent(String(row.recordId))}`;
}

async function cachedFetchHtml(url, cache) {
  if (!cache.has(url)) {
    cache.set(url, fetchHtml(url));
  }
  return cache.get(url);
}

async function fetchHtml(url) {
  try {
    const response = await fetchWithRetry(url, { headers: { accept: "text/html,*/*" } });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url,
      bytes: Buffer.byteLength(text),
      text
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      finalUrl: url,
      bytes: 0,
      text: "",
      error: error.message
    };
  }
}

function htmlIncludes(html, value) {
  const text = String(value ?? "").trim();
  if (!text) return false;
  return html.includes(text) || html.includes(text.replaceAll("/", "\\/"));
}

function contextSnippets(html, needles, radius) {
  const snippets = [];
  const seen = new Set();
  for (const needle of needles) {
    const text = String(needle ?? "").trim();
    if (!text || text.length < 2) {
      continue;
    }
    const variants = unique([text, text.replaceAll("/", "\\/")]);
    for (const variant of variants) {
      let start = 0;
      let found = 0;
      while (found < 5) {
        const index = html.indexOf(variant, start);
        if (index < 0) {
          break;
        }
        const from = Math.max(0, index - radius);
        const to = Math.min(html.length, index + variant.length + radius);
        const key = `${from}:${to}`;
        if (!seen.has(key)) {
          snippets.push(html.slice(from, to));
          seen.add(key);
        }
        start = index + variant.length;
        found += 1;
      }
    }
  }
  return snippets;
}

function extractImageLikePaths(text) {
  const unescaped = text
    .replaceAll("\\u002F", "/")
    .replaceAll("\\/", "/")
    .replaceAll("\\u003A", ":")
    .replaceAll("&quot;", '"');
  const matches = [
    ...unescaped.matchAll(/https?:\/\/static\.nanoka\.cc\/assets\/[A-Za-z0-9_.~:/?#[\]@!$&'()*+,;=%-]+/g),
    ...unescaped.matchAll(/(?:SpriteOutput|Assets|Game|UI)[A-Za-z0-9_. /-]*?\.(?:png|webp|jpg|jpeg|avif)/gi),
    ...unescaped.matchAll(/\b[A-Za-z0-9][A-Za-z0-9_.-]*\.(?:png|webp|jpg|jpeg|avif)\b/gi)
  ];
  return unique(matches.map((match) => cleanupRawPath(match[0])).filter(Boolean));
}

async function localItemImagePaths(row, cache) {
  if (!row.itemPath) {
    return [];
  }
  const fullPath = path.join(rootDir, "data", row.itemPath);
  if (!cache.has(fullPath)) {
    cache.set(fullPath, readLocalItem(fullPath));
  }
  const item = await cache.get(fullPath);
  if (!item) {
    return [];
  }
  return uniqueBy(extractImageLikePathsFromObject(item.content ?? item), (entry) => `${entry.fieldPath}\t${entry.rawPath}`).map((entry) => ({
    ...entry,
    source: "local-item-json"
  }));
}

async function readLocalItem(fullPath) {
  try {
    return JSON.parse(await readFile(fullPath, "utf8"));
  } catch {
    return null;
  }
}

function extractImageLikePathsFromObject(value, pathParts = []) {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => extractImageLikePathsFromObject(item, [...pathParts, String(index)]));
  }
  if (!value || typeof value !== "object") {
    return [];
  }

  const output = [];
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...pathParts, key];
    if (typeof child === "string" && looksLikeImageValue(key, child)) {
      output.push({
        fieldPath: childPath.join("."),
        rawPath: child
      });
    }
    output.push(...extractImageLikePathsFromObject(child, childPath));
  }
  return output;
}

function looksLikeImageValue(key, value) {
  const cleanKey = String(key).toLowerCase();
  const cleanValue = String(value).trim();
  if (!cleanValue || /\{[^}]*}/.test(cleanValue)) {
    return false;
  }
  if (/^(icon|image|picture|thumbnail|avatar|portrait|figure)$/.test(cleanKey)) {
    return true;
  }
  if (/(^|_)(icon|image|picture|thumbnail|avatar|portrait|figure)($|_)/.test(cleanKey)) {
    return true;
  }
  return /\.(png|webp|jpg|jpeg|avif)$/i.test(cleanValue);
}

function isLikelyReplacement(row, hit) {
  const rowField = String(row.fieldPath ?? "").replace(/^detail\./, "");
  const hitField = String(hit.fieldPath ?? "").replace(/^detail\./, "");
  const rowBase = basenameNoExt(row.originalValue);
  const hitBase = basenameNoExt(hit.rawPath);
  if (row.originalValue === hit.rawPath || (rowBase && rowBase === hitBase)) {
    return true;
  }
  if (row.gameId === "hsr" && ["item", "item_all"].includes(row.pageId)) {
    if (/(^|\.)item_(?:icon|currency_icon)_path$/i.test(rowField) && /(^|\.)item_figure_icon_path$/i.test(hitField)) {
      return true;
    }
    if (/(^|\.)item_currency_icon_path$/i.test(rowField) && /(^|\.)item_icon_path$/i.test(hitField) && /^\d+$/.test(rowBase) && /^\d{6,}$/.test(hitBase)) {
      return true;
    }
  }
  return false;
}

function cleanupRawPath(value) {
  return String(value)
    .replace(/^["'`]+|["'`,;:]+$/g, "")
    .replace(/\\+$/g, "")
    .trim();
}

function buildImageCandidates(gameId, pageKey, rawValue, recordId, fieldPath) {
  const value = String(rawValue ?? "").trim();
  if (!value) return [];
  if (/^https?:\/\//i.test(value)) return [value];

  const assetBase = `${staticBase}/assets/${gameId}`;
  const stripped = stripImageExt(value.replace(/^\/+/, ""));
  const baseName = basenameNoExt(value);
  const candidates = [];
  const add = (url) => {
    if (url && !candidates.includes(url)) candidates.push(url);
  };

  if (gameId === "hsr") {
    const normalized = value.replace(/\\/g, "/");
    const parts = stripped.split("/").filter(Boolean);
    const file = parts.at(-1) ?? baseName;
    const folder = parts.at(-2);
    if (/ItemFigures/i.test(value) && file) add(`${assetBase}/itemfigures/${file}.webp`);
    if (/SpriteOutput\/ItemIcon\//i.test(normalized) && file) add(`${assetBase}/itemfigures/${file}.webp`);
    if (/SpriteOutput\/ItemCurrency\//i.test(normalized) && file) add(`${assetBase}/itemfigures/${file}.webp`);
    if (/SpriteOutput\/TravelBrochure\/(?:StickFigures|StickIcons)\//i.test(normalized) && file) add(`${assetBase}/itemfigures/${file}.webp`);
    if (/SpriteOutput\/SkillIcons\/Avatar\//i.test(normalized) && file) {
      add(`${assetBase}/skillicons/${file}.webp`);
      const match = file.match(/^SkillIcon_(\d+)(_.+)$/);
      if (match) {
        const id = Number(match[1]);
        if (Number.isFinite(id) && id > 10000) add(`${assetBase}/skillicons/SkillIcon_${id - 10000}${match[2]}.webp`);
      }
    }
    if (/^SkillIcon_/i.test(baseName)) add(`${assetBase}/skillicons/${baseName}.webp`);
    if (/MonsterFigure|SpriteOutput\/BattleEventIcon\//i.test(normalized) && file) add(`${assetBase}/monsterfigure/${file}.webp`);
    if (/SpriteOutput\/GridFight\/AugmentBig\//i.test(normalized) && file) add(`${assetBase}/gridfight/augmentbig/${file}.webp`);
    if (/SpriteOutput\/GridFight\/Portal\//i.test(normalized) && file) add(`${assetBase}/gridfight/portal/${file}.webp`);
    if (/SpriteOutput\/GridFight\/(?:GridItem|Equipment)\//i.test(normalized) && file) add(`${assetBase}/gridfight/equipment/${file}.webp`);
    if (/SpriteOutput\/GridFight\/TraitIcon\/(?:Icon|MiniIcon)\//i.test(normalized) && file) {
      add(`${assetBase}/gridfight/icon/${file}.webp`);
      add(`${assetBase}/gridfight/icon/${file.replace(/S$/i, "")}.webp`);
    }
    if (folder && file) add(`${assetBase}/${folder.toLowerCase()}/${file}.webp`);
    add(`${assetBase}/${stripped}.webp`);
    add(`${assetBase}/${baseName}.webp`);
    return candidates;
  }

  if (gameId === "gi") {
    add(`${assetBase}/${baseName}.webp`);
    const avatarCardMatch = baseName.match(/^UI_AvatarIcon_(.+)_Card$/);
    if (avatarCardMatch) add(`${assetBase}/UI_AvatarIcon_${avatarCardMatch[1]}.webp`);
    const nameCardMatch = baseName.match(/^UI_NameCardIcon_(.+)$/);
    if (nameCardMatch) {
      add(`${assetBase}/UI_NameCardPic_${nameCardMatch[1]}_P.webp`);
      add(`${assetBase}/UI_NameCardPic_${nameCardMatch[1]}_Alpha.webp`);
    }
    if (baseName.startsWith("Gcg_")) add(`${assetBase}/UI_${baseName}.webp`);
    add(`${assetBase}/${stripped}.webp`);
    if (/^UI_ItemIcon_(\d+)/.test(baseName)) {
      const id = baseName.match(/^UI_ItemIcon_(\d+)/)?.[1];
      add(`${assetBase}/ItemIcon_${id}.webp`);
      add(`${assetBase}/${id}.webp`);
    }
    for (const suffix of ["_Lods", "_Vo", "_HD", "_Tex", "_LOD"]) {
      if (baseName.endsWith(suffix)) add(`${assetBase}/${baseName.slice(0, -suffix.length)}.webp`);
    }
    return candidates;
  }

  if (gameId === "zzz") {
    if (pageKey === "character" && /(?:^|\.)potential_detail\.\d+\.image$/i.test(fieldPath)) {
      const awakenBg = baseName.startsWith("AvatarSpecialAwakenBg_") ? baseName : `AvatarSpecialAwakenBg_${baseName}`;
      add(`${assetBase}/${awakenBg}.webp`);
    }
    add(`${assetBase}/${baseName}.webp`);
    if (baseName.startsWith("IconMonster_")) add(`${assetBase}/${baseName.replace(/^IconMonster_/, "Monster_")}.webp`);
    add(`${assetBase}/${stripped}.webp`);
    for (const folder of [
      "itemicon",
      "itemiconsmall",
      "iconsuit",
      "playeraccessory",
      "playersaccessory",
      "hollow/iconbuff",
      "hollow/iconcard",
      "iconbuff",
      "iconcard",
      "bosscard",
      "bosscardlv01",
      "bosscardlv02",
      "bosscardlv03",
      "monster"
    ]) {
      add(`${assetBase}/${folder}/${baseName}.webp`);
    }
    return candidates;
  }

  if (gameId === "nte") {
    add(`${assetBase}/${stripped}.webp`);
    add(`${assetBase}/${baseName}.webp`);
  }

  return candidates;
}

async function checkImageUrl(url, cache) {
  if (cache.has(url)) {
    return cache.get(url);
  }
  const promise = (async () => {
    try {
      let response = await fetchWithRetry(url, { method: "HEAD" });
      let contentType = response.headers.get("content-type") ?? "";
      if (response.status === 405 || (response.ok && !contentType.startsWith("image/"))) {
        response = await fetchWithRetry(url, { headers: { range: "bytes=0-0" } });
        contentType = response.headers.get("content-type") ?? "";
      }
      return {
        ok: response.ok && contentType.startsWith("image/"),
        status: response.status,
        contentType,
        bytes: Number(response.headers.get("content-length") ?? 0) || null
      };
    } catch (error) {
      return {
        ok: false,
        status: null,
        contentType: null,
        bytes: null,
        error: error.message
      };
    }
  })();
  cache.set(url, promise);
  const result = await promise;
  cache.set(url, result);
  return result;
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWithRetry(url, init = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= requestRetries; attempt += 1) {
    try {
      return await fetchWithTimeout(url, init);
    } catch (error) {
      lastError = error;
      if (attempt >= requestRetries) {
        break;
      }
      await sleep(Math.min(10000, 1000 * (attempt + 1)));
    }
  }
  throw lastError;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runPool(items, limit, worker) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await worker(item);
    }
  });
  await Promise.all(workers);
}

function dedupeCandidateSources(items) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    output.push(item);
  }
  return output;
}

function unique(values) {
  return [...new Set(values.filter((value) => value != null && String(value).trim()))];
}

function uniqueBy(values, keyFn) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const key = keyFn(value);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output;
}

function readIntegerEnv(name, fallback, min) {
  const raw = process.env[name];
  if (raw == null || raw === "") {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${name} must be an integer >= ${min}.`);
  }
  return value;
}

function reportFatal(error) {
  fatalReported = true;
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
}

function reportSignal(signal) {
  fatalReported = true;
  console.error(
    `page image audit interrupted by ${signal}: ${processedPageGroups}/${totalPageGroups} page groups, ${processedAuditRows}/${totalAuditRows} rows`
  );
  process.exit(1);
}

function maybePrintProgress() {
  if (!progressIntervalMs) {
    return;
  }
  const now = Date.now();
  if (now - lastProgressAt < progressIntervalMs) {
    return;
  }
  lastProgressAt = now;
  console.log(`progress: ${processedPageGroups}/${totalPageGroups} page groups, ${processedAuditRows}/${totalAuditRows} rows`);
}

function basenameNoExt(value) {
  return stripImageExt(String(value).replace(/\\/g, "/").split("/").pop() ?? "");
}

function stripImageExt(value) {
  return String(value).replace(/\.(png|webp|jpg|jpeg|avif)$/i, "");
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# 页面图片链接审计");
  lines.push("");
  lines.push(`生成时间：${report.generatedAt}`);
  lines.push("");
  lines.push("## 汇总");
  lines.push("");
  lines.push(`- 输入缺图行：${report.summary.inputRows}`);
  lines.push(`- 页面分组：${report.summary.pageGroups}`);
  lines.push(`- HTML 可访问行：${report.summary.htmlOkRows}`);
  lines.push(`- HTML 中找到原始路径行：${report.summary.originalValueFoundRows}`);
  lines.push(`- 从页面相邻路径发现可下载候选的行：${report.summary.rowsWithHits}`);
  lines.push(`- 看起来可直接替换的行：${report.summary.rowsWithLikelyReplacementHits}`);
  lines.push(`- 唯一命中 URL：${report.summary.hitUrls}`);
  lines.push("");
  lines.push("## 看起来可直接补回");
  lines.push("");

  const replacementRows = report.rows.filter((row) => row.likelyReplacementHitCount > 0);
  if (!replacementRows.length) {
    lines.push("未发现可直接替换的页面/同记录图片。");
  } else {
    for (const row of replacementRows.slice(0, 120)) {
      lines.push(`- ${row.game} / ${row.page} / ${row.name} / ${row.field}：${row.originalValue}`);
      lines.push(`  - 页面：${row.pageUrl}`);
      for (const hit of row.likelyReplacementHits.slice(0, 5)) {
        lines.push(`  - 可用：${hit.url}（来自 ${hit.fieldPath ?? hit.source}: ${hit.rawPath}）`);
      }
    }
  }

  lines.push("");
  lines.push("## 仅发现同记录其它图片");
  lines.push("");
  for (const row of report.rows.filter((item) => item.hitCount > 0 && item.likelyReplacementHitCount === 0).slice(0, 160)) {
    lines.push(`- ${row.game} / ${row.page} / ${row.name} / ${row.field}：${row.originalValue}`);
  }

  lines.push("");
  lines.push("## 未发现补图线索");
  lines.push("");
  for (const row of report.rows.filter((item) => item.hitCount === 0).slice(0, 200)) {
    lines.push(`- ${row.game} / ${row.page} / ${row.name} / ${row.field}：${row.originalValue}`);
  }

  return `${lines.join("\n")}\n`;
}
