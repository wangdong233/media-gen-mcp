# Archify 深度分析与借鉴报告(tt-a1i/archify -> media-gen-mcp)

> **一句话结论**:Archify 的最高价值不在它的图 IR,而在它的「校验工艺」——三层校验闸门 + LLM 友好错误契约 + 产物侧统一守门人 + golden byte-compare + 盲评方法学,这五件套几乎可以 1:1 平移到 media-gen-mcp 且严守纯免费/同输入同输出立场;唯一需要慎重评估的大件是「交互式 HTML 图产物」(P0 但 L 成本,建议立项再决策),其余皆为低风险加固。
>
> **生成日期**:2026-07-21

---

## 一、Archify 是什么(背景速览)

| 维度 | Archify | 与 media-gen-mcp 的关系 |
|---|---|---|
| **定位** | 面向 Claude / Codex CLI / opencode 的 **agent skill**,把自然语言描述编译成**单文件自包含 HTML 图**(可二次导出 PNG/JPEG/WebP/SVG/WebM) | 不是同形态竞品。Archify 是「skill 形态 + 单一图领域深耕」,media-gen-mcp 是「MCP server + 全图像操作横向覆盖」。**互补关系** |
| **能力范围** | 5 类架构图:architecture / workflow / sequence / dataflow / lifecycle。专精,不做 chart / card / QR / formula / icon / video / OCR / PDF | 领域几乎不重叠(只有"画图"这一狭窄交集)。Archify 的图是"语义可探索",media-gen-mcp 的图是"快速产物" |
| **技术栈** | (1) JSON Schema(draft 2020-12)强约束 IR;(2) **手写 SVG 字符串**(不走 D2/Graphviz/Mermaid)以保证布局可控可验证;(3) ajv 在构建期 standalone codegen 出零依赖 validator(入仓);(4) 单文件 HTML 3500 行 CSS + 7000 行 JS 内联(主题/preset/动效/导出/viewer 面板);(5) 纯 CSS @keyframes 动效 + Motion Governor 冻结规则;(6) 客户端 canvas.captureStream 录 WebM(无 ffmpeg/Puppeteer) | media-gen-mcp 是 **Node.js/TypeScript MCP server**,引擎靠 D2/Graphviz/Vega-Lite/Satori/resvg 等第三方库 + 远程 Provider。**完全不同的工程范式** |
| **License** | bundle 中未明确写出 LICENSE 文件,但项目公开可读。**为安全起见,本报告默认"license 未明"处理**,所有借鉴路径均推荐 reimplement 而非抄代码 | media-gen-mcp 严守 **Apache 2.0/MIT 优先**。立场检查贯穿全文 |
| **发布形态** | skill 形态(SKILL.md 是 agent 指令单一真相源)+ CLI 七子命令(doctor/demo/guide/render/validate/check/examples) | media-gen-mcp 是 npm 包 + MCP server,无 skill 层覆盖 |
| **决定性决策**(ROADMAP) | (1) **拒绝 auto-layout**(2026-04-16 v3 盲测 FAIL 证实 auto-layout+CSS 不显著优于 Mermaid);(2) **拒绝 YAML IR**(LLM 生 YAML 易"看起来对但解析错");(3) **Mermaid 不写 parser**,只用 prompt engineering 当输入方言 | media-gen-mcp 在 generate_diagram 里**确实**用了 auto-layout(D2/Graphviz),这与 Archify 立场**相反**——但不构成借鉴冲突,因为两个项目面对不同问题(Archify 要"语义可控",media-gen-mcp 要"DSL 直传快速出图") |

---

## 二、核心机制拆解

### 2.1 Schema IR:JSON Schema draft 2020-12 强约束 + 三层校验

- **每图一份独立 schema**,顶层四必填:`schema_version`(const:1)、`diagram_type`(const 锁死)、`meta.title`、图特有结构数组。
- **全层 `additionalProperties:false`**:LLM 幻觉字段名(如 `colour`)会被直接拒而非静默吞。
- **common.schema.json 抽 6 个原子**(id/point/componentType/variant/guidedViews/cards)被五图 `$ref` 复用,演示了"共享原子 + 本地扩展"范式。
- **ID 正则 `^[a-zA-Z][a-zA-Z0-9_-]*$`**(字母开头防 CSS 选择器/锚点陷阱)。
- **schema_version 用 const:1 而非数字递增**——增量字段不 bump,只有破坏性 IR 形状变更才升 2。v1 文件在所有 2.x 渲染器上保持可校验可渲染,这是对"agent 生成 IR 永久可读"的硬承诺。
- **三层校验闸门**:① schema 本体(`required/enum/const/additionalProperties`)→ ② ajv standalone codegen 在构建期把 5 类 schema 编译成 `generated-validators.mjs` 入仓,运行时零依赖 → ③ 共享 loader 用命令式代码兜底跨集合事实(重复 view id、focus 引用不存在等)。

### 2.2 渲染器:手写 SVG + CSS 变量分层 + 客户端导出

- **手写 SVG 字符串**而非 D2/Graphviz——为了完全的布局控制(可写验证器硬检组件重叠/标签压组件/viewBox 越界)、可预测的确定性输出、SVG 语义类名能被模板 CSS 实时换肤。
- **主题/preset 全走 CSS 变量**:`<html data-theme="dark|light" data-preset="classic|signal-flow|blueprint">`,SVG 元素挂语义类名(`.c-frontend/.a-emphasis/.t-security`),类只是 `var()` 代理。**切换主题 = 改一个属性,不重渲染、不重算几何**。
- **Motion Governor**:在 `html:not([data-motion-capable])` / `[data-motion='still']` / `[data-embed='true']` / `[data-document-hidden='true']` / `@media (prefers-reduced-motion: reduce)` 任一成立时,强制 `animation:none !important`,让静态产物/嵌入/无障碍场景永远回到 authored 静态态。
- **导出 4 路客户端实现,零服务端**:PNG/JPEG/WebP 走 `SVG→Image→canvas.toBlob`(把 SVG width/height 设为 viewBox×scale 让浏览器原生栅格化,杜绝上采样模糊;`pickSafeScale` 在 16Mpx 内选最大倍率避开 iOS Safari 空白画布);SVG 走 `XMLSerializer`,`autoTheme=true` 同时注入 dark+light 双套变量 + `@media (prefers-color-scheme)` 让单文件 SVG 在 GitHub README 自动随系统主题切换;WebM 走 `canvas.captureStream + MediaRecorder`(无 ffmpeg)。
- **导出时清理 viewer 探索态**:strip 掉 `data-view-scale/data-focus-active/[data-story-step]` 等几十个属性,保证"导出 = authored 静态几何"。
- **关键不变量**(CHANGELOG 2.0→2.11):每条 viewer 特性(Story Carrier/Flow Tokens/Sigils/Reading Depth/Route Probe)都附 "no schema/IR/renderer layout/dependency changed" 声明——**viewer 特性绝不污染 IR/几何**。

### 2.3 测试体系:golden byte-compare + 单点 mutation + degraded + seeded 属性

