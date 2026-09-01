# 渲染看门狗使用与 LaunchAgent 安装指引(P0 §8.3 兜底)

> 配套:doc/2026-09-01-Chrome泄漏致整机冻结-P0根因报告.md §8.3。
> 脚本:`scripts/render-watchdog.mjs`(零依赖 Node ≥18,**不自动安装任何定时任务** —— 本页模板由用户手动装)。
> 上游根治(browser-pool 单例 + exit 钩子)已并入 `src/browser-pool.ts`;看门狗是 SIGKILL 无解时的**外部最后一道防线**。

## 1. 手动使用

```bash
npm run watchdog:render          # dry-run(默认):只侦察报告,不动任何进程
node scripts/render-watchdog.mjs --json   # 机器可读输出
npm run watchdog:render:clean    # 执行清理(SIGTERM→2s→SIGKILL 幸存者 + 删陈年 profile 目录)
```

**清理对象(三重与判定,零误伤)**:
1. 指纹:Chrome 族二进制 + (`puppeteer_dev_chrome_profile` / `media-gen-mcp-render` 临时 profile 前缀,或 `--run-all-compositor-stages-before-draw` + `--force-color-profile=srgb` 特征对);
2. spawner 已死:PPID=1(reparent 到 launchd)或 PPID 不在进程表 —— **在跑渲染的 Chrome 必有活 spawner,哪怕马拉松 render_video 超 10 分钟也永不命中**;
3. 存活 ≥ 600 秒(`--min-age-sec` 可调)。

用户真身 Chrome、lasso/flow 的 CDP attach Chrome(真实 profile,无指纹串)物理上不含特征,零误伤(报告 §9 已验证)。
陈年 profile 目录 = `$TMPDIR` 下两前缀目录中 mtime ≥ 60 分钟(`--dir-age-min`)且无任何活进程引用者。

**退出码**:0 正常;2 告警(Chrome 主进程 > 10(`--alert-chrome-main`)或 swap used > 4GB(`--alert-swap-gb`),或存在可清理孤儿);1 运行错误。

## 2. LaunchAgent 定时安装(可选,macOS,用户手动)

复制下面模板为 `~/Library/LaunchAgents/com.media-gen-mcp.render-watchdog.plist`,
把两处 `<...>` 占位符改成你机器的真实值,然后 `launchctl load`。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.media-gen-mcp.render-watchdog</string>

    <!-- 改成你的 node 绝对路径(which node) -->
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <!-- 改成仓库内脚本绝对路径 -->
        <string>/Users/&lt;you&gt;/Documents/Project/claude技能/media-gen-mcp/scripts/render-watchdog.mjs</string>
        <string>--clean</string>
    </array>

    <!-- 每 10 分钟一巡(P0 报告 §8.3 建议 10-15min;孤儿清理线默认存活≥10min,节奏匹配) -->
    <key>StartInterval</key>
    <integer>600</integer>
    <key>RunAtLoad</key>
    <true/>

    <!-- 日志(含告警详情;exit 2 会被 launchd 记为非零退出) -->
    <key>StandardOutPath</key>
    <string>/tmp/media-gen-render-watchdog.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/media-gen-render-watchdog.log</string>
</dict>
</plist>
```

安装 / 卸载:

```bash
# 安装(手动,脚本绝不代装)
cp com.media-gen-mcp.render-watchdog.plist ~/Library/LaunchAgents/   # 或直接把上面模板存成该文件
launchctl load ~/Library/LaunchAgents/com.media-gen-mcp.render-watchdog.plist

# 验证一巡(立即触发,不用等 10 分钟)
launchctl start com.media-gen-mcp.render-watchdog
tail -20 /tmp/media-gen-render-watchdog.log

# 卸载
launchctl unload ~/Library/LaunchAgents/com.media-gen-mcp.render-watchdog.plist
rm ~/Library/LaunchAgents/com.media-gen-mcp.render-watchdog.plist
```

说明:
- 定时任务走 `--clean`(看门狗的本职);想只报告不清,去掉 `<string>--clean</string>` 那行。
- exit 2(告警)时 launchd 仅记日志不重试告警骚扰;swap 告警代表整机内存压力,与是否清理无关。
- 若用 npx 安装的包(无 scripts/ 目录),用 `git clone` 本仓库或手动下载该脚本后按模板指向它。

## 3. 渲染调用侧 self-check(已内置,无需配置)

`src/render-selfcheck.ts` 在 render_svg / render_video / 交互图 PNG 导出的 Chrome 路径上自省孤儿计数:
孤儿主进程 ≥ 3 时把告警(含清理指引)上浮进渲染结果 warnings/render_video 的 stderr 日志。
轻量:节流 5 分钟一次真扫、3s 超时、失败静默、绝不阻塞渲染。
关闭:`MEDIA_GEN_RENDER_SELFCHECK=0`;测试环境(node --test)自动跳过保证确定性。
