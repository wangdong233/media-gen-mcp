# pares4 —— Graphviz/Mermaid 引擎补齐(功能分析)

> 迭代目标:补齐 generate_diagram 的 engine 枚举(d2 之外),让结构图支持更多 DSL。
> 来源:0.2.0 generate_diagram 的 engine enum 含 `d2/mermaid/graphviz`,仅 d2 实现。
> 父文档:[../排期与里程碑_v3](../排期与里程碑_v3.md)

---

## 1. 结论(基于证据)

| 引擎 | 结论 | 依据 |
|---|---|---|
| **graphviz** | ✅ **实现**(@viz-js/viz WASM) | 进程内、无浏览器、可靠、实测通过 |
| **mermaid** | ❌ **不实现**(进程内不可行) | 三方调查一致:需浏览器/污染全局;实测 mermaid-isomorphic@3 强依赖 playwright |

遵循"任何模糊点调查到确定为止":graphviz 与 mermaid 均经(研究 agent + v2 历史 + 实测安装)三方印证。

---

## 2. Graphviz(实现)

### 2.1 选型
`@viz-js/viz@3.28.0` —— Graphviz 编译为 WASM,Node 进程内,无 spawn/无 Chromium。
- API:`instance()`(async,WASM 单例)→ `viz.render(dot, { format: "svg" })` → `{ output: svgString }`。
- 实测:`digraph { A->B[label]; B->C; C->A }` 渲染正确(A→B 标注,循环,清晰椭圆+箭头);cluster 子图亦通过。

### 2.2 实现(`src/diagram/graphviz.ts`)
- `GraphvizEngine implements DiagramEngine`,与 `D2Engine` 同型:lazy singleton(`instance()` 一次性加载)+ try/catch 清晰错误 + PNG 经 resvg(fitTo width 1000 归一化,矢量源故清晰)。
- `result.output` 类型 `string|undefined` → `?? ""` + 非空校验。
- 注册到 `render.ts`:`getDiagramEngine("graphviz")` 返回该引擎;`listDiagramEngines()` 含 d2+graphviz。

---

## 3. Mermaid(不实现 —— 证据)

### 3.1 三方调查一致
1. **研究 agent**(WebSearch+WebFetch,22 次工具调用):官方 mermaid 需 DOM(`render` 内部 createElement→appendChild→渲染→移除);维护者 Sidharth Vinod 在 issue #3650 称服务端支持"还要很久";无纯 WASM mermaid;`mermaid-isomorphic`(jsdom)是唯一"可信"包装,但污染全局、版本敏感、`foreignObject` 标签保真度问题、官方视 jsdom 为二等环境。
2. **v2 历史**:isomorphic-mermaid 模块损坏、mermaid-isomorphic 需 Chromium。
3. **实测**:安装 `mermaid-isomorphic@3.1.0`,import 即报 `Cannot find package 'playwright'` —— 即"	isomorphic"路径 v3 也强依赖 playwright/Chromium。**确认:进程内 mermaid 无浏览器不可行。**

### 3.2 为何不污染全局(jsdom 手动注入方案也拒)
- mermaid 从 `globalThis` 读 `document`/`window`/`navigator`;jsdom 注入会**污染整个 Node 进程**。
- 本 MCP 长驻进程同时承载 D2 WASM、Vega、Satori、图标/字体/emoji 缓存 —— 全局 DOM 污染对这些有潜在干扰风险,违背确定性、隔离性。
- 结论:宁可诚实标注"不支持 + 给替代方案",也不引入污染全局的脆弱路径。

### 3.3 处理(用户体验)
- engine 枚举**保留 mermaid**(可发现性:Claude/用户传 mermaid 时得到明确反馈)。
- `getDiagramEngine("mermaid")` → undefined;`index.ts` handler 给清晰错误(`MERMAID_UNSUPPORTED_MSG`):说明进程内不可用 + 推荐用 **d2**(覆盖 flowchart/sequence/class/er/mindmap)或 **graphviz**(DOT)。
- 实测:传 mermaid → `isError:true` + 该消息;不静默、不造假。

---

## 4. 执行路径总结

| 改动 | 文件 |
|---|---|
| GraphvizEngine | `src/diagram/graphviz.ts`(新) |
| 注册 d2+graphviz;mermaid 不可用消息 | `src/diagram/render.ts` |
| handler:graphviz 路由 + mermaid 清晰错误 + d2 回归 | `src/index.ts` |
| schema:description/enum 注明 graphviz 可用、mermaid 不支持 | `src/index.ts` |
| 依赖:`@viz-js/viz`(+ 已卸载 mermaid-isomorphic,87 包) | `package.json` |

---

## 5. 验收标准

- [x] graphviz SVG/PNG 正确渲染(视觉验证)。
- [x] d2 不回归(仍是默认,实测通过)。
- [x] mermaid → 清晰错误 + 替代推荐(实测 isError)。
- [x] 非法 DOT → 清晰错误(实测)。
- [x] 无全局污染(未引入 jsdom/Chromium)。
- [x] 单元/集成/冒烟 + 四维度审查零问题;文档更新。

---

## 6. 边界 / 后续

- **graphviz 主题/引擎选项**:当前用默认 dot 引擎;后续可暴露 `engine`(dot/neato/fdp/...)与 `graphAttributes`。
- **mermaid 若未来有纯 WASM/portable 实现**(如 mmdr 出 Node bindings 且 parity 可接受),可再评估接入。
- **D2 vs Graphviz 选择**:D2 更现代、主题丰富、覆盖 mermaid 多数场景(默认);Graphviz 补 DOT 生态(学术/遗留图、`neato`/`fdp` 无向布局)。