- **runner 选型**:全部 Node 内置 `node:test` + `node:assert/strict`,零运行时依赖,仅 ajv 作 devDependency(build-time codegen)。`npm test` 三段式:`check:validators`(stale gate)→ `node test/golden.mjs`(独立 byte-compare)→ `node --test test/*.test.mjs`(7 个文件)。
- **golden.mjs**:对 5 类图各取一份 checked-in example JSON-IR 在 tmp fresh-render,产物 HTML 与 examples/ 下提交版本做 **全文 UTF-8 字符串全等比较**(只对 `\r\n?` 归一化)。不是 hash、不是 snapshot、不是像素 diff——**就是字节比**。flaky 由"渲染器纯函数化"(不读 `Math.random`/时间戳,字典遍历用排序键)消除。失败提示直接告诉开发者"re-render examples 并 commit"。golden.mjs 还打包 9 条 ajv schema 负向用例 + 模板新鲜度 + 5 处版本同步(package/lock/SKILL.md/README badge/docs)。
- **render-output-checks.test.mjs**:对 `scripts/check-render-output.mjs`(651 行,渲染后校验唯一真相源)做契约测试。守护 7 类契约:`single_svg`/`finite_svg`/`orthogonal_arrows`/`legend_clearance`/`relationship_crossings`/`container_border_runs`/`route_rhythm`。**profile 双轨**(standard 警告 / showcase 阻断)让同一份 checker 服务不同质量档。
- **layout-rules.test.mjs**:**单点 mutation 范式**——对合法 example 改恰好一个字段制造一次违规,断言 renderer 退出非 0 + stderr 含期望子串 + 不含 TypeError/Cannot read(防 crash)。**最核心:错误消息契约显式锁定——每条消息必须同时带阈值数字和修复动词**(如 `wider than node, shorten the label`),理由是"消费方是 LLM,只能凭这一句话改 JSON"。
- **degraded.test.mjs**:把 skill 复制到 tmp(排除 node_modules/test/.validator-check-*)模拟"已安装"环境,对每个 mode × 数组字段改成字符串 `'oops'`,断言三件套(退出非 0 + 不 crash + HTML 无 NaN/undefined)。还验证无 node_modules 时 unknown 字段被拒 + stderr 含 `workflow schema validation failed` + `additionalProperty:"colour"`,证明 standalone validator 真的在工作。
- **mulberry32 seeded PRNG + Fisher-Yates**:3 mode × 8 seed 打乱 nodes/states 顺序必须全部渲染成功 + 无 NaN,守护"顺序无关性"。
- **animation.test.mjs**:**断言静态产物里的动效契约**(data-animation/data-animate 标记 + data-preset 触达 html/svg/CSS 三层),不跑真实时间轴,既快又确定。同输入两次渲染的 hooks 数组 `deepEqual`(确定性)。

### 2.4 SKILL.md 工艺:agent 指令单一真相源

- **YAML frontmatter 极长 description** 同时承担三个角色:① 触发词清单(architecture/cloud/CI-CD/state machine/PII boundary/Mermaid 美化);② 产物能力声明(Reading Depth/Route Probe/Semantic Lens/Story Beat);③ Claude/Codex 决定何时激活该 skill 的依据。
- **正文强约束语气**规定 5 步交付循环:`guide "<scenario>"` → 写 `<name>.<type>.json` → `render` → `validate --quality standard|showcase` → `check`,五步缺一不可。
- **"never edit the renderer"** 硬规则——失败时只改 JSON,不编辑渲染器。
- **Cardinal Rule**:禁止 inline 颜色,只用 `c-backend/a-emphasis` 等 CSS class,配套 6 项 grep 级 self-review checklist 作交付前硬门。
- **CLI 七子命令**(doctor/demo/guide/render/validate/check/examples)把工作流固化成可脚本化、可 CI 化的契约。
- **guide 子命令的 11 个 bounded recipe**:每个附 evidence(为何选这个图类型)/boundary(何时不适用)/copy-ready prompt(可直接粘贴的起始 prompt)。

### 2.5 实验方法学:v3-mermaid-validation A/B/C 盲评

- **自我证伪的视觉质量验收实验**:假设"Mermaid 输入 + Claude 布局 + Archify CSS"显著优于原生 Mermaid。5 张真实在用的 Mermaid `flowchart`(4 源:mermaid 官方文档/kubernetes/website/moke-kit/hivenue-cicd/Broad Institute taiga),节点 5-12,复杂度覆盖 plain/subgraph/decision diamonds/classDef/多行 `<br>`。
- **A/B/C 三档而非 A/B 两档**:A=mmdc 默认基线;B=mmdc+archify themeCSS 只换色;C=手工移植 archify 重画。**把 CSS 主题增益与布局+语义重绘增益分开归因**,精确定位杠杆。
- **方法学**:同 5 输入 × 3 通道 = 15 图;随机化文件名(`img-01-k0di.png`)+ 去标签 + screenshots/ 入仓 + manifest.txt 单独存"随机 ID → (diagram, version)"映射,**评完分才解盲**;预注册双 pass criterion(B 均分≥7/10 且 B 在 ≥4/5 张图上离 C 更近);分级触发(项目负责人自评,不过线则跳过 5-工程师外部 panel)。
- **结论 FAIL**:C 看起来不错,A 和 B 都不好看,**B 相对 A 没有实质提升**——只换 CSS 不换布局跨不过审美鸿沟。**布局才是产品,不是 CSS**。路线图后果:P1(Mermaid→IR+dagre 自动布局)**砍掉**;P0/P0.5(JSON IR + render.js)**保留**;Mermaid 输入降级为 SKILL.md prompt engineering 技巧。
- **借鉴价值**:① A/B/C 分层归因比 A/B 更能定位增益来源;② 盲评 + manifest 解盲消除品牌偏见;③ 预注册 pass criterion + 分级触发是低成本求真范式;④ screenshots/ 入仓价值(任意回归可直接肉眼 diff)。

---

## 三、可借鉴点全景(按优先级 P0 → P1 → P2 排序)

> 标记说明:**[纯范式]** = 纯思路借鉴,零代码引用;**[实现借鉴]** = 自研实现,不抄 Archify 代码;**[立场检查]** = 需点名 license/立场风险。

### P0(5 项,最高优先级——堵的是"产物可信度"和"agent 路由准确率"两大现存盲区)

#### P0-1. MCP 工具 description 改造为工作流式 agent 指令 **[纯范式]**
- **Archify 做法**:SKILL.md YAML frontmatter 的极长 description 同时承担触发词清单 + 产物能力声明 + skill 激活依据;正文强约束语气固定 5 步交付循环。
- **media-gen-mcp 缺口**:19 个工具的 MCP description 偏"参数说明",缺"何时选这个工具/不选那个工具/调用后该做什么"的工作流引导。MEMORY 已记录"卡片生图优先用 generate_card"等路由冲突,目前靠用户记忆而非工具描述自带。
- **落地步骤**:① 每个工具 description 顶部加多语言触发词清单;② 末尾加 `WHEN TO CHOOSE / AVOID / NEXT` 三段式;③ 易混工具(generate_card ↔ generate_image ↔ render_svg ↔ render_video ↔ generate_diagram)之间加显式 cross-reference;④ 把 MEMORY 经验沉淀直接写进 description。
- **优先级/成本**:**P0 / S**(纯 prompt engineering,零代码改动,不破测试)。

#### P0-2. LLM 友好错误消息契约:引擎 stderr → `{path + 阈值 + 修复动词}` 三件套 **[实现借鉴]**
- **Archify 做法**:校验失败输出 `/nodes/3 (id/label: "router") must NOT have additional properties {"additionalProperty":"colour"}`;错误消息必须含阈值数字 + 修复动词(如 `wider than node, shorten the label`),因为消费方是 LLM。layout-rules.test.mjs 把这个契约锁死成测试。
- **media-gen-mcp 缺口**:generate_diagram / generate_chart / render_svg 的引擎 stderr 基本透传——D2 报 `parse error at line N: unexpected token`、Vega 报晦涩的 encoding 错误。LLM 拿到一句裸错误,既不知道改哪段也不知道改成什么,经常需要多轮试错。无任何 threshold + remediation 契约。
- **落地步骤**:① handler 层加 `normalizeEngineError(engine, stderr, input)` 解析成 `{engine, line, offendingConstruct, message, remediation}` 结构化对象;② 为 D2/Graphviz/Vega-Lite 各维护一份 `knownErrorPatterns` 表(正则 → remediation 模板);③ 回显 offending DSL 片段那一行。
- **优先级/成本**:**P0 / S-M**(错误模式表可渐进积累,不破坏现有测试,只是包装 stderr)。

#### P0-3. Golden byte-compare 固化本地图形工具输出(守护"同输入同输出可入 git"承诺) **[纯范式]**
- **Archify 做法**:`test/golden.mjs` 对 5 类图各取 checked-in example JSON-IR 在 tmp fresh-render,产物 HTML 与 examples/ 下 committed 版本做 `normalizeNewlines(fresh) === normalizeNewlines(checked)` 全文 UTF-8 字符串全等比较。flaky 由"渲染器纯函数化"消除。配套 `render-examples.mjs` 是有意改动后的刷新工具。
- **media-gen-mcp 缺口**:有 6+ 个纯本地确定性工具(generate_card / generate_chart / generate_qrcode / generate_formula / generate_icon / render_svg with resvg),README 把"同输入同输出可入 git"作为立场但**没有专门的 golden byte-compare 套件守护**。Satori 升级、@fontsource 字体改动、resvg 版本 bump 都可能改变输出而无测试守护。
- **落地步骤**:① 新建 `test/golden/` 目录,每工具放一份代表性 input + 已 commit 的 golden output;② 写 `test/golden.test.mjs`:SVG 走 `normalizeNewlines` byte-compare,PNG 直接二进制比较(若引擎含时间戳则降级 pHash ≥0.95);③ 加 `npm run render:golden` 刷新脚本;④ CI 加 stale gate。关键锁定项:@fontsource 字体版本、resvg/D2-WASM 版本、Vega-Lite 版本。
- **优先级/成本**:**P0 / M**(强化而非削弱核心卖点,license 无冲突)。

