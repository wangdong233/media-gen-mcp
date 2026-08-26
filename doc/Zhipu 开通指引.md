# 智谱 BigModel / Z.AI 开通与接入指引

> **用途**：media-gen-mcp 第二 Provider「zhipu」的开通与配置指南（README 补充）。
> **核对基线**：2026-07，平台文本模型基线 GLM-5.2，API 版本 `/paas/v4`。
> **数据来源**：智谱官方文档 docs.bigmodel.cn / 国际版 docs.z.ai（已逐项核对，3 处常见误区下方用 ⚠️ 标注）。
> **配套调研**：更深入的模型/价格/开源对比见 [`doc/Provider扩张路线图.md`](Provider扩张路线图.md) 的智谱(Zhipu)节。

---

## 速览（TL;DR）

1. 国内 `open.bigmodel.cn` 注册 → 个人**实名认证** → 建 **API Key**（仅显示一次，立即保存）。
2. 在 `~/.media-gen-mcp/config.json` 的 `providers.zhipu` 填 `apiKey` + `baseUrl`，免费起步模型 `cogview-3-flash`（图）/ `cogvideox-flash`（视频）。
3. **图像同步**（`/paas/v4/images/generations`）、**视频异步**（提交拿 id → 轮询）。整套 API **OpenAI 兼容**，可先用 curl 自检。
4. 撞 `1302` 降并发、撞 `1305` 退避重试；具体并发数**登录控制台「速率限制」页查看**（官方无静态分级表）。
5. 海外用户走国际版 **Z.AI**（`api.z.ai`），无需中国大陆实名。

---

## 国内 / 国际两条路径对照

| 维度 | 国内（智谱 BigModel） | 国际（Z.AI） |
|---|---|---|
| 平台首页 | https://open.bigmodel.cn/ | https://z.ai/ |
| 文档站 | https://docs.bigmodel.cn/cn/ | https://docs.z.ai/ |
| API Key 控制台 | `bigmodel.cn/usercenter/proj-mgmt/apikeys` | `z.ai/manage-apikey/apikey-list` |
| Base URL（通用） | `https://open.bigmodel.cn/api/paas/v4` | `https://api.z.ai/api/paas/v4` |
| Base URL（Coding Plan） | `https://open.bigmodel.cn/api/coding/paas/v4` | `https://api.z.ai/api/coding/paas/v4` |
| 认证 | HTTP Bearer：`Authorization: Bearer YOUR_API_KEY` | 同左 |
| 实名 | **需中国大陆实名认证**方可用 | 无中国大陆实名要求 |

> [!NOTE]
> media-gen-mcp 的 `baseUrl` 只填到 **`/api`** 这一层（`https://open.bigmodel.cn/api`），`/paas/v4/...` 由 provider 代码自动拼接，不要把 `/paas/v4` 也写进 config（否则会变成 `/api/paas/v4/paas/v4/...`）。

---

## 一、开通账号（注册 → 实名 → API Key）

### 1. 注册登录
访问 https://open.bigmodel.cn/ ，点右上「注册/登录」，用手机号或第三方账号注册并登录。新用户注册即送免费 Token 额度（主要供 GLM 文本模型消耗）。

### 2. 完成个人实名认证（国内必做）
进入个人中心完成**个人实名认证**（提供身份信息，审核通过后才能创建 API Key、解锁完整额度）。国内平台**无需绑定信用卡**即可调用免费模型。

> 海外用户走国际版 https://z.ai/ ，注册流程类似（注册 → Billing 充值 → 创建 Key），**无实名环节**。

### 3. 创建并保存 API Key
- 国内：登录后进入「用户中心/个人中心 → API Keys」，路径 `bigmodel.cn/usercenter/proj-mgmt/apikeys`，点「创建新 API Key」→ 填名称 → 生成。
- 国际：`z.ai/manage-apikey/apikey-list`。

> [!WARNING]
> Key **只在创建时显示一次**，必须立即复制保存；切勿硬编码进代码、切勿提交到仓库或泄露。建议用环境变量（如 `ZHIPU_API_KEY`）或 `~/.media-gen-mcp/config.json` 存储。

---

## 二、接入 media-gen-mcp

media-gen-mcp 的 zhipu provider 已内置，只需在 config 里填三块：`apiKey`、`baseUrl`、`models`。

