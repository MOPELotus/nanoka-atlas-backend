import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

let fatalReported = false;
let checkedUrlCount = 0;
let processedAuditItems = 0;
let auditItemCount = 0;
let lastProgressAt = Date.now();
const checkedUrls = new Map();

process.on("unhandledRejection", reportFatal);
process.on("uncaughtException", reportFatal);
process.on("SIGINT", () => reportSignal("SIGINT"));
process.on("SIGTERM", () => reportSignal("SIGTERM"));
process.on("exit", (code) => {
  if (code !== 0 && !fatalReported) {
    console.error(`audit exited with code ${code} before reporting a fatal error`);
  }
});

const rootDir = process.cwd();
const staticBase = "https://static.nanoka.cc";
const galleryIndexPath = path.join(rootDir, "data", "gallery-index.json");
const outputDir = path.join(rootDir, "data", "audits");
const outputPath = path.join(outputDir, "missing-image-audit.json");

const maxConcurrent = Number(process.env.AUDIT_CONCURRENCY ?? 24);
const requestTimeoutMs = readIntegerEnv("AUDIT_TIMEOUT_MS", 60000, 1);
const requestRetries = readIntegerEnv("AUDIT_RETRIES", readIntegerEnv("REQUEST_RETRIES", 4, 0), 0);
const progressIntervalMs = readIntegerEnv("AUDIT_PROGRESS_INTERVAL_MS", 30000, 0);

const rawGallery = JSON.parse(await readFile(galleryIndexPath, "utf8"));
const gallery = Array.isArray(rawGallery) ? rawGallery : rawGallery.images ?? [];
const placeholders = gallery.filter((item) => item.status === "placeholder");

const uniqueRefs = new Map();
for (const ref of placeholders) {
  const key = [ref.gameId, ref.pageId, ref.fieldPath, ref.originalValue].join("\t");
  if (!uniqueRefs.has(key)) {
    uniqueRefs.set(key, {
      gameId: ref.gameId,
      pageId: ref.pageId,
      fieldPath: ref.fieldPath,
      originalValue: ref.originalValue,
      refs: 0,
      currentCandidates: ref.candidates ?? []
    });
  }
  uniqueRefs.get(key).refs += 1;
}

const auditItems = [...uniqueRefs.values()].map((item) => {
  const candidates = [...new Set([...item.currentCandidates, ...extraCandidates(item)])];
  return {
    ...item,
    candidateCount: candidates.length,
    candidates
  };
});
auditItemCount = auditItems.length;

await runPool(auditItems, maxConcurrent, async (item) => {
  item.hits = [];
  item.checked = [];
  for (const url of item.candidates) {
    const result = await checkUrl(url);
    item.checked.push({ url, ...result });
    if (result.ok) {
      item.hits.push({ url, ...result });
    }
  }
  processedAuditItems += 1;
  maybePrintProgress();
});

const groups = groupAudit(auditItems);
const hitItems = auditItems.filter((item) => item.hits.length > 0);
const report = {
  generatedAt: new Date().toISOString(),
  placeholderRefs: placeholders.length,
  uniquePlaceholderRefs: auditItems.length,
  checkedUniqueUrls: checkedUrlCount,
  hitItems: hitItems.length,
  hits: hitItems,
  groups
};

await mkdir(outputDir, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`placeholder refs: ${placeholders.length}`);
console.log(`unique placeholder refs: ${auditItems.length}`);
console.log(`checked unique urls: ${checkedUrlCount}`);
console.log(`hit items: ${hitItems.length}`);
console.log(`report: ${path.relative(rootDir, outputPath)}`);

if (hitItems.length) {
  console.log("\nHits:");
  for (const item of hitItems.slice(0, 80)) {
    console.log(`- ${item.gameId} ${item.pageId} ${item.fieldPath} ${item.originalValue}`);
    for (const hit of item.hits) {
      console.log(`  ${hit.status} ${hit.contentType ?? ""} ${hit.url}`);
    }
  }
}

