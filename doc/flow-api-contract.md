# Google Flow API 白盒契约(经 lasso/CDP 逆向,2026-08-22)

> 来源:真实 Chrome(lasso launch-chrome --port 9223,profile ~/.cache/lasso/chrome-profile-default,已登录 wdong4036@gmail.com)网络抓包 + 页面上下文重放验证。**已实测验证的端点**:session/credits/projectInitialData/getMediaUrlRedirect 重放 ✓;batchGenerateImages/batchAsyncGenerateVideoText 抓包 ✓(重放待实施时验证)。
> 项目(永久复用,除非失效再新建):**c36ca3e2-192b-41e5-9e5b-700130e3d324** @ ~/.media-gen-mcp/flow-project.json

## 0. 架构决策(内置化路径)

**一切经 CDP 页面上下文 fetch(Runtime.evaluate + awaitPromise),不裸调 API**:
- recaptcha token 必须真实页面环境生成(grecaptcha.enterprise.execute),无法离线伪造
- 认证全自动:labs.google 同源 cookie(tRPC)+ Bearer access_token(aisandbox,来自 /fx/api/auth/session)
- 页面上下文无 CORS 问题(同源)

**前置检测(工具内置,允许才用)**:
1. CDP 127.0.0.1:9223 可连(/json/version)
2. 存在 labs.google page target(/json/list)
3. 页面 session 有 access_token(fetch /fx/api/auth/session,非 `{}`)
4. (可选)checkAppAvailability/IP 已隐含通过(session 有效即可)

## 1. 认证与常量