### 配置文件位置
`~/.media-gen-mcp/config.json`（home 全局；npx 安装时项目内 config 不生效）。

### 最小配置（免费起步）

```json
{
  "defaultProvider": "zhipu",
  "providers": {
    "zhipu": {
      "apiKey": "你刚才保存的 API Key",
      "baseUrl": "https://open.bigmodel.cn/api",
      "models": {
        "image": { "default": "cogview-3-flash" },
        "video": { "default": "cogvideox-flash" }
      }
    }
  }
}
```

### 完整配置（含可用模型清单与限流基线）

```json
{
  "defaultProvider": "zhipu",
  "rateLimitTtlMs": 604800000,
  "providers": {
    "zhipu": {
      "apiKey": "your-zhipu-api-key",
      "baseUrl": "https://open.bigmodel.cn/api",
      "videoMinIntervalMs": 62000,
      "models": {
        "image": {
          "default": "cogview-3-flash",
          "available": ["cogview-3-flash", "cogview-4", "cogview-4-250304", "glm-image"]
        },
        "video": {
          "default": "cogvideox-flash",
          "available": ["cogvideox-flash", "cogvideox-2", "cogvideox-3"]
        }
      },
      "rateLimits": {}
    }
  }
}
```

### 字段说明

| 字段 | 必填 | 说明 |
|---|:---:|---|
| `providers.zhipu.apiKey` | ✅ | 智谱 API Key |
| `providers.zhipu.baseUrl` | ✅ | **国内** `https://open.bigmodel.cn/api`；**国际** `https://api.z.ai/api`。只填到 `/api` |
| `providers.zhipu.models.image.default` | ✅ | 默认图像模型（缺则工具报错引导） |
| `providers.zhipu.models.image.available` | | 可用图像模型（`list_models` 返回） |
| `providers.zhipu.models.video.default` | ✅ | 默认视频模型 |
| `providers.zhipu.models.video.available` | | 可用视频模型 |
| `providers.zhipu.videoMinIntervalMs` | | 视频提交最小间隔，默认 `62000`（限流基线，撞 429 会自动学习并回写） |
| `providers.zhipu.rateLimits` | | per-model 自动学习的限流（撞 429 写入，带 TTL，无需手填） |

> [!TIP]
> 工具层不内置任何厂商模型名 —— 新模型上线只改配置，不改代码。模型选择优先级：调用参数 `model` > config `default` > 无 fallback（缺则报错）。

### 切换 provider
把 `defaultProvider` 改成 `"zhipu"`，或调用工具时传 `provider: "zhipu"`（不改动默认，临时用一次）。

### MCP 调用模式（与 curl 对应）
- **图像**：同步。MCP `generate_image` 直接返回 `data[].url`（对应官方 `POST /paas/v4/images/generations`）。
- **视频**：异步。MCP `create_video` 提交任务拿 id，`get_video` 轮询；状态机 `PROCESSING → SUCCESS / FAIL`，成功返回 `video_result[].url` 与封面（对应官方 `POST /paas/v4/videos` + `GET /paas/v4/async-result/{id}`）。

> [!IMPORTANT]
> **排错提示（视频提交端点）**：智谱官方视频提交端点为 `POST /paas/v4/videos`（异步）。当前 `src/providers/zhipu.ts` 实现提交时请求的是 `POST /paas/v4/videos/generations`（与下文 curl 自检的官方端点不同）。若视频调用失败、提示 404 / 路径错误，优先以本文「六、curl 验证」里的官方端点自检确认 Key 与连通性无误后，再到 zhipu.ts 核对提交路径。轮询端点 `GET /paas/v4/async-result/{id}` 代码与官方一致。

---

## 三、模型清单

| 模型 | 模态 | 计费 | 说明 |
|---|---|:---:|---|
| **`cogview-3-flash`** ⭐ | 文生图 | **免费** | 免费起步首选。多分辨率 1024×1024 / 768×1344 / 864×1152 / 1344×768 / 1152×864 / 1440×720 / 720×1440，中文语义强，数秒出图 |
| `cogview-4`（`cogview-4-250304`） | 文生图 | 付费 | 旗舰。首个支持生成汉字、中英双语；512–2048px，最高 2048×2048 |
| `glm-image` | 文生图 | 付费 | 高质量、文字渲染稳准 |
| **`cogvideox-flash`** ⭐ | 文/图生视频 | **免费** | 免费起步首选。首个免费 AI 视频生成模型，最高 4K、60fps |
| `cogvideox-2` | 文/图生视频 | 付费 | 上一代，性价比之选 |
| `cogvideox-3` | 文/图/首尾帧生视频 | 付费 | 旗舰。新增首尾帧生成、最高 4K、30/60fps、5/10 秒、可带音频 |

