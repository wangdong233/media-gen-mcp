# P0-3 · Golden byte-compare 实施规划(media-gen-mcp)

> **一句话目标**:从零为 media-gen-mcp 的 6 个本地确定性工具引入 `node:test` + golden byte-compare 套件,把 README 写的"同输入同输出可入 git"从口号变成机械门——任何 Satori/resvg/MathJax/Vega-Lite/D2 升级或字体 CDN 漂移造成的产物变化,CI 立刻抓住。
>
> **生成日期**:2026-07-21
> **作者**:P0-3 实施规划撰稿人
> **背景出处**:`doc_v11/Archify深度分析与借鉴报告.md` §P0-3(行 89-93)、§P1-11(行 169-173)、§四.P0-3(行 267-295)
> **范围**:仅限 media-gen-mcp 仓库内 **新增** `test/`、`examples/`(或并入 `test/fixtures/`)、`scripts/render-golden.mjs`、`tsconfig.test.json`,以及 **可逆地** 修改 `package.json` 的 `scripts.test`。**严禁** 改 19 个工具的 inputSchema / handler 行为 / `scripts/check-schema.mjs` 已有断言 / 任何 `src/**/*.ts`。

---

## 1. 背景与目标

### 1.1 本 P0 解决什么盲区

media-gen-mcp 的核心卖点写在 README 里:**"同输入同输出可入 git"**(确定性立场)。但当前仓库 **零自动化测试** 守护这条承诺:

- `package.json:20` 的 `scripts.test` 只是 `node scripts/check-schema.mjs`,后者(`scripts/check-schema.mjs:1-63`)只做 3 件与渲染产物无关的事:① create_video 的 `numFrames/frameRate.enum` ≡ provider `videoConstraints()`(行 44-45);② 19 工具名清单顺序匹配(行 49);③ mode/resolution 三值 enum(行 53-54)。
- `find src scripts -name "*.test.*" -o -name "*.spec.*"` → **0 命中**;无 `test/` 目录;`tsconfig.json:17` 只 `include: ["src/**/*"]`。
- 根目录 25 个 `_test_*.mjs` 全是 ad-hoc 探针(看样本 `_test_card.mjs:1-18` 直接 `import { renderCard } from "./dist/card.js"` + `console.log`,无 `assert`、无 pass/fail 计数),按惯例 `_` 前缀不入 git。memory 里的"97/97"指 `doc/OCR_测试集/` 下同类 ad-hoc 脚本,**结论成立**。

**直接后果**:Satori 升级字形、@fontsource CDN 字模更新、resvg 版本 bump、MathJax 字体包换版本、Vega-Lite 升级、D2 WASM 重打包——任何一项都可能静默改变 6 个本地工具的产物,而 CI 一路绿灯。

### 1.2 成功标准(Definition of Done 雏形)

1. **新增** `test/` 目录,跑在 Node 内置 `node:test` 上,**零新运行时依赖**(pngjs/jsqr 入 devDependencies,均 MIT/Apache-2.0)。
2. 6 个本地确定性工具各至少 1 条 golden 用例(QR SVG/PNG、formula SVG、chart SVG、card SVG/PNG 限定 CJK+无 emoji、render_svg SVG passthrough、diagram D2/Graphviz SVG)。`generate_icon` 因网络依赖,**skip 并写明理由**。
3. SVG 走 `normalizeNewlines` 后全文 `===`;PNG 走 strip-metadata 后 `Buffer.equals()` byte-compare;QR PNG 额外用 jsQR 解码回原文等比(双保险)。
4. `npm run render:golden` 一键刷新器,与 `test/golden.test.mjs` 共用同一份 `GOLDEN` 数组(读写对偶,抄 Archify 范式)。
5. `npm test` 顺序:`tsc -p tsconfig.test.json` → `node --test dist-test/` → `node scripts/check-schema.mjs`。**保留 `check-schema.mjs` 全部断言**(立场红线)。
6. CI 加 stale gate,失败信息照搬 Archify 原句结构:`fresh render differs from examples/<file>; if the change is intentional, run \`npm run render:golden\` and commit`。
7. **跨平台一致性 smoke**:在 macOS 本地刷新的 golden,在 Linux CI 必须 byte-identical 通过——若不能,提前在文档点名并降级该条用例为 pHash 或 skip。

---

## 2. 现状(带文件:行号证据)

### 2.1 测试入口真相

| 文件:行号 | 现状 | 与本 P0 关系 |
|---|---|---|
| `package.json:20` | `"test": "node scripts/check-schema.mjs"` | **必须改成** `npm run build:tests && node --test dist-test/ && node scripts/check-schema.mjs`(保留 check-schema 防漂移职责) |
| `package.json:21` | `"prepublishOnly": "npm run build && chmod +x dist/index.js && npm test"` | **不动**——改完 test 自动接住 |
| `scripts/check-schema.mjs:1-63` | spawn `dist/index.js` 走 MCP stdio `tools/list`,只锁 create_video 两 enum + 19 工具名 + mode/resolution 三值 | **保留**,不动一行 |
| `tsconfig.json:17` | `"include": ["src/**/*"]`,无 test 配置 | **不动**,新增 `tsconfig.test.json` extends 它 |
| `tsconfig.json:6-7` | `outDir: "dist"`,`rootDir: "src"` | test 必须走独立 `outDir: "dist-test"` 避免污染发布包(行号已实地核对,见 §9 未决点 12) |

### 2.2 19 工具的渲染钩子点(全部已实地核对)

所有本地确定性工具的 handler 在 `src/index.ts` 里都是同一范式——先调 `renderXxx()` 拿 `{svg?, png?, warnings?}`,再调 `writeLocalRender()`(`src/index.ts:516-535`)落盘返 `local_path`。**最佳 golden 钩子点 = 直接 `import { renderXxx } from "../dist/xxx.js"`**(与 `_test_*.mjs` 同模式,绕开 MCP stdio 子进程开销)。

| 工具 | 渲染函数(文件:行) | 返回类型 | 调用点(`src/index.ts`) |
|---|---|---|---|
| `generate_qrcode` | `renderQR` `src/qr.ts:30` | `{svg?, png?, warnings?}` | `src/index.ts:963` |
| `generate_formula` | `renderFormula` `src/formula.ts:58` | `{svg, png?}` | `src/index.ts:991` |
| `generate_chart` | `renderChart` `src/chart.ts:74` | `{svg, png?, warnings?}` | `src/index.ts:982` |
| `generate_card` | `renderCard` `src/card.ts` | `{svg?, png?, warnings?}` | `src/index.ts:1024` |
| `generate_icon` | `renderIcon` `src/icon.ts` | `{svg?, png?}` | `src/index.ts:1008` |
| `render_svg` | `renderSvg` `src/render-svg.ts:205` | `{svg?, png?, backendUsed?}` | `src/index.ts:1054` |
| `generate_diagram` | `engine.render()` `src/diagram/types.ts:41` | `{svg, png?}` | `src/index.ts:947` |

### 2.3 确定性矩阵(由调查结果核实)

| 工具 × 输出 | 确定性 | 非确定性来源 | golden 策略 |
|---|---|---|---|
| qrcode SVG | ✅ 字节级 | 无 | SVG `===` |
| qrcode PNG | ✅ 字节级 | 无(qrcode.toBuffer PNG 编码固定) | `Buffer.equals()` byte-compare + jsQR 解码双校验 |
| formula SVG | ✅ 字节级 | 无(MathJax SVG jax 字形内嵌路径,无外部字体,`src/formula.ts:6-7,72`) | SVG `===` |
| formula PNG(resvg) | ⚠️ 接近确定 | resvg PNG 编码;`src/formula.ts:94-98` `new Resvg(svg,{fitTo,background})` | strip 元数据后 byte-compare |
| chart SVG(Vega) | ⚠️ 需 run-2-times 验证 | `view.toSVG()`(`src/chart.ts:105`)理论上稳定,但需实测 | 先自检 2 次相等再 byte-compare |
| chart PNG(resvg) | ⚠️ 同上 + resvg | 同上 | strip 元数据后 byte-compare |
| card SVG/PNG(Satori+resvg) | ❌ 默认非确定 | **默认 Inter 字体走 jsDelivr CDN**(`src/card.ts:23,67-83` `fetch(${FONT_CDN}/${pkg}/files/...)`),CDN 字模变 → SVG 字形 id 变 → byte 变 | **必须**:① 用 CJK family(Noto Sans SC 是 npm 依赖 `@fontsource/noto-sans-sc` `package.json:37`,离线从 node_modules 读,`src/card.ts:115-131`);② 输入不含 emoji(避开 twemoji CDN `src/card.ts:186-231`)。或传 `fontPath` 本地字体 |
| render_svg SVG passthrough | ✅ 完全确定 | 无(直接返回输入,`src/render-svg.ts:212-214`) | 输入 == 输出,`===` |
| render_svg PNG(resvg) | ⚠️ 取决于输入 SVG | 输入含时间戳则非确定 | 固定 SVG 输入 → byte-compare(强制 `backend:'resvg'` 避开 Chrome) |
| render_svg PNG(chrome) | ❌ 非字节确定 | Chrome 抗锯齿/subpixel 随平台/显卡变 | **P0-3 不覆盖**,延后到 P0-4 用 pngjs 像素 diff |
| diagram D2 SVG | ⚠️ 需跨平台验证 | D2 WASM 浮点格式化可能 macOS/Linux 不一致 | SVG byte-compare,失败则降级 pHash |
| diagram Graphviz SVG | ⚠️ 同上 | viz.js WASM | 同上 |
| generate_icon | ❌ 网络依赖 | Iconify API(`src/icon.ts` fetch),上游版本变 | **P0-3 skip**,文档点名 |

