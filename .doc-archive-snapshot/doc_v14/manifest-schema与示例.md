# manifest 数据契约与 3 层示例(producer 契约)

> **角色**:【嵌套架构图工具 方案+审查 总撰稿人】
> **日期**:2026-07-28
> **性质**:本文件是 `嵌套架构图工具-方案与审查报告.md` 的支撑件,提供数据契约的完整定义 + 直观示例 + 字段验证清单 + YAGNI 拒绝清单。
> **上游锚**:`doc_v14/输入manifest数据模型.md`(原调查稿)、`01 §2.1`(航母分层)、`01 §3.2`(Metz 错误抽象)、`03 §1.2`(producer 契约)。

---

## 0. 一句话定位

> **manifest = 把当前 `InteractiveDiagramRequest`(叶子)递归包成树,每节点 = 一个抽象层。**

当前 producer 契约是"一张 D2 → 一个 HTML"(`media-gen-mcp/src/interactive-html/index.ts:40-52` 的 `InteractiveDiagramRequest.code: string`)。manifest 不发明新概念,只把"一张图"的契约递归应用到"一棵树":**树根是顶层架构,children 是每个舱再细分的子图**。这正是 01 §2.1 航母案例的字面落地。

---

## 1. Schema TS 定义(6 字段,3 必填 + 3 选填)

```typescript
/**
 * Manifest 树节点 —— 一个抽象层(对齐 01 §2.1)。
 *
 * 设计原则(01 §3 抽象纪律):
 *   - 必填字段只有 3 个(id / label / diagram),其余全部选填 + 智能缺省
 *   - 不为假想未来加字段(版本号 / 权限 / 布局坐标等,见 §5 YAGNI 清单)
 *   - diagram 缺省/空串 = 仅作分组容器,不渲染图(语义显式,03 §1.2 项 2)
 *   - 全部禁 null(只允许 undefined 或有值,简化到二态)
 */
export interface ManifestNode {
  /** 跨整棵树唯一标识(viewer 用作 hash 路由锚点)。必填,^[a-z0-9-]+$。 */
  id: string;

  /**
   * 节点显示名(浏览器 UI 文字、面包屑、<title>)。必填。
   * 🔴 信任边界:producer 不可信(AI/人手写皆可),viewer 侧强制 escapeHtml。
   */
  label: string;

  /**
   * 该层的 D2 DSL 源码。必填(但允许空串)。
   * - 非空:viewer 渲染对应 diagramType 的图
   * - 空串 "":节点仅作分组容器(常见于"业务服务"这种纯聚合层),
   *   viewer 切到该层时显示 placeholder + children 卡片高亮(viewMode: "container-list")
   *
   * 空串 ≠ undefined:显式区分"我决定这里不画图" vs "字段漏了"(03 §1.2 项 2)
   */
  diagram: string;

  /**
   * 图类型显式标注;缺省 = "architecture"(最常见,智能 infer)。
   * 选填 —— 显式 > 隐式(防 infer 错)。
   * 闭环 enum:新加类型须显式 PR(概念完整性,01 §2.5 刻度四)。
   */
  diagramType?: DiagramType;

  /**
   * 子节点;缺省或 [] = 叶子(无 drill-down)。
   * 选填 —— 树可以是单节点(等价于当前的 generate_interactive_diagram 单图)。
   * children: undefined / [] / 缺省 三者等价 = 叶子节点。
   */
  children?: ManifestNode[];

  /**
   * 旁注 / WHY(1-2 句话,解释"这一层为什么这么分")。
   * 选填 —— 对齐用户偏好"注释解释 WHY 不解释 WHAT"(03 §1.1 项 3)。
   * 故意不拆成 multi-field meta:重复的元数据字段是错误抽象温床(01 §3.2)。
   * 不进 viewer(producer 自用,不渲染)。
   */
  notes?: string;
}

export type DiagramType =
  | "architecture" // 组件/模块拓扑(默认)
  | "sequence"     // 时序(方法/进程交互)
  | "er"           // 实体关系(数据模型)
  | "class"        // 类图(继承/组合)
  | "flowchart";   // 流程/状态机

/**
 * manifest 文件根对象。
 * 故意不包 { version, manifest, metadata }:root 就是节点本身(顶图 = 根)。
 */
export type Manifest = ManifestNode;
```

