# PixVerse Provider 集成契约

> 2026-09-14 首次入仓。浓缩自《PixVerse深度参考手册-集成视角-2026-09-12》+ 其 09-14 勘误/终局裁决
> (对抗审查工作流 wf_71d20adc-75c)+ 官方 CLI README(`/tmp/pixverse-cli-readme.md` 快照)+ 本机 live 零消耗实测。
> 代码锚点:`src/providers/pixverse.ts`(provider)、`src/config.ts` `parsePixverseSection`(配置段)、
> `src/index.ts`(handler 接线)、`test/pixverse.test.ts`(白盒测试)。
> 本文是代码内引用的单一契约源(provider 头注释/S301 hint/registry 注释均指向本文)。

## 0. 渠道定位与关键事实

- **通道形态**:spawn 官方 CLI `pixverse --json`(stdout 恒 JSON,错误/进度走 stderr)。**绝不**裸调私有 API、**绝不**走官方 MCP —— CLI 是官方对 agent 暴露的唯一稳定契约面。
- **池**:订阅积分池(与网页同池)。**🔴 2026-09-14 终局裁决:CLI/API 通道不存在 Relax 免费池**(Relax 是 Web UI 独有权益;Standard 档无任何免费白名单,qwen-image 实扣 5/10cr)→ provider 的一切 image/video 提交都按计费处理。
- **价值面**:一个订阅聚合 25 个视频模型(v6/seedance/kling/veo/sora/minimax-h3/flux-3.0…)+ 14 个图像模型。
- **前置**:OAuth 登录态 `~/.pixverse/config.json`(30 天有效,无静默刷新)或 `PIXVERSE_ACCESS_KEY`;Node ≥ 22.12(CLI engines 要求,严于本仓 engines ≥ 18 → 运行时前置检测)。

## 1. 版本锁(🔴 纪律)

- `optionalDependencies` 精确锁 `pixverse@1.4.3`;bin 解析链:`PIXVERSE_BIN` → 逐级上溯 `node_modules/.bin/pixverse`(锁定安装落点)→ `npx -y pixverse@<pinned>` 兜底(钉版本,**禁裸 `npx pixverse`** —— 实证每次重解析 latest 静默漂移)。
- 启动自检:`pixverse -V` 版本比对 + capabilities bundle sha256 摘要与 `~/.media-gen-mcp/pixverse-state.json` 快照 diff。版本不匹配 → 响亮告警 + 每次结果携带 degraded warning(**绝不静默继续**)。
- CLI 升级 = 显式 act(改 optionalDependencies/pinnedVersion + CHANGELOG 评审),不作自动跟随。

## 2. 错误契约(S 码;格式 `[pixverse] S<code> <消息> Hint: <修复提示>`)

| 段 | 码 | 语义 |
|---|---|---|
| S1xx 环境 | S100 bin 缺失 / S101 - / S102 Node < 22.12 / S103 认证过期(exit 3,附 stderr 捕获的 Authorize URL + `auth login` 指引,precondition) | 请求从未提交,可链推进 |
| S2xx 传输 | S200 启动失败 / S201 spawn 超时 / S202 输出非 JSON / S207 异常形状载荷 | |
| S3xx 参数/门 | S300 未知模型 / S301 参数非法或 P2 未接形态 / S320 令牌不符或格式非法 / S321 令牌过期 / S322 令牌已使用 / S323 未过门提交 | |
| S4xx 结果 | S400 生成失败 / S402 积分不足(exit 4)/ S403 并发满(exit 7 或槽预检)/ S404 CLI 等待超时(exit 2 无任务 ID)/ S405 参数校验失败(exit 6)/ S406 任务不存在(内部 500047)/ S407 通用 / S410 工具级截止(防 stall ≤120s) | |

`precondition=true` 标记环境前置失败(请求未提交)→ 优先级链可推进/钉死守卫拦下。

### 退出码映射(capabilities.json 逐字;0-7 单表)

| exit | CLI 语义 | 映射 |
|---|---|---|
| 0 | 成功 | JSON 载荷 |
| 1 | 通用错误 | S407(内部 code 500047 → S406) |
| 2 | TIMEOUT | stdout/stderr 有任务 ID → **partial payload 恢复**(转轮询);否则 S404 |
| 3 | AUTH_EXPIRED | S103 + Authorize URL |
| 4 | QUOTA/积分不足 | S402 |
| 5 | GENERATION_FAILED(1.4.0+ 含部分批次失败) | 有 `items[]`/`failed_ids[]` → **partial payload 一等公民**;否则 S400(第三方模型附 412 advisory hint) |
| 6 | 参数校验失败 | S405(不重试) |
| 7 | CONCURRENCY_LIMIT | S403 → 退避 5s/10s/20s ×3 复用**同 idempotency key** 重试(不过门) |

