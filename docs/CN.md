# nanoka-atlas-backend

nanoka-atlas-backend 用于将 nanoka.cc 的图鉴数据导出为本地 JSON 文件与本地图片图库。导出结果按语言、游戏、页面、分类和条目分层保存，适合作为后续图鉴前端或数据浏览工具的数据源。

## 支持范围

当前导出范围包含以下游戏：

- 崩坏：星穹铁道（HSR）
- 原神（GI）
- 绝区零（ZZZ）
- 异环（NTE）

当前导出语言包含：

- `zh`
- `en`
- `ja`
- `ko`

## 环境要求

项目使用 Yarn 4，并采用传统 `node_modules` 依赖布局。仓库内的 `.yarnrc.yml` 已配置：

```yml
nodeLinker: node-modules
enableGlobalCache: true
```

建议通过 Corepack 调用 Yarn：

```bash
corepack yarn install
```

在已启用 Corepack 且 Yarn 版本可用的环境中，也可以直接执行 `yarn install`。

## 快速开始

```bash
corepack yarn install
corepack yarn scrape
```

默认执行完整导出。脚本会刷新所有支持游戏和语言的 JSON 数据，并使用增量图片策略处理图库：已存在且远端元数据未变化的图片会被复用，新增或远端元数据变化的图片会重新下载。

## 命令

```bash
# 列出 static.nanoka.cc/manifest.json 中可用的版本信息
corepack yarn versions

# 默认完整导出：刷新 JSON，并增量更新图库
corepack yarn scrape

# 仅刷新 JSON，不下载图片
corepack yarn scrape:no-images

# 严格校验图片内容：重新下载远端图片并比较 SHA-256
corepack yarn scrape:verify

# 全量重新下载图片并覆盖本地图库
corepack yarn scrape:full

# 抽样导出：每个源页面/分类抓取少量记录，仍保留详情抓取逻辑
corepack yarn scrape:sample
node src/scrape.mjs --sample-per-page 3 --no-images

# 限定导出语言
node src/scrape.mjs --locale zh
node src/scrape.mjs --locales zh,en --no-images

# 限定导出游戏
node src/scrape.mjs --game hsr

# 指定单个游戏版本
node src/scrape.mjs --game hsr --version hsr=4.3.51

# 指定多个游戏版本
node src/scrape.mjs --versions hsr=4.3.51,gi=6.6.52,zzz=3.0.4+16078270,nte=1.1

# 强制使用 manifest 中的最新版本
node src/scrape.mjs --version latest

# 通过 HEAD 请求检查远端图片元数据是否变化
corepack yarn scrape:check

# 小批量补全缺失 remoteKey 的图片远端元数据
corepack yarn scrape:check-sample
node src/scrape.mjs --check-remote --missing-remote-key-only --remote-check-limit 500

# 审计占位图：生成额外候选 URL 并检查是否存在漏匹配的远端图片
corepack yarn audit:missing-images

# 生成中文缺图报告
corepack yarn report:missing-images

# 生成过滤后的中文缺图报告：排除测试内容、隐藏 GCG 衍生卡和已确认特殊项
corepack yarn report:missing-images:filtered

# 解析缺图对应详情页 HTML，核对页面内是否存在可复用图片链接
corepack yarn audit:page-images
```

## 网络参数

以下参数可通过环境变量调整。默认值以较高容错为目标，适用于跨区域访问或连接质量不稳定的网络环境。

| 变量 | 默认值 | 说明 |
| --- | ---: | --- |
| `REQUEST_RETRIES` | `4` | 文本和 JSON 请求的默认重试次数。 |
| `TEXT_TIMEOUT_MS` | `60000` | 页面 HTML 请求超时时间，单位为毫秒。 |
| `JSON_TIMEOUT_MS` | `120000` | 数据 JSON 请求超时时间，单位为毫秒。 |
| `IMAGE_TIMEOUT_MS` | `120000` | 图片下载超时时间，单位为毫秒。 |
| `IMAGE_RETRIES` | `4` | 图片下载重试次数。默认跟随 `REQUEST_RETRIES`。 |
| `HEAD_TIMEOUT_MS` | `60000` | 图片远端元数据 HEAD 请求超时时间，单位为毫秒。 |
| `HEAD_RETRIES` | `4` | HEAD 请求重试次数。默认跟随 `REQUEST_RETRIES`。 |
| `AUDIT_TIMEOUT_MS` | `60000` | 缺图候选 URL 审计请求超时时间，单位为毫秒。 |
| `AUDIT_RETRIES` | `4` | 缺图候选 URL 审计请求重试次数。默认跟随 `REQUEST_RETRIES`。 |
| `AUDIT_PROGRESS_INTERVAL_MS` | `30000` | 缺图审计进度输出间隔，单位为毫秒。设为 `0` 可关闭进度输出。 |
| `PAGE_AUDIT_TIMEOUT_MS` | `60000` | 详情页 HTML 与图片链接审计请求超时时间，单位为毫秒。 |
| `PAGE_AUDIT_RETRIES` | `4` | 详情页 HTML 与图片链接审计请求重试次数。默认跟随 `REQUEST_RETRIES`。 |
| `PAGE_AUDIT_PROGRESS_INTERVAL_MS` | `30000` | 页面图片链接审计进度输出间隔，单位为毫秒。设为 `0` 可关闭进度输出。 |