---

## 2. 字段总览与四态语义表

### 2.1 字段总览

| 字段 | 必填 | 类型 | 缺省 | 空值语义(03 §1.2 项 2) |
|---|---|---|---|---|
| `id` | ✅ | string | — | 缺 = 阻断(viewer 无法路由) |
| `label` | ✅ | string | — | 缺 = 阻断(UI 无文字);空串 = 阻断 |
| `diagram` | ✅ | string | — | **空串 `""` = 显式"仅分组容器,不画图"**;`undefined` = 阻断(必填字段漏了) |
| `diagramType` | ☐ | enum | `"architecture"` | `undefined` = viewer infer;显式覆盖优先 |
| `children` | ☐ | array | `[]`(等价叶子) | `undefined` / `[]` / 缺省 = 三者等价 = 叶子节点 |
| `notes` | ☐ | string | — | `undefined` = 无旁注;空串 = 无旁注(等价) |

**字段数对比**:当前 `InteractiveDiagramRequest`(`index.ts:40-55`)是 7 字段(2 必填 + 5 选填);manifest 节点 6 字段(3 必填 + 3 选填)。**未引入"新概念",只是把现有"图 + 元数据"重复递归**。

**字段数裁决**(03 §1.6 调查间矛盾化解):inv:01-alignment-scope §2.1 倾向"≤4 字段"(id/code/children/title),inv:input-manifest 是 6 字段。**主控裁决:6 字段**。理由:① notes 选填不影响核心简单性;② id/label/diagram + children 已是抽象最小集;③ diagramType 缺省智能推断平衡概念完整性与易用性;④ 01 §3 "抽象是手段非目的" —— 字段数不是越少越好,而是"每个字段都过得了 review 三问"。6 字段全过审。

### 2.2 与当前 `InteractiveDiagramRequest` 的关系(向后兼容)

| 当前字段 | manifest 映射 |
|---|---|
| `code: string` | `manifest.diagram`(顶层) |
| `theme?: string` | 提升到 `NestedDiagramRequest.theme`(viewer 全局,整树共享) |
| `darkTheme?: string` | 同上 |
| `title?: string` | `manifest.label`(顶层) |
| `previewPng?: boolean` | `NestedDiagramRequest.previewPng`(运行时配置,非数据模型) |
| `name?: string` | `NestedDiagramRequest.name`(落盘配置) |
| `outDir?: string` | `NestedDiagramRequest.outDir`(落盘配置) |

**单图等价性**:无 children 的根节点 manifest = 当前 `generate_interactive_diagram(code)` 调用 byte-equivalent。旧 producer 不破;新 producer 包一层 `{id, label, diagram: code}` 即升级。

---

## 3. Producer 契约验证(V1-V5,03 §1.2 落地)

### 3.1 五项必跑验证

| 验证 | 含义 | 触发时机 | 失败行为 |
|---|---|---|---|
| **V1 id 唯一性** | DFS 收集所有 id,size == 节点总数 | 写前 | 整树拒绝 |
| **V2 无环检测** | manifest 是树不是图;v1 严格树形 | 写前 | 整树拒绝 |
| **V3 必填字段完整** | id/label/diagram 三者非 undefined,label 非空串 | 写前 | 整树拒绝 |
| **V4 diagramType 合法** | enum 5 值或缺省 | 写前 | 整树拒绝 |
| **V5 children 闭合** | 递归校验每元素也是 ManifestNode | 写前 | 整树拒绝 |

**id 字符集校验**(叠加):`id` 必须匹配 `^[a-z0-9-]+$`(URL hash 友好 + 防 D2 ID 元字符冲突 + 防 salt 注入异常)。违例 = 整树拒绝。

### 3.2 字段缺失四态语义(03 §1.2 项 2)

逐字段定义 undefined / null / 空串 / 空数组语义:

| 字段 | undefined | null | 空串 `""` | 空数组 `[]` |
|---|---|---|---|---|
| `id` | 阻断(V3) | **禁**(全部禁 null)| 阻断(V3,空 id 无法路由)| — |
| `label` | 阻断(V3)| **禁** | 阻断(UI 无文字)| — |
| `diagram` | 阻断(V3)| **禁** | **显式"分组容器"**(合法)| — |
| `diagramType` | 缺省 "architecture" | **禁** | 阻断(V4 非法 enum)| — |
| `children` | 等价叶子 | **禁** | — | 等价叶子 |
| `notes` | 无旁注 | **禁** | 等价无旁注 | — |

**全部禁 null**(只允许 undefined 或有值):简化契约到二态,避免 null vs undefined 语义模糊。

### 3.3 写前先校验(03 §1.2 项 3)

V1-V5 全过才写 state;**严禁部分加载**(防 cc-status-dot Anchor B 同构失败类问题:producer 缺字段传播进内部 state 致后续消费者读到错位数据)。

### 3.4 跨节点引用不支持(v1 严格树形)

`children` 只接受内联定义,不接受 `$ref`。理由 01 §3.2 Metz "错误抽象比重复贵":引用机制带来环检测/解析/部分更新三套复杂度,无真实用例前是参数蔓延起点。

**何时 reconsider**:≥3 真实场景 + 子树 > 5 节点。

---

## 4. 3 层电商示例(schema 直观验证)

场景:电商平台架构,顶层 5 大模块 → 业务服务展开微服务列表 → 订单服务展开内部组件 → 创建订单展开时序图。覆盖 8 项 schema 特性。

```typescript
const ecommerceManifest: Manifest = {
  id: "root",
  label: "电商平台架构 v3",
  diagram: `
    api_gateway: API 网关
    auth_service: 认证服务
    business_services: 业务服务群
    data_layer: 数据层
    observability: 可观测性

    api_gateway -> auth_service
    api_gateway -> business_services
    business_services -> data_layer
    api_gateway -> observability
  `,
  diagramType: "architecture",
  notes: "顶层按 C4 Container 风格分 5 大模块,业务服务群是聚合层(无图)。",
  children: [
    {
      id: "business-services",
      label: "业务服务群",
      diagram: "",                  // 显式空串 = 仅分组容器
      diagramType: "architecture",  // container-list viewMode 下此字段仅 producer 提示
      notes: "聚合层,本身不画图。drill 进来看到 children 微服务列表卡片。",
      children: [
        {
          id: "order-service",
          label: "订单服务",
          diagram: `
            create_order: 创建订单
            pay_order: 支付订单
            cancel_order: 取消订单
            query_order: 查询订单

            create_order -> pay_order
            pay_order -> query_order
            cancel_order -> query_order
          `,
          diagramType: "architecture",
          notes: "订单服务 4 个核心子流程。",
          children: [
            {
              id: "create-order-sequence",
              label: "创建订单时序",
              diagram: `
                client: 客户端
                gateway: API 网关
                order_svc: 订单服务
                inventory_svc: 库存服务
                coupon_svc: 优惠券服务
                db: 订单库

                client -> gateway: POST /orders
                gateway -> order_svc: createOrder()
                order_svc -> inventory_svc: lockStock()
                order_svc -> coupon_svc: validateCoupon()
                order_svc -> db: INSERT orders
                db -> order_svc: order_id
                order_svc -> gateway: 201 Created
                gateway -> client: 201 Created
              `,
              diagramType: "sequence",
              notes: "创建订单的跨服务时序,含库存锁 + 优惠券校验 + 持久化。",
              // children 缺省 = 叶子(drill 到此为止)
            },
            {
              id: "pay-order-sequence",
              label: "支付订单时序",
              diagram: `
                client -> gateway: POST /orders/{id}/pay
                gateway -> order_svc: payOrder()
                order_svc -> pay_svc: charge()
                pay_svc -> order_svc: paid
                order_svc -> db: UPDATE status
              `,
              diagramType: "sequence",
            },
            // cancel_order / query_order 子图略
          ],
        },
        {
          id: "inventory-service",
          label: "库存服务",
          diagram: `
            stock: 库存表
            lock: 锁定记录
            replenish: 补货任务
          `,
          diagramType: "architecture",
          // 叶子
        },
        {
          id: "coupon-service",
          label: "优惠券服务",
          diagram: `
            coupon: 优惠券
            rule: 规则引擎
          `,
          diagramType: "architecture",
        },
      ],
    },
    {
      id: "data-layer",
      label: "数据层",
      diagram: `
        mysql: MySQL 主从
        redis: Redis 集群
        es: Elasticsearch
      `,
      diagramType: "architecture",
      notes: "数据层 3 大存储。",
    },
    // auth_service / observability 子图略
  ],
};
```