| 项 | 值 |
|---|---|
| API key(X-goog-api-key) | `AIzaSyBtrm0o5ab1c-Ec8ZuLcGt3oJAA5VWt3pY`(部分 aisandbox 调用;GET credits 用 ?key=) |
| Bearer token | session.access_token(ya29…,~1h 过期;每次从 /fx/api/auth/session 现取) |
| reCAPTCHA site key | `6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV`(enterprise, invisible) |
| tool 内部名 | `PINHOLE`(Flow) |
| 账号 | INTERMEDIATE tier / G1_TIER1 / PAYGATE_TIER_ONE;积分 892→868(实验消耗 24) |
| 域 | tRPC = labs.google/fx/api/trpc/*;生成 = aisandbox-pa.googleapis.com |

## 2. 端点契约

### 2.1 session(GET labs.google/fx/api/auth/session,cookie)
`{user{name,email,image}, expires, access_token, …}` —— 未登录返回 `{}`。

### 2.2 积分(GET aisandbox-pa.googleapis.com/v1/credits?key=<API_KEY>,Bearer)
`{credits: 868, userPaygateTier, sku, serviceTier, subscriptionCredits}`

### 2.3 项目/模型目录/状态(GET labs.google/fx/api/trpc/flow.projectInitialData?input={"json":{"projectId":"<pid>}},cookie)
关键路径:
- `modelConfig.imageModelFamilies[]`:{displayName,id,usages[{key,maxImageReferences(10),generationTimeSeconds,supportedAspectRatios,requirements[[IMAGE_REQUIREMENT_*]],creditMapping{SERVICE_TIER_*:{cost}}}]}
- `modelConfig.videoModelFamilies[]`:usages 同构(key 含模式+时长,如 abra_t2v_8s)
- `userData`:{credits, serviceTier, settings{…}}
- `projectContents.media[]`:**生成状态轮询源** —— `{name(mediaId), mediaMetadata{mediaStatus{mediaGenerationStatus}, mediaBlobSize, requestData{…}}, video.generatedVideo{seed,model,aspectRatio}, dimensions{length}}`;状态机 `MEDIA_GENERATION_STATUS_SCHEDULED → …_SUCCESSFUL`(失败态待观察,推测 …_FAILED)
- `projectContents.workflows[]`:{name(workflowId), metadata{primaryMediaId, batchId}}

### 2.4 生图提交(POST aisandbox-pa.googleapis.com/v1/projects/<projectId>/flowMedia:batchGenerateImages,Bearer)
```json
{
  "clientContext": {"recaptchaContext":{"token":"<grecaptcha.enterprise.execute(...)>","applicationType":"RECAPTCHA_APPLICATION_TYPE_WEB"},"projectId":"<pid>","tool":"PINHOLE","sessionId":";<Date.now()>"},
  "mediaGenerationContext": {"batchId":"<uuid>"},
  "useNewMedia": true,
  "requests": [   // 数量 = 数组长度(x1..x4),每项独立 seed
    {"clientContext": {…同上…},
     "imageModelName": "NARWHAL",
     "imageAspectRatio": "IMAGE_ASPECT_RATIO_LANDSCAPE",
     "structuredPrompt": {"parts":[{"text":"<prompt>"}]},
     "seed": 305830,
     "imageInputs": []}
  ]
}
```
响应(待完整确认,参考 video):{remainingCredits, workflows[], media[](name=mediaId, mediaStatus SCHEDULED)}

### 2.5 生视频提交(POST aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoText,Bearer)

> **🔴 2026-08-23 勘误:本节记录的"请求侧 generation spec"实为响应侧结构误当同构,真实请求 v2 wire 见 §7.3(每模式独立端点 + requests[]/videoModelKey/useV2ModelConfig)。以下保留作历史抓包参照。**
- body 同构 clientContext/mediaGenerationContext{batchId, audioFailurePreference:"BLOCK_SILENCED_VIDEOS"} + generation spec(请求侧字段名未完整抓到;**响应侧结构如下**,请求大概率同构):
```json
{"videoModelControlInput":{"videoModelName":"abra_t2v_8s","videoGenerationMode":"VIDEO_GENERATION_MODE_TEXT_TO_VIDEO","videoAspectRatio":"VIDEO_ASPECT_RATIO_LANDSCAPE","videoResolution":"VIDEO_RESOLUTION_720P"}}
```
- x2 = 两次独立 POST(同 batchId,各自 seed)
- 响应:{remainingCredits, workflows[], media[{name=operation.name, mediaStatus:SCHEDULED, video{generatedVideo{seed,prompt,model}, dimensions{length:"8s"}, operation{name}}}]}

### 2.6 下载(GET labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=<mediaId>,cookie)
- 无 type → **video/mp4**(206 Range 流;arrayBuffer 即完整文件)
- `&mediaUrlType=MEDIA_URL_TYPE_THUMBNAIL` → image/jpeg(**raw JPEG 字节流**;🔴 2026-08-23 F 轮 live 勘误:旧记录 "base64 文本" 是错的 —— 经 dist provider 代码路径零积分实证,2,508,689B 视频的缩略图 = 43,007B、以 FF D8 JPEG magic 开头,arrayBuffer 即完整 JPEG。推论:缩略图字节数与本资产 mediaBlobSize 本就不同,**字节完整性校验只适用原始资产下载**;详见 §10.9)

### 2.7 项目创建(POST labs.google/fx/api/trpc/project.createProject,cookie)
body `{"json":{"projectTitle":"<name>","toolName":"PINHOLE"}}` → {result:{data:{json:{result:{projectId}}}}}

## 3. 模型矩阵(2026-08-22 快照,INTERMEDIATE tier)

**图片(全部 0 点,~30-40s)**:
| key | 名 | 特性 |
|---|---|---|
| GEM_PIX_2 | Nano Banana Pro | 10 refs + characters + base image |
| NARWHAL | Nano Banana 2(默认)| 同上 |
| HARBOR_SEAL | Nano Banana 2 Lite | 同上 |
| GEM_PIX_2_UPSAMPLE_2K | 2K 放大 | 0 点 |
比例枚举:**IMAGE_ASPECT_RATIO_{SQUARE,PORTRAIT,LANDSCAPE,PORTRAIT_THREE_FOUR,LANDSCAPE_FOUR_THREE}**(UI 16:9/9:16/1:1/3:4/4:3)。🔴实测纠偏(2026-08-22 live 提交 400 反证 + 页面 bundle 逐字核对):wire 枚举是全拼 `THREE_FOUR`/`FOUR_THREE`,缩写 `PORTRAIT_3_4`/`LANDSCAPE_4_3` 会被 400 `Invalid value at 'requests[0].image_aspect_ratio'` 拒收;另有 `IMAGE_ASPECT_RATIO_UNSPECIFIED`。

**视频(可用,**点数/条**)**:
| family | key 模式 | 点数 | 说明 |
|---|---|---|---|
| Omni Flash(abra)| abra_{t2v,i2v,r2v}_{4,6,8,10}s;abra_edit | 7/10/12/15;20 | i2v=START_IMAGE;r2v=REFERENCES;~120s;LANDSCAPE/PORTRAIT;720P |
| Veo 3.1 Lite | veo_3_1_{t2v,i2v,r2v,interpolation,extension}_lite | 10 | interpolation=首尾帧(START+END IMAGE);extension=延长;~110s |
| Veo 3.1 Fast | veo_3_1_*_fast(landscape/portrait/ultra/fl) | 20 | fl=首尾帧 |
| Veo 3.1 Quality | veo_3_1_{t2v,i2v_s,extend}[,_portrait,_fl] | 100 | |
| Veo 3.1 Upsampler | veo_3_1_upsampler_1080p | **0** | 1080p 超分免费 |
模式枚举:VIDEO_GENERATION_MODE_{TEXT_TO_VIDEO,?(I2V=START_IMAGE 由 usage 区分)};比例 VIDEO_ASPECT_RATIO_{LANDSCAPE,PORTRAIT};分辨率 VIDEO_RESOLUTION_{720P,…}
UNAVAILABLE = 当前 tier 不可用(4K/ultra 等)。

## 4. UI 自动化备忘(探索实证,非 API 路径必需)
- Material 组件 **JS .click() 无效**,必须 CDP Input.dispatchMouseEvent(mouseMoved→pressed→released,buttons:1)
- 输入框 contenteditable DIV:真实聚焦 + Input.insertText(execCommand 也行)
- 弹层选项 role=tab(aria-selected 状态)
- 模式 tab:图片/视频/帧(crop_free,首尾帧)/素材;数量 x1-x4;时长 4/6/8/10s
- 提交按钮:innerText 含 "arrow_forward"

## 5. 已知风险/开放问题
- recaptcha token 单次有效?(每次 execute 现取即可;action 名待验证——先不带 action 试)
- 视频请求侧 generation spec 字段名待重放确认(用响应结构推断同构)
- access_token ~1h 过期 → 每次现取 session
- FAILED 状态枚举值未观察(2026-08-23 E 轮修:非终态一律 in_progress —— SCHEDULED/PENDING/ACTIVE 三枚举 live 实证归 in_progress,仅 SUCCESSFUL=completed、FAILED=failed、缺状态(上传残留)=failed;详见 §10.5/§10.6/§10.7)
- Chrome/页面必须活着:工具前置检测 + 清晰错误提示(`lasso launch-chrome --port 9223 --mode visible` + 登录 labs.google)

## 6. 实施期实证补遗(2026-08-22,provider 落地时验证)

- **§5-1 已解决:reCAPTCHA action 必须带**。不带 action 的 `grecaptcha.enterprise.execute(siteKey)` 产出的 token 上游拒收:
  `POST flowMedia:batchGenerateImages → HTTP 403 {"code":403,"message":"reCAPTCHA evaluation failed","status":"PERMISSION_DENIED"}`。
  action 名从页面 bundle 实证(_app-cf6a7aa3 / 7874 chunk 的 `hw('<ACTION>')` 调用点):`IMAGE_GENERATION`(生图,已 0 点重放 ✓)/ `AUDIO_GENERATION`(音频,明文调用点)/ `VIDEO_GENERATION`(视频,✅ 后 live 双 200 实证 §7.4)。🔴 **`IMAGE_UPSAMPLING`(放大)是 D 轮误判,已证伪(§10.8)**:该字符串在 bundle 仅作 OUT_OF_CREDITS 错误类目键;2K 放大真实 action = `IMAGE_GENERATION`(2026-08-23 页面 grecaptcha 拦截 + UI 单次触发捕获)。
- **§2.4 重放 ✓(0 点生图全链路)**:clientContext/mediaGenerationContext/useNewMedia/requests 形状与抓包一致;响应 `{media:[{name}]}`,轮询 projectInitialData 至 SUCCESSFUL(~30s),getMediaUrlRedirect 无 type 直接返回原图 bytes(content-type image/jpeg)。
- **已完成资产不带 mediaStatus**:成功图片/视频的 media 条目无 `mediaMetadata.mediaStatus`(仅生成中有);状态判定须「无 mediaStatus 且有 generatedImage/generatedVideo → completed」。
- **模型目录动态源**:projectInitialData `modelConfig.videoModelFamilies[].usages[].key` 为全量合法 usage key(2026-08-22 快照 77 个,含 veo_3_1_lite_low_priority / upsample_4k 等);`generationTimeSeconds` per-key 可得。
- **视频提交(§2.5)仍未重放**(消耗积分,刻意未测);请求体按本契约同构推断实现,首个真实提交若 403/400 应回查 bundle 的视频 hw 调用点混淆索引与请求字段名。
- **aspect/seed 已 live 复验(2026-08-22,0 点)**:`aspect="3:4"` → `IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR` 提交 200、产物 896x1200(=3:4);`seed=305830` 直入 requests[0].seed 且响应 media 含 `image.generatedImage.seed` 可回读;前后 credits 恒 868。
- **视频 usage key 模式段**:v1 仅 t2v 族 key 可提交(见 flow.ts S303 门禁);i2v/r2v/interpolation/extension(含 extend)/edit/upsampler 的请求形状(START_IMAGE/imageInputs/独立端点)未逆向、未实现。

## 7. 带图链路全量实证(2026-08-23,live 提交验证;积分台账:918 →911(i2v abra_i2v_4s,-7)→901(interpolation veo_3_1_interpolation_lite,-10)→894(provider 代码路径复验 i2v,-7),共 3 次提交 24 点;上传/带图生图全程 0 点)

> 方法:页面 bundle 字符串表运行时解码(`a1_0x4290()` 取数组 / `a1_0x13e1(i)` 解码,数组 10055 条含全部端点/字段/枚举字面量)+ 页面上下文直接重放。400 INVALID_ARGUMENT 的 fieldViolations 是免费字段探针(unknown name = 字段不存在;404 NOT_FOUND = 字段全对、模型 key 不存在)——零积分即可验证 wire 形状。

### 7.1 上传(✅ live 200,0 点,无需 reCAPTCHA)

**POST `https://aisandbox-pa.googleapis.com/v1/flow/uploadImage`**(注意:flow/ 前缀,非 projects/<pid>/)
```json
{
  "clientContext": {"projectId":"<pid>","tool":"PINHOLE","sessionId":";<ms>"},
  "cropCoordinates": {},
  "fileName": "x.png",                  // optional
  "imageBytes": "<base64 原始字节>",
  "isHidden": false, "isNotIngredient": false, "isUserUploaded": true,
  "mediaGenerationContext": {"batchId":"<uuid>"},
  "mediaIdSeed": "<uuid>", "mimeType": "image/png",
  "parentMediaGenerationId": "", "workflowIdSeed": "<uuid>"
}
```
→ `{media:{name=<mediaId>, image:{userUploadedImage{aspectRatio}, dimensions{width,height}}, mediaMetadata{...}}, workflow:{...}}`。64x64 PNG 也接受。

### 7.2 生图带图(✅ live 200,0 点;base image + references)

`flowMedia:batchGenerateImages` 的 `requests[0].imageInputs` 条目 = **`{imageInputType, name}`**,`name` = 上传返回的 **mediaId**(不是文件名、不是 imageBytes——裸 imageBytes 无 name 会 400;mediaId 字段名不存在)。客户端构造(bundle 实证):
```json
"imageInputs": [{"imageInputType":"IMAGE_INPUT_TYPE_BASE_IMAGE","name":"<mediaId>"},{"imageInputType":"IMAGE_INPUT_TYPE_REFERENCE","name":"<mediaId2>"}]
```
- 有 base image 时 `imageAspectRatio` 强制 `IMAGE_ASPECT_RATIO_UNSPECIFIED`(比例随底图;客户端代码实证 + live 200)。
- references 上限 10(`usages[].maxImageReferences`)。IMAGE_INPUT_TYPE_{UNKNOWN,REFERENCE,BASE_IMAGE}。

### 7.3 视频提交 v2 wire(✅ i2v / StartAndEndImage live 200;t2v / ReferenceImages 形状 404 探针验证)

**🔴 §2.5 请求体形状勘误(2026-08-23)**:请求侧从来不是顶层 `structuredPrompt`/`seed`/`videoModelControlInput`——那是**响应侧** `media[].mediaMetadata.requestData.videoGenerationRequestData` 的结构被误当同构。真实请求是 v2 形状(顶层旧字段全部 400 "Unknown name")。

**端点族(每模式一个端点,bundle 端点表 + string table 实证)**,均为 `POST https://aisandbox-pa.googleapis.com/v1/video:<apiPathname>`:

| 模式 | apiPathname | requests[0] 专有字段 | 状态 |
|---|---|---|---|
| t2v | `batchAsyncGenerateVideoText` | —(纯 textInput) | 形状 404 探针 ✓(v1 已放行;🔴 provider 路径从未 live 提交——§14.7 透明标注,t2v 是 5-live 之外的两个 shape-verified 之一。〔后被 §15 修正:2026-08-27 provider 路径 live 提交成功(-7 点)〕) |
| i2v | `batchAsyncGenerateVideoStartImage` | `startImage` | ✅ live 200(abra_i2v_4s,-7 点) |
| 首尾帧 | `batchAsyncGenerateVideoStartAndEndImage` | `startImage`+`endImage` | ✅ live 200(veo_3_1_interpolation_lite,-10 点) |
| r2v | `batchAsyncGenerateVideoReferenceImages` | `referenceImages[]`(+`referenceAudio[]` §14.6) | ✅ live 200(abra_r2v_4s,-7 点,§10.6 台账;🔴 本行原记"未提交验证,暂不开放"有误——§10.6 台账已证明 r2v live,此处勘误) |
| 延长 | `batchAsyncGenerateVideoExtendVideo` | `videoInput`(直接引用生成视频,§9.2 证伪上传前置) | ✅ live 200(§10.6,veo_3_1_extension_lite,-10 点;🔴 本行原记"未实现"未随 §10.6 刷新,勘误) |
| 编辑 | `batchAsyncGenerateVideoEditVideo` | (EditVideo 不加 useV2ModelConfig) | 形状定型+假 key 404 ✓(§11.1;live 待授权。〔后被 §15 修正:2026-08-27 live 提交成功(-20 点),全形状实证〕) |
| 重拍 | `batchAsyncGenerateVideoReshootVideo` | | 未实现(无 wire 工作,如实) |
| 超分 | `batchAsyncGenerateVideoUpsampleVideo` | 分辨率编码在 key(§9.1 证伪 outputSpec.videoUpsampleResolution;§14.3 补:upsample item 另有顶层 resolution 字段) | ✅ 已实现+live(§10.7) |
| 物体插入/移除 | `...ObjectInsertion` / `...ObjectRemoval` | | 未实现 |

**请求体(全端点同构;EditVideo 除外均带 `useV2ModelConfig: true`)**:
```json
{
  "clientContext": {"recaptchaContext":{"token":"<grecaptcha.enterprise.execute(siteKey,{action:'VIDEO_GENERATION'})>","applicationType":"RECAPTCHA_APPLICATION_TYPE_WEB"},"projectId":"<pid>","tool":"PINHOLE","sessionId":";<ms>"},
  "mediaGenerationContext": {"batchId":"<uuid>","audioFailurePreference":"BLOCK_SILENCED_VIDEOS"},
  "useV2ModelConfig": true,
  "requests": [{
    "aspectRatio": "VIDEO_ASPECT_RATIO_LANDSCAPE",
    "metadata": {"collectionId":"","mediaIdSeed":"<uuid>","sceneId":"","workflowIdSeed":"<uuid>"},
    "outputSpec": {"resolution":"VIDEO_RESOLUTION_720P"},
    "promptExpansionInput": {"prompt":"","seed":0,"templateId":"","videoInputs":[]},
    "seed": 424242,
    "startImage": {"aspectRatio":"IMAGE_ASPECT_RATIO_SQUARE","mediaId":"<上传 mediaId>"},
    "endImage":   {"aspectRatio":"IMAGE_ASPECT_RATIO_SQUARE","mediaId":"<上传 mediaId2>"},
    "textInput": {"expandedPrompt":"","prompt":"<提示词>","structuredPrompt":{"parts":[{"text":"<提示词>"}]}},
    "videoModelKey": "abra_i2v_4s"
  }]
}
```
- `startImage`/`endImage`(Zod 类型 VideoGenerationImageInput):`{aspectRatio?, cropCoordinates?, imageUsageType?, isUserUploadedImage?, mediaId | imageBytes}` —— **mediaId 与 imageBytes 是 oneof `source`,同发 400**;`imageUsageType` 可省(字段名 startImage/endImage 已表达用途;`IMAGE_USAGE_TYPE_START_IMAGE` 值反而不在该 proto 枚举里,别发)。
- 响应同 §2.5:`{remainingCredits, workflows[], media[{name=mediaId, mediaStatus:SCHEDULED, ...}]}`(响应侧才有 videoModelControlInput)。

### 7.4 reCAPTCHA action 终局(✅ live)

- `IMAGE_GENERATION`(生图,含带图)✓;`VIDEO_GENERATION`(视频,含 i2v/首尾帧)✓ 双 200 实证 —— §6 的"推断"升级为实证。
- 上传 `/v1/flow/uploadImage` **不需要** recaptcha token。
- **token 单次有效**:同一 token 复用第二个请求 → 403 "reCAPTCHA evaluation failed"(实测)。每次提交现取。

### 7.5 枚举真值(string table 逐字)

- `VIDEO_GENERATION_MODE_{UNSPECIFIED,TEXT_TO_VIDEO,IMAGE_TO_VIDEO,REFERENCE_TO_VIDEO,VIDEO_TO_VIDEO,VIDEO_EXTENSION,EDIT_VIDEO}`(v2 请求已不需要该字段——videoModelKey 已编码模式)
- `IMAGE_USAGE_TYPE_{UNSPECIFIED,START_IMAGE,END_IMAGE,REFERENCE_IMAGE,STYLE_IMAGE,MASK_IMAGE,ASSET_IMAGE,...}`(⚠️ 视频侧 imageInput 的 proto 枚举不含 IMAGE_USAGE_TYPE_* 前缀值,省略即可)
- `IMAGE_INPUT_TYPE_{UNKNOWN,REFERENCE,BASE_IMAGE}`(生图 imageInputs 用)
- `MEDIA_TYPE_{UNSPECIFIED,UNKNOWN,IMAGE,VIDEO,COLLECTION,SCENE}`
- 视频 usage key 的 `requirements[]`(动态目录,实测):i2v=`VIDEO_REQUIREMENT_START_IMAGE`;interpolation/_fl=`START_IMAGE+END_IMAGE`;r2v=`REFERENCES`;extension=`VIDEO_EXTENSION`;edit=`VIDEO_EDIT`+REFERENCES+…

### 7.6 其他发现

- 图片放大独立端点:`POST /v1/flow/upsampleImage`(string table);视频素材上传走 labs.google 相对路径 `/api/upload-video?action=start|upload|query`(scotty 分片,非 aisandbox)。
- `cropCoordinates` 上传必填(可 `{}`)。
- 生图 400 无 fieldViolations 细节(generic "Request contains an invalid argument"),视频 400 有完整 fieldViolations —— 调试优先用视频端点探针。
- 客户端完整请求 schema 全部在 `_app-cf6a7aa328e163a1.js`(Zod,字段名=wire 字段名)。


## 8. 页面全能力普查 wire 补遗(2026-08-23,A 子任务;积分 918→918 零消耗)

> 方法:fetch 包装器页面级注入(捕获 tRPC/aisandbox 全部请求体)+ UI 真实鼠标操作 + bundle 字符串表解码(_app-cf6a7aa3 段内 `function a1_0x4290`..`a1_0x13e1` 大括号平衡切片后 new Function eval,10055 条)。61 张截图存 /tmp/survey/。

### 8.1 实体(角色/集合)链路 ✅ live
- **建**:tRPC `flow.createEntity` POST `{json:{projectId, collectionId:null}}` → 返回 entityId(角色容器;集合传 collectionId?)。
- **改**:aisandbox `PATCH /v1/flow/entities` body `{entity:{projectId, entityId, entityInfo:{...}}, updateMask:"entityInfo.displayName,entityInfo.characterInfo.audioReferences,..."}`(updateMask 式)。
- **entityInfo wire**(角色):`{entityType:"CHARACTER", displayName, characterInfo:{imageReferences:[{workflowId}], audioReferences:[{presetVoiceId:"charon"}]}}` —— 语音=audioReferences.presetVoiceId。
- 角色生图走 §2.4 batchGenerateImages 同端点(推測 requests[0].metadata.collectionId=entityId 待验证);创建实体+生图全程 0 点。
- 角色详情页能力:收藏/删除/重命名/历史/**选择语音(30 预设)**/播放音频/移除语音/角色信息(Agent 用)/重新生成/重试/**制作身体(make body)**/纵向横向。

