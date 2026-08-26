# P0-5 实施规划 · 交互式自包含 HTML 图产物(`generate_interactive_diagram`)

> **P0-ID**: P0-5
> **定性**: 新增第 20 个 MCP 工具,堵 GitHub README 主题切换盲区(三层分工的"交互档")
> **路线**: D2 WASM 后端(已在进程内)+ markmap 范式 HTML 包装(reimplement)+ 极简 viewer
> **立场**: 纯免费 / 同输入同输出可入 git / 向后兼容 / 不破坏现有 19 工具签名 / 不破坏 check-schema.mjs / Archify 0 拷贝
> **工时**: MVP 7-10 人日(调研文档估 8-12,核实 D2 原生支持 darkThemeID/noXMLTag 后下调);Tier 2 Mermaid 4-6 人日可选
> **生成日期**: 2026-07-21
> **上游依据**: `P0-5-Archify源码与同品类深度调研.md`(本规划与其推荐路线一致,但对实施细节做了实地核实修正,见 §0)

---

## 0. 相对调研文档的关键修正(实地核实结果)

本规划者在落盘前**实地核实了 media-gen-mcp 源码与 `@terrastruct/d2` WASM 类型定义**,发现调研文档(虽方向正确)有三处实施级偏差,必须在动工前校准,否则 MVP 必踩坑:

| # | 调研文档说法 | 实地核实结果 | 对规划的影响 |
|---|---|---|---|
| **C1** | open_point #1:"D2 WASM `RenderOptions.darkThemeId` 字段是否存在需 Step 1.7 实地核实" | **字段确认存在**,但**字段名是 `darkThemeID`(全大写 ID),不是调研文档写的驼峰 `darkThemeId`**(见 `node_modules/@terrastruct/d2/index.d.ts` L13-14:`/** Theme ID to use when client is in dark mode */ darkThemeID?: number`) | open_point #1 **关闭**;实现时严格用 `darkThemeID`,写成 `darkThemeId` 会被 TS 当多余属性拒绝或被 D2 忽略,主题不切换。这是 MVP 最关键的零成本杠杆,无需降级 CSS 变量双主题方案 |
| **C2** | 未提及 `noXMLTag` | D2 `RenderOptions.noXMLTag` 存在(L29-30:`Omit XML tag (<?xml ...?>) from output SVG files. Useful when generating SVGs for direct HTML embedding.`) | HTML `<!doctype html>` 结构后**不能**跟 `<?xml ...?>` 声明,否则浏览器解析错乱。**MVP 必须强制 `noXMLTag: true`**,调研文档完全没提,是必踩坑 |
| **C3** | open_point #2:"D2 dagre 同输入两次渲染几何稳定性未实测,可能 golden flaky" | 发现 D2 `RenderOptions.salt` 字段(L27-28):"Add a salt value to ensure the output uses unique IDs... useful when generating multiple identical diagrams... so that duplicate IDs do not cause invalid HTML"。**【原 C3 误诊已实地更正】**原版规划曾猜测"默认不传 salt 时 D2 内部很可能自动生成随机 salt → SVG 元素 ID 每次 run 都变 → byte 级 golden 必 flaky",**实测不成立**:默认渲染对同输入 byte-identical(进程内 3 输入×3 次=9/9 同;跨进程 2 个独立 Node 进程 LEN/HASH/SVG ID 全同)。SVG 内 ID 形如 `mk-d2-{dsl_hash}-{common_suffix}` 看似随机实为 DSL 内容哈希,跨进程稳定;dagre 几何确定性,无时间戳/无 Math.random。**详见未决问题 #2 的实测证据**。 | **仍传固定 salt(如 `salt: "media-gen-mcp-interactive"`)**,但定位从"承重墙"降为"零成本防御 + 多图嵌入同 HTML 防 ID 冲突的官方用途"。**S5 byte-identical 在默认行为下即可达成**,不依赖固定 salt。原 C3 把风险归给"salt 默认随机"是误诊,把风险归给 dagre 也是误诊 —— 实测二者皆确定。真正 caveat 是 `resolveD2Icons` 在 DSL 含 `icon:` 时调 Iconify API + resvg 光栅化(已在 MEMORY 记载,与 generate_diagram 同源同限,P0-5 不引入新风险) |
| **C4** | §4.5.7 handler 骨架用 `requireNonEmptyString(args.code, "code")` + `return { isError: true, content: [...] }` | 实际 handler 范式是 `requireString(a.code, "code")`(抛错,函数名 `requireString` 在 L1323)+ `ok(data)` / `err(msg)` 包装助手(L1366/1369);参数对象名是 `a` 不是 `args`;落盘用 `writeLocalRender(outDir, kind, name, format, rendered)`(L516) | 规划 §4 的接口骨架必须用**真实范式** `requireString/optString/ok/err/resolveOutDir/writeLocalRender`,不能抄调研文档的伪代码,否则 review 必打回 |
| **C5** | 工具定义插入点写"L114-491 之间""L938-958 后" | 精确行号:generate_diagram 工具定义在 **L286-303**(name L287,闭合 `}` L303);generate_diagram case 在 **L938-957**(闭合 `}` L957);下一项 generate_qrcode 工具定义 L304 / case L959 | 插入点明确:L303 后插工具定义块;L957 后插 case 块。零歧义 |

**结论**:调研文档的**路线裁决(D2 + markmap 范式 + reimplement 不抄 Archify)** 完全正确,本规划全盘采纳;但**实施细节(字段名、确定性防线、handler 范式)** 必须按上表修正,否则 MVP 必在 C1/C2/C3 三个点翻车。

---

## 1. 目标与范围

### 1.1 解决的盲区(三层分工)

media-gen-mcp 当前只有两档图产物,缺中间档:

| 档位 | 工具 | 产物 | 盲区 |
|---|---|---|---|
| 静态档 | `generate_diagram` | SVG/PNG | GitHub README 嵌入后**只跟随一种主题**,无交互 |
| 视频档 | `render_video` | MP4/GIF/WebM | 非图、不可探索 |
| **交互档(新)** | **`generate_interactive_diagram`** | **单文件自包含 HTML** | **堵 GitHub README 自动跟随系统主题 + 可点击探索** |

### 1.2 命名建议:`generate_interactive_diagram`(推荐)

| 候选 | 推荐度 | 理由 |
|---|---|---|
| **`generate_interactive_diagram`** | ✅ **首选** | 与 `generate_diagram`(静态)/`render_video`(视频)三档命名对仗;`interactive` 是产物差异化核心(主题切换/动画/探索),`html` 只是格式;LLM 路由更易触发"我要可探索产物" |
| `generate_diagram_html` | ⚠️ 备选 | 更直白指向产物格式,但丢了"interactive"语义,与 `render_video`(也不叫 `render_mp4`)命名风格不一致 |

