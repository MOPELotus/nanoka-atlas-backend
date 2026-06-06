import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const auditDir = path.join(rootDir, "data", "audits");
const galleryPath = path.join(rootDir, "data", "gallery-index.json");
const mapPath = path.join(rootDir, "data", "map.json");
const auditPath = path.join(auditDir, "missing-image-audit.json");
const jsonPath = path.join(auditDir, "missing-images.zh.json");
const markdownPath = path.join(auditDir, "missing-images.zh.md");

const galleryRaw = JSON.parse(await readFile(galleryPath, "utf8"));
const gallery = Array.isArray(galleryRaw) ? galleryRaw : galleryRaw.images ?? [];
const atlasMap = JSON.parse(await readFile(mapPath, "utf8"));
const audit = await readJsonIfExists(auditPath, null);
const placeholders = gallery.filter((item) => item.status === "placeholder");

const grouped = new Map();
for (const ref of placeholders) {
  const key = [ref.gameId, ref.pageId, ref.recordId, ref.fieldPath, ref.originalValue].join("\t");
  if (!grouped.has(key)) {
    grouped.set(key, {
      gameId: ref.gameId,
      game: gameLabel(ref.gameId),
      pageId: ref.pageId,
      page: pageLabel(ref.gameId, ref.pageId),
      recordId: ref.recordId,
      fieldPath: ref.fieldPath,
      field: fieldLabel(ref.fieldPath),
      originalValue: ref.originalValue,
      imageFile: basename(ref.originalValue),
      imageDir: dirname(ref.originalValue),
      refs: 0,
      candidates: ref.candidates ?? []
    });
  }
  grouped.get(key).refs += 1;
}

const rows = [...grouped.values()].map((row) => enrichRow(row)).sort(sortRows);
const summary = summarizeRows(rows);
const report = {
  generatedAt: new Date().toISOString(),
  placeholderRefs: placeholders.length,
  uniqueRows: rows.length,
  auditHitItems: audit?.hitItems ?? null,
  auditCheckedUniqueUrls: audit?.checkedUniqueUrls ?? null,
  summary,
  rows
};

await mkdir(auditDir, { recursive: true });
await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(markdownPath, renderMarkdown(report), "utf8");

console.log(`placeholder refs: ${report.placeholderRefs}`);
console.log(`unique rows: ${report.uniqueRows}`);
console.log(`json: ${path.relative(rootDir, jsonPath)}`);
console.log(`markdown: ${path.relative(rootDir, markdownPath)}`);

function enrichRow(row) {
  const record = findZhRecord(row.gameId, row.pageId, row.recordId);
  return {
    ...row,
    name: record?.name ?? String(row.recordId),
    rarity: record?.rarity ?? "未分类",
    itemPath: record?.path ?? null,
    nameLocale: record ? "zh" : null
  };
}

function findZhRecord(gameId, pageId, recordId) {
  const locale = atlasMap.games?.[gameId]?.locales?.zh;
  if (!locale) {
    return null;
  }
  const page = locale.pages?.[pageId] ?? fallbackPage(locale.pages, pageId);
  if (!page?.records) {
    return null;
  }
  return page.records[String(recordId)] ?? null;
}

function fallbackPage(pages, pageId) {
  const fallbacks = {
    item_all: "item",
    "beyond/item_all": "beyond/item",
    "gcg/card": "gcg"
  };
  return pages?.[fallbacks[pageId]] ?? null;
}

function summarizeRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = [row.gameId, row.pageId, row.imageDir].join("\t");
    const group = groups.get(key) ?? {
      gameId: row.gameId,
      game: row.game,
      pageId: row.pageId,
      page: row.page,
      imageDir: row.imageDir,
      refs: 0,
      uniqueRows: 0,
      names: new Set(),
      files: new Set(),
      fields: new Set()
    };
    group.refs += row.refs;
    group.uniqueRows += 1;
    group.names.add(row.name);
    group.files.add(row.imageFile);
    group.fields.add(row.field);
    groups.set(key, group);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      names: [...group.names].slice(0, 20),
      files: [...group.files].slice(0, 20),
      fields: [...group.fields].slice(0, 20)
    }))
    .sort((a, b) => b.refs - a.refs || `${a.gameId}/${a.pageId}`.localeCompare(`${b.gameId}/${b.pageId}`));
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# 缺图清单");
  lines.push("");
  lines.push(`生成时间：${report.generatedAt}`);
  lines.push("");
  lines.push("## 汇总");
  lines.push("");
  lines.push(`- 占位引用：${report.placeholderRefs}`);
  lines.push(`- 唯一缺图行：${report.uniqueRows}`);
  if (report.auditCheckedUniqueUrls != null) {
    lines.push(`- 额外审计 URL：${report.auditCheckedUniqueUrls}`);
  }
  if (report.auditHitItems != null) {
    lines.push(`- 额外审计命中：${report.auditHitItems}`);
  }
  lines.push("");
  lines.push("## 按类型汇总");
  lines.push("");
  for (const group of report.summary) {
    lines.push(`- ${group.game} / ${group.page} / ${group.imageDir}：${group.refs} 引用，${group.uniqueRows} 行`);
    lines.push(`  - 名称：${group.names.join("、")}`);
    lines.push(`  - 文件：${group.files.join("、")}`);
  }
  lines.push("");
  lines.push("## 明细");
  lines.push("");
  for (const row of report.rows) {
    lines.push(`- ${row.game} / ${row.page} / ${row.name} / ${row.field}`);
    lines.push(`  - 原始值：${row.originalValue}`);
    lines.push(`  - 引用数：${row.refs}`);
    if (row.itemPath) {
      lines.push(`  - 条目：${row.itemPath}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function gameLabel(gameId) {
  return {
    hsr: "星铁",
    gi: "原神",
    zzz: "绝区零",
    nte: "异环"
  }[gameId] ?? gameId;
}

function pageLabel(gameId, pageId) {
  return atlasMap.games?.[gameId]?.locales?.zh?.pages?.[pageId]?.folder ?? pageId;
}

function fieldLabel(fieldPath) {
  const field = String(fieldPath ?? "");
  if (/special\.\d+\.icon_path$/i.test(field)) return "特殊效果图标";
  if (/monster_icon$/i.test(field)) return "敌人图标";
  if (/currency_icon/i.test(field)) return "货币图标";
  if (/figure/i.test(field)) return "立绘";
  if (/avatar/i.test(field)) return "头像";
  if (/portrait/i.test(field)) return "肖像";
  if (/image/i.test(field)) return "图片";
  if (/icon/i.test(field)) return "图标";
  return field.split(".").pop() || field;
}

function sortRows(a, b) {
  return (
    a.gameId.localeCompare(b.gameId) ||
    a.pageId.localeCompare(b.pageId) ||
    b.refs - a.refs ||
    String(a.name).localeCompare(String(b.name), "zh-Hans-CN") ||
    a.fieldPath.localeCompare(b.fieldPath)
  );
}

function basename(value) {
  return String(value ?? "").replace(/\\/g, "/").split("/").pop() || "";
}

function dirname(value) {
  const parts = String(value ?? "").replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length <= 1) {
    return "(只有文件名)";
  }
  return parts.slice(0, -1).join("/");
}

async function readJsonIfExists(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}
