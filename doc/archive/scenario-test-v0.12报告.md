# media-gen-mcp v0.12.0 场景测试报告

- **报告日期**：2026-07-22
- **被测版本**：0.12.0（dist/ 已是 0.12.0 最新编译产物，含 `generate_interactive_diagram` + F11–F14 修复）
- **测试范围**：v0.12 新增第 20 个工具 `generate_interactive_diagram` 的 11 个端到端用户场景（generate / contract / error 三类）
- **测试方式**：`node scripts/scenario-tests.mjs` runner + Phase2 独立复核（grep/read 实际产物、Read dist 源码、自写脚本绕开 runner 直调 `buildInteractiveHtml`）
- **硬范围遵守**：未改 src/ 源码；仅在 output/scenario-test-v0.12/ 落产物、doc/ 写报告、scripts/scenario-tests.mjs 不动（场景全过无需改）

---

## 1. 一句话结论

**11/11 场景全部通过（passed=true，0 硬失败），runner 与独立复核逐项对齐无虚报；但实测揭出 2 个值得后续处理的观察点（非阻断）**：(a) 场景 02 用 `darkTheme="default"` 时双调色板"结构存在但视觉空转"——dark 块与 light 块色值字节级相同，README 头号用例承诺的"切深色自动反色"在该主题下肉眼看不到反色；(b) 场景 10 揭示 P0-2 的 `knownErrorPatterns.d2` 表未覆盖 `unknown shape "XXX"` 这一高频错误形态，落入兜底"未识别错误"分支。

---

## 2. 测试范围

### 2.1 本次覆盖（v0.12 用户可见新能力）

`generate_interactive_diagram` —— 把 D2 DSL 渲染成**单文件自包含交互式 HTML**（内置 viewer：pan / zoom / theme toggle / SVG export），关键差异 vs `generate_diagram`：

- 出 HTML 而非 SVG/PNG；
- D2 双调色板让 README 嵌入后**自动跟随系统深浅色**；
- 内置 Motion Governor（prefers-reduced-motion + data-motion=still），无障碍友好；
- 可选 `previewPng:true` 同时落盘 PNG（resvg 光栅化，无需 Chrome）。

11 个场景分 3 类覆盖上述能力：
- **generate（5）**：01 基础架构图浅色、02 darkTheme=default 双调色板（README 头号用例）、03 previewPng 双产物、04 时序图、05 ER 图；
- **contract（4）**：06 自包含零外链、07 Motion Governor、08 体积 ≤256KB、11 F12 空白串回归；
- **error（2）**：09 空 code LLM 友好错误、10 非法 DSL 错误捕获。

### 2.2 本次不重测（引用既有闸门）

`generate_interactive_diagram` 背后的内部质量由 P0-1..P0-4 四项支撑，已由 `npm test` **6 闸门**单测覆盖（见 `package.json` scripts.test）：

| 闸门 | 对应 P0 | 覆盖内容 |
|---|---|---|
| `node --test dist-test/*.test.js`（pares1 工具描述 / pares2 错误契约 / pares3 golden / pares4 产物守门 + 各引擎单测） | P0-1..P0-4 | 19+1 工具描述工作流化、4 引擎错误归一化、golden byte-compare、output-checker 11 handler 钩子 |
| `node scripts/check-error-text.mjs` | P0-2 | LLM 友好错误消息含修复动词 |
| `node scripts/check-schema.mjs` | P0-1 | inputSchema 零漂移 |
| `MEDIA_GEN_CHECK_PROFILE=strict node scripts/check-render-output.mjs` | P0-4 | 产物守门人 strict 档 |

用户场景清单不重测这些闸门，仅在出现回归时回头查对应闸门。

---

## 3. 逐场景结果表

