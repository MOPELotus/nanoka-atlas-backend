import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const auditDir = path.join(rootDir, "data", "audits");
const missingReportPath = path.join(auditDir, "missing-images.zh.json");
const mapPath = path.join(rootDir, "data", "map.json");
const jsonPath = path.join(auditDir, "missing-images.zh.filtered.json");
const markdownPath = path.join(auditDir, "missing-images.zh.filtered.md");

const missingReport = JSON.parse(await readFile(missingReportPath, "utf8"));
const atlasMap = JSON.parse(await readFile(mapPath, "utf8"));
const rows = missingReport.rows ?? [];
const mainGcgIds = await loadMainGcgIds();

const excluded = {
  test: [],
  hiddenGcg: [],
  blackSwan: []
};
const remainingRows = [];

for (const row of rows) {
  if (isTestRow(row)) {
    excluded.test.push(row);
  } else if (isHiddenGcgRow(row)) {
    excluded.hiddenGcg.push(row);
  } else if (isBlackSwanRow(row)) {
    excluded.blackSwan.push(row);
  } else {
    remainingRows.push(row);
  }
}

const assets = groupAssets(remainingRows);
const report = {
  generatedAt: new Date().toISOString(),
  source: path.relative(rootDir, missingReportPath).replace(/\\/g, "/"),
  filter: [
    "exclude full item content containing test/测试/旧测试",
    "exclude gi gcg/card rows not present in the main gcg page",
    "exclude confirmed HSR 黑天鹅 currency-role special images"
  ],
  totals: {
    sourceRows: rows.length,
    excludedTestRows: excluded.test.length,
    excludedHiddenGcgRows: excluded.hiddenGcg.length,
    excludedBlackSwanRows: excluded.blackSwan.length,
    remainingRows: remainingRows.length,
    remainingRefs: sumRefs(remainingRows),
    uniqueAssets: assets.length
  },
  byGame: summarize(assets, (asset) => asset.game),
  byCategory: summarize(assets, (asset) => asset.category),
  excludedExamples: {
    test: excluded.test.slice(0, 20).map(exampleRow),
    hiddenGcg: excluded.hiddenGcg.slice(0, 20).map(exampleRow),
    blackSwan: excluded.blackSwan.slice(0, 20).map(exampleRow)
  },
  assets
};

await mkdir(auditDir, { recursive: true });
await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(markdownPath, renderMarkdown(report), "utf8");

console.log(`filtered rows: ${report.totals.remainingRows}`);
console.log(`filtered unique assets: ${report.totals.uniqueAssets}`);
console.log(`json: ${path.relative(rootDir, jsonPath)}`);
console.log(`markdown: ${path.relative(rootDir, markdownPath)}`);

async function loadMainGcgIds() {
  const sourceUrl = atlasMap.games?.gi?.locales?.zh?.pages?.gcg?.sourceUrl;
  if (!sourceUrl) {
    return new Set();
  }
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    return new Set();
  }
  const json = await response.json();
  return new Set(Object.keys(json));
}

function isTestRow(row) {
  return /test|测试|旧测试/i.test(rowSearchText(row));
}

function rowSearchText(row) {
  return [
    row.name,
    row.imageFile,
    row.originalValue,
    row.itemPath,
    row.recordId,
    JSON.stringify(readItemContent(row))
  ]
    .map((value) => String(value ?? ""))
    .join("\n");
}

function readItemContent(row) {
  if (!row.itemPath) {
    return null;
  }
  try {
    const itemPath = path.join(rootDir, "data", row.itemPath);
    return JSON.parse(readFileSync(itemPath, "utf8")).content ?? null;
  } catch {
    return null;
  }
}

function isHiddenGcgRow(row) {
  return row.gameId === "gi" && row.pageId === "gcg/card" && !mainGcgIds.has(String(row.recordId));
}

function isBlackSwanRow(row) {
  return row.gameId === "hsr" && row.name === "黑天鹅";
}

function groupAssets(sourceRows) {
  const groups = new Map();
  for (const row of sourceRows) {
    const key = `${row.gameId}\t${row.originalValue}`;
    const group = groups.get(key) ?? {
      gameId: row.gameId,
      game: row.game,
      category: classify(row),
      originalValue: row.originalValue,
      imageFile: row.imageFile,
      imageDir: row.imageDir,
      rows: 0,
      refs: 0,
      names: new Set(),
      pages: new Set(),
      fields: new Set(),
      candidates: new Set()
    };
    group.rows += 1;
    group.refs += Number(row.refs || 0);
    group.names.add(row.name);
    group.pages.add(row.page);
    group.fields.add(row.field ?? row.fieldPath);
    for (const candidate of row.candidates ?? []) {
      group.candidates.add(candidate);
    }
    groups.set(key, group);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      names: [...group.names].filter(Boolean).sort(),
      pages: [...group.pages].filter(Boolean).sort(),
      fields: [...group.fields].filter(Boolean).sort(),
      candidates: [...group.candidates].sort()
    }))
    .sort((a, b) => b.refs - a.refs || a.category.localeCompare(b.category, "zh-Hans-CN"));
}

