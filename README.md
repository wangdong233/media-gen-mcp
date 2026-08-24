<h1 align="center">media-gen-mcp</h1>

> Claude Code 的「图像全家桶」—— 造图、画想法、看懂图,一句话搞定,全免费。

<p align="center">
  <img src="https://img.shields.io/badge/version-0.13.1-blue">
  <img src="https://img.shields.io/badge/license-MIT-green">
  <img src="https://img.shields.io/badge/MCP-compatible-purple">
</p>

**给 Claude Code 装一次,以后所有图像活儿都是一句话。** 设计师出图、程序员画架构图、运营做分享卡、财务抠发票表格 —— 生图 / 视频 + 识别 + 画图 / 卡片 / 二维码全覆盖,**全免费**(免费服务方 + 本地引擎,装上即用)。

每周做几次图、装 N 个工具记 N 套参数很烦?这里只装一次,所有图像场景都丢给 Claude。

<div align="center">

**简体中文** | [English](README.en.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [日本語](README.ja.md) | [Português](README.pt.md) | [Русский](README.ru.md)

</div>

## 目录

- [你说一句话,得到什么](#你说一句话得到什么)
- [60 秒上手](#60-秒上手)
- [能力全家桶](#能力全家桶)
- [配置详解](#配置详解)
- [常见问题](#常见问题)
- [这是给谁的](#这是给谁的)
- [支持作者](#支持作者)
- [License](#license)

---

## 你说一句话,得到什么

| 你说 …… | 你得到 |
|---|---|
| "画只赛博朋克猫,霓虹辉光" | AI 写实图,落盘到 `output/` |
| "生成 5 秒海边日落视频" | AI 视频 MP4(后台生成,完成通知你) |
| "画个架构图:客户端 → API 网关 → 订单服务 + 支付服务" | 矢量架构图 |
| "把这组销售数据画成柱状图" | 高清数据图表 |
| "做个指向 github.com 的二维码" | 矢量二维码 |
| "把 E=mc² 渲染成高清公式" | 矢量公式 |
| "做张深色渐变分享卡,标题 7 月新品 🚀" | 排版好的分享卡(中文 + emoji 自动) |
| "识别这张发票截图里的表格" | 可粘贴的 HTML/Markdown 表格 |
| "把这张柱状图读成数据点" | 结构化 CSV/JSON 数据 |
| "描述一下这张图里有什么" | 自然语言回答 |
| "把这份 20 页 PDF 报告的文字全抠出来" | 整篇文本 / Markdown / JSON(数字版秒出,扫描件自动逐页 OCR) |
| "把这份合同扫描件提文字,水印和红章忽略掉" | 干净文本(自动剔除水印 / 红章 / 页眉页脚区域) |
| "这份双栏论文按阅读顺序合并成一段" | 单栏连续文本(多栏阅读序自动还原,不再串行错位) |
| "我现在能识别表格吗?中文 OCR 配好了吗?" | 当前能力清单 + 路由建议(哪个能用 / 哪个没配 / 该用什么) |

> 不用学工具名,不用装系统依赖,**Claude 自动挑最合适的方式完成**。

---

## 60 秒上手

核心思路:**画图 / 卡片 / 二维码 / 公式是本地引擎,识图(OCR 文字识别)也默认进程内兜底——全部不调 AI、不连网,装上即用**。只有 AI 写实图 / 视频才需要免费 API Key —— 把"第一张图"和"第一次读图"都提前到注册之前。

### 30 秒｜一行接入(零 Key)

```bash
# 一行装上(不带 Key,30 秒)
claude mcp add media-gen-mcp npx media-gen-mcp-server

# 重启 Claude Code → 输入 /mcp → 看到 media-gen-mcp ✓ Connected 即成功
```

### 30 秒｜免 Key 立刻出第一张图

直接对 Claude 说一句:

```
做张深色科技风的分享卡,标题:Claude Code 图像全家桶
```

→ 矢量图自动落盘到 `output/`,打开就能用。**你还没注册任何 API Key,已经拿到结果。**

下面这些也都是零 Key 零联网即时出:

- 「做个指向 github.com 的二维码」
- 「把 E=mc² 渲染成高清公式」
- 「画个架构图:客户端 → 网关 → 订单服务 + 支付服务 → 数据库,深色科技风」
- 「识别这张验证码图片里的数字」(OCR,默认进程内,不装任何东西)
- 「把这张截图里的英文文字提取出来」

### 想要中文 SOTA 识图 / 看图问答?配一行智谱 GLM Key(零部署,可选)

默认轻量引擎对英文 / 数字够用,中文准确率一般。**不想自建 PaddleX / vLLM,又想要中文 SOTA + 复杂表格 + 看图问答?** 配一行智谱 GLM Key 即可 —— 云端 **GLM-4.6V-Flash 永久免费**,零部署、零本地资源:

```bash
# ① 到 https://open.bigmodel.cn/console/apikey 注册免费账号 + 申请 api_key(格式 {id}.{secret})
#    注意:只接受 open.bigmodel.cn 标准 key;Code Plan key(ZAI_API_KEY)不可用 —— 它绑定 Z.ai 端点 + 白名单工具,违规调用会封号

# ② 写到 ~/.media-gen-mcp/config.json
{
  "providers": {
    "glm-vision": { "apiKey": "你的{id}.{secret}" }
  }
}

# ③ 回 Claude Code 说:"识别这张中文发票截图里的表格" / "这张图里有几个人?在做什么?"
#    → 中文 SOTA 识别 + 看图问答,落盘 / 直接回答
```

> 配好后 MCP 自动纳入 fallback 链:**paddle → glm-vision → vlm → tesseract**;哪一档临时挂掉自动降级,你无感。详见[配置详解 · 档位 2](#档位-2智谱-glm-46v-flash云端免费零部署中文-sota--vqa)。

### 想要 AI 写实图 / 视频?再加免费 API Key(可选)

```bash
# ① 拿免费 API Key(推荐 Agnes,默认服务方)
#    https://platform.agnes-ai.com/ → 注册 → API Keys → 复制 sk-xxx
#    (智谱 cogview-3-flash / cogvideox-flash 也永久免费,可二选一或都配)

# ② 写到 ~/.media-gen-mcp/config.json(只配一家也行)
{
  "providers": {
    "agnes": { "apiKey": "sk-你的agnes-key" }
  }
}

# ③ 回 Claude Code 说:"画只赛博朋克橙猫,写实风"
#    → AI 写实图落盘。视频同理:"生成 5 秒海边日落视频"
```

> 不想用 npx?全局装也行:先 `npm i -g media-gen-mcp-server`,再 `claude mcp add media-gen-mcp -s user "$(which media-gen-mcp-server)"`。

---

## 能力全家桶

> 直接对 Claude 说你想干嘛,它自动挑最合适的方式完成。下面按「你想做的事」分组 —— 你不用知道背后叫什么。

### 造一张图(从无到有)

**画一张写实照片或插画**
> 你:"画只赛博朋克橙猫,霓虹辉光,写实风"
> 得到:写实图落盘到 `output/`(也支持插画 / 产品概念图 / Logo 草稿 / 科幻场景)

**把一句话或一张图变成短视频**
> 你:"生成 5 秒海边日落视频"
> 得到:MP4 视频(3–18 秒;长视频后台生成,完成后通知你取片)

**抓一个图标或品牌 Logo**
> 你:"抓一个 GitHub 的 Logo,128 像素"
> 得到:20 万+ 图标库里的矢量 Logo,即下即用(GitHub / Twitter / Material / Lucide / Font Awesome 等)

**逆向 AI 生成图的提示词与参数**
> 你:"这张图是用什么 prompt、什么参数生成的?能复现吗?"
> 得到:结构化参数 —— 正向 / 负向 prompt、模型、采样步数、CFG、种子、尺寸(从 PNG 嵌入的 ComfyUI / A1111 元数据本地解析;Agnes 生成的图自带完整生成参数,拿到 prompt 可用 generate_image 一键复现)

### Google Flow 渠道(Veo 3.1 / Nano Banana,免 API Key,生图 0 积分)

**借本机 Chrome 的 Google Flow 登录态直接生图 / 生视频**(Google Labs 的 [labs.google/fx/tools/flow](https://labs.google/fx/tools/flow))—— 不用任何 API Key,也不占 Agnes / 智谱的免费配额;产物自动落盘,并带 `mediaId` 方便后续管理。

**前置条件(一次性)**:本机 Chrome 登录过 Flow。

```bash
lasso launch-chrome --port 9223 --mode visible
# 没装 lasso 先:npm i -g lasso-mcp
# 弹出 Chrome 后打开 https://labs.google/fx/tools/flow 并登录,之后保持 Chrome 运行即可
```

Chrome 没开 / 没登录时,工具返回**结构化错误码 + 指引**(S100 = 连不上 Chrome,S101 = 没有打开中的 Flow 页面),照提示启动一次就好 —— 绝不静默失败,也不偷偷换渠道。

**这些全部 0 积分(放心用)**:

- **生图**:Nano Banana Pro / Nano Banana 2(默认)/ Nano Banana 2 Lite;比例 16:9 / 9:16 / 1:1 / 3:4 / 4:3;seed 可复现;支持底图改图 + 最多 10 张参考图
- **放大**:图片 2K 放大(model=`GEM_PIX_2_UPSAMPLE_2K`)、视频 1080p 超分(model=`veo_3_1_upsampler_1080p`)
- **资产管理**:上传图片、批量删除、生成公开分享链接(`labs.google/fx/tools/flow/shared/…`)、取消生成中的视频、查积分 / 查媒体状态(`flow_status`);建角色实体并绑定 30 种预设语音(`flow_entity`)

**生视频按积分计费(每条,提交前请知悉)**:

| 模型 | key 举例 | 积分/条 |
|---|---|---|
| Omni Flash(abra)文生 / 图生 / 参考图 | `abra_t2v_4s` / `abra_i2v_8s` / `abra_r2v_10s` … | 7 / 10 / 12 / 15(按时长 4/6/8/10 秒) |
| Omni Flash 视频编辑(V2V) | `abra_edit` | 20 |
| Veo 3.1 Lite(含延长、首尾帧) | `veo_3_1_t2v_lite` / `veo_3_1_extension_lite` … | 10 |
| Veo 3.1 Fast | `veo_3_1_t2v_fast` … | 20 |
| Veo 3.1 Quality | `veo_3_1_t2v` … | 100 |
| 视频超分 1080p | `veo_3_1_upsampler_1080p` | **0** |

视频一次一条,时长 4 / 6 / 8 / 10 秒,比例仅 16:9 / 9:16;模式:文生视频(t2v)/ 图生视频(`image`,上传 0 积分)/ 参考图生视频(`images` 1–10 张)/ 首尾帧(`keyframes` 恰好 2 张)/ 延长(`videoMediaId`)/ 编辑(`videoMediaId` + 修改指令;wire 已定型,真实提交尚未线上验证,响应会带警示)/ 超分(`videoMediaId`)。

**用法(显式 `provider="flow"`)**:

```
"画张赛博朋克猫,用 Flow,3:4 比例,seed 42"       → generate_image(provider="flow", aspect="3:4", seed=42)
"用 Flow 生成 8 秒未来城市航拍视频"               → create_video(provider="flow", model="abra_t2v_8s")
"查一下 Flow 积分余额 / 这个 mediaId 生成完没"     → flow_status() / flow_status(mediaId=…)
```

**`flow_status` 自省工具(全程 0 积分)**:不带参数返回全景 —— 登录账号、积分余额、动态模型目录(含每个 key 的参考耗时)、30 种预设语音、项目媒体列表;带 `mediaId` 查单个媒体状态并下载成品(`thumbnail=true` 取视频缩略图);`deleteMediaIds` 批量删除、`shareMediaIds` 生成公开分享链接、`cancelMediaIds` 取消生成中的视频(图片不可取消)。

> **积分红线**:Flow 视频消耗积分,**默认绝不自动路由** —— 要么在 `videoProviderPriority` 显式列入(自担积分,启动时有强提示),要么每次显式 `provider="flow"`;生图想全自动白嫖,把 `flow` 配成 `imageProviderPriority` 链头即可(见下方「配置详解」)。

### 看懂一张图 / 一份 PDF(把图和文档变数据)

**从截图里抠出文字**
> 你:"把这张验证码里的数字读出来"
> 得到:纯文本(验证码 / 发票号 / 扫描文档 / 聊天记录都能抠)

**把表格图变成 HTML / Markdown**
> 你:"识别这张发票截图里的表格"
> 得到:可直接粘贴的 Markdown 表格(发票 / 报表 / 扫描件不用再手动重打)

**从图表反推原始数据点**
> 你:"把这张柱状图读成数据"
> 得到:CSV / JSON 结构化数据(柱状 / 折线 / 饼图都行)

**让它用大白话讲讲这张图**
> 你:"这张图里一共有几个人?在做什么?"
> 得到:自然语言回答(看图问答 / 手写 / 公式 / 复杂场景理解)

**把整份 PDF 的文字抠出来**
> 你:"把这份 20 页 PDF 报告的文字全抠出来,导出 Markdown"
> 得到:整篇文本 / Markdown / JSON —— 数字版 PDF 直接抽文字层秒出,扫描件自动逐页渲染 + OCR;支持指定页码范围(`3` / `1-10` / `odd` / `last`)、忽略水印 / 页眉页脚区域、多页合并或分页输出;长文档后台跑,完成通知你取结果(发票 / 合同 / 财报 / 论文 / 扫描书都行)

**让识图 / 读 PDF 结果更干净、更顺读**
> 你:「把这份合同扫描件提文字,**水印和红章忽略掉**」「这份双栏论文**按阅读顺序合并**成一段」
> 得到:干净、连续的文本 —— 两个开关在所有识图 / PDF 提取里都能用:
> - **忽略区域**:圈出水印 / 红章 / 页眉页脚 / 表头区域,识别结果自动剔除,合同 / 证书 / 扫描件不再被水印糊住
> - **多栏阅读序**:论文 / 报刊 / 简历 / 双栏 / 三栏排版,自动按人类阅读顺序合并成单栏连续文本,不再串行错位

**先问一句"我装的识别服务都能干啥"**
> 你:"我现在能识别表格吗?中文 OCR 配好了吗?手写识别能用吗?"
> 得到:当前能力清单 —— 三档识别服务哪个已配置 / 哪个没配 / 哪个正在冷却或出错,以及"要做表格识别该走哪个、手写识别该走哪个"的路由建议;**先问一句再动手,避免直接调用才发现报错**

### 把想法画清楚(免 Key,装上就能用)

**画结构图**
> 你:"画个架构图:客户端 → API 网关 → 订单服务 + 支付服务 → 数据库"
> 得到:矢量架构图(也支持流程图 / 时序图 / 类图 / ER 图 / 思维导图)

**画交互式 / 动态 HTML 图**(浏览器打开可交互,边数据流 + 节点动画,主题跟随系统深/浅色)
> 你:"画个架构图,浏览器打开能交互、能动、主题跟着系统走"
> 得到:单文件 HTML(D2 双调色板默认开箱即反色 + viewer 平移/缩放/主题切换/导出 SVG + 边数据流/依次高亮/节点入场三种动画,Motion Governor 自动守无障碍)

**画可下钻的嵌套架构图**(浏览器打开点层进入子架构,面包屑回溯任意层)
> 你:"把这套系统画成嵌套架构图:顶层 5 大模块,点'订单服务'进它的内部架构,再点进创建订单的时序图"
> 得到:单文件 HTML(点某层 → 切到那层内部架构,层级可任意嵌套,每层可以是架构图 / 时序图 / 类图 / ER 图 / 流程图;面包屑或 Esc 回任意祖先层;URL 深链分享到某一层;主题跟随系统深/浅色)

**把数据画成图表**
> 你:"把这组销售数据画成柱状图"
> 得到:高清数据图表(柱状 / 折线 / 饼图 / 面积 / 散点,丢一串数字或一份 CSV 都行)

### 做卡片 / 海报 / 二维码(发出去好看)

**做分享卡 / OG 图 / 引言卡 / 封面 / 海报**
> 你:"做张深色渐变分享卡,标题 7 月新品 🚀"
> 得到:排版精美的卡片(标题、副标题、渐变色、辉光、彩色 emoji、Logo 内嵌全自动,中文与日文汉字不乱码)

**生成二维码**
> 你:"做个指向 github.com 的二维码"
> 得到:矢量二维码(URL / 文本都行,海报印刷也清晰)

**把数学公式渲染成高清图**
> 你:"把 E=mc² 渲染成高清公式"
> 得到:矢量公式(LaTeX、复杂分式、化学方程式都支持)

### 做酷炫动效 / 科技感图形(同输入永远同输出)

**把 SVG 渲染成高清 PNG**
> 你:"画一个带辉光、星场、景深的科技感背景"
> 得到:酷炫 PNG,自动选最佳渲染方式保真不失真

**把 HTML / CSS 动画变成视频**
> 你:"做一个 3 秒的产品片头动画,渐变色 + 粒子"
> 得到:MP4 / GIF / WebM 视频(产品片头 / 品牌动画 / 动效演示,逐帧渲染,同输入永远同输出)

> **小提示**:造图 / 读图走联网 AI;画图 / 卡片 / 二维码 / 动画是本地引擎 —— **装上就能用、矢量高清、同样的输入永远出同样的图**。

---

## 配置详解

> 一句话:**结构化能力(画图 / 图表 / 卡片 / 二维码 / 公式)零配置开箱即用;AI 生成配一行 API Key;识图默认零配置,要中文 SOTA / 表格 / 图表才自托管。** 你想用的能力决定要配什么 —— 不用全配。

### 按「我想干什么」查配置

| 你想干什么 | 要配什么 | 配了立刻能用 |
|---|---|---|
| 画架构图 / 数据图表 / 卡片 / 二维码 / 公式 | **什么都不用配** | 本地引擎,装完即用 |
| AI 写实图 / AI 视频(文生图、文生视频) | 配一家免费 API Key(Agnes 或智谱,二选一) | 联网生成,落盘到 `output/` |
| 用 Google Flow 生图(0 积分)/ 管理生成资产 | **不用配 Key**:本机 Chrome 登录 Flow 即可(`lasso launch-chrome` 启动) | 生图 / 放大 / 上传 / 删除 / 分享 / 取消 / 查询全 0 积分;视频按积分计费(7–100 积分/条) |
| OCR 文字识别(英文 / 验证码 / 数字 / 简单文档) | **什么都不用配** | 默认走进程内轻量引擎,装完即用 |
| 中文 OCR / 发票表格 / 图表读数 / 看图问答 / 手写 / 公式 | **配一行智谱 GLM Key**(零部署,云端永久免费)**或** 自托管 PaddleX / vLLM | 配 GLM Key 即开即用;自托管服务跑起来后填一行 baseUrl |
| **PDF 文字提取**(数字版 / 扫描件 / 多页) | 装两个依赖 `npm i pdfjs-dist @napi-rs/canvas`(首次用 PDF 时装) | 数字版 PDF 秒出;扫描件按上面 OCR 档位走(默认零配置也能跑) |
| **去水印 / 红章 / 页眉页脚、多栏阅读序还原** | **什么都不用配** | 调识图 / PDF 工具时直接说"Claude,忽略水印"或"按阅读顺序合并",自动应用 |
| **查当前识别能力**(哪个能用 / 哪个没配) | **什么都不用配** | 直接问,Claude 回一份当前能力清单 + 路由建议 |

---

### 一、生成类配置(AI 生图 / 视频)

**默认服务方:Agnes**(免费层永久有效,文生图 + 文生视频全开放)。智谱为备选(中文场景原生优化)。

**配一家就够**(以下是完整 `config.json`,只填一家也行):

```json
{
  "providers": {
    "agnes": { "apiKey": "sk-你的agnes-key" },
    "zhipu": { "apiKey": "你的智谱-key" }
  },
  "defaultProvider": "agnes",
  "outDir": "/absolute/path/to/output"
}
```

**免费 API Key 怎么拿**:

- **Agnes**(推荐,默认):https://platform.agnes-ai.com/ → 注册 → API Keys → 复制 `sk-xxx`
- **智谱**:https://open.bigmodel.cn/ → 注册 → API Keys(免费模型:`cogview-3-flash` / `cogvideox-flash`,永久免费)

**配两家更稳**:任一家临时挂掉(限流 / 服务波动),另一家自动顶上,你零感知、零重复扣费。

**渠道优先级链(可选,一行让生图走 Google Flow 免费档)**:在 `config.json` 加 `imageProviderPriority` / `videoProviderPriority`,即「链头 → 回落顺序」;链头失败(限流/5xx)或环境不满足(如 Flow 需要本机 Chrome CDP 在开)时**按序自动回落**,你零感知:

```json
{
  "imageProviderPriority": ["flow", "agnes", "zhipu"],
  "videoProviderPriority": ["agnes", "zhipu"]
}
```

- **生图 flow 优先**:Flow 生图 0 积分;Chrome 没开/未登录时自动回落 agnes → 智谱(每次探测有 60 秒熔断,不反复重试)。调用时显式传 `provider` 则钉死该渠道,不回落。
- **视频默认仍 agnes 优先**(免费);Flow 视频消耗积分,**刻意不进默认链**——要么在 `videoProviderPriority` 里显式写入(自担积分),要么每次显式 `provider="flow"`。
- 不配置这两项 = 现行为(默认渠道 + agnes/智谱免费层自动互备),零影响。环境变量等价:`MEDIA_IMAGE_PROVIDER_PRIORITY="flow,agnes,zhipu"` / `MEDIA_VIDEO_PROVIDER_PRIORITY="agnes,zhipu"`。

**Flow 资产管理(全 0 积分)**:`flow_status` 除了查积分 / 查媒体状态 / 下载,还支持三件零消耗操作——`shareMediaIds=[…]` 生成公开分享链接(形如 `labs.google/fx/tools/flow/shared/image/<id>`,含提示词)、`cancelMediaIds=[…]` 取消生成中的视频(注意:图片生成不可取消)、`deleteMediaIds=[…]` 批量删除。`flow_entity` 工具可创建角色实体并绑定预设语音(30 种声线,先 `generate_image(provider="flow")` 出形象图再绑),后续生成可复用该角色。

**配置文件位置**:`~/.media-gen-mcp/config.json`(macOS / Linux)或 `%USERPROFILE%\.media-gen-mcp\config.json`(Windows)。

> 这个文件**没有也不会崩** —— 结构化能力和默认 OCR 照常工作,只是不能调 AI 生成。

---

### 二、识别类配置(识图 / OCR / 表格 / 图表 / 视觉理解)

识别能力**分四档**,按需选装,默认就能用第一档。

#### 档位 1:默认轻量引擎(零配置,装上即用)

- **能干什么**:英文 / 数字 / 验证码 / 简单文档 OCR
- **要不要装服务**:**不用**,以 WASM 形式打包进 MCP 进程,首次调用时自动加载语言模型
- **最小资源需求**:
  - CPU:任意(纯 CPU 运行,无 GPU 依赖)
  - GPU:不需要
  - 内存:约 200–500MB(随图片大小波动)
  - 磁盘:约 30–50MB(WASM 引擎 + 语言包)
  - 模型大小:含在上面磁盘占用里(英文语言包,几 MB 级)
- **速度**:单张约 3–5 秒
- **适合谁**:90% 的轻量 OCR 场景、海外文档、验证码识别

> 大多数用户到这一档就够,下面三档是可选加强。

#### 档位 2:智谱 GLM-4.6V-Flash(云端免费,零部署,中文 SOTA + VQA)

- **能干什么**:中文 OCR(SOTA 级)、复杂表格(多层表头 / 合并单元格)、图表分析、看图问答(VQA)—— 全 4 task,云端 GLM-4.6V-Flash
- **要不要装服务**:**不用**,智谱开放平台云端 API,注册账号拿 api_key 即可
- **最小资源需求**:**零**(纯 HTTP 调用,无 CPU / GPU / 磁盘开销)
- **速度**:单张约 1–3 秒(云端,含网络往返)
- **费用**:**GLM-4.6V-Flash 永久免费**(128K 上下文 + 32K 输出),对标 GLM-4-Flash 文本免费策略
- **适合谁**:想要中文 SOTA + VQA 但**不想自建 PaddleX / vLLM** 的用户;完美补上档位 3/4 自建服务的部署门槛
- **怎么配**:到 [open.bigmodel.cn](https://open.bigmodel.cn/console/apikey) 注册免费账号 + 申请 api_key(格式 `{id}.{secret}`),在 `config.json` 加:

  ```json
  {
    "providers": {
      "glm-vision": { "apiKey": "你的{id}.{secret}" }
    }
  }
  ```

  默认模型 `glm-4.6v-flash`,可经 `providers["glm-vision"].model` 改为 `glm-4v-flash`(免费轻量)或付费视觉模型(`glm-4.6v` / `glm-ocr` 等)。配置后 MCP 自动纳入 fallback 链:**paddle(10)→ glm-vision(9)→ vlm(8)→ tesseract(1)**。

- ⚠️ **合规说明**(重要):
  - 仅接受 **open.bigmodel.cn 标准 api_key**;**Code Plan key(ZAI_API_KEY)不可用** —— 绑定 Z.ai 专用端点 + 限 9 个白名单工具(Claude Code / Cline / Cursor 等,media-gen-mcp 不在内),违规调用 3 次封号且订阅费不退
  - 多 key 轮换(`apiKeys: ["k1", "k2", ...]`)技术上支持,但**智谱 User Agreement §2/§3 禁止多账号 / 账号共享** —— 多 key 轮换可能违约,平台有权封号。请确认所有 key 均为合规自有账号

#### 档位 3:PaddleX / PP-StructureV3(中文 SOTA + 表格识别)

- **能干什么**:中文 OCR(效果显著强于默认引擎)、版面分析、**发票 / 报表 / 扫描件 → HTML/Markdown 表格**、图表读数
- **要不要装服务**:**要**,自托管 PaddleX REST 服务,MCP 通过 `baseUrl` 调用
- **最小资源需求**(实测):

  | 模式 | 最低门槛 | 推荐 | 说明 |
  |---|---|---|---|
  | GPU 模式 | RTX 3060 12GB VRAM | RTX 3060 12GB / Tesla T4 | 模型加载约 2.4GB,处理复杂 PDF 峰值约 6GB |
  | CPU 模式 | 4 核 CPU + 8GB 内存 | 8 核 + 16GB 内存 | 能跑(轻量文档可用),批量 / 复杂 PDF 明显慢 3–5 倍 |
  | 磁盘 | 约 3GB | 约 5GB | paddlepaddle + paddlex + 模型权重 |
  | 模型大小 | 约 100–300MB(单pipeline) | — | 多 pipeline 累加 |

- **CUDA 要求**:Compute Capability ≥ 7.0(V100 / T4 / RTX 20/30/40 系;50 系暂未完全适配),需 CUDA 11.8 + cuDNN 8.9 + TensorRT 8.6 才有 GPU 加速
- **怎么装**:

  ```bash
  pip install paddlex paddlepaddle          # GPU 版:paddlepaddle-gpu
  paddlex --serve --pipeline PP-StructureV3.yaml --port 8080
  ```

  然后在 `config.json` 加一行:

  ```json
  {
    "providers": {
      "paddle": { "baseUrl": "http://127.0.0.1:8080" }
    }
  }
  ```

#### 档位 4:vLLM + Qwen2.5-VL(通用视觉理解 VLM)

- **能干什么**:看图问答、手写识别、公式识别、复杂场景自然语言描述 —— PaddleX 搞不定的"理解类"任务
- **要不要装服务**:**要**,自建 vLLM 推理服务
- **最小资源需求**(实测):

  | 模式 | 最低门槛 | 推荐 | 说明 |
  |---|---|---|---|
  | GPU 满精度 7B(FP16) | 16GB VRAM | **24GB VRAM**(RTX 3090 / 4090 / A5000) | 模型权重约 15–16GB + KV cache,vLLM 默认占用 90% 显存 |
  | GPU 量化 7B(INT8/AWQ) | 10–12GB VRAM | 16GB VRAM | 量化版可塞进 RTX 4080 / 4060 Ti 16GB |
  | GPU 轻量版 3B | 6–8GB VRAM | GTX 1660 / 3060 6–8GB | FP16 约 6–8GB,INT4 约 3–4GB,个人开发者甜点 |
  | CPU 模式 | 不推荐 | — | 能跑但慢 5–10 倍,生产场景请上 GPU |
  | 内存 | 16GB | 16–32GB | — |
  | 磁盘 | 约 14GB(7B 权重) | — | 3B 约 6GB |
  | CUDA 要求 | Compute Capability ≥ 7.0 | — | Tesla T4(7.5)起步,V100 / A100 / RTX 30/40 系均可 |

- **怎么装**:
  ```bash
  pip install vllm
  vllm serve Qwen/Qwen2.5-VL-7B-Instruct --port 8000
  # 看到 "Uvicorn running on http://0.0.0.0:8000" 即就绪
  ```
  更多参数(GPU 选择 / 量化版本 / 并发上限)见 [vLLM 官方文档](https://docs.vllm.ai)。然后在 `config.json` 加:

  ```json
  {
    "providers": {
      "vlm": { "baseUrl": "http://127.0.0.1:8000" }
    }
  }
  ```

##### 进阶:Unlimited-OCR 长文档解析(SGLang/vLLM 自托管)

档位 4 默认 Qwen2.5-VL 是通用 VLM(看图问答 / 场景描述强)。如果你要的是**长文档 OCR / 复杂表格 / 多页 PDF 一次性解析**(单图几千~上万字),切到 [baidu/Unlimited-OCR](https://github.com/baidu/Unlimited-OCR)(MIT,Deepseek-OCR 路线推进一步)。它**训练分布只用 2 词 prompt** `document parsing.`,长输出靠 `custom_logit_processor`(DeepseekOCRNoRepeatNGram)防退化,与 Qwen2.5-VL 是不同档位的工具。

**配 Unlimited-OCR 时,`vlm` provider 自动通放全 4 task**(extract-text/extract-table/describe-image/analyze-chart),且 `extract-text` / `extract-table` 走 README 单图契约短 prompt;`describe-image`(VQA)与 `analyze-chart`(JSON 抽取)仍走原长 prompt —— 你不用手写 prompt override,MCP 按模型自动选。

**部署(SGLang,推荐 — 支持 `custom_logit_processor` 全特性)**:

```bash
# 拉镜像(详见 Unlimited-OCR README)
docker pull vllm/vllm-openai:unlimited-ocr          # 默认 CUDA 13.0
# Hopper GPU 用 cu129:
# docker pull vllm/vllm-openai:unlimited-ocr-cu129

# 启动 SGLang server(关键参数解释见 Unlimited-OCR README「SGLang」节)
python -m sglang.launch_server \
  --model baidu/Unlimited-OCR \
  --served-model-name Unlimited-OCR \
  --attention-backend fa3 --page-size 1 \
  --mem-fraction-static 0.8 --context-length 32768 \
  --enable-custom-logit-processor \
  --host 0.0.0.0 --port 10000
```

`custom_logit_processor` 是 Python 端 `DeepseekOCRNoRepeatNGramLogitProcessor.to_str()` 的字符串化产物(SGLang 私有序列化格式,TS 侧无法合成)。**部署期跑一次**取串,粘进 `config.json`:

```bash
# 在装了 sglang 的 Python 环境里跑一行:
python -c "from sglang.srt.sampling.custom_logit_processor import DeepseekOCRNoRepeatNGramLogitProcessor as P; print(P.to_str())"
# 输出一行长字符串,复制到下面 config.json 的 custom_logit_processor 字段
```

**config.json 示例**(把 `vlm` 切到 Unlimited-OCR + 配置 `extra_body` 扩展字段):

```json
{
  "providers": {
    "vlm": {
      "baseUrl": "http://127.0.0.1:10000",
      "models": { "default": "Unlimited-OCR" },
      "extra_body": {
        "images_config": { "image_mode": "gundam" },
        "custom_params": { "ngram_size": 35, "window_size": 128 },
        "custom_logit_processor": "<上一步 python -c 打印的串>",
        "skip_special_tokens": false
      }
    }
  }
}
```

字段含义(全部顶层,SGLang OpenAI 兼容 API 接受;MCP 直接 `Object.assign` 摊平进 fetch body):

| 字段 | 取值 | 说明 |
|---|---|---|
| `images_config.image_mode` | `gundam` / `base` | 单图高精度选 `gundam`(base_size=1024, image_size=640, crop_mode=true);多页 PDF 选 `base`(image_size=1024, crop_mode=false)。media-gen-mcp 是**单图契约**,默认 `gundam` 最优 |
| `custom_params.ngram_size` | `35`(推荐) | NoRepeatNGram 长度,35 是 README 推荐值 |
| `custom_params.window_size` | `128`(单图) / `1024`(多页) | 单图走 128;media-gen-mcp 单图契约建议 128 |
| `custom_logit_processor` | Python 端 `.to_str()` 输出 | 必填(否则长输出会重复退化);TS 无法合成,须 Python 跑一次取串 |
| `skip_special_tokens` | `false` | OCR 任务须保留特殊 token,不要 skip |

> ⚠️ **task 门控(重要)**:`extra_body`(含 `custom_logit_processor` / `skip_special_tokens:false` / `images_config.image_mode:gundam`)只在 `extract-text` / `extract-table`(OCR 路径)上摊入 fetch body —— `describe-image`(VQA)和 `analyze-chart`(JSON 抽取)**不带这些字段**。原因:NoRepeatNGram(ngram_size=35)会压制 VQA 描述里合理重复词;`skip_special_tokens:false` 会把 OCR 结构 token 泄漏进 description / 污染 `analyze-chart` 的 `JSON.parse`;`image_mode:gundam`(crop_mode=true)切片整图会破坏场景级 VQA 整体理解。这是 model-aware 短 prompt 门控(`promptForUnlimited`)的对称设计 —— `describe-image` / `analyze-chart` 仍走原长 prompt,也仍走干净 body。若你需要对 `describe-image` / `analyze-chart` 强制传扩展字段,用 per-call `extra`(在 `extract_text` / `extract_table` / `describe_image` / `analyze_chart` 工具的 `extra` 参数里传),它不受 task 门控约束。

**调用**:`extract_text` 工具显式传 `provider=vlm`(否则走 defaultVisionProvider=tesseract):

```
extract_text(image="data:image/png;base64,...", provider="vlm")
```

**重要限制**:

- **非 stream 模式**:media-gen-mcp 走 vLLM/SGLang 的**非 stream** `/v1/chat/completions`(JSON 一次性返回),适合单页 / 中短文档。Unlimited-OCR 的 `infer.py` 默认 `stream:true`,**不要把 `stream:true` 抄进 `extra_body`** —— MCP 检测到会 reject 并提示「请移除 extra.stream」。超长 PDF 建议先用 [PyMuPDF 拆页](https://github.com/baidu/Unlimited-OCR#transformers)(README 给了 `pdf_to_images` snippet)再逐页调 `extract_text`,每页独立请求天然规避超长输出。
- **server 超时**:长文档生成耗时高,vLLM 默认 60s 不够时改 SGLang `REQUEST_TIMEOUT` 或 vLLM `--timeout-keepalive`。
- **GPU 门槛**:16–24GB VRAM(同档位 4);跑不动者继续用 paddle(10)/glm-vision(9) 链。

**License**:[MIT](https://github.com/baidu/Unlimited-OCR/blob/main/LICENSE)(对齐纯免费立场,与 Qwen Apache-2.0 同档,企业可商用)。

#### 四档对比速查

| 档位 | 装不装服务 | 资源门槛 | 中文 | 表格 | 看图问答 | License / 来源 |
|---|---|---|---|---|---|---|
| **1 默认**(tesseract) | 不装 | 零(纯 CPU WASM) | 一般 | ❌ | ❌ | Apache 2.0(自建) |
| **2 智谱 GLM-4.6V-Flash** | 不装(云端 API) | 零(纯 HTTP) | ✅ SOTA | ✅ | ✅ | 用户自备智谱 key(永久免费) |
| **3 PaddleX** | 装 | GPU 12GB 或 CPU 4 核 8GB | ✅ SOTA | ✅ | ❌ | Apache 2.0(自建) |
| **4 vLLM Qwen2.5-VL** | 装 | **GPU 16–24GB**(CPU 不可用) | ✅ | 一般 | ✅ | Apache 2.0(自建) |

> 自建三档(1/3/4)刻意只选 **Apache 2.0** 引擎(tesseract.js + PaddleOCR + Qwen2.5-VL),避开 AGPL / GPL / 商用申请陷阱,**企业可直接商用**。档位 2 智谱是云端 API(GLM-4.6V-Flash 永久免费,用户自备 key),非自建 —— 适合不想部署服务器的用户补齐中文 SOTA + VQA 能力。

---

### 三、自动兜底机制(配了就不用管)

- **生成侧**:Agnes ↔ 智谱,任一家失败自动切另一家(60 秒内连续失败触发软切换,你不用重启、不用改配置)
- **识别侧**:默认轻量引擎(进程内兜底)→ PaddleX → vLLM,按能力自动降级
- **唯一例外**:视频轮询取片时**不切换**(避免拿到错的结果)
- 你要做的:配两家生成 API Key + 可选装一档识别服务,剩下的交给 Claude

> 你机器跑不动 PaddleX 或 vLLM?**继续用默认轻量引擎即可**,MCP 不会因为没装本地服务而报错 —— 只是中文 SOTA / 表格 / 看图问答 这几项能力不可用,其它全照常。

---

## 常见问题

**Q:不装任何东西能用吗?**
A:能。装上 MCP 就有画图 / 卡片 / 二维码 / 公式 / 数据图表 + 英文 / 验证码 OCR,全部本地跑,零联网。

**Q:识别中文乱码吗?**
A:默认轻量引擎对英文 / 数字 / 简单文档够用,中文准确率一般。要中文 SOTA 自托管 PaddleX(GPU 12GB 或 CPU 4 核 8GB),详见上方[配置详解](#配置详解)。

**Q:AI 视频要等多久?**
A:5 秒视频约 1–3 分钟,18 秒视频可能 5–10 分钟。后台异步生成,完成后自动通知你取片;预估 ≤60 秒的会同步等。

**Q:我的 RTX 3060 能跑表格识别吗?**
A:能。PaddleX GPU 模式最低 12GB VRAM(RTX 3060 12GB 正好),CPU 模式 4 核 + 8GB 内存也能跑(慢 3–5 倍)。详见[配置详解](#配置详解)。

**Q:中文 / emoji / 渐变能正常出吗?**
A:能。分享卡通过内置中文字体 + 排版引擎全自动支持中文、日文汉字、彩色 emoji、渐变标题、辉光效果,无需额外字体配置。

**Q:支持 Mermaid 吗?**
A:不支持(需要浏览器)。用 D2 或 Graphviz 代替,能力等价且更稳,矢量输出。

**Q:踩限流(429)?**
A:免费层有每分钟请求数限制。配两家服务方(Agnes + 智谱)后自动切换,基本无感。

**Q:视频帧数限制?**
A:随分辨率递减 —— 1080p ≤ 241 帧(约 10 秒),720p 可达 441 帧(约 18 秒)。可问 Claude 查实时约束。

**Q:npx 连不上 / 启动慢?**
A:全局装也行:先 `npm i -g media-gen-mcp-server`,再 `claude mcp add media-gen-mcp -s user "$(which media-gen-mcp-server)"`。

**Q:能用敏感词 / 武器 / 战争题材吗?**
A:真实武器词会触发内容过滤。改用科幻设定词(如"未来战甲"、"机甲")可绕过,效果等同。

**Q:Claude 会不会选错工具?(比如「做张分享卡」时去调生图)**
A:这类模糊请求的路由已经做过校准 —— 「做卡片 / 海报 / OG 图」「把图表里的数据读出来」「做产品片头动画」「画架构图 / 流程图」「把这组数据画成柱状图」等会自动落到合适的专用工具,无需手动纠正。当然你也可以在请求里直接点名某个工具。

---

## 这是给谁的

- **Claude Code 重度用户** —— 每周都要做几次图像任务,不想为每件事装一个 MCP、记一套参数。
- **写技术文档 / 博客的开发者** —— 反复需要架构图、时序图、ER 图、数据图、公式,不想离开工作流。
- **个人开发者 / 独立产品** —— 关注成本(全免费)与可控(同输入同输出),不想为图像任务单独搭后端。
- **数据 / 财务 / 法务** —— 双向场景:把数据画成图表,从截图 / 发票 / **PDF 报告 / 合同**里反向抽数据点(水印 / 红章可忽略,双栏论文按阅读序合并)。
- **教育 / 学术** —— 学生从课件截图 / 扫描讲义 / 论文 PDF 提文字、把双栏论文合并成连续文本、问图表里读出的数据;老师把纸质试卷扫描件变成可编辑文本。
- **运营 / 内容创作者 / 公众号作者** —— 分享卡 / OG 图 / 海报 / 二维码,中文 + 彩色 emoji + 渐变开箱即用。

> **不太适合**:不用 Claude Code 的用户;只要单一能力且已搭好流水线的工程化团队;需要付费商用模型 / 训练微调 / 实时视频 OCR 的场景(这些超出免费 MCP 范围)。

---

## 💝 支持作者

如果 media-gen-mcp 帮到你,欢迎请作者喝杯咖啡 ☕

<div align="center">

微信 | 支付宝
:-: | :-:
<img src="doc/support-wechat.jpg" height="200" alt="微信赞赏"> | <img src="doc/support-alipay.jpg" height="200" alt="支付宝赞赏">

</div>

或 ⭐ [Star 这个仓库](../../stargazers)、[提 Issue](../../issues) / [发 PR](../../pulls) —— 都是对作者的鼓励与支持。

---

## License

**MIT** —— 主体代码随便用。

识别侧依赖全栈 **Apache 2.0**(tesseract.js + PaddleOCR + Qwen2.5-VL),企业商用无 license 风险。

---

> 技术细节:服务方与引擎都可插拔,结构化工具同输入同输出可入 git,失败自动切换服务方。贡献者详见 `CONTRIBUTING.md`,完整文档见 `docs/` 目录。

<p align="center">
  <sub>Built for everyone who'd rather <strong>say it</strong> than <strong>script it</strong>.</sub><br>
  <sub>装一次,以后所有图像活儿都是一句话。</sub>
</p>