| id | name | category | runner_ok | 独立复核 | passed | 产物路径 | 关键观察 |
|---|---|---|---|---|---|---|---|
| 01 | 基础架构图(浅色默认) | generate | ✓ | ✓ 源码层核验 `hasDark` 计算逻辑 | ✅ | `output/scenario-test-v0.12/01-out.html` (30431 B) | hasDarkLightDualPalette=false 双重互证（dist/interactive-html/index.js:68 + HTML 无 @media dark）；D2 真实电商订单架构（client→gateway→{order_svc,pay_svc}→{cache,db}）；`.fill-B1..B5` 是 D2 默认浅色 swatch 编号（深蓝 #0D32B2 / 极淡蓝 #E3E9FD），**非** dark palette——后续若有人静态扫 `.fill-B` 类判定"有 dark 调色板"会误判，应以 `@media prefers-color-scheme:dark` 块为准 |
| 02 | darkTheme=default 双调色板(README 头号用例) | generate | ✓ | ✓ grep + 按字节偏移切分 light/dark 区 | ✅ | `output/scenario-test-v0.12/02-darktheme-default-readme.html` (35431 B) | **结构 OK / 视觉空转**：darkTheme="default" 命中 `hasDark=true`（index.js:68），D2 WASM 正确注入 @media dark 块（line 286）+ 全套 .fill-B1–B6 / .fill-N1–N7 dark palette 类；但用 head/tail 按字节偏移 19583 精确切分后，light 区与 dark 区同名类的 #色值**字节级完全相同**（N1=#0A0F25 / B1=#0D32B2 等）——根因是 D2 的 "default" 主题本身就是浅色主题。结构契约达成、README 的"视觉自动反色"承诺在该主题下肉眼看不到 |
| 03 | previewPng=true(HTML+PNG 双产物) | generate | ✓ | ✓ PNG 魔数/IHDR/IEND 三段核验 | ✅ | `03-previewpng-true-html-png.html` (35431 B) + `.png` (46330 B) | PNG 头字节 `89 50 4E 47 0D 0A 1A 0A` 正确、IHDR 1600×718 RGBA non-interlaced、IEND 尾块正确；SVG 源 1110×498 → PNG 1600×718 = 1.441× 等比放大（resvg 后端，SVG 内无 `<filter>` 走 renderer=auto→resvg，无需 Chrome）；9 条中文边 label 全部渲染 |
| 04 | 时序图(sequence) | generate | ✓ | ✓ Read scenario-tests.mjs:66 确认 sequence DSL | ✅ | `04-sequence-html.html` (40452 B) | D2 sequence 图型专属 DSL `sequence_api_payment: { ... }` 正确渲染为 5 actor（payer/merchant/payment_api/channel/order_svc）+ 8 中文消息标签（下单/创建支付/拉起支付/拉起收银台/输入密码/支付成功回调/异步通知/更新订单状态）；非借用 graph 语法冒充 |
| 05 | ER 图(电商) | generate | ✓ | ✓ grep 实体/属性/基数 | ✅ | `05-er-html.html` (40399 B) | spec 最低要求"渲染出 4 实体之一"，**实测 4 个实体全部渲染**且每个都是完整 class-shape（标题 + 多属性 + 类型 int/string/decimal/enum）+ 3 个关系基数（1..N / N..N / 1..1）精确呈现；注：走 D2 class shape + 边标签基数通用形式，非 crow's foot 专业 ER 符号 |
| 06 | 自包含契约(零外链) | contract | ✓ | ✓ 4 条负向 grep + 5 条正向 grep | ✅ | `06-script-src-stylesheet.html` (35431 B) | 4 条负向契约全部 exit=1 零命中（`<script src=` / 外链 stylesheet / `<?xml?>` / `<img>`）；仅 2 个 http URL 是 w3.org XMLNS namespace（非网络拉取）；bonus 命中 prefers-reduced-motion:reduce (line 72) + prefers-color-scheme:dark (line 286) + max-width:640px (line 166) |
| 07 | Motion Governor | contract | ✓ | ✓ 三路（runner + 自写脚本 + grep/node 正则） | ✅ | `scenario-07-independent-dump.html` + `_independent_07.mjs`（独立复核产物） | @media prefers-reduced-motion:reduce (line 72) + html[data-motion="still"] 选择器 (line 78–80) + `<html data-motion="auto">` (line 2) 三信号齐；**bonus 发现 Motion Governor 有真牙**——line 74–75 / 81–82 确有 `animation: none !important` + `transition: none !important`，非空 stub；pre-paint resolver JS 能运行时把初始 auto 覆盖为 still |
| 08 | 体积契约(≤256KB) | contract | ✓ | ✓ 4 种工具交叉验证字节 | ✅ | `08-crosscheck.html`（独立复核产物，35431 B） | node Buffer.byteLength / fs.stat / ls -l / wc -c **四者全等 35431**，runner 无虚报；反退化断言（>5KB）+ HTML 真实性核查（含完整 doctype/head/body/svg/style/script + D2 节点文本）证明非凑字节垃圾；34.6KB 实测 = 256KB 上限的 13.4% 利用率，对比 Tier 2 mermaid ~2.8MB 内联膨胀留 7.4× 安全裕度 |
| 09 | 空 code → LLM 友好错误 | error | ✓ | ✓ 直捕 Error 对象 + 6 边界探针 | ✅ | （error 类，无产物落盘） | 消息逐字匹配 spec：`` `code` is required and must be a non-empty string ``；字段名定位 + 修复动词（required / must be）+ 非 stack trace + 英文陈述句；**6 种边界**（`""` / `"   "` / null / undefined / `{}` 缺 code / `0`）全部抛同一句；抛在 buildInteractiveHtml 入口最前置（index.js:41），不消耗 22MB WASM 加载 |
| 10 | 非法 DSL → D2 错误 | error | ✓ | ✓ 自写脚本 + Read d2.ts/error-format.ts | ✅ | （error 类，无产物落盘） | spec code `"this is :: not valid d2 ::"` 被 D2 WASM v0.7 容忍降级为 text node（不抛错）；附加 `shape: invalid_shape_xyz` 触发真实错误，消息为裸 D2 JSON `[{"range":"...","errmsg":"index:1:8: unknown shape \"invalid_shape_xyz\""}]`。**Phase2 深查**：即便走 MCP 工具层 normalizeEngineError，knownErrorPatterns.d2 表 6 条 pattern **无一条匹配** `unknown shape "XXX"`，落入兜底"未识别错误形态"分支 |
| 11 | F12 空白串回归 | contract | ✓ | ✓ 源码层 + 独立运行时 + 反差对照 | ✅ | （contract 类，无产物落盘） | `darkTheme=""` / `"   "` / `"\t"` 三种空白串全部不抛错且 hasDarkLightDualPalette===false（dist/diagram/d2.js:55–57 resolveD2Theme + index.js:68 空白守卫对齐）；**反差对照** darkTheme="neutral" → true，证明信号非恒 false、F12 修复 load-bearing |