function extraCandidates(item) {
  const gameId = item.gameId;
  const assetBase = `${staticBase}/assets/${gameId}`;
  const raw = String(item.originalValue ?? "").trim();
  if (!raw || /^https?:\/\//i.test(raw)) {
    return [];
  }

  const normalized = raw.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\?.*$/, "");
  const stripped = stripExt(normalized);
  const file = basenameNoExt(normalized);
  const parts = stripped.split("/").filter(Boolean);
  const lowerParts = parts.map((part) => part.toLowerCase());
  const candidates = [];
  const add = (url) => {
    if (url && !candidates.includes(url)) {
      candidates.push(url);
    }
  };

  add(`${assetBase}/${file}.webp`);
  add(`${assetBase}/${stripped}.webp`);

  for (let start = Math.max(0, parts.length - 4); start < parts.length - 1; start += 1) {
    add(`${assetBase}/${parts.slice(start).join("/")}.webp`);
    add(`${assetBase}/${lowerParts.slice(start, -1).join("/")}/${file}.webp`);
  }

  if (gameId === "hsr") {
    addHsrCandidates(add, assetBase, normalized, file);
  } else if (gameId === "gi") {
    addGiCandidates(add, assetBase, file);
  } else if (gameId === "zzz") {
    addZzzCandidates(add, assetBase, normalized, file, item.fieldPath);
  } else if (gameId === "nte") {
    addNteCandidates(add, assetBase, normalized, file);
  }

  return candidates;
}

function addHsrCandidates(add, assetBase, normalized, file) {
  add(`${assetBase}/itemfigures/${file}.webp`);
  add(`${assetBase}/itemicon/${file}.webp`);
  add(`${assetBase}/itemcurrency/${file}.webp`);
  if (/^SkillIcon_/i.test(file)) {
    add(`${assetBase}/skillicons/${file}.webp`);
  }

  if (/SkillIcons\/Avatar/i.test(normalized)) {
    add(`${assetBase}/skillicons/${file}.webp`);
    add(`${assetBase}/skillicons/${file}.webp`);
    add(`${assetBase}/skillicons/avatar/${file}.webp`);
    const match = file.match(/^SkillIcon_(\d+)(_.+)$/);
    if (match) {
      const id = Number(match[1]);
      if (Number.isFinite(id) && id > 10000) {
        add(`${assetBase}/skillicons/SkillIcon_${id - 10000}${match[2]}.webp`);
      }
    }
  }

  if (/GridFight\/TraitTargetEffects/i.test(normalized)) {
    add(`${assetBase}/gridfight/icon/${file}.webp`);
    add(`${assetBase}/gridfight/traittargeteffects/${file}.webp`);
    add(`${assetBase}/gridfight/traittargeteffect/${file}.webp`);
    add(`${assetBase}/gridfight/buffcard/${file}.webp`);
    add(`${assetBase}/traittargeteffects/${file}.webp`);
  }

  if (/TravelBrochure\/StickFigures/i.test(normalized)) {
    add(`${assetBase}/stickfigures/${file}.webp`);
    add(`${assetBase}/travelbrochure/stickfigures/${file}.webp`);
  }

  if (/TravelBrochure\/StickIcons/i.test(normalized)) {
    add(`${assetBase}/stickicons/${file}.webp`);
    add(`${assetBase}/travelbrochure/stickicons/${file}.webp`);
  }
}

function addGiCandidates(add, assetBase, file) {
  const withoutUi = file.replace(/^UI_/, "");
  add(`${assetBase}/${withoutUi}.webp`);

  const avatarCardMatch = file.match(/^UI_AvatarIcon_(.+)_Card$/);
  if (avatarCardMatch) {
    add(`${assetBase}/UI_AvatarIcon_${avatarCardMatch[1]}.webp`);
  }

  const nameCardMatch = file.match(/^UI_NameCardIcon_(.+)$/);
  if (nameCardMatch) {
    add(`${assetBase}/UI_NameCardPic_${nameCardMatch[1]}_P.webp`);
    add(`${assetBase}/UI_NameCardPic_${nameCardMatch[1]}_Alpha.webp`);
  }

  if (/^UI_ItemIcon_(\d+)/.test(file)) {
    const id = file.match(/^UI_ItemIcon_(\d+)/)?.[1];
    add(`${assetBase}/ItemIcon_${id}.webp`);
    add(`${assetBase}/${id}.webp`);
    for (const suffix of ["_0", "_1", "_2", "_3", "_4", "_5"]) {
      add(`${assetBase}/UI_ItemIcon_${id}${suffix}.webp`);
    }
  }

  if (/^UI_RelicIcon_(\d+)_(\d+)/.test(file)) {
    const [, setId, slot] = file.match(/^UI_RelicIcon_(\d+)_(\d+)/) ?? [];
    add(`${assetBase}/RelicIcon_${setId}_${slot}.webp`);
  }

  for (const suffix of ["_Lods", "_Vo", "_HD", "_Tex", "_LOD"]) {
    if (file.endsWith(suffix)) {
      add(`${assetBase}/${file.slice(0, -suffix.length)}.webp`);
    }
  }

  if (file.startsWith("Gcg_")) {
    add(`${assetBase}/UI_${file}.webp`);
  }
}

