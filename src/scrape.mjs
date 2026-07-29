import { load } from "cheerio";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "data");
const itemsDir = path.join(dataDir, "items");
const galleryDir = path.join(rootDir, "gallery");
const placeholderLocalPath = "gallery/_placeholder/unknown.svg";
const imageCachePath = path.join(dataDir, "image-cache.json");

const staticBase = "https://static.nanoka.cc";
const placeholderSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256" role="img" aria-label="Missing image"><rect width="256" height="256" rx="36" fill="#141827"/><path d="M62 176 98 132l29 35 22-27 45 56H62Z" fill="#2b3248"/><circle cx="183" cy="76" r="18" fill="#39435e"/><path d="M128 58c-24 0-42 14-45 36h30c2-8 8-13 16-13 9 0 15 5 15 13 0 7-4 12-15 20-17 12-24 23-23 41h28c0-10 4-16 17-25 16-11 25-23 25-39 0-20-19-33-48-33Z" fill="#b8c0d9"/><circle cx="120" cy="188" r="15" fill="#b8c0d9"/></svg>\n`;

const games = [
  {
    id: "hsr",
    name: "Honkai: Star Rail",
    homepage: "https://hsr.nanoka.cc/"
  },
  {
    id: "gi",
    name: "Genshin Impact",
    homepage: "https://gi.nanoka.cc/"
  },
  {
    id: "zzz",
    name: "Zenless Zone Zero",
    homepage: "https://zzz.nanoka.cc/"
  },
  {
    id: "nte",
    name: "Neverness to Everness",
    homepage: "https://nte.nanoka.cc/"
  }
];

const dataEndpoints = {
  hsr: [
    "{locale}/achievement/achievement",
    "character",
    "lightcone",
    "relicset",
    "monster",
    "{locale}/item",
    "{locale}/item_all",
    "{locale}/currency/augment",
    "{locale}/currency/buff",
    "{locale}/currency/item",
    "{locale}/currency/role",
    "{locale}/currency/trait",
    "maze_boss",
    "maze",
    "{locale}/maze/version",
    "maze_peak",
    "{locale}/peak/version",
    "maze_extra",
    "monstervalue",
    "EliteGroup",
    "HardLevelGroup",
    "InfiniteEliteGroup"
  ],
  gi: [
    "{locale}/achievement/achievement",
    "character",
    "weapon",
    "artifact",
    "monster",
    "gcg",
    "{locale}/gcg/card",
    "{locale}/gcg/keyword",
    "{locale}/gcg/skill",
    "furniture",
    "suite",
    "{locale}/hyperlink",
    "{locale}/hyperlinkparam",
    "{locale}/item",
    "{locale}/item_all",
    "{locale}/beyond/lang_map",
    "{locale}/beyond/item",
    "{locale}/beyond/item_all",
    "{locale}/beyond/costume",
    "{locale}/beyond/costume_all",
    "{locale}/beyond/costume_suit",
    "{locale}/beyond/costume_suit_all",
    "leyline",
    "rolecombat",
    "tower"
  ],
  zzz: [
    "{locale}/achievement/achievement",
    "character",
    "bangboo",
    "weapon",
    "equipment",
    "monster",
    "{locale}/item",
    "{locale}/item_all",
    "boss",
    "shiyu",
    "simul",
    "{locale}/hollow/tpp",
    "{locale}/hollow/card",
    "{locale}/hollow/gg",
    "{locale}/hollow/resonium"
  ],
  nte: ["{locale}/achievement", "character", "weapon", "{locale}/item", "{locale}/console"]
};

const zzzIconMapAssetNames = {
  Icon_Normal: ["Icon_Normal"],
  Icon_Evade: ["Icon_Evade"],
  Icon_Evaded: ["Icon_Evade"],
  Icon_Special: ["IconRoleSkillKeySpecial"],
  Icon_SpecialReady: ["IconRoleSkillKeySpecialV2"],
  Icon_SpecialReady_Rp: ["IconRoleSkillKeySpecialV3_02"],
  Icon_UltimateReady: ["Icon_UltimateReady"],
  Icon_Switch: ["Icon_Switch", "CardSwitch01"],
  Icon_QTE: ["Icon_QTE", "CardSwitch01"],
  Icon_Chain: ["Icon_UltimateReady", "TransformChain01"],
  Icon_Assist: ["Icon_QTE", "CardSwitch01"],
  Icon_CoreSkill: ["Icon_CoreSkill"],
  Icon_JoyStick: ["Icon_JoyStick"],
  Icon_AvatarClass_Attack: ["IconAttack"],
  Icon_AvatarClass_Anomaly: ["IconAnomaly"],
  Icon_AvatarClass_Rupture: ["IconRupture"],
  Icon_AvatarClass_Stun: ["IconStun"],
  Icon_GeneralBuff_PhysDmg: ["IconPhysDmg"],
  Icon_GeneralBuff_Thunder: ["IconThunder"],
  Icon_GeneralBuff_Fire: ["IconFire"],
  Icon_GeneralBuff_Ice: ["IconIce"],
  Icon_GeneralBuff_DungeonBuffEther: ["IconDungeonBuffEther"],
  Icon_GeneralBuff_AuricInk: ["IconAuricInk"],
  Icon_GeneralBuff_HonedEdge: ["IconHonedEdge"],
  Icon_GeneralBuff_Frost: ["IconFrost"]
};

const detailEndpointPatterns = {
  hsr: {
    character: "{locale}/character/{id}.json",
    lightcone: "{locale}/lightcone/{id}.json",
    relicset: "{locale}/relicset/{id}.json",
    monster: "{locale}/monster/{id}.json",
    "currency/role": "{locale}/currency/role/{id}.json",
    maze_boss: "{locale}/boss/{id}.json",
    maze: "{locale}/maze/{id}.json",
    maze_peak: "{locale}/peak/{id}.json",
    maze_extra: "{locale}/story/{id}.json"
  },
  gi: {
    character: "{locale}/character/{id}.json",
    weapon: "{locale}/weapon/{id}.json",
    artifact: "{locale}/artifact/{id}.json",
    monster: "{locale}/monster/{id}.json",
    gcg: "{locale}/gcg/{id}.json",
    furniture: "{locale}/furniture/{id}.json",
    suite: "{locale}/suite/{id}.json",
    leyline: "{locale}/leyline/{id}.json",
    rolecombat: "{locale}/rolecombat/{id}.json",
    tower: "{locale}/tower/{id}.json"
  },
  zzz: {
    character: "{locale}/character/{id}.json",
    bangboo: "{locale}/bangboo/{id}.json",
    weapon: "{locale}/weapon/{id}.json",
    equipment: "{locale}/equipment/{id}.json",
    monster: "{locale}/monster/{id}.json",
    boss: "{locale}/boss/{id}.json",
    shiyu: "{locale}/shiyu/{id}.json",
    simul: "{locale}/simul/{id}.json"
  },
  nte: {
    character: "{locale}/character/{id}.json",
    weapon: "{locale}/weapon/{id}.json"
  }
};

const detailMapEndpointPatterns = {
  hsr: {
    item: "{locale}/item_all.json"
  },
  gi: {
    item: "{locale}/item_all.json",
    gcg: "{locale}/gcg/card.json",
    "beyond/item": "{locale}/beyond/item_all.json",
    "beyond/costume": "{locale}/beyond/costume_all.json",
    "beyond/costume_suit": "{locale}/beyond/costume_suit_all.json"
  },
  zzz: {
    item: "{locale}/item_all.json"
  }
};

const locales = [
  { id: "zh", folder: "简体中文", label: "Chinese" },
  { id: "en", folder: "English", label: "English" },
  { id: "ja", folder: "日本語", label: "Japanese" },
  { id: "ko", folder: "한국어", label: "Korean" }
];
const localeIds = new Set(locales.map((locale) => locale.id));
const localeAliases = new Map([
  ["cn", "zh"],
  ["zh-cn", "zh"],
  ["zh-hans", "zh"],
  ["zh_hans", "zh"],
  ["jp", "ja"],
  ["kr", "ko"]
]);

const options = parseArgs(process.argv.slice(2));
const downloadImages = !options.noImages;
const requestRetries = readIntegerEnv("REQUEST_RETRIES", 4, 0);
const textTimeoutMs = readIntegerEnv("TEXT_TIMEOUT_MS", 60000, 1);
const jsonTimeoutMs = readIntegerEnv("JSON_TIMEOUT_MS", 120000, 1);
const imageTimeoutMs = readIntegerEnv("IMAGE_TIMEOUT_MS", 120000, 1);
const imageRetries = readIntegerEnv("IMAGE_RETRIES", requestRetries, 0);
const headTimeoutMs = readIntegerEnv("HEAD_TIMEOUT_MS", 60000, 1);
const headRetries = readIntegerEnv("HEAD_RETRIES", requestRetries, 0);

const imageCache = new Map();
let persistentImageCache = {};
let remoteCheckCount = 0;