#### P0-4. 产物守门人脚本 check-render-output.mjs(补上当前最大盲区) **[实现借鉴]**
- **Archify 做法**:`scripts/check-render-output.mjs`(651 行)是渲染后校验的唯一真相源,CLI 和 test 都调它。7 类检查,输出结构化 `{ok, file, checks, composition:{summary, metrics, issues[]}}`,profile 双轨(standard 警告 / showcase 阻断)。
- **media-gen-mcp 缺口**:`scripts/` 只有 `check-schema.mjs`(只锁 inputSchema enum,不锁产物语义);MEMORY 明文记载的"OCR 渲染必崩(pdfjs v6 未导出 NodeCanvasFactory)被 text-layer-only 测试盲区掩盖"教训正是这类盲区的代价;AI provider 工具已有 warnings 字段但无产物侧校验(如下载到的 PNG 是否零字节/全透明);QR 码生成后从不验证可解码回原文。
- **落地步骤**:① 新建 `scripts/check-render-output.mjs`,按 MIME/扩展名分派检查矩阵(PNG/JPEG/WebP:非零字节 + 用 pngjs/@napi-rs/canvas 解码成功 + 尺寸≤16Mpx + 非全透明;SVG:XML 可解析 + 含 `<svg>` 根 + viewBox 非 0 + 无 NaN/undefined;QR PNG:用 jsQR 解码回原文等比;formula SVG:`<path>` 或 `<use>` 节点数>0);② 在每个 handler 返回前调对应 check;③ 配套 npm 新增 check CLI 子命令;④ 用 `node:test` 写 `check-render-output.test.mjs` 对 check 脚本本身做契约测试。
- **优先级/成本**:**P0 / M**(全 MIT/Apache 2.0 依赖,纯增量,不破坏现有测试)。

#### P0-5. 新增"交互式自包含 HTML 图"产物(三层分工:静态图 / 交互 HTML / 视频) **[实现借鉴,立场检查]**
- **Archify 做法**:核心产物是单文件 .html,设计哲学是"同一份手写 SVG 在多场景靠 CSS 变量切换,几何永不被改写"。template.html 提供 ~3500 行 CSS + ~7000 行 JS 的视图层(主题/preset/动效/导出/Story Trail/Route Probe/Semantic Lens/Overview Radar 等交互面板)。
- **media-gen-mcp 缺口**:当前只有两档图产物:generate_diagram(静态 SVG/PNG,无主题切换/无动画/无交互探索)和 render_video(MP4/GIF/WebM,非可探索图)。**缺少"需要主题切换/可动画/可点击探索的高保真交互式 HTML 图"中间档**——用户若想在 GitHub README 嵌一张可随系统主题切换的架构图,当前完全无解。
- **落地步骤**:① 定位分工三层:generate_diagram(静态,快速)/ generate_interactive_diagram 或 generate_diagram_html(新,JSON-IR 或 DSL→自包含 HTML)/ render_video(视频产物);② **实现路线选"借鉴范式 + 自己实现轻量版",不集成 Archify 整套 renderer**(Archify viewer 极重 10500 行内联且专精 5 种架构图);③ License 路径:**强烈建议 reimplement**——"手写 SVG 字符串 + CSS 变量层 + data-theme 属性 + @keyframes"全是通用 Web 技术,不受任何 license 约束,且符合同输入同输出立场;④ 必须照搬的关键不变量:"viewer 特性绝不污染 IR/几何",交互层(CSS/JS)和几何层(SVG)严格分层;⑤ 向后兼容:作为新工具加入,不动现有 generate_diagram/render_video 签名。
- **优先级/成本**:**P0 / L**(最大件,建议立项再决策;若决定不做则降级为 P1 的"双主题自适应 SVG"作为 80% 解)。

### P1(12 项,中等优先级——加固质量与可靠性)

#### P1-1. 轻量 DSL pre-flight lint 层(用"守卫"而非"完整 IR"回答"IR→DSL 还是并存") **[实现借鉴]**
- **Archify 做法**:三层校验(schema 本体 + ajv standalone + loader 跨集合),LLM 写错字段名/枚举值/数字越界会在进入渲染前被 fail-closed 拒掉。
- **media-gen-mcp 缺口**:generate_diagram 是"DSL 字符串直传",D2/Graphviz 常见 LLM 踩坑会在引擎层才暴露:(a) D2 的 `#` 是注释起始符,`style.fill: #ff0000` 不加引号会被吞;(b) D2 的 stroke-width 只收 INTEGER,写 `1.5` 直接报错;(c) D2 属性必须换行分隔;(d) Graphviz ID 含空格/数字开头不加引号 = parse fail。
- **落地步骤**:**立场红线**——不要在 D2/Graphviz 之上架一层 Archify 式结构化 IR 再编译回 DSL(会推翻"engine 管布局"的价值,且 Archify 自己的 v3-mermaid-validation 盲测 FAIL 证明 auto-layout 才是杠杆、CSS/IR 重绘不是)。替代方案:加 `lintDsl(engine, code)` 轻量预检函数,对已知 footgun 做正则/简单 AST 扫描,在调引擎前返回结构化错误(复用 P0-2 错误格式)。具体扫:unquoted hex、float stroke-width、D2 单行多属性、Graphviz 裸 ID 含空格。lint 只做警告级不强制阻断(向后兼容)。
- **优先级/成本**:**P1 / M**。

#### P1-2. generate_chart 接入 Vega-Lite 官方 JSON Schema 校验 **[实现借鉴]**
- **Archify 做法**:每个图类型一份独立 schema,渲染前必须先通过 schema 校验。golden.mjs 里 9 条 expectFailure 负向用例验证 schema 层能抓住单字段篡改。Vega-Lite 本身就发布完整 JSON Schema,`additionalProperties:false` 是 Vega 默认。
- **media-gen-mcp 缺口**:generate_chart(spec) 收 Vega-Lite JSON 但不做预校验,直接喂给 vega。LLM 常见错误:饼图用 `angle` 而非 v5 的 `theta`、mark 写 `pie` 而非 `arc`、x/y 通道忘标 type —— 这些会触发 Vega 深层晦涩错误或出空图。工具描述里的提示是 prompt 层兜底,无机器层校验。
- **落地步骤**:① 直接复用 Vega 官方 JSON Schema(BSD-3-Clause,与 Apache 2.0/MIT 立场兼容);② 懒加载——只在 generate_chart 被调用时才加载 schema;③ 用 ajv(MIT)在 spec 进 vega 前做 additionalProperties:false + required + enum 校验;失败时复用 P0-2 错误格式;④ 不破坏现有测试(现有 chart 用例都是合法 spec)。
- **优先级/成本**:**P1 / S**。

#### P1-3. 产物侧 output-checker:把已有 PDF error-sentinel 范式扩成统一 SVG/PNG/MP4/dataURI 契约守门人 **[实现借鉴]**
- **Archify 做法**:`check-render-output.mjs`(651 行)是渲染后校验的唯一真相源,CLI 和 test 都调它,每条 issue 带 severity/code/relationship id。
- **media-gen-mcp 缺口**:各工具输出格式多样(SVG/PNG/MP4/dataURI/URL),当前没有统一的产物侧契约检查器。PDF 已有 error-sentinel 是雏形,但没扩展到 SVG/PNG/MP4。AI 工具(generate_image/create_video)的内容虽非确定但格式契约仍可校验,这部分完全缺失——Provider 返回空 body、半截 dataURI、HTTP 错误页被当成功返回的 bug 都可能发生。
- **落地步骤**:① 新建 `src/checks/output-checker.ts`,导出 checkSvg/checkPng/checkMp4/checkDataUri 等纯函数,返回 `{ok, issues:[{severity, code, message}]}` 结构;② 在每个 handler 返回前自动调用对应 checker;③ 单元测试覆盖每个 checker 的正反例。**与 P0-4 互补**:P0-4 守"输入→输出"的稳定,P1-3 守"输出本身"的格式契约(实际可合并实现)。
- **优先级/成本**:**P1 / M**(建议与 P0-4 合并设计与排期,避免重复)。