function addZzzCandidates(add, assetBase, normalized, file, fieldPath) {
  const lowerPath = normalized.toLowerCase();
  if (/potential_detail\.\d+\.image$/i.test(fieldPath)) {
    add(`${assetBase}/AvatarSpecialAwakenBg_${file}.webp`);
  }

  const folders = [
    "itemicon",
    "itemiconsmall",
    "iconsuit",
    "playersaccessory",
    "playeraccessory",
    "hollow/iconbuff",
    "hollow/iconcard",
    "iconbuff",
    "iconcard",
    "bosscard",
    "bosscardlv01",
    "bosscardlv02",
    "bosscardlv03",
    "monster"
  ];
  for (const folder of folders) {
    add(`${assetBase}/${folder}/${file}.webp`);
  }

  add(`${assetBase}/Icon${file}.webp`);
  add(`${assetBase}/Icon_${file}.webp`);
  add(`${assetBase}/ItemIcon_${file}.webp`);
  add(`${assetBase}/IconItem_${file}.webp`);

  if (file.startsWith("Monster_")) {
    add(`${assetBase}/IconMonster_${file.slice("Monster_".length)}.webp`);
  }
  if (file.startsWith("Suit")) {
    for (const suffix of ["_B", "_A", "_S"]) {
      add(`${assetBase}/Item${file}${suffix}.webp`);
      add(`${assetBase}/${file}${suffix}.webp`);
    }
  }
  if (file.startsWith("Mindscape_")) {
    add(`${assetBase}/Avatar${file}.webp`);
    add(`${assetBase}/${file.replace(/_(\d)$/, "_0$1")}.webp`);
    add(`${assetBase}/${file.replace(/^Mindscape_/, "Cinema_")}.webp`);
  }
  if (lowerPath.includes("bosscard")) {
    add(`${assetBase}/BossCard_${file}.webp`);
  }
}

function addNteCandidates(add, assetBase, normalized, file) {
  const flattened = stripExt(normalized).split("/").filter(Boolean).join("_");
  add(`${assetBase}/${flattened}.webp`);
  add(`${assetBase}/UI_Icon_Skill_${file}.webp`);
  add(`${assetBase}/Skill_${file}.webp`);
  add(`${assetBase}/skill/${file}.webp`);
  add(`${assetBase}/ui_icon/skill/${file}.webp`);
}

async function checkUrl(url) {
  if (checkedUrls.has(url)) {
    return checkedUrls.get(url);
  }
  checkedUrlCount += 1;
  const result = await fetchHead(url);
  checkedUrls.set(url, result);
  return result;
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
  console.log(`progress: ${processedAuditItems}/${auditItems.length} items, ${checkedUrlCount} urls checked`);
}

async function fetchHead(url) {
  let lastError = null;
  for (let attempt = 0; attempt <= requestRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetch(url, { method: "HEAD", signal: controller.signal });
      const contentType = response.headers.get("content-type") ?? "";
      return {
        ok: response.ok && contentType.startsWith("image/"),
        status: response.status,
        contentType,
        contentLength: response.headers.get("content-length"),
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified")
      };
    } catch (error) {
      lastError = error;
      if (attempt >= requestRetries) {
        break;
      }
      await sleep(Math.min(10000, 1000 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    ok: false,
    status: "error",
    error: lastError instanceof Error ? lastError.message : String(lastError)
  };
}

function groupAudit(items) {
  const groups = new Map();
  for (const item of items) {
    const key = [item.gameId, item.pageId, item.fieldPath, dirname(item.originalValue)].join("\t");
    const group = groups.get(key) ?? {
      gameId: item.gameId,
      pageId: item.pageId,
      fieldPath: item.fieldPath,
      originalDir: dirname(item.originalValue),
      refs: 0,
      unique: 0,
      hitItems: 0,
      examples: []
    };
    group.refs += item.refs;
    group.unique += 1;
    if (item.hits.length > 0) {
      group.hitItems += 1;
      if (group.examples.length < 5) {
        group.examples.push({
          originalValue: item.originalValue,
          hits: item.hits
        });
      }
    }
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.refs - a.refs);
}

function stripExt(value) {
  return String(value).replace(/\.(png|jpg|jpeg|webp|avif)$/i, "");
}

function basenameNoExt(value) {
  return stripExt(String(value).replace(/\\/g, "/").split("/").pop() ?? "");
}

function dirname(value) {
  const normalized = String(value ?? "").replace(/\\/g, "/").replace(/\?.*$/, "");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 1) {
    return "(basename-only)";
  }
  return parts.slice(0, -1).join("/");
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
  console.error(`audit interrupted by ${signal}: ${processedAuditItems}/${auditItemCount} items, ${checkedUrlCount} urls checked`);
  process.exit(1);
}

async function runPool(items, limit, worker) {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      await worker(current);
    }
  });
  await Promise.all(runners);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
