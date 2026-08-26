# #4 `list_vision_capabilities` —— vision 能力自省工具功能分析

> pares6 · 2026-07-20 · media-gen-mcp 架构组
> 关联:0.11.0 pares5(图像识别)/ #3 图像编辑 API 延期 / R-DRIFT-02 用户体验 / R-CI-08 双声明反模式

---

## 0. 背景与术语

- **三 vision provider**(pares5 M1-M3 已交付):
  - `tesseract` —— 进程内 WASM OCR 兜底,tier=1,仅 `extract-text`
  - `paddle` —— PaddleX serving REST 全能主力,tier=10,4 task 全覆盖
  - `vlm` —— vLLM OpenAI 兼容(VQA),tier=8,`describe-image` + `analyze-chart`
- **能力异构**:tesseract 仅 OCR、paddle 全能但 describe 忽略 question、vlm 支持完整 VQA 但无 OCR/table。
- **当前调用流程**:CC 选 `extract_table` → `runVisionTask` → `resolveProvider(vision)` → `asVisionProvider` → `recognize` → 若 paddle 未配 → 运行时抛 503 `paddle baseUrl 未配置`。
- **痛点**:CC 在调用前**无任何手段**观测「现在配了哪些 vision provider / 各自能干什么 / 谁是 fallback」——必须到运行时才报错。

---

## 1. 问题陈述

### 1.1 用户场景

| 场景 | 当前行为 | 期望行为 |
|---|---|---|
| CC 调 `extract_table`,用户未配 paddle | 抛 503,CC 把堆栈返给用户 | CC 先 `list_vision_capabilities` → 看到 `paddle.configured=false` → 主动告知「表格识别需配置 paddle.baseUrl,详见部署指引」 |
| CC 调 `describe_image(question="...")`,paddle 主力 | 用 paddle,但 question 被忽略,CC 不知道 | 自省看到 paddle 的 `perTaskNotes["describe-image"]="忽略 question"` → 自动路由到 vlm,或提示用户配 vlm |
| CC 想做中文 OCR | 默认 tesseract,中文弱 | 自省看到 tesseract `accuracyTier=low` + `notes="中文弱"` → 提示用户「中文文档建议配 paddle(中文 SOTA)」 |
| CC 调 `extract_text`,paddle/vlm 全在 cooldown | 静默 fallback 到 tesseract + warnings | CC 可在自省里看到 cooldown 状态,预先解释降级原因 |

### 1.2 R-* 风险对齐

- **R-DRIFT-02(用户体验)**:运行时 503 是不透明错误,把 provider 配置问题甩给用户。前置自省消解。
- **R-CI-08(双声明反模式)**:若新接口方法同时返回 `tasks`/`languages`/`maxBytes`,会与 `visionTasks()`/`visionConstraints()` 形成第二真值源 —— **必须分工**。
- **R-INT-03(god interface)**:新方法必须是**可选**(`describeVisionOptions?()`),不强制所有 provider 实现(MediaProvider 的能力袋哲学)。

---

## 2. 技术方案选项

### 方案 A:复用 `list_models` 输出,在 detail 里加字段
- **做法**:在 `buildListModelsDetail()` 里给 vision provider 再加 `visionHealth`/`visionLatencyTier` 等字段。
- **优点**:零新工具,零新接口方法。
- **缺点**:
  - list_models 输出已对 5 provider × 多字段,再灌入 vision 矩阵会**进一步膨胀**,CC 取数成本上升。
  - list_models 的语义是「模型清单 + 硬约束」,塞入「provider 健康状态 + 路由建议」是**关注点混淆**。
  - 不解决「task 路由建议」的呈现问题(list_models 是 per-provider,不是 per-task)。
- **否决**。

