# 豆包评估 — lasso 阻塞项记录(2026-09-23 第三轮)

> 任务:豆包(doubao.com)渠道评估,约定浏览器操作只用 lasso。接续 [lovart评估-lasso阻塞项-2026-09-23.md](lovart评估-lasso阻塞项-2026-09-23.md)(第二轮两阻塞已在 lasso 1.30.1 修复,bugs/13 §9)。

## 阻塞-3 运行中 MCP server 载旧码,1.30.1 修复不生效(进程生命周期问题)

**现象**:
- lasso 仓 dist 已重建为 1.30.1(今日 12:40,含 BUG-13 §9 惰性 attach 自救 + config 热生效,`respawnWithConfigOrDiscovery`/`isConnectPhaseError` 均在 dist);
- 但 CC 的 lasso MCP server 进程是 **11:06 spawn 的两个长命进程**(早于 dist 重建 98 分钟)→ 仍载旧码;
- 实测 `browse_logged_in`:`nav_error:No page selected`(新形态——不再是第二轮的 9222 连接失败,而是子进程异常半态:attach 到了某 CDP 但无页面上下文;旧码无自救)。

**根因**:MCP stdio server 由 CC 会话启动并保活,消费方(本会话)无法让它重载新 dist。

**恢复条件(用户动作)**:CC 侧重连 MCP(`/mcp` reconnect 或会话重启)→ server 以 1.30.1 重启 → 按 bugs/13 §8 配方(LASSO_CDP_PORT=9225 或 config)即可正常 browse。**未尝试 kill server 进程逼 CC respawn**(有本会话 lasso 工具永久失联的风险,保守不动)。

**建议(lasso 侧可选)**:版本探针——server 启动日志/doctor 输出 dist mtime 或 version,消费方可一键裁决"是否载旧码"(BUG-13 §7-2 的诊断思想延伸到进程生命周期)。

## 环境正常项

- ✅ 9225 实例存活(今晨 launch,pid_match=true;`chrome-status` 判定 `ledger_user_owned`——归属鉴定正常)
- ✅ `launch-chrome` 对已占端口正确返回 ok:false(不 double-launch)

## 对评估任务的影响

同第二轮:浏览器实探(豆包页面/用户给的对话链接)延后至用户重连 MCP;调研主线(三路 agent:豆包能力/同类渠道发现/技术面条款)不依赖浏览器,先行。