### 8.2 场景链路 ✅ live(0 点)
- 建:`POST /v1/flow/projects/<pid>/scenes` body `{"workflowIds":[]}` → sceneId。
- 读:`GET /v1/flow/scene/<sceneId>/workflows`。
- 场景编辑器(URL /project/<pid>/scene/<sceneId>):时间线+片段+播放控制+声音+16:9+缩放+**添加片段**;字符串表另有 `/v1/flow/scene/sceneWorkflows:update`、`/v1/flow/scene:copyScene`。

### 8.3 分享 ✅ live 重放
- tRPC `flow.share.shareMedia` POST `{json:{mediaId, includePrompt:true, inputMediaIds:[..], inputEntityIds:[]}}`(inputEntityIds 必须[],null 会 400 zod)→ `{result:{mediaShareId:"<uuid>"}}`。UI 另有"包含输入内容"开关。

### 8.4 智能体(Creation Agent)✅ live(纯文本 0 点,积分未动)
- `POST /v1/flowCreationAgent/sessions`(建会话)/ `GET /v1/flowCreationAgent/sessions?projectId=`(列会话)/ **`POST /v1/flowCreationAgent:streamChat`**(流式对话,SSE)。
- `PATCH /v1/projects/<pid>/agentInfo`:智能体设置持久化,已见 body `{projectBrief:{cards:[{id,title,description,enabled}]}}`(=智能体指令库)与 `{chatPanelOpen:bool}`;projectInitialData 顶层 `agentInfo{defaultGenerationSettings{imageDefaults,videoDefaults},agentToggleState}`。
- Agent 自述能力:图像生成/图像编辑/T2V/I2V/R2V(含音频参考)/V2V 编辑(Omni Flash)/剧本/分镜/提示词/角色世界观/**资产检索/收藏夹整理/媒体重命名删除**/功能问答/更新日志。UI:历史记录+新建会话+停止+清除提示;消息反馈 thumb_up/down/copy/flag。

### 8.5 项目级 ✅ live
- 建:tRPC `project.createProject`(§2.7 已有);**删:确认弹窗后 tRPC `project.deleteProject` `{json:{projectToDeleteId:"<pid>"}}`**(永久删除,实测清掉临时项目)。
- 首页卡片:行内重命名(input+保存/取消);项目内 more_vert:重命名/查看回收站/删除。
- `project.searchUserProjects` GET `{json:{pageSize:20, toolName:"PINHOLE", cursor:null}}`(首页项目列表/搜索)。项目内媒体搜索=客户端过滤(无 wire)。

### 8.6 设置/账号
- tRPC `videoFx.updateUserSettings` 已见 keys:`isEditHistoryVisible`(history 面板开关)、`shouldClearPromptBoxOnSubmit`;面板项:视图模式(网格/批量 campaign_all)、网格大小 S/M/L、悬停播放声音、返回无声视频、显示功能块详细信息、提交后清除提示。
- 账号面板(更多→):积分显示/获取 AI 点数/管理会员资格/退出/**frame_spark 可见水印开关**/隐私·条款·许可/构建版本号。