非零退出防御性双解析:先 stdout 后 stderr(exit-5 partial 载荷通道未 live 验证,防御性支持)。

## 3. 🔴 计费确认门(两段式;image/video 全模式)

**09-14 终局裁决:CLI 无免费池 → 门覆盖所有扣费 create 模式**(早期「Relax 免门」设计作废)。

- **第一段**(无 `confirmToken`):零成本预检(`account info` 余额 + `account slots` 并发槽,超槽 S403 早失败)→ 返回 `SubmissionConfirm` 挑战(needConfirm + estimatedCost + confirmToken + TTL + hint),**不提交**。预估来源:成本账本命中优先(无告警)→ 静态首估(必带漂移告警)→ null(以实际扣减为准,缺失≠免费)。
- **第二段**(带 `confirmToken` 原参数复调):本地 HMAC 校验 → 通过返回 `undefined` 放行提交,失败抛 S320/S321/S322。
- **令牌结构**:`pvc1.<issuedAt36>.<seq36>.<idemKey(32hex uuid 无横线)>.<mac32>`。
  **HMAC 不变量**:`mac = HMAC-SHA256(secret, issuedAt.seq.digest.idemKey).slice(0,32)`(secret = `~/.media-gen-mcp/pixverse-confirm-secret`,安装级稳定,跨进程互认;校验用 timingSafeEqual 对令牌尾段)。🔴 2026-09-14 审查 P0-1 曾把 idem/MAC 两组错位使用(任何令牌都无法通过自校验),修复由 `test/pixverse.test.ts`「P0-1 HMAC 回归」钉死。
  `digest` = sha256(mode|model|quality|duration|count|audio|offPeak|prompt 指纹|输入引用指纹) —— 计费要素任一变化即失效。
- **单次消费**:消费表 `~/.media-gen-mcp/pixverse-confirm-consumed.json` 持久化(原子写+并集合并),同令牌二次 → S322;重取新挑战 → 新幂等键(「确认失败换新 key」纪律)。
- **TTL**:默认 10 分钟(`pixverse.confirmTtlMs`);过期 S321。
- **幂等键**:第二段通过后,提交用令牌中的 idemKey 作 `--idempotency-key`(同 token 重试安全复用;exit-7 退避也复用)。
- **门关闭**:`pixverse.confirm=false` 显式关闭(不推荐)→ 钩子 undefined + 每次提交随机 UUID key。
- **handler 接线**(`src/index.ts`):图像/视频各自独立钩子 —— `ImageProvider.beginImageSubmissionConfirm` / `VideoProvider.beginVideoSubmissionConfirm`(🔴 判别显式化:模态由钩子名表达,禁请求形状猜测;2026-09-14 审查 P0-2 删除了旧 `looksLikeVideoRequest`)。免费模态不实现钩子即豁免(flow 图像 0 点不实现;agnes/zhipu 均不实现)。fallback 链内计费渠道(用户显式列入 = 知情付费)同样过门。

## 4. 成本账本(E 必加)

- 落盘:`~/.media-gen-mcp/pixverse-cost-ledger.json`;键 = `mode|model|quality|duration|audio|count`(图像 duration=0)。
- 观测源:`asset list` 的 `cost_credits`(任务完成后 best-effort 读取;缺失≠免费,不落账只告警)。
- 预估优先级:ledger 命中 > 静态首估表 > null。静态表已证漂移(v6-360p 实扣 4cr/s vs 手册 5cr/s;qwen-image 720p/1080p 实测 5/10cr)→ 静态来源必带「以实际扣减为准」告警,观测落账后自动消失。
- 未传 quality/duration 时按能力表默认值落键(写读对齐)。
- **价格目录已落地(0cbe0ac)**:`costCatalog()` 经 `list_models` 透出(provider 可选方法,registry `buildListModelsDetail` 统一挂载)——三态 `ledger`(实测命中)> `static`(静态首估)> `unknown`(未发布,首用落账后转 ledger),附 `unit`(`per-image`/`cr/sec`)与 `mode`;调用方选型即可见成本,无需先跑挑战段。免费渠道不实现该方法即不出该字段(agnes/zhipu/flow 均无)。

## 5. 能力表与参数吸附