function parseArgs(argv) {
  const parsed = {
    games: new Set(),
    checkRemote: false,
    listVersions: false,
    locales: new Set(),
    missingRemoteKeyOnly: false,
    mode: "incremental",
    noImages: false,
    pages: new Map(),
    remoteCheckLimit: null,
    samplePerPage: null,
    verifyImages: false,
    versions: new Map()
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

    if (arg === "--no-images") {
      parsed.noImages = true;
    } else if (arg === "--check-remote") {
      parsed.checkRemote = true;
    } else if (arg === "--verify-images") {
      parsed.verifyImages = true;
    } else if (arg === "--missing-remote-key-only") {
      parsed.missingRemoteKeyOnly = true;
    } else if (arg === "--remote-check-limit" || arg.startsWith("--remote-check-limit=") || arg === "--check-limit" || arg.startsWith("--check-limit=")) {
      const limit = Number(readValue());
      if (!Number.isInteger(limit) || limit < 0) {
        throw new Error(`Invalid remote check limit: ${limit}`);
      }
      parsed.remoteCheckLimit = limit;
    } else if (arg === "--sample") {
      parsed.samplePerPage = 1;
    } else if (arg.startsWith("--sample=") || arg === "--sample-per-page" || arg.startsWith("--sample-per-page=") || arg === "--limit-per-page" || arg.startsWith("--limit-per-page=")) {
      const limit = Number(readValue());
      if (!Number.isInteger(limit) || limit < 1) {
        throw new Error(`Invalid sample per page limit: ${limit}`);
      }
      parsed.samplePerPage = limit;
    } else if (arg === "--full" || arg === "--mode=full") {
      parsed.mode = "full";
    } else if (arg === "--incremental" || arg === "--mode=incremental") {
      parsed.mode = "incremental";
    } else if (arg === "--mode") {
      parsed.mode = readValue();
    } else if (arg === "--list-versions") {
      parsed.listVersions = true;
    } else if (arg === "--game" || arg.startsWith("--game=")) {
      for (const gameId of readValue().split(",")) {
        if (gameId.trim()) {
          parsed.games.add(gameId.trim());
        }
      }
    } else if (arg === "--locale" || arg.startsWith("--locale=") || arg === "--locales" || arg.startsWith("--locales=")) {
      for (const value of readValue().split(",")) {
        const locale = normalizeLocale(value);
        if (locale) {
          parsed.locales.add(locale);
        }
      }
    } else if (arg === "--page" || arg.startsWith("--page=") || arg === "--pages" || arg.startsWith("--pages=")) {
      parsePageArg(readValue(), parsed.pages);
    } else if (arg === "--version" || arg.startsWith("--version=")) {
      parseVersionArg(readValue(), parsed.versions);
    } else if (arg === "--versions" || arg.startsWith("--versions=")) {
      for (const value of readValue().split(",")) {
        parseVersionArg(value, parsed.versions);
      }
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!["incremental", "full"].includes(parsed.mode)) {
    throw new Error(`Unsupported --mode: ${parsed.mode}. Use incremental or full.`);
  }
  if (parsed.verifyImages) {
    parsed.checkRemote = true;
  }
  if (parsed.missingRemoteKeyOnly) {
    parsed.checkRemote = true;
  }

  return parsed;
}

function normalizeLocale(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized || normalized === "all") {
    return null;
  }
  const locale = localeAliases.get(normalized) ?? normalized;
  if (!localeIds.has(locale)) {
    throw new Error(`Unsupported locale: ${value}. Use ${locales.map((item) => item.id).join(", ")}.`);
  }
  return locale;
}

function selectedLocaleIds() {
  return options.locales.size ? [...options.locales] : locales.map((locale) => locale.id);
}

function parsePageArg(value, pages) {
  for (const segment of String(value ?? "").split(";")) {
    const match = segment.trim().match(/^([a-z0-9_-]+)\s*[=:]\s*(.+)$/i);
    if (!match) {
      throw new Error("Invalid page argument: " + segment + ". Use gi=character,weapon.");
    }
    const gameId = match[1].trim();
    if (!games.some((game) => game.id === gameId)) {
      throw new Error("Unsupported page game: " + gameId + ".");
    }
    const selected = pages.get(gameId) ?? new Set();
    for (const page of match[2].split(",")) {
      const pageKey = page.trim();
      if (pageKey) selected.add(pageKey);
    }
    if (!selected.size) {
      throw new Error("No pages selected for " + gameId + ".");
    }
    pages.set(gameId, selected);
  }
}

function selectedGames() {
  return games.filter((game) =>
    (options.games.size === 0 || options.games.has(game.id))
    && (options.pages.size === 0 || options.pages.has(game.id))
  );
}

function isSelectedPage(gameId, pageKey) {
  const selected = options.pages.get(gameId);
  return !selected || selected.has(pageKey);
}

function localeInfo(localeId) {
  return locales.find((locale) => locale.id === localeId) ?? { id: localeId, folder: localeId, label: localeId };
}

function parseVersionArg(value, versions) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return;
  }

  const separator = trimmed.includes("=") ? "=" : trimmed.includes(":") ? ":" : null;
  if (!separator) {
    versions.set("*", trimmed);
    return;
  }

  const [gameId, version] = trimmed.split(separator);
  if (!gameId || !version) {
    throw new Error(`Invalid version argument: ${value}. Use hsr=4.3.51.`);
  }
  versions.set(gameId.trim(), version.trim());
}

function resolveRequestedVersion(gameId, manifest) {
  const requested = options.versions.get(gameId) ?? options.versions.get("*") ?? null;
  if (!requested || requested === "home") {
    return null;
  }
  if (requested === "latest") {
    return manifest[gameId]?.latest ?? null;
  }
  if (requested === "live") {
    return manifest[gameId]?.live ?? null;
  }

  const available = manifest[gameId]?.available;
  if (Array.isArray(available) && available.length > 0 && !available.includes(requested)) {
    console.warn(`  ! ${gameId}: ${requested} is not listed in manifest.available; trying it anyway.`);
  }

  return requested;
}

function printVersions(manifest) {
  const output = {};
  for (const game of selectedGames()) {
    output[game.id] = {
      name: game.name,
      latest: manifest[game.id]?.latest ?? null,
      live: manifest[game.id]?.live ?? null,
      available: Array.isArray(manifest[game.id]?.available) ? manifest[game.id].available : []
    };
  }
  console.log(JSON.stringify(output, null, 2));
}

async function prepareStructuredDataDir() {
  if (options.mode === "full") {
    await rm(itemsDir, { recursive: true, force: true });
    await rm(path.join(dataDir, "games"), { recursive: true, force: true });
    await rm(path.join(dataDir, "atlas.json"), { force: true });
    await rm(path.join(dataDir, "map.json"), { force: true });
    await rm(path.join(dataDir, "gallery-index.json"), { force: true });
    await rm(imageCachePath, { force: true });
    await rm(galleryDir, { recursive: true, force: true });
  }
  await mkdir(itemsDir, { recursive: true });
}

async function ensurePlaceholderImage() {
  const fullPath = path.join(rootDir, placeholderLocalPath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, placeholderSvg, "utf8");
}

async function main() {
  const manifest = await fetchJson(`${staticBase}/manifest.json`);
  if (options.listVersions) {
    printVersions(manifest);
    return;
  }

  const previousMap = options.mode === "incremental"
    ? await readJsonIfExists(path.join(dataDir, "map.json"), {})
    : {};
  const previousGallery = options.mode === "incremental"
    ? await readJsonIfExists(path.join(dataDir, "gallery-index.json"), {})
    : {};

  await mkdir(dataDir, { recursive: true });
  await prepareStructuredDataDir();
  await mkdir(galleryDir, { recursive: true });
  await ensurePlaceholderImage();
  persistentImageCache = await readJsonIfExists(imageCachePath, {});

  const selectedLocales = selectedLocaleIds();
  const selected = selectedGames();
  const fetchedAt = new Date().toISOString();
  const map = {
    meta: {
      source: "https://nanoka.cc/",
      fetchedAt,
      mode: options.mode,
      imageDownloads: downloadImages,
      checkRemote: options.checkRemote,
      verifyImages: options.verifyImages,
      missingRemoteKeyOnly: options.missingRemoteKeyOnly,
      remoteCheckLimit: options.remoteCheckLimit,
      samplePerPage: options.samplePerPage,
      locales: selectedLocales,
      requestedVersions: Object.fromEntries(options.versions),
      selectedPages: Object.fromEntries([...options.pages].map(([gameId, pages]) => [gameId, [...pages]]))
    },
    games: options.mode === "incremental" && previousMap?.games ? previousMap.games : {}
  };

  const updatedGallery = [];
  const touchedPages = new Set();

  for (const game of selected) {
    console.log(`\n== ${game.id} ${game.name} ==`);
    const requestedVersion = resolveRequestedVersion(game.id, manifest);
    const gameAtlas = await scrapeGame(game, fetchedAt, manifest, requestedVersion);
    const exported = await exportGameRecords(gameAtlas);
    map.games[game.id] = mergeGameRecords(map.games[game.id], exported);
    for (const page of Object.values(gameAtlas.pages)) {
      touchedPages.add(game.id + "|" + page.pageKey);
      updatedGallery.push(...page.images);
    }
    console.log(`saved ${Object.keys(gameAtlas.pages).length} pages`);
  }

  const gallery = mergeGalleryEntries(previousGallery?.images, updatedGallery, touchedPages);
  await writeJson(path.join(dataDir, "map.json"), map);
  await writeJson(path.join(dataDir, "gallery-index.json"), {
    meta: {
      source: "https://nanoka.cc/",
      fetchedAt,
      imageCount: gallery.length,
      downloadedCount: gallery.filter((item) => item.status === "downloaded").length,
      reusedCount: gallery.filter((item) => item.status === "downloaded" && item.reused).length,
      verifiedCount: gallery.filter((item) => item.verified).length,
      updatedCount: gallery.filter((item) => item.updated).length,
      placeholderCount: gallery.filter((item) => item.status === "placeholder").length,
      missingCount: gallery.filter((item) => !["downloaded", "placeholder"].includes(item.status)).length,
      remoteCheckCount
    },
    images: gallery
  });
  await writeJson(imageCachePath, persistentImageCache);

  const downloaded = gallery.filter((item) => item.status === "downloaded").length;
  console.log(`\nDone. ${gallery.length} image references, ${downloaded} downloaded.`);
}

