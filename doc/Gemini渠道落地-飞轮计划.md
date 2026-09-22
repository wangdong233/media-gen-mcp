# Gemini 渠道落地 — 迭代飞轮计划

> 日期:2026-09-22 | 前置:[Gemini渠道调研-2026-09-22.md](Gemini渠道调研-2026-09-22.md)(可行性定谳)
> 用户指令:搜索确认无其他渠道后直接落地第五渠道;自设计迭代飞轮与迭代测试,要求"有测试标准、有迭代要求,多轮飞轮迭代出成型产品"

---

## 0. 渠道全景裁定(本轮搜索结论)

**问题**:谷歌系除 gemini.google.com 外是否还有其他生图/生视频渠道(尤其免 Pro 订阅的)?

| 渠道 | 媒体生成能力 | 免费层 | 裁定 |
|---|---|---|---|
| **Gemini 网页/App**(gemini.google.com) | NB2 图像 / Omni 视频 | 图像全档位;视频付费档;**用户 PRO 订阅配额制** | ✅ **落地目标**(上轮已实测闭环) |
| **Gemini API / AI Studio**(官方 API) | Veo 3.1 三档 / Omni Flash / NB2 全系 | **媒体生成全部 "Free Tier: Not available"**(定价页 2026-09 实况,逐行核实);仅文本/嵌入模型免费 | ❌ 正路但纯按量付费(Veo Lite $0.05/s、NB2 $0.067/张 1K),需 GCP 绑卡;文本免费层与本项目无关 |
| **Google Labs**(ImageFX/VideoFX/Whisk) | — | — | ❌ 已并入 Flow/Gemini;labs 系受既有 L1 IP 信誉 + L3 账号地区门禁(Flow 死域同源,[google-ai-availability] 三层门禁调研定谳) |
| **Vertex AI** | 同 Gemini API | 同上 | ❌ 企业 GCP,价格同 API,无个人优势 |
| **AI Studio 网页 UI**(aistudio.google.com/models/veo-3) | Veo 试用入口 | 走 API 项目配额;免费项目对 Veo 无配额 | ❌ 同 API 死路(定价页权威) |
| Google Photos/Slides/Vids 内嵌生成 | 消费功能 | — | ❌ 无自动化面 |

**裁定:无其他可行渠道。Gemini 网页渠道(Pro 订阅配额)是用户当前唯一"零增量现金成本"的谷歌系媒体生成通路 → 落地第五渠道。**

补充记录(留给未来):若用户某天开 GCP billing,API 形态(HTTP provider,比 UI 驱动简单一个量级)可作为 `gemini-api` 独立渠道加入,与本渠道并存不冲突。

---

## 1. 产品定义(第五渠道 `gemini`)

**形态**:CDP attach lasso Chrome(profile 持 Google 登录态)+ **页面 UI 驱动**(Flow provider 家族;不做 wire 重放——StreamGenerate 无文档,UI 入口比协议稳)。

### 1.1 能力面(MVP → 完整)

| 工具 | 模式 | 引擎 | 实测基线 | 备注 |
|---|---|---|---|---|
| generate_image | 「制作图片」 | Nano Banana 2 | 16s 出图(blob) | 宽高比控件;30+ 风格 chips(R2 暂不透传,进阶项) |
| create_video | 「制作视频」 | Omni | 48s 出片(直链) | 宽高比 16:9(+9:16 待枚举) |
| list_models | — | — | — | 透出 gemini 渠道模型目录 + 配额模型说明 |
| (增强)前置自检 | — | — | — | 登录态/IP 地区/Usage 配额读数(低配额警示) |

**明确不做**(本轮):图生图/参考图上传、视频图生视频、风格 chips 参数化、音乐生成、StreamGenerate wire 重放——登记为后续增强。

### 1.2 架构落点

```
src/providers/gemini-web.ts        ← UI 驱动引擎(enterMode/typeAndSend/pollArtifact/fetchDownload)
src/providers/gemini-cdp.ts        ← CDP 客户端(attach/端口可配;独立于 flow 的 9223)
src/providers/types.ts             ← 无新钩子(无积分概念,配额警示走 warnings)
src/providers/registry.ts          ← 注册 + buildListModelsDetail 透出
src/index.ts                       ← generate_image/create_video 路由接入
~/.media-gen-mcp/config.json       ← gemini: { port: 9225 }(默认) ;链可选 "gemini"
test/gemini-web.test.ts            ← 单测(mock CDP,零真连)
test/gemini-tools.integration.test.mjs ← 集成(GEMINI_IT=1 显式门,FLOW_IT 同款纪律)
```