**汇总**：runner_ok 11/11、独立复核 verified 11/11、passed 11/11。

---

## 4. 产物索引

`output/scenario-test-v0.12/` 下共 10 个文件（详见同目录 `INDEX.md`）：

| 文件 | 字节 | 对应场景 | 类型 | 打开方式 |
|---|---|---|---|---|
| `01-out.html` | 30431 | 01 | 官方产物 | 浏览器双击（自包含，离线可看） |
| `02-darktheme-default-readme.html` | 35431 | 02 | 官方产物 | 浏览器双击；切系统深浅色观察（注：default 主题视觉不反色，见 §5） |
| `03-previewpng-true-html-png.html` | 35431 | 03 | 官方产物 HTML | 浏览器双击 |
| `03-previewpng-true-html-png.png` | 46330 | 03 | 官方产物 PNG | 任意看图工具 / 贴 README |
| `04-sequence-html.html` | 40452 | 04 | 官方产物 | 浏览器双击 |
| `05-er-html.html` | 40399 | 05 | 官方产物 | 浏览器双击 |
| `06-script-src-stylesheet.html` | 35431 | 06 | 官方产物 | 浏览器双击（验证零外链） |
| `08-crosscheck.html` | 35431 | 08 | 独立复核产物 | 字节交叉验证用，非场景官方产物 |
| `scenario-07-independent-dump.html` | 35431 | 07 | 独立复核产物 | Motion Governor 信号 dump |
| `_independent_07.mjs` | 1552 | 07 | 独立复核脚本 | `node _independent_07.mjs` 重跑验证 |

**打开方式提示**：所有 .html 均为单文件自包含（零外链 script/stylesheet、零 CDN、零 `<?xml?>`），断网双击即可在浏览器看到带 viewer 的交互式架构图；viewer 五按钮（pan / zoom-in / zoom-out / zoom-reset / theme toggle）齐备。

---

## 5. 失败 / 问题深析

**硬失败：0 个。** 11 个场景的显式契约（spec `expect`）全部 runner_ok + 独立复核双向通过。

但 Phase2 独立复核发现 **2 个非阻断的观察点**，留报告供主控裁决（本工作流只测不改源码）：

### 5.1【观察 · medium】场景 02：darkTheme="default" 双调色板"结构存在 / 视觉空转"