function classify(row) {
  const file = String(row.imageFile || row.originalValue || "");
  const raw = String(row.originalValue || "");
  if (row.gameId === "gi") {
    if (/^UI_Gcg_CardFace_/i.test(file) || /^Gcg_CardFace_/i.test(file)) return "原神 GCG 卡面/卡图";
    if (/^UI_ItemIcon_/i.test(file)) return "原神物品图标";
    if (/^UI_RelicIcon_/i.test(file)) return "原神圣遗物图标";
    if (/^UI_Home/i.test(file) || /^UI_Homeworld/i.test(file)) return "原神尘歌壶图标";
    if (/^UI_EquipIcon_/i.test(file)) return "原神武器图标";
    if (/^UI_GcgIcon_/i.test(file)) return "原神 GCG 货币/图标";
    return "原神其它";
  }
  if (row.gameId === "zzz") {
    if (/Hollow\/IconBuff|HallowBuff/i.test(raw)) return "绝区零空洞 Buff/负面效果图标";
    if (/Hollow\/IconCard|CardDailyUse/i.test(raw)) return "绝区零空洞卡片图标";
    if (/VoldFront/i.test(raw)) return "绝区零作战影像回顾图标";
    if (/ItemIcon/i.test(raw)) return "绝区零物品图标";
    if (/IconBossGeneral|BossCard|Monster/i.test(raw)) return "绝区零敌人/首领图标";
    if (/PlayerAccessory/i.test(raw)) return "绝区零饰品图标";
    if (/IconSuit|Suit/i.test(raw)) return "绝区零驱动盘套装图标";
    if (/Mindscape|IconRole/i.test(raw)) return "绝区零角色/影画图标";
    return "绝区零其它";
  }
  if (row.gameId === "nte") return "异环角色技能图标";
  return `${row.game}其它`;
}

function summarize(sourceAssets, keyFn) {
  const groups = new Map();
  for (const asset of sourceAssets) {
    const key = keyFn(asset);
    const group = groups.get(key) ?? {
      label: key,
      assets: 0,
      rows: 0,
      refs: 0,
      examples: []
    };
    group.assets += 1;
    group.rows += asset.rows;
    group.refs += asset.refs;
    if (group.examples.length < 12) {
      group.examples.push({
        name: asset.names[0],
        file: asset.imageFile,
        pages: asset.pages
      });
    }
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.assets - a.assets || b.refs - a.refs);
}

function renderMarkdown(data) {
  const lines = [];
  lines.push("# 过滤后缺图摘要");
  lines.push("");
  lines.push(`生成时间：${data.generatedAt}`);
  lines.push("");
  lines.push("过滤条件：排除条目内容中包含 `test`、`测试`、`旧测试` 的行；排除不在 `gcg.json` 主卡牌表中的 `gcg/card` 隐藏/衍生卡；排除已确认的星铁黑天鹅特殊图。");
  lines.push("");
  lines.push("## 汇总");
  lines.push("");
  for (const [key, value] of Object.entries(data.totals)) {
    lines.push(`- ${key}：${value}`);
  }
  lines.push("");
  lines.push("## 按游戏");
  lines.push("");
  for (const item of data.byGame) {
    lines.push(`- ${item.label}：${item.assets} 个唯一资源名，${item.rows} 行，${item.refs} 引用`);
  }
  lines.push("");
  lines.push("## 按类型");
  lines.push("");
  for (const item of data.byCategory) {
    lines.push(`- ${item.label}：${item.assets} 个唯一资源名，${item.rows} 行，${item.refs} 引用`);
    lines.push(`  - 示例：${item.examples.map((example) => `${example.name || "(无名)"} / ${example.file}`).join("；")}`);
  }
  return `${lines.join("\n")}\n`;
}

function exampleRow(row) {
  return {
    game: row.game,
    page: row.page,
    recordId: row.recordId,
    name: row.name,
    originalValue: row.originalValue
  };
}

function sumRefs(sourceRows) {
  return sourceRows.reduce((sum, row) => sum + Number(row.refs || 0), 0);
}