示例：

```powershell
$env:IMAGE_TIMEOUT_MS=180000
$env:IMAGE_RETRIES=6
corepack yarn scrape
```

## 输出结构

```text
data/
  map.json                顶层索引
  gallery-index.json      图片引用索引
  image-cache.json        成功下载图片的缓存索引与远端元数据
  items/
    简体中文/
      原神/
        角色/
          五星/
            神里绫华.json
gallery/
  _placeholder/
    unknown.svg
  gi/
  hsr/
  zzz/
  nte/
```

条目文件按以下结构保存：

```text
data/items/<语言>/<游戏>/<子页面>/<分类>/<条目名>.json
```

`data/map.json` 仅保存轻量索引信息。调用方应先读取 `data/map.json`，再根据索引中的 `path` 定位具体条目 JSON，避免在前端加载单个大型 JSON 文件。

## JSON 结构

每个条目 JSON 包含以下主要字段：

- `meta`：游戏、语言、版本、页面、条目名、稀有度、来源 URL、详情 URL、图片数量等元信息。
- `content.list`：列表数据源中的原始条目内容。
- `content.detail`：详情页或详情映射表中的原始详情内容。若对应页面没有独立详情数据源，该字段可能为空。
- `meta.images`：条目相关图片引用，包括候选 URL、下载状态、本地路径、SHA-256、远端元数据等信息。

`data/map.json` 不保存完整条目内容，仅保存索引与路径。

## 详情抓取策略

抓取逻辑以 nanoka.cc 前端实际使用的 JSON 数据源为准，主要包含以下类型：

- 列表页数据源，例如 `character.json`、`weapon.json`、`item.json`。
- 单条详情数据源，例如 `zh/character/{id}.json`、`en/lightcone/{id}.json`。
- 详情映射数据源，例如 `item_all.json`、`gcg/card.json`、`beyond/item_all.json`。

列表到详情、列表到详情映射表等二级数据会被纳入导出。挑战、卡牌、尘歌壶、零号空洞等页面只要存在前端可用的 JSON 数据源，也会按所属页面分类保存。

脚本不会对详情 JSON 中出现的关联 ID 进行无限递归抓取。若关联 ID 指向的对象属于已知页面，该对象会在其所属页面的导出结果中保存。该策略用于降低重复数据和错误关联风险。

## 图片处理策略

成功下载的图片保存至 `gallery/<game>/...`，并在 `data/image-cache.json` 中记录以下信息：

- 本地路径
- 字节数
- SHA-256
- 由 `ETag`、`Last-Modified`、`Content-Length`、`Content-Type` 组成的 `remoteKey`

增量模式下，若本地文件存在且远端元数据字符串未变化，脚本会复用本地图片。需要逐一校验图片内容时，可执行：

```bash
corepack yarn scrape:verify
```

远端确认不存在或没有可用候选 URL 的图片会使用统一占位图：

```text
gallery/_placeholder/unknown.svg
```

占位图仅用于明确缺图的情况，例如所有候选 URL 均返回 404，或原始数据无法生成有效候选 URL。网络超时、5xx、连接错误等可重试失败会记录为 `status: "error"`，不会降级为占位图。

测试、废弃或隐藏内容的条目 JSON 仍会保留。若这类条目的远端图片缺失，图片引用会使用统一占位图，但不会作为网络错误处理；后续版本如果补充了对应资源，下一次抓取会重新请求并替换占位图。

占位图和错误状态不会写入 `data/image-cache.json`。因此，当后续版本补充图片或远端资源恢复可用时，下一次抓取仍会重新请求这些图片引用。

形如 `..._{0}` 的模板图片名会保留在原始 JSON 内容中，但不会作为图库候选 URL 下载，以避免生成必然失败的图片请求。

## 审计结果

最近一次全量导出与审计结果如下：

- `data/map.json` 中包含 `hsr`、`gi`、`zzz`、`nte` 四个游戏。
- 已导出 `zh`、`en`、`ja`、`ko` 四种语言。
- 图片引用总数为 `347894`，其中已下载 `339020`，占位 `8874`。
- 当前剩余占位均为按现有规则和额外候选 URL 探测后未命中的缺图；最近一次额外审计未发现可修复命中。
- `corepack yarn audit:missing-images` 对 `1805` 个唯一占位引用额外检查了 `7723` 个唯一 URL，`hit items` 为 `0`。
- `corepack yarn audit:page-images` 检查了 `2235` 行中文缺图清单和 `14` 个页面分组；其中 `2173` 行可在页面 HTML 中找到原始路径，`105` 行仅发现同记录其它可下载图片，`0` 行发现可直接替换图片。
- `corepack yarn report:missing-images` 会刷新 `data/audits/missing-images.zh.json` 和 `data/audits/missing-images.zh.md`。当前唯一缺图行数为 `2235`。
- `corepack yarn report:missing-images:filtered` 会刷新 `data/audits/missing-images.zh.filtered.json` 和 `data/audits/missing-images.zh.filtered.md`。当前过滤后唯一资源名为 `1557`。