### 2.4 现有可复用解码依赖

| 依赖 | `package.json` 声明 | 用途 |
|---|---|---|
| `@resvg/resvg-js` ^2.6.2 | `dependencies:39` | SVG→PNG(golden 产出端,**不**用于解码) |
| `@napi-rs/canvas` ^1.0.2 | `optionalDependencies:52` | 全功能 canvas;**仅 P0-4 用**(pixel-diff) |
| `pngjs` | **未直接声明**,node_modules 已存在(传递依赖 ^5.0.0,源自 qrcode@1.5.4) | 纯 JS PNG 解码;**显式入 devDependencies 锁定 `^5.0.0`**(防 qrcode 未来换依赖;实际不会被 npm prune,见 §9.11) |
| `jsqr` | **未声明,未在 node_modules** | QR PNG 解码回原文;**新增 devDependency**(Apache-2.0) |
| `sharp` | 未声明,无 | 不用 |
| `puppeteer-core` ^25.3.0 | `dependencies:44` | 仅 Chrome 路径,P0-3 不用 |

---

## 3. Archify 是怎么做的(带证据)+ 借鉴边界

### 3.1 Archify 范式核心(调查结果证实)

1. **`test/golden.mjs:33-35`** 唯一规范化:`function normalizeNewlines(text) { return text.replace(/\r\n?/g, '\n'); }`——只处理 Git 在 Windows checkout 的 CRLF,**不**做哈希、**不**做行 diff、**不**做快照容忍度。
2. **`test/golden.mjs:49-58`** 比对逻辑:`normalizeNewlines(fresh) === normalizeNewlines(checked)` 全文 UTF-8 字符串全等比较。
3. **`test/golden.mjs:55-57`** 失败信息明说怎么修:`"fresh render differs from examples/${golden}; if the change is intentional, re-render the examples and commit them"`——**把刷新流程写进错误信息**(关键 UX,必须照抄)。
4. **`test/render-examples.mjs`** 28 行刷新器,与 `golden.mjs` 共享同一 `GOLDEN`/`TARGETS` 数组,直接 `execFileSync` 把产物写到 `repoRoot/examples/`。这是 **golden 对偶**:同一份配置驱动刷新器和验证器,保证永远只比那几个文件。
5. **`test/golden.mjs:101-117`** 模板新鲜度:`examples/web-app.html`(hand-curated)的 `<style>`/`<script>` 块必须逐字等于 `assets/template.html`。
6. **`test/golden.mjs:119-145`** 版本同步:同一版本号要在 6 处一致(template meta、package-lock.json、SKILL.md、3 个 README badge、docs/index.html)。
7. **flaky 消除靠"渲染器纯函数化"**:对全部 5 渲染器 + shared/utils.mjs + shared/cli.mjs + assets/template.html 做 grep `Date.now|new Date|Math.random|crypto.random|Date\(\)|builtAt|generatedAt|process.pid` → 全部 CLEAN。无固定种子需求,因为根本没有随机源可固定。
8. **`test/degraded.test.mjs`** 先决保证:`assert.doesNotMatch(html, /NaN|undefined/)`——渲染器任何产生 NaN 的 bug 会先被这个测试抓住,不会污染 golden。

### 3.2 可借鉴(直搬)

| 范式 | 怎么搬 |
|---|---|
| `normalizeNewlines` 唯一规范化 | 1:1 复制,10 行 |
| 全文 `===` 字符串比较(SVG 类) | 1:1 复制 |
| golden 对偶(刷新器 + 验证器共用 GOLDEN 数组) | 1:1 复制 |
| 失败信息写清刷新命令 | 1:1 复制原句结构 |
| NaN/undefined 先决守门 | 1:1 加一条 `assert.doesNotMatch(svg, /NaN|undefined/)` |
| CI stale gate 不能跳过 | 加 `.github/workflows/ci.yml` job |

### 3.3 不借鉴(立场或边际价值)

| 范式 | 不搬原因 |
|---|---|
| Archify 的"模板新鲜度"(hand-curated HTML vs template.html) | media-gen-mcp **没有** hand-curated 产物,只有引擎渲染产物,无对应面 |
| Archify 的"版本同步 6 处一致" | media-gen-mcp 是 npm 包,版本同步由 `prepublishOnly` + npm registry 保证,不需要 README badge cross-check |
| Archify 的 ajv standalone codegen stale gate | 与 P0-3 无关,属 P1-12 范畴 |
| Archify 的 zip-freshness 整树 diff | media-gen-mcp 的 `files: ["dist","README.md","README.en.md"]`(`package.json:10-14`)由 npm 自动打包,无手动 zip 工件,无对应需求 |
| Archify 的"5 类图专用 JSON-IR" | media-gen-mcp 是横向 19 工具,golden 用每个工具的原生输入(text/LaTeX/Vega-Lite spec/Satori props/DSL/SVG)即可 |

### 3.4 License 边界(立场红线)

- Archify bundle 中**未明确写出 LICENSE 文件**(报告 §2.1 表格、§5.6 已点名)。本规划 **全部 reimplement**,不引用 Archify 任何源码。
- `normalizeNewlines` 是 10 行通用正则,无 license 顾虑。
- pHash 算法公知;**P0-3 默认不用 pHash**(只在跨平台 SVG byte-compare 失败的 fallback 路径才考虑)。
- pngjs(MIT)、jsqr(Apache-2.0)均与 media-gen-mcp MIT 立场兼容。

---

## 4. 详细实施方案

### 4.1 目录结构(全部为**新增**,不动 src/)

```
media-gen-mcp/
├── tsconfig.test.json              # [新增] extends tsconfig.json,outDir=dist-test
├── package.json                    # [改] scripts 加 build:tests / render:golden,test 改三段式
├── scripts/
│   ├── check-schema.mjs            # [不动] 保留全部 3 条断言
│   └── render-golden.mjs           # [新增] 刷新器,与 test/golden.test.mjs 共享 GOLDEN 数组
├── test/
│   ├── golden/
│   │   ├── golden.config.ts        # [新增] GOLDEN 数组(单一真相源,刷新器+验证器共用)
│   │   ├── helpers.ts              # [新增] normalizeNewlines / stripPngMetadata / compareSvg / comparePng
│   │   ├── fixtures/               # [新增] 输入fixtures(同输入同输出立场要求入 git)
│   │   │   ├── qr/
│   │   │   │   ├── basic.txt
│   │   │   │   └── url.json        # 参数化输入(JSON: {text, margin, dark, light, format})
│   │   │   ├── formula/
│   │   │   │   ├── basic.tex
│   │   │   │   └── display_frac.json
│   │   │   ├── chart/
│   │   │   │   └── bar-basic.json  # Vega-Lite spec
│   │   │   ├── card/
│   │   │   │   └── cjk-og.json     # fontFamily: "Noto Sans SC",无 emoji
│   │   │   ├── render-svg/
│   │   │   │   └── passthrough.svg # 固定输入 SVG
│   │   │   └── diagram/
│   │   │       ├── d2-basic.d2
│   │   │       └── graphviz-basic.dot
│   │   └── expected/               # [新增] 已 commit 的 golden 产物
│   │       ├── qr/basic.svg
│   │       ├── qr/url.png
│   │       ├── formula/basic.svg
│   │       ├── chart/bar-basic.svg
│   │       ├── card/cjk-og.svg
│   │       ├── render-svg/passthrough.svg
│   │       ├── diagram/d2-basic.svg
│   │       └── diagram/graphviz-basic.svg
│   ├── golden.test.ts              # [新增] node:test runner,主入口
│   └── determinism.test.ts         # [新增] 同输入连跑 2 次自检(先决保证)
└── dist-test/                      # [gitignore] tsc 输出
```

**为什么 fixtures 放 `test/golden/fixtures/` 而非仓库根 `examples/`**:
- Archify 用根 `examples/` 是因为它的 skill 形态需要用户可见的 demo 画廊。
- media-gen-mcp 是 MCP server,**没有"用户可见 demo"需求**;统一放 `test/golden/` 让测试自包含,降低根目录噪音,符合同输入同输出立场(fixtures 本身就是"入 git 的代表性输入")。
- 若后续要加 P1-10 的 A/B/C 盲评实验,那时再单独建 `experiments/`,与 golden 不混。

### 4.2 `tsconfig.test.json`(新增,extends 现有,不动主配置)