### 方案 B(采纳):新工具 + 新可选接口方法 `describeVisionOptions()`
- **做法**:
  1. `VisionProvider` 加可选方法 `describeVisionOptions?(): VisionOptionDescriptors`,返回 `{ role, latencyTier, accuracyTier, perTaskNotes?, notes? }`。
  2. `registry.ts` 加 `buildVisionCapabilitiesDetail(provider?)` 聚合函数。
  3. `index.ts` 注册 `list_vision_capabilities` 工具 + handler 分支。
- **优点**:
  - **职责单一**:自省工具与「模型清单」解耦。
  - **非破坏**:可选方法 + 可选字段,旧 provider 自动降级。
  - **per-task 视图**:`taskCoverage` 给 CC 直接的路由优先级,无需自己聚合。
- **缺点**:多一个接口方法 + 一个工具(轻微复杂度)。
- **采纳**。

### 方案 C:静态文档化(README 表格)+ 运行时不动
- **做法**:在 README 列一张 provider×task 矩阵表,让 CC 通过读 README 学会路由。
- **优点**:零代码改动。
- **缺点**:
  - **静态**:无法反映 configured/cooldown/lastErrorAt 等运行时状态。
  - CC 不会主动读 README(MCP server 不暴露 README)。
- **否决**(但方案 B 的 `notes` 字段会沉淀这些知识到运行时)。

---

## 3. 架构设计

### 3.1 类型层(src/providers/types.ts)

```ts
/** pares6: vision provider 自描述维度(参考 Umi-OCR self-describing options)。 */
export interface VisionOptionDescriptors {
  /** 角色定位(一句话),如「零配置兜底」「全能主力」「VQA 增强」。 */
  role: string;
  /** 延迟档位:instant(进程内)< fast(本地 serving)< moderate(本地 GPU 推理)< slow(云 API,本 MCP 不走)。 */
  latencyTier: "instant" | "fast" | "moderate" | "slow";
  /** 精度档位:low(兜底)< medium < high(SOTA)。 */
  accuracyTier: "low" | "medium" | "high";
  /** 按 task 细化的备注(任务粒度的 caveat),key 取自 VisionTask。 */
  perTaskNotes?: Partial<Record<VisionTask, string>>;
  /** 通用备注(部署/配置边界)。 */
  notes?: string;
}

export interface VisionProvider {
  listVisionModels(): string[];
  visionTasks(): readonly VisionTask[];
  recognize(req: VisionRequest): Promise<VisionResult>;
  visionConstraints?(): VisionConstraints | undefined;
  /** pares6: 自描述新维度,供 list_vision_capabilities 聚合。
   * 铁律:只承载 role/latency/accuracy/notes —— 不重复 visionTasks()(任务清单)和
   * visionConstraints()(语言/字节上限),避 R-CI-08 双声明。 */
  describeVisionOptions?(): VisionOptionDescriptors;
}
```

**关键裁决 —— 三方法的真值分工**:

| 维度 | 单一真值源 | 已有(pares5) / 新(pares6) |
|---|---|---|
| 支持哪些 task | `visionTasks()` | 已有 |
| 支持哪些语言 | `visionConstraints().languages` | 已有 |
| 最大图片字节 | `visionConstraints().maxImageBytes` | 已有 |
| 角色/定位 | `describeVisionOptions().role` | **新** |
| 延迟档位 | `describeVisionOptions().latencyTier` | **新** |
| 精度档位 | `describeVisionOptions().accuracyTier` | **新** |
| Per-task 备注 | `describeVisionOptions().perTaskNotes` | **新** |
| 部署 caveat | `describeVisionOptions().notes` | **新** |
| configured/cooldown | `health()` | 已有(MediaProviderBase) |
| tier | `tier()` | 已有 |

### 3.2 Provider 实现

**tesseract.ts**:
```ts
describeVisionOptions(): VisionOptionDescriptors {
  return {
    role: "零配置兜底(进程内 WASM)",
    latencyTier: "instant",
    accuracyTier: "low",
    perTaskNotes: {
      "extract-text": "拉丁字母/数字强(验证码、车牌);中文弱(配置 paddle 升中文 SOTA)",
    },
    notes: "M2 paddle / M3 vlm 接入后退居 fallback,恒可用(无 baseUrl 依赖)",
  };
}
```

