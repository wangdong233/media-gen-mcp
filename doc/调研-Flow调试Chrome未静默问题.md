# 调研报告:Flow 调试 Chrome "未静默"问题(浏览器窗口多次可见)

> 日期:2026-08-31 · 触发:用户观察"AIGC 使用 media-gen-mcp 期间,浏览器理应默认静默,好几次却没有" · 结论:**问题确认存在,双因叠加,media-gen-mcp 侧为主因(已修复)**

## 1. 调用链澄清(先回答"到底谁在调 lasso")

```
AIGC 会话的 Claude(客户端)
   │ ① tools/call: create_video(provider=flow) / flow_status(stdio JSON-RPC)
   ▼
media-gen-mcp server(node 进程)
   │ ② 自带 CDP 客户端 —— 纯 WebSocket 直连 127.0.0.1:9223(运行期零 lasso 参与)
   ▼
Chrome 调试实例(9223,labs.google 已登录)
   ▲
   │ ③ 一次性动作:最初拉起这台 Chrome 用的是 lasso CLI —— 执行者是「会话里的 Claude 照
      media-gen-mcp 返回的错误 Hint 在自己的 Bash 里跑命令」,不是 media-gen-mcp 调 lasso
```

media-gen-mcp **从不调用 lasso**(不调其 MCP 工具、不依赖其进程);"lasso 只出现在错误 Hint 文本里"——这就是静默问题的传导通道。

## 2. 根因(白盒三证,双因叠加)

### 主因 A:media-gen-mcp 的 Hint 把 visible 泛化到所有场景(本仓已修复)

| 证据 | 问题 |
|---|---|
| [旧]flow.ts:119 `LAUNCH_HINT = "…launch-chrome --port 9223 --mode visible…"` | 被 S100(CDP 不可连)/S103(连接断开)共 4 处引用 —— **纯重启/瞬态场景根本不需要可见窗口**(登录态在 profile,hidden 重启即恢复),但 hint 一律教 visible |
| [旧]flow.ts 401 hint 教 `lasso chrome-show` 且无配对收回 | 每次会话过期(AIGC 凌晨闲置后常发,见产线日志 #13/#14/#21)→ Claude 照做 chrome-show → **窗口显示后无任何自动收回** |

传导链:`S100/401 → Claude 读 hint → Bash 执行 visible/chrome-show → 窗口可见`。

### 主因 B:lasso 侧特性使 visible 一旦发生就"常驻"(lasso 仓记录,本仓不改)

| 证据 | 行为 |
|---|---|
| lasso chrome-stop.ts:145(停机收割 mode 过滤) | **只收割 hidden;visible 归用户** —— visible 实例不被 idle reaper/stop 触碰 |
| 9223 端口占用时 launch-chrome 探活即复用 | visible 老进程存活期间,一切后续"拉起"实际都在复用这个**可见**实例 |
| `LASSO_AUTO_HIDE_AFTER_LOGIN` 默认 off(C2 裁决:必须 opt-in) | 登录后不会自动收回隐藏 |

组合效果:**任何一次 visible 拉起或 chrome-show = 常驻可见,直到人工关闭** —— 与用户"好几次看到窗口"的频次特征吻合(每次事发后窗口留存一段时间)。

### 排除项(核实过不是问题)

- lasso CLI 裸命令默认确为 hidden(`DEFAULT_LAUNCH_MODE="hidden"`);AIGC 产线日志 #2/#21 的裸 `launch-chrome --port 9223` 规范本身静默 ✓
- media-gen-mcp 的自动开页自愈(S101)只开标签页,不改变窗口可见性
- 本会话(CC 主循环)历次拉起均 hidden + `--idle-ms 0`

## 3. 修复(本仓,HEAD 含)

1. **Hint 分层**:
   - `LAUNCH_HINT`(S100/S103 默认)→ `launch-chrome --port 9223 --idle-ms 0`(**hidden 零窗口** + 防 idle 收割),注明"仅 S102 未登录才需要 visible"
   - `LOGIN_LAUNCH_HINT`(**仅 S102 未登录**)→ visible 登录 + **完整收回链**:`登录后 lasso chrome-hide 收回后台`
   - 401 终败 hint 的 `chrome-show` 补配对 `chrome-hide` 收回指引
2. 门禁:576 测/574 pass/0 fail(CI-parity)+ 真实 HOME 全绿;零积分。

## 4. 残留与建议

- **当前已可见的 Chrome 实例**:执行一次 `lasso chrome-hide` 即回静默(或直接关闭该窗口,下次 hidden 拉起自动恢复登录态)。
- **给 lasso 仓的建议**(独立裁决,不属本仓):chrome-show 无超时自动收回 + visible 实例永不被收割 —— 两个行为对"MCP 无人值守场景"都偏敞口;可考虑 `LASSO_AUTO_HIDE_AFTER_LOGIN` 在 show-后-登录-完成 场景的默认化,或 show 带 TTL。
- AIGC 产线无感:其裸命令规范(hidden)本就正确;今后新会话遇 S100/S103 读到的已是分层后的静默指引。