```jsonc
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": "./",          // ← 必须改,主配置是 "src"
    "outDir": "dist-test",    // ← 避免污染发布包 dist/
    "sourceMap": false,
    "declaration": false,
    "noUnusedLocals": false    // 测试代码允许未用变量(放宽)
  },
  "include": ["src/**/*", "test/**/*"]
}
```

**注意**:`rootDir` 必须改为 `./`,否则 tsc 报 "test/ 不在 rootDir 下"。这是唯一与主 tsconfig 不一致的项,文档点名。

### 4.3 `package.json` 改动(最小集,可逆)

```jsonc
{
  "scripts": {
    "build": "tsc",
    "build:tests": "tsc -p tsconfig.test.json",           // [新增]
    "start": "node dist/index.js",
    "dev": "tsc -w",
    "inspect": "npx @modelcontextprotocol/inspector node dist/index.js",
    "test": "npm run build:tests && node --test dist-test/ && node scripts/check-schema.mjs",  // [改]
    "render:golden": "npm run build && npm run build:tests && node dist-test/scripts/render-golden.js",  // [新增]
    "prepublishOnly": "npm run build && chmod +x dist/index.js && npm test"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/qrcode": "^1.5.6",
    "typescript": "^5.6.0",
    "pngjs": "^5.0.0",     // [新增] 显式锁定;版本与 qrcode@1.5.4 传递依赖 (^5.0.0) 对齐(传递依赖实际不会被 prune,显式锁定为防 qrcode 未来换依赖,见 §9.11)
    "jsqr": "^1.4.0"       // [新增] QR 解码验证
  }
}
```

**红线守护**:
- `check-schema.mjs` 保留在 test 链最末,**不动一行**。
- `prepublishOnly` 不动,自动接住新的 test 链。
- 发布包 `files: ["dist","README.md","README.en.md"]`(`package.json:10-14`)**不含** `test/` / `dist-test/` / `examples/`——golden 套件不进 npm 包体积,符合"零安装负担"。

### 4.4 `test/golden/helpers.ts` 关键骨架

```ts
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import jsQR from "jsqr";

/** Archify 直搬:唯一规范化,只处理 CRLF。不过度规范化(会掩盖真回归)。 */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** SVG byte-compare:规范化后全文 ===。 */
export function compareSvg(fresh: string, checked: string): { ok: boolean; diff?: string } {
  const a = normalizeNewlines(fresh);
  const b = normalizeNewlines(checked);
  if (a === b) return { ok: true };
  // 失败时给前后 80 字符的 first-diff 上下文,降低排查成本
  const i = [...a].findIndex((c, idx) => c !== b[idx]);
  return {
    ok: false,
    diff: `first diff at char ${i}: fresh=${JSON.stringify(a.slice(Math.max(0, i - 40), i + 40))} checked=${JSON.stringify(b.slice(Math.max(0, i - 40), i + 40))}`,
  };
}

/**
 * PNG 元数据 strip:解析 PNG chunks,丢弃 tEXt/zTXt/iTXt/tIME/eXIf/pHYs,
 * 只保留 IHDR + PLTE/tRNS(若存在)+ IDAT(+IEND)。规避 resvg/libpng 不同版本写不同 Software 字段。
 * 等价命令行:pngcrush -ow -rem allb
 */
export function stripPngMetadata(buf: Buffer): Buffer {
  // PNG signature: 8 bytes;之后是 chunks:4B length + 4B type + data + 4B CRC
  const KEEP = new Set(["IHDR", "PLTE", "tRNS", "IDAT", "IEND"]);
  const out: Buffer[] = [buf.subarray(0, 8)]; // signature
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const chunkEnd = off + 12 + len; // 4(len)+4(type)+len(data)+4(CRC)
    if (KEEP.has(type)) out.push(buf.subarray(off, chunkEnd));
    off = chunkEnd;
  }
  return Buffer.concat(out);
}

/** PNG byte-compare:strip 后 Buffer.equals()。 */
export function comparePng(fresh: Buffer, checked: Buffer): { ok: boolean; reason?: string } {
  const a = stripPngMetadata(fresh);
  const b = stripPngMetadata(checked);
  if (a.equals(b)) return { ok: true };
  return {
    ok: false,
    reason: `fresh ${fresh.length}B / checked ${checked.length}B; after strip: ${a.length}B vs ${b.length}B`,
  };
}

/** QR 双校验:byte-compare + jsQR 解码回原文等比。 */
export function verifyQrPng(png: Buffer, expectedText: string): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  // PNG 解码 → Uint8Array RGBA
  const parsed = PNG.sync.read(png);
  const decoded = jsQR(new Uint8ClampedArray(parsed.data), parsed.width, parsed.height);
  if (!decoded) reasons.push("jsQR 解码失败(扫码器可能识别不出)");
  else if (decoded.data !== expectedText) reasons.push(`jsQR 解码 ≠ 原文:得 ${JSON.stringify(decoded.data)}`);
  return { ok: reasons.length === 0, reasons };
}

/** Archify NaN 守门:先决保证,任何 NaN/undefined 都不会污染 golden。 */
export function assertNoNaNOrUndefined(svg: string): void {
  if (/NaN|undefined/.test(svg)) {
    throw new Error(`rendered SVG contains NaN/undefined (would corrupt golden): ${svg.slice(0, 200)}...`);
  }
}
```

### 4.5 `test/golden/golden.config.ts`(单一真相源)

```ts
/**
 * GOLDEN 数组 —— 刷新器和验证器共用,保证永远只比这里列出的文件。
 * 任何新增工具的 golden 用例,**只能在此追加**,不要在测试文件里另起。
 */
export interface GoldenCase {
  id: string;              // 唯一 id,用于 describe/test name
  tool: "qrcode" | "formula" | "chart" | "card" | "render_svg" | "diagram";
  fixturePath: string;     // 相对 test/golden/fixtures/
  expectedPath: string;    // 相对 test/golden/expected/
  compareStrategy: "svg-byte" | "png-byte" | "qr-png-verify";
  skipReason?: string;     // 若设置,测试 it.skip 并打印原因
}

export const GOLDEN: GoldenCase[] = [
  // ── QR(最确定,优先做)──
  { id: "qr-basic-svg",   tool: "qrcode", fixturePath: "qr/basic.txt",   expectedPath: "qr/basic.svg",   compareStrategy: "svg-byte" },
  { id: "qr-url-png",     tool: "qrcode", fixturePath: "qr/url.json",    expectedPath: "qr/url.png",     compareStrategy: "qr-png-verify" },

  // ── formula(MathJax SVG 字形内嵌,字节确定)──
  { id: "formula-basic-svg", tool: "formula", fixturePath: "formula/basic.tex", expectedPath: "formula/basic.svg", compareStrategy: "svg-byte" },

  // ── chart(Vega,需 run-2-times 自检通过后启用)──
  { id: "chart-bar-svg",  tool: "chart", fixturePath: "chart/bar-basic.json", expectedPath: "chart/bar-basic.svg", compareStrategy: "svg-byte" },

  // ── card(限定 CJK family + 无 emoji,避开 CDN)──
  { id: "card-cjk-svg",   tool: "card", fixturePath: "card/cjk-og.json", expectedPath: "card/cjk-og.svg", compareStrategy: "svg-byte" },

  // ── render_svg passthrough(完全确定)──
  { id: "rsvg-passthrough-svg", tool: "render_svg", fixturePath: "render-svg/passthrough.svg", expectedPath: "render-svg/passthrough.svg", compareStrategy: "svg-byte" },

  // ── diagram D2/Graphviz(跨平台验证后启用)──
  { id: "diagram-d2-svg",      tool: "diagram", fixturePath: "diagram/d2-basic.d2",      expectedPath: "diagram/d2-basic.svg",      compareStrategy: "svg-byte" },
  { id: "diagram-graphviz-svg",tool: "diagram", fixturePath: "diagram/graphviz-basic.dot",expectedPath: "diagram/graphviz-basic.svg",compareStrategy: "svg-byte" },

  // ── icon:网络依赖,P0-3 skip──
  { id: "icon-skip", tool: "render_svg" as any, fixturePath: "", expectedPath: "", compareStrategy: "svg-byte",
    skipReason: "generate_icon 依赖 Iconify API(网络),byte 不稳定;待 P0-4 加 fixture mock fetch 后再覆盖" },
];
```

### 4.6 `test/golden.test.ts` 主入口骨架

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderQR } from "../dist/qr.js";
import { renderFormula } from "../dist/formula.js";
import { renderChart } from "../dist/chart.js";
import { renderCard } from "../dist/card.js";
import { renderSvg } from "../dist/render-svg.js";
import { getDiagramEngine } from "../dist/diagram/render.js";
import { GOLDEN } from "./golden/golden.config.js";
import { compareSvg, comparePng, verifyQrPng, assertNoNaNOrUndefined } from "./golden/helpers.js";

const FIXTURES = path.resolve("test/golden/fixtures");
const EXPECTED = path.resolve("test/golden/expected");