### 8.7 字符串表新端点全表(未 live 验证,wire 名实证)
`/v1/flow:batchDeleteAssets`、`/v1/flow:copyWorkflow`、`/v1/flow:copyProjectMedia`、`/v1/flow/scene:copyScene`、`/v1/flow/entities:copyEntity`、`/v1/flowMedia:cancelGeneration`、`/v1/flowCollections/`(集合 REST)、`/v1/flow/likeness:checkEligibility`(数字形象 likeness,含 likenessIds/imageGenerationLikenessInputs/videoGenerationLikenessInputs/avatar 注册 dialog)、`/v1/flow/userSettings`、`/v1/flow/appConfig`、`/v1/flow/models/statuses`、视频上传 `/api/upload-video?action=start|upload|query`(scotty)、applet 全家桶 `/v1/flowAppletAgent:{favorite,unfavorite,copy,revertAppletVersion,submitAppletReview,saveSharedApplet,deleteSavedSharedApplet}Applet*` + `/v1/flowAppletAgent/{applets,savedSharedApplets,sharedApplets/}`、视频端点族 §7.3 全证实(含 ObjectInsertion/ObjectRemoval)。
隐藏能力键:reshoot 15 种运镜预设(dolly_in/out、orbit_down/right、stationary_closer/further/higher/lower/right、wider_shot、higher_angle…)、prompt 占位符 drawing/**insert_into_video**/**mask**/**reframe**、GIF 生成、speech_edit、scenebuilder tab、日模型配额、`:rename`(flowMedia/:rename 推测)、Custom Voice(可删除voice 字符串)。

### 8.8 30 预设语音(projectInitialData projectContents.externalReferenceMedia,AUDIO 型)
achernar(女·soft·high)/achird/algenib/algieba/alnilam/aoede/autonoe/callirrhoe/charon/despina/enceladus/erinome/fenrir/gacrux/iapetus/kore/laomedeia/leda/orus/puck/pulcherrima/rasalgethi/sadachbia/sadaltager/schedar/sulafat/umbriel/vindemiatrix/zephyr/zubenelgenubi。每条 `media.audio.generatedAudio={name, description("Female, soft, high pitch"), isPresetAudioSample:true, audioSamplePath:gstatic.com/aitestkitchen/voices/samples/<Name>.wav}`。

## 9. D 轮对抗复审 wire 实证(2026-08-23,全部 0 积分假 key 404/400 探针;积分 918→918)

> 方法同 §7(假 videoModelKey → 形状过验证即 404,零调度);字段名筛(field-name sieve:一次并发多候选,Unknown name 逐个点名,未点名的即真实字段)。**🔴 reCAPTCHA 风险引擎限速**:短时间连续多次 probe 后 403 `PUBLIC_ERROR_UNUSUAL_ACTIVITY`(即使 action 正确)——probe 须 pacing(间隔数秒),或残余字段转 bundle Zod 定型。

### 9.1 视频超分请求形状 ✅(修正 §7.3 表行)
`batchAsyncGenerateVideoUpsampleVideo` requests[0] = **`{aspectRatio(必填), metadata, seed, videoInput:{mediaId}, videoModelKey}`**。
- 🔴 证伪 §7.3 的 `outputSpec.videoUpsampleResolution`:outputSpec 与 textInput 均 Unknown name;videoUpsampleResolution 直接放 request 也 Unknown——**目标分辨率编码在 key 本身**(`veo_3_1_upsampler_1080p`,目录另仅 4k)。
- 缺 aspectRatio → generic 400(必填);带齐 → 404 形状通过。
- `veo_3_1_upsampler_4k`:INTERMEDIATE tier **UNAVAILABLE**(ADVANCED 50 点)→ 本 tier 只做 1080p。

### 9.2 extension 请求形状 ✅ + scotty 前置证伪
`batchAsyncGenerateVideoExtendVideo` requests[0] = `{aspectRatio, metadata, promptExpansionInput, seed, textInput, videoInput:{mediaId}, videoModelKey}`(无 outputSpec)。
- **`videoInput:{mediaId}` 被 upsampler/extension 双双接受** → 引用既有生成视频即可,**scotty 分片上传不是 extension/upsample 的前置**(仅外部用户本地视频输入才需要)。

### 9.3 r2v 形状终验 + 音频参考证伪
- `batchAsyncGenerateVideoReferenceImages` 全形状 404 ✓:**`referenceImages:[{aspectRatio, mediaId}]` entry 形状实证**(§7.3 只验了顶层的补齐)。
- `audioInput` / `audioReferences` 均 Unknown name → **v2 wire 无音频参考字段**;§8.4 Agent 自述"R2V 含音频参考"不走该 wire(Agent 路径私有,维持红线 skip)。【🔴 后被 §14.1/§14.6 修正:真实字段名是 `referenceAudio`(entry={mediaId})——探针证伪的只是 audioInput/audioReferences 两个候选名,不是音频能力本身】

### 9.4 batchDeleteAssets 字段名 ✅
`POST /v1/flow:batchDeleteAssets` body 含 **`mediaIds`(数组)**;假 id → 404(形状验证通过且零删除)。

### 9.5 upsampleImage(修正 §7.6"生图系 400 无 fieldViolations")
- 🔴 **"action=IMAGE_UPSAMPLING 可过 gate" 已被 §10.8 证伪**:D 轮探针带错误 action 的 token 仍得到 400 fieldViolations,说明**形状校验先于 reCAPTCHA 终评**("无 token → 早 403"或仍成立,但错误 action 的 token 能走到形状校验、在真实提交时才被 reCAPTCHA 拒 403)。推论:**400/404 探针永远无法验证 action 语义 —— action 只能用 §10.8 的 UI 拦截法实证。**
- 过形状校验后 **有** fieldViolations 明细(Unknown name 逐个点名)——"generic 400"仅 batchGenerateImages 一家,upsampleImage 可探。
- 已实证 body:`{clientContext, mediaId}`(两者接受);证伪字段:requests/imageInputs/imageInput/image/inputImage/mediaGenerationContext/useNewMedia/imageModelName/model/modelKey/imageModelKey/upsampleModelName/upsampleConfig/resolution/outputSize/sizeScale/sourceMediaId/seed → **无模型选择字段**(推测固定 GEM_PIX_2_UPSAMPLE_2K);残余 1-2 字段待 paced probe 或 bundle Zod 收尾。

### 9.6 实体链路三连证伪(§8.1 降级)
1. `flow.createEntity {collectionId:null}` → zod 400 "Expected string, received null"(§8.1 的 live 记录不可复现,collectionId 必须是真实字符串 → 先有 collection)。
2. `batchGenerateImages` requests[0] **无 metadata 字段**(Unknown name)→ "collectionId 联动生图"捷径证伪;实体挂图只能是客户端编排(生图 → PATCH entityInfo.imageReferences=[{workflowId}],此路径未端到端验证)。
3. `projectContents` 键 = workflows/media/externalReferenceMedia/scenes/agentInfo——**无 entities/collections 读面**;`/v1/flowCollections/` 根 GET 页面上下文 CORS 拒绝 → 实体读侧还需另行逆向。
→ 结论(当轮):entities 是多段未验证 wire 的 M+ 级工程,当前轮次 skip。【E-parity 轮解除:collectionId 空串可过(§11.4),实体三件套 createEntity/PATCH/语音绑定已全 live,读侧退化本地镜像;见 §11.4/§11.5】

### 9.7 台账
§7 结余 894 → 2026-08-23 回升至 **918**(订阅续期/退款);本轮全部 probe 零积分。项目现存 30 media(25 图/5 视频,0 in-flight),projectContents 载荷 46KB——永久复用项目下随 media 线性膨胀,删除能力是 flow_status 轮询卫生前提(非伪需求)。

## 10. E 轮实施期 wire 实证(2026-08-23,实施 + live 验证;方法:bundle Zod 明文 key 检索 + 真实 provider 代码路径提交)

### 10.1 upsampleImage 全 schema 定型(关闭 §9.5 "残余 1-2 字段" 遗留)

> 方法升级:**不再需要 paced probe** —— `_app-cf6a7aa328e163a1.js` 的 Zod schema 对象 key 是明文(混淆只加密 string 值,不加密属性名)。检索 `clientContext...mediaId` 邻接即得完整 schema(比 404 探针更快且零请求、零 reCAPTCHA 风险)。

```json
POST /v1/flow/upsampleImage
{
  "clientContext": {"recaptchaContext":{...action IMAGE_UPSAMPLING...}, "projectId", "tool":"PINHOLE", "sessionId":";<ms>"},
  "mediaId": "<源图 mediaId>",
  "requestContext": {},        // 客户端 Zod 要求 {appletAgentInfo, featureContext, flowSdkInfo, geminiAgentInfo(+flowCloudTierRequestContext?)};服务端 proto 接受空对象
  "targetResolution": "UPSAMPLE_IMAGE_RESOLUTION_2K"
}
```
- `targetResolution` 枚举(string table 逐字):**UPSAMPLE_IMAGE_RESOLUTION_{UNSPECIFIED, 2K, 4K}**(4K 需 ADVANCED tier;此前"无模型选择字段"的推断修正为:模型固定 GEM_PIX_2_UPSAMPLE_2K,选择维度是分辨率)。
- §9.5 证伪表全部成立:无 imageModelName/mediaGenerationContext 等字段。
- 相邻 schema 同法可得:`{mediaId, model, prompt, voiceConfigs}`(TTS 系)、`{clientContext, promptData, requestContext}`(Agent 系)。

### 10.2 视频 extension/upsampler 请求体(实现采用 §9.1/§9.2 字段集)

- extension requests[0] = `{aspectRatio, metadata, promptExpansionInput, seed, textInput, videoInput:{mediaId}, videoModelKey}`(**无 outputSpec**,§9.2)。
- upsampler requests[0] = `{aspectRatio, metadata, seed, videoInput:{mediaId}, videoModelKey}`(无 textInput/outputSpec/promptExpansionInput,§9.1;目标分辨率编码在 key)。
- aspectRatio 必填:实现按源视频 `video.generatedVideo.aspectRatio` 原文继承(响应侧回读完整枚举),缺失时默认 VIDEO_ASPECT_RATIO_LANDSCAPE。
- r2v 保留 §7.3 全量字段集(outputSpec/textInput/promptExpansionInput)+ referenceImages。

### 10.3 batchDeleteAssets(E 轮 live)

- body `{mediaIds: [...]}`;无 clientContext 亦被服务端接受(D 轮 §9.4 探针 + E 轮真实删除双验证)。
- 删除即时生效(projectInitialData 复查 media 列表即消失);7 个 D 轮 probe 上传残留一次清空(30→23 media,projectContents 载荷线性回落)。
- 上传型媒体(无 mediaGenerationStatus、无 generatedImage/Video)同样可删。

### 10.4 reCAPTCHA 风险引擎限速实证(§9 前言升级)

- 触发后冷却期远超"数秒":**程序化 UI 自动化(快速连续 Page.navigate + Input.dispatchMouseEvent 机枪点击)会把账号级 reCAPTCHA 评分打热,403 PUBLIC_ERROR_UNUSUAL_ACTIVITY 持续 >15 分钟**(期间 GET 端点不受影响,只有 reCAPTCHA-gated POST 被拒)。
- **E 轮补充(2026-08-23)→ 🔴 后被 §10.8 修正**:extension 提交后 ~1/~4/~10 分钟三次 upsampleImage 连续 403 PUBLIC_ERROR_UNUSUAL_ACTIVITY,当时归因"账号级评分偏热需 ≥10 分钟 pacing"——**该归因是错的**:同期普通生图(IMAGE_GENERATION action)双 200,证明账号不热;真因是 upsample 用错了 action(IMAGE_UPSAMPLING)。修正后的工程结论:
  - 403 "reCAPTCHA evaluation failed" **既可能是评分偏热(§9 前言的 UI 机枪场景,真实存在),也可能是 action 字符串错误 —— 两因同症,先用「同期换一个已知可过的 action 打一发 0 点端点」区分,再决定等待还是回查 wire**;
  - UI 机枪热度场景的 >15 分钟冷却结论(本节第一条)仍然成立,不受修正影响。
- 工程结论:**live 驱动一律走 provider 代码路径的单次提交(一次 navigate + 一次 submit),杜绝 UI 自动化机枪操作**;probe 优先 bundle Zod 明文 key 检索(零请求),404 探针只作补充;action 语义存疑时优先「拦截真实 UI 单次触发」直接捕获(§10.8 方法,一次点击零风险),不靠 bundle 上下文推断。

### 10.5 状态机补遗

- "无 mediaGenerationStatus 且无 generatedImage/Video" 的媒体 = 上传后从未生成(probe 上传残留),mapMediaStatus 归为 failed 是既有预答行为的正确覆盖;真正的 MEDIA_GENERATION_STATUS_FAILED 枚举仍未观察(遗留-低,维持 §5)。

### 10.6 extension 全链路 live ✅(E 轮收尾,2026-08-23;积分台账 911→901,-10)

- **提交**:`veo_3_1_extension_lite` + videoInput:{mediaId=60679485…(abra_t2v_8s 既有视频)} + prompt,provider 代码路径一次 200。响应侧回读 `videoGenerationMode: VIDEO_GENERATION_MODE_VIDEO_EXTENSION`、`videoModelCapabilities: [VIDEO_MODEL_CAPABILITY_EXTEND]`、`videoResolution: VIDEO_RESOLUTION_720P` —— §9.2 请求形状(无 outputSpec、aspectRatio 按源继承 LANDSCAPE)终验通过。
- **状态机**:提交后先 SCHEDULED,轮询间隔 ~2 分钟捕获 `MEDIA_GENERATION_STATUS_ACTIVE`(in_progress),最终 `SUCCESSFUL` —— SCHEDULED→ACTIVE→SUCCESSFUL 全转移 live 实证(mapMediaStatus 三枚举归 in_progress 的修复零误判)。
- **下载**:getMediaBytes 直取 2,508,689 bytes video/mp4(ISO Base Media)—— extend 出的是完整可播放视频。
- 积分台账(E 轮全程):918 →911(r2v abra_r2v_4s,-7,§7)→901(extension,-10,本节)= 2 次付费提交 17 点,预算内(≤5 次/≤50 点);视频超分 1080p/删除/状态查询 0 点。

### 10.7 视频超分 1080p live ✅(E 轮,2026-08-23 11:39Z;0 点确认)

- **提交**:`veo_3_1_upsampler_1080p` + videoInput:{mediaId=60679485…(abra_t2v_8s 源视频)},provider 代码路径 200;积分全程未动(901 之前与之后余额一致)—— 目录标注 0 点实证。
- **输出命名 wire 事实**:超分产物 mediaId = `<源 mediaId>_upsampled`(服务端对派生媒体用源 id + 后缀命名,非全新 UUID);响应侧 seed=0(超分无 seed 语义)。
- **状态机**:`MEDIA_GENERATION_STATUS_PENDING` 在本 run 首次 live 观察(提交后排队处理前的中间态,旧版会误判 failed —— 修复回归测试 §18 的实证来源);终态 SUCCESSFUL。
- 4k 档(`veo_3_1_upsampler_4k`)在 INTERMEDIATE tier UNAVAILABLE(ADVANCED 50 点,D 轮目录快照)—— 只开 1080p。

### 10.8 2K 图片放大 live ✅ + IMAGE_UPSAMPLING action 证伪(2026-08-23 E 轮收尾;全程 0 点)

- **排障链(403 同症两因的现场教学)**:extension 提交后三次 upsampleImage 连 403 PUBLIC_ERROR_UNUSUAL_ACTIVITY(~1/~4/~10 分钟间隔),先按 §10.4 归因账号热度 → **对照实验推翻**:同期普通生图(IMAGE_GENERATION)双 200,账号不热 → 锁定 action 字符串。
- **拦截法(新工具,零请求零风险,优先于 bundle 推断)**:页面上下文 patch `grecaptcha.enterprise.execute`(透传 + 记录 siteKey/action)与 `fetch`(记录 upsampleImage 请求体),再**真实 UI 单次触发**(图片 → download 菜单 → 2K;CDP Input.dispatchMouseEvent 真鼠标序列,一次点击不算机枪)→ 捕获:**action = `IMAGE_GENERATION`**,site key 与生图同一把;请求体 `{mediaId, targetResolution:"UPSAMPLE_IMAGE_RESOLUTION_2K", clientContext:{recaptchaContext:{token,...}}}`。
- **修复 + live 验证**:provider action 改 IMAGE_GENERATION 后,代码路径连续两次 2K 放大 200:输出 **2048x2048 JPEG**(~2MB,带 Google C2PA Media Provenance 证书字节),产物入库为派生 media(新 mediaId,继承源图 prompt);**积分 901→901 恒定(0 点确认,含 UI 触发那次共 3 次成功)**。
- **对既有记录的三处修正**:§6 action 表(IMAGE_UPSAMPLING 是 D 轮误判,bundle 中该字符串仅作 OUT_OF_CREDITS 错误类目键);§9.5 "可过 gate"(形状校验先于 reCAPTCHA 终评,探针法永远验不了 action);§10.4 E 轮补充(403 归因热度是错的,pacing 不是解药,action 才是)。
- 经验沉淀:**action 语义 = 运行时拦截 > 调用点明文 > 同族命名推断(bundle 上下文推断最弱)**;UI 下载菜单实测入口:资产 edit 视图顶栏 download → 1K(原始)/2K/4K(已完成态标"已完成高清重塑";URL `/edit/<内部id>` 的 id ≠ mediaId)。

### 10.9 缩略图下载字节形态勘误(F 轮,2026-08-23;经 dist provider 代码路径零积分实证)

- **wire 事实**:`flow_status(mediaId, thumbnail=true)` 对已完成视频(1c1f6235…,mediaBlobSize=2,508,689B)拉取 `getMediaUrlRedirect?mediaUrlType=MEDIA_URL_TYPE_THUMBNAIL` → **43,007B raw JPEG**(FF D8 开头,content-type image/jpeg)—— §2.6 旧记录 "base64 文本" 勘误为 raw 字节流。
- **工程推论(已修)**:缩略图是服务端另行生成的 JPEG,字节数与本资产 mediaBlobSize 本就不同 → 工具层字节完整性闸门(audit finding-18)只对**原始资产**下载生效;旧版不区分分支,已完成视频取缩略图 100% 误报 `[flow] S402 下载不完整`。
- **派生 mediaId 命名回顾(§10.7 补充适用面)**:超分产物 `<源id>_upsampled` 非 UUID 形状 → 工具层对放大链式引用的 mediaId 形状校验须放宽为「UUID 或 UUID 派生名」,存在性/类型校验交给 provider findMedia 的结构化 S400/S301。

## 11. E-parity 轮 wire 实证(2026-08-23,分享/取消/edit/实体;方法:bundle Zod 明文 key + 字符串表解码(§10.1 升级:shuffle IIFE + string-aware 括号平衡切片)+ 页面上下文 live;积分 901→901 零消耗)

### 11.1 V2V edit 请求形状 ✅(bundle Zod + 假 key 404 探针双定型;live 未验证)

- **端点**:`POST /v1/video:batchAsyncGenerateVideoEditVideo`(端点族 §7.3 表内)。
- **顶层构造器明文(bundle 提交函数逐字)**:`{mediaGenerationContext:{batchId,…extra}, clientContext:{…,recaptchaContext}, requests:[item], ...('batchAsyncGenerateVideoEditVideo'!==apiPathname && {useV2ModelConfig:true})}` —— **edit 是唯一不带 useV2ModelConfig 的端点**(§7.3 表的推断升级为构造器明文实证)。
- **item schema(bundle Zod `_0x457c52`,全字段 optional)**:`{aspectRatio, metadata, outputSpec, referenceAudio, referenceEntities, referenceImages, referenceLikenesses, requestContext, seed, structuredPrompt, textInput, videoInput, videoModelKey}` —— **无 promptExpansionInput**(与 extension 的关键差异);实现采用 `{aspectRatio(源继承), metadata, seed, textInput, videoInput:{mediaId}, videoModelKey}`。
- **假 key 探针**:`videoModelKey:"abra_edit_fake_nonexistent_key"` + 真实源 videoInput → **404 NOT_FOUND**(形状全过、零调度、零积分)。🔴 真实付费提交(abra_edit 20 点)未做 —— 工具提交响应固定带警示(EDIT_WIRE_WARNING),live 待用户授权。〔后被 §15 修正:2026-08-27 live 提交成功(-20 点),EDIT_WIRE_WARNING 已删除〕
- reCAPTCHA action:VIDEO_GENERATION(同族端点共用,§7.4)。

### 11.2 分享 shareMedia ✅(live 200;0 点)

- **请求**:tRPC `flow.share.shareMedia` POST `{json:{mediaId, includePrompt:true, inputMediaIds:[], inputEntityIds:[]}}`(inputEntityIds 必须 `[]`,null → zod 400,§8.3 铁律复验)。
- **响应**:`{result:{data:{json:{result:{mediaShareId:"<uuid>"}, status:200}}}}`(tRPC 三层嵌套,比 §8.3 记录的浅层多两层)。
- **分享 URL 模板(bundle 字符串表解码 0x2828/0xad1/0xb06)**:`https://labs.google/fx/tools/flow/shared/{image|video}/<mediaShareId>`(image/video 按媒体 kind;`/fx` 前缀 + shareMediaType 段)。provider 代码路径 live 复验:已完成图片 → `…/shared/image/d55527f0-…` 200。

### 11.3 取消生成 cancelGeneration(🔴 形状定型 + 适用面 live 边界;E2E 视频取消未验证)

- **wire(bundle 提交函数明文)**:`POST https://aisandbox-pa.googleapis.com/v1/flowMedia:cancelGeneration` Bearer body **`{mediaId: <提交响应 media.name>}`**(单值非数组);客户端调用方 = VideoService 的 processingRequests 队列(传提交响应的 media.name)。
- **假 id 404 探针** ✓(形状过、零副作用);**枚举**:`MEDIA_GENERATION_STATUS_CANCELED`(字符串表 0x126a)+ `PUBLIC_ERROR_MEDIA_GENERATION_CANNOT_BE_CANCELED`(0x11ce)—— mapMediaStatus 已补 CANCELED → failed 终态。
- **🔴 图片不可取消(live 实证)**:对真实 in-flight 的**图片** mediaId(提交 200 后立即取消)→ **404 "Requested entity was not found"** —— cancelable registry 只登记视频生成(bundle 调用方只有 VideoService 与此一致)。
- **未验证(待授权)**:视频 in-flight 的 E2E 取消(需 ≥7 点提交,本轮零积分纪律不做)。
- **🔴 读侧可见性(live)**:同一 GET `flow.projectInitialData?input={projectId}` URL 疑似被 HTTP 缓存 —— 提交后 42s 内轮询(3s 间隔)始终看不到 in_flight 条目,但生成照常完成;意味着「读侧等 in-flight 出现再取消」的编排对快生成(图片)不可行。视频生成 ~2min,窗口远大于缓存 TTL(E 轮 extension 轮询成功佐证)。

### 11.4 实体 createEntity ✓(live 200;collectionId 空串 —— §9.6 阻塞解除;0 点)

- `tRPC flow.createEntity` POST `{json:{projectId, collectionId:""}}` → **200** `{result:{data:{json:{projectId, entityId, entityInfo:{entityType:"CHARACTER", displayName:"Untitled Character", characterInfo:{}}, createTime, updateTime}}}}`。
- 🔴 **§9.6 修正**:zod 只拒 `null`("Expected string, received null");**空串 "" 直接建实体,无需先建 collection** → 集合 wire(/v1/flowCollections/)依赖蒸发,不实施。
- **projectContents 顶层键(live 复核)**:`projectName/projectId/projectContents/modelConfig/appConfig/userData/agentInfo`;projectContents 键 = `workflows/media/externalReferenceMedia/scenes/agentInfo` —— 确认无 entities 读面,本地镜像(~/.media-gen-mcp/flow-entities.json)是唯一读侧。
- **workflows 映射**:`workflows[].{name, metadata.primaryMediaId}` —— imageMediaIds → imageReferences 用的 workflowId 经此映射(live:workflow 0976f24a ↔ media 0aa9c5ea)。

### 11.5 实体 PATCH ✓(live 200;0 点;无需 reCAPTCHA)

- `PATCH /v1/flow/entities` Bearer body `{entity:{projectId, entityId, entityInfo:{entityType:"CHARACTER", displayName, characterInfo:{audioReferences:[{presetVoiceId}], imageReferences:[{workflowId}]}}}, updateMask:"entityInfo.displayName,entityInfo.characterInfo.audioReferences,…"}`。〔imageReferences 路径后被 §13.1 修正:服务端 400 拒绝,仅 displayName/audioReferences 可 PATCH〕
- **updateMask 语义(live)**:mask 外字段被服务端忽略(发 imageReferences 但 mask 不含 → 响应无该字段、不落库)—— 增量更新只 PATCH 变更字段。
- entry schema(bundle Zod):audioReference = `{presetVoiceId?, workflowId?}`;imageReference = `{workflowId?}`。
- provider 代码路径 live 全链:建(默认名)→ PATCH 改名+绑 charon → 再 PATCH 只改 displayName(mask 单字段)→ 镜像落盘,全程积分 901 恒定。

### 11.6 30 预设语音路径纠偏(§8.8 补充;live)

- externalReferenceMedia 条目形状:`{mediaId:"achernar", mediaType:"AUDIO", workflowDisplayName:"Achernar", media:{name, audio:{generatedAudio:{name, description, isPresetAudioSample:true, audioSamplePath}}}}` —— **audio 嵌在 entry.media 下**(§8.8 未记录层级);30 条恒在(live 复核),已折入 flow_status `preset_voices` 段 + flow_entity(action=voices)〔后者已随工具移除,§13.5;voices 现仅经 flow_status 快照〕。

### 11.7 字符串表解码方法沉淀(§10.1 的工程化补全)

- `a1_0x4290` 数组抽取须 **string-aware 括号平衡**(朴素计数会被 CSS/正则字符串内的花括号破坏;正确切片 ~1.4MB,尾部 `return a1_0x4290();}`)。
- 解码前必须先跑 **shuffle IIFE**(`(function(_0x1b8ff4,_0x104e7c){…rotate…})(a1_0x4290,0x767d6)`;校验和循环 shift/push 直至平衡)—— 不跑则全部索引错位(症状:解码值风马牛不相及)。
- 关键索引:0x2425=aisandbox 根 URL / 0x1de3=cancelGeneration 端点 / 0x2828=`/tools/flow/shared/` / 0xad1=`image` / 0xb06=`video`(share URL 模板)/ 0x126a=CANCELED / 0x11ce=CANNOT_BE_CANCELED。

## 12. 文档维护与归档(2026-08-26 补)

- **活性契约**:本文档是 Flow wire 真相的唯一活性来源。新 wire 发现**追加新节**(§N+1),不追写进已定型的节;对既有结论的修正沿用先例格式「原结论 → 后被 §N.x 修正」(见 §10.4 action 误用归因的自我修正),已 live 验证的历史不删改。
- **积分台账纪律(不变)**:每次 live 提交在对应节记录台账(如 §7 918→894、§10.6 911→901、§11 901→901);调研性探针默认零积分——优先 bundle Zod 明文 key 检索(§10.1,零请求),404 探针只作补充;严禁程序化 UI 机枪操作(§10.4 reCAPTCHA 打热 >15 分钟教训)。
- **代码锚点**:provider 实现 `src/providers/flow.ts`(确认门 `beginSubmissionConfirm` §计费确认门;渠道启停 = 优先级链,S000 硬门已于 2026-08-26 删除);工具面 `generate_image`/`create_video`(`provider=flow`)+ `flow_status`(自省/下载/删除/分享/取消;flow_entity 已按用户裁决移除 2026-08-26,存档 §13);测试 `dist-test/flow*.test.js` + `test/flow-*.integration.test.mjs`(confirmToken 单次消费 = faaeead)。
- **历史归档**:pares0-14 各阶段实施/调研文档(含本项目 Flow 之前的全部实施方案)已于 2026-08-26 全量归档至仓库 `.doc-archive-snapshot/`(128 文件,PROVENANCE.md 记录萃取去向);渠道扩张全景与判据见 `doc/Provider扩张路线图.md`,渠道治理规则见 `doc/架构要求清单.md` §11 ADR-2。

## 13. 角色域存档:移除裁决 + 终局 wire 实证(2026-08-26;积分 1050→1050,全部 0 消耗)

> **用户裁决(2026-08-26)**:生图只需"上传参考图 + 描述引用参考图"(= `generate_image(provider=flow)` 的 images 底图+参考图,§7.2 已 live);**Google Flow 的场景与角色域不用** → `flow_entity` 工具(第 24 工具)整体移除(24→23)。本节存档全部调研成果,凭此 30 分钟可恢复。

### 13.1 imageReferences PATCH 被服务端拒绝(修正 §8/§11.5 的"可 PATCH"结论)

- **原结论(§8.1/§11.5)**:`PATCH /v1/flow/entities` + updateMask `entityInfo.characterInfo.imageReferences` 可绑形象图("live 定型")。
- **后被本节修正**:该路径**从未 live 验证过带 imageReferences 的提交**(E 轮实体仅 displayName+audio)。2026-08-26 六变体全量实测(displayName-only 200 ✓ / audio-only 200 ✓ 对照组):imageReferences 裸 workflowId、`workflows/` 前缀、单 mask、`entityInfo.characterInfo` 整 mask、query 参数 `?updateMask=`、与 audioReferences 联合 mask —— **全部 HTTP 400 INVALID_ARGUMENT**(无 fieldViolations 细节)。元素 Zod schema 已 bundle 确证就是 `{workflowId}` 单字段,非形状问题;服务端另有绑定路径未逆向(见 13.3)。

### 13.2 生图引用角色(referenceEntities wire,bundle 原文确证)

- **动态目录 requirements 矩阵**(flow_status image_families):三生图模型均支持 `IMAGE_REQUIREMENT_CHARACTERS` 组合(TEXT+REFS+CHARACTERS±BASE_IMAGE)。
- **wire(bundle 客户端构造原文)**:`requests[0].referenceEntities = entityIds.map(x => ({entityId: x}))`;兄弟字段 `referenceLikenesses = [{likenessId}]`(数字形象,另有 `/v1/flow/likeness:checkEligibility`,§9.4)。`IMAGE_INPUT_TYPE_*` 枚举只有 BASE_IMAGE/REFERENCE/UNKNOWN 三种(characters 不走 imageInputs)。
- **live 行为**:裸角色(仅绑语音无形象图)提交 referenceEntities → **HTTP 500 INTERNAL**;空元素 `{}` → 400 PUBLIC_ERROR_UNSAFE_GENERATION。角色必须先有形象图才可被引用 —— 与 13.1 绑定路径被拒互为死锁(工具侧两头断链,即移除的根因)。

### 13.3 UI 绑定路径观察(未捕获,留待恢复时逆向)

角色编辑面板"从项目中添加"点选项目媒体后 UI 即出现 下载图片/删除图片/重新生成 控件,但:① 全量 Network 捕获(无过滤)未见任何实体写请求(疑本地预览态);② 点"完成"后亦零写请求;③"删除图片"按钮时有时无(状态漂移)。真实持久化 mutation 未捕获 —— 恢复角色域时优先做"UI 绑图全程 Network 录制"(建议 DevTools 手动操作一次即可定位端点)。

### 13.4 4K 图片放大(tier 锁,记录不开)

动态目录存在 `GEM_PIX_2_UPSAMPLE_4K`(cost: INTERMEDIATE/ENTRY = **UNAVAILABLE**,ADVANCED = 0)。400 探针显示 `/v1/flow/upsampleImage` 的 4K body 形状与 2K 不同(无 `requests` 字段,完整 fieldViolations 见台账);当前账号(G1_TIER1/INTERMEDIATE)不可用,不实现;升级 tier 后按 §9.5 方法逆向。

### 13.5 移除清单(代码锚点)

工具注册+handler(src/index.ts)、createEntity/updateEntity/patchEntity/resolveWorkflowIds/readEntities/writeEntities/listEntities/FlowEntityRecord/FLOW_ENTITIES_FILE(src/providers/flow.ts)、flow_entity 测试族、README×8、功能清单/测试用例清单/用户场景清单/架构图 manifest。**保留**:listPresetVoices(flow_status 快照 preset_voices 消费)、本地镜像文件 ~/.media-gen-mcp/flow-entities.json(历史数据,无害)。

### 13.6 关联:lasso Chrome idle reaper(外部消费场景)

CLI 拉起 hidden 档 Chrome 供本项目 CDP 直连时,须 `lasso launch-chrome --port 9223 --idle-ms 0`(record 级禁用收割);默认 60s idle 后被 lasso server 常驻 reaper 树杀(详见 lasso 仓库 doc/BUG-chrome-idle-reaper-second-consumer.md)。README 的 `--mode visible` 档天然 kill 豁免,不受影响。

## 14. 视频面板能力普查 wire 补遗(2026-08-27,A 子任务;积分 1050→1050 零消耗)

> 方法:CDP 页面上下文**只读** projectInitialData(×3 次)+ 全量已加载 chunk(14 个,10.4MB,主战 `_app-3a63b3881d4dbe35.js` 5.2MB)明文 Zod key 检索。零提交、零 404/400 探针、零 reCAPTCHA 调用。快照产物:/tmp/flow-survey/flat-usages.json(77 usage 全字段)。

### 14.1 音频能力全景(🔴 修正 §9.3 "v2 wire 无音频参考字段")

- **§9.3 修正**:`audioInput`/`audioReferences` Unknown ≠ 无音频字段 —— 真实字段名是 **`referenceAudio`**(v2 item Zod 明文,多个 item schema 共有:`{…,'outputSpec','referenceAudio':array(entry),'referenceEntities':optional,'referenceImages':optional,…}`);entry = **`{mediaId}`** 单字段(与 referenceImages entry 同构,zod `_0x582858=Ik({'mediaId':…})`)。
- 动态目录 `usages[].inputSpec` = **`{maxAudioReferences, maxCharacters, maxInputV2vVideoDuration}`**(bundle zod 另有 `minInputV2vVideoDuration`,本次快照未取值):abra_r2v_* maxAudioRef=**5**(maxImageInputs=7);abra_edit=**3**(maxImageInputs=5,maxCharacters=3,maxInputV2vVideoDuration=10);veo r2v(lite+fast+low_priority)=**1**(maxImageInputs=3,maxCharacters=3)。abra_edit requirements=`[[TEXT,REFERENCES,AUDIO_REFERENCE,CHARACTERS,VIDEO_EDIT]]`;veo_3_1_r2v_lite requirements 是**多组合矩阵**(`[TEXT,REFERENCES]` / `[TEXT,REFERENCES,AUDIO_REFERENCE,CHARACTERS]` / …—— 音频+角色是可选叠加)。
- `usages[].outputsAudio`:**77/77 全 true**(四家族全部原生出音频)→ 页面模型列表喇叭图标 = 原生音频输出+音频参考支持的**模型能力标识**,不是独立配音入口;响应侧同族标记 `VIDEO_MODEL_CAPABILITY_AUDIO`(§10.6 CAPABILITY_EXTEND 先例)。
- **`audioFailurePreference` 枚举全集(Zod 明文)**:`AUDIO_FAILURE_PREFERENCE_{UNSPECIFIED, BLOCK_SILENCED_VIDEOS, RETURN_SILENCED_VIDEOS}`。客户端构造逐字:`'mediaGenerationContext':{…(模型 outputsAudio)&&{'audioFailurePreference': userShouldReturnSilentVideos ? 'RETURN_SILENCED_VIDEOS' : 'BLOCK_SILENCED_VIDEOS'}, …sceneContext}` —— 仅当模型出音频才发该字段;`shouldReturnSilentVideos` 是 userSettings zod 字段(默认 false;特性门 `appConfig.isReturnSilentVideosEnabled`)。
- 独立配音/TTS 是**另一条 wire**(非本面板):`modelConfig.audioModelKey="gemini_v4s_tts_flow"`(modelConfig 第 5 键);TTS requests = `[{dialog, voicePerformance, modelKey, voiceConfigs:[{speaker, voice}], generationType}]`(§10.1 `{mediaId, model, prompt, voiceConfigs}` 同族);action=AUDIO_GENERATION。
- 音频参考 UI 事实(i18n 明文):"AUDIO INGREDIENTS ARE EXPERIMENTAL"(`pinhole_audio_feature_disclaimer_*`,One Speaker One Image / Match Voice to Visuals)、`pinhole_abra_max_audio_reached`、`pinhole_character_max_audio_reached`、`pinhole_audio_image_mode_not_supported`(图片模式不可用音频)、`pinhole_this_model_cannot_support_audio_reference`(模型不支持禁用态)、`pinhole_audio_failure_{generic,minor}`(安全过滤 `AUDIO_FILTER_MINOR_PRESENCE` 文案)、`pinhole_edit_video_sound_disclaimer`。

### 14.2 x1-x4 = N 次独立 POST(§2.5 升级为构造器级实证)

- 传输函数逐字(明文):`JSON.stringify({'mediaGenerationContext':{'batchId':…,…extra},'clientContext':{…,'recaptchaContext':{'token':await hw(action),'applicationType':'RECAPTCHA_APPLICATION_TYPE_WEB'}},'requests':[item],…('batchAsyncGenerateVideoEditVideo'!==apiPathname && {'useV2ModelConfig':true})})` —— **`requests` 恒为单元素数组字面量 `[item]`**;每次 POST 在提交函数内现取一个 recaptcha token(§7.4 token 单次有效的客户端侧根源)。缺 apiPathname → `"Video generation request is missing apiPathname"`。
- 批量编排(紧邻代码):先 reduce 累计各 item 积分(`X9(modelKey)` 取价)→ `Promise[all/allSettled]` 并发逐条提交;`agentInfo.defaultGenerationSettings.{image,video}Defaults.outputCount`(zod `{aspectRatio, outputCount, videoModelFamilyKey}`,setter `setImage/VideoDefaultOutputCount`)是 x1-x4 的默认值持久化载体。
- 工程结论:provider 单 POST 单 `requests[0]` 与客户端行为一致;xN 由工具层循环 N 次提交实现,**勿构造多元素 requests**(服务端 zod 收 array,但客户端从不发多元素,行为未实证)。

### 14.3 分辨率真值(tier 锁 + 360P 新发现)

- 枚举全集:`VIDEO_RESOLUTION_{UNSPECIFIED, 360P, 720P, 1080P, 4K}`。
- **`modelConfig.tierDefaults`**:`SERVICE_TIER_ENTRY.defaultVideoResolution=VIDEO_RESOLUTION_360P`(**免费档默认 360P,新发现**)/ INTERMEDIATE / ADVANCED = 720P(defaultImageModelFamily: ENTRY=harbor_seal,余 narwhal_display;defaultVideoModelFamily 均 abra)。
- 77 usage 的 supportedResolutions:**75 个生成 usage 全部仅 `["VIDEO_RESOLUTION_720P"]`(ADVANCED 亦然;ultra/quality/_4s/_6s 变体也是 720P)**;唯二例外 = upsampler(1080P / 4K)。生成侧不存在 1080p 选项(任何 tier);1080p 只能超分(`veo_3_1_upsampler_1080p`:ADVANCED/INTERMEDIATE 0 点,**ENTRY UNAVAILABLE**;4k=ADVANCED 50)。
- upsample 端点分辨率字段(构造器明文):`_0x166b06=('batchAsyncGenerateVideoUpsampleVideo'===apiPathname)` → upsample 走 **requests[0] 顶层 `resolution`**(zod 枚举),其余端点走 `outputSpec.resolution` —— §9.1 "分辨率编码在 key" 补正:key 之外 upsample item 另有顶层 `resolution` 字段(客户端提供时发送)。

### 14.4 creditMapping per-tier:"UNAVAILABLE" 字符串矩阵

- cost 值可为整数或字符串 `"UNAVAILABLE"`(per SERVICE_TIER_*):`_fast_ultra`/`_fast_4s`/`_fast_6s`/`_quality_4s`/`_quality_6s`/`lite_4s`/`lite_6s` = **ADVANCED-only**(5 或 10 或 100 点);plain `_fast`(20 点)= **INTERMEDIATE/ENTRY-only**(ADVANCED 反 UNAVAILABLE);`low_priority` 家族 = ADVANCED 0 点;`upsampler_4k` = ADVANCED 50。
- 工程含义:静态价表 estimateVideoCredits 在这些 key 上有偏差(如 `veo_3_1_t2v_fast_ultra` 静态估 20 vs 真实 ADVANCED-only 10 且本 tier UNAVAILABLE;`veo_3_1_t2v_fast` 在 ADVANCED 不可用)—— 提交前动态价(flow_status)更必要;静态表可加 per-tier 标注。

### 14.5 目录 parity + 素材(Ingredients)tab 定性

- **77/77 parity**:live 动态目录 usage key 全集与 `FLOW_VIDEO_MODELS` 静态表**零差集**(2026-08-27 快照);家族 = 4 UI 家族(Omni Flash 13 / Lite 11 / Fast 26 / Quality 14)+ "Veo 3.1 - Lite [Lower Priority]" 11 + upsampler 2(隐藏于主选择器)。
- 素材 tab = **Ingredients**(`flow_prompt_box_ingredients_mode_button` i18n 原文:"Tab slider button text to switch to generating using **reference images**" → r2v):输入 = 参考图(abra r2v 7 张 / veo r2v 3 张)+ **音频 ingredient(实验期)**;`pinhole_prompt_box_r2v_placeholder_text`="…and ingredients…"。
- **视频上传是独立路径**(素材 tab 本体不含视频):`upload_video_cta`="Upload video";scotty 客户端完整存在(`/api/upload-video?action=start|upload|query`、`scottyUpload`、`BEST_EFFORT` 策略、`scottyAgentUserId`/`scottyCustomerLog`);限制 i18n:`<1GB` / `≤{{maxSeconds}}s` / 一次 `≤{{max}} 条` / `free_tier_blocked` / 格式与超时错误;服务于 v2v edit(abra_edit `VIDEO_REQUIREMENT_VIDEO_EDIT`,maxInputV2vVideoDuration=10)、insert_into_video、extend(响应侧 `userUploadedVideo` zod 字段存在)。§7.6/§9.2 的 scotty 定位不变(引用既有生成视频不需要它)。
- 模式 tab → 端点族映射补强:i18n 键族 `pinhole_prompt_box_{t2v,i2v,r2v,insert_into_video,extend,reshoot,jump_to,mask,reframe,remove_from_video,drawing,scene_builder}_placeholder_text` 与 §7.3 端点族一一对应。

### 14.6 referenceAudio 落地实施 + 假 key 404 探针(2026-08-27,E 轮;积分 1050→1050 零消耗)

- **探针(零积分零调度,§11.1 同法)**:POST `/v1/video:batchAsyncGenerateVideoReferenceImages`,`videoModelKey="abra_r2v_8s_nonexistent_probe_key"` + r2v 全量字段 + **`referenceAudio:[{mediaId:"achernar"}]`** + referenceImages → **404 NOT_FOUND**(形状全过;字段名若未知会是 400 Unknown name,§9 field-sieve 先例)。§14.1 的 bundle Zod 结论由此升级为探针实证。快照:/tmp/flow-survey/e-probe-reference-audio.json。
- **预设语音 mediaId 形状(新 wire 事实)**:是 **slug 名非 UUID**——30 个全表(achernar/achird/algenib/algieba/alnilam/aoede/autonoe/callirrhoe/charon/despina/enceladus/erinome/fenrir/gacrux/iapetus/kore/laomedeia/leda/orus/puck/pulcherrima/rasalgethi/sadachbia/sadaltager/schedar/sulafat/umbriel/vindemiatrix/zephyr/zubenelgenubi),与 §8.1 实体 `audioReferences.presetVoiceId` 同命名空间(charon 双证)。工程含义:mediaId 形状启发(isFlowMediaIdLike)不适用,存在性/预设性校验必须走 projectInitialData 实查。
- **实施(provider)**:`create_video` 新参 `audioMediaIds: string[]`。v1 收窄边界(D-3 裁决):① 仅 r2v key(edit 自身未 live,不叠加;requirements 矩阵里 AUDIO_REFERENCE 是 r2v/edit 的可选叠加项);② mediaId 必须是本项目 externalReferenceMedia 的预设语音(`isPresetAudioSample=true` 实查,非预设 → S301 带 voices 指路 hint);③ per-key 上限(动态 inputSpec.maxAudioReferences 优先/静态 abra=5、veo=1);④ wire = `requests[0].referenceAudio = [{mediaId}]`(r2v item 其余字段集不变);⑤ 恒发顶层 `audioFailurePreference=BLOCK_SILENCED_VIDEOS`(与客户端"仅当模型 outputsAudio 才发"的构造器存在差异——provider 全模型恒发,§2.5 live 形状先例已验可过;音频过滤命中时整条失败而非静默视频,实验期告警随响应返回)。〔本节 ① 的"edit 未 live"前提已被 §15 修正(edit 已 live,但音频叠加仍只在 r2v 实证过,v1 边界维持);⑤ 的实验期告警文案已按 §15 live 观察(语音确实混入、未被过滤)更新〕
- **用户自有音频上传 wire 仍缺**(scotty 仅视频、uploadImage 仅图片)—— v1 无用户音频路径,在 S301 hint 与工具描述诚实披露。
- 确认门 digest 摘入 audioMediaIds(排序后入摘;集合语义,换序不失效、增删失效 —— S320)。

### 14.7 per-tier 价矩阵落地:tier 门禁 + 双向静态标注(2026-08-27,E 轮;D-4)

- **静态蒸馏表 `staticTierCosts`(flow.ts)与 2026-08-27 live 快照 77/77 key 全量一致**(逐 key 校验,/tmp/verify-matrix.mjs):abra 家族全 tier 同价;`lite_4s/6s`=ADV **5**/`fast` 变体(_ultra/_4s/_6s,含 portrait/landscape 叠加)=ADV 10/`quality_4s/6s`=ADV 100(均 INT/ENTRY UNAVAILABLE);plain lite=ADV 5 / INT 10 / ENTRY 10;**plain fast=INT/ENTRY 20 / ADV 反 UNAVAILABLE**;low_priority=ADV 0;upsampler_1080p=ADV 0/INT 0/ENTRY UNAV;upsampler_4k=ADV 50。
- **`lookupVideoCost` 三级价源**:动态 creditMapping[当前档](cost 字符串 "UNAVAILABLE" 显式标出 —— 旧版 NaN 静默落回 tier 盲估算的 bug 于此修)→ `staticTierCosts[tier]` → tier 盲 `estimateVideoCredits`(仅 tier 不可得时;函数本身保持不变作最后兜底,文档注释声明地位)。
- **门禁 `assertTierAvailable`(S303)双拦**:确认门(UNAVAILABLE key 不发令牌——注定失败的请求不进确认流程)+ 提交点(`noRefresh`:只用已缓存目录+credits+静态矩阵,**不因计费/tier 查找新增 projectInitialData 读**;音频预设校验与 videoMediaId 校验的既有合法读不受影响)。错误消息带完整 per-tier 矩阵 + 换 key/升级 hint(双向:不止拦本 tier,也告知其他档真实价)。
- 生效示例:INTERMEDIATE 用户提交 `veo_3_1_t2v_fast_ultra` → 旧版确认门按盲估 20 发令牌、提交后上游碰壁;现在 S303 直拒并给出「ADVANCED=10 / INTERMEDIATE=UNAVAILABLE / ENTRY=UNAVAILABLE」。提交后预估提示与确认门预估均用 tier 真值(ADVANCED 档 fast_ultra 报 10 不再报 20)。
- 文档锚同步:S300 消耗表 hint 补 per-tier 差异;工具描述(create_video model 字段)补 tier-locked 家族说明。