async function scrapeGame(game, fetchedAt, manifest, requestedVersion) {
  const html = await fetchText(game.homepage);
  const prefetched = extractPrefetchedJson(html).filter((item) => item.sourceUrl.startsWith(`${staticBase}/${game.id}/`));
  const sources = await loadDataSources(game, prefetched, requestedVersion);
  const pages = {};

  for (const item of sources) {
    const descriptor = describeDataSource(game.id, item.sourceUrl);
    const pageKey = descriptor.pageKey;
    const sourceId = item.sourceLocale ? `${item.sourceLocale}/${pageKey}` : pageKey;
    const totalRecordCount = countRecords(item.content);
    const content = sampleContent(item.content, options.samplePerPage);
    const recordCount = countRecords(content);
    const sampleLabel = options.samplePerPage ? ` sample ${recordCount}/${totalRecordCount}` : "";
    console.log(`  - ${sourceId}${sampleLabel}`);

    const imageRefs = collectImageRefs({
      game,
      pageKey,
      sourceUrl: item.sourceUrl,
      content
    });

    await resolveImages(imageRefs);

    pages[sourceId] = {
      id: sourceId,
      pageKey,
      title: titleFromPageKey(pageKey),
      sourceUrl: item.sourceUrl,
      sourcePath: descriptor.sourcePath,
      sourceLocale: item.sourceLocale,
      localeMode: item.localeMode,
      exportLocales: item.exportLocales,
      version: descriptor.version,
      recordCount,
      totalRecordCount,
      samplePerPage: options.samplePerPage,
      content,
      images: imageRefs
    };
  }

  await attachDetails(game, pages);

  return {
    game: {
      ...game,
      fetchedAt,
      latestVersion: manifest[game.id]?.latest ?? null,
      liveVersion: manifest[game.id]?.live ?? null,
      availableVersions: Array.isArray(manifest[game.id]?.available) ? manifest[game.id].available : [],
      requestedVersion: requestedVersion ?? null,
      versions: unique(Object.values(pages).map((page) => page.version).filter(Boolean))
    },
    pages
  };
}

async function loadDataSources(game, prefetched, requestedVersion) {
  const sourceMap = new Map();
  const selectedLocales = selectedLocaleIds();
  const prefetchedVersion = prefetched[0] ? describeDataSource(game.id, prefetched[0].sourceUrl).version : null;
  const activeVersion = requestedVersion ?? prefetchedVersion;

  for (const item of prefetched) {
    const sourceUrl = requestedVersion ? setDataVersion(game.id, item.sourceUrl, requestedVersion) : item.sourceUrl;
    const descriptor = describeDataSource(game.id, sourceUrl);
    if (!isSelectedPage(game.id, descriptor.pageKey)) {
      continue;
    }

    if (descriptor.locale) {
      for (const locale of selectedLocales) {
        const localeSourceUrl = setSourceLocale(game.id, sourceUrl, locale);
        sourceMap.set(localeSourceUrl, {
          sourceUrl: localeSourceUrl,
          content: !requestedVersion && locale === descriptor.locale ? item.content : null,
          sourceLocale: locale,
          localeMode: "path",
          exportLocales: [locale],
          optional: locale !== descriptor.locale
        });
      }
      continue;
    }

    sourceMap.set(sourceUrl, {
      sourceUrl,
      content: requestedVersion ? null : item.content,
      sourceLocale: null,
      localeMode: "embedded",
      exportLocales: selectedLocales,
      optional: false
    });
  }

  addKnownDataSources(game.id, activeVersion, selectedLocales, sourceMap);

  const sources = [];
  for (const source of sourceMap.values()) {
    const content = source.content ?? (source.optional ? await fetchJsonIfExists(source.sourceUrl) : await fetchJson(source.sourceUrl));
    if (!content) {
      continue;
    }
    sources.push({
      ...source,
      content
    });
  }

  return sources;
}

async function attachDetails(game, pages) {
  for (const page of Object.values(pages)) {
    page.detailsByLocale = {};
  }

  for (const page of Object.values(pages)) {
    const detailRefs = [];
    const recordEntries = page.content && typeof page.content === "object" ? Object.entries(page.content) : [];
    if (recordEntries.length === 0) {
      continue;
    }

    const detailPattern = detailEndpointPatterns[game.id]?.[page.pageKey];
    if (detailPattern) {
      const tasks = [];
      for (const locale of page.exportLocales) {
        for (const [recordId] of recordEntries) {
          tasks.push({ locale, recordId: String(recordId) });
        }
      }

      await runPool(tasks, 16, async ({ locale, recordId }) => {
        const sourceUrl = buildVersionedEndpoint(game.id, page.version, detailPattern, locale, recordId);
        const detail = await fetchJsonIfExists(sourceUrl);
        if (!detail) {
          return;
        }
        setRecordDetail(page, locale, recordId, sourceUrl, detail);
        detailRefs.push(
          ...collectImageRefs({
            game,
            pageKey: page.pageKey,
            sourceUrl,
            content: { [recordId]: detail }
          }).map((ref) => ({
            ...ref,
            fieldPath: `detail.${ref.fieldPath}`
          }))
        );
      });
    }

    const detailMapPattern = detailMapEndpointPatterns[game.id]?.[page.pageKey];
    if (detailMapPattern) {
      await runPool(page.exportLocales, 4, async (locale) => {
        const sourceUrl = buildVersionedEndpoint(game.id, page.version, detailMapPattern, locale);
        const detailMap = await fetchJsonIfExists(sourceUrl);
        if (!detailMap || typeof detailMap !== "object") {
          return;
        }
        for (const [recordId] of recordEntries) {
          const detail = detailMap[recordId] ?? detailMap[String(recordId)] ?? null;
          if (!detail) {
            continue;
          }
          setRecordDetail(page, locale, String(recordId), sourceUrl, detail);
          detailRefs.push(
            ...collectImageRefs({
              game,
              pageKey: page.pageKey,
              sourceUrl,
              content: { [recordId]: detail }
            }).map((ref) => ({
              ...ref,
              fieldPath: `detail.${ref.fieldPath}`
            }))
          );
        }
      });
    }

    if (detailRefs.length > 0) {
      await resolveImages(detailRefs);
      page.images.push(...detailRefs);
    }
  }
}

function setRecordDetail(page, locale, recordId, sourceUrl, detail) {
  page.detailsByLocale[locale] ??= {};
  page.detailsByLocale[locale][recordId] = {
    sourceUrl,
    content: detail
  };
}

function buildVersionedEndpoint(gameId, version, pattern, locale, recordId = "") {
  return `${staticBase}/${gameId}/${version}/${pattern
    .replaceAll("{locale}", locale)
    .replaceAll("{id}", encodeURIComponent(recordId))}`;
}

function addKnownDataSources(gameId, version, selectedLocales, sourceMap) {
  if (!version) {
    return;
  }

  for (const endpoint of dataEndpoints[gameId] ?? []) {
    if (endpoint.includes("{locale}")) {
      for (const locale of selectedLocales) {
        const sourceUrl = `${staticBase}/${gameId}/${version}/${endpoint.replace("{locale}", locale)}.json`;
        if (!isSelectedPage(gameId, describeDataSource(gameId, sourceUrl).pageKey)) {
          continue;
        }
        if (!sourceMap.has(sourceUrl)) {
          sourceMap.set(sourceUrl, {
            sourceUrl,
            content: null,
            sourceLocale: locale,
            localeMode: "path",
            exportLocales: [locale],
            optional: true
          });
        }
      }
      continue;
    }

    const sourceUrl = `${staticBase}/${gameId}/${version}/${endpoint}.json`;
    if (!isSelectedPage(gameId, describeDataSource(gameId, sourceUrl).pageKey)) {
      continue;
    }
    if (!sourceMap.has(sourceUrl)) {
      sourceMap.set(sourceUrl, {
        sourceUrl,
        content: null,
        sourceLocale: null,
        localeMode: "embedded",
        exportLocales: selectedLocales,
        optional: true
      });
    }
  }
}