**paddle.ts**:
```ts
describeVisionOptions(): VisionOptionDescriptors {
  return {
    role: "全能主力(中文 SOTA + 表格 + 图表 + 描述)",
    latencyTier: "fast",
    accuracyTier: "high",
    perTaskNotes: {
      "extract-text": "中文 SOTA(PaddleOCR-VL);多语",
      "extract-table": "PP-StructureV3,支持 html/markdown(json/latex 自动 fallback html)",
      "analyze-chart": "useChartRecognition;响应格式待用户部署验证(M2 warning)",
      "describe-image": "PaddleOCR-VL 默认描述,**忽略 question**(VQA 用 vlm provider)",
    },
    notes: "需配置 providers.paddle.baseUrl(指向 PaddleX serving,如 http://127.0.0.1:8080)",
  };
}
```

**vlm.ts**:
```ts
describeVisionOptions(): VisionOptionDescriptors {
  return {
    role: "describe/chart 增强 + fallback(完整 VQA)",
    latencyTier: "moderate",
    accuracyTier: "high",
    perTaskNotes: {
      "describe-image": "支持 question 参数的完整 VQA(Qwen2.5-VL)",
      "analyze-chart": "提示工程抽取 JSON;失败返占位 + description",
    },
    notes: "需配置 providers.vlm.baseUrl(指向 vLLM,如 http://127.0.0.1:8000);Qwen2.5-VL Apache-2.0",
  };
}
```

### 3.3 Registry 聚合(src/providers/registry.ts)

新增导出函数 `buildVisionCapabilitiesDetail(provider?)`,对称 `buildListModelsDetail`:

```ts
export function buildVisionCapabilitiesDetail(provider?: string): {
  defaultVisionProvider: string;
  providers: any[];
  taskCoverage: Record<string, string[]>;
  routingGuidance: Record<string, string>;
} {
  const names = provider ? [provider] : listProviders();
  const providers: any[] = [];
  const taskCoverage: Record<string, string[]> = {};

  for (const n of names) {
    const p = getProvider(n);
    if (!isVisionProvider(p)) continue; // 跳过 agnes/zhipu(非 vision)
    const h = p.health?.() ?? { configured: true, cooldown: false };
    const vc = p.visionConstraints?.() ?? {};
    const opt = p.describeVisionOptions?.();
    const tasks = [...p.visionTasks()];

    providers.push({
      name: n,
      configured: h.configured !== false,
      cooldown: h.cooldown === true,
      tier: p.tier?.() ?? 0,
      role: opt?.role,
      tasks,
      languages: vc.languages,
      maxImageBytes: vc.maxImageBytes,
      latencyTier: opt?.latencyTier,
      accuracyTier: opt?.accuracyTier,
      perTaskNotes: opt?.perTaskNotes,
      notes: opt?.notes,
      lastErrorAt: h.lastErrorAt,
    });

    for (const t of tasks) {
      (taskCoverage[t] ??= []).push(n);
    }
  }

  // taskCoverage 排序:configured 优先 → tier 降序 → 注册顺序(确定性 tiebreak)
  for (const t of Object.keys(taskCoverage)) {
    taskCoverage[t].sort((a, b) => {
      const pa = getProvider(a), pb = getProvider(b);
      const ca = pa.health?.().configured !== false ? 1 : 0;
      const cb = pb.health?.().configured !== false ? 1 : 0;
      if (ca !== cb) return cb - ca;
      const ta = pa.tier?.() ?? 0, tb = pb.tier?.() ?? 0;
      if (tb !== ta) return tb - ta;
      return 0; // 注册顺序 = registry 插入顺序
    });
  }

  return {
    defaultVisionProvider: config.defaultVisionProvider,
    providers,
    taskCoverage,
    routingGuidance: buildRoutingGuidance(taskCoverage, providers),
  };
}
```