### 14.8 r2v 输入上限落地(inputSpec 实施)+ 三处文档锚修正(2026-08-27,E 轮)

- **动态**:`cacheDynamicCatalog` 增 `inputByKey`(`usage.maxImageInputs` 是 **usage 顶层字段**,`maxAudioReferences` 嵌 `usage.inputSpec` 内 —— 两者层级不同,wire 细节);确认门先行刷新后提交点共用缓存。
- **静态兜底 `staticR2vCaps`**:abra_r2v=图 7/音 5;veo r2v=图 3/音 1;未知家族保守 10。**旧硬编码"最多 10"删除**——那是 §7.2 生图 base+refs 的上限,错锚到了视频 r2v(真值 7/3,超出会被上游拒)。
- `flow_status` usage 透传 `inputSpec`/`maxImageInputs`/`outputsAudio`(动态上限与音频能力的自省入口)。
- **三处文档锚修正(D 轮 D-in 三锚)**:① index.ts images 描述 "1-10"→per-key(abra 7/veo 3);② flow.ts r2v 报错文案"最多 10"/"1-10 张"→per-key 动态值;③ flow.ts resolution 丢弃告警中"更高分辨率请用 key 变体(如 fast_ultra)"**证伪并修正**——§14.3:75/75 生成 usage 仅 720P,ultra/quality 变体同 720P,唯一升分辨率路径 = 生成后超分(upsampler_1080p 0 点 / 4K ADVANCED 50)。