#### P1-4. 单点 mutation 测试范式(锁定 Vega-Lite/Satori/D2 输入校验的消息格式) **[纯范式]**
- **Archify 做法**:layout-rules.test.mjs 用单点 mutation 范式——对合法 example 改恰好一个字段制造一次违规,断言 renderer 退出非 0、stderr 含期望子串、且不含 TypeError/Cannot read(防 crash)。
- **media-gen-mcp 缺口**:MCP server 的 LLM 是错误消息的直接消费方。各工具输入校验错误消息质量参差,有的只回 JSON path,有的只说 `validation failed`,缺阈值数字和修复动词。当前没有专门的测试锁定错误消息格式。
- **落地步骤**:① 定义统一错误消息格式 `<field path> (<current value>): <problem with threshold>, <remediation verb>`;② `test/error-contract.test.mjs`:为每条规则设计单点 mutation case,断言 (a) isError=true,(b) 消息含期望子串,(c) 不含 raw stack trace。**实际落地时与 P0-2 共用错误消息规范**。
- **优先级/成本**:**P1 / M**。

#### P1-5. Provider fallback degraded 测试(对应 Archify"无 node_modules 模拟安装"范式) **[实现借鉴]**
- **Archify 做法**:degraded.test.mjs 把 skill 复制到 tmp(排除 node_modules/test/.validator-check-*)模拟"已安装"环境,逐字段篡改(数组改字符串、meta 改 42、删 col)→ 三件套断言(非 0 退出 + 不 crash + HTML 无 NaN/undefined)。
- **media-gen-mcp 缺口**:Provider fallback 是核心机制(memory 反复提及 isFallbackWorthy/KeyPool/Agnes→智谱 fallback),但**没有专门的 degraded 测试覆盖各种 Provider 失败场景**。这是生产环境最大的可靠性风险点。
- **落地步骤**:① 用 msw(Mock Service Worker,Apache 2.0)或 nock(Apache 2.0/ISC)拦截 Provider HTTP 调用;② `test/degraded.test.mjs` 覆盖场景:Agnes 500/超时/ECONNRESET、智谱 401/429 key 全部耗尽、网络黑洞(ECONNREFUSED)、Provider 返回畸形 JSON/空 body/半截 dataURI;③ 每场景三件套断言:最终响应结构正确 + 不 crash + 错误消息含 Provider 名 + 失败原因 + 是否已尝试 fallback;④ KeyPool 专项:多 key 全部 rate limit 时正确切换 Provider;⑤ isFallbackWorthy 专项:partial result 与完全失败的边界判断。
- **优先级/成本**:**P1 / L**(主要成本在 mock 框架搭建和场景枚举)。

#### P1-6. 双主题自适应 SVG:短期暴露 D2 原生 darkTheme 参数(零成本),中期借 Archify autoTheme 注入范式 **[实现借鉴]**
- **Archify 做法**:SVG 下载路径用 `XMLSerializer().serializeToString(clone)`,autoTheme=true 模式同时注入 dark+light 两套 CSS 变量 + `@media (prefers-color-scheme: dark/light)` 规则,让单文件 SVG 在 GitHub README 自动随系统主题切换。`pickSafeScale` 在 16Mpx(iOS Safari canvas 上限)内选最大倍率;WebP 要先 toDataURL 探测因旧 Safari 静默回退 PNG。
- **media-gen-mcp 缺口**:generate_diagram 已有 theme 参数(D2 themeID),但 (a) 未暴露 D2 原生的 --dark-theme 参数;(b) render_svg 接收任意 SVG 但完全不关心主题;(c) Graphviz 引擎输出和用户手工 SVG 是硬编码颜色。
- **落地步骤**:**双路径落地,严守纯免费立场**。① **短期(P1/S)**:给 generate_diagram(engine='d2') 增加 darkTheme 可选参数,透传 D2 的 --dark-theme flag——D2 会自动在 SVG 注入 prefers-color-scheme media queries,**零自研代码,license 干净(D2 是 MPL-2.0,已在引擎列表内)**。这是最快赢路径应优先做。② **中期(P2/M)**:为 render_svg 增加 theme=auto 参数,对"已语义化的输入 SVG"做 post-process 注入双主题 + @media 规则。关键技术点直接搬 Archify 踩过的坑:pickSafeScale 在 16Mpx 内选最大倍率;WebP 要先 toDataURL 探测;XMLSerializer 序列化保证同输入同输出。③ 不建议照搬 preset 系统(classic/signal-flow/blueprint):它与 D2 theme 是不同维度,叠加会造成概念混乱。
- **优先级/成本**:**P1 / M**(短期 S,中期 M)。

#### P1-7. 交互式 HTML 必备配套:Motion Governor + 导出时 viewer-state 清理范式 **[实现借鉴]**
- **Archify 做法**:Motion Governor 在 5 个触发条件(data-motion-capable/data-motion=still/data-embed=true/data-document-hidden=true/@media prefers-reduced-motion: reduce)任一成立时,把所有 animation 和 transition 强制 `animation:none !important`。导出时清理所有 viewer 探索态(data-view-scale/data-focus-active/[data-story-step] 等几十个属性,移除 overlay 节点)。动效用纯 CSS @keyframes + `animation-delay: calc(var(--step) * 160ms)`,无 GSAP、无 Web Animations API。
- **media-gen-mcp 缺口**:render_video 是产物级 MP4,不存在"运行时动画冻结"概念。但若落地 P0-5 交互式 HTML 产物,Motion Governor 是无障碍 + 嵌入友好的硬需求。
- **落地步骤**:① 若落地 P0-5,把 Motion Governor 作为交互式 HTML 产物的内置 CSS 规则(5 个触发条件照搬,纯 CSS 范式 license 完全兼容);② 导出 PNG/JPEG/WebP/SVG 时定义一份"viewer-state 属性黑名单",序列化前统一 strip;③ 测试范式借鉴:用静态 marker 断言(data-animation/data-animate 属性存在性)替代真实时间轴——既快又确定,完美契合确定性立场。**这两件工作量都是 S,但只在 P0-5 落地时才有意义,与 P0-5 绑定排期**。
- **优先级/成本**:**P1 / S**(与 P0-5 绑定)。

#### P1-8. Cardinal Rule + 生成后自检 harness:把 grep 级 checklist 内嵌进工具 handler **[实现借鉴]**
- **Archify 做法**:SKILL.md 明令 "never edit the renderer",定义 Cardinal Rule(禁止 inline 颜色),配套 6 项 grep 级 self-review checklist 作交付前硬门。这层自检不是可选建议而是机械门——agent 不跑完就交付不了。
- **media-gen-mcp 缺口**:工具 handler 主要是"调 provider → 落盘 → 返回路径",对产物质量只做了隐式检查。MEMORY 提到的"OCR 渲染必崩"教训就是因为缺前置自检。当前导致:(a) SVG 输出含 NaN/undefined 时仍 success 返回;(b) 同输入两次调用哈希不一致(违反立场)时不会被抓住;(c) PNG 字节过小(provider 静默失败)仍报成功。
- **落地步骤**:① 在 handler 层定义全局 Cardinal Rules(立场硬门):SVG 产物禁含 NaN/undefined/Infinity;同输入同 seed 必须字节一致;输出文件必须存在且 size > 1KB;② 每个 generate_* handler return 前加 `assertOutputClean(path, {deterministicHint})` 钩子,失败即 fail-closed 返回结构化错误(不是静默 success);③ 错误消息按 Archify 范式含"阈值 + 修复动词";④ 配套 CI 加同输入 2× 调用 hash 比对测试。**与 P0-4 / P1-3 高度重叠,建议三件合并设计与实现**。
- **优先级/成本**:**P1 / M**。