async function exportGameRecords(gameAtlas) {
  const gameId = gameAtlas.game.id;
  const gameFolder = gameFolderName(gameId);
  const gameMap = {
    game: {
      id: gameId,
      name: gameAtlas.game.name,
      folder: gameFolder,
      versions: gameAtlas.game.versions,
      latestVersion: gameAtlas.game.latestVersion,
      liveVersion: gameAtlas.game.liveVersion,
      requestedVersion: gameAtlas.game.requestedVersion
    },
    locales: {}
  };
  const usedPaths = new Set();
  const expectedFilesByPageDir = new Map();

  for (const page of Object.values(gameAtlas.pages)) {
    const pageKey = page.pageKey;
    const pageFolder = pageFolderName(gameId, pageKey);
    const imagesByRecord = groupImagesByRecord(page.images);

    for (const localeId of page.exportLocales) {
      const locale = localeInfo(localeId);
      const localeMap = ensureLocaleMap(gameMap, locale);
      const pageMap = {
        id: pageKey,
        title: page.title,
        folder: pageFolder,
        sourceUrl: page.sourceUrl,
        sourcePath: page.sourcePath,
        sourceLocale: page.sourceLocale,
        localeMode: page.localeMode,
        version: page.version,
        recordCount: page.recordCount,
        totalRecordCount: page.totalRecordCount,
        sampled: Boolean(page.samplePerPage),
        records: {}
      };

      for (const [recordId, record] of Object.entries(page.content)) {
        const recordImages = imagesByRecord.get(String(recordId)) ?? [];
        const detail = page.detailsByLocale?.[localeId]?.[String(recordId)] ?? null;
        const displayName =
          displayNameForRecord(record, localeId) ||
          displayNameForRecord(detail?.content, localeId) ||
          displayNameForRecord(record, "en") ||
          displayNameForRecord(detail?.content, "en") ||
          String(recordId);
        const rarity = rarityFolderName(gameId, pageKey, record, detail?.content);
        const folderParts = [locale.folder, gameFolder, pageFolder, rarity].filter(Boolean);
        const itemRelativePath = uniqueItemPath(folderParts, displayName, recordId, usedPaths);
        const recordJson = {
          meta: {
            gameId,
            gameName: gameAtlas.game.name,
            gameFolder,
            locale: locale.id,
            localeFolder: locale.folder,
            localeLabel: locale.label,
            pageId: pageKey,
            pageFolder,
            sourceUrl: page.sourceUrl,
            sourcePath: page.sourcePath,
            sourceLocale: page.sourceLocale,
            localeMode: page.localeMode,
            detailSourceUrl: detail?.sourceUrl ?? null,
            hasDetail: Boolean(detail),
            version: page.version,
            recordId: String(recordId),
            name: displayName,
            rarity,
            images: recordImages.map(toPublicImageRef)
          },
          content: {
            list: record,
            detail: detail?.content ?? null
          }
        };

        const itemFile = path.join(dataDir, itemRelativePath);
        await writeJsonIfChanged(itemFile, recordJson);
        const pageDir = path.join(itemsDir, locale.folder, gameFolder, pageFolder);
        const expected = expectedFilesByPageDir.get(pageDir) ?? new Set();
        expected.add(path.resolve(itemFile));
        expectedFilesByPageDir.set(pageDir, expected);
        pageMap.records[recordId] = {
          id: String(recordId),
          name: displayName,
          rarity,
          path: toPosix(itemRelativePath),
          hasDetail: Boolean(detail),
          detailSourceUrl: detail?.sourceUrl ?? null,
          imageCount: recordImages.length
        };
      }

      localeMap.pages[pageKey] = pageMap;
    }
  }

  for (const [pageDir, expectedFiles] of expectedFilesByPageDir) {
    await pruneStaleItemFiles(pageDir, expectedFiles);
  }

  return gameMap;
}

function mergeGameRecords(previous, next) {
  if (!previous?.locales) {
    return next;
  }
  const locales = { ...previous.locales };
  for (const [localeId, locale] of Object.entries(next.locales || {})) {
    const current = locales[localeId] ?? {};
    locales[localeId] = {
      ...current,
      ...locale,
      pages: {
        ...(current.pages || {}),
        ...(locale.pages || {})
      }
    };
  }
  return {
    ...previous,
    ...next,
    locales
  };
}

function mergeGalleryEntries(previousImages, updatedImages, touchedPages) {
  const merged = new Map();
  for (const image of Array.isArray(previousImages) ? previousImages : []) {
    const pageKey = String(image?.gameId || "") + "|" + String(image?.pageId || "");
    if (touchedPages.has(pageKey)) {
      continue;
    }
    merged.set(galleryEntryKey(image), image);
  }
  for (const image of updatedImages) {
    merged.set(galleryEntryKey(image), image);
  }
  return [...merged.values()];
}

function galleryEntryKey(image = {}) {
  return [
    image.gameId,
    image.pageId,
    image.recordId,
    image.fieldPath,
    image.originalValue
  ].map((value) => String(value ?? "")).join("|");
}

async function pruneStaleItemFiles(directory, expectedFiles) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await pruneStaleItemFiles(target, expectedFiles);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".json") && !expectedFiles.has(path.resolve(target))) {
      await rm(target, { force: true });
    }
  }
}

function ensureLocaleMap(gameMap, locale) {
  if (!gameMap.locales[locale.id]) {
    gameMap.locales[locale.id] = {
      locale,
      pages: {}
    };
  }
  return gameMap.locales[locale.id];
}

function groupImagesByRecord(images) {
  const grouped = new Map();
  for (const image of images) {
    const key = String(image.recordId);
    const list = grouped.get(key) ?? [];
    list.push(image);
    grouped.set(key, list);
  }
  return grouped;
}

function toPublicImageRef(image) {
  return {
    fieldPath: image.fieldPath,
    kind: image.kind,
    status: image.status,
    placeholder: Boolean(image.placeholder),
    originalValue: image.originalValue,
    remoteUrl: image.remoteUrl,
    localPath: image.localPath,
    sha256: image.sha256 ?? null,
    etag: image.etag ?? null,
    lastModified: image.lastModified ?? null,
    remoteKey: image.remoteKey ?? null,
    contentType: image.contentType,
    bytes: image.bytes,
    retryable: Boolean(image.retryable),
    retryOnNextRun: Boolean(image.retryOnNextRun),
    placeholderReason: image.placeholderReason ?? null,
    failedCandidateCount: image.failedCandidateCount ?? 0,
    error: image.error
  };
}

function uniqueItemPath(folderParts, displayName, recordId, usedPaths) {
  const safeName = sanitizePathPart(displayName || String(recordId));
  let relative = path.join("items", ...folderParts.map(sanitizePathPart), `${safeName}.json`);
  if (!usedPaths.has(toPosix(relative))) {
    usedPaths.add(toPosix(relative));
    return relative;
  }

  relative = path.join("items", ...folderParts.map(sanitizePathPart), `${safeName}__${sanitizePathPart(recordId)}.json`);
  usedPaths.add(toPosix(relative));
  return relative;
}

function displayNameForRecord(record, locale) {
  if (!record || typeof record !== "object") {
    return "";
  }
  const candidates = [
    record[locale],
    record.name?.[locale],
    record.name,
    record.item_name,
    record.en,
    record.codename,
    record.id
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return cleanupDisplayName(candidate);
    }
  }
  return "";
}