**routingGuidance 构造**(给 CC 的一句话决策建议):
- `extract-text` → 「默认 ${defaultVisionProvider};中文文档建议配 paddle(accuracyTier=high)」
- `extract-table` → 「仅 paddle 支持;未配置时返回清晰错误,无静默降级到 OCR」
- `analyze-chart` → 「paddle 主力 + vlm fallback」
- `describe-image` → 「需 question(VQA)用 vlm;paddle 仅默认描述」

### 3.4 工具注册(src/index.ts)

`buildTools()` 加一项:
```ts
{
  name: "list_vision_capabilities",
  description: "Introspect vision (image recognition) provider capabilities BEFORE calling extract_text/extract_table/analyze_chart/describe_image — shows which providers are configured, what each supports (tasks/languages/latency/accuracy), and routing guidance per task. Use this to avoid runtime errors (e.g. extract_table needs paddle; if unconfigured you can warn the user upfront). Multilingual triggers: 能力自省 · 能力 introspect · capacités · Fähigkeiten (zh/en/fr/de).",
  inputSchema: {
    type: "object",
    properties: {
      provider: { type: "string", description: "Optional; filter to one provider. Omit for all vision providers." },
    },
  },
},
```

Handler 分支:
```ts
case "list_vision_capabilities": {
  return ok(buildVisionCapabilitiesDetail(optString(a.provider)));
}
```

### 3.5 输出示例

```jsonc
{
  "defaultVisionProvider": "tesseract",
  "providers": [
    {
      "name": "tesseract",
      "configured": true,
      "cooldown": false,
      "tier": 1,
      "role": "零配置兜底(进程内 WASM)",
      "tasks": ["extract-text"],
      "languages": ["en","zh-Hans","zh-Hant","ja","ko"],
      "maxImageBytes": undefined,
      "latencyTier": "instant",
      "accuracyTier": "low",
      "perTaskNotes": { "extract-text": "拉丁/数字强;中文弱(配置 paddle 升中文 SOTA)" },
      "notes": "M2/M3 接入后退居 fallback,恒可用(无 baseUrl 依赖)"
    },
    {
      "name": "paddle",
      "configured": false,   // ← CC 看到这个,extract_table 前会先提示用户配置
      "tier": 10,
      "role": "全能主力(中文 SOTA + 表格 + 图表 + 描述)",
      "tasks": ["extract-text","extract-table","analyze-chart","describe-image"],
      "languages": ["en","zh-Hans","zh-Hant","ja","ko"],
      "latencyTier": "fast",
      "accuracyTier": "high",
      "perTaskNotes": { "describe-image": "**忽略 question**(VQA 用 vlm)" },
      "notes": "需配置 providers.paddle.baseUrl"
    },
    {
      "name": "vlm",
      "configured": false,
      "tier": 8,
      "tasks": ["describe-image","analyze-chart"],
      "latencyTier": "moderate",
      "accuracyTier": "high"
    }
  ],
  "taskCoverage": {
    "extract-text":   ["paddle","tesseract"],   // paddle 优先(若 configured);否则 tesseract 兜底
    "extract-table":  ["paddle"],
    "analyze-chart":  ["paddle","vlm"],
    "describe-image": ["paddle","vlm"]
  },
  "routingGuidance": {
    "extract-text": "默认 tesseract;中文文档建议配 paddle",
    "extract-table": "仅 paddle 支持;未配置返回清晰错误,无静默降级",
    "analyze-chart": "paddle 主力 + vlm fallback",
    "describe-image": "需 question(VQA)用 vlm;paddle 仅默认描述"
  }
}
```

---

## 4. 与 `list_models` 的关系(补充非替代)