#### P1-9. 叠加独立 SKILL.md 覆盖层:media-gen-mcp 之上做一层 agent 指令层 **[实现借鉴]**
- **Archify 做法**:Archify 作为 skill 形态发布,SKILL.md 是单一真相源,与底层 CLI/npm 包解耦——agent 先读 SKILL.md 得到工作流指令,再调用底层 CLI 七子命令。两层:底层是能力(CLI/MCP),上层是工艺(SKILL.md 教 agent 怎么组合能力)。
- **media-gen-mcp 缺口**:当前是裸 MCP server,工作流指引散在 README/MEMORY/用户记忆里,Claude 调用方看不到统一的"怎么用这套 19 工具"的指令层。新用户经常不知道:视频异步 handle 轮询 vs 同步怎么选、D2 vs Graphviz 怎么选、Provider fallback 何时触发、OCR 四档怎么选。
- **落地步骤**:① 在 npm 包内新增 `skill/SKILL.md`(与 server 同包发布),作为可选 artifact;用户 `npm install media-gen-mcp` 后可在 Claude Code 项目的 `.claude/skills/` 软链或拷贝过去启用;② SKILL.md 内容结构参照 Archify:YAML description 塞触发词清单 + 正文用强约束语气写 5 步工作流;③ 内嵌 "never edit" 类硬规则:never omit outDir、never trust provider 单次输出、never return success without file existence check;④ 提供 8-12 个 bounded recipe;⑤ 配套一个 `recipes` 或 `examples` MCP 工具,对应 Archify 的 guide 子命令。
- **优先级/成本**:**P1 / M**(纯叠加,不改 server 行为;用户不装 skill 层,MCP 照常工作)。

#### P1-10. v3-mermaid-validation A/B/C 盲评方法学:把 doc/Agnes_vs_Zhipu_横评 从"文献综述"升级为"自跑盲评 + 截图入库" **[纯范式]**
- **Archify 做法**:experiments/v3-mermaid-validation 是一次自我证伪的视觉质量验收实验,A/B/C 三档,关键方法学:随机化文件名 + manifest 解盲 + screenshots/ 入仓 + 预注册双 pass criterion + 分级触发。结论 FAIL 直接砍 P1 计划——以实验而非直觉驱动路线图。
- **media-gen-mcp 缺口**:现有 `doc/Agnes_vs_Zhipu_横评.md` 是文献综述式,引用第三方榜(Artificial Analysis)而非自跑实验,没有自家 screenshots/ 入库。README 的"免费立场"陈述无自家实测数据支撑。多个可定量对照完全缺失:generate_card vs 手写 HTML+puppeteer、generate_diagram(D2) vs generate_diagram(graphviz) vs Mermaid CLI、render_svg resvg(92%) vs chrome(100%) filter fidelity 对照。
- **落地步骤**:① 新建 `experiments/` 目录(与 doc/ 文献分离),首批 4 个实验:Exp A 升级横评(同 8-10 prompt × 2 provider × 图像/视频,随机化文件名 + manifest.jsonl + 评完解盲 + 预注册 pass criterion)、Exp B generate_card vs 手写 HTML+puppeteer、Exp C generate_diagram D2 vs graphviz vs Mermaid CLI(三档对照)、Exp D render_svg resvg vs chrome filter fidelity;② 每实验 INDEX.md 公开 caveats + manifest.jsonl + screenshots/ 入 git + 评分单;③ README 在"免费立场"段引实验结论 + 截图链接,把"自夸"升级为"有证据";④ **实验失败也保留**(透明化可信度 > 选择性报喜)。
- **优先级/成本**:**P1 / M**(无 license 冲突,自跑实验)。

#### P1-11. 本地确定性工具的 Golden 基线 + 刷新脚本(直搬 Archify golden.mjs + render-examples.mjs) **[纯范式]**
- **Archify 做法**:`test/golden.mjs` 对 5 类图各取 checked-in example JSON-IR 在 tmp fresh-render,产物 HTML 与 examples/ 提交版本做 normalizeNewlines 后的全文 UTF-8 字符串全等比较。配套 `scripts/render-examples.mjs`(38 行)是有意改动后的刷新工具。所有 *.test.mjs 用 node:test,临时目录 process.on('exit') 必清。
- **media-gen-mcp 缺口**:① 没有 examples/ 目录(已确认),6 个本地确定性工具完全无 golden 基线;② 引擎升级(D2 WASM/resvg/Satori/MathJax/Vega-Lite)引入的渲染回归只能肉眼发现;③ doc/OCR_测试集 已有 oracle 雏形但只覆盖识别侧不覆盖生成侧;④ _test_*.mjs 用手写 ok/bad 计数器(范式已有但散在草稿里未正式化、未接入 npm test)。
- **落地步骤**:① 新建 `examples/{card,chart,diagram,formula,icon,qr,svg}/` 各放 3-5 份代表输入 + 已 commit 渲染产物;② 新建 `test/golden.test.mjs` 接入 npm test:SVG/文本类 normalizeNewlines byte-compare,PNG 类用 pHash(纯 JS,image-phash 或自写 DCT)阈值 ≥0.95,QR PNG 用 jsQR 解码回原文 byte 级;③ 先审计每个引擎确定性(同输入连跑两次 diff,确认无时间戳/构建路径泄漏);④ `scripts/render-examples.mjs` 做刷新工具,配套 `npm run render:examples`;⑤ npm test 加 golden 步骤,失败提示照搬 Archify。**与 P0-3 是同一件事的两个描述,建议合并**。
- **优先级/成本**:**P1 / S**(实际与 P0-3 合并后作为 P0 处理)。

#### P1-12. 扩 check-schema.mjs 把单一真源锁从 create_video 两 enum 扩到 19 工具全部 enum **[实现借鉴]**
- **Archify 做法**:`generate-validators.mjs`(66 行)用 ajv2020 standalone mode 把 5 类 schema + common 编译成纯 ESM validator 代码;--check 模式与已 commit 的 generated-validators.mjs 比对,不一致退出 1,是 CI freshness gate 防 schema 改了产物没重生。validator.mjs::annotatePath 把 `/nodes/3/label` 解析成 `/nodes/3 (id/label: 'router')/label` 方便 LLM 修 JSON。
- **media-gen-mcp 缺口**:① check-schema.mjs 已是 generate-validators.mjs --check 的精神映射(spawn dist/index.js 跑 tools/list,断言 create_video 的 numFrames/frameRate.enum === provider.videoConstraints()),但覆盖极窄——只锁 create_video 两字段,19 工具的其他 enum(template/engine/format/backend/mode/provider/size 等)未做单一真源锁;② ajv standalone codegen 部分**建议仅思路借鉴不搬**(media-gen-mcp 是 MCP server 而非 skill 分发,运行时依赖 ajv 不是负担);③ 错误消息大多直接抛引擎原始堆栈。
- **落地步骤**:A. **直接扩 check-schema.mjs**:把 19 工具所有 enum 字段与运行时常量做单一真源锁——generate_card.template enum 与 card.ts 实际支持的模板集、generate_diagram.engine/format 与 diagram/ 支持集、render_svg.backend 与 render-svg.ts 支持集、extract_pdf.strategy 与 pdf/ 支持集等。发现 inputSchema ↔ 运行时漂移即 CI fail。零新依赖。B. **错误消息契约直搬**:新建 `src/error-format.ts`(与 P0-2 共用)。C. **不搬 ajv standalone codegen**:立场不冲突但边际价值低。
- **优先级/成本**:**P1 / M**。

### P2(3 项,低优先级——查漏补缺与未来储备)

#### P2-1. 为未来任何结构化 IR 预留两条 schema 卫生原则:schema_version const 1 + ID 正则约束 **[纯范式]**
- **Archify 做法**:(1) `schema_version` 用 `"const": 1` 而非数字递增,增量字段不 bump,只有破坏性 IR 形状变更才 bump 到 2;且 v1 文件在所有 2.x 渲染器上保持可校验可渲染——一份对"agent 生成 IR 永久可读"的硬承诺。(2) common.schema.json 的 `id` 用 `^[a-zA-Z][a-zA-Z0-9_-]*$` 正则,字母开头防数字打头导致 CSS 选择器/锚点陷阱。
- **media-gen-mcp 缺口**:工具参数 schema 由 MCP server config 隐式演进,无显式版本号戳在输入上,也无"增量不 bump / 破坏才 bump"的成文承诺。
- **落地步骤**:(1) 在 CONTRIBUTING/开发文档里写两条 schema 卫生原则,作为未来新增结构化 IR 时的硬规矩;(2) 现有工具不动,纯文档动作,零代码风险;(3) 仅当未来真要加 IR 时(例如 generate_video 的 GSAP timeline 对象化、generate_card 的 template 参数对象化)才落地成实际 schema 字段。**这是"仅思路借鉴",不涉及任何 Archify 代码**。
- **优先级/成本**:**P2 / S**(主要是写一段开发规范)。

