# legacy 自管池提前清除 — 方案与红队终判(C 轮,2026-09-03)

> 判定轮次:A 方案(蓝队拟稿)× B 风险(红队初审)× **C 红队终判(本文,独立读码核验)**。
> 裁决背景:用户裁决 legacy 逃生门(原定 2026-12-01 退役)**提前彻底清除**;清除方案经多 agent 隔离+对抗审查判定无误后方可实施。
> 纪律:本文只判定+写方案,**零改码**。行号基准 = 工作树 2026-09-03(#5/#6 已入树,较 HEAD 66a6f80 的 browser-pool.ts 漂移约 +9 行);实施时以**符号锚定**为准,行号仅作定位辅助。

---

## 一、终判结论:GO(条件已全部并入 §四 修订方案)

- **A 方案判定无误**:公共件甄别、"3 测迁出"甄别、前置核验(CI/config 零引用、与 #1-#6 零冲突面)经独立读码全部成立。
- **B 风险三点判定全部证实**:launcherOverride≡legacy、降级面四处独立于 legacy、determinism skip 文案过时。
- **需补 6 处**(A 引文未覆盖,漏任一即编译失败或机械断言翻红;详见 §三 发现清单,已在 §四 方案中逐条补全)。
- 提前退役本身**不违反契约**:仓内 F6 canary(test/browser-pool.test.ts L325-333)自身文案即规定退役执行动作——"删除 legacy 池路径与 MEDIA_GEN_RENDER_MODE=legacy 分支(MEDIA_GEN_BROWSER_IDLE_MS 一并移除;退役后设 legacy → warn 后按 auto),同步降级模板去掉逃生门文案,然后删除本测试"。提前退役只改日期,不改语义。唯一跨仓义务 = lasso 侧对接文档注记(§四 P8)。

---

## 二、独立核验记录(C 轮亲自读码)

### 2.1 A 方案关键点核验

| # | A 的论断 | 核验结果 | 证据 |
|---|---|---|---|
| A-1 | refCount 保留为公共件;getBrowserPoolState 删五字段(launched/launchCount/idleTimerArmed/profileDir/exitEntries)、保七字段 | **成立** | refCount 注释明示"attach/legacy 共用"(browser-pool.ts L457),acquire/release 两路径共用;五字段全部只读 legacy 状态区(current/idleTimer/launchCount/liveForExit) |
| A-2 | legacy 专属符号(DEFAULT_BROWSER_IDLE_MS/PROFILE_DIR_PREFIX/LEGACY_ESCAPE_REMOVAL_DATE/setLauncherForTests/findEdgePath/DETERMINISTIC_FLAGS/LAUNCH_TIMEOUT_MS/idleMs/armIdleTimer/closeBrowser/ensureLaunched/liveForExit 等)删除无隐藏消费方 | **成立** | 全仓 grep:src/ 内零外部消费;test/ 仅两个池测试文件;scripts/ 仅 e2e-tools.mjs 的 raw-env 判断(非符号);doc 中仅历史文档文本提及 |
| A-3 | "browser-pool.test.ts 整文件删除,**3 测迁出**" | **成立且恰为 3** | 逐测盘点(全文件 17 测):14 测依赖 setLauncherForTests 注入或 MEDIA_GEN_BROWSER_IDLE_MS(单例并发 4 + 异常路径 5 + #5/#6 诊断 3 + syncCleanupOnExit SIGKILL 1 + F6 canary 1);**恰好 3 测与 legacy 无关必须迁出**:①"模块加载即注册 'exit' 钩子"(L274)②"默认注册 SIGINT/SIGTERM;MEDIA_GEN_NO_SIGNAL_HANDLERS=1 跳过"(L278,信号路径 attach 语义不变)③F3 导出面钉死(L348,迁出时计数 18→14) |
| A-4 | CI/config 零 MEDIA_GEN_RENDER_MODE 引用;与 #1-#6 工作树零直接冲突 | **成立** | 独立 grep .github/、config.json、config.example.json 零命中;`git diff src/index.ts | grep -c "browser-pool\|RENDER_MODE\|legacy"` = 0;browser-pool.ts 工作树 diff 仅 #5(mode 口径)+ #6(clampIntEnv),本方案将整体吸收该区域 |

### 2.2 B 风险关键点核验

| # | B 的论断 | 核验结果 | 证据 |
|---|---|---|---|
| B-1 | launcherOverride 与 legacy 是同一件事(useLegacyPool 注入即 legacy) | **证实,且波及面比 B 说得更具体** | useLegacyPool L443-446 首行即 `if (launcherOverride) return true`;setLauncherForTests(null) 同时被 **attach 测试文件**用作全量复位机制(L74/L83 beforeEach/afterEach + L448-456 专测)→ 删除后 attach 测复位必须改挂 setAttachProviderForTests(null, null)(其复位覆盖 releaseAttach+清注入,语义等价) |
| B-2 | 降级面四处不依赖 legacy 池代码 | **证实** | render-svg resvg 兜底(renderSvg try/catch,无码/有码/非池异常三分支全兜到 resvg);render-video 结构化错误原样上抛(L226-233,code 匹配即 rethrow);export-png 静默 resvg 兜底(L69-70 catch-all);determinism 经 getBrowser 探针诚实 skip。四处代码路径零 legacy 符号引用 |
| B-3 | determinism skip 文案"Chrome/Edge 不可用"已过时(实为 lasso 不可用) | **证实** | test/render-video-determinism.test.mjs L40 skip 文案 + L9 头注释;getBrowser 探针 auto 档走 attach,lasso 缺失 → null → skip,与 Chrome 无关。**该文件漏在 A 的 filesTouched 中(发现 F4)** |
| B-4(新增核验) | 机械检查脚本无模板钉死 | **证实** | check-error-text / check-readme-sync / check-render-output / check-schema 四脚本 grep 零 RENDER_BROWSER_UNAVAILABLE / legacy 渲染档相关命中(check-schema 的 "legacy" 是 provider 链术语,无关)→ 模板文案修改无隐藏机械门 |

---

## 三、发现清单(按严重度;均已在 §四 方案补全)

| # | 严重度 | 发现 | 后果(若漏) |
|---|---|---|---|
| F1 | high | A 引文未覆盖四个必要改动点:①resolveRenderMode/RenderMode 类型语义改造(契约 §二.d "设 legacy → warn + 按 auto"的核心条款)②renderBrowserUnavailableMessage 删 legacy 句 ③registerExitHooks.exitHandler 中的 closeBrowser() 调用(L765,信号路径)④BrowserLike.process?() 成员 | ①②违反契约§二.d;③编译失败(closeBrowser 已删);④类型面留死成员 |
| F2 | high | F3 导出面钉死测试迁出时**计数必须 18→14**(删 4 值导出:LEGACY_ESCAPE_REMOVAL_DATE/PROFILE_DIR_PREFIX/DEFAULT_BROWSER_IDLE_MS/setLauncherForTests);browser-pool.ts 内 F3 注释(L584-591)同步重写 | 机械断言翻红(18≠14),CI 必红 |
| F3 | medium | attach 测试 5 处处置需逐条执行(§四 P3);其中 2 处是**字段删除型断言**(L235 idleTimerArmed、L261 launchCount)——JS 侧 undefined!==0/undefined!==false 会翻红(非静默),但需逐条预知 | 测试红、需返工定位 |
| F4 | medium | test/render-video-determinism.test.mjs 漏在 A filesTouthed(skip 文案误导 + 头注释) | 用户看到 skip 误以为缺 Chrome(实为缺 lasso) |
| F5 | low | A 行号为 HEAD 基准,工作树已漂移 +9(#1-#6 落地后再漂) | 定位错误;以符号锚定消解 |
| F6 | low | render-video 的 acquireBrowser catch 包装(L221-233)退役后整体成死代码(唯一无码抛点在 legacy 分支 L626)→ 建议整删直取;render-svg 的无码 else-if 分支(L165-170)同死 | 留误导性死文案("install Chrome"——真实修复是装 lasso) |
| F7 | nit | 注释级同步:clampIntEnv 注释(L269-275)"两处消费"→单消费;resolveRenderMode L92 注释引用 MEDIA_GEN_BROWSER_IDLE_MS;文件头 L10-41 两档叙述;e2e L117-118 raw-env skip 分支删除(非保留) | 注释说谎/行为误导(env=legacy 会错误跳过 L3' 验收门) |

---

## 四、修订后的最终方案(零改码,本节即实施蓝本)

> 原则:**符号锚定**(行号仅供当前工作树定位);每步独立可编译、可测;P1-P3 为一个原子 PR(池+测试),P4-P8 可同 PR。

### P0 前置
1. 等 #1-#6 清理工作流收尾落地(工作树 M src/browser-pool.ts = #5+#6,本方案吸收其全部涉池改动;M src/index.ts = local-image 抽取,已核零冲突面)。rebase 后以本方案符号清单重新生成行号。
2. 复核零引用前置(C 轮已独立复核):.github/、config.json、config.example.json、四机械检查脚本均零 MEDIA_GEN_RENDER_MODE / 模板文案钉死。

### P1 src/browser-pool.ts — legacy 段删除 + 语义改造

**删除(符号清单)**:
- 常量:`LAUNCH_TIMEOUT_MS`(L136)、`DEFAULT_BROWSER_IDLE_MS`(L134)、`DETERMINISTIC_FLAGS`(L148-157,含注释 L144-147;确定性旗标责任已移交 lasso 渲染档 profile,契约 §二.a)、`LEGACY_ESCAPE_REMOVAL_DATE`(L110)、`PROFILE_DIR_PREFIX`(L132;P0 报告 §9 的 pgrep 自救命令属历史文档,对历史泄漏仍有效,不受影响)
- 函数:`findEdgePath`(L160-171)、`useLegacyPool`(L443-446)、`idleMs`(L467-469)、`clearIdleTimer`、`armIdleTimer`、`removeProfileDir`、`closeBrowser`、`defaultLaunch`、`ensureLaunched`、`setLauncherForTests`(L706-714)
- 状态/类型:`interface LiveBrowser`、`current`、`launching`、`idleTimer`、`launchCount`、`liveForExit`、`launcherOverride`(L448-464 整区;**`refCount` L457 保留**——attach/legacy 共用计数,heartbeat 启停依赖)
- 模板句:`renderBrowserUnavailableMessage` 中 legacy 逃生门句 + 退役日引用(L121-122)→ 模板收敛为「自愈命令 + lasso README 指引 + ensure stderr 原样透传」

**简化(保留函数,删 legacy 支路)**:
- `acquireBrowser`:删 useLegacyPool 判断与 legacy 体(L613-628,含无码 `BrowserUnavailableError` 抛点 L626——**它是全仓唯一无码抛点,删除后 render-svg/render-video 的无码分支成死路径,见 P4/P5**),attach 体成为唯一路径
- `releaseBrowser`:删 `armIdleTimer()` 调用(L637);touch + syncHeartbeat 保留
- `getBrowser`:单路径 `ensureAttached().catch(() => null)`(删 L659-662 legacy 分支)
- `shutdownBrowser`:`= releaseAttach()`(删 closeBrowser 调用)
- `getBrowserPoolState`:删 launched/launchCount/idleTimerArmed/profileDir/exitEntries 五字段;`mode: resolveRenderMode()`(删 useLegacyPool 三元);保留 mode/refCount/attached/attachCount/ensureCalls/heartbeatArmed/wsEndpoint
- `syncCleanupOnExit`:只剩 `attachedEntry = null; stopHeartbeatTimer();`(删 L739-745 legacy 清理体)
- **`registerExitHooks.exitHandler`(L759-770)**:删 `closeBrowser().catch(()=>{}).finally(...)` 链 → `releaseAttach(false).catch(()=>{}).finally(() => process.exit(0))`;注释同步(仅 attach 语义)

**语义改造(契约 §二.d 核心,F1-①②)**:
- `RenderMode` = `"auto" | "attach"`(删 "legacy")
- `resolveRenderMode`:删 `raw === "legacy"` 早返回 → legacy 落入 warn+auto 通路;**建议专用 warn 文案**:`MEDIA_GEN_RENDER_MODE="legacy" 已退役(自管池移除),按 auto 处理`(比笼统"非法值"诚实;满足契约"warn + 按 auto");既有 warn 文案"合法值 auto|attach|legacy"→"合法值 auto|attach"
- L92 注释改写(删"与 MEDIA_GEN_BROWSER_IDLE_MS 容错风格一致"引用)
- `BrowserLike.process?()` 成员删除(文档化用途仅 legacy exit 钩子 SIGKILL;attach wrapper 不暴露、三渲染消费方不用;`once?` 保留——attach disconnected 监听在用)
- 文件头注释(L7-41)重写:两档叙述 → 单档(attach/auto)叙述 + 退役史一句
- F3 注释(L584-591)重写:值导出 18→14(符号清单更新),删"legacy 专属面"字样
- `clampIntEnv` 注释(L269-275)更新:idleMs 消费随退役删除,单消费方 heartbeatIntervalMs(#6 注释不再说"两处")

**P1 后值导出面(14)**:BrowserUnavailableError、RENDER_UNAVAILABLE_CODE、renderBrowserUnavailableMessage、DEFAULT_HEARTBEAT_INTERVAL_MS、resolveRenderMode、resolveLassoEnsure、acquireBrowser、releaseBrowser、withBrowser、getBrowser、shutdownBrowser、getBrowserPoolState、setAttachProviderForTests、syncCleanupOnExit(+6 类型:BrowserLike/PageLike/ElementHandleLike/CDPSessionLike/RenderMode/LassoEnsureInfo)。

### P2 test/browser-pool.test.ts — 整文件删除,3 测迁入 browser-pool-attach.test.ts
- 迁测①:"模块加载即注册 'exit' 钩子"——原样
- 迁测②:"默认注册 SIGINT/SIGTERM;MEDIA_GEN_NO_SIGNAL_HANDLERS=1 时跳过(子进程验证)"——原样(信号路径 attach 语义不变)
- 迁测③:F3 导出面钉死——**`runtimeExports.length` 18→14**;allowed 5 符号(BrowserUnavailableError/RENDER_UNAVAILABLE_CODE/acquireBrowser/releaseBrowser/withBrowser)与三渲染消费方 importers 断言**不变**
- 其余 14 测随文件删除;F6 canary 按其自身规定"退役执行后删除本测试"消亡

### P3 test/browser-pool-attach.test.ts — 断言处置(逐条,F3)
1. 头注释验收点 1/4/6 更新(三态→两态+退役;模板要素;删 idle 表述)
2. `ENV_KEYS`(L68)删 `"MEDIA_GEN_BROWSER_IDLE_MS"`
3. beforeEach/afterEach 复位(L74/L83):`setLauncherForTests(null)` → `setAttachProviderForTests(null, null)`(复位语义 = releaseAttach 归还连接 + 清 ensure/connector 注入)
4. 三态测试(L87-98):legacy 断言改为「env=legacy → resolveRenderMode()==="auto" 且 warn 匹配 /已退役/」;非法值测试建议补 legacy 用例
5. **删**"attach 下 idle 定时器不武装"测试(L229-238:idleTimerArmed 字段已删,`assert.equal(undefined, false)` 必翻红;其存在意义随 env 与字段双亡)
6. 模板测试(L242-262):删 `/MEDIA_GEN_RENDER_MODE=legacy/`(L254)与 `/2026-12-01/`(L255)断言;删 `launchCount === 0` 断言(L261,字段已删);**建议补** `assert.doesNotMatch(e.message, /legacy/)` 钉死模板永不再含逃生门;其余(code/stderr 透传/refCount 归零)保留
7. **删** describe"legacy 逃生门与注入隔离"整节两测(L427-458);可选拆写一测:"setAttachProviderForTests(null,null) 复位:disconnect 归还 + 注入清空"(保复位语义覆盖)
8. 其余(ensure 解析链真 spawn 5 测/heartbeat 3 测/降级联动 2 测/归还 disconnect 2 测/SIGTERM 1 测)零改动——即回归网

### P4 src/render-svg.ts — 死分支清理
`renderSvg` catch 内 `e instanceof BrowserUnavailableError` 的**无码 else 分支**(L165-170,"Chrome/Edge not available (legacy 档)"文案系)删除——唯一无码抛点已随 P1 删除,分支不可达;`code === RENDER_UNAVAILABLE_CODE` 分支(降级 resvg + 结构化修复指引)与非池异常兜底("Chrome render failed, used resvg fallback")**一行不动**。

### P5 src/render-video.ts — 死包装删除
`acquireBrowser().catch(...)` 包装(L221-233)整体删除,改 `const browser = await acquireBrowser();`——该 catch 的唯一存在理由是把 legacy 无码错误转译为旧文案;退役后池错误必带 code=RENDER_BROWSER_UNAVAILABLE 且模板已是最终形态,直取即原样上抛。降级联动测试(L286-299)断言不破(错误由池直接抛出,形状不变)。

### P6 scripts/e2e-tools.mjs — 删 raw-env skip 分支
删 L117-118(`MEDIA_GEN_RENDER_MODE === "legacy"` skip)——退役后 env=legacy 解析为 auto,L3' attach 验收门**应正常执行**;保留该分支会让 env=legacy 错误跳过迁移硬门槛。

### P7 test/render-video-determinism.test.mjs — 文案纠偏(A 漏项,F4)
skip 文案(L40)"Chrome/Edge 不可用"→"lasso 渲染档不可用(装:npm i -g lasso-mcp)";头注释 L9 同步;getBrowser 探针调用零改动。

### P8 文档
- **README.md L243/L258、README.en.md L244/L259**:删逃生门句,改为一句退役说明(见 §六 文案);须过 check-readme-sync
- **doc/渲染档对接契约-lasso要点摘录.md**:§二.d 表 legacy 行(L57)、模板句(L62)、F6 段(L65-67)加执行注记"已于 2026-09-03 提前退役"(保留历史脉络);L44 旁路清单同步
- **doc/2026-09-01-Chrome泄漏致整机冻结-P0根因报告.md**:仅顶部历史标注(legacy 自管池已提前退役;正文 pgrep 自救命令对历史泄漏仍有效,不改)
- **lasso 仓 doc/对接实施说明-渲染档x-media-gen-mcp.md(跨仓协调项,非本仓改动)**:§二.d 加日期注记——降级模板已去 legacy 句与退役日、`legacy` 值现按 warn+auto、验收比对文案以 media-gen-mcp 现版 `renderBrowserUnavailableMessage` 为准(与 F7 短语收敛的"文案变更须同步 lasso 比对文案"注释义务闭环)

---

## 五、风险防护(不变式,实施 PR 的 Definition-of-Done)

1. **四降级点一行不动**(B 攻击面1 = 用户逃生路径):render-svg resvg 兜底 / render-video 结构化上抛(P5 删的是死包装不是上抛)/ export-png 静默 resvg / determinism 诚实 skip。export-png.ts 全程零改动(保护项,非修改项)。
2. **绝不静默回落 launch** 随物理删除单调增强(自管 launch 代码不复存在)。
3. **attach 语义零回归**:heartbeat/touch/单飞/disconnect 归还严禁 close——attach 测 13 测零改动即为回归网。
4. **验收命令**(全过才可合并):
   ```bash
   npm run build && npm test                                    # 全量基线
   MEDIA_GEN_RENDER_MODE=attach npm test                        # CI 钉死档
   MEDIA_GEN_RENDER_MODE=legacy npm test                        # 新增:warn+auto 生效性(legacy 不可达档,全绿=降级语义正确)
   node scripts/check-render-output.mjs test/golden/expected/qr/url.png   # golden 门槛
   ```
5. **导出面收缩有意为之**:18→14 值导出,F3 注释+钉死测试+本方案三处同步。

---

## 六、变更说明文案建议(changelog / README 措辞)

**Changelog(0.19.0)**:
> - **breaking(渲染档)**:移除 legacy 自管浏览器池(原定 2026-12-01 退役,提前执行)。`MEDIA_GEN_RENDER_MODE` 仅剩 `auto|attach`,设 `legacy` 现产生 warning 并按 `auto` 处理;`MEDIA_GEN_BROWSER_IDLE_MS` 随之一并移除。确定性渲染统一经 lasso 渲染档(`npm i -g lasso-mcp` 后运行 `npx -y lasso-mcp render-chrome --ensure`)。Chrome 泄漏 P0 根治的自管池(launch+exit 钩子+idle)完成历史使命,生命周期单一归属 lasso。

**README 依赖表措辞**(替换原逃生门句):
> 未装 lasso 时滤镜 SVG 自动降级 resvg(~92% 保真),动效视频返回带修复指引的结构化错误。(legacy 自管池已退役)

---

## 七、npm 版本建议

**0.19.0**。依据:0.x 阶段 minor 允许破坏性变更;本变更含 env 语义破坏(`legacy` 值、`MEDIA_GEN_BROWSER_IDLE_MS` 移除)+ 导出面收缩(18→14 值导出)+ 降级模板文案变更(lasso 验收比对面),绝非 patch。不跳 1.0(仓内尚有活跃演进,1.0 应留作 API 承诺冻结时点)。

---

## 八、判定签署

- C 轮(红队终判):GO——A 方案方向与甄别全部核验成立;6 项补充(F1-F7)已并入 §四;实施须以 §四 为唯一蓝本、过 §五 全部验收命令。
- 依据文件:src/browser-pool.ts(工作树 2026-09-03)、test/browser-pool.test.ts、test/browser-pool-attach.test.ts、src/render-svg.ts、src/render-video.ts、src/interactive-html/export-png.ts、scripts/e2e-tools.mjs、test/render-video-determinism.test.mjs、scripts/check-*.mjs、.github/、package.json(v0.18.0)、lasso 仓《对接实施说明-渲染档x-media-gen-mcp.md》§二.d/§一.5/§四。