function cleanupDisplayName(value) {
  return String(value)
    .replace(/\{RUBY_B#[^}]*}/g, "")
    .replace(/\{RUBY_E#}/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function gameFolderName(gameId) {
  return {
    hsr: "星铁",
    gi: "原神",
    zzz: "绝区零",
    nte: "异环"
  }[gameId] ?? gameId;
}

function pageFolderName(gameId, pageKey) {
  const labels = {
    hsr: {
      lightcone: "光锥",
      character: "角色",
      item: "物品",
      item_all: "物品详情",
      relicset: "遗器套装",
      monster: "敌人",
      "achievement/achievement": "成就",
      "currency/augment": "货币增益",
      "currency/buff": "货币祝福",
      "currency/item": "货币物品",
      "currency/role": "货币角色",
      "currency/trait": "货币特性",
      maze_boss: "末日幻影",
      maze: "混沌回忆",
      "maze/version": "混沌回忆版本",
      maze_peak: "异相仲裁",
      "peak/version": "异相仲裁版本",
      maze_extra: "虚构叙事",
      monstervalue: "敌人数值",
      EliteGroup: "精英组",
      HardLevelGroup: "难度组",
      InfiniteEliteGroup: "无限精英组"
    },
    gi: {
      character: "角色",
      weapon: "武器",
      artifact: "圣遗物",
      item: "物品",
      item_all: "物品详情",
      "beyond/item": "幻想真境剧诗物品",
      "beyond/item_all": "幻想真境剧诗物品详情",
      "beyond/costume": "幻想真境剧诗装扮",
      "beyond/costume_all": "幻想真境剧诗装扮详情",
      "beyond/costume_suit": "幻想真境剧诗套装",
      "beyond/costume_suit_all": "幻想真境剧诗套装详情",
      "beyond/lang_map": "幻想真境剧诗词典",
      gcg: "七圣召唤",
      "gcg/card": "七圣召唤卡牌详情",
      "gcg/keyword": "七圣召唤关键词",
      "gcg/skill": "七圣召唤技能",
      monster: "敌人",
      furniture: "摆设",
      suite: "摆设套装",
      hyperlink: "文本链接",
      hyperlinkparam: "文本链接参数",
      "achievement/achievement": "成就",
      leyline: "地脉异常",
      rolecombat: "幻想真境剧诗挑战",
      tower: "深境螺旋"
    },
    zzz: {
      character: "角色",
      weapon: "音擎",
      equipment: "驱动盘",
      bangboo: "邦布",
      monster: "敌人",
      item: "物品",
      item_all: "物品详情",
      "achievement/achievement": "成就",
      boss: "危局强袭战",
      shiyu: "式舆防卫战",
      simul: "作战影像回顾",
      "hollow/tpp": "零号空洞-科技树",
      "hollow/card": "零号空洞-事件",
      "hollow/gg": "零号空洞-邦布插件",
      "hollow/resonium": "零号空洞-鸣徽"
    },
    nte: {
      character: "角色",
      weapon: "武器",
      item: "物品",
      console: "模块",
      achievement: "成就"
    }
  };
  return labels[gameId]?.[pageKey] ?? titleFromPageKey(pageKey);
}

function rarityFolderName(gameId, pageKey, record, detailRecord = null) {
  const value = rarityValue(gameId, pageKey, record) ?? rarityValue(gameId, pageKey, detailRecord);
  if (!value) {
    return "未分类";
  }
  const starLabels = {
    1: "一星",
    2: "二星",
    3: "三星",
    4: "四星",
    5: "五星",
    6: "六星"
  };
  return starLabels[value] ?? `${value}星`;
}

function rarityValue(gameId, pageKey, record) {
  if (!record || typeof record !== "object") {
    return null;
  }
  const raw = record.rarity ?? record.rank ?? record.stars ?? record.quality;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  const text = String(raw ?? "");
  const numberMatch = text.match(/(?:Rarity|Type)?([1-6])\b/);
  if (numberMatch) {
    return Number(numberMatch[1]);
  }
  const colorMap = {
    orange: 5,
    gold: 5,
    purple: 4,
    blue: 3,
    green: 2,
    gray: 1,
    grey: 1
  };
  const lowerText = text.toLowerCase();
  for (const [color, value] of Object.entries(colorMap)) {
    if (lowerText.includes(color)) {
      return value;
    }
  }
  return null;
}

function extractPrefetchedJson(html) {
  const $ = load(html);
  const items = [];

  $("script[type='application/json'][data-sveltekit-fetched][data-url]").each((_, script) => {
    const sourceUrl = $(script).attr("data-url");
    const raw = $(script).text();
    if (!sourceUrl || !raw.trim()) {
      return;
    }

    try {
      const wrapped = JSON.parse(raw);
      const content = JSON.parse(wrapped.body);
      items.push({ sourceUrl, content });
    } catch (error) {
      items.push({
        sourceUrl,
        content: {
          __parseError: error instanceof Error ? error.message : String(error),
          __raw: raw
        }
      });
    }
  });

  return items;
}

function getSourcePath(gameId, sourceUrl) {
  const url = new URL(sourceUrl);
  const parts = url.pathname.split("/").filter(Boolean);
  const gameIndex = parts.indexOf(gameId);
  return parts.slice(gameIndex + 1).join("/");
}

function describeDataSource(gameId, sourceUrl) {
  const sourcePath = getSourcePath(gameId, sourceUrl);
  const parts = sourcePath.split("/").filter(Boolean);
  const version = parts.shift() ?? null;
  let locale = null;
  if (parts.length && localeIds.has(parts[0])) {
    locale = parts.shift();
  }
  return {
    sourcePath,
    version,
    locale,
    pageKey: parts.join("/").replace(/\.json$/i, "")
  };
}

function setDataVersion(gameId, sourceUrl, version) {
  const url = new URL(sourceUrl);
  const parts = url.pathname.split("/").filter(Boolean);
  const gameIndex = parts.indexOf(gameId);
  if (gameIndex < 0 || parts.length <= gameIndex + 1) {
    throw new Error(`Cannot replace version in ${sourceUrl}`);
  }
  parts[gameIndex + 1] = version;
  url.pathname = `/${parts.join("/")}`;
  return url.href;
}

function setSourceLocale(gameId, sourceUrl, locale) {
  const url = new URL(sourceUrl);
  const parts = url.pathname.split("/").filter(Boolean);
  const gameIndex = parts.indexOf(gameId);
  const localeIndex = gameIndex + 2;
  if (gameIndex < 0 || parts.length <= localeIndex || !localeIds.has(parts[localeIndex])) {
    throw new Error(`Cannot replace locale in ${sourceUrl}`);
  }
  parts[localeIndex] = locale;
  url.pathname = `/${parts.join("/")}`;
  return url.href;
}

function getDataVersion(gameId, sourceUrl) {
  return describeDataSource(gameId, sourceUrl).version;
}

function getPageKey(gameId, sourceUrl) {
  return describeDataSource(gameId, sourceUrl).pageKey;
}

function titleFromPageKey(pageKey) {
  return pageKey
    .split("/")
    .map((part) => part.replace(/[_-]+/g, " "))
    .map((part) => part.replace(/\b\w/g, (char) => char.toUpperCase()))
    .join(" / ");
}

function countRecords(content) {
  if (Array.isArray(content)) {
    return content.length;
  }
  if (content && typeof content === "object") {
    return Object.keys(content).length;
  }
  return 0;
}

function sampleContent(content, limit) {
  if (!limit || countRecords(content) <= limit) {
    return content;
  }
  if (Array.isArray(content)) {
    return content.slice(0, limit);
  }
  if (content && typeof content === "object") {
    return Object.fromEntries(Object.entries(content).slice(0, limit));
  }
  return content;
}

function collectImageRefs({ game, pageKey, sourceUrl, content }) {
  const refs = [];
  const entries = content && typeof content === "object" ? Object.entries(content) : [];

  for (const [recordId, record] of entries) {
    const recordRefs = [];
    walk(record, [], (key, value, fieldPath) => {
      if (typeof value !== "string") {
        return;
      }

      recordRefs.push(...iconMapImageRefs({
        game,
        pageKey,
        sourceUrl,
        recordId,
        fieldPath,
        value
      }));

      if (!looksLikeImageField(key, value)) {
        return;
      }
      const ref = makeImageRef({
        game,
        pageKey,
        sourceUrl,
        recordId,
        fieldPath,
        originalValue: value,
        kind: "field"
      });
      addRecordContextCandidates(ref, { game, pageKey, record, recordId, fieldPath });
      recordRefs.push(ref);
    });

    recordRefs.push(...derivedImageRefs({ game, pageKey, sourceUrl, recordId, record }));
    refs.push(...dedupeRefs(recordRefs));
  }

  return refs;
}

function iconMapImageRefs({ game, pageKey, sourceUrl, recordId, fieldPath, value }) {
  if (game.id !== "zzz") {
    return [];
  }

  return unique([...String(value).matchAll(/<IconMap:([^>]+)>/g)].map((match) => match[1]).filter(Boolean))
    .map((token) => makeImageRef({
      game,
      pageKey,
      sourceUrl,
      recordId,
      fieldPath: `${fieldPath}.IconMap.${token}`,
      originalValue: `<IconMap:${token}>`,
      kind: "icon_map"
    }));
}

function looksLikeImageField(key, value) {
  const cleanKey = String(key).toLowerCase();
  const cleanValue = String(value).trim();
  if (!cleanValue) {
    return false;
  }
  if (/\{[^}]*}/.test(cleanValue)) {
    return false;
  }

  if (cleanKey === "type_icon" && !/[/\\._]/.test(cleanValue) && !/^https?:\/\//i.test(cleanValue)) {
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

function walk(value, pathParts, visit) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, [...pathParts, String(index)], visit));
    return;
  }

  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const childPath = [...pathParts, key];
      visit(key, child, childPath.join("."));
      walk(child, childPath, visit);
    }
  }
}