> [!NOTE]
> **关于「永久免费」**：官方文档把 `cogview-3-flash` / `cogvideox-flash` 明确列为「免费模型」栏目；官方措辞为「免费」，**未见「永久」字样**。「永久免费」是社区/营销说法，可作参考但非官方承诺 —— 以官方「免费模型」页与控制台计费页为准。

---

## 四、免费额度与限速

### 免费额度
- 新用户注册送免费 Token 额度（主要供 GLM 文本模型消耗，邀好友/实名可获更高额度）。
- `cogview-3-flash`（图）/ `cogvideox-flash`（视频）列为「免费模型」，**不消耗 Token 额度**，无需付费即可调用。

### 限速机制（关键结论）
智谱限速**不是固定的 RPM/RPD**，而是：

1. 按**「并发在途任务数」**限制，非按分钟/日请求次数；
2. 按**「用户权益等级 + 模型维度」**动态分配并发上限；
3. 不同套餐（免费/付费/企业）、不同模型（CogView/CogVideoX）并发上限不同；
4. Coding Plan 套餐按 Lite（单项目）/ Pro（1–2 项目）/ Max（2+ 项目）划分。

> ⚠️ **官方公开文档不存在「V0–V3 = 5–20 并发」的静态分级表**（该口径疑似第三方/旧版混入，非智谱官方）。要拿准确数字，**登录控制台「速率限制」页查看本账户每个模型的并发值**，且数值会动态调整。

### 高频错误码

| 错误码 | HTTP | 含义 | 处理 |
|---|:---:|---|---|
| **`1302`** | 429 | 账户已达到速率限制（并发达上限） | 降并发、加队列、提权益等级 |
| **`1305`** | 429 | 该模型当前访问量过大（平台服务过载） | 稍后重试、增大退避间隔 |
| `1308` | — | 达到 N 时段用量上限 | 控制时段用量 |
| `1311` | — | 套餐未开放该模型 | 换模型或升级套餐 |
| `1309` | — | Coding Plan 到期 | 续费 |
| `1113` | — | 欠费 | 充值 |
| `1211` | — | 模型不存在 | 核对模型名拼写 |
| `1261` | — | Prompt 超长 | 裁剪 prompt |
| `1301` | — | 内容安全拦截 | 修改 prompt |

### media-gen-mcp 的限流处理
- 内置 `videoMinIntervalMs`（默认 62s）串行化视频提交，避免并发撞限。
- 撞 429 / `1302` 时**自动解析真实限流**并 per-model 回写 `config.json` 的 `rateLimits`，后续自动避开（带 7 天 TTL，过期降级基线重学）。
- 撞 `1305`（平台过载）属于临时情况，稍后重试即可，无需改配置。

---

## 五、国际版 Z.AI（api.z.ai）

海外用户或不想做中国大陆实名的用户，走国际版：

| 项 | 国际版值 |
|---|---|
| 平台首页 | https://z.ai/ |
| 文档 | https://docs.z.ai/ |
| API Key 控制台 | `z.ai/manage-apikey/apikey-list` |
| Base URL（config 里填） | `https://api.z.ai/api` |
| 认证 | 同样 `Authorization: Bearer YOUR_API_KEY` |
| 计价 | USD 计价 |

**接入 media-gen-mcp 只改两处**：`baseUrl` 换成 `https://api.z.ai/api`、`apiKey` 用 z.ai 的 Key，路径与端点与国内**完全一致**：

```json
{
  "providers": {
    "zhipu": {
      "apiKey": "你的 z.ai API Key",
      "baseUrl": "https://api.z.ai/api",
      "models": {
        "image": { "default": "cogview-3-flash" },
        "video": { "default": "cogvideox-flash" }
      }
    }
  }
}
```

