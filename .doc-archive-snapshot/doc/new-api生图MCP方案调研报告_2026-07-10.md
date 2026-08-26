# Claude Code 通过 new-api 调用图像生成模型 —— 开源方案调研报告

> **调研日期**：2026-07-10
> **调研方法**：deep-research 工作流 —— 97 个子 agent、5 路并行 Web 搜索、URL 去重抓取 top 源、3 票对抗式验证（需 2/3 反对方可否决）、综合带引用报告；共消耗 ~390 万 token、693 次工具调用、耗时约 65 分钟。
> **核心问题**：让 Claude Code (CC) 通过 new-api / one-api 这类 OpenAI/Anthropic 兼容网关，调用图像生成模型（DALL·E / Midjourney / Stable Diffusion 等），重点是 MCP server 方案。
> **背景**：CC 本身只走对话端点 `/v1/messages`，不会自己调 new-api 的 `/v1/images/generations`，所以需要中间层（MCP / 脚本 / 插件）。用户已有 new-api 实例并配好了生图渠道，想找现成开源方案、能配置自定义 base_url 指向自己的 new-api，避免从零写。

---

## 一、执行摘要（TL;DR）

1. **new-api / one-api 官方都没有 MCP server** —— 缺失的正是「网关端点 ↔ CC」这层桥。one-api 有用户在 issue #2220 主动请求该功能，反证当前不存在。
2. **唯一推荐：`lansespirit/image-gen-mcp`** —— 经源码级验证，是唯一支持配置自定义 OpenAI 兼容 `base_url`、能直接指向自建 new-api 的图像 MCP。README 含专门 Claude Code 章节。**但只支持 OpenAI 系（gpt-image / dall-e）+ Google Imagen，不支持 midjourney / SD。**
3. 其余 4 个候选 MCP（shinpr/mcp-image、SureScaleAI/openai-gpt-image-mcp、jezweb/openai-mcp、jerryzhao173985/openai-image-gen-mcp）都硬编码 OpenAI 端点和/或模型名，无法开箱即用指向 new-api，需 fork 改源码。
4. **空白点**：没有任何现成 MCP 支持 midjourney 或 stable-diffusion；而 new-api/one-api 网关本身是支持这两类渠道的。
5. 更轻量替代：skill + bash 脚本（openai SDK 原生支持自定义 baseURL），偶尔画图首选。

---

## 二、核心发现（逐条，附证据与置信度）

### 发现 1 ⭐：推荐方案 `lansespirit/image-gen-mcp` 【置信度：高，3-0 一致】

**这是唯一经源码验证、支持配置自定义 OpenAI 兼容 base_url 的图像生成 MCP server，可直接指向自建 new-api。**

- **一级源码验证**：
  - `.env.example` 含 `PROVIDERS__OPENAI__BASE_URL=https://api.openai.com/v1`
  - `providers/openai.py:191-194` 实际接线 `AsyncOpenAI(api_key=..., base_url=config.base_url or 'https://api.openai.com/v1')`
  - `providers/openai.py:368` 调用标准 `self.client.images.generate(...)` —— 即 new-api 暴露的 `/v1/images/generations`
- **Claude Code 原生支持**：README 有专门章节，命令 `claude mcp add image-gen-mcp /path/to/start-mcp.sh -e PROVIDERS__OPENAI__API_KEY=...`，引用的 `start-mcp.sh` 真实存在（执行 `uv run python -m image_gen_mcp.server`）。
- **活跃度**：63 stars，最后推送 2026-04-25（活跃）。
- **限制**：模型仅支持 OpenAI（gpt-image-2/1.5/1、dall-e-3/2）与 Google Imagen（imagen-4 系列），**无 midjourney / stable-diffusion**。
- 来源：https://github.com/lansespirit/image-gen-mcp
- 投票：claims [5][6][7] 均 3-0

### 发现 2：new-api 与 one-api 官方均无 MCP server 【置信度：高】

缺失的正是连接网关端点的 MCP 桥接层。

