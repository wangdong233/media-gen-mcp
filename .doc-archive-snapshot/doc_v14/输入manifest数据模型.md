# 输入 manifest 数据模型(producer 契约)

> **角色**:【输入 manifest 数据模型】设计调查者
> **日期**:2026-07-28
> **范围**:设计一个表达"抽象分层树"的 manifest schema,对齐 01 §2.1,作为 `generate_interactive_diagram` 从"单图"升级到"分层树"的 producer 契约(03 §1.2)基础。
> **立场**:这是**设计 + 审查**任务,不实施代码。所有 TS interface 是契约草案,不是要落地的 src/。
> **上游锚**:
> - 01 §2.1(航母分层 = 节点可递归细分;模块间交互复杂就再抽象一层 = 节点可挂不同 diagramType)
> - 01 §3.2(Metz:错误抽象比重复更糟;duplication > wrong abstraction)
> - 03 §1.2(producer 契约七项,尤其 1/2/3/7)+ §1.6.3(过工程化拒绝)
> - doc_v12/收口决策.md §2(generate_interactive_diagram = 轻量 viewer,**不自研拖拽编辑器**)
> - 当前实现参照:`media-gen-mcp/src/interactive-html/index.ts:40-52`(`InteractiveDiagramRequest.code: string` 是唯一必填业务字段 —— 这正是 manifest 树的**叶子节点的现成形态**)

---

## 0. 一句话定位

> **manifest = 把当前 `InteractiveDiagramRequest`(叶子)递归包成树,每节点 = 一个抽象层。**
>
> 当前 producer 契约是"一张 D2 → 一个 HTML"。manifest 不发明新概念,只把"一张图"的契约重复应用到"一棵树":**树根是顶层架构,children 是每个舱再细分的子图**。这正是 01 §2.1 航母案例的字面落地 —— 总工眼里航母是简单分层,本工具就是把这棵"总工脑中的分层树"序列化。

---

## 1. 候选 schema(TS interface 草案,最小可用)

### 1.1 核心定义

```typescript
/**
 * Manifest 树节点 —— 一个抽象层(对齐 01 §2.1)。
 *
 * 设计原则(01 §3 抽象纪律):
 *   - 必填字段只有 3 个(id / label / diagram),其余全部选填 + 智能缺省
 *   - 不为假想未来加字段(版本号 / 权限 / 布局坐标等,见 §5 YAGNI 清单)
 *   - diagram 缺省/空串 = 仅作分组容器,不渲染图(语义显式,03 §1.2 项 2)
 */
export interface ManifestNode {
  /** 跨整棵树唯一标识(viewer 用作 hash 路由锚点)。必填。 */
  id: string;

  /** 节点显示名(浏览器 UI 文字、面包屑、<title>)。必填。 */
  label: string;

  /**
   * 该层的 D2 DSL 源码。必填(但允许空串)。
   * - 非空:viewer 渲染对应 diagramType 的图
   * - 空串 "":节点仅作分组容器(常见于"业务服务"这种纯聚合层),不渲染图
   * 空串 ≠ undefined:显式区分"我决定这里不画图" vs "字段漏了"(03 §1.2 项 2)
   */
  diagram: string;

  /**
   * 图类型显式标注;缺省 = "architecture"(最常见,智能 infer)。
   * 选填 —— viewer 也可基于 D2 内容启发式 infer,但显式 > 隐式(防 infer 错)。
   *
   * 不用 union 扩展为"任意字符串":枚举闭环,未来加新类型须显式 PR(概念完整性,01 §2.5 刻度四)。
   */
  diagramType?: DiagramType;

  /**
   * 子节点;缺省或 [] = 叶子(无 drill-down)。
   * 选填 —— 树可以是单节点(等价于当前的 generate_interactive_diagram 单图)。
   */
  children?: ManifestNode[];

  /**
   * 旁注 / WHY(1-2 句话,解释"这一层为什么这么分")。
   * 选填 —— 对齐用户偏好"注释解释 WHY 不解释 WHAT"(03 §1.1 项 3)。
   * 故意不拆成 multi-field meta(description / rationale / owner / tags…):
   *   重复的元数据字段是错误抽象温床(01 §3.2),一个 notes 字段够用。
   */
  notes?: string;
}

/**
 * 图类型枚举(闭环,新加须 PR)。
 *
 * 选择依据:对齐 D2 + Graphviz 实际能区分的语义图,以及 doc_v12/OSS竞品调研
 * 里高频出现的四种。不引入 "component" / "deployment" 等细分(留给 D2 DSL 自己表达)。
 */
export type DiagramType =
  | "architecture" // 组件/模块拓扑(默认)
  | "sequence"     // 时序(方法/进程交互)
  | "er"           // 实体关系(数据模型)
  | "class"        // 类图(继承/组合)
  | "flowchart";   // 流程/状态机

/**
 * manifest 文件根对象。
 *
 * 故意不包 { version, manifest, metadata }:root 就是节点本身(顶图 = 根)。
 * 顶层不另设 schema version —— 见 §5 YAGNI:无迁移故事前不加版本号。
 */
export type Manifest = ManifestNode;
```