#### P2-2. seeded PRNG 顺序无关性属性测试(守护 Vega-Lite spec / Satori props 的字段顺序无关) **[纯范式]**
- **Archify 做法**:degraded.test.mjs 用 mulberry32(seed) seeded PRNG(不用 Math.random,保证可复现)+ Fisher-Yates 打乱 nodes/states 顺序,3 mode × 8 seed 必须全部渲染成功 + 无 NaN。失败时能从 seed 复现,而不是 flaky。
- **media-gen-mcp 缺口**:未做顺序无关性测试。Vega-Lite spec 的 encoding 字段顺序、Satori props 字面量顺序理论上应不影响输出,但实际可能有细微差异(对象 key 迭代顺序、JSON.stringify 行为)。
- **落地步骤**:① 写一个共享 mulberry32(seed) utility(约 10 行 TS,自己实现无 license 顾虑);② `test/order-invariance.test.mjs`:对 generate_chart 用 Fisher-Yates 打乱 spec.encoding 字段顺序、打乱 data.values 行序,N 个 seed 都应产出 byte-identical SVG;③ 对 generate_card 打乱 props 顺序验证 Satori 输出一致;④ 失败时报告哪个 seed 暴露了顺序敏感性。**优先级 P2 因为 Vega-Lite/Satori 本身已保证顺序无关(概率上),这是双保险**。
- **优先级/成本**:**P2 / S**。

#### P2-3. Bounded Recipes 预设画廊:把 Archify guide 子命令的 11 recipe 范式搬到 MCP **[实现借鉴]**
- **Archify 做法**:`guide` 子命令提供 11 个 bounded recipe,每个 recipe 附 evidence(为何选这个图类型)/boundary(何时不适用)/copy-ready prompt(可直接粘贴的起始 prompt)。
- **media-gen-mcp 缺口**:每个 generate_* 工具都从空白 prompt 起步,Claude 每次要重新摸索 prompt 工艺。MEMORY 已记录一些零散经验,但没有结构化成 recipe,只会在用户提醒下才被 Claude 套用。
- **落地步骤**:① 维护一个 `recipes/` 目录(JSON 或 MD),每条 recipe 包含 fields:trigger/tool/prompt_template/post_check/boundary/license_note;② 优先沉淀 8-12 条高频 recipe:'tech-blog-og-card'/'system-architecture-d2'/'data-dashboard-vegalite'/'math-formula-render'/'product-demo-loop-video'/'qr-poster-with-logo'(后两个注意 MEDIA-GEN-MCP Agnes 约束 MEMORY:1080p≤241 帧/10s、720p 可达 441 帧/18s、outDir 必传);③ recipes 通过 P1-9 的 SKILL.md 或独立 list_recipes MCP 工具暴露;④ 每个 recipe 必须自带"同输入同输出"验证基线(hash 入 git)。**License 注意:若 recipe prompt 涉及第三方模板样式需在 license_note 点名来源与 license**。
- **优先级/成本**:**P2 / M**(建议在 P1-9 SKILL.md 落地后再做)。

---

## 四、P0 建议详解(可执行实施方案)

### P0-1 · MCP 工具 description 改造为工作流式 agent 指令

**目标文件**(均在 media-gen-mcp 源码,本报告只列绝对路径参考,**实际修改由 media-gen-mcp 维护者执行**):
- `src/tools/*.ts`(或集中工具定义文件,具体以仓库实际结构为准)

**改动清单**:
1. 每个工具 description 顶部加多语言触发词清单行(参照 generate_card 已部分做到的范式,扩展到 19 工具)。
2. 末尾加 `WHEN TO CHOOSE / AVOID / NEXT` 三段式,例如:
   - `generate_card`: `AVOID: photographic subjects (use generate_image), complex SVG filters (use render_svg)`
   - `generate_diagram`: `NEXT: for theme/styling, render_svg can post-process`
3. 易混工具之间加显式 cross-reference:generate_card ↔ generate_image ↔ render_svg ↔ render_video ↔ generate_diagram 各自 description 提到对方适用边界。
4. 把 MEMORY 里的"卡片生图优先用 generate_card""真实武器词改科幻设定词绕过"等 agent 经验沉淀直接写进对应工具 description。

**新增测试**:无(description 改动不需测试)。

**风险**:
- description 过长可能触发 MCP 客户端的显示/解析限制——建议单工具 description 控制在 ~800 字符内。
- 触发词清单若重叠过多(generate_card 和 generate_image 都列"画图")反而模糊路由——需明确边界词。

**向后兼容策略**:纯文本改动,不破 inputSchema,不破现有调用方,不破测试。

**优先级/成本**:**P0 / S**。

---

### P0-2 · LLM 友好错误消息契约

**目标文件**:
- 新建:`src/handlers/error-format.ts`(导出 `normalizeEngineError(engine, stderr, input)` 和 `knownErrorPatterns` 表)
- 修改:`src/tools/generate-diagram.ts`(handler 层调用 normalizeEngineError 包装 stderr)
- 修改:`src/tools/generate-chart.ts`(同上)
- 修改:`src/tools/render-svg.ts`(同上)

**改动清单**:
1. `error-format.ts`:
   ```ts
   export interface NormalizedError {
     engine: 'd2' | 'graphviz' | 'vega' | 'resvg' | 'chrome' | ...;
     line?: number;
     offendingConstruct?: string;  // DSL 那一行回显
     message: string;              // 问题陈述 + 阈值
     remediation: string;          // 修复动词
   }
   export function normalizeEngineError(engine, stderr, input): NormalizedError
   export const knownErrorPatterns: Record<engine, Array<{regex, message, remediation}>>
   ```
2. 为 D2 / Graphviz / Vega-Lite / resvg 各维护一份 knownErrorPatterns 表(正则匹配 → remediation 模板),新踩坑就追加。
3. handler 层在 catch 块里调 normalizeEngineError,把结构化对象拼成单行可读 stderr 返回 `isError: true`。
4. 回显 offending DSL 片段那一行(降低 LLM 定位成本)。

**新增测试**:`test/error-contract.test.mjs` —— 与 P1-4 合并,单点 mutation 范式,断言每条错误含 threshold + remediation。

**风险**:
- knownErrorPatterns 表初始覆盖率低,需要在使用中渐进积累(可加监控:未识别的 stderr 进临时日志)。
- D2/Graphviz 的错误消息可能版本变化,正则需维护。

**向后兼容策略**:**不破坏现有错误返回的 isError 协议**,只是在文本里加结构化字段;合法调用不受影响;现有 happy-path 测试全绿。

**优先级/成本**:**P0 / S-M**。

---

### P0-3 · Golden byte-compare 固化本地图形工具输出(与 P1-11 合并)

**目标文件**:
- 新建目录:`examples/{card,chart,diagram,formula,icon,qr,svg}/`(每工具 3-5 份代表性 input + 已 commit 渲染产物)
- 新建:`test/golden.test.mjs`
- 新建:`scripts/render-examples.mjs`(对应 Archify 的 render-examples.mjs 38 行原型,自写)
- 修改:`package.json`(加 `npm run render:golden` 和 `npm test` 钩子)

**改动清单**:
1. **审计每个引擎确定性**:用同输入连跑两次 diff,确认无时间戳/构建路径泄漏。resvg 二进制可能含构建信息——若发现非确定性就降级用 pHash。
2. 按工具分派比较策略:
   - SVG/文本类:`normalizeNewlines(\r\n?→\n)` 后 byte-compare(直搬 Archify)
   - PNG 类:**不**用 byte-compare(PNG 编码器可能嵌时间戳),用 pHash(纯 JS,image-phash 或自写 DCT,pHash 算法本身公知无 license 风险)算相似度,阈值 ≥0.95 视为通过
   - QR PNG:jsQR 解码回原文与输入 text 等比(byte 级)
3. 关键锁定项写死在 package.json:@fontsource 字体版本、resvg/D2-WASM 版本、Vega-Lite 版本。
4. CI 加 stale gate:不能跳过 golden 比对。
5. 失败提示照搬 Archify:"如果改动是有意的,跑 `npm run render:golden` 并 commit"。

**新增测试**:`test/golden.test.mjs`(本身就是测试)。

**风险**:
- PNG pHash 阈值 ≥0.95 是经验值,需在初期容忍少量误报——可先用 byte-compare 试,失败才降级 pHash。
- 引擎升级导致 golden 全批量更新——这是预期行为,通过 `npm run render:golden` 流程化。