- **new-api（QuantumNous/new-api）一级仓库验证**：
  - `CLAUDE.md` 仅为贡献者约定文件（@AGENTS.md），目录树无 `mcp/` 文件夹
  - 全文档搜 "MCP server / Model Context Protocol" 返回零命中
  - `service/` 与 `relay/` 全是中继/计费/认证逻辑
  - README 自述为"统一 AI 模型聚合分发的集中式网关"，在"支持接口"下明确列出"图像接口(Image)"，模型类型表含 Midjourney-Proxy(Plus)
- **one-api（songquanpeng/one-api）验证**：
  - README 功能列表第 17 项"支持绘图接口"，文档明确 `OPENAI_API_BASE` 可指向自建 one-api 实例（"使用方式与 OpenAI API 一致"），issue #709 有用户成功调用 `/v1/images/generations`
  - README（480 行）grep `mcp` / `model context protocol` 返回零命中
  - **issue #2220 有用户主动请求增加 MCP 功能** —— 反证当前无 MCP
- 来源：https://github.com/QuantumNous/new-api · https://github.com/songquanpeng/one-api
- 投票：claims [10](2-1) [11](3-0) [12](3-0) [13](3-0)

### 发现 3：其余四个图像 MCP 无法开箱即用 【置信度：高】

均硬编码 OpenAI 端点和/或模型名，无法开箱即用指向自建 new-api，需 fork 改源码。

1. **shinpr/mcp-image**：明确支持 Claude Code（README 含 `claude mcp add`），但 OpenAI 模式硬编码 `gpt-4o-mini`（prompt 增强）与 `gpt-image-2`（生图），为 const 常量且无 env 覆盖；README 自述"model choices are fixed by the server and are not configurable"。注：OpenAI SDK 构造函数未传 baseURL，端点路由依赖 SDK 原生的 `OPENAI_BASE_URL` 环境变量（隐式约定），与模型名硬编码问题正交。
2. **jezweb/openai-mcp**：`src/dalle.ts` 中 URL 硬编码为字面量 `https://api.openai.com/v1/images/generations`，全仓仅读 `OPENAI_API_KEY`，无 base_url 参数。
3. **jerryzhao173985/openai-image-gen-mcp**：仅 gpt-image-1，Zod schema 为 gpt-image-1 专属（DALL·E 3 的 size/quality 会校验失败）；且存在安全反模式（脚本内嵌 API key）、README 模板占位符未替换，质量较低。
4. **SureScaleAI/openai-gpt-image-mcp**：TS + MIT，暴露 create-image / edit-image，明确列出 Claude Desktop；但 base_url 不支持 claim 在对抗验证中被否决（1-2）。

- 来源：https://github.com/shinpr/mcp-image · https://github.com/jezweb/openai-mcp · https://github.com/jerryzhao173985/openai-image-gen-mcp · https://github.com/SureScaleAI/openai-gpt-image-mcp
- 投票：claims [0](3-0) [1](2-1) [2](3-0) [3](3-0) [4](3-0) [8](3-0) [9](2-1)；三个 base_url claim 被否决

### 发现 4：空白点 —— 无 midjourney / stable-diffusion 的 MCP 【置信度：高】

未发现任何支持 midjourney 或 stable-diffusion 模型族的图像生成 MCP server —— 所有候选仅覆盖 OpenAI（dall-e / gpt-image）与 Google Imagen。而 new-api/one-api 网关本身支持 Midjourney-Proxy 及 SD 渠道。

- image-gen-mcp README 与 release 仅列 OpenAI 5 模型 + Google Imagen，架构只有 `providers/openai.py` 与 `providers/gemini.py`，无 midjourney/SD/flux；jerryzhao173985 仅 gpt-image-1。
- 全文档搜索未发现任何 MCP server 提及 midjourney / stable-diffusion。
- 相反，new-api 模型类型表确列 Midjourney-Proxy(Plus)，one-api 适配 DALL·E / 文心一格 / 通义万相 / 星火绘图。
- 独立发现 `Ichigo3766/image-gen-mcp`（SD/Flux）、`frankdeno/flux-image-generator-mcp` 等不同项目，未被纳入本次验证且未确认支持自定义 base_url。
- **结论**：若需通过 new-api 调用 midjourney/SD，无现成 MCP，需自写 —— 最小方案为用 FastMCP 包装 `/v1/images/generations`（配 base_url）与 `/mj/submit/*` 系列（task-based）端点。
- 来源：https://github.com/lansespirit/image-gen-mcp · https://github.com/QuantumNous/new-api
- 投票：由 claims [7](3-0) [9](2-1) [11](3-0) 推导