### 4.1 此示例覆盖的 schema 特性

| 特性 | 体现位置 |
|---|---|
| 3 必填字段 | 每节点都有 id/label/diagram |
| 空串合法 | `business-services.diagram = ""`(分组容器) |
| diagramType 切换 | root=architecture / create-order-sequence=sequence |
| children 缺省=叶子 | `create-order-sequence`、`inventory-service` 等无 children |
| notes 选填 | 部分节点有 notes,部分没有 |
| id 唯一性 | 全树无重复 id(V1) |
| 无环 | 树形结构,无回边(V2) |
| 4 层递归 | root → business-services → order-service → create-order-sequence |

### 4.2 用户交互流程

1. 打开 HTML,看到"电商平台架构 v3"顶层架构图(api_gateway → business_services → data_layer)
2. 点击"业务服务"节点 → 切到 container-list 视图,看到 4 张微服务卡片(order/inventory/coupon/...)
3. 点击"订单服务"卡片 → 切到订单服务架构图(4 个子流程框)
4. 点击"创建订单"框 → 切到 sequence 时序图(完整跨服务时序)
5. 面包屑显示 `电商平台架构 v3 / 业务服务群 / 订单服务 / 创建订单时序`,可点任一级回跳
6. URL hash 变为 `#path=root/business-services/order-service/create-order-sequence`,可分享深链

整个交互只需 manifest + viewer,**不需要任何额外字段**(无 layout / 无 clickHandler / 无 transition / 无 collapsed)。

---

## 5. YAGNI 拒绝清单(10 项,01 §3 + 03 §1.6.3)

每项写明拒绝理由 + 何时 reconsider,防未来无脑加字段。