/** 渲染分派:fixturePath → {svg?, png?} */
async function render(tool: string, fixturePath: string): Promise<{ svg?: string; png?: Buffer; input: any }> {
  const abs = path.join(FIXTURES, fixturePath);
  if (tool === "qrcode") {
    // .txt 直接当 text;.json 当完整参数
    if (fixturePath.endsWith(".txt")) {
      const text = readFileSync(abs, "utf8").trim();
      const format = fixturePath.endsWith(".png") ? "png" : "svg"; // 由 expectedPath 推断
      return { input: text, ...(await renderQR({ text, format: "svg" })) }; // svg 用例走 svg
    }
    const params = JSON.parse(readFileSync(abs, "utf8"));
    return { input: params.text, ...(await renderQR(params)) };
  }
  if (tool === "formula") {
    const tex = readFileSync(abs, "utf8").trim();
    return { input: tex, ...(await renderFormula({ tex, format: "svg" })) };
  }
  if (tool === "chart") {
    const spec = JSON.parse(readFileSync(abs, "utf8"));
    return { input: spec, ...(await renderChart({ spec, format: "svg" })) };
  }
  if (tool === "card") {
    const props = JSON.parse(readFileSync(abs, "utf8"));
    return { input: props, ...(await renderCard({ ...props, format: "svg" })) };
  }
  if (tool === "render_svg") {
    const svg = readFileSync(abs, "utf8");
    return { input: svg, ...(await renderSvg({ svg, format: "svg" })) };
  }
  if (tool === "diagram") {
    const code = readFileSync(abs, "utf8");
    // engine 由文件扩展名推断:.d2 → d2, .dot → graphviz
    const engineName = fixturePath.endsWith(".dot") ? "graphviz" : "d2";
    const engine = getDiagramEngine(engineName)!;
    return { input: code, ...(await engine.render({ code, engine: engineName as any, format: "svg" })) };
  }
  throw new Error(`unknown tool: ${tool}`);
}

describe("golden byte-compare", () => {
  for (const c of GOLDEN) {
    const fn = c.skipReason ? it.skip : it;
    fn(c.id, async () => {
      const { svg, png, input } = await render(c.tool, c.fixturePath);
      const expected = readFileSync(path.join(EXPECTED, c.expectedPath));

      if (c.compareStrategy === "svg-byte") {
        if (!svg) throw new Error(`${c.id}: renderer 未返 svg`);
        assertNoNaNOrUndefined(svg);
        const checked = expected.toString("utf8");
        const r = compareSvg(svg, checked);
        assert.ok(r.ok, `${c.id}: fresh render differs from ${c.expectedPath}; if the change is intentional, run \`npm run render:golden\` and commit. ${r.diff ?? ""}`);
      } else if (c.compareStrategy === "png-byte") {
        if (!png) throw new Error(`${c.id}: renderer 未返 png`);
        const r = comparePng(png, expected);
        assert.ok(r.ok, `${c.id}: fresh PNG differs from ${c.expectedPath}; if intentional, run \`npm run render:golden\`. ${r.reason ?? ""}`);
      } else if (c.compareStrategy === "qr-png-verify") {
        if (!png) throw new Error(`${c.id}: renderer 未返 png`);
        const r = comparePng(png, expected);
        assert.ok(r.ok, `${c.id}: QR PNG byte differs. ${r.reason ?? ""}`);
        // 双保险:jsQR 解码回原文
        const v = verifyQrPng(png, String(input));
        assert.ok(v.ok, `${c.id}: QR decode verify failed: ${v.reasons.join("; ")}`);
      }
    });
  }
});
```

### 4.7 `test/determinism.test.ts`(先决保证)

抄 Archify 的"渲染器纯函数化"扫描范式 + run-2-times 自检。

> **scope 红线(2026-07-21 修订,见 §9 未决点 13)**:grep **不能扫全 `src/`**,必须限定到 P0-3 覆盖的 6 个本地确定性渲染目标。原因:media-gen-mcp `src/` 远大于 Archify `src/`(后者只含渲染器),照搬"全 src/"会误伤 providers/handlers/pdf 管线/render-video.ts 等非渲染代码的合法 `Date.now`/`process.pid`(rate-limit 冷却、job ID、tmpDir 命名、elapsed 计时)。实测原写法扫全 `src/` 命中 47 行,filter 是 no-op(`writeLocalRender` 字面匹配抓不到第 524 行的 `Date.now`),首跑必红。**narrowed scope 实测 6 文件全 0 匹配**。

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";

describe("renderer determinism(先决保证)", () => {
  it("6 个本地确定性渲染目标无 Math.random/Date.now/new Date/crypto.random/process.pid 调用", () => {
    // scope 限定到 P0-3 覆盖的 6 个本地确定性渲染目标,不扫全 src/。
    // 不含 src/icon.ts(网络依赖,P0-3 skip);不含 src/render-video.ts(video,P0-3 范围外);
    // 不含 src/pdf/*(异步 job 管,P0-3 范围外)。详见 §9 未决点 13。
    // 注:grep 文件粒度无法只扫 render-svg.ts 的 resvg 路径,但整文件已 0 匹配,无影响。
    const out = execSync(
      `grep -rnE "Date\\.now|new Date|Math\\.random|crypto\\.random|process\\.pid|builtAt|generatedAt" ` +
      `src/qr.ts src/formula.ts src/chart.ts src/card.ts src/render-svg.ts src/diagram/ || true`,
      { encoding: "utf8" },
    ).trim();
    // narrowed scope 后无需任何白名单(原 writeLocalRender filter 已废,见 §9 未决点 13)
    const lines = out.split("\n").filter((l) => l.trim());
    assert.equal(lines.length, 0, `renderer 中发现时间/随机源,golden 会 flaky:\n${lines.join("\n")}`);
  });

  it("同输入连跑 2 次产物 byte-identical(以 formula 为代表)", async () => {
    const { renderFormula } = await import("../dist/formula.js");
    const a = await renderFormula({ tex: "E=mc^2", format: "svg" });
    const b = await renderFormula({ tex: "E=mc^2", format: "svg" });
    assert.equal(a.svg, b.svg, "formula 同输入两次渲染不一致,无法做 golden");
  });

  it("Vega chart 同输入连跑 2 次产物 byte-identical(回答调查未决问题)", async () => {
    const { renderChart } = await import("../dist/chart.js");
    const spec = { mark: "bar", encoding: { x: { field: "a", type: "nominal" }, y: { field: "v", type: "quantitative" } }, data: { values: [{ a: "A", v: 28 }, { a: "B", v: 55 }] } };
    const a = await renderChart({ spec, format: "svg" });
    const b = await renderChart({ spec, format: "svg" });
    assert.equal(a.svg, b.svg, "Vega view.toSVG 同输入两次不一致,golden 需降级");
  });
});
```

### 4.8 `scripts/render-golden.mjs` 刷新器

```js
// 28-50 行。与 test/golden/golden.config.ts 共享 GOLDEN 数组(经 dist-test/ 编译后 import)。
// 设计与 Archify render-examples.mjs 完全对偶:同一配置,只换输出路径(覆盖 expected/)。
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { GOLDEN } from "../dist-test/test/golden/golden.config.js";
// import render 分派函数(从测试文件抽出到 test/golden/render.ts,刷新器复用)
import { render } from "../dist-test/test/golden/render.js";

const EXPECTED = path.resolve("test/golden/expected");
await mkdir(EXPECTED, { recursive: true });

let updated = 0, skipped = 0;
for (const c of GOLDEN) {
  if (c.skipReason) { skipped++; continue; }
  const { svg, png } = await render(c.tool, c.fixturePath);
  const out = path.join(EXPECTED, c.expectedPath);
  await mkdir(path.dirname(out), { recursive: true });
  if (c.compareStrategy === "svg-byte") await writeFile(out, svg, "utf8");
  else if (c.compareStrategy === "png-byte" || c.compareStrategy === "qr-png-verify") await writeFile(out, png);
  console.log(`  ✓ ${c.id} → test/golden/expected/${c.expectedPath}`);
  updated++;
}
console.log(`\n=== ${updated} golden refreshed, ${skipped} skipped ===`);
console.log("Next: git diff test/golden/expected/  # 人工 review 每个 byte 变化");
console.log("      git commit -am 'refresh golden after <reason>'");
```

### 4.9 `.github/workflows/ci.yml`(CI stale gate)

```yaml
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [20, 22]   # 覆盖 Node 20(LTS)与 22(current)
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: npm
      - run: npm ci                       # 锁版本,不用 install
      - run: npm run build
      - run: npm test                     # 三段式:build:tests → node --test → check-schema
```

**关键**:`npm ci` 而非 `npm install`,锁死 Satori/resvg/D2-WASM/MathJax/Vega-Lite/pngjs/jsqr 版本,杜绝 lockfile 漂移造成的假阳性。

### 4.10 步骤分解(可勾选 TODO,带工时)

> 工时假设:中级 Node/TS 工程师,熟悉 media-gen-mcp 代码;含联调与文档。