### 发现 5：非 MCP 集成方式均不满足"指向自建网关" 【置信度：高】

1. **hex/claude-image-generation**：Claude Code 插件（slash command `/generate-image` + agent + skill + bash 脚本），完全不用 MCP；`scripts/openai.sh` 硬编码 `https://api.openai.com/v1/images/generations`，配置仅 API key + 模型名覆盖，**无 base_url**，指向 new-api 需改 bash 脚本。
2. **oakplank/claude-gpt-image-bridge**：经 codex CLI 用 ChatGPT 订阅 OAuth 认证（非 API key），**与 new-api 的 Bearer key 认证不兼容**，无法指向自建网关；README 对比表明确区分 "subscription route" 与 "API route"。
3. **Replicate 自定义命令**（pascal-poredda 博客）：走 Replicate 私有 `/v1/predictions` API（非 OpenAI 兼容），需重写为 OpenAI schema 才能对接 new-api；存在第三方 replicate-openai 包装器反证其原生不兼容。
4. **Codex CLI 直调**（paulkuo 博客）：gen-image-cli skill 通过 Bash 调 `codex exec`，用 ChatGPT OAuth，直连 OpenAI，不经自定义 base_url —— 不解决 new-api 路由。

- 来源：https://github.com/hex/claude-image-generation · https://github.com/oakplank/claude-gpt-image-bridge · https://www.pascal-poredda.com/blog/claude-code-image-generation-with-custom-cmds · https://paulkuo.tw/en/articles/claude-code-codex-imagegen/
- 投票：claims [14](3-0) [15](3-0) [16](3-0) [20](3-0) [21](3-0)

### 发现 6：skill + bash 脚本比自建 MCP 更简单 【置信度：高】

- CC 默认工具集（Bash/Edit/Read/Write/WebSearch/Skill 等）无原生图像生成工具；多个独立来源（Stackademic、laozhang.ai）确认 Claude 截至目前仍无原生生图。
- explainx.ai 博客（2026-07-07）详述 `SKILL.md`（策略：默认 0 图、最多 2 图）+ `generate-blog-images.ts`（openai+sharp，调 gpt-image-1）+ `bun run generate:blog-images` 模式，作者明确论述：*"You do not need a custom MCP server unless you want Claude to call generation without Bash. Shell invocation is simpler."*
- **关键技术点**：openai npm 包原生支持传 custom `baseURL`，故把脚本指向自建 new-api 是平凡改动 —— 为不想上 MCP 的用户提供了一条更轻量的路径，且同样满足 new-api 路由需求（只需在脚本中设 baseURL）。
- 社区（HN、Reddit r/ClaudeCode、Medium）普遍认同 skill+CLI 在简单性上优于 MCP。
- 来源：https://explainx.ai/blog/generate-images-claude-code-openai-skill-workflow-2026
- 投票：claims [17](3-0) [18](3-0) [19](3-0)；博客来源但经多源交叉验证

---

## 三、推荐方案详解：`lansespirit/image-gen-mcp`

### 安装（指向你的 new-api）

```bash
claude mcp add image-gen-mcp /path/to/start-mcp.sh \
  -e PROVIDERS__OPENAI__API_KEY=<你的new-api令牌> \
  -e PROVIDERS__OPENAI__BASE_URL=<你的new-api地址>/v1
```

- `start-mcp.sh` 内容执行 `uv run python -m image_gen_mcp.server`
- 环境变量参考 `.env.example`：`PROVIDERS__OPENAI__BASE_URL=https://api.openai.com/v1`（改为你的 new-api `/v1`）

### 🔴 两个隐性硬约束（不处理一定失败）

