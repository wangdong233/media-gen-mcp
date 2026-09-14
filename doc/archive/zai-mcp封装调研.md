# media-gen-mcp 封装 zai-mcp-server 调研(MCP-over-MCP vision provider)

> **三份调研基础**:A(zai-mcp-server 协议)/ B(限额机制 + 合规边界)/ C(SDK Client 实现 + 宿主探测)
> **裁决**:**go-with-conditions**(条件:必须用独立按量计费 API key,不得用 Code Plan key)
> **一句话结论**:技术可行、SDK 成熟、Provider 草案成立;但用户 4 个论点里只有"开关 opt-in"完全成立、"限额互补"和"MCP-over-MCP 必然性"是部分成立,"合规"在默认 Code Plan key 路径下**不成立**——唯一合规路径是 zai-mcp-server 后端用独立按量计费 key,把 Code Plan 配额完全从链路上摘掉。

---

## 0. 决策摘要表(给快读者)

| 维度 | 用户论点 | 裁决 | 关键修正 |
|---|---|---|---|
| 不重复 | Code Plan 月度配额比免费层稳,与 glm-vision 互补 | **部分成立** | "月度"前提错:Vision MCP 是 5h 滑动窗口(月度只给 search/reader/zread)。互补结论方向对,但 zai-mcp 后端与 glm-vision **同源同端点(paas/v4)**,本质是同一 GLM-4.6V 的两条访问通道 |
| 合规 | 把 zai-mcp 当工具正常调用=正常 MCP 组合,不是逆向 | **条件成立** | 默认 Code Plan key 路径**违规**(ToS §4.2)。唯一合规=后端用独立按量计费 key。"智谱看到的是 zai-mcp 调用"是天真假设——错误码 1313/1315 证明有 risk control + key 类型标记 |
| 开关 opt-in | 给开关让用户自担风险 | **技术成立,合规不豁免** | config.json `providers["zai-mcp"].enabled` 默认 false 即可。但 ToS 未规定"用户 opt-in 即免责",opt-in 只是 UX |
| MCP 调 MCP | 复杂业务的合理形态 | **模式成立,本案必要性低** | 作为未来 stdio MCP server(paddleocr-mcp 等)的统一调用模板有架构价值。本例唯一不可替代价值=(a) 复用 zai-mcp 专有 prompt 模板 (b) MCP-in-MCP 模板 (c) api.z.ai 国际端点地域 fallback。若只想要"更准 OCR",把 prompt 模板移植进 `vision-prompt.ts` 成本更低 |

**tier 建议:8**(低于 glm-vision=9;调研 C 结论)。

---

## 1. 协议可行性(基于 A 调研)

### 1.1 颠覆方案预设:stdio-only,非 HTTP