#### 阶段 A:基建(0.5 天)
- [ ] **A1**(15 min)写 `tsconfig.test.json`,本地 `npx tsc -p tsconfig.test.json` 通过,`dist-test/` 出 14+ 个 .js
- [ ] **A2**(15 min)改 `package.json`:加 `build:tests` / `render:golden` scripts,改 `test`,加 `pngjs`/`jsqr` 到 devDependencies
- [ ] **A3**(30 min)`npm install` 确认 pngjs/jsqr 装入 node_modules;`node --test` 不加参数跑空也能 OK
- [ ] **A4**(15 min)`.gitignore` 加 `dist-test/`

#### 阶段 B:helpers + config(0.5 天)
- [ ] **B1**(45 min)写 `test/golden/helpers.ts`(normalizeNewlines / stripPngMetadata / compareSvg / comparePng / verifyQrPng / assertNoNaNOrUndefined)
- [ ] **B2**(30 min)写 `test/golden/golden.config.ts`(GOLDEN 数组,只列 P0-3 范围 7 条 + 1 条 icon skip)
- [ ] **B3**(30 min)从 `test/golden.test.ts` 抽 `render()` 分派到 `test/golden/render.ts`(刷新器复用)
  - **注意(2026-07-21 补,见 §9 未决点 14)**:抽离时需把 §4.6 的 8 条 import 同步重写——
    - **6 条 dist imports 多下钻一层**:`../dist/qr.js` → `../../dist/qr.js`、`../dist/formula.js` → `../../dist/formula.js`、`../dist/chart.js` → `../../dist/chart.js`、`../dist/card.js` → `../../dist/card.js`、`../dist/render-svg.js` → `../../dist/render-svg.js`、`../dist/diagram/render.js` → `../../dist/diagram/render.js`
    - **2 条本目录 imports 去 golden/ 前缀**:`./golden/golden.config.js` → `./golden.config.js`、`./golden/helpers.js` → `./helpers.js`
    - §4.8 刷新器从 `../dist-test/test/golden/render.js` import render,路径**无需改**

#### 阶段 C:determinism 自检(0.5 天)
- [ ] **C1**(45 min)写 `test/determinism.test.ts`,跑通 grep + formula 2× + chart 2×
- [ ] **C2**(关键,30 min)**回答调查未决问题 1**:实测 Vega chart 同输入 2 次 SVG 是否完全相等。若不等 → golden 降级或 skip;若相等 → 入 config
- [ ] **C3**(15 min,工时下调)实测确认 narrowed scope 的 6 个本地确定性渲染目标 grep 命中 0 行(已由 §9 未决点 13 核实为 0 匹配,本步仅作 regression 守护;原 writeLocalRender filter 已废)

#### 阶段 D:首批 golden(QR + formula + render_svg passthrough,1 天)
- [ ] **D1**(30 min)准备 fixtures:`qr/basic.txt`、`qr/url.json`、`formula/basic.tex`、`render-svg/passthrough.svg`
- [ ] **D2**(30 min)写 `test/golden.test.ts` 主入口,跑首 4 条用例
- [ ] **D3**(1 h)首跑必然 fail(无 expected/),`npm run render:golden` 刷新,人工 `git diff` review,commit
- [ ] **D4**(30 min)再跑 `npm test` 全绿

#### 阶段 E:扩展(card + chart + diagram,1.5 天)
- [ ] **E1**(1.5 h)card fixture:`card/cjk-og.json`(`fontFamily: "Noto Sans SC"`,title/subtitle 含中文,无 emoji),实测 Satori 离线加载 @fontsource/noto-sans-sc,刷新 golden
- [ ] **E2**(45 min)chart fixture:`chart/bar-basic.json`,刷新 golden
- [ ] **E3**(1 h)diagram fixtures:`diagram/d2-basic.d2`、`diagram/graphviz-basic.dot`,刷新 golden
- [ ] **E4**(1.5 h)**回答调查未决问题 3**:macOS 本地刷新的 diagram SVG,**实测** Linux CI 是否 byte-identical。若不等 → 在 config 加 `skipReason: "D2/Graphviz WASM 跨平台 byte 不一致,见 open point 3"`,延后到 P0-4 用 pHash

#### 阶段 F:刷新器 + CI(0.5 天)
- [ ] **F1**(30 min)写 `scripts/render-golden.mjs`,跑 `npm run render:golden` 验证与测试读侧对偶
- [ ] **F2**(30 min)写 `.github/workflows/ci.yml`
- [ ] **F3**(30 min)故意改一行 Satori 字体配置触发 golden fail,确认失败信息含"run \`npm run render:golden\`",再回滚

#### 阶段 G:文档 + 收尾(0.5 天)
- [ ] **G1**(30 min)README 加"测试"小节,说明 `npm test` 三段式 + 刷新流程
- [ ] **G2**(30 min)CONTRIBUTING(若有)或 README 加"如何加新 golden 用例"5 步说明(写 fixture → 入 config → 跑测红 → 刷新 → commit)
- [ ] **G3**(15 min)删除一个根目录 `_test_*.mjs` 改名建议(不动,因为是 `_` 前缀私有文件,只建议后续清理)

**总工时**:**5 天**(含跨平台验证 + 联调)。若跨平台 byte-compare 失败需降级 pHash,**+1 天**。

---

## 5. 测试方案

### 5.1 如何验证不破坏现有行为

| 现有行为 | 守护方式 |
|---|---|
| `scripts/check-schema.mjs` 3 条断言(G1/G2/G3) | **保留在 test 链最末**:`npm test` = `build:tests && node --test && node scripts/check-schema.mjs`。任何一条 fail 整体 fail |
| 19 工具 inputSchema 不变 | P0-3 **不**改 `src/**/*.ts` 一行,只 import dist/ 里的 `renderXxx` |
| handler 行为不变 | golden 直接调 `renderXxx`,**绕开** handler,等于在更底层校验;handler 测试不在 P0-3 范围(属 P0-4) |
| `prepublishOnly`(`package.json:21`) | 不动,自动接住新 test 链 |
| 发布包体积 | `files: ["dist","README.md","README.en.md"]` 不含 test/,dist-test/,fixtures/,expected/ |

### 5.2 新增测试一览

| 测试文件 | 用例数 | 用途 |
|---|---|---|
| `test/determinism.test.ts` | 3 | grep 时间/随机源 + formula/chart run-2-times(先决保证) |
| `test/golden.test.ts` | GOLDEN 数组长度(初版 8:7 active + 1 icon skip) | 渲染产物 byte-compare |

### 5.3 故障注入验证(必须做)

- 在本地分支故意改 `src/qr.ts` 一行(如改默认 margin 从 2 → 3),`npm test` 应该:
  - `[FAIL] qr-basic-svg: fresh render differs from qr/basic.svg; if the change is intentional, run \`npm run render:golden\` and commit. first diff at char N: ...`
- 回滚改动,`npm test` 应该恢复全绿。
- 同样对 `src/card.ts` 字体配置、`src/formula.ts` em 默认值各做一次,验证 golden 灵敏度。

---

## 6. 向后兼容策略

| 维度 | 兼容性 |
|---|---|
| 19 工具 inputSchema | **零变化**(不动 src/) |
| MCP 调用方(Claude/Codex/任意 MCP client) | **零感知**(P0-3 纯测试基建,不进发布包) |
| `scripts/check-schema.mjs` | **零变化**,作为 test 链第三段保留 |
| `prepublishOnly` | **零变化**,自动接住 |
| Node 版本 | `engines.node: ">=18"`(`package.json:23-25`)→ `node:test` 自 Node 18 内置,**无版本风险**。CI 矩阵跑 Node 20+22 |
| 现有 `_test_*.mjs` ad-hoc 探针 | **不动**(用户私有草稿,`_` 前缀按惯例不入 git;P0-3 不依赖它们) |
| TypeScript 配置 | 主 `tsconfig.json` **不动**;新增 `tsconfig.test.json` 单独 extends |

---

## 7. 风险与缓解(含 license 风险)

### 7.1 技术风险

| 风险 | 概率 | 缓解 |
|---|---|---|
| **跨平台 byte 不一致**(D2/Graphviz WASM macOS vs Linux 浮点格式化) | **中** | 步骤 E3 实测;若 fail → config 加 skipReason + 延后 P0-4 pHash;**绝不**用宽容 diff(掩盖真回归) |
| **Satori CDN 字体 flaky**(默认 Inter 走 jsDelivr) | **高**(若用默认配置) | **强制** card fixture 用 CJK family(`@fontsource/noto-sans-sc` 是 npm 依赖,离线)+ 无 emoji;**禁止** card fixture 走默认 Inter |
| **resvg PNG 元数据 flaky**(tEXt/tIME chunk) | **低-中** | helpers.ts 的 stripPngMetadata 强制走(等价 `pngcrush -rem allb`);步骤 D 实测一张 PNG strip 前后 diff 确认 |
| **Vega view.toSVG() 输出不字节稳定** | **未知**(调查未决) | 步骤 C2 实测 2 次连跑;若 fail → chart golden 降级 pHash ≥0.95 或 skip |
| **@napi-rs/canvas optionalDep 不装上** | 低 | P0-3 **不依赖** @napi-rs/canvas,只用 pngjs(显式 devDep);@napi-rs/canvas 留给 P0-4 |
| **pngjs 传递依赖被 npm 优化裁掉** | **低**(实地核实:pngjs 是 qrcode@1.5.4 运行时 dependencies,不会被 prune,见 §9.11) | 显式入 `devDependencies: "pngjs": "^5.0.0"`,锁版本防 qrcode 未来换依赖;与 qrcode 传递版本对齐避免 npm 嵌套两份 |
| **golden 全批量刷新**(引擎升级) | 预期 | 流程化:`npm run render:golden` → 人工 `git diff test/golden/expected/` review → commit;CI 二次校验 |
| **CI matrix Node 版本差异** | 低 | Node 20+22 都支持 `node:test`;Node 18 EOL 后可移除 18 |