| 维度 | `list_models` | `list_vision_capabilities` |
|---|---|---|
| 范围 | 全模态(image/video/vision) | 仅 vision |
| 粒度 | per-provider 模型清单 + 硬约束(尺寸/帧数) | per-provider 能力矩阵 + per-task 路由 |
| 状态 | 静态(模型清单不随时变) | 动态(configured/cooldown/lastErrorAt) |
| 视角 | 「这个 provider 有什么模型」 | 「这个 provider 现在能为我做什么 + 谁该接这个任务」 |
| 字段 | models/imageModels/videoModels/visionModels/visionTasks/videoConstraints/imageConstraints/estimate_example | role/tasks/languages/maxImageBytes/latencyTier/accuracyTier/perTaskNotes/notes + taskCoverage + routingGuidance |

`list_models` 的 `visionTasks` 字段(已交付,pares5)**保留**——它是 model 清单维度的简单 boolean 列表。`list_vision_capabilities` 在它之上叠加路由建议 + 运行时状态 + 角色/延迟/精度。

---

## 5. 实施步骤(implSteps)

详见 StructuredOutput.implSteps 字段。要点:
1. types.ts 加类型(15 行)
2. 三个 provider 各加 describeVisionOptions 方法(每家 5-12 行)
3. registry.ts 加 buildVisionCapabilitiesDetail + routingGuidance 构造器(约 50 行)
4. index.ts 加工具注册(15 行)+ handler 分支(3 行)
5. README/en/ja 等多语 README 在「图像识别」章节加一段「先调 list_vision_capabilities」
6. 测试 `_test_pares6.mjs`:断言 4 个 vision provider 数量(tesseract/paddle/vlm)、tesseract.configured=true、taskCoverage 含全部 4 task、provider 未实现 describeVisionOptions 时优雅降级
7. package.json bump 0.11.0 → 0.11.1(向后兼容功能补强,patch)

---

## 6. 风险(risks)

详见 StructuredOutput.risks 字段。关键:
- **R-CI-08 双声明**:已通过「三方法真值分工」表防住;review 时需检查 describeVisionOptions 不返回 tasks/languages/maxBytes。
- **describeVisionOptions 必须无副作用**:不可触发网络/懒加载 worker;review 时断言「调用前后 state 不变」。
- **taskCoverage 排序确定性**:tier 相同的 unconfigured provider 按注册顺序兜底;已在排序逻辑注释。
- **BC**:可选方法 + 可选字段,无破坏;旧外部 provider(目前无)继续工作。

---

## 7. 验收清单

- [ ] types.ts 新类型 `VisionOptionDescriptors` + `VisionProvider.describeVisionOptions?()`
- [ ] tesseract/paddle/vlm 各实现 `describeVisionOptions()`
- [ ] registry.ts 导出 `buildVisionCapabilitiesDetail()`
- [ ] index.ts 注册 `list_vision_capabilities` 工具 + handler 分支
- [ ] handler 调用零网络(仅 health/visionConstraints/describeVisionOptions)
- [ ] describeVisionOptions 不返回 tasks/languages/maxBytes(R-CI-08 防护)
- [ ] 输出含 taskCoverage + routingGuidance
- [ ] `_test_pares6.mjs` 通过
- [ ] 多语 README 更新
- [ ] package.json bump 0.11.1

---

## 8. 后续延展(非本期)

- **pares7 候选**:把 `visionConstraints().languages` / `maxImageBytes` 合入 `describeVisionOptions()`,统一为单一 self-describing 方法,`visionConstraints()` 标记 deprecated。本期不做(避免 pares6 同时引入 + 废弃,混乱)。
- **list_image_capabilities / list_video_capabilities**:对称工具,补 image/video 的 configured/cooldown 状态。本期仅 vision,等用户反馈后再做(image/video provider 少,需求弱)。
- **健康探测**:可选 `ping?: boolean` 参数,让 list_vision_capabilities 触发一次轻量 HEAD 请求验证 paddle/vlm 真在线(当前只看 configured 字段)。本期不做(避免引入网络,违背「自省无副作用」)。