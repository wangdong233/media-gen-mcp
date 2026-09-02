# 渲染档对接契约:lasso 要点摘录(跨仓副本)

> 2026-09-03 建立(02 审查 F4 收尾件)。**真源 = lasso 仓**,本副本只收 media-gen-mcp 侧
> 写代码每天都要对的硬契约要点;两侧冲突时以真源为准,发现漂移先修副本再提 lasso:
> - `lasso/doc/对接实施说明-渲染档x-media-gen-mcp.md`(2026-09-01/09-02 定稿)
> - `lasso/doc/提案-render-stop端口作用域化.md`(§6 实施决议 → v1.20)
> - `lasso/doc/渲染档-并行验收隔离配方.md`(并行验收车道/三 env)
>
> 版本锚点(按 lasso 发版标注,消费方按装到的版本对号):
> - **v1.19.0**:attach 切换依据(media-gen 772676b 对接的契约面,§一~§四)
> - **v1.20.0**(944c99f):端口作用域化增量(§五);§一~§四 语义不变

## 一、ensure 协议【v1.19 起;消费方唯一入口】

- 命令 `lasso-mcp render-chrome --ensure`(幂等;默认端口 9224)。
- 成功 = **stdout 单行 JSON** + exit 0:`{wsEndpoint, port, startedAt, reused, touchPath}`;
  消费方判定规则 = **仅 `exit===0 且 stdout 可 parse` 才 attach**;未知字段必须忽略(前向兼容);
  stdout 只允许这一行,任何日志/进度走 stderr(否则消费方解析直接炸)。
- 失败 = 非零退出 + stderr 一行,原样透传进降级错误:`2`=Chrome 二进制缺失 /
  `3`=端口被非渲染档占用或既有档不健康且重生失败 / `4`=拉起超时(>20s)/ `5`=内部错误;
  未列举非零 = 未知失败,按通用失败降级。
- 超时预算:消费方 spawn 给 25s(lasso 内部拉起上限 20s);**`npx -y` 兜底路径放宽 90s**(冷启)。
- 可执行文件解析顺序:`MEDIA_GEN_LASSO_BIN`(显式路径,CI 用)→ PATH 直查 `lasso-mcp`
  → `npx -y lasso-mcp` 兜底。
- 并发单飞:两个消费方同时 ensure 不得 double-launch(lasso 台账一 port 至多一条)。

## 二、touch / heartbeat 契约【v1.19 起;防 idle 误收(bug02 教训)】

- touch 文件 = `~/.cache/lasso/chrome-touch-<port>`,由 ensure 输出 `touchPath` 字段下发,
  **消费方不硬编码路径**。
- 消费方义务:① 每次 acquire 渲染前后各 touch 一次;② **渲染会话存续期间每 ≤60s
  heartbeat**(引用计数驱动启停,unref 不 pin 事件循环);触碰失败仅 warn 不阻断渲染。
- lasso 义务:idle 判定 = max(lasso 自身 touch, 消费方 touch 文件 mtime);touch 新于
  idle 阈值(默认 10min,`LASSO_RENDER_IDLE_MS`)绝不回收;CDP 断连只作参考不触发回收。
- 长渲染(render-video 单会话可 >10min)恰是 heartbeat 覆盖场景 —— 漏心跳 = 被 idle 误收。

## 三、attach 集成契约【v1.19 起;最易翻车点】

- `puppeteer.connect({ browserWSEndpoint, defaultViewport: null })` —— 🔴 选项名是
  `browserWSEndpoint`;`webSocketDebuggerUrl` 是 CDP /json/version 的**字段名**,照抄直接
  throw(v1.19 对抗复审真机实锤)。页面级 setViewport 由渲染方自管。
- 🔴 **归还 = `browser.disconnect()`,严禁 `browser.close()`** —— 对 connect 实例调 close
  会下发 Browser.close CDP 指令,直接杀掉共享渲染档;池语义 close 已映射 disconnect。
- attach 下完全旁路:自管 launch / exit 钩子杀 / idle 定时器(`MEDIA_GEN_BROWSER_IDLE_MS`
  不生效,idle 归 lasso);保留 acquire/release 引用计数外壳与 BrowserLike 类型面。
- CDP 断连(`disconnected` 事件)只做消费方侧自清理,不杀不删(浏览器/profile 归 lasso)。
- SIGTERM/SIGINT 钩子:仅断连既有连接后退出;**不等在飞 ensure**(2026-09-03 项1 修,
  在飞 ensure 含 npx 兜底 90s 预算,等它 = 信号后滞留至多 90s;不等则连接随进程消亡,
  共享渲染档无损)。