### 7.2 License 风险

| 资产 | License | 与 media-gen-mcp MIT 立场兼容? |
|---|---|---|
| Archify 范式(思路) | 未明 | **全部 reimplement,不抄源码**(本规划代码骨架为自研) |
| `normalizeNewlines` 函数 | 通用正则,无版权 | ✅ |
| `pngjs` | MIT | ✅ |
| `jsqr` | Apache-2.0 | ✅ |
| `@fontsource/noto-sans-sc` | OFL-1.1(字体)+ MIT(npm 包) | ✅(字体 OFL 允许嵌入使用) |
| `@napi-rs/canvas` | MIT | ✅(P0-4 才用) |
| `@resvg/resvg-js` | MPL-2.0 | ✅(已在 dependencies,P0-3 不动它) |
| **pHash 算法** | 公知 | ✅(本 P0 默认不用,降级时考虑) |

**结论**:零 license 冲突。

### 7.3 工程风险

| 风险 | 缓解 |
|---|---|
| **测试拖慢 CI** | 7 条 golden 各跑 <1s(本地渲染,无网络),总 <10s;check-schema.mjs 约 3s。整体 <15s |
| **开发者忘记刷新 golden** | 失败信息明说怎么修(照搬 Archify 句式);CI stale gate 不能跳过 |
| **fixture 输入不规范** | 所有 fixtures 是 JSON/文本/SVG,可读可 review,不靠魔法常量 |
| **过度工程** | P0-3 只覆盖 6 个本地确定性工具的 SVG(及少量 PNG);render_svg Chrome 路径、generate_image、create_video 全延后到 P0-4 |

---

## 8. 验收清单(Definition of Done)

### 8.1 代码 DoD

- [ ] `tsconfig.test.json` 新建,`npx tsc -p tsconfig.test.json` 通过零错误
- [ ] `package.json` 改动:`build:tests` / `render:golden` 加,`test` 改三段式,`pngjs`/`jsqr` 入 devDependencies
- [ ] `test/golden/golden.config.ts` 含至少 7 条 active + 1 条 icon skip
- [ ] `test/golden/helpers.ts` 实现 normalizeNewlines / stripPngMetadata / compareSvg / comparePng / verifyQrPng / assertNoNaNOrUndefined
- [ ] `test/golden.test.ts` 跑通所有 GOLDEN 用例
- [ ] `test/determinism.test.ts` 跑通 3 条用例(grep + formula 2× + chart 2×)
- [ ] `test/golden/render.ts`(刷新器与测试共用的 render 分派)
- [ ] `scripts/render-golden.mjs` 一键刷新
- [ ] `.github/workflows/ci.yml` 加 test job(Node 20+22 矩阵)
- [ ] `.gitignore` 加 `dist-test/`

### 8.2 行为 DoD

- [ ] `npm test` 本地全绿
- [ ] 故意改 qr.ts 默认 margin → golden fail 且信息含 "run \`npm run render:golden\`"
- [ ] `npm run render:golden` 刷新后 `npm test` 恢复绿
- [ ] `scripts/check-schema.mjs` 3 条断言仍 pass(G1/G2/G3 不动)
- [ ] CI 在 Node 20 / 22 各绿一次(含跨平台 diagram SVG 验证)
- [ ] `npm pack` 生成的 tarball **不含** test/、dist-test/、fixtures/、expected/(发布包体积零增量)

### 8.3 文档 DoD

- [ ] README 加"测试"小节(三段式说明 + 刷新流程)
- [ ] README 或 CONTRIBUTING 加"如何加新 golden 用例"5 步说明
- [ ] 本规划文档(`P0-3-Golden-byte-compare实施规划.md`)作为决策记录存档

---

## 9. 未决问题(open_points,诚实列)

1. **Vega-Lite `view.toSVG()` 输出是否真字节级稳定?** 调查报告只做了源码侧推断(vega renderer none + SVG jax 文本输出),未实地跑通 2 次比对。**步骤 C2 必须先实跑确认**;若不等 → chart golden 降级 pHash ≥0.95 或 skip。

2. **D2 WASM / Graphviz WASM 跨平台 byte 一致性未经实测。** 调查报告未在 macOS arm64 vs Linux x86_64 上对比过 SVG 字节,浮点数 toString 格式化可能平台相关。**步骤 E3 必须在 macOS 本地刷新、Linux CI 校验**;若 fail → config 加 skipReason,延后到 P0-4 用 pHash。

3. **resvg PNG 输出是否含 tEXt/tIME 元数据 chunk?** 调查报告按 resvg 文档(无时间戳)假设字节稳定,未抓包验证。**步骤 D 实测一张 formula/chart PNG strip 前后 diff 确认**;若有元数据 → stripPngMetadata 已覆盖;若无 → byte-compare 直接通过。

4. **Satori PNG 产物(`generate_card` format=png)的元数据 flaky 风险未实测。** 调查报告建议先用 `pngcrush -ow -rem allb` 对一张 generate_card PNG 做前后 diff 确认。P0-3 默认只对 card SVG 做 golden,**PNG 路径延后**;若 SVG byte-compare 通过,PNG 可后续补。

5. **`@napi-rs/canvas` optionalDependencies 是否一定随 `npm install` 装上?** 用户环境可能跳过 optional(如 `--omit=optional`)。**P0-3 不依赖它**,只用 pngjs(显式 devDep);@napi-rs/canvas 留给 P0-4 pixel-diff 路径。

6. **generate_card 覆盖 emoji 路径的 golden 方案本次未深入。** 当前只能 mock fetch 或预置 emoji data URI fixture。**P0-3 默认 card fixture 不含 emoji**,emoji 路径延后到 P0-4 mock 框架就绪后覆盖。

7. **card CJK 字体子集(`@fontsource/noto-sans-sc` chinese-simplified)版本随该依赖升级会变。** 锁版本由 package-lock.json 保证(`npm ci`),但每次升 @fontsource/noto-sans-sc 都需 `npm run render:golden` 刷新。**这是预期行为,不算风险**,但需在 CONTRIBUTING 写明。

8. **[已解决 2026-07-21] D2 引擎 `resolveD2Icons` 定位串错误(`src/d2/d2.ts:20-37` → `src/diagram/d2.ts:20-50`)**

    **原问题**:D2 引擎的 `resolveD2Icons`(原写 `src/d2/d2.ts:20-37`)在 SVG 含 `<image href="lucide:xxx">` 时会 fetch Iconify → 嵌 data URI。**d2-basic.d2 fixture 必须不含图标引用**,否则 byte 不稳。步骤 E3 准备 fixture 时需确认。

    **裁决**:技术结论本身正确(代码确在 L21 匹配 `<image href="set:name">`、L29 fetch Iconify、L34 嵌 `data:image/png;base64,...`,故 fixture 必须无图标引用),只有定位串错。两处错误:① 目录错——`src/d2/` 在 media-gen-mcp 中不存在,实际在 `src/diagram/d2.ts`(8448 字节,169 行);② 行号错——L37 是 `} catch {` 子句开始,远非函数结束,实际范围 L20(函数签名)到 L50(结束 `}`)。

    **证据**(实地核实 /Users/wangdong/Documents/Project/Agnes AI接入/media-gen-mcp):
    1. `ls src/d2/` → `No such file or directory`;`ls src/diagram/` 显示 `d2.ts`(8448B)、`graphviz.ts`、`render.ts`、`types.ts`。
    2. `src/diagram/d2.ts` 关键行:
       - L20: `async function resolveD2Icons(svg: string): Promise<string> {`
       - L21: `const refs = [...svg.matchAll(/<image\s+href="([a-z0-9_-]+):([a-z0-9_-]+)"/gi)];`
       - L29: `` const res = await fetch(`${ICONIFY_API}/${set}/${name}.svg?color=%23334155`); ``
       - L34: `` dataUri = `data:image/png;base64,${pngBuf.toString("base64")}`; ``
       - L37: `} catch {`(catch 子句开始,文档误标为函数结束)
       - L47-50: `}`(else)→ `}`(for)→ `return out;` → `}`(函数真正结束)
    3. 实施时引用应直接写 `src/diagram/d2.ts:20-50`。