### 14.9 等价性文档措辞修正(equivalent-doc;D-1/D-5)

- **x1-x4 等价表述**(index.ts create_video 描述):UI 的 x1-x4 = N 次独立单元素 POST(§14.2 构造器实证),provider 单 POST 同构 —— 保留等价声明;**"each gets its own seed" 修正**为"seed 每次调用独立随机,**除非显式传 seed**(显式 seed 在 N 次调用间复用)"(flow.ts `req.seed ?? randomInt` 的诚实描述,D-5)。
- **B8 描述瘦身(B8;2026-08-27)**:create_video 的 flow key 目录原在「工具描述/model 参数/各输入参数」三度复述,收敛为单一分工 —— 工具描述=七模式一行表(输入×key 例×价)+确认门流程+xN/seed 语义+积分区间+`flow_status()` 指针;model 参数=mnemonic 规则(full key 或 缩写+durationSeconds)+家族开放列表+tier 锁+指针;各输入参数只留「requires an i2v/r2v/interpolation/extension 类 key + S301 指路」不再枚举 key 例;confirmToken 参数的确认门流程复述删除(流程归工具描述,参数留 TTL/绑定/失效/开关细节,指针互指)。**零信息丢失重审**(逐项 diff vs 4b29956 基线):11 个 key 例全部存续于七模式表;r2v 参考图上限 7/3、音频 5/1、keyframes=2、预设语音 30;互斥对(numFrames↔durationSeconds、images↔image/keyframes/videoMediaId);tier 锁与 per-tier 矩阵拒绝;t2v/edit「未 live」标注由 §15 live 事实取代(非丢失,是状态升级)。schema token:2836→2435(chars 11344→9738,估算 chars/4),省 401。守卫同步:test/flow-confirm.integration.test.mjs 的 needConfirm 断言从参数侧改锚工具描述侧(两段式文档化的权威位置随 B8 归位),参数侧改锚 flow.confirmTtlMs。
- **t2v 透明标注**(D-1):工具描述与 S303 hint 补"t2v wire 仅 404 形状探针验证,provider 路径从未 live 提交"(与 edit 的 EDIT_WIRE_WARNING 同款措辞;最终盘点 = 5 模式 live:i2v/首尾帧/r2v/extension/upsampler + 2 模式 shape-verified:t2v/edit。〔后被 §15 修正:t2v/edit 均已于 2026-08-27 live 验证,7/7 全 live,标注与警示全部解除〕)。

