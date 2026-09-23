# lovart 评估 — lasso 阻塞项记录(2026-09-23)

> 任务:lovart.ai 正规化渠道评估,约定"浏览器操作只能使用 lasso"。本册记录过程中的全部 lasso 阻塞项与正常项,供 lasso 修复后恢复被阻塞的子任务。
> 环境:CC 的 lasso MCP = `node <lasso仓>/dist/index.js`(本地仓 1.30.0,dist 构建 09-20 含 BUG-08 E-1);本机 9222 被用户原生 Chrome 占用(无 CDP);工作实例 = 9225(lasso profile)。

## 阻塞项(2 项)

### 阻塞-1 browse_logged_in 调用期连接错误绕过 E-1 自动发现(BUG-13 的姊妹缺陷)

**操作序列**:
1. `chrome-status --port 9225` → 台账陈留(24h 硬顶已收昨日实例)→ 按 agent_directive `chrome-stop --zombie-gate` 清账 ✓
2. `launch-chrome --port 9225 --mode visible --idle-ms 0` → ✓ pid 5351,profile 登录态在
3. `browse_logged_in navigate https://lovart.ai/` → ❌ `nav_error:Could not connect to Chrome ... localhost:9222/json/version: HTTP Not Found`

**根因分析(对照源码 src/channels/LoggedInChannel.ts:215-245)**:
- E-1 三层解析(respawnOnDiscoveredPort)只挂在 `subproc.ensureRunning()` 的 **catch** 上(spawn/attach 期失败);
- 本次错误带 `nav_error:` 前缀 = chrome-devtools-mcp **已 spawn 成功**、在**首次工具调用(导航)期**才尝试连 CDP 失败——该路径不在 ensureRunning catch 内,**自动发现永不触发**,错误以 chrome-devtools-mcp 原始形态上抛(没有 E-1 的 `logged_in attach failed: tried port ...` 诊断格式,佐证未走 catch 分支)。
- 后果:BUG-13 §6 判断的"E-1 已修"在**这个失败形态**下不成立——attach 惰性化(首次调用才连)时三层解析失效。

**建议修复方向**:①chrome-devtools-mcp 子进程 spawn 后做一次**主动连通性探测**(fetch /json/version)把失败前移到 ensureRunning 期;或 ②调用期错误(nav_error 且 Cause 含 `localhost:<port>` 连接失败)同样路由进 respawnOnDiscoveredPort 重试一次。

### 阻塞-2 运行中 MCP server 不重读 ~/.lasso/config.json 的 LASSO_CDP_PORT

**操作序列**:写 `~/.lasso/config.json` = `{"LASSO_CDP_PORT": "9225"}` → 复调 browse_logged_in → ❌ 仍连 9222(错误逐字同前)。

**根因**:config file env(`loadConfigFileEnv`,src/config/config.ts:333)为**启动期装配**(index.ts 启动时 merge),长命 MCP server 进程不会重读;BUG-13 §8 配方("或 config.json")在 **server 已运行**场景下不可达——消费方无法通过任何运行时手段改变 browse 通道的 attach 口(env 不可注入运行中进程 / config 不重读 / 工具参数无此面)。

**建议修复方向**:①LoggedInChannel 每次(或 subproc respawn 时)重读 config file 的端口键;或 ②提供工具级运行时切换口(BUG-13 §7 曾以 R-CI-02 否决"工具参数",故优先 ①——语义是"配置热生效"而非新增参数面)。

## 正常项(按设计工作,记录在案)

- ✅ `chrome-status --port 9225` ledger_stale 判定 + agent_directive 给出唯一允许清账命令(never_kill 红线体系工作正常)
- ✅ `chrome-stop --zombie-gate`(kill-free 路径)清陈账
- ✅ `launch-chrome --port 9225 --mode visible --idle-ms 0` 拉起 + profile 登录态保持 + 台账记录
- ✅ dist 构建与源码 HEAD 一致(无"载旧码"问题——本次失败不是版本陈旧,是阻塞-1 的真实缺口)

## 对评估任务的影响与绕行

- **被阻塞子任务**:lovart.ai 的浏览器实探(公开页/定价页/注册流程形态/模型选择 UI)——待 lasso 修复后可补,预期为"增强项"而非阻塞主线;
- **主线绕行**:条款调研 agent 发现 **Lovart 官方 API**(/tools/ai-design-api:REST /api/v1/design/generate、OpenAPI/SDK、免费层 50 calls/day、credit 计费)——若 API 能力面满足(图生图/文生视频/图生视频待官方信息 agent 确认),接入形态为 **HTTP provider(白色路径)**,全程不需要浏览器;UI 驱动路径(需浏览器+灰色 ToS)仅作备选。

## 恢复条件

lasso 侧修复阻塞-1(调用期自动发现)或阻塞-2(config 热生效)任一落地并重建 dist 后,`browse_logged_in` 即可在 9225 实例工作,浏览器实探子任务随时可补。