9. **是否需要在 CI 加跨平台 golden 一致性 smoke?** Archify 只在 ubuntu-latest 跑。media-gen-mcp 若开发者本地 macOS 刷新、CI Linux 校验,可能浮点不一致。**建议 CI 矩阵加 macOS-latest 一次**,但成本翻倍——若团队接受可加,否则步骤 E3 实测 fail 时按 open point 2 处理。

10. **memory 的"97/97 测试通过"是否需要正式化?** 当前指 `doc/OCR_测试集/` 下 ad-hoc 脚本,不进 `npm test`。P0-3 **不动**这些脚本(只覆盖生成侧 6 工具,不覆盖识别侧)。识别侧测试正式化属独立工作项,与本 P0 无关。

11. **[已解决 2026-07-21] pngjs devDep 版本与 P0-4 冲突 + P0-4 §4.6 注释事实错误**

    **原问题**:P0-4 §4.6(line 436)曾写 `"pngjs": "^3.4.0"`(注释:"原传递依赖会被 npm prune 裁"),与本规划 §4.3(line 222)的 `^5.0.0` 冲突。同 PR 或先后落地会触发 git 合并冲突 + lockfile 漂移 + npm 嵌套两份 pngjs 共存。当前 `package.json` 三块 dependencies 均未显式声明 pngjs,node_modules 实际装的是 5.0.0。

    **裁决**:**P0-3 §4.3 的 `^5.0.0` 是 pngjs 版本"单一来源",P0-4 已修正为 `^5.0.0`**。本规划版本号无需改动;§7.1 风险表 line 630 的"传递依赖被 npm 优化裁掉"概率已从"中"下调为"低"(实地核实:pngjs 是 qrcode 运行时 dependencies,不会被 prune)。完整调查记录在 P0-4 §9 未决点 13。

    **理由 + 证据**(要点,详见 P0-4 §9 未决点 13):
    1. `node_modules/pngjs/package.json:3 "version": "5.0.0"`;`npm ls pngjs` → `media-gen-mcp-server@0.11.0 ... └─┬ qrcode@1.5.4 └── pngjs@5.0.0`;`package-lock.json:2378-2386` 同。
    2. 传递源头:`npm view qrcode@1.5.4 dependencies` → `{ pngjs: '^5.0.0', yargs: '^15.3.1', dijkstrajs: '^1.0.1' }`。qrcode 是 dependencies 不是 optionalDep,故 pngjs 不会被 npm prune(P0-4 §4.6 原注释错)。
    3. `npm install --dry-run` 实证:`^5.0.0` 单份提升顶层(29 packages),`^3.4.0` 嵌套两份(30 packages)。
    4. pngjs v3→v5 API 100% 兼容(CHANGELOG:v4 仅 drop Node 4/6,v5 仅 drop Node 8);本规划 §4.4 line 237 `import { PNG } from "pngjs"` 在两版本都能跑。
    5. `^5.0.0` 在 npm registry 实际只解析到 5.0.0(`npm view pngjs@5.1.0` 返回 E404;5.x 段只有 `5.0.0`),"锁定"语义最干净。

    **单一来源(防再冲突)**:**pngjs devDep 版本跟随 qrcode@1.5.4 的传递依赖版本,锁定 `^5.0.0`,不独立选型**。后续若 qrcode 升级到依赖 pngjs `^6+`,本仓库 devDep 应同步上调。P0-3 是 pngjs 版本的"单一来源"(先合),P0-4 后合时只新增 `@xmldom/xmldom ^0.9.0` 和 `jsqr ^1.4.0` 两项 devDep。

12. **[已解决 2026-07-21] §2.1 `tsconfig.json:7-8` 行号引用偏移 1 行**

    **原问题**:文档 §2.1(line 46)的表格行 `tsconfig.json:7-8 | outDir: "dist", rootDir: "src"` 引用偏移 1 行——实地 Read `/Users/wangdong/Documents/Project/Agnes AI接入/media-gen-mcp/tsconfig.json`,实际是 L6 outDir、L7 rootDir,文档两处行号都偏 +1。

    **裁决**:**P1**(小错,不破坏任何技术论证——rootDir 仍是 "src"、outDir 仍是 "dist",实施方案不受影响;但破坏 §2 标题"现状(带文件:行号证据)"承诺的可信度)。已修订 §2.1 line 46 为 `tsconfig.json:6-7`。修订后 §2.1 与 §4.2(line 192 注释"主配置是 src")的 rootDir 行号证据链吻合——读者从 §2.1 看到 rootDir 在 L7,从 §4.2 看到 test 配置必须把 rootDir 从 "src" 改成 "./",两处对得上。

    **证据**(实地 Read `/Users/wangdong/Documents/Project/Agnes AI接入/media-gen-mcp/tsconfig.json` cat -n 输出):
    - L5: `    "moduleResolution": "NodeNext",`
    - L6: `    "outDir": "dist",`
    - L7: `    "rootDir": "src",`
    - L8: `    "strict": true,`
    - L17: `  "include": ["src/**/*"]`

    **交叉核对(读取 package.json,确认是孤立笔误非系统性偏移)**:
    - `package.json:20` `"test": "node scripts/check-schema.mjs"` ✓ 与 §2.1 第 42 行吻合
    - `package.json:21` `"prepublishOnly": ...` ✓ 与 §2.1 第 43 行吻合
    - `tsconfig.json:17` `"include": ["src/**/*"]` ✓ 与 §2.1 第 45 行吻合(§1.1 第 19 行亦引此)
    - 结论:§2.1 表 5 行中唯一错引就是 `tsconfig.json:7-8`,同表其余 4 处行号全对,带行号证据承诺整体可信。