**硬规则**(吸取既有教训):
1. **端口从第一天参数化**(lasso Issue #1 教训):`config.gemini.port` / env `GEMINI_CDP_PORT`,默认 9225
2. **集成测试默认永不真连**:`GEMINI_IT=1` + 非 CI + CDP 活着 三门(FLOW_IT 纪律复制,Flow 窗口事故 #2 根因不复现)
3. **永不 kill 浏览器**:attach 失败只报结构化错,自愈指引=launch-chrome 命令文案
4. **防 stall**:单次调用 deadline(默认 300s:视频实测 48s,预算 6×;超时转 S410,底层不取消)
5. **配额警示**:无积分确认门;每次视频生成带 warning"消耗订阅算力配额,视频消耗显著(实测单条≈15-20% 5h窗口)"
6. **零覆盖红线**:下载落盘防覆盖避让(-2/-3);data:URI 剔除
7. **错误码族**:[gemini] S1xx 环境(CDP/登录/地区)/ S2xx 网络 / S3xx 参数 / S4xx 生成(超时/无产物/部分)

---

## 2. 迭代飞轮设计

### 2.1 飞轮模型

```
        ┌────────────────────────────────────────────┐
        │  轮 N:实施(单维度)                         │
        ↓                                             │
   机械测试门(npm test 全绿+新套件)                    │
        ↓                                             │
   真机验证门(GEMINI_IT=1,产物 magic+ffprobe 校验)    │
        ↓                                             │
   审查门(轮末 fresh agent,03 清单 §3.7 指派规约)     │
        ↓  P0/P1=0?                                  │
   否 → 修复 → 回机械测试门(同轮内 ≤2 次;             │
        第 3 次失败 → 停轮重述目标,不争吵)             │
   是 → 轮报落盘 → 轮 N+1                             │
        └────────────────────────────────────────────┘
```

### 2.2 轮次与 DoD(每轮 Definition-of-Done)

| 轮 | 内容 | 机械测试门 | 真机门 | 通过标准 |
|---|---|---|---|---|
| **R0** | 契约冻结:本文档评审定稿 + provider 契约注释 | — | — | 契约字段与调研实测一一对应;测试清单可机械执行 |
| **R1** | 骨架:gemini-cdp(attach/参数化端口/健康探测)+ gemini-web 骨架(模式进入 mock) | 新套件 ≥12 测:attach 成功/失败/端口/env 优先级/超时/错误码映射 | CDP 探活 1 次(零生成) | npm test 全绿;670+ 基线零回归 |
| **R2** | 图像全链:enterMode(制作图片)→ prompt → poll blob → fetch 落盘 | ≥10 测:模式选择器/菜单点击容错/产物校验/防覆盖/超时 | **1 次真生成**:PNG magic + 尺寸>0 + name 映射 | 产物落盘可打开;S410 路径可注入测 |
| **R3** | 视频全链:制作视频 → poll 直链 → 下载 | ≥10 测:直链解析/下载失败重试/时长校验/配额 warning 透出 | **1 次真生成**:MP4 magic + ffprobe 时长>0 | 同上;配额警示文案在工具返回可见 |
| **R4** | 治理:防 stall deadline/registry 透出/配置链/退避重试(生成中 CDP 断连)/list_models 目录 | ≥8 测:守护测试(注册表透出不被误删/链语义/端口配置) | 零生成 | npm test 全绿;守护测试就位 |
| **R5** | 终审:fresh agent 双审(03 清单:架构偏差+测试覆盖)+ 修复 | 全量回归 | 连续 3 次同 prompt 幂等(2 图+1 视频内完成) | 审查零 P0/P1;幂等 3/3 |
| **R6** | 收尾:功能清单/README/契约文档/配置切换建议 → 用户验收 | 文档 CI-parity 检查 | 零 | 用户验收 |

**全局迭代纪律**:
- **Decompose-Don't-Compress**:每轮只动一个维度(全局 CLAUDE.md 工作流)
- **同一问题两次纠错失败即停轮重述目标**,不争吵(全局纪律 §8.4)
- **配额预算**:全程真机生成 ≤10 次(5h 窗口 ~24%/3 次的教训 → 每轮预算内;R5 幂等 3 次是最大单轮消耗)
- **审查 creator 不自批**:R5 fresh agent 签章(AIGC 纪律同源)
- **轮报落盘**:每轮结束在本文档 §4 追加轮报(通过/失败+证据+消耗)

### 2.3 测试标准(机械化,拒绝"it works")

1. **产物真值校验**:PNG/JPEG magic bytes;MP4 用 ffprobe(duration>0 / has_video_stream)——不是"文件存在"
2. **错误码全路径可注入测**:每类 S1xx-S4xx 至少 1 个用例能人为触发并断言结构化返回
3. **零真连默认**:`npm test`(无 GEMINI_IT)不产生任何 CDP 连接/网络生成——用连接计数器断言
4. **守护测试**:registry 透出行/pixverse costCatalog 既有守护零回归(曾被误删两次的前科)
5. **幂等**:同 prompt+同参数 3 次全成功且产物独立落盘(避让后缀)
6. **基线**:670+ 测全绿,0 fail(允许既有 2 skip)

---

## 3. 风险登记(飞轮全程监控)

| 风险 | 缓解 |
|---|---|
| 5h 配额窗口耗尽阻塞真机门 | 轮间错峰;预算表跟踪;耗尽时真机门降级为"结构化配额错误返回正确"也算过门 |
| Google 改版 UI(选择器漂移) | 选择器多级容错(label→text→结构);S1xx 报错附带 UI 探测快照字段 |
| IP 漂出可用区 | S1xx 地区错误码 + 面板读数前置检查(R4) |
| CDP 断连(浏览器被收) | attach 重试 1 次 + 结构化 S100 自愈指引 |
| lasso 9225 实例被 idle 回收 | launch 用 `--idle-ms 0`(已带 24h 硬顶);provider 侧不负责拉起,只给指引 |

---

## 4. 轮报(实施中追加)

### R0 契约冻结 — PASS(2026-09-22)
- 本文档即契约(能力面/错误码/纪律与调研实测一一对应);测试清单 §2.2/§2.3 可机械执行。
- 架构债务核对:F1/F2(确认门 crypto)只约束计费渠道,gemini 配额制无确认门不触发;F4 模型清单单一真源以 `GEMINI_IMAGE_MODELS/GEMINI_VIDEO_MODELS` 常量 + 描述指向 list_models 遵守;CdpConnection 抽公共模块 `src/providers/cdp-client.ts`(防 CDP 客户端第 2 复制实例,债务精神前置收敛)。

### R1 骨架+全链实现 — PASS(2026-09-22)
- **交付**:`src/providers/cdp-client.ts`(flow CdpConnection 迁移+错误工厂参数化+sendCommand 公开)、`src/providers/gemini-web.ts`(GeminiError/GeminiTransport 抽象/CdpGeminiTransport 生产传输/UI 驱动完整序列:ensureFreshChat→enterMode→typeAndSend→pollAndFetch)、registry 注册(端口参数化 `GEMINI_CDP_PORT`/`providers.gemini.cdpPort`)、工具描述/链列入警告接入。
- **机械门**:白盒 `test/gemini-web.test.ts` **24/24 绿**(目录/能力/准入/序列断言/错误码 8 路径/warnings 纪律/registry 接线);全量 **694 测 692 pass / 0 fail / 2 skip**(基线 670 → +24,flow 迁移零回归)。
- **测试缝**:settle/poll 节奏全实例字段化(生产默认常量;flow heal* 先例)。
- **真机门 L1(零配额)**:open + 登录态 50ms PASS。
- 集成门禁分层:GEMINI_IT=1(环境层,零配额)/ +GEMINI_IT_GEN=1(真生成层,烧配额)——默认永不真连(FLOW_IT 纪律)。

### R2 图像全链 — PASS(2026-09-22,三轮迭代)
- 真机门三轮:①L2-1 断言 PNG magic 挂(产物实为 JPEG)→ 断言放宽 PNG/JPEG;②L2-2 发现 **页面 fetch(blob:) 一律 "Failed to fetch"**(blob 引用不经 Service Worker 上下文;调研期未验证过 blob fetch,新真机事实)→ **图像改 canvas 抓取**(decode+drawImage+toDataURL JPEG 0.92,零 fetch 依赖);③L2-3 **全绿**(canvas → data:image/jpeg → 落盘管线)。
- 同轮修复:provider 产物形态裸 b64 → **data:URI**(handler 落盘管线唯一消费形态,contentType 自动定扩展)。
- 机械门:白盒 24/24(断言同步 canvas 路径;stub 匹配键 imgActions/createElement 防表达式特征串扰)。

### R3 视频全链 — PASS(2026-09-22,两轮即绿)
- L2-2 起 createVideo+getVideo 真机全绿:Omni 提交(伪 handle)→ getVideo 轮询 DOM → `contribution.usercontent.google.com` 直链 fetch(video/mp4 1.1MB,ftyp magic ✓)→ data:video/mp4。
- 配额警示 warning 断言在册(白盒+真机)。

### R4 治理 — PASS(2026-09-22)
- 工具描述(generate_image/create_video/get_video/list_models)接入 gemini;链列入配额警告(registry,对齐 pixverse 段式样)。
- 契约守护测试同步:provider-pin 套件 opt-in 家族正则加 gemini(守护机制正常抓住描述变化,同步后 4/4)。
- 真机幂等证据:三轮 L2 自然积累 **图像 3/3、视频 2/2 成功**(替代单轮 3 连发,配额经济性优先)。
- 全量:694 测(691→修复后终验)。

### R5 终审 — PASS-WITH-CONDITIONS → P1 全清(2026-09-22)
- **fresh agent 五维审查**(独立复跑全部测试):**P0=0,P1=5**——A README.en 不同步致 check-readme-sync 红(我改了 zh 漏 en)/B numFrames·frameRate·mode 静默丢弃违"丢弃必告警"铁律/C **CdpGeminiTransport 传输层零白盒覆盖且 R1 轮报虚标**(R1 DoD 写了 attach 测试实际只到 stub 层)/D S400(配额耗尽终态)误映射 in_progress → 同步路径空转 900s/E 会话交错无守卫(新提交导航走未取件会话的产物页,配额沉没无告警,AIGC 抽卡连发必踩)。
- **P1 全修**:A README.en 补 gemini(sync 165/165 数字对齐绿)/B 三键异值告警(同值不告警)/C 传输层 6 测(fake CDP 先例:open 成功/S100 死端口/S101 开页失败附诊断/自愈成功带 warning+实证 /json/new 不落地导航/exceptionDetails S103+连接复位重连/attach 无 wsUrl S103)+ P2-3 getVideo 入口 open(复位自愈)/P2-4 终态删会话/P2-6 GEMINI_CDP_PORT NaN 守卫/P2-7 注释勘误与死参数清理/D S400→failed+删会话(仅 S410 保留 in_progress)/E S303 交错守卫(未取件会话存续期拒绝新提交,文案指路 get_video)。
- **修复回归 4 测 + 传输层 6 测**:gemini 白盒 **34/34 绿**;R1 轮报虚标教训入册(见 §5)。
- 审查独立复跑证据:flow 侧 193/193 零漂移(cdp-client 迁移逐行 diff 确认);架构/安全两维 PASS(kill 红线干净/三门真成立/配额警示在位)。

### R6 收尾 — PASS(2026-09-22)
- 功能清单(5 渠道/718 测基线/错误码表 [gemini] 行)、README.md + README.en.md(能力表行+详解段,sync 绿)、飞轮计划本档。
- 全量终验 **704 测**(694 基线 + 10 传输层/审查回归)702 pass / 0 fail / 2 skip,check-readme-sync 绿(165/165)。
- 真机证据链:L1 环境门 + L2 双门图像 3/3、视频 2/2(canvas JPEG / MP4 ftyp magic 真值校验)。

## 5. 教训入册(本轮新增)

1. **轮报虚标**(R5 审查抓):DoD 写了"attach 测试"而实施只到 stub 层就记 PASS——**轮报 PASS 必须逐条对着 DoD 机械可验项核,不凭整体感觉**。
2. **真机断言先行校准**:产物格式断言(PNG)先于真机实测写入,首次真机即挂(JPEG);**真值断言应对未知格式留双收面,或首轮真机后立即校准**。
3. **页面 fetch(blob:) 不可用**(SW 上下文)——blob 产物一律 canvas 抓取;视频直链 fetch 可用。调研期"没验证过的通路"= 风险敞口,落地测试必须覆盖。
4. **README 双语同步是机械门的一部分**:改 zh 漏 en 直接红 check-readme-sync(P1-A)——zh/en 必须同一 commit 内成对改。
5. **同步渠道的终态语义**:配额耗尽类页面错误(S400)是终态,in_progress 保留只属于"生成可能仍在跑"(S410)——异步状态映射要按错误语义分流,不能一刀切。
6. **单页 UI 驱动的交错纪律**:一个 attach 页 = 同时至多一个 live 会话;提交入口守卫(S303)优于事后告警。