### 14.10 lite 档全矩阵 live 实证(2026-08-27 用户授权真实测试;积分 1050→888,-162)

18 条提交 **18/18 SUCCESSFUL、12/12 组合预估=实扣零误差、18/18 下载字节完整**(产物 /tmp/live-video-test/):

| 模式×key | 时长(ffprobe) | 比例×数量 | 价/条 |
|---|---|---|---|
| 素材 abra_r2v_4s | **精确 4s** ✓ | {1280x720, 720x1280}×{x1,x2} | 7 |
| 素材 veo_3_1_r2v_lite | 8s(默认) | 同上 | 10 |
| 帧 veo_3_1_interpolation_lite | 8s(默认) | 同上 | 10 |

- **x2 = 两条独立提交**(各自确认令牌/扣分/seed)——与页面 xN=N 次独立 POST 同构,等价性由真实提交坐实(§14.2 升级为 live 证据)。
- **S303 tier 门 live 实证**:帧 `veo_3_1_i2v_s_lite_4s_fl`(本档 UNAVAILABLE)确认门即拦,零积分消耗,错误带 per-tier 矩阵(ADVANCED=5)。
- **行为发现(待改进,低优先)**:veo 系 + `durationSeconds:4`(本档无 4s key)→ 吸附到默认 8s key **进入确认流程且未见告警**;应补"时长吸附/回落"告警(audioMediaIds 之外的丢弃参数均有告警纪律,此处遗漏)。