**向后兼容策略**:纯新增,不改既有工具行为;现有测试不动;CI 加新步骤而非替换。

**License**:pHash 算法公知;若用包选 MIT 的(image-phash 是 MIT)。**同输入同输出正是 golden 前提,与 media-gen-mcp 立场完全对齐**。

**优先级/成本**:**P0 / M**。

---

### P0-4 · 产物守门人脚本 check-render-output.mjs(与 P1-3 / P1-8 合并)

**目标文件**:
- 新建:`scripts/check-render-output.mjs`(对标 Archify 的 651 行脚本,但检查项针对多模态产物)
- 新建:`src/checks/output-checker.ts`(纯函数库,被 scripts 和 handler 共用)
- 新建:`test/check-render-output.test.mjs`(契约测试)
- 修改:每个 generate_*/render_* handler 在 return 前调用对应 check
- 修改:`package.json` 加 `check` CLI 子命令

**改动清单**:
1. `src/checks/output-checker.ts` 导出纯函数:
   ```ts
   checkSvg(buf | string): { ok, issues: [{severity, code, message}] }
   checkPng(buf): { ok, issues }
   checkMp4(buf): { ok, issues }
   checkDataUri(str): { ok, issues }
   ```
   检查矩阵:
   - PNG/JPEG/WebP:文件非零字节 + 用 pngjs(MIT)或 @napi-rs/canvas(已是 optionalDep)解码成功 + 尺寸 ≤16Mpx(iOS Safari 上限)+ 非全透明/非全黑
   - SVG:XML 可解析 + 含 `<svg>` 根 + viewBox 非 0 + 无字面 NaN/undefined/Infinity + 必要 xmlns
   - MP4:ftyp box + moov box 存在
   - dataURI:正确前缀 + base64 可解码 + 解码结果通过对应 checkSvg/checkPng
   - QR PNG:用 jsQR(Apache 2.0)解码回原文等比
   - formula SVG:`<path>` 或 `<use>` 节点数 >0
2. 在每个 handler 返回前调对应 check,输出 `{ok, checks[], warnings[]}`;**默认 warning 不 fail(向后兼容)**,严重情况(零字节/解码失败)直接 fail。
3. 配套 npm 新增 `check` CLI 子命令(或独立 bin)供 CI 调用,退出码 0 ⇔ ok。
4. 全局 Cardinal Rules(立场硬门,与 P1-8 共用):SVG 禁含 NaN/undefined/Infinity;输出文件必须存在且 size > 1KB;同输入同 seed 必须字节一致。

**新增测试**:`test/check-render-output.test.mjs` 对 check 脚本本身做契约测试(喂合成坏文件,断言能抓)。

**风险**:
- 严重 fail 可能拦截现有"勉强能用"的产物——需要分灰度上线:先 warning-only 跑两周观察,再升 fail。
- @napi-rs/canvas 在某些环境装不上(optionalDep)——需 fallback 到 pngjs。

**向后兼容策略**:**先 additive 再迁移**。第一版只加 check 不阻断(handler 返回里多一个 `quality` 字段),观察一段时间后再升级到 fail-closed。

**License**:全部 MIT/Apache 2.0(pngjs MIT / jsQR Apache 2.0 / @napi-rs/canvas MIT),无立场冲突。

**优先级/成本**:**P0 / M**。

---

### P0-5 · 新增"交互式自包含 HTML 图"产物(最大件,建议立项再决策)

**目标文件**:
- 新建:`src/tools/generate-interactive-diagram.ts`(或 generate_diagram_html)
- 新建:`src/renderers/interactive-html/`(自研轻量 viewer,1-2 种高频图类型:架构图 + 时序图)
- 新建:`examples/interactive-html/`(golden 基线)
- 新建:`test/interactive-html.test.mjs`

**改动清单**:
1. **定位分工三层**(必须先在 README/CHANGELOG 写清楚边界):
   - generate_diagram:DSL → 静态 SVG/PNG(快速、agent 友好、入文档)
   - generate_interactive_diagram:JSON-IR 或 DSL → 自包含 HTML(主题切换 + 动画 + 探索)
   - render_video:HTML/CSS/GSAP → 视频产物(非交互)
2. **实现路线选"借鉴范式 + 自己实现轻量版",不集成 Archify 整套 renderer**:
   - 理由:Archify viewer 极重(10500 行内联)且专精 5 种架构图,集成会让 media-gen-mcp 臃肿并承担上游跟踪负担。
   - 轻量版只支持 1-2 种高频图类型(架构图 + 时序图),用 media-gen-mcp 自己的视觉风格。
3. **License 路径(立场检查)**:即使 Archify 是 MIT/Apache(需先确认其 LICENSE 文件——bundle 中未明确),**强烈建议 reimplement**——"手写 SVG 字符串 + CSS 变量层 + data-theme 属性 + @keyframes"全是通用 Web 技术,不受任何 license 约束,且符合 media-gen-mcp 同输入同输出可入 git 的确定性立场(deterministic serialization,无 Math.random/时间戳)。
4. **必须照搬的 Archify 关键不变量**:"viewer 特性绝不污染 IR/几何"(CHANGELOG 每条都附此声明)——把交互层(CSS/JS)和几何层(SVG)严格分层,主题切换只改 data-theme 属性、不重渲染、不重算坐标。
5. **配套 P1-7**:Motion Governor(5 个触发条件照搬)+ 导出 viewer-state 清理黑名单。
6. 向后兼容:作为新工具加入,不动现有 generate_diagram/render_video 签名,不破坏现有测试。

**新增测试**:
- golden byte-compare(HTML 类,与 P0-3 共用框架)
- 单点 mutation 错误契约(与 P0-2 / P1-4 共用)
- 静态 marker 动效断言(与 P1-7 共用)
- 同输入两次渲染 hooks deepEqual(确定性)

**风险**:
- **最大风险:过度工程**。Archify 用 10500 行做了 5 种图 + 多 viewer 面板,media-gen-mcp 若贪多容易失控——必须严守 1-2 种图类型 + 最小 viewer(主题切换 + 简单动画 + 鼠标悬停高亮)。
- **第二风险:产物体积**。自包含 HTML 若超 500KB 会影响 GitHub README 渲染——需控制 CSS+JS 在 200KB 内。
- **第三风险:维护成本**。交互式 HTML 一旦发布,用户会要求更多图类型和交互特性,长期维护负担重。
- **建议**:立项时先做 MVP(只支持架构图 + 主题切换 + 无动画)验证采用度,再决定是否扩展。

**向后兼容策略**:纯新增工具,不破现有。

**License**:全部 reimplement,无冲突。

**优先级/成本**:**P0 / L**(**建议立项再决策**;若决定不做则降级为 P1-6 双主题自适应 SVG 作为 80% 解)。

---

## 五、不建议照搬的点(明确边界)

### 5.1 拒绝"D2/Graphviz 之上架一层 Archify 式结构化 IR 再编译回 DSL"(立场冲突红线)
- **理由**:会推翻"engine 管布局"的价值,且 Archify 自己的 v3-mermaid-validation 盲测 FAIL(读者 5)证明 **auto-layout 才是杠杆、CSS/IR 重绘不是**。IR→DSL 转换层带来的维护成本 > 收益。
- **替代**:P1-1 的轻量 lint 层(正则扫已知 footgun,不强制阻断)。

### 5.2 不搬 ajv standalone codegen(边际价值低)
- **理由**:media-gen-mcp 是 MCP server 而非 skill 分发,**运行时依赖 ajv 不是负担**。Archify 之所以用 standalone codegen 是因为 skill 形态要"无 node_modules 仍能完整工作",media-gen-mcp 没这个约束。
- **替代**:若需要 schema 校验,直接 `import Ajv from 'ajv'`(MIT),走运行时即可。

### 5.3 不照搬 Archify 的 preset 系统(classic/signal-flow/blueprint)(概念混乱风险)
- **理由**:preset 改 CSS 变量,D2 theme 改色板,**两者是不同维度**。在 media-gen-mcp 已有 D2 theme 体系下叠加 preset 会造成概念混乱。
- **替代**:P1-6 的双主题自适应 SVG(暴露 D2 原生 darkTheme,纯增量)。

### 5.4 不照搬 Archify 的 10500 行 viewer(过度工程)
- **理由**:Archify viewer(Story Trail/Route Probe/Semantic Lens/Overview Radar 等)是为它自己的"高保真架构图探索"场景服务的。media-gen-mcp 是横向覆盖的 MCP server,集成会让包臃肿并承担上游跟踪负担。
- **替代**:P0-5 的自研轻量版(1-2 种高频图类型 + 最小 viewer)。