### 1.2 字段总览(6 个字段,3 必填 3 选填)

| 字段 | 必填 | 类型 | 缺省 | 空值语义(03 §1.2 项 2) |
|---|---|---|---|---|
| `id` | ✅ | string | — | 缺 = 阻断(viewer 无法路由) |
| `label` | ✅ | string | — | 缺 = 阻断(UI 无文字);空串 = 阻断 |
| `diagram` | ✅ | string | — | **空串 `""` = 显式"仅分组容器,不画图"**;`undefined` = 阻断(必填字段漏了) |
| `diagramType` | ☐ | enum | `"architecture"` | `undefined` = viewer infer;显式覆盖优先 |
| `children` | ☐ | array | `[]`(等价叶子) | `undefined` / `[]` / 缺省 = 三者等价 = 叶子节点 |
| `notes` | ☐ | string | — | `undefined` = 无旁注;空串 = 无旁注(等价) |

**字段数对比**:当前 `InteractiveDiagramRequest` 是 7 字段(2 必填 `code`/落盘隐含 + 5 选填);manifest 节点 6 字段(3 必填 + 3 选填)。**未引入"新概念",只是把现有"图 + 元数据"重复递归**。

### 1.3 与当前 `InteractiveDiagramRequest` 的关系(向后兼容)

当前(`media-gen-mcp/src/interactive-html/index.ts:40-52`):
```typescript
interface InteractiveDiagramRequest {
  code: string;       // ← manifest.diagram
  theme?: string;     // ← 提升到 viewer 全局配置(不在节点级)
  darkTheme?: string; // ← 同上
  title?: string;     // ← manifest.label(顶层)
  previewPng?: boolean; // ← viewer 配置(运行时行为,非数据模型)
  name?: string;      // ← 落盘配置(handler 层,非数据模型)
  outDir?: string;    // ← 落盘配置(handler 层,非数据模型)
}
```

**映射结论**:
- `code` → `diagram`(改名为更通用的"该层图源",不再叫 code)
- `title` → 顶层节点的 `label`
- `theme` / `darkTheme` → **从节点级提升到 viewer 级全局配置**(整棵树共享主题,01 §2.5 刻度四"正交性检查":主题切换整个 viewer 统一,不应每节点单独配)
- `previewPng` / `name` / `outDir` → **不进数据模型**,留在 handler 配置(落盘是 producer→artifact 的事,不是数据模型的事;03 §0.1 项 2 construct vs artifact)

**单图等价性**:一棵只有根节点的 manifest(无 children)= 当前单图调用 byte-equivalent。这保证**向后兼容**:旧 producer 仍可调 `generate_interactive_diagram(code)`,新 producer 包一层 `{id, label, diagram: code}` 即可。