13. **[已解决 2026-07-21] §4.7 determinism.test.ts grep scope 过宽导致首跑必红**

    **原问题**:§4.7 的 determinism.test.ts 按"原文写法"在 P0-3 第一次跑**必然红**。根因不是"白名单不够",而是**测试逻辑本身有两处缺陷**:

    - **缺陷 1:writeLocalRender 过滤器是空操作(no-op)。** §4.7 的 filter 是 `.filter((l) => l && !l.includes("writeLocalRender"))`,它检查 grep **输出行**是否字面含 "writeLocalRender" 字符串。但 writeLocalRender 函数体里的 Date.now 调用在 `src/index.ts:524`(`const safeName = path.basename(name ?? \`${prefix}_${Date.now().toString(36)}\`)`),这一行并不含 "writeLocalRender" 字样——函数**定义**在第 516 行,Date.now 在第 524 行的函数**体**里。实测跑原 grep+filter:总命中 47 行,过滤后仍存活 **47 行**(filter 移除 0 行)。
    - **缺陷 2:grep 扫全 src/,但 time/random 源全在非渲染管线里。** 实测 47 个存活行分布:`src/index.ts ×7`(6 个 handler 的 safeName 回退名 + writeLocalRender 函数体)、`src/providers/* ×26`(全是 rate-limit 冷却计时)、`src/pdf/job-store.ts ×5`(job ID + updatedAt)、`src/render-video.ts ×3`(tmpDir + elapsedMs)、`src/poll.ts ×2`(轮询 deadline)、`src/download.ts ×1`(`crypto.randomUUID()`,grep 的 `crypto\.random` 子串匹配抓到)。

    **关键反证:open point 里对 `src/vision/*` 的怀疑是错的。** 实测 `grep -rnE "..." src/vision/` 返回 0 匹配——vision/ 是干净的。`render-video.ts`(✓ 含 process.pid+Date.now)、`pdf/job-store.ts`(✓ 含 Date.now+Math.random)的怀疑成立;vision/ 的怀疑不成立。

    **裁决**:已修订 §4.7 的 grep 命令为只扫 P0-3 覆盖的 6 个本地确定性渲染目标:`src/qr.ts src/formula.ts src/chart.ts src/card.ts src/render-svg.ts src/diagram/`。删除 writeLocalRender filter(改窄 scope 后不需要任何白名单)。不动 `src/icon.ts`(网络依赖,P0-3 skip)、不动 `src/render-video.ts`(video,P0-3 范围外)、不动 `src/pdf/*`(异步 job 管,P0-3 范围外)。C3 工时从 30min 下调到 15min(本步仅作 regression 守护)。

    **证据**(实地 grep /Users/wangdong/Documents/Project/Agnes AI接入/media-gen-mcp,2026-07-21):
    1. **6 个本地确定性渲染文件实测全 0 匹配**——`grep -cE "..." src/qr.ts` = 0;同命令对 `src/formula.ts`、`src/chart.ts`、`src/card.ts`、`src/icon.ts`、`src/render-svg.ts` 各 = 0;`grep -rcE ... src/diagram/ | grep -v ':0'` = 0 文件命中。证明 time/random 源确实只存在于非渲染管线,narrowed scope 正确。
    2. **推翻 open point 对 vision/ 的怀疑**——`grep -rnE "Date\.now|new Date|Math\.random|crypto\.random|process\.pid" src/vision/` 返回 0 匹配。
    3. **确认对 render-video.ts 的怀疑**——`src/render-video.ts:211` `const tmpDir = path.join(os.tmpdir(), \`mcp-video-${process.pid}-${Date.now().toString(36)}\`)`、215 `const startTime = Date.now()`、303 `const elapsedMs = Date.now() - startTime`。
    4. **确认对 pdf/job-store.ts 的怀疑**——`src/pdf/job-store.ts:111` `const id = \`pdf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}\``、99/112/141/152 各 Date.now。
    5. **crypto.random 子串匹配 crypto.randomUUID**——`echo "crypto.randomUUID() here" | grep -E "crypto\.random"` 命中;对应 `src/download.ts:49` `if (!base) base = \`${kind}_${crypto.randomUUID().slice(0, 12)}\``。
    6. **providers/* 全是 rate-limit 冷却(渲染无关)**——例:`src/providers/agnes.ts:138` `this.cooldownUntil = Date.now() + 60_000`、139 `this.lastErrorAt = new Date().toISOString()`;同模式见 `vlm.ts:117-118`、`paddle.ts:97-98`、`glm-vision.ts:113-114`、`zhipu.ts:196-197`、`key-pool.ts:108`。
    7. **Archify 范式 scope 原文**——P0-3 文档 §3.1 point 7(line 103):"对全部 5 渲染器 + shared/utils.mjs + shared/cli.mjs + assets/template.html 做 grep",scope 本就是渲染器,非"全 src/"。Archify `src/` 只含渲染器代码(无 providers/handlers/pdf 管线),故"全 src="等价"全渲染器";media-gen-mcp 直接照搬"全 src/"scope 但 src/ 大得多,导致误伤。

14. **[已解决 2026-07-21] §B3 抽离 render() 分派未点名 import 路径调整**

    **原问题**:§B3(line 544)只写"从 `test/golden.test.ts` 抽 `render()` 分派到 `test/golden/render.ts`(刷新器复用)",§4.8(line 485-486)注释和 §8.1(line 670)DoD 同样只点名 render.ts 的位置/职责,**全程未提示 import 路径需调整**。但 §4.6(line 358-365)的 8 条 import 全部按 test/ 层视角编写,抽到 test/golden/ 子目录后必须重写,否则编译失败(ERR_MODULE_NOT_FOUND)。

    **裁决**:**P1**。已在 §B3 任务条目后补"注意:抽离时需把 §4.6 的 8 条 import 同步重写"。具体调整:

    - **6 条 dist imports 多下钻一层**:`../dist/qr.js` → `../../dist/qr.js`、`../dist/formula.js` → `../../dist/formula.js`、`../dist/chart.js` → `../../dist/chart.js`、`../dist/card.js` → `../../dist/card.js`、`../dist/render-svg.js` → `../../dist/render-svg.js`、`../dist/diagram/render.js` → `../../dist/diagram/render.js`
    - **2 条本目录 imports 去 golden/ 前缀**:`./golden/golden.config.js` → `./golden.config.js`、`./golden/helpers.js` → `./helpers.js`
    - §4.8 刷新器从 `../dist-test/test/golden/render.js` import render,路径**无需改**

    **附注(超出本未决点范围,另开问题处理)**:§4.2 `tsconfig.test.json` 设 `rootDir:"./"` + `outDir:"dist-test"`,会使 `test/golden.test.ts` 编译为 `dist-test/test/golden.test.js`(保留 test/ 前缀)。这意味着源码中写 `../dist/qr.js`(源码视角正确)在运行时会从 `dist-test/test/` 出发解析为 `dist-test/dist/qr.js`(不存在)——即 §4.6 的 imports 即使不抽离、原样保留在 `test/golden.test.ts` 中,运行 `node --test dist-test/` 也会模块解析失败。这是比 §B3 抽离更深的配置问题,实施者要么在源码里就写运行时正确的 `../../dist/qr.js`(IDE 会标红),要么改 rootDir 让源码视角与运行时视角一致。建议实施阶段 A1 联调时优先暴露此问题。

    **证据**(路径推演 + 实地核对):
    1. **规划 §B3 原文未点名路径调整**——line 544 仅说"抽",无路径调整提示。
    2. **规划 §4.6 主入口 imports(test/ 层视角)**——line 358-365 全部以 test/ 为基准:`import { renderQR } from "../dist/qr.js"`、…、`import { GOLDEN } from "./golden/golden.config.js"`、`import { compareSvg, ... } from "./golden/helpers.js"`。
    3. **规划 §4.8 刷新器注释与 import**——line 485-486 `import { render } from "../dist-test/test/golden/render.js"` 反向证明编译产物路径确实是 `dist-test/test/golden/render.js`(rootDir:"./" 保留了 test/ 前缀),但注释未提 render.ts 内部 imports 需要改写。
    4. **dist 产物存在且导出名匹配(实地读取)**——`dist/qr.js` 头部 `export async function renderQR(req)` ✓、`dist/render-svg.js` 存在 ✓、`dist/diagram/render.js:18` `export function getDiagramEngine(name)` ✓、`dist/diagram/` 含 d2.js/graphviz.js/render.js/types.js ✓、`dist/{formula,chart,card}.js` 全部存在 ✓。
    5. **源码视角路径推演(可由读者复现)**——`test/golden.test.ts → ../ = 项目根 → ../dist/qr.js = 项目根/dist/qr.js ✓`;`test/golden/render.ts → ../ = test/,../../ = 项目根 → ../../dist/qr.js = 项目根/dist/qr.js ✓`(若仍写 `../dist/qr.js` 则指向 `test/dist/qr.js`,不存在);`test/golden/render.ts → ./golden.config.js = test/golden/golden.config.js ✓`(若仍写 `./golden/golden.config.js` 则指向 `test/golden/golden/golden.config.js`,不存在)。

---

## 附录 A:与 Archify 范式的对应表

| Archify 元素 | media-gen-mcp 对应 | 借鉴/不借鉴 |
|---|---|---|
| `test/golden.mjs`(170 行单文件) | `test/golden.test.ts` + `test/golden/helpers.ts` + `test/golden/golden.config.ts` | **拆三文件**,因 TS 类型分离更清晰 |
| 5 类图 mode | 6 个本地确定性工具 × 多输出格式 | **不照搬 5 mode 概念**,按工具原生输入分派 |
| `normalizeNewlines` | `test/golden/helpers.ts:normalizeNewlines` | **1:1 直搬** |
| `render-examples.mjs`(28 行) | `scripts/render-golden.mjs` | **1:1 范式搬**,实现自研 |
| 失败信息含刷新命令 | `compareSvg/comparePng` 失败信息 | **1:1 直搬原句结构** |
| `degraded.test.mjs` 的 NaN 守门 | `assertNoNaNOrUndefined` + `determinism.test.ts` 的 grep 扫描 | **1:1 直搬 + 扩展(加 grep)** |
| 模板新鲜度(`web-app.html` vs `template.html`) | 不适用 | **不搬**,media-gen-mcp 无 hand-curated 产物 |
| 版本同步 6 处 | 不适用 | **不搬**,npm 包版本由 registry 管 |
| ajv standalone stale gate | 不适用(P1-12) | **不搬**,与本 P0 无关 |
| zip-freshness 整树 diff | 不适用 | **不搬**,`files` 字段管打包 |
| `check:validators` | `scripts/check-schema.mjs` 已存在 | **不动**,保留在 test 链末段 |

---

## 附录 B:首个 PR 的 commit 信息模板

```
test: introduce node:test golden byte-compare suite (P0-3)

Add golden byte-compare for 6 local deterministic tools (qrcode/formula/
chart/card/render_svg/diagram), closing the "same input → same output"
guarantee gap that was previously only stated in README.

- Add test/ dir with tsconfig.test.json (zero changes to main tsconfig)
- Add test/golden/{config,helpers,render}.ts shared by test + refresh script
- Add test/golden.test.ts + test/determinism.test.ts (run-2-times self-check)
- Add scripts/render-golden.mjs (refresh counterpart, shares GOLDEN array)
- Add pngjs + jsqr to devDependencies (MIT / Apache-2.0)
- package.json: build:tests + render:golden scripts; test is now three-stage
  (build:tests → node --test → check-schema.mjs unchanged)
- Add .github/workflows/ci.yml (Node 20+22 matrix, npm ci)

card fixture uses CJK family (offline via @fontsource/noto-sans-sc) + no emoji
to avoid CDN flaky. generate_icon skipped (Iconify network dep). render_svg
chrome backend deferred to P0-4 (pixel-diff).

License: all implementations original; normalizeNewlines is a 10-line generic
regex. No Archify code referenced (its LICENSE is unclear in bundle).

Co-Authored-By: Claude <noreply@anthropic.com>
```

---

**规划结束**。读完此文档应能直接判断:
1. **做不做?** —— 必做。当前零自动化测试是 README "同输入同输出"承诺的最大盲区。
2. **怎么做?** —— 5 天 7 阶段,零 src/ 改动,纯测试基建。
3. **风险点?** —— 跨平台 byte 一致性(步骤 E3 必测)、Satori CDN(已强制 CJK 离线)、Vega 稳定性(步骤 C2 必测)。
4. **何为完成?** —— 8.1/8.2/8.3 三段 DoD 全勾选。