## 15. t2v / edit / 音频参考三笔 live 转正(2026-08-27,L 轮用户授权;积分 888→854,-34)

> 三笔授权预算 ≤37(t2v 7 / edit 20 / r2v+audio 7),总闸 45;实扣 34,三笔全部一次成功零重试,预估(dynamic)=实扣零误差。方法:dist provider 代码路径(确认门两段式 beginSubmissionConfirm → createVideo → getVideo 轮询 → 下载 ffprobe),驱动脚本 /tmp/live-L3/。基线勘误:本轮期初余额实际 **888**(=§14.10 台账期末),"1050" 是 §14.10 期初值。

| 笔 | key | 输入 | 实扣 | 时长 | 分辨率 | 音轨 |
|---|---|---|---|---|---|---|
| t2v 转正 | abra_t2v_4s | 纯 prompt(风景+音效描述) | 7 | 4.01s | 1280x720 | aac ✓ |
| edit 转正 | abra_edit | videoMediaId=44bbe881…(§14.10 abra_r2v_4s 测试视频 1280x720)+ "make it a rainy night scene" 类指令 | 20 | 4.01s | 1280x720 | aac ✓ |
| 音频参考转正 | abra_r2v_4s | images=[54c3bbb2…(项目内底图,getMediaBytes 转 data URI 再上传)] + audioMediaIds=["achernar"] | 7 | 4.01s | 1280x720 | aac 48kHz 立体声 ✓ |

- **t2v 首次 live(provider 路径)**:`batchAsyncGenerateVideoText` 一次 200;SCHEDULED→ACTIVE→SUCCESSFUL ~35s;§14.9 "t2v 从未 live 提交" 透明标注解除,全 7 开放模式 live 收官。
- **edit 首次 live**:`batchAsyncGenerateVideoEditVideo` 一次 200 —— §11.1 形状全对(顶层无 useV2ModelConfig、requests[0]={aspectRatio 源继承 LANDSCAPE, metadata, seed, textInput, videoInput:{mediaId}, videoModelKey});~30s SUCCESSFUL;**edit 保留源视频时长(4s)/比例(16:9)且带音轨**(对源做"雨夜"类重打光指令)。EDIT_WIRE_WARNING 常量与提交响应警示已随 live 验证删除(src/providers/flow.ts 定义+消费、test/flow.test.ts import+断言,dist-test 随 build 再生)。
- **音频参考首次 live**:`referenceAudio=[{mediaId:"achernar"}]` 提交 200,**生成 SUCCESSFUL 未被 BLOCK_SILENCED_VIDEOS 过滤**;产物音轨 mean_volume -20.0dB / max -0.9dB,比同期纯环境音基线(t2v -31.8dB / edit -36.2dB)**高约 12-16dB —— 语音确实混入,未被静默**(视觉交叉验证:画面人物对镜头说话+手势)。说话人与 achernar 音色一致性未做说话人级核验(无 speaker-ID,如实记录)。§14.6 的实验期告警文案已按此观察更新。
- 台账:888 →881(t2v,-7)→861(edit,-20)→854(r2v+audio,-7);终值 854 复核一致。
