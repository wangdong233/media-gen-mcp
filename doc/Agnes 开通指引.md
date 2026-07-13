# Agnes AI 开通指引

> 本文是 [`README.md`](../README.md) 的补充文档,手把手带你从零开通 Agnes AI、接入 media-gen-mcp,到跑通第一张图、第一段视频。面向首次使用者;模型可用性 / 限速 / 定价可能随时间变化,生产环境请以[官方文档](https://wiki.agnes-ai.com/zh-Hans/docs/overview)与控制台为准。

---

## 目录

- [一、开通步骤](#一开通步骤)
  - [1. 注册账号](#1-注册账号)
  - [2. 获取 API Key](#2-获取-api-key)
  - [3. 确认 Base URL](#3-确认-base-url)
- [二、接入 media-gen-mcp](#二接入-media-gen-mcp)
  - [1. 最小配置](#1-最小配置)
  - [2. 字段逐项说明](#2-字段逐项说明)
  - [3. 注册到 Claude Code](#3-注册到-claude-code)
  - [4. 验证接入](#4-验证接入)
- [三、免费政策与限速](#三免费政策与限速)
  - [1. 全免费](#1-全免费)
  - [2. 限速(RPM / 配额)](#2-限速rpm--配额)
  - [3. server 如何自动处理视频 1 req/min](#3-server-如何自动处理视频-1-reqmin)
- [四、curl 验证示例](#四curl-验证示例)
- [五、故障排查](#五故障排查)

---

## 一、开通步骤

三步即可拿到可用的 API 凭证:① 注册 → ② API Key → ③ 确认 Base URL。

### 1. 注册账号

| 项 | 说明 |
|---|---|
| 开发者平台 | https://platform.agnes-ai.com/ |
| 官网首页 | https://agnes-ai.com/ |
| 支持的登录方式 | 邮箱注册(需邮箱验证,不强制手机号)、Google 账号授权、GitHub 账号授权 |
| 等待名单 | **无 waitlist**,注册即可用 |
| 免费额度 | 注册即享免费 credits,图像 / 视频单价当前为 $0(详见[第三节](#1-全免费)) |

**操作**:

1. 打开 https://platform.agnes-ai.com/,点击「注册 / 登录」。
2. 选择邮箱 / Google / GitHub 任一方式完成注册。
3. 完成邮箱验证后即可进入开发者控制台。

> 参考:[官方 Quickstart](https://wiki.agnes-ai.com/zh-Hans/docs/quickstart)

### 2. 获取 API Key

1. 登录开发者控制台,进入 **Settings → API Keys**。
2. 点击 **Create new secret key** 创建密钥。
3. **创建后立即复制并妥善保存** —— 密钥仅展示一次,丢失只能重新创建。
4. 所有 API 请求通过请求头认证:
   ```
   Authorization: Bearer YOUR_API_KEY
   ```

> [!WARNING]
> 密钥等同于账户凭证。**只放服务端环境变量**,切勿提交到 Git 仓库或硬编码到前端代码。media-gen-mcp 通过配置文件读取,无需写入代码。

### 3. 确认 Base URL

```
https://apihub.agnes-ai.com/v1
```

所有 API 请求基于此地址构建。Agnes 接口完全兼容 OpenAI 风格,迁移现有 OpenAI 项目通常只需改三处:**Base URL**、**API Key**、**模型名称**。

| Endpoint | 用途 |
|---|---|
| `POST /v1/images/generations` | 文生图 / 图生图 |
| `POST /v1/videos` | 视频生成(异步任务) |
| `GET /agnesapi?video_id=<VIDEO_ID>` | 视频任务轮询(推荐) |
| `POST /v1/chat/completions` | 文本 / 视觉语言(本 MCP 暂未使用) |

> media-gen-mcp 的 agnes provider 内置了上述 Base URL。正常情况下你**无需**在 config 里显式填写 `baseUrl`;若因网络环境需要覆盖,可在 `providers.agnes.baseUrl` 显式设置,或用环境变量 `AGNES_BASE_URL`。

---

## 二、接入 media-gen-mcp

### 1. 最小配置

media-gen-mcp 的配置文件固定路径为 **`~/.media-gen-mcp/config.json`**(用户 home 全局,而非项目内)。这是因为 npx 装包到 npm 缓存目录,项目内配置不持久、不可写。

新建该文件,填入最小可用配置:

```json
{
  "defaultProvider": "agnes",
  "providers": {
    "agnes": {
      "apiKey": "sk-your-agnes-key",
      "videoMinIntervalMs": 62000,
      "models": {
        "image": {
          "default": "agnes-image-2.1-flash",
          "available": ["agnes-image-2.0-flash", "agnes-image-2.1-flash"]
        },
        "video": {
          "default": "agnes-video-v2.0",
          "available": ["agnes-video-v2.0"]
        }
      },
      "rateLimits": {}
    }
  }
}
```

把 `sk-your-agnes-key` 替换为[上一步](#2-获取-api-key)拿到的真实密钥即可。

> [!TIP]
> 想同时配置可选的智谱(zhipu)provider 作为备份?完整双 provider 示例见仓库根目录的 [`config.example.json`](../config.example.json)。

**一句话创建**(终端执行,把 `sk-xxx` 换成你的 Key):

```bash
mkdir -p ~/.media-gen-mcp && cat > ~/.media-gen-mcp/config.json <<'EOF'
{
  "defaultProvider": "agnes",
  "providers": {
    "agnes": {
      "apiKey": "sk-your-agnes-key",
      "videoMinIntervalMs": 62000,
      "models": {
        "image": { "default": "agnes-image-2.1-flash", "available": ["agnes-image-2.0-flash", "agnes-image-2.1-flash"] },
        "video": { "default": "agnes-video-v2.0", "available": ["agnes-video-v2.0"] }
      },
      "rateLimits": {}
    }
  }
}
EOF
```

### 2. 字段逐项说明

| 字段 | 必填 | 默认 | 说明 |
|---|:---:|---|---|
| `defaultProvider` | 是 | `agnes` | 默认 provider,工具调用省略 `provider` 参数时用它 |
| `providers.agnes.apiKey` | **是** | — | 你的 Agnes API Key,**必填** |
| `providers.agnes.models.image.default` | 是 | `agnes-image-2.1-flash` | 默认图像模型;`generate_image` 省略 `model` 时用它 |
| `providers.agnes.models.image.available` | 否 | — | 可用图像模型列表(`list_models` 工具返回) |
| `providers.agnes.models.video.default` | 是 | `agnes-video-v2.0` | 默认视频模型 |
| `providers.agnes.models.video.available` | 否 | — | 可用视频模型列表 |
| `providers.agnes.videoMinIntervalMs` | 否 | `62000` | 视频提交最小间隔(限流基线,见[第三节](#3-server-如何自动处理视频-1-reqmin)) |
| `providers.agnes.rateLimits` | 否 | `{}` | per-model 自动学习的限流(撞 429 自动写入,带 TTL,**留空即可**) |
| `providers.agnes.baseUrl` | 否 | 内置 `https://apihub.agnes-ai.com/v1` | 仅需覆盖时才填 |
| `rateLimitTtlMs` | 否 | `604800000`(7 天) | 学习限流过期时间,过期降级基线重学 |

**模型选择优先级**:工具调用参数 `model` > config `default` > 无 fallback(缺失会报错并引导你配置)。

> [!IMPORTANT]
> 工具层不内置任何厂商模型名 —— 这是有意设计。Agnes 上线新模型时,只需改 config 的 `available` / `default`,**不用改代码**。

#### Agnes 模型清单(接入相关)

| 模型名称 | 类型 | 用途 |
|---|---|---|
| `agnes-image-2.1-flash` | 图像生成与编辑 | 文生图(推荐)、图生图、图像编辑;高信息密度、灵活尺寸 |
| `agnes-image-2.0-flash` | 图像生成与编辑 | 文生图、图生图、多图合成 |
| `agnes-video-v2.0` | 视频生成 | 文生视频、图生视频、关键帧动画(异步任务) |
| `agnes-2.0-flash` | 文本 / 视觉语言 | 推理、编码、工具调用、图像理解(本 MCP 未使用) |

media-gen-mcp 默认:图像用 `agnes-image-2.1-flash`,视频用 `agnes-video-v2.0`。

### 3. 注册到 Claude Code

配置写好后,把 MCP server 注册到 Claude Code(安装命令**不传 Key** —— Key 已在 config 里):

```bash
claude mcp add media-gen-mcp npx media-gen-mcp
```

> [!NOTE]
> `npx` 方式需该包已发布到 npm registry。若你本地开发运行,可用 `node dist/index.js` 直接启动,或用 MCP Inspector 调试:`npm run inspect`。

### 4. 验证接入

注册后,在 Claude Code 里直接说:

> "用 media-gen-mcp 列出可用的模型"

或调用 `list_models` 工具。正常会返回 agnes 的图像 / 视频模型与视频约束(允许的帧数、默认帧率)。

看到模型列表即说明 Key、Base URL、配置全部就绪。然后就可以:

> "生成一张橙猫趴在木桌上的图,写实风格"
> "把这张图转成水彩"
> "生成一段 5 秒海边的视频"

所有产物自动落盘并返回本地绝对路径,Claude Code 可直接 `Read` 看图、`open` 看视频。

---

## 三、免费政策与限速

### 1. 全免费

Agnes 于 2026 年 6 月 1 日宣布 `agnes-2.0-flash` / `agnes-image-2.0-flash` / `agnes-video-v2.0` 三款模型 API **无限期免费(indefinitely free)**,号称全球首个全模态免费 API。

| 类型 | 标准价 | 当前价 |
|---|---|---|
| 图像生成(`agnes-image-2.0/2.1-flash`) | $0.003 / 张 | **$0 / 张** |
| 视频生成(`agnes-video-v2.0`) | $0.005 / 秒 | **$0 / 秒** |

> [!IMPORTANT]
> 「免费」指**单价为 0**,但仍有**配额 / 限速**(见下)。官方声明定价、配额规则可能随时间变化。

### 2. 限速(RPM / 配额)

> 以下为官方公开参考值(as of 2026-06-28),属于运营限制而非永久保证。

#### Free(免费)用户

| 模型类型 | 限速 |
|---|---|
| 文本模型 | 20 actual RPM(每分钟 20 次实际请求) |
| 图像模型 | 与分辨率相关的 RPM 限制 |
| **视频模型** | **1 actual RPM(每分钟 1 次请求)** |

#### 订阅用户(Token Plan)提速档位

| 订阅 | 文本 RPM | 图像配额 | 视频配额 |
|---|---|---|---|
| Starter | 1,500 req / 5 小时;15,000 req / 周 | 4,000 张 / 天 | 500 秒 / 天 |
| Plus | 7,500 req / 5 小时;75,000 req / 周 | 4,000 张 / 天 | 500 秒 / 天 |
| Pro | 30,000 req / 5 小时;300,000 req / 周 | 4,000 张 / 天 | 500 秒 / 天 |

**对 media-gen-mcp 用户的核心结论**:免费用户视频限速为 **约 1 req/min(1 actual RPM)**。图像生成限速相对宽松,通常不是瓶颈。

### 3. server 如何自动处理视频 1 req/min

视频 1 req/min 是接入时最容易踩的坑。media-gen-mcp 已在 server 端内置三层自动处理,**用户无需手动控制并发**:

**① 提交串行化(基线 62s)**

config 里 `providers.agnes.videoMinIntervalMs: 62000` = 60s(1 req/min 限速)+ 2s 余量。agnes provider 内部用一条提交链(`submitChain`)把所有视频创建请求**全局串行化**,相邻两次提交至少间隔 62 秒,从源头避免并发撞限速。

**② 429 自动学习(per-model)**

万一基线仍不够(官方调整限速),撞到 429 时,provider 会:

1. 解析 429 响应正文里的真实限速(如 `N requests per M minute`)。
2. 计算新的最小间隔(窗口 / 次数 + 2s 余量)。
3. per-model 写回 config.json 的 `providers.agnes.rateLimits`(原子 temp + rename 写入)。
4. 后续该模型的提交自动按学到的间隔执行。

日志会输出:`[media-gen-mcp] 从 429 学习到 agnes-video-v2.0 限速:XXXms/提交,回写 config.json`。

**③ TTL 过期降级**

学到的限速带 7 天 TTL(`rateLimitTtlMs`)。过期后降级回 62s 基线并重新学习,适应官方限速的动态变化。

> [!TIP]
> 所以你只管连续提交多个视频任务,server 会自动排队、自动间隔、自动避开 429。你看到的现象是:第二个视频的创建会比第一个晚约 1 分钟,这是**正常的限流保护**,不是卡死。

---

## 四、curl 验证示例

下列示例可在终端直接运行,用于在接入 MCP 前验证 Key 与网络是否通畅。把 `YOUR_API_KEY` 换成你的真实密钥。

> [!NOTE]
> 以下为**直接调用 Agnes 原生 API** 的验证方式,绕过 MCP,适合排查「到底是 Key/网络问题还是 MCP 配置问题」。日常使用请通过 media-gen-mcp 的工具调用,server 会自动处理限速、落盘、轮询。

### A. 文生图(`agnes-image-2.1-flash`)

```bash
curl https://apihub.agnes-ai.com/v1/images/generations \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "agnes-image-2.1-flash",
    "prompt": "A luminous floating city above a misty canyon at sunrise, cinematic realism",
    "size": "1024x768",
    "extra_body": {
      "response_format": "url"
    }
  }'
```

成功响应(返回图片直链):

```json
{
  "created": 1780000000,
  "data": [
    { "url": "https://storage.googleapis.com/agnes-aigc/xxx.png", "b64_json": null, "revised_prompt": null }
  ]
}
```

### B. 图生图(`agnes-image-2.1-flash`)

图生图通过 `extra_body.image` 传公开 URL 数组:

```bash
curl https://apihub.agnes-ai.com/v1/images/generations \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "agnes-image-2.1-flash",
    "prompt": "Transform this image into a cinematic cyberpunk style while preserving the main subject",
    "size": "1024x768",
    "extra_body": {
      "image": ["https://example.com/input-image.png"],
      "response_format": "url"
    }
  }'
```

> [!WARNING]
> Agnes 图像 API 易踩坑点:
> - 文生图只传 `model` + `prompt` + `size`,**不要传** `image`。
> - **`response_format` 必须放 `extra_body` 内**,放请求体顶层会触发 400。
> - 图生图的 `image` 也放 `extra_body` 内。
> - **不要传** `tags: ["img2img"]` 之类的多余字段。
>
> 这些细节 media-gen-mcp 的 agnes provider 已在内部处理(`generate_image` 工具自动构造正确请求体),你只需关心 `prompt` / `images` / `size`。

### C. 文生视频 —— 创建异步任务(`agnes-video-v2.0`)

```bash
curl -X POST https://apihub.agnes-ai.com/v1/videos \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "agnes-video-v2.0",
    "prompt": "A cinematic shot of a cat walking on the beach at sunset, soft ocean waves, warm golden lighting",
    "num_frames": 121,
    "frame_rate": 24,
    "height": 768,
    "width": 1152
  }'
```

创建任务响应(拿到 `video_id`,用于轮询):

```json
{
  "id": "task_YOUR_TASK_ID",
  "task_id": "task_YOUR_TASK_ID",
  "video_id": "video_YOUR_VIDEO_ID",
  "model": "agnes-video-v2.0",
  "status": "queued",
  "progress": 0,
  "seconds": "5.0",
  "size": "1152x768"
}
```

### D. 视频轮询(用 `video_id`)

```bash
curl --location --request GET 'https://apihub.agnes-ai.com/agnesapi?video_id=video_YOUR_VIDEO_ID' \
  --header 'Authorization: Bearer YOUR_API_KEY'
```

完成时 `status: completed`,`url` 字段为可下载 mp4:

```json
{
  "video_id": "video_YOUR_VIDEO_ID",
  "model": "agnes-video-v2.0",
  "status": "completed",
  "progress": 100,
  "url": "https://platform-outputs.agnes-ai.space/videos/agnes-video-v2.0/video_xxxxxx.mp4",
  "error": null
}
```

> 注意轮询地址是 `https://apihub.agnes-ai.com/agnesapi`(不带 `/v1`)。media-gen-mcp 的 `get_video` 工具已自动用正确地址轮询。

### E. 视频帧数速查

`seconds = num_frames / frame_rate`。Agnes 要求 `num_frames` 满足 **8n+1 且 ≤441**。

| 目标时长 | num_frames | frame_rate | media-gen-mcp 调用方式 |
|---|---|---|---|
| ~3 秒 | 81 | 24 | `durationSeconds: 3` |
| ~5 秒(默认) | 121 | 24 | `durationSeconds: 5` 或省略 |
| ~7 秒 | 161 | 24 | `durationSeconds: 7` |
| ~10 秒 | 241 | 24 | `durationSeconds: 10` |
| ~18 秒(上限) | 441 | 24 | `durationSeconds: 18` |

在 media-gen-mcp 里传 `durationSeconds`,server 会自动选最近的合法 `num_frames`,无需手动算。

---

## 五、故障排查

按「现象 → 原因 → 解决」组织。先判断问题出在哪一层:

```
Claude Code 调用工具
    ↓ 工具层(media-gen-mcp)         ← 配置/参数问题,看 stderr
接口层(agnes provider 请求)
    ↓ 网络层                          ← 网络/Key 问题,用 curl 第四节验证
Agnes 官方 API                        ← 服务端问题,看错误码
```

### 配置类

**现象:工具调用报「image model 未配置 / video model 未配置」**

- **原因**:config.json 缺 `providers.agnes.models.image.default` 或 `models.video.default`。
- **解决**:参照[第二节最小配置](#1-最小配置)补全 `models` 块。

**现象:MCP 启动后行为异常 / 读不到配置**

- **原因**:配置文件路径不对。npx 装包到 npm 缓存,**项目内 config 不可用**,必须放在用户 home 全局。
- **解决**:确认配置在 `~/.media-gen-mcp/config.json`(不是项目目录里)。
- **排查**:本地跑 `node dist/index.js`,看 stderr 输出:
  ```bash
  cd /path/to/media-gen-mcp && node dist/index.js
  ```
  会打印配置加载、限速学习等日志。

**现象:JSON 解析失败**

- **原因**:config.json 语法错误(多余逗号、缺引号等)。
- **解决**:用 JSON 校验工具检查;server 启动时若解析失败会打印错误并回退到环境变量/默认值。

### 认证类

**现象:HTTP 401 Unauthorized**

- **原因**:API Key 错误 / 过期 / 未设置 / 账号状态异常。
- **解决**:
  1. 确认 config.json 的 `providers.agnes.apiKey` 是完整密钥(以 `sk-` 开头,无多余空格)。
  2. 到 platform.agnes-ai.com → Settings → API Keys 确认密钥有效、账号正常。
  3. 用[第四节 curl](#a-文生图agnes-image-21-flash)直接验证 Key,排除 MCP 因素。

### 限速类

**现象:HTTP 429 Too Many Requests**

- **原因**:超过 RPM 限制。免费用户视频 1 req/min 最易触发。
- **解决**:
  - **通常无需手动处理** —— server 内置 62s 串行化,正常调用不会撞 429。
  - 若仍撞 429,server 会自动学习真实限速并回写 config,稍后重试即可。
  - 急需更高限速:升级到 Token Plan(Starter 视频配额 500 秒/天,Pro 文本 30,000 req/5 小时)。

**现象:第二个视频创建「卡住」约 1 分钟才开始**

- **原因**:**这不是 bug**,是 server 的限流串行化在起作用(62s 间隔),保护你不撞 1 req/min 限速。
- **解决**:无需处理,等待即可。任务在后端排队,完成会自动通知。

### 参数类

**现象:HTTP 400 Bad Request**

- **原因**:请求参数错误。常见:
  - 图像 API 把 `response_format` 放在了请求体顶层(应放 `extra_body`)。
  - 文生图误传了 `image` 字段。
  - 图生图的图片 URL 不可达。
  - 视频的 `num_frames` 不满足 8n+1 或 >441。
- **解决**:
  - 通过 media-gen-mcp 调用时,provider 已自动构造正确请求体,通常不会遇到这些。
  - 直接调原生 API 时,严格对照[第四节示例](#四curl-验证示例)。

**现象:视频报「num_frames=XXX is not allowed by Agnes」**

- **原因**:Agnes 仅允许 `81 / 121 / 161 / 241 / 441`(8n+1, ≤441)。
- **解决**:传 `durationSeconds`(如 5、10),server 自动选最近合法值;或直接传合法的 `numFrames`。

### 视频任务类

**现象:视频任务一直 `in_progress`,迟迟不 `completed`**

- **原因**:视频生成耗时较长,约 `ceil(numFrames × 0.93)` 秒(121 帧 ≈ 113 秒,441 帧 ≈ 410 秒)。
- **解决**:
  - media-gen-mcp 智能异步:预估 >60s 自动返回 handle 不阻塞,完成自动通知。
  - 若会话中断,任务后端仍会完成,用 `get_video(videoId="...")` 二次捞回。

**现象:任务状态 `completed` 但没有 `url`**

- **原因**:Agnes 返回 completed 却未给下载链接(罕见,视为失败)。
- **解决**:media-gen-mcp 已把这种情况判定为 `failed`,重新提交即可。

**现象:HTTP 404 任务/视频未找到**

- **原因**:`video_id` / `task_id` 错误,或任务已过期被清理。
- **解决**:核对 ID;优先用 `video_id` 轮询(官方推荐)。

### 服务端类

**现象:HTTP 500 / 502 / 503 / 520**

- **原因**:Agnes 服务端临时错误。
- **解决**:稍后重试。media-gen-mcp 的轮询逻辑会持续重试到超时(默认 15 分钟)。

---

## 附录:接入清单(Checklist)

按顺序勾完即接入成功:

- [ ] 在 https://platform.agnes-ai.com/ 注册并完成邮箱验证
- [ ] Settings → API Keys → Create new secret key,拿到 `sk-...` 密钥
- [ ] 新建 `~/.media-gen-mcp/config.json`,填入 apiKey + models(image 默认 `agnes-image-2.1-flash`,video 默认 `agnes-video-v2.0`)
- [ ] `claude mcp add media-gen-mcp npx media-gen-mcp` 注册到 Claude Code
- [ ] 调用 `list_models` 确认返回 agnes 模型列表
- [ ] 跑一次 `generate_image` 出图、`create_video` 出视频

---

## 参考来源

- 官方模型目录(source of truth):https://github.com/AgnesAI-Labs/AgnesAI-Models
- 官方文档 Overview:https://wiki.agnes-ai.com/zh-Hans/docs/overview
- Quickstart:https://wiki.agnes-ai.com/zh-Hans/docs/quickstart
- Agnes Image 2.0 Flash:https://agnes-ai.com/doc/agnes-image-20-flash
- Agnes Image 2.1 Flash:https://agnes-ai.com/doc/agnes-image-21-flash
- Agnes Video V2.0:https://wiki.agnes-ai.com/zh-Hans/docs/agnes-video-v20
- API 平台:https://platform.agnes-ai.com/