**用户预设"远程 HTTP MCP 端点 `api.z.ai/api/mcp/server`"是错的**(A finding #1, C finding #1 双重确认)。

源码铁证(`@z_ai/mcp-server@0.1.4/build/index.js`):
- L3:`import { StdioServerTransport from '@modelcontextprotocol/sdk/server/stdio.js'`
- L116:`const transport = new StdioServerTransport()`
- 整个 server **只有 stdio 一种 transport**,无 SSEServerTransport / StreamableHTTPServerTransport

用户本机 `~/.claude.json` 的实际配置(A finding #2 / C finding #5 实测):
```json
"zai-mcp-server": {
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "@z_ai/mcp-server"],
  "env": { "Z_AI_MODE": "ZHIPU", "Z_AI_API_KEY": "<key>" }
}
```

→ **media-gen-mcp 不能用 fetch/HTTP client 去连一个不存在的 HTTP 端点**。必须走 `child_process.spawn('npx', ['-y', '@z_ai/mcp-server@0.1.4'], {env, stdio:['pipe','pipe','pipe']})` + `@modelcontextprotocol/sdk` 的 `StdioClientTransport`,单开一条 stdio 适配链。

### 1.2 认证:env 注入,非 Bearer header

stdio transport **无 HTTP 头可挂 Bearer**(A finding #2)。认证通过子进程 env 注入:

| env 变量 | 必填 | 说明 |
|---|---|---|
| `Z_AI_API_KEY` | ✅ | 主变量,官方推荐命名(大写下划线) |
| `Z_AI_MODE` | ✅ | `ZAI`(api.z.ai 国际)或 `ZHIPU`(open.bigmodel.cn 国内,默认) |
| `PLATFORM_MODE` | 选填 | 平台模式覆盖 |
| `Z_AI_VISION_MODEL` | 选填 | 默认 `glm-4.6v` |
| `Z_AI_VISION_MODEL_TEMPERATURE/TOP_P/MAX_TOKENS` | 选填 | 默认 0.8 / 0.6 / 32768 |
| `Z_AI_TIMEOUT` | 选填 | 默认 300000ms(5 分钟) |

源码 fallback `process.env.Z_AI_API_KEY || process.env.ZAI_API_KEY` 两个都识别,**但官方文档与默认推荐 `Z_AI_API_KEY`**,文档需统一此命名,避免 `ZAI_API_KEY`(无下划线)导致 fallback 路径分歧。

### 1.3 标准 MCP 握手 + SDK 锁版本

无 session id、无 SSE 心跳。握手流程(A finding #3):
```
initialize 握手 → on 收到 tools/list_changed → 发 notifications/initialized → tools/list → tools/call
```

SDK 客户端形态(C finding #2,1.29.0 dist/esm/client/index.d.ts):
1. `new Client({name, version}, {capabilities?})` —— 构造仅声明身份
2. `client.connect(transport)` —— **自动跑 initialize 握手**(JSDoc 原文:"automatically begin the initialization flow")
3. `client.getServerCapabilities()` —— 读 tools/prompts/resources 能力
4. `client.listTools()` → `{tools:[{name, inputSchema, outputSchema?}]}`
5. `client.callTool({name, arguments})` → `{content:[{type:'text'|'image'|'resource'}], isError?, structuredContent?}`
6. `client.close()` —— 拆链

**版本**:
- `@z_ai/mcp-server@0.1.4` 内嵌 `@modelcontextprotocol/sdk@1.26.0`
- media-gen-mcp 客户端建议锁 `@modelcontextprotocol/sdk@^1.26.0`(或 1.29.0,主从协议兼容,client 1.29 ↔ server 1.26 连接 OK)
- **必须锁 `@z_ai/mcp-server@0.1.4` 而非 `@latest`**(A finding #9):0.1.x 版本号表明 API 仍在迭代,上游 0.2.0 破坏性变更会导致 vision provider 静默失败

### 1.4 内部后端:与 glm-vision 同源同端点

**这是隐藏的关键事实**(A finding #4 + C finding #1):

stdio 子进程内部用 OpenAI 兼容协议 POST 到:
- `Z_AI_MODE=ZAI` → `https://api.z.ai/api/coding/paas/v4`(注意 `/coding/` 路径,GLM Coding Plan 专用入口)
- `Z_AI_MODE=ZHIPU` → `https://open.bigmodel.cn/api/paas/v4`(默认,与 media-gen-mcp `GlmVisionProvider` 直调的端点**完全相同**)

→ **若 `Z_AI_MODE=ZHIPU`,zai-mcp-server 后端与 glm-vision 后端是同一 paas/v4 端点**。二者只是访问通道差异:
- glm-vision:media-gen-mcp 进程内直调 `ZhipuClient.request('/paas/v4/chat/completions')`
- zai-mcp:多一道 stdio 子进程(~1-2s 冷启动)+ JSON-RPC IPC 序列化开销,但复用 zai-mcp 的专有 prompt 模板

**这直接影响 tier 定位与"是否值得做"的判断**(见 §4.7 / §6)。

### 1.5 callTool 响应结构

A 调研 openQuestion #1 未能在源码明确,但基于 SDK 1.29 类型定义(C finding #2),`callTool` 返回:
```ts
{
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }
    | { type: 'resource'; resource: { uri: string; text?: string; blob?: string } }
  >,
  isError?: boolean,
  structuredContent?: unknown
}
```

media-gen-mcp 解析姿势:`content.filter(c => c.type === 'text').map(c => c.text).join('\n')`。
`isError === true` 时(zai-mcp 把异常格式化成 MCP error 文本)→ throw `status=503` 让 `isFallbackWorthy` 接管。

---

## 2. 限额机制对比(基于 B 调研,回应用户"不重复"论点)

### 2.1 用户"月度配额"前提错误

**B finding #1 + A finding #6 双重纠偏**:Code Plan 三档(Lite $18 / Pro $72 / Max $160)的配额结构是:

| 档位 | 5h 滑动窗口 | 周窗口 | 月度 MCP calls |
|---|---|---|---|
| Lite | ~80 prompts | ~400 | 100 |
| Pro | ~400 prompts | ~2,000 | 1,000 |
| Max | ~1,600 prompts | ~8,000 | 4,000 |

关键事实:
- **Vision MCP 共享 5h 滑动窗口**(与 GLM 主模型共用),非独立月度配额
- **月度配额只给 search / reader / zread 三个 HTTP MCP**(B finding #8)
- 文档原文(docs.z.ai/devpack/overview.md L98):"Vision Understanding MCP: All plans share the MODEL's 5-HOUR maximum prompt resource pool. Once the limit is reached, access automatically resets at the end of the 5-hour window"

→ 用户反驳理由"Code Plan 月度配额比免费层 RPM 稳"对 vision **不成立**。vision 是 5h 滑动池,高并发时可在 5h 内耗尽(等同主模型配额)。

### 2.2 但"稳定性互补"结论方向对

相比免费层 RPM 平台动态调节(B finding #2,GLM-4.6V-Flash 免费,但 RPM/TPM 公开页 rate-limit.md 在 auth-pages 路由下需登录,未公开数字),订阅级 5h 窗口仍是优势:**5h 内有确定性预算池**(对齐 reset 时间到秒,如 1310 报错 `2026-07-24 00:30:40 重置`)。

### 2.3 限额互补 vs 同源冗余(裁决核心)

| 维度 | glm-vision(免费层直调) | zai-mcp(stdio 桥接) |
|---|---|---|
| 后端端点 | `open.bigmodel.cn/api/paas/v4` | 同(若 `Z_AI_MODE=ZHIPU`) |
| 模型 | GLM-4.6V-Flash | GLM-4.6V(同模型) |
| 配额来源 | 免费层 RPM(平台动态) | Code Plan 5h 窗口 / 独立按量计费 |
| 频率抖动 | 高 | 低(若订阅 Code Plan)/ 按量付费(若独立 key) |
| 协议路径 | OpenAI 兼容 chat/completions | MCP-over-MCP(stdio spawn + JSON-RPC) |
| 调用开销 | 直调(毫秒级) | 子进程 spawn 1-2s + IPC |

**用户论点裁决**:
- ✅ "稳定性互补"方向成立(免费层抖动 vs 订阅/按量稳定)
- ❌ "月度配额"前提错(vision 是 5h 滑动)
- ⚠️ **隐藏事实**:若 `Z_AI_MODE=ZHIPU`,zai-mcp 与 glm-vision 后端是同一 paas/v4,本质是同一 GLM-4.6V 的两条访问通道,而非两个独立 provider
- ⚠️ 真正的互补价值仅在两种场景兑现:
  1. `Z_AI_MODE=ZAI` 走 api.z.ai 国际端点,作 glm-vision(open.bigmodel.cn 国内)的**地域 fallback**
  2. 用 Code Plan key 时 5h 窗口比免费层 RPM 稳定(但**违规**,见 §3)

**结论**:**部分成立**——互补结论方向对,但前提和后端同源性需诚实告知用户。若用户诉求是"加个稳的视觉 provider",直接扩 glm-vision(加 key 轮换 / 重试)成本更低;若诉求是"统一 MCP 协议 / 复用 zai-mcp 专有 prompt 模板",才有封装价值。

---

## 3. 合规边界(基于 B 调研,回应用户"合规"论点)

### 3.1 决定性原文:ToS §4.2 Usage Scenario Restrictions

B finding #5 引用 `docs.z.ai/legal-agreement/subscription-terms.md`:

> "usage quota under GLM Coding Plan is only used within officially supported tools. If the system detects usage through unauthorized or unsupported tools (such as **SDK-based access or other third-party integrations**), some subscription benefits may be restricted... You shall not use the GLM Coding Plan quota for general-purpose API access or any scenarios outside such tools, including but not limited to **directly invoking model APIs from your own applications, bots, websites, SaaS products or other systems**... you may not resell, sub-resell, repackage, aggregate, proxy or otherwise provide the GLM Coding Plan to any third party."

白名单工具清单(B finding #4,`docs.z.ai/devpack/tool/others.md`):
- **13 个 Coding Agent**:Claude Code / Claude for IDE / OpenCode / Cursor / Cline / TRAE / Qoder / Droid / Kilo Code / Roo Code / Crush / Goose / Eigent
- **3 个 General-purpose Agent**:OpenClaw / Hermes Agent / SillyTavern
- media-gen-mcp **不在列**(它是媒体生成 server,不是编码 agent,场景也不属编码用途)

### 3.2 "智谱看到的是 zai-mcp 工具调用"——天真假设

用户论点隐含:"只要经 zai-mcp-server 路由,智谱看到的调用方就是 zai-mcp,合规风险被中间层吸收。"

B finding #6 + finding #7 反驳:
1. **Code Plan key 在签发层就被产品类型化**(错误码 1315:"This API Key is limited to enterprise coding package scenarios. Please go to the official website to replace the API Key of the corresponding product type.")
2. **存在运行中的 risk control**(错误码 1313:"Your account's current usage pattern does not comply with the Fair Usage Policy... request frequency has been limited. To restore access, please submit a request")
3. **检测维度明文包含"SDK-based access or other third-party integrations"**(ToS §4.2.2)
4. Usage Policy 页提及"risk control system"会标记账户,**3 次违规可能封号**
5. `client_info`(MCP initialize 自报)和 `User-Agent` 可控(B finding #7),但**伪造身份本身构成"规避检测/诚信原则违反"**,从普通违规升级为恶意规避

→ 路由中间层不改变**终端场景判定**:media-gen-mcp 是独立 server 进程,有自己的 API key,属"your own applications"+ 第三方集成,白名单约束的是 **END-USE 客户端与场景,不是路由**。

### 3.3 三条路径合规性对比

B finding #9 给出决定性裁决(原文照搬):

| 路径 | 合规性 | 触发条款 |
|---|---|---|
| **(A)** Code Plan key 装到 media-gen-mcp 任意用途 | ❌ 违规 | §4.2.2(自有应用调用) |
| **(B)** media-gen-mcp → zai-mcp-server → Z.ai 后端(用 Code Plan key) | ❌ 违规 | §4.2.1(非白名单工具)+ §4.2.2(终端场景非编码);zai-mcp 居中不洗白 |
| **(C)** media-gen-mcp → zai-mcp-server(后端用独立按量计费 API key) | ✅ 合规 | Code Plan 配额完全不被触碰,§4.2 不适用 |

### 3.4 用户"合规"论点裁决

**条件成立**——
- 默认 Code Plan key 路径(B 路径):**违规**,错误码 1313/1315 证明检测存在
- 独立按量计费 key 路径(C 路径):**合规**,是 MCP 正常组合

实施铁律:**ZaiMcpProvider 必须强制要求独立按量计费 API key,文档明确禁止 Code Plan key**。这与现有 `glm-vision.ts:24-26` 注释一致:"Code Plan key(ZAI_API_KEY)不可用:绑定 api.z.ai/api/coding/* 专用端点 + 限 9 个白名单工具 + 违规封号不退款"(B 调研更新白名单为 13+3=16 个)。

---

## 4. 实现方案(基于 C 调研)

### 4.1 ZaiMcpProvider 草案定位

```
src/providers/zai-mcp.ts
├── detectHostConfig()    // 探测 ~/.claude.json + 自身 config.json
├── health()              // configured + cooldown 驱动 fallback
├── getClient()           // lazy 单例 clientP: Promise<Client>
├── recognize(req)        // task → tool 映射 + callTool + 解析
├── visionTasks()         // 全 4 task
├── visionConstraints()   // {languages:['en','zh-Hans','zh-Hant','ja','ko']}
└── 进程生命周期           // SIGTERM client.close() 避免僵尸 npx
```

### 4.2 宿主配置探测(C finding #5)

权威源:`~/.claude.json`(跨平台 `path.join(os.homedir(), '.claude.json')`,Windows 下 `os.homedir()` 也正确返回 USERPROFILE)。

探测优先级:
1. `~/.claude.json` 顶层 `mcpServers['zai-mcp-server']`(用户实测此处有配置)
2. `~/.claude.json` 的 `projects[<cwd>].mcpServers`(per-project,如用户 `/Users/wangdong/.openclaw` 项目下挂 playwright 同款)
3. 项目根 `.mcp.json`(CC 启动时读,team-shared)
4. media-gen-mcp 自身 `config.json` 的 `providers['zai-mcp']`(独立配置回退)

**非规范文件不探测**:`~/.claude/mcp_settings.json`(放 filesystem/github/sqlite,CC 不直接消费)。

按 `type` 分支(C finding #5):
- `type:'stdio'`(zai-mcp-server 的实际形态)→ 取 `command` + `args` + `env.Z_AI_API_KEY` + `env.Z_AI_MODE`
- `type:'http'`(未来若 z.ai 发布 hosted HTTP MCP 才会出现的形态)→ 取 `url` + `headers.Authorization`

四源都无 → `health().configured = false` → `registry.ts:328` 已验证会过滤 `configured !== false`,自动跳出 fallback 链,CI 环境(无 `~/.claude.json`)零影响现有 117 测试。

### 4.3 依赖与版本

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.26.0"
  }
}
```

import 路径:
```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
// 未来 hosted HTTP MCP 上线后:
// import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
```

### 4.4 Node ESM 骨架(stdio spawn,可粘)

C finding #4 给出的草案:

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ChildProcess } from 'node:child_process';

const transport = new StdioClientTransport({
  command: 'npx',
  args: ['-y', '@z_ai/mcp-server@0.1.4'],   // 锁版本,不用 @latest
  env: {
    ...process.env,                          // 必须 inherit(PATH 找 npx/node);SDK 默认 getDefaultEnvironment() 只白名单一组 env,显式 spread 更稳
    Z_AI_MODE: 'ZHIPU',                      // 默认走 open.bigmodel.cn(国内,与 glm-vision 同源);若作地域 fallback 用 'ZAI'
    Z_AI_API_KEY: '<独立按量计费 key>',       // 铁律:禁 Code Plan key(见 §3)
  },
  stderr: 'pipe',                            // 别 'inherit',免 zai-mcp 自己的 console.info 污染宿主 stderr
});

const client = new Client(
  { name: 'media-gen-mcp', version: '1.x' },
  { capabilities: {} },
);
await client.connect(transport);             // 自动 initialize 握手

const caps = client.getServerCapabilities();
if (!caps?.tools) throw new Error('zai-mcp-server 未声明 tools 能力');

const { tools } = await client.listTools();  // 发现 8 工具

const res = await client.callTool({
  name: 'extract_text_from_screenshot',
  arguments: {
    image_source: 'file:///abs/screenshot.png',  // 本地路径或远程 URL 均可
    prompt: 'Extract all visible text, preserve layout',
  },
});

if (res.isError) throw new Error(`zai-mcp tool error: ${JSON.stringify(res.content)}`);
const text = (res.content ?? [])
  .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
  .map(c => c.text)
  .join('\n');

// 用完 client.close() 释放子进程(media-gen-mcp SIGTERM 时统一 close)
```

**关键差异 vs StreamableHTTP**(未来切换的 1 行改动):
```ts
// 未来 hosted HTTP MCP 上线:
const transport = new StreamableHTTPClientTransport(
  new URL('https://api.z.ai/api/mcp/vision/mcp'),
  { requestInit: { headers: { Authorization: `Bearer ${apiKey}` } } },
);
// Provider 主体(connect / listTools / callTool)不动
```

→ **Provider 设计成 transport-agnostic**,通过 config 字段切换,为未来留口。

### 4.5 task → tool 映射(完整,C finding #7)

media-gen-mcp 4 个 `VisionTask` → zai-mcp-server 8 工具:

| VisionTask | zai-mcp 工具 | 入参映射 |
|---|---|---|
| `extract-text` | `extract_text_from_screenshot` | `image_source` + `prompt`(用 `vision-prompt.ts:promptFor(req)`)+ `programming_language?`(映射自 `hints.languages`) |
| `analyze-chart` | `analyze_data_visualization` | `image_source` + `prompt` + `analysis_focus?`(映射自 `hints.chartType`) |
| `describe-image` | `analyze_image` | `image_source` + `prompt`(把 `hints.question` 拼进) |
| `extract-table` | `analyze_image`(无专用工具) | `image_source` + `prompt`=`'Extract table, output as ${hints.format ?? 'html'}'`(对齐 `glm-vision.ts:218-224` `parseResult` 的 fallback 策略) |

**注意**:zai-mcp 工具入参 `prompt` 必填不能空 —— Provider 内部按 task 拼 `vision-prompt.ts:promptFor(req)` 作 prompt 传入。

未利用的 4 工具(`ui_to_artifact` / `diagnose_error_screenshot` / `understand_technical_diagram` / `ui_diff_check`)不在 media-gen-mcp 当前 4 task 范围内,可作未来扩展(`ui_diff_check` 双图模式对 UI 回归测试场景有价值)。

### 4.6 错误处理(对齐 isFallbackWorthy 链,C finding #8)

`src/providers/http.ts:25` 既有约定:`isFallbackWorthy(e)` 认 `s === 0 || s >= 500 || s === 401 || s === 403 || s === 429`。

| 错误场景 | 处理 | status |
|---|---|---|
| 子进程启动失败 / `connect` 超时 | throw | **503**(isFallbackWorthy=true) |
| `callTool` 返回 `isError=true` | throw | **503** |
| 工具不存在(listTools 后名称不匹配) | throw | **503** |
| 配额耗尽(1310/1316/1317/1318-1321) | throw,不重试(5h 窗口未到不会恢复) | **429**(isFallbackWorthy=true) |
| Risk control(1313) | throw,不重试 | **429** |
| Key 类型不符(1315) | throw,不重试,日志告警"疑似 Code Plan key,请换独立按量计费 key" | **401**(isFallbackWorthy=true) |
| 不可重试(401/403/auth) | throw | **401/403** |
| 子进程崩溃(transport `onclose`) | `clientP = null` + 设 `cooldownUntil = Date.now() + 60_000` + 重抛 | 503 |
| 所有重试失败兜底 | 强制 | **429**(对齐 `glm-vision.ts:197-202` "全不可用语义=应无条件 fallback") |

**重试策略**(参考 zai-cli 范本,A finding #8,但 stdio 子进程重启成本比 HTTP 高,建议 max retries 降到 1):
- 退避公式:`min(8000, 500 × 2^(attempt-1)) + random(0, 250)ms`
- 可重试错误:timeout / ETIMEDOUT / ECONNREFUSED / ECONNRESET / network / fetch / HTTP 500/502/503/504 / 1305(平台过载)
- **不可重试**:401 / 403 / 任何含 'auth' 子串的错误 / 1310(配额) / 1313(risk control) / 1315(key 类型)
- 每次重试前 `close()` 旧 client 重新 `init()`(即重启 stdio 子进程)

**1310 铁律扩展**(在 0.10.0"铁律 poll 不 fallback"基础上):
- 1310 = 配额耗尽,5h 窗口未到不会恢复 → **直接 fallback 不重试**(zai-cli 默认按 'rate limit' 类可重试是错的,只对短期窗口型 RPM 有意义)

### 4.7 tier 定位:C 调研建议 ≤ 8

C finding #8 决定性论证:
- zai-mcp 后端 = `api.z.ai/api/paas/v4` 或 `open.bigmodel.cn/api/paas/v4`,**与 glm-vision 调的智谱 paas/v4 同源**
- 且 stdio 多一道子进程 spawn(~1-2s 冷启动)+ JSON-RPC IPC 序列化开销
- → 对相同输入,**glm-vision 直连更快、延迟更低**

zai-mcp 唯一独有价值:
1. 复用 zai-mcp-server 的专有 prompt 模板(`build/prompts/TEXT_EXTRACTION_PROMPT` 等)
2. "MCP-in-MCP"统一调用范式(为未来封装其他 stdio MCP server 留模板)
3. `Z_AI_MODE=ZAI` 走 api.z.ai 国际端点时,与 glm-vision 走 open.bigmodel.cn 国内端点可作**地域 fallback**

→ **建议 tier = 8**(等于 vlm=8,低于 glm-vision=9)。

若 tier > glm-vision,fallback 链会优先选 zai-mcp 而 glm-vision 闲置,徒增子进程开销;若 tier = glm-vision = 9,需在 `describeVisionOptions()` 标注二者**同 tier 互补**(glm-vision 国内 + 直调低延迟 / zai-mcp 国际端点 + MCP 协议)。

`describeVisionOptions()` 定位文案:
```
{ latencyTier: 'moderate', accuracyTier: 'high',
  role: 'Z.AI 官方 MCP 视觉层(stdio 桥接,复用 GLM-4.6V;独立按量计费 key 合规路径)' }
```

### 4.8 CI 兼容性(零影响现有 117 测试)

C finding #9 附录:
- `registry.ts` 加 `'zai-mcp': new ZaiMcpProvider({...})`
- CI 环境无 `~/.claude.json` + 无项目 `.mcp.json` + media-gen-mcp config.json 未配 → `health().configured = false`
- `registry.ts:328` 已验证过滤 `configured !== false`,自动跳出 fallback 链
- → 现有 117 测试零改动

---

## 5. 开关设计(回应用户"开关"论点)

### 5.1 技术方案

`config.json` schema 扩展:
```json
{
  "providers": {
    "zai-mcp": {
      "enabled": false,                  // 默认关,opt-in
      "transport": "stdio",              // 默认 stdio;未来可改 "http"
      "command": "npx",
      "args": ["-y", "@z_ai/mcp-server@0.1.4"],
      "mode": "ZHIPU",                   // ZAI(国际)/ ZHIPU(国内,默认)
      "apiKey": "<独立按量计费 key>",     // 铁律:禁 Code Plan key
      "model": "glm-4.6v",
      "hostConfigDetect": true           // 是否自动探测 ~/.claude.json
    }
  }
}
```

启用方式二选一:
- (推荐)`hostConfigDetect: true` —— 自动读 `~/.claude.json` 的 `mcpServers['zai-mcp-server']`,复用用户已配置的 env
- 显式 `apiKey` + `mode` —— 不依赖 CC 配置,独立部署场景

### 5.2 启动期合规校验(铁律)

`ZaiMcpProvider` 构造时跑合规自检(参考 `registry.ts` 已有的 glm-vision 多 key 警告模式):
```ts
// 检测疑似 Code Plan key(Coding Plan 端点专用 key 与通用 API key 形态不同,但无公开区分方法)
// → 启动时 console.warn 提示:
console.warn(
  `[media-gen-mcp] ⚠️ zai-mcp provider 已启用。铁律:\n` +
  `(1) 必须使用独立按量计费 API key(open.bigmodel.cn/api/paas/v4 标准通用 key);\n` +
  `(2) 禁止使用 Code Plan key(ZAI_API_KEY):Code Plan 限 13 coding agents + 3 general agents 白名单,` +
  `media-gen-mcp 不在内,ToS §4.2 禁止"your own applications"与"third-party integrations",违规封号不退款;\n` +
  `(3) Code Plan key 走 api.z.ai/api/coding/paas/v4 专用端点,会被错误码 1315 拒绝;` +
  `(4) 5h 滑动窗口配额(非月度),高并发时 5h 内可能耗尽,1310 错误直接走 fallback 链。`
);
```

### 5.3 用户"开关"论点裁决

**技术成立,合规不豁免**——
- ✅ `enabled: false` 默认关 + 探测式启用,完全可实施
- ❌ opt-in 不改变终端场景判定:ToS §4.2 未规定"用户 opt-in 即免责",`your own applications` 与 `third-party integrations` 条款对 opt-in 后的调用同样适用
- ⚠️ opt-in 只是 UX 设计,合规风险声明必须在文档与启动 warn 里硬性呈现

---

## 6. 与 glm-vision/paddle/fallback 协作

### 6.1 现有 vision 链

```
paddle(10) → glm-vision(9) → vlm(8) → tesseract(1)
```

源:`glm-vision.ts:8-9` 注释。

### 6.2 加入 zai-mcp 后两种排布方案

**方案 A:tier=8,与 vlm 同 tier(推荐,C 调研结论)**
```
paddle(10) → glm-vision(9) → zai-mcp(8) → vlm(8) → tesseract(1)
```
- 优势:glm-vision 国内直调优先(低延迟),zai-mcp 作 glm-vision 失败后的第二云端选项(独立 key 不与 glm-vision 共享封号风险)
- 注意:同 tier 8 内,zai-mcp 排在 vlm 前(zai-mcp 是托管服务,vlm 是自托管,前者默认可用性更高)

**方案 B:tier=9,与 glm-vision 同 tier 互补**
```
paddle(10) → {glm-vision(9), zai-mcp(9)} → vlm(8) → tesseract(1)
```
- 适用场景:用户 `Z_AI_MODE=ZAI` 走国际端点作地域 fallback
- 风险:同 tier 时 fallback 链选哪个取决于 registry 内 provider 顺序,需明确文档

**推荐方案 A**(tier=8),理由:
1. glm-vision 直调更快(无 spawn / IPC 开销),理应优先
2. zai-mcp 后端与 glm-vision 同源(若 `Z_AI_MODE=ZHIPU`),封顶在 glm-vision 之下一档避免无谓绕道
3. 若用户诉求是地域 fallback,把 `mode` 设 `ZAI` + 显式 `enabled: true` + 在 describeVisionOptions 标注角色即可

### 6.3 与 glm-vision 真正互补的场景(罕见但成立)

只有以下两种情形,zai-mcp 才在 fallback 链中真正激活:
1. **glm-vision 配额耗尽**(免费层 RPM 抖动锁频):zai-mcp 用独立按量计费 key,配额池不与 glm-vision 共享 → 接管
2. **glm-vision 端点不可达**(open.bigmodel.cn 国内故障):zai-mcp `Z_AI_MODE=ZAI` 走 api.z.ai 国际端点 → 接管

否则(两者都正常时),zai-mcp 永远不会被 fallback 链触达(tier 更低 + glm-vision 9 优先成功)—— 这就是 §4.7 / §2.3 所说"封装价值需证明"的具体含义。

---

## 7. 风险 + 缓解

### 7.1 合规风险(最高)

| 风险 | 缓解 |
|---|---|
| 用户用 Code Plan key 装到 zai-mcp(节省成本)→ 违反 ToS §4.2,可能封号不退款 | (1) 启动 warn 硬性提示;(2) ONBOARDING 文档明确禁用;(3) `enabled: true` 时强制要求 `apiKey` 字段非空,且 warn"请确认此 key 非Code Plan key";(4) 检测到 1315 错误时立即 disable provider 并日志告警 |
| 用户伪造 client_info 假冒 'claude-code' | 不提供此能力,文档明确"伪造身份=恶意规避,从普通违规升级" |
| opt-in 后用户用于 SaaS 转售 | 文档明确禁止 repackage/proxy(ToS §4.2 原文) |

### 7.2 协议风险

| 风险 | 缓解 |
|---|---|
| 任务原方案预设 HTTP endpoint 不存在,需重写连接层为 stdio | 本方案已修正:stdio-first 设计,http transport 为未来口子预留 |
| `@z_ai/mcp-server` 0.2.0 破坏性变更(0.1.x 表明 API 迭代中) | spawn args 锁 `@z_ai/mcp-server@0.1.4`,非 `@latest`;`package.json` 加版本 pin |
| SDK 主从版本漂移 | 锁 `@modelcontextprotocol/sdk@^1.26.0`,与 server 内嵌版本对齐 |

### 7.3 配额风险

| 风险 | 缓解 |
|---|---|
| Vision 是 5h 滑动窗口(非月度),高并发 5h 内耗尽 | 1310 错误直接 fallback 不重试(本方案 §4.6 铁律);文档明确配额模型 |
| 1313 risk control 标记账户 | 1313 错误立即 disable provider + 告警"请联系智谱申诉" |

### 7.4 同源冗余风险

| 风险 | 缓解 |
|---|---|
| zai-mcp 后端 == glm-vision 后端(paas/v4),封装价值低 | tier=8 排在 glm-vision=9 之下,只在 glm-vision 不可用时激活;在 `describeVisionOptions()` 明示"复用 GLM-4.6V"避免用户误以为是独立视觉模型 |
| 用户期望"加个更准的视觉 provider",实际拿到的是同模型不同通道 | README FAQ 明确"zai-mcp 与 glm-vision 后端同源,差异在协议路径 / prompt 模板 / 地域端点";若需更准 OCR,推荐 paddle(tier=10,PaddleX 中文 SOTA) |

### 7.5 双层 stdio 进程管理风险

| 风险 | 缓解 |
|---|---|
| media-gen-mcp 被 CC 以 stdio 启动,内部再 spawn zai-mcp → 二级 stdio 链路,Windows 句柄继承可能有坑 | Win CI 实测 getDefaultEnvironment 白名单 + PATH 大小写敏感问题,先在 macOS/Linux 跑通,Win 标 experimental |
| 子进程崩溃/zombie/process leak | 监听 transport `onclose` → `clientP = null` + 60s cooldown;media-gen-mcp `SIGTERM` / `SIGINT` 时统一 `client.close()` |
| 子进程 stderr 污染宿主 | `stdio: ['pipe', 'pipe', 'pipe']`,**别 'inherit'**;stderr 内容转 debug log |

### 7.6 性能风险

| 风险 | 缓解 |
|---|---|
| spawn 冷启动 1-2s | client 单例(clientP: Promise<Client>),首次 recognize() 后复用;长驻 media-gen-mcp 进程内只 spawn 一次 |
| listTools round-trip | 缓存 tool 名称集(zai-mcp 静态注册 8 工具,一次 listTools 即可) |

---

## 8. 裁决建议

### 8.1 总裁决:**go-with-conditions**

**条件(必须全部满足)**:
1. **合规铁律**:ZaiMcpProvider 强制独立按量计费 API key,启动 warn + 文档明示禁 Code Plan key;检测到 1315 错误立即 disable
2. **协议修正**:stdio-first 设计(`StdioClientTransport` spawn),非原方案的 HTTP endpoint
3. **配额修正**:文档明确 vision 是 5h 滑动窗口(非月度),1310 错误直接 fallback 不重试
4. **tier 定位**:8(低于 glm-vision=9,避免 fallback 链优先选 zai-mcp 而 glm-vision 闲置)
5. **opt-in 默认关**:`enabled: false`,合规风险声明在启动 warn 与 ONBOARDING 硬性呈现
6. **版本锁定**:`@z_ai/mcp-server@0.1.4` 显式 pin,非 `@latest`

### 8.2 是否值得实施

**值得,但价值有限,需诚实告知用户**:
- 技术实现成本低(SDK 成熟,草案成立,CI 零影响)
- 但 zai-mcp 后端与 glm-vision 同源(paas/v4),封装价值需证明
- 真正不可替代的场景只有 2 个:glm-vision 配额耗尽接管 / open.bigmodel.cn 国内故障时国际端点 fallback
- 若用户诉求是"加个稳的视觉 provider",**直接扩 glm-vision**(加 key 轮换 / 重试 / prompt 模板移植)成本更低、收益更大

### 8.3 替代方案(若用户接受"不开新 provider")

把 zai-mcp-server 的专有 prompt 模板(`TEXT_EXTRACTION_PROMPT` 等)移植进 `vision-prompt.ts`,作为 glm-vision 的 prompt 增强。这样:
- 零 MCP-over-MCP 复杂度
- 零 stdio 子进程开销
- 零合规增量风险(继续走 glm-vision 已合规的免费层 / 按量计费 key)
- 代价:失去 MCP-in-MCP 模板(对未来 paddleocr-mcp 等其他 stdio MCP 的统一调用范式)

**建议**:若用户确认"MCP-in-MCP 模板"是真实需求(为未来铺路),按本方案实施 ZaiMcpProvider;若用户诉求仅是"更准/更稳的视觉",走替代方案。

### 8.4 用户 4 论点最终裁决

| 论点 | 裁决 |
|---|---|
| **不重复**(Code Plan 月度配额比免费层稳) | **部分成立** —— 互补结论方向对(订阅级 vs 免费层动态),但前提错(vision 是 5h 滑动窗口非月度);隐藏问题:zai-mcp 后端 == glm-vision 后端,本质同源 |
| **合规**(经 zai-mcp 调用=正常 MCP 组合) | **条件成立** —— 默认 Code Plan key 路径违规(ToS §4.2,白名单 16 个工具,media-gen-mcp 不在列,错误码 1313/1315 证明检测存在);唯一合规=独立按量计费 key 路径 |
| **开关 opt-in** | **技术成立,合规不豁免** —— `enabled: false` 默认关可实施,但 ToS 未规定 opt-in 即免责 |
| **MCP 调 MCP 必然性** | **模式成立,本案必要性低** —— 作为未来 stdio MCP server 的统一模板有架构价值,本例 zai-mcp 后端同源于 paas/v4,唯一独有价值是 prompt 模板 + MCP 模板 + 地域 fallback |

---

## 附录 A:开放问题(留给实施阶段)

1. **callTool 成功响应 content[0] 结构**:A 调研 openQuestion #1 未在源码明确,需实施时实跑一次 stdio 握手 + tools/call 确认。基于 SDK 1.29 类型定义推断为 `{content:[{type:'text',text}]}`,但 `ui_to_artifact` 可能返 `{type:'image',data,mimeType}`(本方案 4 task 不涉及该工具)
2. **1310 错误 reset 周期判定**:本次调研 reset=2026-07-24(4 天后),从 Overview 看 Lite/Pro/Max 都有 5h + 周(7 天)双窗口,且 MCP 是月度窗口。1310 文案是 'Weekly/Monthly' 两义 —— 实施时实测确认本次究竟是 7 天滚动还是月度账单周期
3. **@z_ai/mcp-server 是否有官方 hosted HTTP MCP 端点**:本调研因 web-reader/web-search 触发 1310 限流无法拉取 `docs.z.ai/devpack/mcp/vision-mcp-server` 验证。若存在则 ZaiMcpProvider 可改用 StreamableHTTPClientTransport,省子进程开销 —— 但即使存在,目前用户 `~/.claude.json` 配的是 stdio 型,探测逻辑仍需支持 stdio 分支
4. **个人自用是否会招致实际执法**:Section 4.3 account-sharing 不触发(单用户),但 §4.2.2 'your own applications' 仍触发。个人自用是否招致 risk control 实际执法(而非理论上违规),文档未明确,取决于小流量个人用途容忍度
5. **ZaiMcpProvider 存在正当性**:既然后端同源于 GLM-4.6V,为何不直接扩 glm-vision 加 vision-prompt 的 TEXT_EXTRACTION_PROMPT 等模板?需与用户确认"MCP-in-MCP 模板"是否真实需求,否则替代方案(§8.3)成本更低

## 附录 B:错误码速查(实施时参考)

| code | 含义 | 处理 |
|---|---|---|
| 1302 | RPM/TPM 限流 | throw 429,可重试 |
| 1305 | 平台过载 | throw 503,可重试 |
| 1308 | 通用窗口限额 | throw 429,fallback |
| 1310 | Weekly/Monthly 配额耗尽 | throw 429,**不重试**,fallback |
| 1313 | Risk control 限流 | throw 429,**不重试**,disable provider + 告警 |
| 1315 | Key 类型不符(Coding Plan) | throw 401,**不重试**,disable provider + 告警"换独立按量计费 key" |
| 1316/1317 | 5h/7d 限额溢出 | throw 429,fallback |
| 1318-1321 | 月消费上限溢出 | throw 429,fallback |
| -500 | 系统错误 | throw 503,可重试 |

## 附录 C:文件清单(实施时新增 / 修改)

| 文件 | 动作 | 说明 |
|---|---|---|
| `src/providers/zai-mcp.ts` | 新增 | ZaiMcpProvider 实现(草案见 §4.4) |
| `src/providers/registry.ts` | 修改 | import + 注册 'zai-mcp' + 合规 warn |
| `src/config.ts` | 修改 | 加 `providers['zai-mcp']` schema |
| `package.json` | 修改 | 加 `@modelcontextprotocol/sdk@^1.26.0` 依赖 |
| `doc/zai-mcp封装调研.md` | 新增 | 本文档 |
| `doc/Zhipu 开通指引.md` 或新 ONBOARDING | 修改 | 加 zai-mcp 启用章节 + 合规铁律 |
| `test/zai-mcp.test.ts` | 新增 | mock stdio + 合规 warn + task→tool 映射测试 |

---

**文档版本**:v1.0(2026-07-20)
**调研基础**:A(zai-mcp-server 协议)+ B(限额 + 合规)+ C(SDK Client + 宿主探测)
**待用户确认**:§8.3 替代方案 vs §4 完整方案的取舍