**本规划采用 `generate_interactive_diagram`**。若维护者倾向 `generate_diagram_html`,description/cross-ref 同步改名即可(open_points #1)。

### 1.3 成功标准(可验证,12 条)

| # | 标准 | 验证 |
|---|---|---|
| S1 | 19 工具 → 20 工具 | `check-schema.mjs` G2 更新到 20,全绿 |
| S2 | 产物单文件自包含 | grep 严格禁 `<script src=`(允许 `<link rel="stylesheet"` 指字体 CDN) |
| S3 | 切主题不改 SVG 几何 | light/dark 产物 `extractGeometry(html)` byte-identical |
| S4 | 自动跟随系统主题 | 产物含 `@media (prefers-color-scheme: dark)` + SVG 双调色板 |
| S5 | 同输入两次 byte-identical | normalizeNewlines 后 `fresh === golden`(**实测 D2 默认渲染已 byte-identical**,固定 salt 是零成本防御非承重墙,详见 §0 C3 / 未决问题 #2) |
| S6 | HTML ≤ 256KB | `Buffer.byteLength(html) <= 256*1024` |
| S7 | 19 原工具 inputSchema byte-identical | diff 验证只新增 generate_diagram description 一行 cross-ref + 新工具块 |
| S8 | License 全绿 | §10.1 矩阵;Archify 0 拷贝;tldraw 0 引入 |
| S9 | `prefers-reduced-motion: reduce` 停动画 | 产物含 `@media (prefers-reduced-motion: reduce) { animation: none !important }` |
| S10 | 端到端跑通 | D2 DSL → HTML → 浏览器渲染 → 切主题不破几何 → 导出 PNG |
| S11 | HTML 内联 SVG 无 `<?xml?>` | grep `<!doctype html>` 后首行非 `<?xml`(C2 防线) |
| S12 | D2 渲染传固定 salt | 实现里 `renderOpts.salt = "media-gen-mcp-interactive"`(C3 防线,见 §3.2) |

---

## 2. 推荐技术路线(来自调研文档,本规划确认)

**路线 A:D2 WASM 后端 + markmap 范式 HTML 包装(reimplement 极简 viewer)**

裁决基于调研文档 §3.4 同品类矩阵(已复核,结论不变):

| 选项 | 裁决 | 理由 |
|---|---|---|
| **A. D2 + markmap 范式 reimplement** | ✅ **GO(MVP)** | D2 已进程内(`@terrastruct/d2 ^0.1.33` 已在 dependencies,**零新增依赖**)、原生 `darkThemeID` 自动烤 `@media prefers-color-scheme`(C1 已验证)、MPL-2.0 文件级 copyleft 接受(链 npm 包不传染) |
| B. Mermaid 客户端渲染 | ⚠️ Tier 2 可选 | mermaid.min.js ~2.8MB 体积大、Archify v3 盲测 FAIL 证明视觉档次低、foreignObject 浏览器外破。只在用户需 state/gantt/gitgraph 时启用 |
| C. Reimplement Archify IR + 手写 SVG + 10500 行 viewer | ❌ NO-GO | 推翻 engine 管布局价值;过度工程;Archify 自身盲测 FAIL;LLM 写坐标负担高 |
| D. 集成 markmap 整包 | ❌ NO-GO | 只做 mindmap 一种图;markmap-cli 拖入 hono/chokidar/commander 无关依赖 |
| E. xyflow / tldraw / Excalidraw / diagrams.net / kroki | ❌ NO-GO | license 红线(tldraw)/ React 重 runtime(xyflow)/ webapp 过度工程(其余)/ server-side 正交(kroki) |

**核心策略**:MVP 走 A(7-10 人日),Tier 2 可选加 B(4-6 人日)。**永不走 C/D/E**。

---

## 3. 详细架构(六层)

### 3.1 输入契约:接受 DSL(不走 JSON-IR)

**立场决策**:**接受 D2 DSL 文本,不引入 JSON-IR**。

| 维度 | DSL 路线(采纳) | IR 路线(Archify 走的,拒绝) |
|---|---|---|
| LLM 负担 | 低(写 D2 DSL,engine 管布局) | 高(为每个节点写 `pos:[x,y]` 或 `row/col`) |
| auto-layout | ✅ D2 dagre 自带 | ❌ 拒绝 auto-layout,LLM 写死坐标 |
| 与 media-gen-mcp 哲学 | 一致("DSL 直传快速出图") | 对立 |
| 校验复杂度 | D2 自己解析报错 | 需双层 schema + ajv standalone codegen |
| 立场冲突 | 无 | 推翻 engine 价值(调研文档 §3.3 红线) |

**结论**:复用 `generate_diagram` 的 D2 后端(同 DSL 语法),只额外传 `darkTheme` + 固定 `salt` + `noXMLTag`。

### 3.2 渲染层:复用 D2Engine,新增三个杠杆

**复用** `src/diagram/d2.ts` 的 `D2Engine`(已进程内、lazy singleton、串行队列、icon 解析全要)。

**新增三个 RenderOptions 杠杆**(C1/C2/C3 防线,实现时务必三个一起传):

```ts
// 在 D2Engine.render() 或新 wrapper 内,构造 renderOpts 时:
const renderOpts = {
  ...compiled.renderOptions,
  ...(themeID != null ? { themeID } : {}),
  ...(darkThemeID != null ? { darkThemeID } : {}),  // C1: 大写 ID!自动烤 @media prefers-color-scheme: dark
  noXMLTag: true,                                     // C2: HTML 内联必去 <?xml?> 声明
  salt: "media-gen-mcp-interactive",                  // C3: 固定 salt —— 零成本防御 + 多图嵌入同 HTML 防 ID 冲突(非 byte-identical 承重墙,详见 §0 C3 修订 / 未决问题 #2)
};
```

**为什么不直接改 `D2Engine.render()` 的现有行为**:`generate_diagram` 调用路径(index.ts L947-957)的行为必须 byte-identical(向后兼容立场)。但**实地核实修正原 §3.2 含糊表述**:

- **singleton 访问**:`D2Engine` 类(d2.ts L98)无公开 singleton 访问器,真正全局单例在 `render.ts` L14 `const d2 = new D2Engine();`,只能通过 `getDiagramEngine(name?)`(render.ts L23)拿到,返回类型是 `DiagramEngine` 接口。**严禁在 wrapper 里 `new D2Engine()`**:`this.d2`(d2.ts L100)是实例级 private,lazy init 在 L115 `this.d2 ??= new D2();`,每个 D2Engine 实例各自加载一份 22MB D2 WASM + 独占 worker 线程 + 独立 chain 串行队列(d2.ts L8/L114 注释明示)。全仓 grep `new D2Engine` 仅 render.ts L14 一处。
- **正确路径**:`render-d2.ts` 写 `const engine = getDiagramEngine("d2") as D2Engine | undefined;`(`src/interactive-html/` 与 `src/diagram/` 是平级兄弟目录,`../diagram/render.js` 解析正确)。
- **三杠杆注入矛盾(必须 surface)**:`DiagramRequest`(types.ts L11-26)只有 `theme`,无 `darkTheme`/`noXMLTag`/`salt`;`D2Engine.render()`(d2.ts L137-139)硬编码 `renderOpts = { ...compiled.renderOptions, themeID }` 无扩展钩子;底层 D2 句柄 `private`(L100)。所以"thin wrapper 复用 D2Engine + 不改 d2.ts + 传三杠杆 + 60 行"**四联约束无解** —— 任何方案都必须动 `d2.ts` 或 `types.ts`。
- **最小加性改动裁决(放松 §6.2 L359 / §9.2 L488 的"d2.ts 不改"硬约束)**:
  1. 在 `types.ts` 给 `DiagramRequest` 加 3 个**可选**字段:`darkTheme?: string; noXMLTag?: boolean; salt?: string;`(纯加性,graphviz 引擎忽略即可)。
  2. 在 `d2.ts` L137-139 把 `renderOpts` 改为读 `req` 三字段并合并:`{ ...compiled.renderOptions, ...(themeID!=null&&{themeID}), ...(req.darkTheme!=null && {darkThemeID: resolveD2Theme(req.darkTheme) ?? undefined}), ...(req.noXMLTag && {noXMLTag: true}), ...(req.salt && {salt: req.salt}) }`。
  3. `generate_diagram` 现有调用(index.ts L947-957)**不传**三字段 → 走默认值 → 行为 byte-identical(向后兼容立场守住)。
- **替代方案(更干净但侵入稍大)**:在 d2.ts 新加 `export function renderD2Raw(code, opts): Promise<{svg, png?}>`,`D2Engine.render()` 与 `render-d2.ts` 都调它,前者传 `{themeID}` 后者传 `{themeID, darkThemeID, salt, noXMLTag}`。维护者二选一。

**`generate_diagram` 路径不动**(指行为不动,不指 d2.ts 文件不动)。立场口径同步在 §6.2 L359 / §9.2 L488 修订。

**降级预案**(open_points #2):**实地核实 D2 默认渲染已 byte-identical(进程内 9/9 + 跨进程 LEN/HASH 全同)**,降级路径触发概率极低。若 Step 1.2.5 实测出现 icon 以外的非确定性,降级为 `extractGeometry(html)` 结构断言(SVG 子树拓扑相同即过,允许属性序微差)。**此决策影响"同输入同输出可入 git"立场口径**,落地前仍做确定性审计(Step 1.2.5)并存档 10 次 diff 结果。

### 3.3 主题层:CSS 变量 + `html[data-theme]` 属性 flip

**借鉴 Archify 工艺**(reimplement,不抄代码):CSS 变量只改颜色,SVG 几何坐标永不重算。

- **D2 自带双调色板**(C1 杠杆):D2 用 `darkThemeID` 会自动在 SVG 注入 `@media (prefers-color-scheme: dark) { .d2-xxx .fill-N1 { fill: <darkColor> } }`。**GitHub README 嵌入时浏览器自动跟随系统主题,无需 JS**。
- **viewer 外观主题**(toolbar/背景):用 ~45 个 CSS 变量 + `html[data-theme="auto|light|dark"]` 属性 flip + pre-paint resolver(防 FOUC)。
- **三层主题来源优先级**:`URLSearchParams(?theme=)` > `localStorage` > `prefers-color-scheme` > 默认 `auto`。

**不变量**:viewer 主题切换**绝不重渲染 SVG、绝不重算几何**(S3 的实现基础)。

### 3.4 动画层:Motion Governor 极简版

**借鉴 Archify 5 触发条件**(265 行 → 极简 ~50 行):

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
html[data-motion="still"] * { animation: none !important; }
```

- **留**:`prefers-reduced-motion`(无障碍硬需求)+ 1 个暂停按钮(`data-motion="still"`)。
- **删**:多面板互斥所有者逻辑(media-gen-mcp MVP 只有 1 个面板)、Story Trail 章节回放、visibilitychange 暂停(可选 ~20 行,Tier 2)。

### 3.5 导出层:PNG 预览(可选)

**借鉴 Archify `serializeSvg + resolveVars + pickSafeScale`**(inv:p05-archify-viewer §4):

- **PNG 导出路径优先级**(open_points #3):
  1. **首选 puppeteer-core**(已在 dependencies,L44)`^25.3.0`:headless Chrome 截图,色彩与 viewer 一致,CSS 变量自动解析。(原规划误写 L25,实地核实 L25 是 `engines.node` 块闭合 `}`,puppeteer-core 实际在 L44;同节 `@resvg/resvg-js` L39 / `@napi-rs/canvas` L52 行号正确不变)
  2. 备选 `@napi-rs/canvas`(optionalDep,L52):离线兜底,但某些 Linux 环境装不上。
  3. 末选 `@resvg/resvg-js`(已在 dependencies,L39):进程内、确定性,但**不解析 CSS 变量**(只认 SVG 属性 fill),需先用 `resolveVars(themeAttr)` off-DOM probe 把 CSS 变量烤进 SVG 属性再光栅化。

- **`pickSafeScale` 4→3→2→1 降级**:防 iOS Safari 16Mpx canvas 上限。
- **MVP 默认 `previewPng=false`**,用户显式要才导(避免每次都启 Chrome 拖慢)。

### 3.6 自包含:markmap 范式 fillTemplate

**借鉴 markmap `fillTemplate()` 范式**(80 行 reimplement,不 import 包):

- **sentinel 占位符 replace**:用函数式 `.replace(callback)` 避免 `$&`/`$'` 被解释为替换模式(inv:p05-archify-viewer §3 utils.mjs L128-134 踩过)。
- **零外链 `<script src=`**(S2 硬约束):所有 JS inline。允许 `<link rel="stylesheet"` 指字体 CDN(Google Fonts),但 MVP 默认不引(用系统字体栈兜底)。
- **确定性**:模板内无 `Math.random`/`Date.now`,无字典乱序遍历,同输入同输出。

---

## 4. 关键接口签名(用真实 handler 范式)

### 4.1 工具定义(`src/index.ts` L303 后插入)

```ts
{
  name: "generate_interactive_diagram",
  description:
    "Generate a SELF-CONTAINED INTERACTIVE HTML diagram (交互式自包含HTML图) that auto-follows system theme via @media (prefers-color-scheme: dark) — embeddable in GitHub README so dark/light readers see the right palette with zero JS. Single .html file with all CSS/JS inlined. Backend: D2 WASM (same DSL as generate_diagram, zero new deps). Supports pan/zoom, theme toggle, optional PNG preview. Multilingual triggers: 交互式图 · interactive diagram · diagrama interactivo · diagramme interactif · interaktives Diagramm · интерактивная диаграмма (en/zh/es/fr/de/ru). " +
    "WHEN TO CHOOSE: GitHub README/wiki architecture diagram that must follow system theme; blog embeddable diagram with hover/click; product demo with subtle animation. " +
    "AVOID: static SVG/PNG in docs (use generate_diagram, lighter); video output (use render_video); hand-coding SVG (use render_svg). " +
    "NEXT: open the HTML in a browser to interact; set previewPng=true for a PNG snapshot alongside.",
  inputSchema: {
    type: "object",
    properties: {
      code: { type: "string", description: "D2 DSL source (same syntax as generate_diagram — see its description for the full D2 syntax guide)." },
      theme: { type: "string", description: "Light theme (D2 themeID or 'default'/'neutral'). Default 'default'." },
      darkTheme: { type: "string", description: "Dark theme (D2 themeID or 'default'/'neutral'). When set, D2 inks BOTH palettes + @media (prefers-color-scheme: dark) into the SVG so GitHub README auto-switches. If omitted, `theme` applies to both modes (no auto-switch)." },
      title: { type: "string", description: "HTML <title> and visible heading. Default 'Interactive Diagram'." },
      previewPng: { type: "boolean", default: false, description: "Also export a PNG snapshot (scale=2, pickSafeScale-aware). Default false (Chrome launch is slow)." },
      name: { type: "string", description: "Output filename (without extension)" },
      outDir: { type: "string", description: "Output directory, default session-dir/output" },
    },
    required: ["code"],
  },
},
```

> **P0-1 + P0-5 合并协调(2026-07-21 resolved,见 §12.4 open_point #12)**:本节描述的 `NEXT:` append 基于 P0-1 已合并的 `generate_diagram` canonical description(P0-1 §4.5 把 'hand-writing SVG is appropriate' 改写为点名 `render_svg`)。若两 PR 同期 open,**P0-5 rebase onto P0-1**,把本节 NEXT 行拼接到 P0-1 改过的字符串末尾,**禁止**全量重写 description 覆盖 P0-1 的 AVOID 句。合并后 `generate_diagram` description 必须同时含 `render_svg`(P0-1 AVOID)和 `generate_interactive_diagram`(P0-5 NEXT)两个工具名。推荐落地顺序:P0-1 先合并 → P0-5 rebase。

**同时**:`generate_diagram` description 末尾(L289 末)加一行 cross-ref:
```
NEXT: for interactive HTML with theme switch + animation that auto-follows system theme in GitHub README, use generate_interactive_diagram.
```

### 4.2 handler case(`src/index.ts` L957 后插入,真实范式)

> **范式校准(C4)**:用 `requireString/optString/ok/err/resolveOutDir`(不是调研文档的 `requireNonEmptyString/args/isError`)。

```ts
case "generate_interactive_diagram": {
  const code = requireString(a.code, "code");
  const outDir = resolveOutDir(a.outDir);
  try {
    const result = await renderInteractiveHtml({
      code,
      theme: optString(a.theme),
      darkTheme: optString(a.darkTheme),
      title: optString(a.title) ?? "Interactive Diagram",
      previewPng: a.previewPng === true,
      name: optString(a.name),
      outDir,
    });
    return ok({
      local_path: result.localPath,
      bytes: result.bytes,
      has_dual_palette: result.hasDarkLightDualPalette,
      preview_png_path: result.previewPngPath,
      hint: "Open in browser to interact; embed in GitHub README to auto-follow system theme.",
    });
  } catch (e: any) {
    return err(`generate_interactive_diagram 渲染失败: ${e?.message ?? String(e)}`);
  }
}
```

**注**:`renderInteractiveHtml` 抛错(沿用 `generate_diagram` 的 `enhanceD2Error` 范式),handler try/catch 转 `err()`。不引入新 error 体系。

### 4.3 renderer 函数签名(`src/interactive-html/index.ts`)

```ts
export interface InteractiveDiagramRequest {
  code: string;                        // D2 DSL(必填)
  theme?: string;                      // 浅色(D2 themeID 或 default/neutral)
  darkTheme?: string;                  // 深色(传了才触发 @media prefers-color-scheme 双调色板)
  title?: string;                      // HTML <title>
  previewPng?: boolean;                // 是否同时导 PNG 预览
  name?: string;                       // 文件名(不含扩展名)
  outDir?: string;                     // 落盘目录(已由 handler resolveOutDir 解析)
}

export interface InteractiveDiagramResult {
  localPath: string;                   // HTML 绝对路径
  previewPngPath?: string;             // PNG 预览绝对路径(previewPng=true 时)
  bytes: number;                       // HTML 体积(S6 校验)
  hasDarkLightDualPalette: boolean;    // 是否双主题烤进(S4 校验)
}

export async function renderInteractiveHtml(
  req: InteractiveDiagramRequest
): Promise<InteractiveDiagramResult> {
  // 1. D2 渲染(传 darkThemeID/noXMLTag/salt 三杠杆)
  const { svg } = await renderD2ForInteractive({
    code: req.code,
    theme: req.theme,
    darkTheme: req.darkTheme,          // → darkThemeID(C1)
    // noXMLTag: true / salt: "media-gen-mcp-interactive" 在 renderD2ForInteractive 内硬编码
  });
  // 2. 套 HTML 模板
  const html = fillTemplate({ svg, title: req.title ?? "Interactive Diagram" });
  // 3. 断言(S2/S3/S4/S6/S9/S11)
  assertSelfContained(html);
  assertNoXmlDecl(html);               // C2 防线
  assertDualPalette(html);             // 仅 darkTheme 传入时为 true
  assertMotionGovernor(html);
  assertSizeUnder(html, 256 * 1024);
  // 4. 落盘(用项目已有 writeLocalRender 或新助手,见 open_points #4)
  const localPath = await writeInteractiveHtml(req.outDir, req.name, html);
  // 5. 可选 PNG
  let previewPngPath: string | undefined;
  if (req.previewPng) previewPngPath = await exportPngFromSvg(svg, req.outDir, req.name);
  return { localPath, previewPngPath, bytes: Buffer.byteLength(html), hasDarkLightDualPalette: req.darkTheme != null };
}
```

### 4.4 output 类型(handler 返回给 MCP client)

沿用项目 `ok(data)` 范式(L1366),data 结构见 §4.2 的 `ok({ local_path, bytes, ... })`。

---

## 5. 最小必要集(MVP)vs 完整版分期

### 5.1 MVP(Tier 1,7-10 人日,必做)

| 维度 | MVP 范围 | 理由 |
|---|---|---|
| 图类型 | **架构图/流程图 1 种**(D2 原生 auto-layout) | 最高频,GitHub README 第一场景 |
| 后端 | D2 only | 零新增依赖 |
| 主题 | auto + light + dark 三态 + D2 双调色板 | GitHub README 盲区核心 |
| 动画 | prefers-reduced-motion 停动画 + 1 暂停按钮 | 无障碍合规底线 |
| viewer | pan/zoom + theme toggle + export PNG/SVG 按钮 | 极简,~200 行 JS |
| 导出 | HTML(主)+ 可选 PNG 预览 | 不分裂产物 |
| 测试 | node:test 8 用例 + golden 1 份 | 首次引入自动化测试 |

### 5.2 Tier 2(可选,4-6 人日,P1 优先级)

| 维度 | Tier 2 范围 |
|---|---|
| 图类型 | Mermaid 客户端渲染(state/gantt/gitgraph 等 D2 弱项) |
| Mermaid 主题 | dark/default/base + themeVariables brand 化 |
| 动画 | visibilitychange 暂停 + Story Trail 章节回放(需求驱动) |
| viewer | minimap / 键盘快捷键(?/T/E/F) |
| offline | inline mermaid.min.js(~2.8MB,默认走 CDN) |

### 5.3 永不做(立场红线)

- Archify 10500 行 viewer(Story Trail/Route Probe/Semantic Lens/Intent Trace 等)
- IR + 手写 SVG 路线(推翻 engine 管布局价值)
- tldraw(license 红线)/ xyflow(React 重 runtime)/ Excalidraw/diagrams.net/flowchart.fun(webapp 过度工程)
- 直接抄 Archify 代码(虽 MIT 但工程适配度差,reimplement)

---

## 6. 文件结构(新增清单 + 每文件职责)

### 6.1 新增(`media-gen-mcp/src/interactive-html/` 7 个文件)

```
media-gen-mcp/
├── src/interactive-html/                    # 新增子目录(与 diagram/ 平级)
│   ├── index.ts            (~80 行)  对外接口 renderInteractiveHtml(req) → result;组装 + 6 个 assert + 落盘
│   ├── render-d2.ts        (~60 行)  thin wrapper 复用 D2Engine,传 darkThemeID(C1)/noXMLTag(C2)/salt(C3)三杠杆;不动 generate_diagram 路径
│   ├── template.ts         (~60 行)  HTML 模板字符串 + __TITLE__/__SVG_SLOT__/__CSS__/__JS__ 占位符(markmap 范式)
│   ├── fill-template.ts    (~80 行)  fillTemplate() 函数式 .replace(callback) 防 $& 解释;escapeHtml;确定性保证
│   ├── theme.ts            (~200 行) ~45 个 CSS 变量(dark 默认 + [data-theme="light"] 覆盖)+ pre-paint resolver script(防 FOUC)+ extractGeometry() 辅助 S3 断言
│   ├── motion-governor.ts  (~80 行)  极简版 5 触发条件 → animation:none !important(prefers-reduced-motion + data-motion=still 两个)
│   ├── viewer-min.ts       (~200 行) pan/zoom(SVG transform)+ theme toggle 按钮 + export PNG/SVG 按钮(纯 vanilla JS,inline 进 HTML)
│   └── export-png.ts       (~150 行) puppeteer-core 截图(首选)+ pickSafeScale 4→3→2→1 降级;resolveVars off-DOM probe(若走 resvg 兜底)
├── test/                                    # 新增目录(media-gen-mcp 首个自动化测试套件)
│   ├── interactive-html.test.mjs            # node:test 主套件(契约 S1-S12 + golden + mutation)
│   ├── golden/interactive-html/
│   │   ├── architecture-d2.golden.html      # checked-in golden 产物
│   │   └── architecture-d2.input.json       # 输入 fixture(DSL + theme)
│   └── helpers/
│       └── deterministic-env.mjs            # 固定 TZ/USING_..._ID 环境变量,防 golden flaky
├── examples/interactive-html/               # 新增目录
│   ├── system-architecture.d2               # 示例 D2 DSL
│   ├── system-architecture.html             # 渲染产物(checked-in,可手工浏览器验证)
│   └── README.md                            # 示例说明 + 截图
└── scripts/
    └── render-interactive-examples.mjs       # golden 刷新脚本(npm run render:golden)
```

### 6.2 修改(只点不改,6 处)

| 文件 | 行号 | 改动 | 范式 |
|---|---|---|---|
| `src/index.ts` | L303 后 | 插入 `generate_interactive_diagram` 工具定义块(§4.1) | 不动其他 19 工具定义 |
| `src/index.ts` | L289 末 | generate_diagram description 加一行 cross-ref `NEXT: ...`(基于 P0-1 已合并的 canonical description 做**末尾 append**,**禁止全量重写**覆盖 P0-1 的 AVOID 句;合并协调见 §4.1 协调条款 + §12.4 open_point #12) | 不动 inputSchema |
| `src/index.ts` | L957 后 | 插入 `case "generate_interactive_diagram":` 块(§4.2) | 用真实 requireString/optString/ok/err 范式 |
| `src/diagram/d2.ts` | **不改 generate_diagram 路径行为**(允许加性补三杠杆可选字段) | `generate_diagram` 调用路径行为 byte-identical;三杠杆通过 `types.ts` `DiagramRequest` 加 3 个可选字段(`darkTheme?`/`noXMLTag?`/`salt?`)+ d2.ts L137-139 `renderOpts` 合并三字段打通注入路径(详见 §3.2)。替代方案:新加 `export function renderD2Raw(code, opts)` 共用主体。**原"不改"声明已实地核实为内部矛盾,放松为"仅加性,旧路径零感知"** | 向后兼容关键 |
| `src/diagram/types.ts` | L11-26 `DiagramRequest` 加 3 个可选字段 | `darkTheme?: string; noXMLTag?: boolean; salt?: string;`(纯加性,graphviz 引擎忽略) | 不破现有 19 工具 |
| `scripts/check-schema.mjs` | L48-49 | G2 断言从 19 工具改 20,数组加 `"generate_interactive_diagram"` | G1/G3 不动 |
| `package.json` | L20 | `"test": "node scripts/check-schema.mjs && node --test test/"`(引入 node:test runner) | check-schema 仍跑,加性 |

**立场红线重申(实地核实后口径)**:**不改 `generate_diagram` 的 inputSchema / handler 行为 / d2.ts 中 generate_diagram 现有路径的行为**。三杠杆(darkThemeID/noXMLTag/salt)通过 `types.ts` 加性可选字段 + d2.ts `renderOpts` 合并逻辑打通注入,`generate_diagram` 调用路径(index.ts L947-957)不传三字段 → 行为 byte-identical。原"d2.ts 不改"硬约束已放松,仅以"加性可选字段 + 旧路径零感知"方式放松,不动 generate_diagram 现有路径的任何行为(详见 §3.2 实测核实)。

---

## 7. 不变量硬约束

### 7.1 几何层与交互层严格分层

- **几何层**(D2 产出 SVG):坐标、形状、连线、布局。**viewer 绝不修改**。
- **交互层**(viewer JS + CSS 变量):主题色、pan/zoom transform、动画。**只读几何**。
- **不变量测试(S3)**:`extractGeometry(lightHtml) === extractGeometry(darkHtml)` byte-identical。

### 7.2 viewer 特性绝不污染 IR(本规划无 IR,但仍守)

- 本规划不走 IR 路线(§3.1),但 D2 DSL 是"事实 IR"。**viewer 增加的任何 CSS 类/属性只在 HTML 包装层,不回写 DSL**。
- 导出 SVG 时清理 viewer-state 属性黑名单(`data-motion`/`data-theme`/transform 等),保证"导出 = authored 静态几何"(借鉴 Archify L4322-4441 骨架,但只列黑名单不做大清洗)。

### 7.3 同输入同输出可入 git

- **C3 防线(实地核实后定位)**:D2 渲染仍传固定 `salt: "media-gen-mcp-interactive"`,但定位从"承重墙"降为"零成本防御 + 多图嵌入同 HTML 防 ID 冲突"。**S5 byte-identical 不依赖固定 salt**:实测 D2 默认渲染对同输入已 byte-identical(进程内 9/9 同;跨进程 2 个 Node 进程 LEN/HASH/SVG ID 全同),SVG 内 ID 形如 `mk-d2-{dsl_hash}-{common_suffix}` 是 DSL 内容哈希非随机。原 §0 C3 把"salt 默认随机"当风险是误诊,实测不成立。
- **模板内无随机源**:无 `Math.random`/`Date.now`,无字典乱序遍历。
- **真实 caveat(已在 MEMORY)**:`resolveD2Icons`(d2.ts L20-50)在 DSL 含 `icon:` 时调 Iconify API + resvg 光栅化 PNG → data URI,网络/远端字节变化会破 byte 级;但与 generate_diagram 同源同限,P0-5 不引入新风险。
- **降级预案(保留但触发概率极低)**:若 Step 1.2.5 实测出现 icon 以外的非确定性,降级为 `extractGeometry` 结构断言,诚实把立场口径从"byte 级"改为"结构级",并 sync 更新 MEMORY(详见未决问题 #2 答案)。

### 7.4 不破坏现有 19 工具签名

- 19 原工具 inputSchema byte-identical(diff 验证)。
- `generate_diagram` description 只加一行 cross-ref,不改参数。
- `check-schema.mjs` G1/G3 不动,只 G2 工具数 19 → 20。

---

## 8. 测试方案(node:test 从零引入)

### 8.1 测试现状(关键事实)

media-gen-mcp 当前**无任何自动化测试套件**。`package.json` L20 `"test": "node scripts/check-schema.mjs"` 只 spawn `dist/index.js` 跑 `tools/list` 校验 enum。根目录 24 个 `_test_*.mjs`(下划线前缀)是 ad-hoc 脚本,不接入 npm test。**P0-5 落地同时引入 `node:test` runner,作为 P0-3/P0-4/P0-5 共用基础设施**(open_points #5 决策点)。

### 8.2 `test/interactive-html.test.mjs` 用例清单(12+)

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderInteractiveHtml } from "../dist/interactive-html/index.js";
import { readFileSync } from "node:fs";

// 契约测试(S1-S12)
test("S2: 无外链 <script src=", () => {
  assert.doesNotMatch(renderExampleHtml(), /<script\s+src=/);
});
test("S3: light/dark 几何 byte-identical", () => {
  const g = (h) => /<svg[\s\S]*?<\/svg>/.exec(h)?.[0] ?? "";
  assert.equal(g(renderExampleHtml({})), g(renderExampleHtml({ darkTheme: "default" })));
});
test("S4: 含 @media (prefers-color-scheme: dark)", () => {
  assert.match(renderExampleHtml({ darkTheme: "default" }), /@media\s*\(\s*prefers-color-scheme:\s*dark\s*\)/);
});
test("S5: 同输入两次 byte-identical(归一化 \\r\\n 后)", () => {
  const norm = (s) => s.replace(/\r\n?/g, "\n");
  assert.equal(norm(renderExampleHtml()), norm(renderExampleHtml()));
});
test("S6: HTML ≤ 256KB", () => {
  assert.ok(Buffer.byteLength(renderExampleHtml()) <= 256 * 1024);
});
test("S9: prefers-reduced-motion 规则存在", () => {
  assert.match(renderExampleHtml(), /prefers-reduced-motion:\s*reduce/);
});
test("S11: 无 <?xml?> 声明(C2 防线)", () => {
  assert.doesNotMatch(renderExampleHtml(), /<\?xml/);
});
test("S12: D2 渲染传固定 salt(grep 实现)", () => {
  // 实现层断言:render-d2.ts 内 salt === "media-gen-mcp-interactive"
  // 用 stub D2Engine 捕获 renderOpts,断言 salt 字段
  // 【stub 注入机制实地核实(详见未决问题 #15)】D2Engine 无显式 constructor、无 DI 钩子(d2.ts L98 默认无参);
  //   推荐方案 A:renderD2ForInteractive(req, engine?: DiagramEngine) 加可选参数,测试传 stub closure
  //   退路方案 B:mock.method(D2Engine.prototype, "render", async () => ({ svg: FIXTURE_SVG }))(Node v24 已确认可用)
  //   方案 C(mock.module)需 --experimental-test-module-mocks flag 不稳放弃
});

// golden 测试
test("golden: fresh === checked-in", () => {
  const norm = (s) => s.replace(/\r\n?/g, "\n");
  const fresh = renderExampleHtml({ code: readFixture("architecture-d2.input.json").code });
  const golden = readFileSync("test/golden/interactive-html/architecture-d2.golden.html", "utf8");
  assert.equal(norm(fresh), norm(golden));
});

// mutation / 错误契约
test("empty code → err 含 'code'", async () => {
  const r = await callTool("generate_interactive_diagram", { code: "" });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /code/i);
});
test("unknown theme → err 含 known 列表", async () => {
  const r = await callTool("generate_interactive_diagram", { code: "a -> b", theme: "nope" });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /default|neutral|已知/);
});
```

### 8.3 golden 基线管理

- checked-in `test/golden/interactive-html/architecture-d2.golden.html` + `.input.json`。
- `scripts/render-interactive-examples.mjs` 刷新(`npm run render:golden`)。
- **确定性审计(Step 1.2.5,必做)**:落地前同输入连跑 10 次 diff,确认无时间戳/路径/salt 泄漏。若 flaky → 触发 §3.2 降级预案。

### 8.4 不破坏 check-schema.mjs

- G1(create_video enum)不动。
- G2(19 → 20 工具)更新数组 + 注释。
- G3(mode/resolution enum)不动。

### 8.5 端到端验证(可选 puppeteer 截图)

- 手工浏览器打开 `examples/interactive-html/system-architecture.html` 验证 S10。
- 可选 `scripts/screenshot-interactive-examples.mjs`(puppeteer 截图入 examples/),**不阻塞 MVP**。

---

## 9. 向后兼容策略

### 9.1 inputSchema 不破

- 19 原工具 inputSchema byte-identical(diff 验证)。
- `generate_diagram` description 末尾加一行 cross-ref(P0-1 风格),不影响参数 schema。

### 9.2 handler 不破

- 19 原 case 块逻辑零变化。
- 新增 `case "generate_interactive_diagram":` 独立块(§4.2)。
- **D2Engine.render() 现有行为不改**:三杠杆通过 `types.ts` `DiagramRequest` 加 3 个可选字段 + d2.ts L137-139 `renderOpts` 合并逻辑打通注入(详见 §3.2、§6.2)。`generate_diagram` 调用路径(index.ts L947-957)不传三字段,行为 byte-identical。原"d2.ts 不改"硬约束已实地核实为内部矛盾(详见未决问题 #14),放松为"加性可选字段 + 旧路径零感知"。

### 9.3 npm 包发布不破

- 版本 bump:0.11.0 → 0.12.0(MINOR,新功能向后兼容)。
- `files` 字段继续 `"dist"` 全量(新子目录自动包含)。
- 用户 `npm install media-gen-mcp-server@latest` 自动获得新工具,旧调用代码无需改。

### 9.4 测试不破

- `check-schema.mjs` 只 G2 工具数 +1,G1/G3 不动。
- 引入 `node:test` 是加性的(新增 test/ 目录)。

### 9.5 用户 memory 不破

- MEMORY 现有 `media-gen-mcp-project.md` / `media-gen-mcp-agnes-constraints.md` 不动。
- 新增一条 memory `media-gen-mcp-interactive-html.md`(由后续 memory-update agent 执行,不在本 P0 范围)。

---

## 10. 风险与缓解

### 10.1 License 风险(立场:纯免费)

| 依赖 | license | P0-5 用途 | 商用安全 |
|---|---|---|---|
| `@terrastruct/d2` | MPL-2.0 | 已用,D2 WASM(链 npm 包不传染) | ✅ 已用,无新增 |
| `@viz-js/viz` | **MIT**(三证核实,见 §12.4.11) | 已用,Graphviz WASM(本 P0 不用) | ✅ 已用 |
| puppeteer-core | Apache-2.0 | 已用,PNG 导出截图 | ✅ 已用 |
| Archify | MIT(三证确认) | **0 拷贝**,只 reimplement 工艺思路 | ✅ |
| markmap | MIT | **不 import 包**,只 reimplement 80 行 fillTemplate 范式 | ✅ |
| Mermaid(Tier 2) | MIT | 可选,inline mermaid.min.js | ✅ |
| **tldraw** | **🔴 专有** | — | **❌ 永不引入** |

**review checklist 加一条**:`grep -r tldraw node_modules/` 必须无命中。

### 10.2 工程风险

| 风险 | 缓解 |
|---|---|
| **过度工程**(Archify 10500 行 viewer 诱惑) | MVP 严守 1 种图 + 极简 viewer(pan/zoom/theme/export);Tier 2/3 单独立项 |
| **C3 salt 非确定性**(原规划误诊为 dagre / 误诊为 salt 默认随机) | **实地核实更正**:D2 默认渲染已 byte-identical(详见 §0 C3、未决问题 #2)。仍硬编码固定 salt 作为零成本防御 + 多图防 ID 冲突;Step 1.2.5 确定性审计 10 次 diff |
| **C2 `<?xml?>` 破 HTML** | Step 1.2 硬编码 `noXMLTag: true`;S11 测试守 |
| **产物体积膨胀**(Tier 2 mermaid ~2.8MB) | S6 ≤ 256KB 硬断言;Mermaid 默认 CDN,仅 offline=true 才 inline |
| **D2 WASM 在 test 环境 cold start 慢** | test 用 stub D2Engine(返回 fixture SVG)做契约测试,只 1 个 e2e 用例真调 D2。**stub 注入机制(详见未决问题 #15)**:D2Engine 无 DI 钩子(d2.ts L98 默认无参 constructor),推荐方案 A —— `renderD2ForInteractive(req, engine?: DiagramEngine)` 加可选参数(零产品代码侵入,符合 §6.2 立场红线);退路方案 B —— `mock.method(D2Engine.prototype, "render", ...)`(Node v24 已确认可用,零产品代码改动但牺牲显式可测试性) |
| **puppeteer 在 CI 装不上** | previewPng 默认 false;CI 跳过 puppeteer 用例(`{ skip: !hasChrome }`) |

### 10.3 立场风险

| 风险 | 缓解 |
|---|---|
| **同输入同输出被破**(原归因 salt/dagre 误诊) | 实测 D2 默认渲染已 byte-identical(§0 C3、未决问题 #2);仍传固定 salt 作零成本防御;icon caveat 已在 MEMORY;降级 extractGeometry 结构断言路径保留但触发概率极低 |
| **纯免费被破**(误引 GPL/专有) | §10.1 矩阵全表审查;新增依赖 license grep |
| **不破坏 19 工具签名被破** | §9.1 diff 验证;CI 加 schema diff stale gate |

### 10.4 可用性风险

| 风险 | 缓解 |
|---|---|
| **LLM 路由混淆 generate_diagram vs generate_interactive_diagram** | description 双向 cross-reference(§4.1 + generate_diagram 加 NEXT 行) |
| **GitHub README 嵌入失败**(某些平台拒 `<script>`) | D2 SVG 自带 `@media prefers-color-scheme` 无需 JS 即可双主题;viewer JS 是增强非必需。README 说明各平台嵌入限制 |
| **D2 darkThemeID 不生效**(themeID 不存在) | Step 1.2.5 e2e 实测双调色板注入;若不生效降级 CSS 变量双主题方案(open_points #6) |

---

## 11. 立项决策门(做 / 不做 / 做廉价新版)

### 11.1 决策标准

> **【实地核实更正(详见未决问题 #17)】**原 §11.1 把"用户 memory + 调研铁证"作为 GO MVP 的依据,**未实地核实**。三源归零实测:GitHub issues `wangdong233/media-gen-mcp` open+closed 均 0(HTML 抓 Issues tab Counter 徽章 + `?is:closed` 得 `totalCount:0` + blankslate);9 个 user memory 文件 grep `interactive|darkTheme|主题盲区|三层分工|prefers-color-scheme` 全 0 命中;项目 README 同关键词全 0 命中。**唯一来源**是调研文档(P0-5-Archify源码与同品类深度调研.md)§1.1 line 28 单句断言"用户想在 GitHub README 嵌一张随系统主题切换的架构图,当前完全无解" —— 无 issue link、无 quote、无频次计数。证据等级 **C(单句断言)**,与 P0-3(README 已对外承诺同输入同输出,等级 A)、P0-4(MEMORY 已记载真实事故 OCR 渲染必崩,等级 A+)对比显著垫底。
>
> ROI 实算(证据等级分 A+=1.0/A=0.7/B=0.3/C=0.05 × 已承诺立场数 / 人日):P0-3=0.7×1/5=**0.140**;P0-4=1.0×1/3.75=**0.267**;P0-5=0.05×0/8.5=**0.000**。P0-5 工时最高、证据最弱、ROI 垫底。
>
> **可量化决策门(替换原"盲区真实且高频"模糊表述)**:
> - **触发条件 1(频次基线硬门槛)**:≥3 个独立外部信号(GitHub issue / memory / npm 评价 / 公开 review / 用户 quote)提"GitHub README 主题切换",且 ≥1 个非作者本人。**当前实测 0/3 → 不满足**。
> - **触发条件 2(ROI 倍数门槛)**:立项 ROI < max(P0-3, P0-4) × 50% → 转 backlog。**0.000 < 0.267×50%=0.134 → 触发降级**。
> - **降级路径(可审计的妥协方案)**:(a) 立即做选项 B(0.5-1 人日,仅透传 darkThemeID 到 generate_diagram,D2 SVG 自带 `@media prefers-color-scheme` 无需 JS);(b) 设 30 天观察期,出现 ≥1 个外部信号 → B 升级 MVP,否则维持 B + 关闭 MVP 立项。
>
> 本规划仍**保留推荐 A(MVP)的论证结构**(供维护者拍板),但读者须知情:证据基础当前为空,GO MVP 决策需维护者明确承担"零证据预投 7-10 人日"的责任,或采纳降级路径先做 B + 30 天观察。

| 选项 | 适用场景 | 工时 | 立场风险 |
|---|---|---|---|
| **A. 做 MVP(Tier 1)** | ⚠️ **原推荐,但证据基础实测为空(详见未决问题 #17)**:堵 GitHub README 主题切换盲区**当前仅调研文档 §1.1 单句断言支撑**,无 issue/memory/README/事故支撑;D2 已进程内零新增依赖;license 全绿。维护者若 GO 须明确承担零证据预投责任 | **7-10 人日** | 低(C3 salt 防线经实测非承重墙,真实 caveat 是 icon Iconify API,已在 MEMORY) |
| **B. 做廉价新版** | ✅ **降级路径首选**:只暴露 D2 `darkThemeID` 透传到 `generate_diagram`(不加新工具),让静态 SVG 也支持双主题。D2 SVG 自带 `@media prefers-color-scheme` 无需 JS 即可双主题,真正解决"GitHub README 跟随系统主题"最小动作 | **0.5-1 人日** | 极低,但**不满足"交互档"定位**(无 viewer/无动画/无 theme toggle) |
| **C. 不做** | 维持两档,用户自己组合 generate_diagram + 手写 HTML | 0 | GitHub README 盲区仍在 |

**本规划原推荐 A(MVP)**,理由(读者须结合上方证据基础实测判定):
1. 盲区**理论上**真实且高频(GitHub README 是技术文档第一场景) —— **但实测证据 0 命中,需维护者判断是否预投**。
2. C1 核实后,D2 原生支持 darkThemeID,最难的零成本杠杆已在手。
3. 7-10 人日投入产出比**在三个 P0 里垫底**(ROI 0.000 vs P0-3 0.140 / P0-4 0.267),但首次引入测试基础设施 + 为 P0-3/P0-4 铺路这部分价值不依赖外部需求信号。
4. 廉价新版(B)只解决"静态 SVG 双主题",不解决"可交互探索",定位错位 —— 但若采用 30 天观察期路径,B 是合适的首步。

### 11.2 工时估算(人日,1 人日 = 8h)

| 阶段 | 工时 | 说明 |
|---|---|---|
| Tier 1 MVP | **7-10 人日** | 核实 C1 后较调研文档 8-12 下调;C2/C3 防线明确,无降级风险 |
| Tier 2 Mermaid(可选) | 4-6 人日 | 需求驱动,不阻塞 MVP |
| 立项决策 + review | 1 人日 | 本规划 + 一轮对抗 review |
| **总计 Tier 1** | **8-11 人日** | 含决策与 review |

---

## 12. 步骤分解 TODO(每步工时) + DoD + 未决问题

### 12.1 Tier 1 MVP 步骤(7-10 人日)

- [ ] **Step 1.0**(1 人日,已完成)P0-5 实施规划落盘(本文件)+ 一轮对抗 review
- [ ] **Step 1.1**(0.5 人日)README/CHANGELOG 写三层分工边界(§1.1)+ 命名决策(§1.2)
- [ ] **Step 1.2**(1 人日)**新建 `src/interactive-html/render-d2.ts`**,通过 `getDiagramEngine("d2") as D2Engine` 复用 singleton(严禁 `new D2Engine()` 触发 22MB WASM 双加载,详见 §3.2 / 未决问题 #13),传三杠杆(C1 darkThemeID 大写 / C2 noXMLTag / C3 固定 salt)。**前置:types.ts DiagramRequest 加 3 个可选字段 + d2.ts renderOpts 合并三字段**(详见 §3.2 / 未决问题 #14);stub SVG 测 fillTemplate 字节确定性
- [ ] **Step 1.2.5**(**关键 0.5 人日**)**确定性审计**:同输入连跑 10 次 diff,**预期 byte-identical**(§0 C3 / 未决问题 #2 实测默认渲染已 byte-identical,含跨进程 LEN/HASH/ID 全同);存档 10 次 diff 结果作证据。若意外出现 icon 以外的非确定性 → 触发 §3.2 降级预案(structure 级)+ 列 open_points + sync MEMORY
- [ ] **Step 1.3**(1 人日)新建 `theme.ts`(~45 CSS 变量 + pre-paint resolver)+ `template.ts` + `fill-template.ts`(markmap 范式,函数式 replace)
- [ ] **Step 1.4**(0.5 人日)新建 `motion-governor.ts`(极简版,prefers-reduced-motion + data-motion=still)
- [ ] **Step 1.5**(1 人日)新建 `viewer-min.ts`(pan/zoom + theme toggle + export 按钮,vanilla JS)
- [ ] **Step 1.6**(1 人日)新建 `export-png.ts`(puppeteer-core 首选 + pickSafeScale;resvg 兜底 + resolveVars)
- [ ] **Step 1.7**(0.5 人日)新建 `index.ts`(组装 + 6 个 assert + 落盘)
- [ ] **Step 1.8**(0.5 人日)改 `src/index.ts`:插工具定义(L303 后)+ case 块(L957 后)+ generate_diagram description cross-ref(L289 末)
- [ ] **Step 1.9**(1 人日)新建 `test/interactive-html.test.mjs`(12+ 用例 + golden + mutation)+ `test/golden/` 基线
- [ ] **Step 1.10**(0.5 人日)改 `package.json` test 脚本引入 `node --test test/`;改 `check-schema.mjs` G2 到 20 工具
- [ ] **Step 1.11**(0.5 人日)新建 `examples/interactive-html/system-architecture.d2` + 跑通端到端 + commit 产物
- [ ] **Step 1.12**(0.5 人日)手工浏览器验证 S10 + 截图入 examples/(可选 puppeteer 脚本)

**Tier 1 合计:7-10 人日**(Step 1.0 已完成)

### 12.2 Tier 2 可选步骤(4-6 人日,P1)

- [ ] Step 2.1(2 人日)Mermaid 客户端渲染(engine: "mermaid"),inline mermaid.min.js 或 CDN
- [ ] Step 2.2(1 人日)Mermaid 11 主题 + themeVariables brand 化 + securityLevel 决策(open_points #7)
- [ ] Step 2.3(1-2 人日)更多 viewer 交互(minimap / 键盘快捷键 / Story Trail)
- [ ] Step 2.4(1 人日)独立 examples 覆盖 sequence/state/gantt

### 12.3 验收 DoD(Definition of Done)

**功能**:
- [ ] S1 20 工具齐全(check-schema G2 绿)
- [ ] S2 自包含(grep 无 `<script src=`)
- [ ] S3 light/dark 几何 byte-identical
- [ ] S4 含 `@media (prefers-color-scheme: dark)`
- [ ] S5 同输入两次 byte-identical(或降级 structure-identical,open_points #2)
- [ ] S6 HTML ≤ 256KB
- [ ] S9 prefers-reduced-motion 规则存在
- [ ] S10 端到端浏览器渲染 + 切主题 + 导出 PNG
- [ ] S11 无 `<?xml?>`(C2 防线)
- [ ] S12 固定 salt(C3 防线)

**兼容**:
- [ ] 19 原工具 inputSchema byte-identical(diff)
- [ ] check-schema.mjs G1/G2/G3 全绿
- [ ] `npm test` 全绿(check-schema + node:test)
- [ ] generate_diagram 旧调用零感知(同 DSL 输出不变)

**立场**:
- [ ] License 全绿(§10.1 矩阵;Archify 0 拷贝;tldraw 0 引入)
- [ ] 同输入同输出 golden 入 git(byte 或 structure 级)
- [ ] 不破坏现有 19 工具签名

**文档**:
- [ ] README 加三层分工段落
- [ ] CHANGELOG 记 0.12.0 新工具
- [ ] examples/ 至少 1 份 DSL + 产物 + 截图
- [ ] generate_diagram / generate_interactive_diagram / render_video description 双向 cross-ref

### 12.4 未决问题(open_points,诚实列)

1. **命名最终决策** —— `generate_interactive_diagram`(本规划首选)vs `generate_diagram_html`(备选)。需维护者拍板。若改备选,§4.1 description 与 cross-ref 同步改名。

2. **[已解决 2026-07-21] C3 salt 固定后是否真能 byte 级确定性** —— Step 1.2.5 确定性审计 10 次 diff 验证。若仍 flaky(说明 D2 内部还有其他随机源如 dagre tie-break),降级为 `extractGeometry` 结构断言(SVG 子树拓扑相同即过,允许属性序/坐标像素级微差)。**此决策影响"同输入同输出可入 git"立场口径**:byte 级是理想,structure 级是底线。建议 Step 1.2.5 后即时决策并更新 MEMORY。

    - **答案(实地核实,dispositive)**:**原 §0 C3 的核心前提不成立**。实测 D2 默认渲染(不传 salt)对单图 IS byte-identical —— 进程内 3 输入×3 次=9/9 byte-identical,跨进程 2 个独立 Node 进程也 byte-identical(同 LEN=22247 / DJB2 HASH=5174486 / FIRST_ID=mk-d2-382716993-3488378134 / 同 tail 60 字节)。SVG 内 ID 形如 `mk-d2-2044524636-3488378134` 看似随机,实为 DSL 内容哈希(跨进程稳定,3488378134 是公共后缀,前缀随 DSL 变),非时间戳非随机。dagre 几何本身确定(跨进程同坐标),无时间戳泄漏,无 Math.random。
    - **子问题明确回答**:(a) D2 还有其他随机源?**无**。dagre tie-break 确定跨进程 byte-identical 已隐证;无时间戳;无 Math.random。(b) fixed salt 是 byte-identical 必要条件?**否,不是必要**。default=no salt 已 byte-identical;固定 salt 仍合理(零成本防御 + 多图同 HTML 防冲突的保险)。(c) S5 byte-identical 实际能达成?**能**。开放问题 #2 的"降级 structure 级"路径极不可能触发。(d) MEMORY 是否需 sync 更新?**不需要**。MEMORY 现口径"除 icon 外全本地确定性"对 D2 同样成立。
    - **承重的修订**:**把 §0 C3 的"salt 默认随机"误诊改正**(已在 §0/§7.3/§10.2/§10.3 同步修订)。建议 §0 C3 改写为:"default=no salt 已 byte-identical(实测跨进程);固定 salt 仍传(零成本防御 + 多图嵌入防 ID 冲突),但非 S5 byte-identical 的必要条件。"
    - **用户建议的"若降级则 sync MEMORY"动作**:合理零成本保险,降级触发概率极低故非承重,但加上无害。
    - **真实但 P0-5 未充分提及的确定性 caveat**:`d2.ts` `resolveD2Icons`(L20-50)在 DSL 含 `icon:` 时调 Iconify API + resvg 光栅化,理论上若 Iconify 返回不同字节或网络失败,产物 PNG data URI 会变。**但此 caveat 已在 MEMORY**("除 icon 外全本地确定性"),与 generate_diagram 同源同限,P0-5 不引入新风险。
    - **证据**:三段实地核实 —— (1) `@terrastruct/d2 index.d.ts` L27-28 官方 salt 语义("多图同 HTML 防冲突",未承诺"默认自动随机");(2) `/Users/wangdong/Documents/Project/Agnes AI接入/doc_v11/d2-salt-determinism-probe.mjs` 进程内 5 组测试(默认/ID 模式/三杠杆/salt-A vs salt-B/empty vs default);(3) `/Users/wangdong/Documents/Project/Agnes AI接入/doc_v11/d2-crossproc-probe.mjs` 跨进程 2 个独立 Node 进程 LEN/HASH/FIRST_ID/TAIL 全同。审计产物落盘 `doc_v11/d2-salt-determinism-probe-results.json`。

3. **PNG 导出路径首选** —— puppeteer-core(色彩准但启 Chrome 慢)vs `@resvg/resvg-js`(进程内快但不解析 CSS 变量需 resolveVars)vs `@napi-rs/canvas`(optionalDep 装不上风险)。**本规划建议 MVP 首选 puppeteer-core**(项目已用),previewPng 默认 false 避免每次启 Chrome。Step 1.6 实现时最终决策。

4. **落盘助手复用 vs 新写** —— `writeLocalRender(outDir, kind, name, format, rendered)` 现有签名(L516)的 `format` 参数可能只认 `"svg"|"png"`,不认 `"html"`。**需在 Step 1.7 实地核实**;若不认,新写 `writeInteractiveHtml(outDir, name, html)` 助手(不改 writeLocalRender,避免破现有 19 工具)。

5. **node:test 引入节奏** —— 本规划建议 P0-3/P0-4/P0-5 共同引入(本 P0 先建 test/ 目录 + node:test runner)。若维护者倾向分阶段,P0-5 可先用 ad-hoc node 脚本(根目录 `_test_*.mjs` 范式),后续 P0-3 统一接入 `npm test`。**此决策影响 §8 落地节奏**。建议 P0-5 直接引入(P0-3/P0-4 复用)。

6. **D2 darkThemeID 实际是否注入 @media prefers-color-scheme** —— C1 确认字段存在,但"字段存在"≠"自动注入 @media 规则"。**Step 1.2.5 必须实测**:调一次 `d2.render(diagram, { themeID: 0, darkThemeID: 1, noXMLTag: true, salt: "test" })`,grep 产出 SVG 是否含 `@media (prefers-color-scheme: dark)`。**若不注入**(D2 WASM 与 CLI 行为可能不同),降级为 P0-5 自研 CSS 变量双主题方案(~80 行,在 theme.ts 注入 `[data-theme="dark"] .d2-xxx { fill: ... }` 覆盖规则),多 1-2 人日。

7. **Mermaid Tier 2 securityLevel 默认值** —— strict(禁 click)vs loose(激活交互)。Tier 2 落地时决策。**建议默认 loose**(README 嵌入需可点 link),文档点明 XSS 风险。

8. **SVG only 导出路径** —— 某些平台(GitHub 嵌入式 SVG)拒 `<script>` 但接受 `<svg>`。是否同时输出 `.html` + `.svg`?**本规划建议 MVP 只输出 .html**(避免产物分裂),D2 SVG 自带 @media 无需 JS 即可双主题(无 JS 的 theme toggle 但自动跟随系统主题已足够)。若用户强需求再加 `format: "svg"` 参数。

9. **CI 集成节奏** —— 本规划假设 media-gen-mcp 有 GitHub Actions。若 CI 未就绪,golden + node:test 只能本地跑,长期 stale 风险。**建议同步推进 CI 接入**(独立工作,不属本 P0)。

10. **preset 系统(classic/signal-flow/blueprint)** —— Archify 有 3 preset 覆盖 CSS 变量。**本规划建议不引入**(与 D2 theme 概念冲突),需求驱动再加。

11. **[已解决 2026-07-21] `@viz-js/viz` license 标注错误(原 §10.1 矩阵第 515 行)** —— gap-fill 核实阶段发现并已就地修正。

    - **原文档标注**:`| @viz-js/viz | EPL-1.0 | 已用,Graphviz WASM(本 P0 不用) | ✅ 已用 |`
    - **答案**:实际 license 是 **MIT**(版本 3.28.0),不是 EPL-1.0。已就地修正 §10.1 矩阵。根因:viz-js 是 Graphviz 的 WASM 编译产物,Graphviz 上游本体是 EPL-1.0,调查者把"上游 Graphviz license"误当作"`@viz-js/viz` npm 包 license"。npm 包 package.json 只声明 wrapper 代码(MIT)的 license;深度合规视角下内嵌 Graphviz WASM 二进制仍属 EPL-1.0,但本矩阵以 npm package.json 声明为准列 MIT(与 npm 依赖矩阵行业惯例一致)。错误方向是**过度保守**,不是过度乐观;结论"✅ 已用/商用安全"仍正确且更稳(MIT 比 EPL-1.0 宽松)。
    - **证据(三证一致)**:
      1. 本地 `/Users/wangdong/Documents/Project/Agnes AI接入/media-gen-mcp/node_modules/@viz-js/viz/package.json` 第 14 行 `"license": "MIT"`,`version: "3.28.0"`(已 Read 全文核实)。
      2. 上游 `github.com/mdaines/viz-js/packages/viz/package.json` 第 14 行 `"license": "MIT"`(通过 mcp__zread__read_file 读取;master 包 version 3.25.0,本地 3.28.0 是更新发布,license 不变)。
      3. 上游 `github.com/mdaines/viz-js/blob/master/LICENSE` 首行 "MIT License",第二行 "Copyright (c) Michael Daines",全文为标准 MIT 文本,非 EPL-1.0。
    - **复核范围(§10.1 矩阵其他条目本地 + npm registry 核实,node v24.12.0)**:`@terrastruct/d2@0.1.33`=MPL-2.0 ✅、puppeteer-core@25.3.0=Apache-2.0 ✅、Archify=MIT(三证)✅、markmap=MIT ✅、Mermaid=MIT ✅、tldraw(GitHub LICENSE.md)=ELv2-style 专有 ✅。**仅 `@viz-js/viz` 一项错,其余 6 项全对。**

12. **[RESOLVED 2026-07-21] P0-5 与 P0-1 在 `generate_diagram` description 上的合并冲突**(P1 严重度)。

   **原疑问**:P0-1 §4.5 给 generate_diagram 加 NEXT 行('use render_svg for ...'),P0-5 §4.1 也给 generate_diagram description 末尾加 NEXT 行('use generate_interactive_diagram')。两 P0 同时落地会产生 description 合并冲突或重复 NEXT 段。

   **答案(已实地核实 src/index.ts:288-289 + 两份规划原文)**:疑问方向正确(P1 严重度合理),但两处事实纠偏:

   (1) **P0-1 §4.5 不加 NEXT 行**。P0-1 §4.5 表格行(line 331)是对已存在的 AVOID 句做 **in-place 字符串中部改写**(把 "hand-writing SVG is appropriate" 改为 "use `render_svg` (hand-written SVG with feGaussianBlur) for 酷炫/霓虹"),不是追加 NEXT。`render_svg ↔ generate_diagram` 双向 cross-ref 的 NEXT 行在**对侧 `render_svg` 上**(P0-1 §4.4(5) after,line 316:`NEXT: pair with \`generate_diagram\` for hybrid flows`),而非 generate_diagram 上。

   (2) **P0-5 §4.1 确实在 generate_diagram description 末尾追加 NEXT 行**(本文件 §4.1 line 198-201),指向 `generate_interactive_diagram`。本节已在 §4.1 "同时" 段前补充合并协调条款(引用本 open_point)。

   **真实冲突形态**:`src/index.ts` L289 当前是单行 TS 字符串字面量(整个 description 全在一行),含 "hand-writing SVG is appropriate" 中段句子(P0-1 改这里),字符串末尾是 P0-5 要 append NEXT 的位置。Git 三方合并按行工作 → 两 PR 都改 L289 这一行 → Git 必报 textual conflict,即使改的是字符串内不同字符位置。解决机械:手动把 P0-5 的尾部 NEXT append 拼到 P0-1 改过的中段 AVOID 字符串上。

   **无"重复 NEXT 段"风险**:P0-1 §3.3(line 129)定规则"每工具最多塞 1 条 NEXT";P0-1 不给 generate_diagram 加 NEXT(只改 AVOID),只有 P0-5 加一条 → 合并后 generate_diagram 恰好 1 条 NEXT,符合策略。

   **真正的风险**:若实施者把两 P0 视作互不感知独立改动,**后落地的 PR 全量重写 description 字符串**(而非基于对方已合并版本做 in-place edit),会静默丢失另一侧的 cross-ref(要么丢 `render_svg` reciprocal,要么丢 `generate_interactive_diagram` NEXT)。

   **处置协议(已在 §4.1 落地协调条款)**:
   - **所有权**:**P0-1 拥有 generate_diagram description 的权威模板**(P0-1 是 19 工具 description 改写的专属 P0,§4.1 line 144 明确修改 L288-289)。P0-5 的 NEXT append 是副作用而非本职。
   - **推荐落地顺序**:**P0-1 先合并 → P0-5 后合并并 rebase onto P0-1**。让 P0-5 的实施者在 P0-1 已落地的 canonical 字符串上做"末尾加 NEXT"的一行 edit,比反过来(P0-5 先,P0-1 rebase 19 处)成本更低。
   - **合并后必须同时满足的断言**(可加进 S7 inputSchema byte-identical 之外的 description 断言,或 P0-3 golden byte-compare):
     - generate_diagram description 含 `render_svg`(P0-1 AVOID reciprocal 存在)
     - generate_diagram description 含 `generate_interactive_diagram`(P0-5 NEXT 存在)
     - generate_diagram description 中 `NEXT:` 出现恰好 1 次(不重复,守 P0-1 line 129 "每工具最多 1 条 NEXT" 策略)
     - generate_diagram description 长度 ≤ 1100(P0-1 §5 硬限)

   **为何不升级到 P0**:冲突是机械可解的文本合并,无语义冲突、无 NEXT 重复、无策略违反。只要两 PR 实施者读到此协调指令(或 PR 模板加 checklist 项),即可零风险落地。维持 P1。

   **证据**:src/index.ts:288-289(单行 description 现状,含 "hand-writing SVG is appropriate" 中段句子,末尾无 NEXT);P0-1:331(in-place AVOID 改写,非 NEXT 追加);P0-1:316(render_svg 侧 NEXT);P0-1:129(单工具最多 1 条 NEXT 策略);P0-5:198-201(末尾 NEXT append 指向 generate_interactive_diagram);grep generate_diagram 于 P0-2/P0-3/P0-4 仅命中 handler/case/return 包装,**无 L288-289 description 命中**(排除交叉,description 字符串仅 P0-1+P0-5 两家触)。

13. **[已解决 2026-07-21] §3.2 D2Engine singleton 访问器缺失 + `new D2Engine()` 触发 22MB WASM 双加载** —— 原 §3.2 L120 写"在 src/interactive-html/render-d2.ts 新建 thin wrapper,内部 new D2Engine() 或复用单例"含糊,**实地核实两种说法都有问题**。

    - **答案**:`D2Engine` 类(d2.ts L98)只 `export class D2Engine`,无 `getD2Singleton()` 访问器。真正全局 singleton 在 `src/diagram/render.ts` L14 `const d2 = new D2Engine();`(模块级),只能通过 `render.ts` L23 `getDiagramEngine(name?)` 拿到,返回类型是 `DiagramEngine` 接口而非具体 `D2Engine` 类。`new D2Engine()` 会加载第二份 22MB WASM:`d2.ts` L100 `private d2?: D2;`(实例级 private)+ L115 `this.d2 ??= new D2();`(lazy init 绑在 `this`)+ L8/L114 注释明示"每实例独占 worker + 22MB 堆"。全仓 grep `new D2Engine` 仅 render.ts L14 一处;`getD2Singleton`/其他 singleton 访问器全无。
    - **裁决(Option A,采纳)**:`src/interactive-html/render-d2.ts` 写 `const engine = getDiagramEngine("d2") as D2Engine | undefined;`(`src/interactive-html/` 与 `src/diagram/` 是平级兄弟目录,`../diagram/render.js` 解析正确)。
    - **不采纳 Option B**(在 d2.ts 加 `export function getD2Singleton()`):冗余,`getDiagramEngine("d2")` 已能拿 singleton,只需类型断言。
    - **更深层矛盾(必须 surface,关联 #14)**:即使复用 singleton,**三杠杆也传不进去** —— `DiagramRequest`(types.ts L11-26)无 `darkTheme`/`noXMLTag`/`salt` 字段;`D2Engine.render()`(d2.ts L137-139)硬编码 `renderOpts = { ...compiled.renderOptions, themeID }`,无扩展钩子;底层 D2 句柄 `private`(L100)。所以 §6.2 L359 的"d2.ts 不改"与 §3.2"传三杠杆"**直接互斥** —— 见 #14。已在 §3.2 就地修订原含糊表述。
    - **证据**:d2.ts L8(22MB 注释)、L94-96(模块级共享 refcount)、L98(唯一 export)、L100(`private d2`)、L101(`private chain`)、L114-115(lazy singleton 实例级)、L137-139(硬编码 renderOpts);render.ts L14(模块级 singleton)、L23-27(唯一访问器);types.ts L11-26(DiagramRequest 无三字段);index.ts L947-957(generate_diagram 不传三杠杆);@terrastruct/d2 index.d.ts L13-14/L27-28/L29-30(WASM 三杠杆字段存在);src/ 目录列表(有 diagram/、render-svg.ts、render-video.ts,无 interactive-html/ → greenfield);全仓 grep `new D2Engine`/`getD2Singleton`。

14. **[已解决 2026-07-21] §6.2 "d2.ts 不改" 与调研文档 §4.5.5 "改 d2.ts" 立场相反** —— 实施规划 §6.2 L359 "src/diagram/d2.ts | 不改" 与调研文档 P0-5-Archify源码与同品类深度调研 §4.5.5 "改 d2.ts/types.ts" 立场相反。**调研文档对,实施规划错(内部矛盾)**。

    - **答案(约束求解,四约束无解)**:实施规划反复声明"thin wrapper 复用 D2Engine + 不改 d2.ts + 传三杠杆 + 60 行"四联约束(§3.2 L120、§6.1 L330、§6.2 L359、§9.2 L488),但 d2.ts 当前结构使四者不能同时满足。`D2Engine.render(req)`(d2.ts L112-168)是唯一公开入口,内部硬编码 renderOpts 只透传 themeID(L136-139);D2 实例字段 `private d2?`(L100);6 个底层 helper(resolveD2Icons/d2FitTo/resolveD2Theme/enhanceD2Error/D2_THEME_NAME_TO_ID/d2KeepAlive)全无 export —— grep 确认 d2.ts 唯一 export 是 `class D2Engine`(L98);`DiagramRequest`(types.ts L11-26)无三字段。thin wrapper 只剩 4 条路径,每条都破至少一条规划声明(详见 gap-fill 答案的约束求解表 A/B/C/D)。
    - **裁决**:必须放松 §6.2 L359 / §9.2 L488 的"d2.ts 不改"硬约束,**仅以加性可选字段方式放松,不动 generate_diagram 现有路径的任何行为**(已在 §6.2/§9.2/立场红线/§3.2 就地修订)。
    - **最小加性改动方案(主推)**:(1) 在 `types.ts` 给 `DiagramRequest` 加 3 个可选字段 `darkTheme?: string; noXMLTag?: boolean; salt?: string;`(纯加性,graphviz 引擎忽略);(2) 在 `d2.ts` L137-139 把 `renderOpts` 改为读 `req` 三字段并合并;(3) `generate_diagram` 现有调用不传三字段 → 走默认 → 行为 byte-identical。
    - **替代方案(更干净)**:在 d2.ts 加 `export function renderD2Raw(code, opts): Promise<{svg, png?}>`,D2Engine.render() 内部调它,render-d2.ts 直接调它传任意 opts。这样 generate_diagram 路径零感知,三杠杆走新 export,60 行 wrapper 可达。
    - **附带发现(调研文档方案也有缺陷)**:调研文档 §4.5.5 只展示 darkTheme 透传骨架,noXMLTag/salt 没设计进 DiagramRequest —— 这两字段是 interactive-html 专属,塞进 generate_diagram 的公共输入类型是类型污染。即便走调研方案也需要给 interactive-html 开旁路。**主推方案 = 替代方案(renderD2Raw)更干净**,维护者二选一。
    - **证据**:d2.ts 仅 export `class D2Engine`(L98),6 helper 全私有(grep `^export` 只命中 L98);D2Engine.render(req)(L112-168)硬编码 renderOpts 只透传 themeID(L136-139);types.ts DiagramRequest(L11-26)无三字段;@terrastruct/d2 index.d.ts L13-14/L27-28/L29-30 三字段在 WASM 层确认存在;render-d2.ts 不存在(interactive-html/ 目录未建)。相关文件(只读核实):d2.ts / types.ts / render.ts / node_modules/@terrastruct/d2/index.d.ts / 本规划 §3.2 L120 / §6.1 L330 / §6.2 L359 / §9.2 L488 / 调研文档 §4.4.2 L240 / §4.5.1 L253/296 / §4.5.5 L439-462。

15. **[已解决 2026-07-21] §10.2 stub D2Engine 注入机制未说明** —— 原 §10.2 L532 / §8.2 S12 L432-435 写"test 用 stub D2Engine 捕获 renderOpts,断言 salt 字段"未说明 stub 注入机制。**实地核实 D2Engine 无 DI 钩子,但有干净解法**。

    - **答案**:`D2Engine`(d2.ts L98)类体只有三个私有字段(`d2?`/`chain`/`unrefApplied`),无显式 constructor(grep 未匹配),只有默认无参 constructor;无 setter、无 registry、无 factory 钩子。`render.ts` L14 模块级 singleton 写死,L23-27 `getDiagramEngine` 直接返回,**无注入入口**。**但 `DiagramEngine` interface 是公开的**(types.ts L41-46),任何满足此形状的对象都是合法 stub —— 缺的只是"把 stub 塞进调用路径"的入口。
    - **方案 A(推荐)**:`renderD2ForInteractive(req, engine?: DiagramEngine)` 加可选参数,测试传 stub closure,生产不传。立场合规(`src/interactive-html/render-d2.ts` 是 §6.1 列的新增文件,在新文件里加可选参数不算改既有源码)。测试分层:S12/S4/杠杆断言直调 `renderD2ForInteractive(req, stubEngine)`;S2/S3/S6/S9/S11(grep HTML 结构)用 fixture SVG 调 fillTemplate;只有 S5 golden / S10 e2e 真调 D2Engine(1 个 e2e,符合 §10.2 约定)。
    - **方案 B(备选,零产品代码改动)**:`mock.method(D2Engine.prototype, "render", async () => ({ svg: FIXTURE_SVG }))` + `t.after(() => stub.mock.restore())`。Node v24.12.0 实测 `typeof require('node:test').mock.method === "function"` 可用。缺点:prototype monkey-patch 是运行时全局状态,测试间需严格 teardown,并行/嵌套易污染。
    - **方案 C(不推荐)**:`mock.module` 替换整个 d2.js。Node v24.12.0 实测 `mock.module === undefined`,需 `--experimental-test-module-mocks` flag,稳定性差。
    - **结论**:未决点关闭,推荐方案 A。落地时给 `renderD2ForInteractive` 加可选 `engine?: DiagramEngine` 参数即可,既不破坏"不改 d2.ts/19 工具签名"立场红线,也不需 monkey-patch。
    - **已在 §10.2 L549 / §8.2 S12 L432-435 就地补充** stub 注入机制说明。
    - **证据**:d2.ts L98(`export class D2Engine implements DiagramEngine`)、L100-102(三私有字段)、grep `constructor` 在 d2.ts / graphviz.ts 均无匹配;render.ts L14(模块级 singleton import 时实例化)、L23-27(无注入入口);types.ts L41-46(DiagramEngine interface 公开 = 天然 mock 抓手);Node v24.12.0 `mock.method === function` / `mock.module === undefined` 实测;index.ts L938-957(generate_diagram 路径与新工具路径完全分离)。

16. **[已解决 2026-07-21] §3.5 puppeteer-core 行号引用错误(L25 应为 L44)** —— 原 §3.5 L153 写"puppeteer-core(已在 dependencies,L25)"是错误的行号引用。**实地核实并就地修正**。

    - **答案**:puppeteer-core 实际在 `package.json` L44 `"puppeteer-core": "^25.3.0",`;L25 是 `"engines": { "node": ">=18" }` 块的闭合 `}`(L23-25)。严重度 P1 合理 —— 孤立 typo 非系统性错误:§3.5 三条依赖行号引用中 `@napi-rs/canvas`(L52)、`@resvg/resvg-js`(L39)均正确,只有 puppeteer-core 错。推测成因:作者把 puppeteer-core 版本号 `^25.3.0` 中的 "25" 误当行号。
    - **影响被部分软化**:同文档 L645 的 open_points #3 重述了同一 puppeteer-core 首选但未带行号,交叉读 open_points 的实施者不会被误导;只读 §3.5 的实施者会找不到。
    - **修复**:已在 §3.5 就地把 "L25" 改为 "L44",其余 §3.5 行号(L39、L52)保持不动。
    - **证据**:文档 L153(§3.5)原文 grep 确认全文档唯一 L25 引用;package.json 实地核实 L25(`},` engines 块闭合)/ L39(`@resvg/resvg-js`)/ L44(`puppeteer-core: ^25.3.0`)/ L52(`@napi-rs/canvas`);grep puppeteer-core 在文档中共 5 处(L153/L336/L516/L591/L645),仅 L153 带行号 L25,L645 重述同首选但无行号。

17. **[已解决 2026-07-21] §11.1 立项决策门不可量化 —— 证据基础实测为空** —— 原 §11.1 line 559 把"用户 memory + 调研铁证"当作 GO MVP 依据时**未实地核实 memory 与 issue 是否真有此需求记载**,这是 §0(line 15 自夸"实地核实了 media-gen-mcp 源码")与 §11.1 之间的内部矛盾。

    - **答案(三源归零实测)**:
      - **GitHub issues = 0(open + closed 均 0)**:抓 `https://github.com/wangdong233/media-gen-mcp` 仓库首页 HTML 读 Issues tab Counter 徽章 `class="Counter">0<`;再抓 `?q=is:issue+is:closed` 得 `"totalCount":0` + blankslate empty-state class。仓库**从未收到任何 issue**。
      - **User memory = 0 命中(9 个 memory 文件)**:`grep -rn -i -E "interactive.*html|交互式图|generate_interactive|darkTheme|主题盲区|README.*盲区|三层分工|prefers-color-scheme|深色|暗色|夜间模式"` 全 0 命中。文档 §11.1 line 559 引用的"用户 memory"**不存在**。
      - **README = 0 命中**:`curl raw.githubusercontent.com/.../README.md` + grep 同关键词全 0。README 从未对外承诺此功能。
      - **唯一来源**:调研文档 §1.1 line 28 单句断言"用户想在 GitHub README 嵌一张随系统主题切换的架构图,当前完全无解"。无 issue link、无 quote、无频次计数。
    - **ROI 对比(实读 P0-3/P0-4/P0-5 工时 + 证据)**:P0-3 5 人日/等级 A(README 已承诺)/ROI **0.140**;P0-4 3.75 人日/等级 A+(MEMORY 已事故)/ROI **0.267**;P0-5 7-10 人日/等级 C(单句断言)/ROI **0.000**。P0-5 工时最高、证据最弱、ROI 垫底。
    - **建议的可量化决策门阈值(已在 §11.1 就地替换)**:
      - 触发条件 1(频次基线硬门槛):≥3 个独立外部信号(GitHub issue / memory / npm 评价 / 公开 review / 用户 quote),且 ≥1 个非作者本人。**当前实测 0/3 → 不满足**。
      - 触发条件 2(ROI 倍数门槛):立项 ROI < max(P0-3, P0-4) × 50% → 转 backlog。**0.000 < 0.134 → 触发降级**。
      - 降级路径:(a) 立即做选项 B(0.5-1 人日,仅透传 darkThemeID 到 generate_diagram,D2 SVG 自带 `@media prefers-color-scheme` 无需 JS);(b) 30 天观察期,出现 ≥1 个外部信号 → B 升 MVP,否则维持 B + 关闭 MVP 立项。
    - **结论**:文档 §11.1 立项证据是空的,这一点是**确定结论**,不是"还需要更多信息"。已在 §11.1 就地补证据基础实测 + 可量化决策门,保留推荐 A(MVP)的论证结构(供维护者拍板),但读者须知情:GO MVP 决策需维护者明确承担"零证据预投 7-10 人日"的责任,或采纳降级路径先做 B + 30 天观察。
    - **证据**:GitHub issues HTML + closed issues `totalCount:0` + blankslate;9 个 memory 文件多组语义关键词 grep 全 0;README curl + grep 全 0;调研文档 §1.1 line 28 原文;P0-3 §1.1 line 14-22 + L573 工时 5 天 + L765 决策结论;P0-4 §1.1 line 12-20 + L478 工时 ~3.75 人日 + MEMORY OCR 事故;本规划 §11.2 L573 Tier 1 MVP 7-10 人日。

---

**规划结束**。读者读完应能直接判断:

1. **做不做?** —— **原推荐做 MVP**(Tier 1,7-10 人日),**但证据基础实测为空**(详见 §11.1、未决问题 #17):盲区当前仅调研文档 §1.1 单句断言支撑,GitHub issues/memory/README 三源归零。读者须知情:GO MVP 决策需维护者明确承担"零证据预投 7-10 人日"的责任,或采纳降级路径(先做 B 仅透传 darkThemeID 到 generate_diagram,0.5-1 人日,30 天观察期)。license 全绿;不破现有 19 工具。
2. **先做哪个 Tier?** —— Tier 1 MVP(D2 + markmap 范式 + 极简 viewer + 固定 salt 零成本防御)→ 验证采用度 → 决定是否做 Tier 2 Mermaid。
3. **哪些不做?** —— 永不做 Archify IR/手写 SVG/10500 行 viewer(立场冲突 + 过度工程);不抄 Archify 代码(reimplement);不引入 IR(立场红线)。
4. **能不能抄代码?** —— **不能**。Archify 虽 MIT 但工程适配度差,选 reimplement;CSS/TS 全自研,只抄工艺思路(CSS 变量分层 / sentinel replace / Motion Governor 触发条件清单)。
5. **同输入同输出立场守住没?** —— **实测 D2 默认渲染已 byte-identical(进程内 9/9 + 跨进程 LEN/HASH/ID 全同)**,S5 byte-identical 在默认行为下即达成,不依赖固定 salt(详见未决问题 #2)。原"C3 固定 salt 是关键防线"是误诊 —— 固定 salt 仍传但定位降为"零成本防御 + 多图嵌入防 ID 冲突"。真实 caveat 是 icon Iconify API,已在 MEMORY。MEMORY 现口径"除 icon 外全本地确定性"对 D2 同样成立,无需 sync 更新。
6. **相对调研文档最大的修正?** —— (a) **C1/C2 字段级偏差**:darkThemeID 字段名大写 / noXMLTag 必传,调研文档方向正确但实施细节按 §0 修正表校准;(b) **C3 误诊**:原规划(本文件)误把"salt 默认随机"当风险,实地核实不成立(详见未决问题 #2);(c) **§6.2 "d2.ts 不改" 立场错**(详见未决问题 #14):四联约束无解,必须放松为"加性可选字段 + 旧路径零感知";(d) **§11.1 立项证据空**(详见未决问题 #17):三源归零,需维护者承担零证据预投责任或采纳降级路径。