function makeImageRef({ game, pageKey, sourceUrl, recordId, fieldPath, originalValue, kind }) {
  return {
    gameId: game.id,
    pageId: pageKey,
    sourceUrl,
    recordId: String(recordId),
    fieldPath,
    kind,
    originalValue,
    candidates: buildImageCandidates(game.id, pageKey, String(originalValue), String(recordId), fieldPath),
    status: "pending",
    remoteUrl: null,
    localPath: null,
    contentType: null,
    bytes: null,
    sha256: null,
    etag: null,
    lastModified: null,
    remoteKey: null,
    reused: false,
    verified: false,
    updated: false,
    placeholder: false,
    placeholderReason: null,
    retryable: false,
    retryOnNextRun: false,
    failedCandidateCount: 0,
    error: null
  };
}

function addRecordContextCandidates(ref, { game, pageKey, record, recordId, fieldPath }) {
  if (game.id !== "hsr" || !["item", "item_all"].includes(pageKey) || !record || typeof record !== "object") {
    return;
  }

  if (!/(^|\.)item_(?:icon|currency_icon)_path$/i.test(fieldPath)) {
    return;
  }

  const contextValues = [record.item_figure_icon_path, record.item_icon_path];
  for (const value of contextValues) {
    if (typeof value !== "string" || !value.trim()) {
      continue;
    }
    for (const candidate of buildImageCandidates(game.id, pageKey, value, String(recordId), fieldPath)) {
      addImageCandidate(ref, candidate);
    }
  }
}

function addImageCandidate(ref, candidate) {
  if (candidate && !ref.candidates.includes(candidate)) {
    ref.candidates.push(candidate);
  }
}

function derivedImageRefs({ game, pageKey, sourceUrl, recordId, record }) {
  if (!record || typeof record !== "object") {
    return [];
  }

  const refs = [];
  const id = String(recordId);

  if (game.id === "hsr") {
    if (pageKey === "character") {
      refs.push(derivedRef(game, pageKey, sourceUrl, id, "derived.avatarShopIcon", `avatarshopicon/${id}`));
      refs.push(derivedRef(game, pageKey, sourceUrl, id, "derived.avatarDrawCard", `avatardrawcard/${id}`));
      if (record.damageType) {
        refs.push(derivedRef(game, pageKey, sourceUrl, id, "derived.element", `element/${String(record.damageType).toLowerCase()}`));
      }
      if (record.baseType) {
        refs.push(derivedRef(game, pageKey, sourceUrl, id, "derived.path", `pathicon/${String(record.baseType).toLowerCase()}`));
      }
    }

    if (pageKey === "lightcone") {
      refs.push(derivedRef(game, pageKey, sourceUrl, id, "derived.lightConeMediumIcon", `lightconemediumicon/${id}`));
      if (record.baseType) {
        refs.push(derivedRef(game, pageKey, sourceUrl, id, "derived.path", `pathicon/${String(record.baseType).toLowerCase()}`));
      }
    }

    if (pageKey === "monster" && record.icon) {
      const name = basenameNoExt(record.icon);
      refs.push(derivedRef(game, pageKey, sourceUrl, id, "derived.monsterFigure", `monsterfigure/${name}`));
    }

    if (pageKey.endsWith("item") && record.item_figure_icon_path) {
      const name = basenameNoExt(record.item_figure_icon_path);
      refs.push(derivedRef(game, pageKey, sourceUrl, id, "derived.itemFigure", `itemfigures/${name}`));
    }
  }

  if (game.id === "zzz" && pageKey === "character") {
    for (const index of [1, 2, 3]) {
      refs.push(derivedRef(game, pageKey, sourceUrl, id, `derived.mindscape.${index}`, `Mindscape_${id}_${index}`));
    }
  }

  return refs;
}

function derivedRef(game, pageKey, sourceUrl, recordId, fieldPath, value) {
  return makeImageRef({
    game,
    pageKey,
    sourceUrl,
    recordId,
    fieldPath,
    originalValue: value,
    kind: "derived"
  });
}