1. **模型名匹配**：即便 base_url 指向 new-api，MCP 发出的 `model` 字段是固定的（`gpt-image-2` / `dall-e-3` 等）。**必须在 new-api 侧为这些模型名绑定可用渠道**，或用 new-api 的**模型名映射/别名**功能做转换，否则请求会被网关拒绝。
2. **时间敏感**：项目迭代快（image-gen-mcp 最后 push 2026-04-25、shinpr/mcp-image 2026-06-20 均活跃），对接前复查最新源码，别只信 README。

---

## 四、候选方案对照表

| 方案 | 类型 | 能否指向自建 new-api | 模型覆盖 | 备注 |
|------|------|------|------|------|
| **lansespirit/image-gen-mcp** ⭐ | MCP | ✅ 源码验证可配 base_url | OpenAI + Imagen | **首选**，63★，活跃 |
| shinpr/mcp-image | MCP | ⚠️ 仅靠 SDK 隐式 `OPENAI_BASE_URL` | OpenAI 固定 | 模型硬编码不可配 |
| SureScaleAI/openai-gpt-image-mcp | MCP | ❓ base_url 能力存疑（1-2 否决） | OpenAI | 较知名，需实测 |
| jezweb/openai-mcp | MCP | ❌ URL 硬编码字面量 | DALL·E | 需 fork |
| jerryzhao173985/openai-image-gen-mcp | MCP | ❌ + 质量问题 | 仅 gpt-image-1 | 不推荐 |
| hex/claude-image-generation | 插件(slash) | ❌ 脚本硬编码 URL | OpenAI | 改 bash 可指向 new-api |
| oakplank/claude-gpt-image-bridge | 桥(codex) | ❌ OAuth 不兼容 | OpenAI | 走 ChatGPT 订阅 |
| novicezk/midjourney-proxy | 代理 | — | Midjourney | 网关侧组件，非 MCP |
| 自写 FastMCP + skill/bash | 自建 | ✅ 完全可控 | 任意 | midjourney/SD 唯一出路 |

---

## 五、空白点与从零写的最小方案（midjourney / SD 场景）

由于无现成 MCP，若你的生图渠道是 midjourney 或 SD，需自写。最小方案：

1. **DALL·E / SD 类（同步端点）**：用 FastMCP（Python）或 TS MCP SDK 包一个 `generate_image(prompt, size, model)` 工具，内部用 openai SDK 设 `base_url=new-api地址/v1`，调 `client.images.generate(...)`。
2. **Midjourney 类（异步任务端点）**：new-api 的 Midjourney-Proxy 走 `/mj/submit/imagine` 等 task-based 异步端点（提交 → 轮询 `/mj/task/{id}` → 取结果 URL），需 MCP 工具内部实现"提交+轮询"两步逻辑。

---

## 六、轻量替代：skill + bash 脚本（不上 MCP）

适合偶尔画图、不想部署 MCP 的场景：

- 写一个 `genimg.py`/`.sh`，用 openai SDK，设 `base_url` 指向 new-api，调 `/v1/images/generations`，把返回图存本地并打印路径
- CC 用 Bash 工具调它，还能用 Read 工具把生成的图读回来看
- 优势：半小时落地，无需 MCP 部署；openai SDK 原生支持自定义 baseURL，指向 new-api 是平凡改动

---

## 七、开放问题（待端到端验证）

1. **image-gen-mcp 配置 `PROVIDERS__OPENAI__BASE_URL` 指向 new-api 后，实际发出的 model 名（gpt-image-2/dall-e-3 等）是否与 new-api 中已配置的渠道模型名匹配？是否需要用 new-api 的模型名映射/别名功能做转换？** —— 需在真实 new-api 实例上端到端验证。
2. **new-api/one-api 暴露的 Midjourney-Proxy（`/mj/submit/imagine` 等 task-based 异步端点）能否被现有 MCP server 调用？还是必须自写一个？** —— 当前证据指向必须自写。

---

## 八、研究局限与时间敏感性（Caveats）