### 5.5 不照搬 Archify 的"拒绝 auto-layout"立场(立场相反但不冲突)
- **理由**:Archify 拒绝 auto-layout 是为了"语义可控 + 作者意图不被改写",它的护城河是 Claude 的 layout 判断。media-gen-mcp 的 generate_diagram 故意走 auto-layout(D2/Graphviz)是为了"DSL 直传快速出图",**面对不同问题**。
- **结论**:不构成借鉴冲突,各自正确。

### 5.6 License 未明处谨慎(默认 reimplement)
- **理由**:Archify bundle 中未明确写出 LICENSE 文件。**为安全起见,本报告默认"license 未明"处理**。
- **结论**:所有借鉴路径均推荐 reimplement 而非抄代码——纯 CSS / XMLSerializer / DOM 属性操作 / ajv 校验 / golden byte-compare 都是通用技术范式,不受任何 license 约束。

---

## 六、与 media-gen-mcp 的定位差异结论

### 6.1 是竞品还是互补?
**互补,不是竞品**。两者交集只有"画图"这一狭窄领域:
- **Archify** = "交互式 HTML 图 skill"——专精 5 类架构图,语义可探索,主题可切换,agent skill 形态发布,场景是"系统设计文档/技术博客可交互架构图"。
- **media-gen-mcp** = "全图像操作 MCP"——横向覆盖 19 工具(生成图像/视频/图表/卡片/二维码/公式/图标 + 识别 + PDF + 渲染),MCP server 形态发布,场景是"Claude Code 内一站式图像操作"。

### 6.2 能否共存?
**完全能共存,且互补明显**:
- 同一个 Claude Code session 里:用户调 media-gen-mcp 的 generate_diagram 快速画静态架构图入 README,需要交互式探索时调 Archify skill 重画一份。
- media-gen-mcp 可以选择性吸收 Archify 的工艺(本报告 P0-P2)而不集成其代码,保持 MCP server 的轻量。

### 6.3 能否集成?
**不建议深度集成**。理由:
- Archify 是 skill 形态(SKILL.md + CLI + HTML 产物),media-gen-mcp 是 MCP server(工具调用),两者形态不同。
- Archify 的 10500 行 viewer 是为它的 5 类图服务的,集成进 MCP server 会让 media-gen-mcp 臃肿。
- **可选的轻量集成**:media-gen-mcp 新增 P1-9 的 `skill/SKILL.md` 覆盖层,把 Archify 式工作流指令作为可选 artifact 发布(用户 npm install 后自行决定是否启用)——这是工艺借鉴不是代码集成。

### 6.4 核心差异表

| 维度 | Archify | media-gen-mcp |
|---|---|---|
| 形态 | agent skill(SKILL.md + CLI) | MCP server(工具调用) |
| 覆盖广度 | 5 类架构图(专精) | 19 工具(横向) |
| 渲染后端 | 手写 SVG(完全控制) | 第三方引擎(D2/Graphviz/Vega-Lite/Satori/resvg)+ 远程 Provider |
| 立场 | "作者意图不被改写",拒绝 auto-layout | "DSL 直传快速出图",拥抱 auto-layout |
| 产物形态 | 单文件自包含 HTML(可交互可探索) | SVG/PNG/MP4/dataURI(静态产物为主) |
| 测试体系 | golden byte-compare + 单点 mutation + degraded + seeded 属性 + A/B/C 盲评 | error-sentinel + output-check 范式(局部,未泛化) |
| 工作流指令 | SKILL.md 单一真相源 + 11 bounded recipe | 散在 README/MEMORY/用户记忆 |

---

## 七、下一步行动清单(勾选式 TODO)

### 第一波(P0,堵盲区,2-3 周)
- [ ] **P0-1** MCP description 工作流化改造(**P0 / S**, 1-2 天)—— 19 工具加触发词 + WHEN/AVOID/NEXT + cross-reference,纯文本零代码
- [ ] **P0-2** LLM 友好错误消息契约(**P0 / S-M**, 3-5 天)—— 新建 `src/handlers/error-format.ts` + knownErrorPatterns 表(D2/Graphviz/Vega-Lite/resvg)+ handler 层包装 stderr
- [ ] **P0-3 + P1-11 合并** Golden byte-compare 套件(**P0 / M**, 5-7 天)—— 新建 `examples/` + `test/golden.test.mjs` + `scripts/render-examples.mjs`,SVG 走 normalizeNewlines,PNG 走 pHash ≥0.95,QR 走 jsQR 解码
- [ ] **P0-4 + P1-3 + P1-8 合并** 产物守门人脚本(**P0 / M**, 5-7 天)—— 新建 `scripts/check-render-output.mjs` + `src/checks/output-checker.ts` + 每个 handler 加 assertOutputClean 钩子,**先 warning-only 灰度两周再升 fail**
- [ ] **P0-5** 交互式 HTML 图产物(**P0 / L**, 2-3 周)—— **建议立项再决策**,若不做则降级 P1-6 双主题 SVG 作为 80% 解

### 第二波(P1,加固可靠性,4-6 周)
- [ ] **P1-1** DSL pre-flight lint 层(**P1 / M**)—— lintDsl 函数扫 D2/Graphviz footgun,警告级不阻断
- [ ] **P1-2** Vega-Lite 官方 Schema 校验(**P1 / S**)—— 懒加载 + ajv + additionalProperties:false,失败用 P0-2 错误格式
- [ ] **P1-4** 单点 mutation 错误契约测试(**P1 / M**)—— 与 P0-2 共用错误规范,断言 isError + 子串 + 无 stack trace
- [ ] **P1-5** Provider fallback degraded 测试(**P1 / L**)—— msw/nock 拦截 HTTP,覆盖 Agnes/智谱各失败场景 + KeyPool 专项
- [ ] **P1-6** 双主题自适应 SVG(**P1 / M**)—— 短期暴露 D2 darkTheme 参数(S 成本零自研),中期 render_svg 加 theme=auto post-process
- [ ] **P1-9** 叠加 SKILL.md 覆盖层(**P1 / M**)—— npm 包内新增 `skill/SKILL.md`,5 步工作流 + never edit 硬规则 + 8-12 recipe
- [ ] **P1-10** A/B/C 盲评实验(**P1 / M**)—— 新建 experiments/ 目录,首批 4 实验横评/generate_card 对照/D2 vs graphviz vs Mermaid/resvg vs chrome
- [ ] **P1-12** 扩 check-schema.mjs(**P1 / M**)—— 19 工具所有 enum 单一真源锁,零新依赖

### 第三波(P2,查漏补缺,2-4 周)
- [ ] **P2-1** schema 卫生原则文档化(**P2 / S**)—— CONTRIBUTING 加 schema_version const:1 + ID 正则两条原则,纯文档
- [ ] **P2-2** seeded PRNG 顺序无关性属性测试(**P2 / S**)—— mulberry32 + Fisher-Yates 打乱字段顺序验证 byte-identical
- [ ] **P2-3** Bounded Recipes 画廊(**P2 / M**)—— recipes/ 目录 8-12 高频场景,在 P1-9 SKILL.md 落地后做

### 永不照搬(红线)
- [x] ~~D2/Graphviz 之上架结构化 IR 编译回 DSL~~(立场冲突,推翻"engine 管布局"价值)
- [x] ~~ajv standalone codegen~~(边际价值低,运行时依赖不是负担)
- [x] ~~Archify preset 系统(classic/signal-flow/blueprint)~~(与 D2 theme 概念冲突)
- [x] ~~Archify 10500 行 viewer~~(过度工程,自研轻量版替代)
- [x] ~~直接抄 Archify 代码~~(license 未明,全部 reimplement)

---

**报告结束**。读者读完此报告应能直接判断:
1. **做不做?** —— P0 五项必做(其中 P0-1/P0-2/P0-3/P0-4 是低风险高收益加固,P0-5 需立项评估)
2. **先做哪个?** —— P0-1(1-2 天最快赢)→ P0-2(3-5 天)→ P0-3(5-7 天)→ P0-4(5-7 天)→ P0-5(2-3 周立项)
3. **哪些不做?** —— 红线 5 项明确拒绝
4. **能不能抄代码?** —— 全部 reimplement,license 未明处谨慎