- `capabilities create <mode> [--model <id>]` 免登录免网络零消耗;能力缓存进程内有效,静态模型目录仅兜底。
- 参数吸附(on_invalid=adjust 会**静默改账单参数** → 预吸附 + 响亮告警):quality / aspect_ratio / duration / count;reject 且不在 enum → S301。
- 映射:`size`(非默认 1024x1024)→ 最近似 aspect_ratio(resolution 480p → quality 540p 吸附);`negativePrompt` 折叠进 prompt 尾部(CLI 无 --negative-prompt);`n` 忽略,工具层并发 fan-out(仓库契约),n 只进计费摘要。
- 输入四态:https:// / 本地路径 / data:(→ 临时文件)/ 纯数字 asset_id;`http://` 被 CLI 拒绝 → S301。

## 6. 配置

```jsonc
// config.json 顶级
{
  "pixverse": {
    "toolDeadlineMs": 110000,   // 工具级截止(防 stall ≤120s)
    "confirm": true,            // 计费确认门;仅显式 false 关
    "confirmTtlMs": 600000,     // 令牌 TTL
    "pinnedVersion": "1.4.3"    // 版本锁显式覆盖口(升级 = 显式 act)
  },
  "providers": { "pixverse": { "settings": { "bin": "..." }, "models": { "image": { "default": "..." }, "video": { "default": "..." } } } }
}
```

env:`PIXVERSE_BIN`(bin 覆盖)、`PIXVERSE_ACCESS_KEY`(无人值守)、`PIXVERSE_TOOL_DEADLINE_MS`、`PIXVERSE_CONFIRM_TTL_MS`、`MEDIA_GEN_PIXVERSE_SELFCHECK=0`(关启动自检)。

渠道准入:`requiresOptIn(image/video) = true`(订阅积分误耗红线,flow 先例)—— 未显式同意(provider/model 点名或 `<modality>ProviderPriority` 列入)不进任何隐式 fallback 链;链内列入时启动响亮告警。

## 7. P1 / P2 分期(控维护面;93 命令只取核心面)

- **P1(已接)**:create image / create video(t2v+i2v)+ task status / asset list / account info·slots / capabilities。显式 `--no-wait` + 自轮询(2/5/10s;done=1 / retry=5,9,10 / failed=7,8)。
- **P2(未接,门口即 S301 拒)**:voice / music / transition(keyframes 首尾帧)/ reference(多参考图)/ extend / modify / upscale / motion-control / template。
- **明确不接**:canvas / miniapps / saved。

## 8. 测试与验证纪律

- **测试零 spawn 零消耗**:测试只注入 `PixverseTransport` stub(先例:flow StubTransport);CI 绝不真实提交(积分红线)。白盒套件 `test/pixverse.test.ts`:退出码单表 / 纯函数 / 两段式门(篡改·过期·单次消费·跨实例)/ P0-1 HMAC 回归 / P0-2 模态判别 / 账本优先级 / registry 接线。
- **live 验证预算**(零消耗不限):`capabilities` / `account info·slots` / `task status` / 挑战段(含上述预检,不提交)。真实提交须用户明示预算并记账(account info 前后对账)。
- **live 记录**:2026-09-14 首轮 e2e:挑战段免费返回令牌,第二段复调触 P0-1(S320,0 消耗暴露);修复后同日复验:image(qwen-image 720p,ledger 命中 5cr)与 video(v6 720p 5s,静态 60cr)两路「挑战 → 令牌 → 第二段本地校验放行」全 PASS + 单次消费 S322 生效,**全程零提交零消耗**(仅 -V/capabilities/account info·slots 只读;余额记账复对 1290 → 1290 不变)。

## 架构债务登记(2026-09-14 02 简单架构审查:PASS 无重大偏差;9 条 WARN/REVIEW)

**已收口**:F5 版本锁双源断言(测试守护)/ F7 sniffImage 迁中立模块 src/image-sniff.ts(flow/pixverse/local-image 三消费方单源)。

**下一家计费渠道入仓前必须收敛**(2026-09-14 C 终裁:任何新计费渠道再复制 crypto 管线(第 3 实例)或再出 P0-1 级复制分歧缺陷,自动判重大偏差):
- F1 确认门 crypto 管线双实现(flow/pixverse 各 ~130 行近同构;复制已实证产出 P0-1 令牌段错位 bug)→ 抽 src/providers/confirm-token.ts(secret+消费表+mint/verify 骨架,载荷参数化)
- F2 confirm-digest sig 构造 4 份手工维护 → 提 buildImageSig/buildVideoSig 各一份
- F4 模型清单 3 处真值(常量/list_models/描述字符串)→ 描述改指 list_models

**登记容忍**:F3 新增渠道触面 9 文件(checklist 待文档化)/F6 S320↔S322 同义异码(两契约表在册)/F8 challenge 侧信道在 n>1 混合失败下可能被首错顶掉(结构 smell)/F9 opt-in 渠道构造期自检对全体用户产生启动副作用(void+catch,双豁免在案)。