function dedupeRefs(refs) {
  const seen = new Set();
  const output = [];
  for (const ref of refs) {
    const key = `${ref.recordId}|${ref.fieldPath}|${ref.originalValue}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(ref);
  }
  return output;
}

function buildImageCandidates(gameId, pageKey, rawValue, recordId, fieldPath) {
  const value = rawValue.trim();
  if (!value) {
    return [];
  }

  if (/^https?:\/\//i.test(value)) {
    return [value];
  }

  const assetBase = `${staticBase}/assets/${gameId}`;
  const stripped = stripImageExt(value.replace(/^\/+/, ""));
  const baseName = basenameNoExt(value);
  const candidates = [];

  const add = (url) => {
    if (url && !candidates.includes(url)) {
      candidates.push(url);
    }
  };

  const iconMapToken = value.match(/^<IconMap:([^>]+)>$/)?.[1] ?? value.match(/^IconMap:([^>]+)$/)?.[1];
  if (gameId === "zzz" && iconMapToken) {
    for (const assetName of zzzIconMapAssetNames[iconMapToken] ?? [iconMapToken]) {
      add(`${assetBase}/${stripImageExt(assetName)}.webp`);
    }
    return candidates;
  }

  if (gameId === "hsr") {
    if (value.includes("/")) {
      const parts = stripped.split("/").filter(Boolean);
      const file = parts.at(-1);
      const folder = parts.at(-2);
      const normalized = value.replace(/\\/g, "/");
      if (/ItemFigures/i.test(value) && file) {
        add(`${assetBase}/itemfigures/${file}.webp`);
      }
      if (/SpriteOutput\/ItemIcon\//i.test(normalized) && file) {
        add(`${assetBase}/itemfigures/${file}.webp`);
      }
      if (/SpriteOutput\/ItemCurrency\//i.test(normalized) && file) {
        add(`${assetBase}/itemfigures/${file}.webp`);
      }
      if (/SpriteOutput\/TravelBrochure\/(?:StickFigures|StickIcons)\//i.test(normalized) && file) {
        add(`${assetBase}/itemfigures/${file}.webp`);
      }
      if (/SpriteOutput\/SkillIcons\/Avatar\//i.test(normalized) && file) {
        add(`${assetBase}/skillicons/${file}.webp`);
        const skillIconMatch = file.match(/^SkillIcon_(\d+)(_.+)$/);
        if (skillIconMatch) {
          const skillIconId = Number(skillIconMatch[1]);
          if (Number.isFinite(skillIconId) && skillIconId > 10000) {
            add(`${assetBase}/skillicons/SkillIcon_${skillIconId - 10000}${skillIconMatch[2]}.webp`);
          }
        }
      }
      if (/MonsterFigure/i.test(value) && file) {
        add(`${assetBase}/monsterfigure/${file}.webp`);
      }
      if (/SpriteOutput\/BattleEventIcon\//i.test(normalized) && file) {
        add(`${assetBase}/monsterfigure/${file}.webp`);
      }
      if (/SpriteOutput\/GridFight\/AugmentBig\//i.test(normalized) && file) {
        add(`${assetBase}/gridfight/augmentbig/${file}.webp`);
      }
      if (/SpriteOutput\/GridFight\/Portal\//i.test(normalized) && file) {
        add(`${assetBase}/gridfight/portal/${file}.webp`);
      }
      if (/SpriteOutput\/GridFight\/(?:GridItem|Equipment)\//i.test(normalized) && file) {
        add(`${assetBase}/gridfight/equipment/${file}.webp`);
      }
      if (/SpriteOutput\/GridFight\/TraitIcon\/(?:Icon|MiniIcon)\//i.test(normalized) && file) {
        add(`${assetBase}/gridfight/icon/${file}.webp`);
        add(`${assetBase}/gridfight/icon/${file.replace(/S$/i, "")}.webp`);
      }
      if (/(?:SpriteOutput\/GridFight\/BattleIcon\/BuffIcon|SpriteOutput\/BuffIcon\/Inlevel\/Avatar)\//i.test(normalized) && file) {
        const roleId = file.match(/(\d+)/)?.[1];
        if (roleId) {
          add(`${assetBase}/avatarroundicon/${roleId}.webp`);
        }
      }
      if (folder && file) {
        add(`${assetBase}/${folder.toLowerCase()}/${file}.webp`);
      }
    }
    if (/^SkillIcon_/i.test(baseName)) {
      add(`${assetBase}/skillicons/${baseName}.webp`);
    }
    add(`${assetBase}/${stripped}.webp`);
    add(`${assetBase}/${baseName}.webp`);
  } else if (gameId === "gi") {
    add(`${assetBase}/${baseName}.webp`);
    const avatarCardMatch = baseName.match(/^UI_AvatarIcon_(.+)_Card$/);
    if (avatarCardMatch) {
      add(`${assetBase}/UI_AvatarIcon_${avatarCardMatch[1]}.webp`);
    }
    const nameCardMatch = baseName.match(/^UI_NameCardIcon_(.+)$/);
    if (nameCardMatch) {
      add(`${assetBase}/UI_NameCardPic_${nameCardMatch[1]}_P.webp`);
      add(`${assetBase}/UI_NameCardPic_${nameCardMatch[1]}_Alpha.webp`);
    }
    if (baseName.startsWith("Gcg_")) {
      add(`${assetBase}/UI_${baseName}.webp`);
    }
    add(`${assetBase}/${stripped}.webp`);
  } else if (gameId === "zzz") {
    if (pageKey === "character" && /(?:^|\.)potential_detail\.\d+\.image$/i.test(fieldPath)) {
      const awakenBg = baseName.startsWith("AvatarSpecialAwakenBg_") ? baseName : `AvatarSpecialAwakenBg_${baseName}`;
      add(`${assetBase}/${awakenBg}.webp`);
    }
    add(`${assetBase}/${baseName}.webp`);
    if (baseName.startsWith("IconMonster_")) {
      add(`${assetBase}/${baseName.replace(/^IconMonster_/, "Monster_")}.webp`);
    }
    add(`${assetBase}/${stripped}.webp`);
  } else if (gameId === "nte") {
    add(`${assetBase}/${stripped}.webp`);
    add(`${assetBase}/${baseName}.webp`);
  }

  if (pageKey === "character" && gameId === "gi" && fieldPath.endsWith("icon")) {
    add(`${assetBase}/${String(value).replace("UI_AvatarIcon_", "UI_Gacha_AvatarImg_")}.webp`);
  }

  if (recordId && gameId === "hsr" && pageKey === "character") {
    add(`${assetBase}/avatarshopicon/${recordId}.webp`);
  }

  return candidates;
}

async function resolveImages(refs) {
  let resolved = 0;

  await runPool(refs, 12, async (ref) => {
    try {
      if (!downloadImages) {
        ref.status = "not_downloaded";
        return;
      }

      const failures = [];
      for (const candidate of ref.candidates) {
        const result = await downloadImage(ref.gameId, candidate);
        if (result.status === "downloaded") {
          ref.status = "downloaded";
          ref.remoteUrl = candidate;
          ref.localPath = result.localPath;
          ref.contentType = result.contentType;
          ref.bytes = result.bytes;
          ref.sha256 = result.sha256 ?? null;
          ref.etag = result.etag ?? null;
          ref.lastModified = result.lastModified ?? null;
          ref.remoteKey = result.remoteKey ?? null;
          ref.reused = Boolean(result.reused);
          ref.verified = Boolean(result.verified);
          ref.updated = Boolean(result.updated);
          ref.placeholder = Boolean(result.placeholder);
          ref.error = null;
          resolved += 1;
          return;
        }
        failures.push({
          status: result.status,
          retryable: Boolean(result.retryable),
          error: result.error
        });
      }

      if (!ref.candidates.length) {
        applyPlaceholder(ref, "no_candidates", failures);
        return;
      }
      if (failures.some((failure) => failure.retryable)) {
        applyRetryableImageError(ref, failures);
        return;
      }
      applyPlaceholder(ref, "remote_missing", failures);
    } catch (error) {
      applyRetryableImageError(ref, [
        {
          status: "error",
          retryable: true,
          error: error instanceof Error ? error.message : String(error)
        }
      ]);
    }
  });

  if (refs.length) {
    console.log(`    images: ${resolved}/${refs.length}`);
  }
}

function applyPlaceholder(ref, reason, failures = []) {
  ref.status = "placeholder";
  ref.remoteUrl = null;
  ref.localPath = placeholderLocalPath;
  ref.contentType = "image/svg+xml";
  ref.bytes = placeholderSvg.length;
  ref.sha256 = sha256Buffer(Buffer.from(placeholderSvg));
  ref.etag = null;
  ref.lastModified = null;
  ref.remoteKey = null;
  ref.reused = true;
  ref.verified = false;
  ref.updated = false;
  ref.placeholder = true;
  ref.placeholderReason = reason;
  ref.retryable = false;
  ref.retryOnNextRun = true;
  ref.failedCandidateCount = failures.length;
  ref.error = summarizeImageFailures(failures) ?? (reason === "no_candidates" ? "No image candidates generated." : "No candidate returned an image response.");
}

function applyRetryableImageError(ref, failures = []) {
  ref.status = "error";
  ref.remoteUrl = null;
  ref.localPath = null;
  ref.contentType = null;
  ref.bytes = null;
  ref.sha256 = null;
  ref.etag = null;
  ref.lastModified = null;
  ref.remoteKey = null;
  ref.reused = false;
  ref.verified = false;
  ref.updated = false;
  ref.placeholder = false;
  ref.placeholderReason = null;
  ref.retryable = true;
  ref.retryOnNextRun = true;
  ref.failedCandidateCount = failures.length;
  ref.error = summarizeImageFailures(failures) ?? "Retryable image fetch error.";
}

function summarizeImageFailures(failures) {
  if (!failures.length) {
    return null;
  }
  const sample = failures
    .slice(0, 3)
    .map((failure) => `${failure.status}${failure.retryable ? "/retryable" : ""}: ${failure.error ?? "unknown"}`)
    .join("; ");
  return failures.length > 3 ? `${sample}; ${failures.length - 3} more candidate failures` : sample;
}

async function downloadImage(gameId, url) {
  if (imageCache.has(url)) {
    return imageCache.get(url);
  }

  const promise = (async () => {
    try {
      if (options.mode === "incremental") {
        const existing = await existingImageResult(gameId, url);
        if (existing) {
          if (options.verifyImages) {
            return verifyAndMaybeUpdateImage(gameId, url, existing);
          }
          return existing;
        }
      }

      return fetchAndStoreImage(gameId, url, { updated: false });
    } catch (error) {
      return {
        status: "error",
        retryable: true,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  })();

  imageCache.set(url, promise);
  const result = await promise;
  imageCache.set(url, result);
  return result;
}

async function existingImageResult(gameId, url) {
  const contentType = contentTypeForUrl(url);
  if (!contentType) {
    return null;
  }

  const localPath = localPathForImage(gameId, url, contentType);
  try {
    const stats = await stat(path.join(rootDir, localPath));
    if (!stats.isFile() || stats.size <= 0) {
      return null;
    }

    const cached = persistentImageCache[url] ?? {};
    const localSha256 = cached.sha256 || (await fileSha256(path.join(rootDir, localPath)));
    const baseEntry = updatePersistentImageCache(url, {
      localPath: toPosix(localPath),
      contentType: cached.contentType || contentType,
      bytes: stats.size,
      sha256: localSha256,
      etag: cached.etag ?? null,
      lastModified: cached.lastModified ?? null,
      remoteKey: cached.remoteKey ?? null,
      checkedAt: new Date().toISOString()
    });

    if (!options.checkRemote || options.verifyImages) {
      return {
        status: "downloaded",
        localPath: baseEntry.localPath,
        contentType: baseEntry.contentType,
        bytes: baseEntry.bytes,
        sha256: baseEntry.sha256,
        etag: baseEntry.etag,
        lastModified: baseEntry.lastModified,
        remoteKey: baseEntry.remoteKey,
        reused: true,
        verified: false,
        updated: false,
        error: null
      };
    }

    if ((options.missingRemoteKeyOnly && baseEntry.remoteKey) || (options.remoteCheckLimit !== null && remoteCheckCount >= options.remoteCheckLimit)) {
      return {
        status: "downloaded",
        localPath: baseEntry.localPath,
        contentType: baseEntry.contentType,
        bytes: baseEntry.bytes,
        sha256: baseEntry.sha256,
        etag: baseEntry.etag,
        lastModified: baseEntry.lastModified,
        remoteKey: baseEntry.remoteKey,
        reused: true,
        verified: false,
        updated: false,
        error: null
      };
    }

    remoteCheckCount += 1;
    const head = await fetchImageHead(url);
    if (!head.ok) {
      return {
        status: "downloaded",
        localPath: baseEntry.localPath,
        contentType: baseEntry.contentType,
        bytes: stats.size,
        sha256: localSha256,
        etag: baseEntry.etag,
        lastModified: baseEntry.lastModified,
        remoteKey: baseEntry.remoteKey,
        reused: true,
        verified: false,
        updated: false,
        error: `Reused local file because HEAD failed: ${head.error}`
      };
    }

    if (head.contentLength != null && stats.size !== head.contentLength) {
      return null;
    }
    if (baseEntry.remoteKey && head.remoteKey && baseEntry.remoteKey !== head.remoteKey) {
      return null;
    }
    if (cached.etag && head.etag && cached.etag !== head.etag) {
      return null;
    }
    if (cached.lastModified && head.lastModified && cached.lastModified !== head.lastModified && !head.etag) {
      return null;
    }

    const entry = updatePersistentImageCache(url, {
      localPath: toPosix(localPath),
      contentType: head.contentType || cached.contentType || contentType,
      bytes: stats.size,
      sha256: localSha256,
      etag: head.etag ?? cached.etag ?? null,
      lastModified: head.lastModified ?? cached.lastModified ?? null,
      remoteKey: head.remoteKey ?? cached.remoteKey ?? null,
      checkedAt: new Date().toISOString()
    });

    return {
      status: "downloaded",
      localPath: entry.localPath,
      contentType: entry.contentType,
      bytes: entry.bytes,
      sha256: entry.sha256,
      etag: entry.etag,
      lastModified: entry.lastModified,
      remoteKey: entry.remoteKey,
      reused: true,
      verified: false,
      updated: false,
      error: null
    };
  } catch {
    return null;
  }
}

async function verifyAndMaybeUpdateImage(gameId, url, existing) {
  const fetched = await fetchImageBuffer(url);
  if (fetched.status !== "downloaded") {
    return fetched;
  }

  const remoteSha256 = sha256Buffer(fetched.buffer);
  if (existing.sha256 === remoteSha256 && existing.bytes === fetched.buffer.byteLength) {
    const entry = updatePersistentImageCache(url, {
      localPath: existing.localPath,
      contentType: fetched.contentType,
      bytes: fetched.buffer.byteLength,
      sha256: remoteSha256,
      etag: fetched.etag,
      lastModified: fetched.lastModified,
      remoteKey: fetched.remoteKey,
      checkedAt: new Date().toISOString()
    });

    return {
      status: "downloaded",
      localPath: entry.localPath,
      contentType: entry.contentType,
      bytes: entry.bytes,
      sha256: entry.sha256,
      etag: entry.etag,
      lastModified: entry.lastModified,
      remoteKey: entry.remoteKey,
      reused: true,
      verified: true,
      updated: false,
      error: null
    };
  }

  return storeImageBuffer(gameId, url, fetched, {
    reused: false,
    verified: true,
    updated: true
  });
}

async function fetchAndStoreImage(gameId, url, flags = {}) {
  const fetched = await fetchImageBuffer(url);
  if (fetched.status !== "downloaded") {
    return fetched;
  }
  return storeImageBuffer(gameId, url, fetched, flags);
}

async function fetchImageBuffer(url) {
  const response = await fetchWithRetry(url, {
    headers: {
      "User-Agent": "nanoka-atlas-backend/1.0"
    }
  }, { timeoutMs: imageTimeoutMs, retries: imageRetries });

  const contentType = response.headers.get("content-type") || "";
  if (!response.ok) {
    await response.arrayBuffer().catch(() => null);
    const confirmedMissing = response.status === 404 || response.status === 410;
    return {
      status: confirmedMissing ? "missing" : "error",
      retryable: !confirmedMissing,
      error: `${response.status} ${contentType || "unknown content-type"}`
    };
  }

  if (!contentType.startsWith("image/")) {
    await response.arrayBuffer().catch(() => null);
    return {
      status: "missing",
      retryable: false,
      error: `${response.status} ${contentType || "unknown content-type"}`
    };
  }

  return {
    status: "downloaded",
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType,
    etag: normalizeHeader(response.headers.get("etag")),
    lastModified: normalizeHeader(response.headers.get("last-modified")),
    remoteKey: remoteKeyFromParts({
      etag: normalizeHeader(response.headers.get("etag")),
      lastModified: normalizeHeader(response.headers.get("last-modified")),
      contentLength: response.headers.get("content-length"),
      contentType
    })
  };
}

async function storeImageBuffer(gameId, url, fetched, flags = {}) {
  const sha256 = sha256Buffer(fetched.buffer);
  const localPath = localPathForImage(gameId, url, fetched.contentType);
  await mkdir(path.dirname(path.join(rootDir, localPath)), { recursive: true });
  await writeFile(path.join(rootDir, localPath), fetched.buffer);

  const entry = updatePersistentImageCache(url, {
    localPath: toPosix(localPath),
    contentType: fetched.contentType,
    bytes: fetched.buffer.byteLength,
    sha256,
    etag: fetched.etag,
    lastModified: fetched.lastModified,
    remoteKey: fetched.remoteKey,
    checkedAt: new Date().toISOString()
  });

  return {
    status: "downloaded",
    localPath: entry.localPath,
    contentType: entry.contentType,
    bytes: entry.bytes,
    sha256: entry.sha256,
    etag: entry.etag,
    lastModified: entry.lastModified,
    remoteKey: entry.remoteKey,
    reused: Boolean(flags.reused),
    verified: Boolean(flags.verified),
    updated: Boolean(flags.updated),
    error: null
  };
}

async function fetchImageHead(url) {
  try {
    const response = await fetchWithRetry(url, {
      method: "HEAD",
      headers: {
        "User-Agent": "nanoka-atlas-backend/1.0"
      }
    }, { timeoutMs: headTimeoutMs, retries: headRetries });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.startsWith("image/")) {
      return {
        ok: false,
        error: `${response.status} ${contentType || "unknown content-type"}`
      };
    }

    const contentLength = Number(response.headers.get("content-length"));
    return {
      ok: true,
      contentType,
      contentLength: Number.isFinite(contentLength) ? contentLength : null,
      etag: normalizeHeader(response.headers.get("etag")),
      lastModified: normalizeHeader(response.headers.get("last-modified")),
      remoteKey: remoteKeyFromParts({
        etag: normalizeHeader(response.headers.get("etag")),
        lastModified: normalizeHeader(response.headers.get("last-modified")),
        contentLength: response.headers.get("content-length"),
        contentType
      })
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function updatePersistentImageCache(url, entry) {
  const next = {
    ...persistentImageCache[url],
    ...entry
  };
  persistentImageCache[url] = next;
  return next;
}

function localPathForImage(gameId, url, contentType) {
  const parsed = new URL(url);
  const ext = extForContentType(contentType) || path.extname(parsed.pathname) || ".img";
  const assetPrefix = `/assets/${gameId}/`;
  let relative = parsed.pathname.startsWith(assetPrefix)
    ? parsed.pathname.slice(assetPrefix.length)
    : `${hash(url).slice(0, 10)}-${path.basename(parsed.pathname)}`;

  relative = relative.replace(/^\/+/, "");
  relative = stripImageExt(relative) + ext;
  relative = relative
    .split("/")
    .map((part) => sanitizePathPart(part))
    .join("/");

  return path.join("gallery", gameId, relative);
}

function extForContentType(contentType) {
  if (contentType.includes("image/webp")) return ".webp";
  if (contentType.includes("image/png")) return ".png";
  if (contentType.includes("image/jpeg")) return ".jpg";
  if (contentType.includes("image/avif")) return ".avif";
  if (contentType.includes("image/gif")) return ".gif";
  return null;
}

function contentTypeForUrl(url) {
  const ext = path.extname(new URL(url).pathname).toLowerCase();
  if (ext === ".webp") return "image/webp";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".avif") return "image/avif";
  if (ext === ".gif") return "image/gif";
  return null;
}

function sanitizePathPart(part) {
  return part.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim() || "_";
}

function stripImageExt(value) {
  return value.replace(/\.(png|webp|jpg|jpeg|avif)$/i, "");
}

function basenameNoExt(value) {
  return stripImageExt(String(value).split(/[\\/]/).at(-1) || "");
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Buffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function fileSha256(filePath) {
  return sha256Buffer(await readFile(filePath));
}

function normalizeHeader(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function remoteKeyFromParts({ etag, lastModified, contentLength, contentType }) {
  const parts = [
    etag ? `etag=${etag}` : null,
    lastModified ? `lastModified=${lastModified}` : null,
    contentLength ? `bytes=${contentLength}` : null,
    contentType ? `type=${contentType}` : null
  ].filter(Boolean);
  return parts.length ? parts.join("|") : null;
}

async function fetchWithTimeout(url, init = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWithRetry(url, init = {}, { timeoutMs = 15000, retries = 2 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetchWithTimeout(url, init, timeoutMs);
    } catch (error) {
      lastError = error;
      if (attempt >= retries) {
        break;
      }
      await sleep(Math.min(10000, 1000 * (attempt + 1)));
    }
  }
  throw lastError;
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unique(values) {
  return [...new Set(values)];
}

async function readJsonIfExists(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function fetchText(url) {
  const response = await fetchWithRetry(url, {
    headers: {
      "User-Agent": "nanoka-atlas-backend/1.0"
    }
  }, { timeoutMs: textTimeoutMs, retries: requestRetries });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.text();
}

async function fetchJson(url) {
  const response = await fetchWithRetry(url, {
    headers: {
      "User-Agent": "nanoka-atlas-backend/1.0"
    }
  }, { timeoutMs: jsonTimeoutMs, retries: requestRetries });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.json();
}

async function fetchJsonIfExists(url) {
  const response = await fetchWithRetry(url, {
    headers: {
      "User-Agent": "nanoka-atlas-backend/1.0"
    }
  }, { timeoutMs: jsonTimeoutMs, retries: requestRetries });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.json();
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeJsonIfChanged(filePath, value) {
  const next = `${JSON.stringify(value, null, 2)}\n`;
  try {
    const current = await readFile(filePath, "utf8");
    if (current === next) {
      return false;
    }
  } catch {
    // Missing files are written below.
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, next, "utf8");
  return true;
}

async function runPool(items, concurrency, worker) {
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      await worker(current);
    }
  });
  await Promise.all(workers);
}

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