- **现象**：`darkTheme="default"` 时，D2 WASM 正确注入了 dark palette 的全部结构信号（@media prefers-color-scheme:dark 块 + .fill-B1–B6 / .fill-N1–N7 全套类），但用 head/tail 按字节偏移 19583 精确切分 light 区与 dark 区后，**两区同名类的 #色值字节级完全相同**（N1=#0A0F25 / N7=#FFFFFF / B1=#0D32B2 / B3=#E3E9FD 等）。
- **根因**：D2 的 `"default"` 主题本身就是浅色主题。把它当 darkTheme 传，会产出结构正确的 dual palette（@media CSS 切换机制可用），但视觉上 dark mode ≡ light mode，不会反色。
- **不是代码 bug**：`renderInteractiveHtml` 正确把 darkTheme 透传给 D2 WASM、正确用 `assertDualPalette` 检测注入结构、正确置 `hasDarkLightDualPalette=true`。dist/interactive-html/index.js:68 的 `hasDark` 判定基于"是否提供 darkTheme"，不去比对色值差异——这是设计选择（结构契约），非实现错误。
- **与 README 头号用例的落差**：README ⑩-场景1 头号用例的验收标准写的是"系统切深色 → 图自动反色；切浅色 → 回浅底"。`darkTheme="default"` 满足了"结构自动跟随"（@media CSS 切换机制可用），但满足不了"视觉自动反色"（色值没变）。要让 README 的视觉承诺成真，需要传一个真正的 D2 暗色主题（如数字 ID 暗色主题 200/300 等），而不是 `"default"`。
- **建议（三选一，留报告）**：
  - (a) 场景 02 的 runner checks 加一个对比 light/dark 同名类 fill 色值是否不同的 check；
  - (b) README 头号用例把示例 darkTheme 从 `"default"` 换成一个真正暗色的主题 ID；
  - (c) README 注明 `darkTheme="default"` 只提供结构自动跟随、视觉反色需配暗色主题。

### 5.2【观察 · medium】场景 10：P0-2 knownErrorPatterns.d2 漏覆盖 `unknown shape "XXX"`

- **现象**：用 `shape: invalid_shape_xyz` 触发 D2 错误，引擎层（dist/diagram/d2.js:132）抛裸 JSON `[{"range":"...","errmsg":"index:1:8: unknown shape \"invalid_shape_xyz\""}]`；即便走 MCP 工具层 `normalizeEngineError('d2', raw, ...)` 归一化，`knownErrorPatterns.d2` 表 6 条 pattern（stroke-width 数字范围 / missing value after colon / X must be style.X / maps must be terminated with } / connection missing destination / one of expected:）**无一条匹配** `unknown shape "XXX"`，落入兜底分支输出 `[d2] <raw JSON>\n(未识别的错误形态，请把此消息反馈给 media-gen-mcp 维护者补 knownErrorPatterns 表。原始输入前 80 字符: ...)`。
- **影响**：D2 shape 关键字 20+（rectangle/oval/circle/diamond/hexagon/cylinder/cloud/person/page/step/stored_data/package 等），用户拼错概率高，目前拿不到"shape 合法值清单"这种立即可用的修复建议，LLM 友好性打折。
- **分层设计 intentional**：scenario-tests.mjs 直调 `buildInteractiveHtml` 绕过 MCP 工具层归一化是测试选择（d2.ts L132 注释明说"engine 层只抛裸 errmsg"，归一化责任在 handler 层）；真实 LLM 用户走 `generate_interactive_diagram` MCP 工具会经 normalizeEngineError（虽落入兜底，但有 [d2] 前缀 + 调试呼吁，比裸 JSON 略好）。场景 spec 期望"消息为 D2 原始 JSON"本就承认这点。
- **建议**：P0-2 后续补 1 条 pattern：`rx: /unknown shape "([^"]+)"/` → make 给出合法 shape 枚举。

### 5.3 其他加分观察（无需处理）

- **场景 01 边界提示**：HTML 含 `.fill-B1..B5` 类，看似像 dark palette，实为 D2 默认浅色 swatch 编号。真正的 dark palette 信号是 `@media prefers-color-scheme:dark` 块——后续静态扫描脚本若以 `.fill-B` 类判定"有 dark 调色板"会误判，应以 @media 块为准。
- **场景 07 bonus**：Motion Governor 块非空 stub，确有 `animation: none !important` + `transition: none !important`，触发时真能强制关停动画；pre-paint resolver 能运行时把初始 `data-motion="auto"` 覆盖为 still。
- **场景 08 bonus**：bytes 字段经 4 种独立工具（2 种 node API + 2 种 OS 命令）交叉验证全等 35431，runner 无虚报。

---

## 6. generate_interactive_diagram 用户可读性评估

基于实测产物（用浏览器实测打开 + grep 静态核验）：

### 6.1 HTML 在浏览器打开是否好看

**结论：好看，且超出预期。**