---

## 2. Producer 是谁 + 工作流

### 2.1 核心判断:producer 双轨(AI 主,人手写兜底)

| Producer | 场景 | 比例预估 |
|---|---|---|
| **Claude / AI 生成** | 用户给项目描述或代码库,Claude 出 manifest | ~80%(主路径) |
| **人手写** | 用户已有 D2 / 偏好控制、小树(2-3 节点) | ~20%(兜底) |

**为什么 AI 主路径合理**:01 §2.1 的"总工眼里航母是简单分层" —— 这个"看出来"的能力正是 LLM 擅长的(它从训练数据里见过海量架构分层模式)。人手写多层 D2 是痛苦的(每层都是独立 DSL),AI 生成是廉价的。

**为什么人手写不能被取缔**:小树(2-3 节点)人手写比写 prompt 还快;且 01 §3.2 "duplication > wrong abstraction" —— 用户对自己项目的真实分层有权威判断,不应被 AI 推断覆盖。

### 2.2 AI producer 工作流(三阶段,对齐 01 §4.3 航船修正)

```
┌─────────────────────────────────────────────────────────────────┐
│  阶段 1:OUTLINE(大纲,只列骨架不画图)                          │
│  ───────────────────────────────────────────────────────────    │
│  用户给:Claude 描述项目("电商系统,5 大服务,微服务架构")     │
│  Claude 出:{id, label, diagramType, children 骨架} —— 全部     │
│           diagram 字段留空 "":此时是"骨架 manifest"            │
│                                                                 │
│  用户审核大纲:确认/调整分层(renaming / 删层 / 加层)          │
│  ── 航船修正(§4.3):目标(大纲)先定,实施(DSL)跟随 ──      │
└────────────────────────────────┬────────────────────────────────┘
                                 │ 用户 sign-off 大纲
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  阶段 2:FILL(逐层填 D2 DSL,top-down)                          │
│  ───────────────────────────────────────────────────────────    │
│  Claude 从根开始,逐节点填 diagram:                             │
│    顶层架构图 → 每个一级子节点内部图 → 每个二级子节点图…       │
│  每层独立 D2,粒度递增(顶层 5 个框,二级 15 个框,三级 时序)   │
│                                                                 │
│  可并行:同层兄弟节点可并行生成(无依赖);跨层串行              │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  阶段 3:VALIDATE + EMIT(契约验证,落盘)                       │
│  ───────────────────────────────────────────────────────────    │
│  跑 §3 的 5 项验证(id 唯一 / 无环 / diagram 非空检查 /         │
│  diagramType 合法 / children 闭合)                             │
│  落盘 manifest.json + 调 viewer 渲染                            │
└─────────────────────────────────────────────────────────────────┘
```

**关键设计决策**:
1. **大纲与填充分离**(阶段 1 vs 阶段 2):用户先 sign-off 分层结构,Claude 再花成本画图。对应 01 §4.3 "目标持续变动,实施中也要随之变动" —— 防止用户看到完整图才发现分层错了,重画成本高。
2. **每层 diagram 独立**(不强求跨层引用):每节点的 D2 是自包含的,不引用兄弟节点的 id。**理由 YAGNI**:跨层引用是"图叠加"需求(如顶层画箭头指向二级某节点),目前无真实用例,引用机制是错误抽象温床(01 §3.2)。等真实需求出现再加(§5 YAGNI 拒绝清单)。
3. **粒度自然衰减**:顶层粗(5-10 框)、中层中(10-20 框)、叶子细(可时序图/ER 图)。**不在 schema 强制 depth 上限**(防过工程化),靠 producer 工作流约定。

### 2.3 Producer 契约文档(03 §1.2 项 1 强制)

producer(AI 或人)输出的 manifest.json 字段集,**必须有一份对应的 producer 契约文档**(L1 证据,非注释):