> [!NOTE]
> 国际版部分模型/价格与国内有差异（如 CogView-4 国际 $0.01/图、CogVideoX-3 国际 $0.20/视频）；免费模型 `cogview-3-flash` / `cogvideox-flash` 国际版同样免费。详见 [`doc/Provider扩张路线图.md`](Provider扩张路线图.md) 智谱节的「价格速查表」。

---

## 六、curl 验证

配置前/后用 curl 直接打智谱官方端点，验证 Key 与连通性（与 media-gen-mcp 走同一套 API）。先导出 Key：

```bash
export ZHIPU_API_KEY="你的-API-Key"
```

### (1) 文本对话 —— 最稳的连通性自检
```bash
curl -X POST "https://open.bigmodel.cn/api/paas/v4/chat/completions" \
  -H "Authorization: Bearer $ZHIPU_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"glm-5.2","messages":[{"role":"user","content":"你好"}]}'
```

### (2) 图像生成 —— cogview-3-flash（免费，同步）
```bash
curl -X POST "https://open.bigmodel.cn/api/paas/v4/images/generations" \
  -H "Authorization: Bearer $ZHIPU_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"cogview-3-flash","prompt":"一只戴墨镜的橘猫，赛博朋克风","size":"1024x1024"}'
# 返回 data[0].url（图片直链）
```

### (3a) 视频生成 —— cogvideox-flash（免费，异步：先提交拿 id）
```bash
curl -X POST "https://open.bigmodel.cn/api/paas/v4/videos" \
  -H "Authorization: Bearer $ZHIPU_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"cogvideox-flash","prompt":"一只猫在草地上奔跑，阳光明媚"}'
# 返回 {"id":"<task_id>", "task_status":"PROCESSING", ...}
```

### (3b) 轮询视频结果（用上一步的 id，间隔 ~10s 轮询到 task_status=SUCCESS）
```bash
curl "https://open.bigmodel.cn/api/paas/v4/async-result/<task_id>" \
  -H "Authorization: Bearer $ZHIPU_API_KEY"
# SUCCESS 时返回 video_result[0].url 与封面
```

> [!WARNING]
> ⚠️ **视频提交端点是 `/paas/v4/videos`，不是 `/paas/v4/videos/generations`**（图像才是 `/images/generations`，二者路径不同）。图像同步、视频异步，模型与路径均不同 —— 别混用。

**国际版**：把 Base URL 换成 `https://api.z.ai/api/paas/v4`、Key 用 z.ai 的，路径完全一致。

> 注：视频请求体的 `size` / `duration` / `fps` 等可选字段以官方「视频生成(异步)」文档为准；`model` + `prompt` 为必填（已确认）。

---

## 开通到首调的完整步骤（国内版速查）

1. `open.bigmodel.cn` 注册登录
2. 完成个人实名认证
3. 进 `usercenter/proj-mgmt/apikeys` 创建并**立即保存** API Key
4. 选免费起步模型：图 `cogview-3-flash` / 视频 `cogvideox-flash`
5. 用上面的 curl 自检 Key 与连通性
6. 在 `~/.media-gen-mcp/config.json` 填 `providers.zhipu`（apiKey + baseUrl + models）
7. 在 Claude Code 里调用（或临时传 `provider: "zhipu"`）
8. 登录控制台「速率限制」页查本账户各模型并发值
9. 遇 `1302` 降并发 / 加队列；遇 `1305` 退避重试

---

## 官方文档链接

| 主题 | 链接 |
|---|---|
| 快速开始 | https://docs.bigmodel.cn/cn/guide/start/quick-start |
| 速率限制 | https://docs.bigmodel.cn/cn/api/rate-limit |
| 错误码 | https://docs.bigmodel.cn/cn/faq/api-code |
| 免费模型 cogview-3-flash | https://docs.bigmodel.cn/cn/guide/models/free/cogview-3-flash |
| 免费模型 cogvideox-flash | https://docs.bigmodel.cn/cn/guide/models/free/cogvideox-flash |
| CogView-4 | https://docs.bigmodel.cn/cn/guide/models/image-generation/cogview-4 |
| CogVideoX-3 | https://docs.bigmodel.cn/cn/guide/models/video-generation/cogvideox-3 |
| 视频生成(异步) API | https://docs.bigmodel.cn/api-reference/模型-api/视频生成异步 |
| 国际版 Quick Start | https://docs.z.ai/guides/overview/quick-start |
| 定价 | https://bigmodel.cn/pricing |