- 体积小（29.7–40.5KB，均远低于 256KB 上限），加载瞬时；
- D2 引擎（v0.7.0-HEAD）渲染质量高：架构图节点/连线/中文 label 清晰锐利（场景 01/02/03/06），时序图 5 actor + 8 消息排版规整（场景 04），ER 图 4 实体 class-shape + 属性 + 关系基数完整（场景 05，超出 spec 最低要求"渲染 1 个实体"）；
- viewer 五按钮齐：pan / zoom-in / zoom-out / zoom-reset / theme toggle；
- 键盘交互：Escape 重置缩放、+/- 缩放绑定；
- 持久化：localStorage mgm-theme / mgm-motion（try/catch 包裹，无 localStorage 环境降级安全）。

### 6.2 主题切换是否真生效

**结论：机制可用，但"视觉反色"取决于 darkTheme 传什么。**

- **结构层（always）**：所有产物均含 `@media (prefers-color-scheme: dark)` + `prefers-reduced-motion: reduce` 双 media query，CSS 切换机制就位；
- **视觉层（conditional）**：
  - `darkTheme` 缺省（场景 01）：hasDarkLightDualPalette=false，**不反色**（符合契约）；
  - `darkTheme="default"`（场景 02）：hasDarkLightDualPalette=true 结构注入，但色值与 light 字节级相同，**肉眼不反色**（见 §5.1）；
  - `darkTheme="neutral"`（场景 11 反差对照）：hasDarkLightDualPalette=true + @media dark 块真实存在，**预期会反色**（未做肉眼截图，但信号真实）。

**用户实操建议**：要让 README 嵌入后"切系统深色自动反色"，darkTheme 应传一个真正的 D2 暗色主题（数字 ID），而非 `"default"`。

### 6.3 PNG 预览是否清晰

**结论：清晰，无需 Chrome。**

- 场景 03 PNG：1600×718 RGBA non-interlaced，46.3KB，PNG 魔数/IHDR/IEND 三段正确；
- 由 resvg 后端按宽度光栅化（SVG 内无 `<filter>`/`<feGaussianBlur>` → renderer=auto 选 resvg），SVG 源 1110×498 → PNG 1600×718 = 1.441× 等比放大，无变形；
- 适合贴 README / 群聊分享 / 不支持 HTML 渲染的环境。

---

## 7. 清单更新情况

`doc/用户场景测试清单.md`（326 行）已就位：

- **§⑩ 已加**（line 263）：`## 🌐 ⑩ 交互式架构图用户 · generate_interactive_diagram（0.12 新增）`，含场景定位、与 `generate_diagram` 的关键差异、5 个平台自动组合示例、P0-1..P0-4 内部质量说明（line 311，引用 `npm test` 6 闸门）；
- **版本号已升**：line 1 `# media-gen-mcp 用户场景测试清单（v0.12.0）`；
- 本次场景测试未发现需要回改清单的内容（11 场景全过；§5 的 2 个观察点是代码/doc 层建议，非清单层）。

---

## 8. 下一步建议

按优先级：

1. **【P0-2 补 pattern · medium】** 给 `src/handlers/error-format.ts` 的 `knownErrorPatterns.d2` 表加一条 `rx: /unknown shape "([^"]+)"/` → make 给出 shape 合法值枚举（rectangle/oval/circle/diamond/hexagon/cylinder/cloud/person/page/step/stored_data/package）。场景 10 已留 `/tmp/sc10_efmt3.mjs` 复现脚本。
2. **【README 头号用例修正 · medium】** `doc/用户场景测试清单.md` §⑩ 场景 1 的示例 darkTheme 从 `"default"` 换成一个真正暗色的主题 ID（或在示例下注明"default 只提供结构跟随，视觉反色需配暗色主题"），让 README 承诺的"切深色自动反色"肉眼可见。
3. **【场景 02 runner 增强 · low】** scenario-tests.mjs 场景 02 加一个对比 light/dark 同名类 fill 色值是否不同的 check（把"视觉空转"从隐性问题变成显式失败），或换 darkTheme 为真实暗色主题。
4. **【场景 10 强化 · low】** spec code `"this is :: not valid d2 ::"` 被 D2 容忍不抛错，靠附加 code 才验证错误路径——若想单场景同时验证归一化命中路径，可换 code = `"a -> -> b"`（触发 connection missing destination，正好命中 knownErrorPatterns 第 5 条 HINT）。
5. **【场景扩展 · low】** 可考虑补：(a) darkTheme 传数字暗色主题 ID 的场景（验证真反色）；(b) SVG export 按钮的产物正确性场景；(c) 移动端 viewport（max-width:640px）下的 viewer 可用性场景。

---

**报告结束。11/11 通过，0 硬失败，2 个 medium 观察点已留根因 + 建议供主控裁决。**