| # | 字段 | 拒绝理由 | 何时 reconsider |
|---|---|---|---|
| Y1 | `version: string`(schema 版本号)| 无迁移故事;TS interface + JSON Schema 是更可靠的契约证据(03 §0.3 L0' 警告)| 真有破坏性 schema 变更 + 需向后兼容旧 manifest 时 |
| Y2 | `permissions: string[]`(读写权限)| 无多用户场景;media-gen-mcp 是单文件产物生成非协作平台 | 多用户协作编辑 manifest 时(可能永不) |
| Y3 | `layout: { x, y, w, h }`(节点布局坐标)| 违反 doc_v12 §2 不自研编辑器立场;D2 auto-layout 已是最优解 | 用户明确要"固定布局不受 auto-layout 影响"且接受额外字段复杂度(对齐 01 §4.5 satisficing) |
| Y4 | `$ref: string`(跨节点引用)| v1 严格树形,无真实复用需求;引用机制带来环检测/解析/部分更新三套复杂度 | ≥3 真实场景 + 子树 > 5 节点 |
| Y5 | `style: { fill, stroke, ... }`(节点样式)| D2 DSL 自身已表达样式(`box: { style.fill: red }`);manifest 携样式 = 浅模块 + 信息泄漏(01 §2.4)| D2 DSL 表达不了的视觉需求(极少) |
| Y6 | `tags: string[]`(节点标签)| 无检索场景;viewer 不做搜索/过滤 | 真有"按 tag 过滤节点"用例且性能可接受时 |
| Y7 | `createdAt / author: string`(创建元数据)| git 已有;manifest 是产物契约不是过程记录 | git 元数据不够用时(可能永不) |
| Y8 | `i18n: { zh, en, ... }`(多语言)| 多份 .json 解决,不需要单 manifest 多语言嵌套 | 真有多语言运行时切换需求(罕见) |
| Y9 | `collapsed: boolean`(初始折叠状态)| viewer 运行时状态,非数据模型;drill 本身就是显式展开(construct vs artifact,03 §0.1)| 真有"初始展开某些层"强需求且 localStorage 不够用时 |
| Y10 | `thumbnail: string`(节点缩略图)| viewer 即时渲染已有"缩略图"效果;预生成缩略图是缓存层 concerns | 大 manifest(>50 节点)首屏慢且懒载不可行时 |

**YAGNI 拒绝四问**(可作 review 工具,适用任何"加字段"提议):

1. **真实用例**:有 ≥1 个具体场景非此字段不可吗?(口味 ≠ 用例)
2. **现有字段表达不了**:diagram DSL 或全局 option 真的表达不了吗?
3. **Metz 测试**:加此字段会让接口更复杂吗?(公共字段数 >7 是浅模块信号)
4. **概念完整性**:此字段与既有 6 字段是同一抽象层吗?

四问任一答 "否" 即拒。

---

## 6. Producer 工作流(AI 主路径 + 人手写兜底)

### 6.1 双轨判断

- **AI 主路径(~80%)**:LLM 训练数据里见过海量分层模式,生成 manifest 是自然任务
- **人手写兜底(~20%)**:小树 / 权威判断 / AI 生成不稳定时的 fallback

### 6.2 AI 工作流三阶段(对齐 01 §4.3 航船修正)

```
[阶段 1: OUTLINE]
  → Claude 只列骨架(id + label + diagramType),diagram 留空 ""
  → 用户 sign-off 分层结构
  → 防用户看到完整图才发现分层错

[阶段 2: FILL]
  → top-down 逐层填 D2 DSL
  → 每层填完跑 V1-V5 校验
  → 失败即提示 producer 修正,不部分落盘

[阶段 3: VALIDATE + EMIT]
  → V1-V5 全过 + id 字符集 + 字段缺失四态归一
  → EMIT 单文件 HTML
```

**关键纪律**:大纲与填充分离。先定目标(分层结构)再实施(填 DSL),对应 01 §4.3 "航船修正"哲学。

---

## 7. 设计审查对齐(§8 自查表)

| 01/03 条款 | 对齐点 |
|---|---|
| 01 §2.1(航母分层 = children 递归)| manifest 树根 = 顶层抽象,children = 每舱细分 |
| 01 §2.3(不交织 = 字段单一职责)| 每字段单一职责(id 路由 / label 显示 / diagram 内容 / children 结构...)|
| 01 §2.4(深模块 = 接口小实现厚)| ManifestNode 6 字段接口小;D2 渲染全部复杂度藏在 viewer 实现厚处 |
| 01 §2.5 刻度四(闭环 enum)| DiagramType 5 值闭环,新加须 PR |
| 01 §3 抽象纪律 | 6 字段全过 review 三问,无装饰字段 |
| 01 §3.2(Metz: duplication > wrong abstraction)| 不引入 $ref(避免错误抽象);recursion 用现有叶子契约 |
| 01 §4.3(目标先定再实施)| AI 工作流 OUTLINE → FILL → VALIDATE 三阶段 |
| 03 §0.1 项 2(construct vs artifact)| previewPng/outDir/name/collapsed/thumbnail 严不进数据模型 |
| 03 §1.2 项 1(producer 契约 L1 证据)| TS interface 是契约草案;实施时配 JSON Schema(.json)供 CI 校验 |
| 03 §1.2 项 2(字段缺失四态)| §2.2 逐字段四态语义表 |
| 03 §1.2 项 3(写前先校验)| V1-V5 全过才写,严禁部分加载 |
| 03 §1.2 项 7(信任边界)| 🔴 label/title viewer 侧强制 escapeHtml(producer 不可信) |
| 03 §1.6.3(过工程化拒绝)| Y1-Y10 YAGNI 清单 + 四问 |
| doc_v12 §2(不自研编辑器)| 拒绝 layout/collapsed/style 等编辑器字段 |