## 四、MEDIA_GEN_RENDER_MODE 三态与降级模板【v1.19 起;对接说明 §二.d】

| 值 | 行为 | 用途 |
|---|---|---|
| auto(默认) | ensure 成功 → attach;失败 → 结构化错误(🔴 绝不静默回落自管 launch) | 常规 |
| attach | 强制 attach;ensure 失败同上报错 | CI / 验收钉死渲染档 |
| legacy | 自管池全量语义(launch + exit 钩子 + idle 5min) | 逃生门;退役日 2026-12-01 |

- env 唯一入口;非法值 warn(每值每进程一次)后按 auto。
- 降级模板:code=`RENDER_BROWSER_UNAVAILABLE`,message=「确定性渲染需 lasso 渲染档:
  先运行 `npx -y lasso-mcp render-chrome --ensure` 后重试(未装 lasso 见其 README);
  或临时设 MEDIA_GEN_RENDER_MODE=legacy 回退自管池(逃生门,2026-12-01 移除)。
  ensure stderr: <原样透传>」—— lasso 验收照此比对文案;自愈命令短语单一来源 =
  `src/browser-pool.ts` 模块私有常量 `ENSURE_SELF_HEAL_COMMAND`(F7 收敛,2026-09-03)。
- legacy 退役(F6):退役日锚 `LEGACY_ESCAPE_REMOVAL_DATE = 2026-12-01`
  (browser-pool.ts),`test/browser-pool.test.ts` 日期翻红测试 = 机械触发;退役动作 =
  删 legacy 池路径与 legacy 分支(`MEDIA_GEN_BROWSER_IDLE_MS` 一并移除,设 legacy →
  warn 后按 auto),详见该测试失败文案。

## 五、v1.20 增量:端口作用域化与并行隔离【v1.20.0 起】

- `render-chrome --stop` 与 `doctor [--clean]` 认显式 `LASSO_RENDER_PORT`,三态语义:
  **显式合法 = 只作用该 port**(与 ensure/status 对称)/ **未设 = 全部 render 记录**
  (设计决议 3.7 不变,单用户维护窗零影响)/ **显式非法 = exit 1**(stderr 单行 JSON 注明
  env 名+原值,不动台账)。
- doctor 孤儿判定三豁免(入报告 `outOfScope`,不动手):`portMismatch`(候选 port ≠
  scope)/ `touchFresh`(候选口 touch mtime ≤600s = 有消费者续命,不判孤儿)/
  `portUnknown`(候选 port 不可提取,保守不杀)。touch 缺席 = 不豁免(安全侧)。
- **生产 attach(车道 C)零影响**:attach 只做幂等 ensure + touch 续命 + disconnect 非
  close,从不触发任何清场命令 —— v1.20 作用域化只改清场命令的手工/脚本用法。
- 并行真机验收(车道 B,同机多 agent 各自跑清场)必须配齐三 env 命名空间,**缺一有暗坑**
  (完整配方与清场纪律 = lasso 仓 `doc/渲染档-并行验收隔离配方.md`;media-gen 侧摘录见
  `doc/渲染档共享实例-R5裁决与长期运行手册.md` §2.3):
  - `LASSO_RENDER_PORT`(端口命名空间:两 agent 抢同口,后者 exit 3)
  - `LASSO_LAUNCHED_CHROMES_PATH`(台账命名空间:缺则 `chrome-stop --all` / idle reaper
    作用于全局台账,互杀依旧)
  - `LASSO_RENDER_GUARDIAN_PID_PATH`(执守命名空间:缺则分账实例无收割宿主,滞留到
    24h 陈年扫描)
  - 并行期间禁 `chrome-stop --all`;`doctor --clean` 须三 env 配齐。

## 六、media-gen-mcp 侧对应落点(自查用)

- `src/browser-pool.ts`:ensure 解析链 / runEnsure / heartbeat / 断连自清理 / 降级模板 /
  SIGTERM 快退(项1);运行时消费面 = 6 符号 API 子集(F3 注释 + 钉死测试)。
- 三渲染消费方:`src/render-svg.ts` / `src/render-video.ts` / `src/interactive-html/export-png.ts`
  —— 经 BrowserLike 类型面零改动受益。
- 渲染确定性档以 lasso 渲染档为推荐路径(README 双语);watchdog 体系已退役(2026-09-01
  裁决),孤儿检测唯一出口 = lasso doctor。