| 字段 | producer 必须保证 | viewer 可假设 |
|---|---|---|
| `id` | 跨整棵树唯一;[a-z0-9-] kebab-case;非空 | 直接用作 hash 路由,不查重 |
| `label` | 非空字符串;UTF-8(允许中文) | 直接渲染 UI,不 escape(producer 负责) |
| `diagram` | 字符串(空串合法);D2 语法 | 空串 = 跳过渲染;非空 = 调 D2 引擎 |
| `diagramType` | enum 5 值之一,或缺省 | 缺省 = "architecture";显式优先 |
| `children` | 数组,或缺省/空 | 缺省/空/undefined 三者等价 = 叶子 |
| `notes` | 字符串或缺省 | 缺省 = 不显示旁注 |

---

## 3. 数据契约验证清单(03 §1.2 落地)

> **03 §1.2 项 1(🔴 producer 契约验证)**:viewer(consumer)读取 manifest.json 每个字段时,必须能追溯到本清单定义的语义;**手写 TypeScript interface 不是运行时证据**(03 §0.3 L0'),必须配 JSON Schema 运行时校验。

### 3.1 五项必跑验证(viewer 加载 manifest 时)

| # | 验证项 | 触发时机 | 失败行为 |
|---|---|---|---|
| **V1** | **id 唯一性**:DFS 遍历整棵树,所有 `id` 集合 size == 节点总数 | 加载时 | 🔴 阻断 + 报"重复 id 列表" |
| **V2** | **无环检测**:manifest 是树,不是图 —— children 只能内联定义,不允许引用别处节点 | 加载时(DFS + visited 集合) | 🔴 阻断 + 报"环路径" |
| **V3** | **必填字段完整**:每节点 `id` / `label` / `diagram` 三者非 undefined;`label` 非空串 | 加载时(JSON Schema) | 🔴 阻断 + 报具体节点路径 |
| **V4** | **diagramType 合法**:enum 5 值之一,或缺省 | 加载时 | 🔴 阻断 + 报"未知类型" |
| **V5** | **children 闭合**:children 数组每元素也是 ManifestNode(递归校验) | 加载时 | 🔴 阻断 + 报"children[i] 非节点" |

### 3.2 字段缺失语义(03 §1.2 项 2,逐字段)

| 字段 | `undefined`(缺) | `null` | `""` 空串 | `[]` 空数组 |
|---|---|---|---|---|
| `id` | 🔴 阻断 | 🔴 阻断(null 不等价 undefined) | 🔴 阻断 | — |
| `label` | 🔴 阻断 | 🔴 阻断 | 🔴 阻断(空名无意义) | — |
| `diagram` | 🔴 阻断(必填) | 🔴 阻断 | ✅ **仅分组容器,不渲染图** | — |
| `diagramType` | ✅ infer = "architecture" | 🔴 阻断(不要用 null) | 🔴 阻断 | — |
| `children` | ✅ 等价叶子 | 🔴 阻断(不要用 null) | — | ✅ 等价叶子 |
| `notes` | ✅ 无旁注 | 🔴 阻断 | ✅ 等价无旁注 | — |

**关键约定**:**全部禁用 `null`**。`null` 在 JSON 里与 `undefined` 不同,但 TypeScript 类型已声明可选字段 —— producer 输出 `null` 是冗余且语义不清(03 §1.2 项 2 红线:必须答"null 时什么行为")。**显式禁 null**,简化契约到"要么有值,要么缺字段"。

### 3.3 写前先校验(03 §1.2 项 3)

viewer 把 manifest 写入内存 state(如 `currentNode`、`parentStack`)前,**必须**先跑 V1-V5 全过。校验失败 → 不写入任何 state,直接抛 + UI 显示错误。**严禁"部分加载"**(某节点字段缺失时,viewer 不应进入半工作状态 —— 那会把 producer 的缺字段传播进内部 state,正是 cc-status-dot Anchor B 案例(03 附录 C)的同构失败模式)。

### 3.4 跨节点引用:不支持(v1 严格树形)

**决策**:`children` 数组只接受**内联定义**的 `ManifestNode`,**不接受 `$ref: "node-id"` 形式的引用**。

**理由(YAGNI + 01 §3.2)**:
1. 引用机制是为了"复用子树",但目前没有真实用例 —— 用户描述"分层架构"时,每层是独立抽象,不会出现"订单服务的内部图 == 支付服务的内部图"这种需要引用的情况。
2. 引入 `$ref` 立刻带来"环检测 / 引用解析 / 部分更新语义"三套复杂度,是典型的"参数蔓延"起点(01 §3.2)。
3. **错误抽象比重复贵**(Metz):即使将来真有重复,**复制两份 DSL 也比引入引用机制便宜**(可直接 diff/合并;引用机制一旦错,回退成本高)。

**何时 reconsider**:出现 ≥3 个真实用户场景,且每个场景的引用子树 > 5 节点(复制成本超过心理阈值)。此时再加,且只加最小形态(`$ref` + 解析器,不引入 path-based 引用)。

### 3.5 序列化不变量(03 §1.2 项 6)

**round-trip stable**:`JSON.parse(JSON.stringify(manifest))` 后,跑 V1-V5 仍全过。即:manifest 是纯数据,无函数 / Date / Symbol / 循环引用。viewer 内部 state 可加这些,但**落盘的 .json 必须可 round-trip**。

---

## 4. 三层电商系统示例(直观验证 schema)

> 场景:用户对 Claude 说"给我画一个电商系统的架构图,要能 drill-down 到订单服务的微服务,再 drill-down 到下单时序"。
> 下面是对应 manifest(简化,D2 DSL 用伪代码占位,真实 producer 会填完整 DSL)。

```json
{
  "id": "ecommerce-system",
  "label": "电商系统总览",
  "diagram": "client (Web/App) -> gateway -> business_services -> data_layer -> infra\n... 顶层 5 层架构 DSL ...",
  "diagramType": "architecture",
  "notes": "顶层按职责分 5 层:客户端 / 网关 / 业务服务 / 数据 / 基础设施。",
  "children": [
    {
      "id": "client-layer",
      "label": "客户端层",
      "diagram": "Web -> CDN; App -> API_GW; ...",
      "diagramType": "architecture",
      "children": []
    },
    {
      "id": "business-services",
      "label": "业务服务层",
      "diagram": "",
      "diagramType": "architecture",
      "notes": "纯聚合层:本身不画图,只承载 5 个微服务 children。点开任一服务看其内部。",
      "children": [
        {
          "id": "order-service",
          "label": "订单服务",
          "diagram": "OrderAPI -> OrderCore -> {Inventory, Payment, Shipping}\n... 订单服务内部组件 DSL ...",
          "diagramType": "architecture",
          "children": [
            {
              "id": "order-create-sequence",
              "label": "创建订单时序",
              "diagram": "Client -> OrderAPI: POST /orders\nOrderAPI -> Inventory: lock\nInventory --> OrderAPI: ok\nOrderAPI -> Payment: charge\n... 时序图 DSL ...",
              "diagramType": "sequence",
              "notes": "用户点'下单'后的内部调用顺序。叶子节点,无 children。"
            }
          ]
        },
        {
          "id": "payment-service",
          "label": "支付服务",
          "diagram": "PaymentAPI -> {Alipay, Wechat, Stripe}",
          "diagramType": "architecture",
          "children": []
        },
        {
          "id": "inventory-service",
          "label": "库存服务",
          "diagram": "InventoryAPI -> StockDB",
          "diagramType": "architecture"
        }
      ]
    },
    {
      "id": "data-layer",
      "label": "数据层",
      "diagram": "MySQL (orders) || Redis (cache) || ES (search)",
      "diagramType": "er"
    }
  ]
}
```

### 4.1 示例覆盖的 schema 特性(逐项验证)

| 特性 | 示例中体现 | 验证 |
|---|---|---|
| 3 必填字段 | 每节点都有 id/label/diagram | V3 ✅ |
| diagram 空串合法 | `business-services` 节点 `diagram: ""` | 仅分组容器,不渲染图 ✅ |
| diagramType 切换 | 顶层 `architecture` → 叶子 `sequence` → `data-layer` 是 `er` | V4 enum 合法 ✅ |
| children 缺省 = 叶子 | `inventory-service` 无 children 字段;`order-create-sequence` 同 | 缺省/[]/undefined 等价 ✅ |
| notes 选填 | 顶层有;`client-layer` 没有 | 不强制 ✅ |
| id 唯一 | 跨整棵树无重复 | V1 ✅ |
| 无环(纯树) | 所有 children 内联,无 $ref | V2 ✅ |
| 多层 drill-down | 根 → business-services → order-service → order-create-sequence(4 层) | 递归展开 ✅ |

### 4.2 用户交互形态(viewer 视角,不在本任务范围但说明 schema 用途)

- 浏览器打开 manifest → 渲染**根节点**的 `architecture` 图(电商总览)
- 用户点图上"业务服务层"框 → viewer 切到 `business-services` 节点 → 该节点 `diagram: ""`,故**显示子节点列表**(5 个微服务卡片),不渲染图
- 用户点"订单服务"卡片 → 切到 `order-service` → 渲染其 `architecture` 图
- 用户点图上"创建订单"框 → 切到 `order-create-sequence` → 渲染 `sequence` 时序图
- 面包屑:`电商系统总览 / 业务服务层 / 订单服务 / 创建订单时序`

**关键**:整个交互只需 manifest 数据 + viewer 逻辑,**不需要任何额外字段**(无 layout / 无 clickHandler / 无 transition)。schema 最小性得到验证。

---

## 5. YAGNI 拒绝清单(01 §3 + 03 §1.6.3)

> **过工程化拒绝红线**(03 §1.6.3 项 3):每个为假想未来需求加的字段,要求移除。下面是被显式拒绝的字段,**未来加入须 PR 写明真实用例**。

### 5.1 已拒绝字段(共 10 项)

| # | 拒绝字段 | 拒绝理由(对齐 01 §3) | 何时 reconsider |
|---|---|---|---|
| **Y1** | `version`(manifest schema 版本号) | **无迁移故事前不加**。当前是 v1,没有 v2,version 字段是空装饰。等真有 breaking change(如改 id 类型),那时加 v2 + 迁移器 | 首次 breaking schema 变更 |
| **Y2** | `permissions` / `visibility`(节点级权限) | **无多用户场景**。manifest 是单用户/单会话的视图,不是协作编辑器的权限模型(且 doc_v12 §2 明确"不自研编辑器") | 多用户协作真实需求 |
| **Y3** | `layout` / `x` / `y` / `width` / `height`(布局坐标) | **直接违反 doc_v12 §2 "不自研拖拽编辑器"**。布局由 D2 auto-layout 负责,manifest 不重复。布局坐标 = 编辑器状态,不是数据模型 | 永不(立场冲突) |
| **Y4** | `$ref`(跨节点引用) | 见 §3.4 —— 无真实复用用例;引用机制是错误抽象温床(Metz) | ≥3 个真实场景 + 子树 > 5 节点 |
| **Y5** | `style`(节点级样式覆盖:color / stroke) | **D2 DSL 已表达样式**(D2 `style.fill: red`)。manifest 重复 = 信息双源,违反 01 §2.5 刻度四"正交性检查" | 永不(用 D2 表达) |
| **Y6** | `tags` / `categories`(节点分类标签) | **无检索需求**。viewer 是树形 drill-down,不做 tag 筛选/搜索 | 真有"按 tag 过滤树"需求 |
| **Y7** | `createdAt` / `updatedAt` / `author`(元数据) | **git 已有**。manifest.json 落盘进 git,版本信息从 git log 取,不进数据模型 | 永不(用 git) |
| **Y8** | `i18n`(节点级多语言:`{label: {zh, en}}`) | **label 直接用目标语言**。多语 manifest = 多份 .json,不是一份里塞 N 语。i18n 是 producer 工作流的事,不是 schema 的事 | 真有同一 manifest 跨语种切换需求 |
| **Y9** | `collapsed`(节点折叠状态保存) | **viewer 运行时状态,非数据模型**。折叠是用户当前会话的偏好,落盘进 manifest = 污染数据源(03 §0.1 项 2 construct vs artifact) | 永不(用 viewer localStorage) |
| **Y10** | `thumbnail` / `previewPng`(节点缩略图) | **viewer 可即时渲染 D2**,无需预算 PNG。缓存图属于 viewer 实现细节,不进 schema | 真有性能瓶颈(D2 渲染 > 1s)且证明预渲染是唯一解 |

### 5.2 拒绝原则总结(供未来 review 引用)

每次有人提"加个字段 X"时,过这四问(03 §1.6 review 三问的本地化):

1. **真实用例**:能说出 ≥1 个具体用户场景吗?(不是"将来可能")
2. **不能由现有字段表达**:D2 DSL / viewer 配置 / git 不能解决吗?
3. **不加的代价比加的大吗**:Metz 测试 —— 加了之后回退成本 vs 不加时复制成本
4. **概念完整性**(01 §2.5 刻度四):这个字段属于"数据模型"层,还是"viewer 运行时"层?混层 = 概念完整性流失

四问任一答不上 → 拒绝。

---

## 6. 设计决策摘要(供 review 抓 bug)

### 6.1 关键决策(每条都可追溯到上游锚)

| # | 决策 | 上游锚 | 理由 |
|---|---|---|---|
| D1 | schema 只有 6 字段(3 必填 + 3 选填) | 01 §3 + 03 §1.6.3 | 最小可用;不为假想未来加字段 |
| D2 | `diagram` 必填但允许空串 | 03 §1.2 项 2 | 显式区分"漏字段" vs "分组容器" |
| D3 | `children` 缺省/空/undefined 三者等价 = 叶子 | 03 §1.2 项 2 | 简化契约;不区分三态 |
| D4 | 全部禁 `null`(只允许 undefined 或有值) | 03 §1.2 项 2 | null 语义不清,简化到二态 |
| D5 | `diagramType` 是闭环 enum(5 值),非任意字符串 | 01 §2.5 刻度四 | 概念完整性;新加须 PR |
| D6 | 不支持 `$ref`(v1 严格树形) | 01 §3.2 + 03 §1.6.3 | 错误抽象比重复贵;无真实用例 |
| D7 | `theme` / `darkTheme` 提升到 viewer 级,不在节点级 | 01 §2.5 刻度四(正交性) | 整树共享主题;每节点单独配 = 信息双源 |
| D8 | `previewPng` / `name` / `outDir` 不进数据模型 | 03 §0.1 项 2(construct vs artifact) | 落盘是 producer→artifact 的事 |
| D9 | 单图(无 children)= 当前 generate_interactive_diagram 调用 byte-equivalent | 向后兼容 | 旧 producer 不破 |
| D10 | AI 是主 producer,人手写是兜底;大纲与填充分离 | 01 §4.3(航船修正) | 目标先定,实施跟随 |

### 6.2 未决问题(转后续)

见 §7。

---

## 7. 未决问题(开放问题)

| # | 问题 | 当前倾向 | 触发解决条件 |
|---|---|---|---|
| **Q1** | manifest.json 落盘位置:`.json` 单独文件,还是 inline 进 HTML(`<script type="application/json">`)? | **倾向 inline**(单文件自包含,对齐 P0-5A 立场;但牺牲可独立编辑) | 实现期:若用户反馈"想用编辑器改 json" → 双输出 |
| **Q2** | viewer 加载大 manifest(>50 节点)性能:D2 渲染是 O(节点数),是否懒加载(只渲染当前节点 + 父链)? | **倾向懒加载**(只渲染当前 + 父子邻接);schema 不变 | 实现期:profile 真实 manifest;若首屏 > 500ms 才优化 |
| **Q3** | diagramType 缺省 infer:viewer 启发式 infer(D2 含 `->` 多 = sequence)还是严格 default = "architecture"? | **倾向严格 default**(显式 > 隐式,防 infer 错;producer 责任) | 用户反馈"经常忘标 diagramType" 时 reconsider |
| **Q4** | `id` 命名规范:强制 kebab-case,还是允许任意? | **倾向强制 kebab-case** [a-z0-9-](URL hash 友好) | 真有用户需要中文 id 时 reconsider(但中文 hash 麻烦) |
| **Q5** | 跨节点 D2 引用(顶层图箭头指向"订单服务"节点 id,点击跳转):靠 D2 native id 锚点,还是 manifest 层加 link 字段? | **倾向不加字段**,用 D2 SVG native `<a href="#order-service">`(D2 支持) | 真用起来发现 D2 锚点不够用再加 |
| **Q6** | 是否提供 manifest schema 的 JSON Schema(.json)文件,供 producer 在 CI 里校验? | **倾向提供**(03 §0.3 L0' 警告:TS interface 不是运行时证据,JSON Schema 才是) | 实现 v1 时一并出 |

---

## 8. 与 01/03 的对齐自查(设计审查)

| 01/03 条款 | 本设计如何对齐 |
|---|---|
| **01 §2.1**(航母分层 = 节点可递归细分) | `children` 字段 = "每舱再细分";manifest 树 = 总工脑中的分层树 |
| **01 §2.1**(模块间交互复杂就再抽象一层) | `diagramType` 切换(architecture → sequence → er)= 同一节点挂不同抽象面 |
| **01 §2.3**(simple = 不交织) | schema 字段无缠绕:6 字段各自单一职责(id 路由 / label 显示 / diagram 内容 / type 元信息 / children 结构 / notes 旁注) |
| **01 §2.4**(深模块:接口小实现厚) | manifest 是"数据接口",viewer 是"实现" —— 接口只 6 字段,实现可任意厚(D2 渲染 / 交互 / 主题) |
| **01 §2.5 刻度四**(概念完整性) | `diagramType` 闭环 enum;禁 null;三态合一(undefined/[]/缺省 = 叶子)|
| **01 §3.2**(错误抽象比重复贵) | 拒绝 `$ref`(Y4);拒绝 layout(Y3);10 项 YAGNI 拒绝 |
| **03 §1.2 项 1**(producer 契约验证) | §2.3 producer 契约文档 + §3.5 round-trip + Q6 JSON Schema |
| **03 §1.2 项 2**(字段缺失语义) | §3.2 逐字段语义表(undef/null/空串/空数组四态) |
| **03 §1.2 项 3**(写前先校验) | §3.3 V1-V5 全过才写 state;严禁部分加载 |
| **03 §1.6.3**(过工程化拒绝) | §5 10 项 YAGNI 拒绝 + 四问 |
| **03 §0.1 项 2**(construct vs artifact) | D8:落盘配置不进数据模型 |
| **doc_v12 §2**(不自研拖拽编辑器) | Y3/Y9:布局坐标 / 折叠状态不进 schema |

---

**文档结束**。本设计是 producer 契约草案,待后续实施任务(若启动)落地为 `src/interactive-html/manifest.ts` + JSON Schema + viewer 集成。当前范围:设计 + 审查,不实施代码。