- **时间敏感**：所有结论截至 2026-07-10，开源项目迭代快；image-gen-mcp、shinpr/mcp-image 均为活跃项目，base_url / 模型名配置能力可能随时改变，**对接前应复查最新源码而非仅依赖 README**。
- **模型名匹配是隐性硬约束**：即便 base_url 可配（如 image-gen-mcp），发出的 `model` 字段仍固定，必须在 new-api 侧为这些模型名绑定可用渠道或做别名，否则请求被网关拒绝。
- **base_url 透传问题**：shinpr/mcp-image 的 OpenAI SDK 构造函数未传 baseURL，依赖 `OPENAI_BASE_URL` 环境变量 —— 这是 OpenAI SDK 的隐式约定而非项目文档承诺，升级 SDK 后可能失效。
- **来源质量差异**：image-gen-mcp 的 MIT 许可存在但 LICENSE 文件 404（仓库卫生问题）；jerryzhao173985 项目存在硬编码 API key、模板占位符未替换等质量缺陷；部分非 MCP 路径仅基于博客来源，虽经交叉验证但非一级源。
- **split votes**：claim [1]（shinpr 模型硬编码 2-1）、[9]（jerryzhao173985 模型局限 2-1）、[10]（new-api 无 MCP 2-1）各有一票反对，但均被多数证据压倒，不影响结论成立。
- **被否决的 claim 提醒**：三个 "base_url 不支持" 的断言被推翻 —— shinpr/mcp-image 和 SureScaleAI/openai-gpt-image-mcp 的 base_url 能力在对抗验证中存在争议，不应断言它们一定不支持；当前证据倾向于它们不提供便捷的 base_url 配置，但并非绝对排除（可能借 `OPENAI_BASE_URL` 间接工作）。

---

## 九、来源清单

### 一级（GitHub 仓库 / 源码）
- https://github.com/lansespirit/image-gen-mcp （⭐ 首选）
- https://github.com/QuantumNous/new-api
- https://github.com/songquanpeng/one-api
- https://github.com/shinpr/mcp-image
- https://github.com/jezweb/openai-mcp
- https://github.com/jerryzhao173985/openai-image-gen-mcp
- https://github.com/SureScaleAI/openai-gpt-image-mcp
- https://github.com/hex/claude-image-generation
- https://github.com/oakplank/claude-gpt-image-bridge
- https://github.com/novicezk/midjourney-proxy
- https://github.com/openai/openai-node
- https://github.com/Ichigo3766/image-gen-mcp （SD/Flux，未纳入验证）
- https://github.com/BeehiveInnovations/pal-mcp-server
- https://github.com/guinacio/claude-image-gen

### 二级（博客 / 文档）
- https://explainx.ai/blog/generate-images-claude-code-openai-skill-workflow-2026
- https://www.pascal-poredda.com/blog/claude-code-image-generation-with-custom-cmds
- https://paulkuo.tw/en/articles/claude-code-codex-imagegen/

---

## 十、决策建议（按场景）

| 你的 new-api 生图渠道 | 推荐路径 |
|------|------|
| DALL·E / gpt-image（OpenAI 系） | **直接装 `lansespirit/image-gen-mcp`**，配 base_url + 处理模型名映射，一条命令搞定 |
| Midjourney | 无现成 MCP → **自写 FastMCP**（封装 `/mj/submit` + 轮询），或走 skill+bash |
| Stable Diffusion / Flux | 无现成 MCP → **自写 MCP** 或 **skill+bash 脚本**调 `/v1/images/generations` |
| 偶尔画图、不想部署 MCP | **skill + bash 脚本**（openai SDK 设 baseURL 指向 new-api），最轻量 |

> **一句话总结**：new-api 按「端点 + 模型名」区分能力；CC 只走对话端点，只认对话模型；生图模型想给 CC 用，**OpenAI 系有现成 MCP（image-gen-mcp），midjourney/SD 必须自写或走脚本**——无论哪条路，核心都是「把 new-api 的 `/v1/images/generations` 包成 CC 能调的 MCP 工具或 Bash 脚本」，并确保 model 名在网关侧有渠道承接。
