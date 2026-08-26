# drill-down 导航交互设计(视图栈 + 面包屑 + 深链 + 无障碍 + 性能策略)

> **角色**:导航/面包屑 UX + 自包含 HTML 实现调查者
> **生成日期**:2026-07-28
> **目标产物**:`generate_interactive_diagram` 的 P0-5B 增强线 —— 多层级 drill-down 导航的交互设计 + vanilla JS 伪代码 + 性能策略推荐。
> **上游路线**:`inv:oss-nested-drill` 已锁定"**替换视图**(view stack,整层 SVG 淡出/淡入)"路线,本文件把它落到交互细节、伪代码、性能权衡。
> **立场红线(继承 P0-5A 五条)**:① 单文件自包含 HTML(零外链 `<script src=`、零 node_modules、离线可看);② 纯免费;③ 同输入同输出可入 git;④ 向后兼容不破坏(inputSchema 零 diff,单层 DSL 用例 byte-identical);⑤ 守 S6 ≤256KB。

---

## 0. 任务定位与不做的事

### 0.1 在交互谱系中的位置(doc_v12 §2.1 T1–T6)

| 档 | 当前 MVP | 本设计目标 |
|---|---|---|
| T3 viewer(pan/zoom/theme/motion/export) | ✅ 已交付(`viewer-min.ts` 150 行) | — |
| T4 light-interact(hover/click 高亮/详情侧栏/键盘) | — | 部分由本设计带动(节点级 click 用作 drill 触发器) |
| **T4+:层级 drill-down(视图栈 + 面包屑 + 深链)** | — | **✅ 本设计** |
| T5 mid-interact(拖节点 / 标签编辑) | — | 不做(doc_v12 §5.2 已延后) |
| T6 full-editor | — | 永不做(立场冲突) |

drill-down 是与 T4 light-interact **正交**的另一条增强线:T4 在"同一张图内"做节点信息探索;drill-down 在"图与图之间"做层级切换。两者可叠加(drill 进子层后,该层的节点仍可 hover 显 tooltip)。

### 0.2 不做的事(明确边界)

- **不做视觉拖拽 / 节点重定位 / 增删节点 / 重布局**(doc_v12 §3.1 已证:在 256KB cap 内不可行,D2 WASM 21MB 超 cap 80-125 倍)。要"改图"走 AI 自然语言微调线(收口决策 §2 第 3 条)。
- **不做 zoom-into 单图缩放式 drill**(inv:oss-nested-drill 已锁"替换视图"路线;zoom-into 需保留祖先层渲染上下文,与 D2 auto-layout 几何不可重算的硬约束冲突,且面包屑语义与 zoom 操作语义混淆)。
- **不做服务端渲染 / 按需 fetch 子层 SVG**(单文件 HTML 无 fetch 源,破"离线可看"立场)。
- **不引入路由框架**(react-router / @curi 等)——vanilla JS IIFE 守 S2。
- **不改 19/20 工具的 inputSchema**(用加性可选参数 + 条件展开,单层 DSL 走默认路径 → 产物 byte-identical)。

---

## 1. 导航范式决策(为什么是"替换视图")

### 1.1 替换视图(view stack)的定义

整层 SVG 作为一个不可分割单元:

```
点击有 children 的节点 X
  → 当前 SVG opacity: 1 → 0(150ms 淡出,Motion Governor 管)
  → stage.innerHTML = 子层 SVG 字符串
  → opacity: 0 → 1(150ms 淡入)
  → breadcrumb push(X)
  → URL hash 更新为 #path=root/X
```

回上一级 / 跳某级反向对称。

### 1.2 为什么不是 zoom-into(单图内相机平移+放大)

| 维度 | 替换视图 ✅ | zoom-into ❌ |
|---|---|---|
| D2 几何 | 子层是独立 auto-layout 产物,几何已稳定 | 需在父图坐标系内"放大到节点 X 的子图区域",但 D2 父图把 X 画成单个矩形框,**子图内部几何不存在** |
| 状态模型 | 一个数组栈 `stack=[root, X, Y]`,纯字符串 | 需维护 viewBox / transform 矩阵 + 父子图几何映射 |
| 面包屑语义 | "我在哪一层",清晰 | 与 zoom 操作语义混淆(zoom in ≠ drill in) |
| 实现成本 | ~80 行 vanilla JS | 需几何变换 + 边界裁剪 + 子图内节点交互分栈 |
| 与 D2 后端契合 | 后端可对每层独立渲染一份 SVG(自然并行) | 需 D2 输出"嵌套坐标系",D2 无此能力 |

**裁决:替换视图**。zoom-into 是 D2 几何模型不支持的方向,硬上等于自研一层 layout engine,与 P0-5 立场红线("不自研编辑器/layout",收口决策 §2 第 2 条)冲突。

### 1.3 后端数据形态(给实施者,不属本 UX 任务核心,但需对齐)

D2 原生支持 **nested composition**(`a.b.c` dot-notation,https://d2lang.com/tour/nested-composition/),DSL 形如:

```d2
order_service: 订单服务 {
  pay: 支付微服务 {
    gateway: 支付网关
    alipay: 支付宝通道
  }
  inventory: 库存微服务
}
auth_service: 认证服务
```

后端渲染策略(实施者决策,非本文件约束):

- **方案 A(推荐)**:一次 DSL,渲染 N 次,每次 scope 到某层级(用 D2 snippet 提取或 `vars` 注入 `__scope`)。N 份 SVG inline 进同一 HTML。确定性可控(同输入同输出)。
- **方案 B**:用户在 `layers` 参数里直接给 N 段独立 DSL。灵活但 LLM 负担更高。
- **方案 C**:D2 sketch mode / multi-board(D2 有 board 语法,但 WASM 支持度需实地核实)。

本设计文档与后端方案解耦:**只要后端能产出 `{layers: [{id, title, svg, parent, children}]}` 这个数据结构,前端 UX 即可落地**。这是有意的"接口窄、实现厚"(01_简单架构思想 §2.4 深模块)。

---

## 2. 数据契约(前端 ↔ 后端的最窄接口)

```ts
interface LayerSpec {
  id: string;            // 唯一,DSL dot-path 一段(如 "order_service" / "order_service.pay")
  title: string;         // 面包屑显示名("订单服务")
  svg: string;           // 该层 D2 渲染出的 SVG 字符串(noXMLTag:true)
  parent: string | null; // 父层 id(root 为 null)
  children: string[];    // 可 drill 的子层 id 列表(叶子节点为 [])
  // 可选:节点级元数据( hover tooltip 用,非本设计核心)
  nodes?: Array<{ id: string; label: string; detail?: string; drillsTo?: string }>;
}

interface InteractiveLayersPayload {
  root: string;            // 根层 id(通常 "root")
  layers: Record<string, LayerSpec>;
}
```

**注入方式**(守 S2 自包含):payload 序列化为 JSON,塞进 HTML 的 `<script type="application/json" id="mgm-layers-data">...</script>`。这是**数据**不是**代码**,GitHub sanitize 默认保留 `application/json` type 的 script(若未来要嵌 README 退路,JSON-only 不被当 JS 执行)。

**注**:`<script type="application/json">` 不违反 S2 断言(`asserts.ts` L25 只禁 `<script ... src=`,不禁 inline data script)。

---

## 3. 视图栈实现(vanilla JS 伪代码)

### 3.1 核心状态机

```js
(function(){
  // === 1. 加载层数据(从 inline JSON script) ===
  var dataEl = document.getElementById('mgm-layers-data');
  if (!dataEl) return;  // 单层用例(向后兼容,byte-identical 守门)
  var payload;
  try { payload = JSON.parse(dataEl.textContent); }
  catch(e) { return; }  // 数据损坏 → 不启用 drill,降级为单层 viewer

  var LAYERS = payload.layers;       // Record<id, LayerSpec>
  var ROOT   = payload.root;

  // === 2. 视图栈(stack[last] = 当前显示的层) ===
  var stack = [LAYERS[ROOT]];

  // === 3. DOM refs ===
  var stage     = document.getElementById('mgm-stage');
  var breadcrumb= document.getElementById('mgm-breadcrumb');
  var backBtn   = document.getElementById('mgm-btn-up');
  if (!stage) return;

  // === 4. render(top) —— 显当前层 SVG + 高亮面包屑 + 同步 hash ===
  var REDUCED = window.matchMedia &&
                window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var FADE_MS = REDUCED ? 0 : 150;

  function render() {
    var top = stack[stack.length - 1];

    // 4a. 切 SVG(淡出 → 替换 → 淡入)
    if (FADE_MS > 0) { stage.style.opacity = '0'; }
    var swap = function() {
      stage.innerHTML = top.svg;
      attachDrillHandlers(stage, top);
      restoreZoom();             // 切层后 zoom/pan 重置(否则上层的 transform 残留)
      if (FADE_MS > 0) { stage.style.opacity = '1'; }
    };
    if (FADE_MS > 0) { setTimeout(swap, FADE_MS); }
    else { swap(); }

    // 4b. 面包屑
    renderBreadcrumb();

    // 4c. URL hash(用 replaceState 不污染 history;back 走专属按钮/Esc)
    var path = stack.map(function(l){ return l.id; }).join('/');
    history.replaceState(null, '', '#path=' + encodeURIComponent(path));

    // 4d. back 按钮可用性
    if (backBtn) {
      backBtn.disabled = (stack.length <= 1);
      backBtn.setAttribute('aria-disabled', stack.length <= 1 ? 'true' : 'false');
    }
  }

  // === 5. drillInto(nodeId) —— push 子层 ===
  function drillInto(nodeId) {
    var layer = LAYERS[nodeId];
    if (!layer) return;
    if (layer.children.length === 0) return;  // 叶子,不 drill(T4 tooltip 由 §6 处理)
    // 防止重复 push 同一层(双击/Enter 重复触发)
    if (stack[stack.length - 1].id === nodeId) return;
    stack.push(layer);
    render();
  }

  // === 6. popTo(idx) —— 面包屑 click 跳某级 ===
  function popTo(idx) {
    if (idx < 0 || idx >= stack.length) return;
    if (idx === stack.length - 1) return;  // 已是当前级,no-op
    stack = stack.slice(0, idx + 1);
    render();
  }

  // === 7. goUp() —— Esc 上一级 ===
  function goUp() {
    if (stack.length > 1) { stack.pop(); render(); }
  }

  // === 8. 事件绑定(初始 + 切层后重绑) ===
  if (backBtn) backBtn.addEventListener('click', goUp);

  document.addEventListener('keydown', function(e){
    // Esc:上一级(优先于 viewer-min 的 Esc-reset-zoom;两者可区分:仅当栈深>1 才吃 Esc)
    if (e.key === 'Escape' && stack.length > 1) {
      e.preventDefault();
      goUp();
    }
  });

  // === 9. 初始:从 URL hash 恢复(深链) ===
  function restoreFromHash() {
    var m = (location.hash.match(/path=([^&]+)/) || [])[1];
    if (!m) { render(); return; }
    var ids = decodeURIComponent(m).split('/').filter(Boolean);
    var newStack = [LAYERS[ROOT]];
    var cur = LAYERS[ROOT];
    for (var i = 0; i < ids.length; i++) {
      if (!cur) break;
      // 校验:下一级必须是当前层的合法 child(防恶意/笔误 hash 越权跳)
      if (cur.children.indexOf(ids[i]) === -1) break;
      cur = LAYERS[ids[i]];
      if (!cur) break;
      newStack.push(cur);
    }
    stack = newStack;
    render();
  }

  window.addEventListener('hashchange', restoreFromHash);
  restoreFromHash();
})();
```

### 3.2 关键不变量

| # | 不变量 | 实现位置 |
|---|---|---|
| INV-1 | `stack[0].id === ROOT` 永远成立 | `restoreFromHash` 初始化 + `popTo` 不允许 idx<0 |
| INV-2 | `stack[i+1]` 必在 `stack[i].children` 中 | `drillInto` 校验 + `restoreFromHash` 校验 |
| INV-3 | URL hash 与 stack 一一对应 | `render()` 是唯一写 hash 的入口,`restoreFromHash` 是唯一从 hash 建 stack 的入口 |
| INV-4 | 叶子节点(`children.length===0`)永不进 stack | `drillInto` 早 return |
| INV-5 | `data-motion="still"` 或 `prefers-reduced-motion` 时,FADE_MS=0 | Motion Governor 覆盖 |

INV-2 是**安全边界**:外部链接构造 `#path=root/任意 id` 想直接跳到深层,必须沿合法父子链才能到达。这防了"hash 注入跳到不存在/越权层"。

---

## 4. 可点击信号(怎么让用户知道"这个能 drill")

### 4.1 证据 base

- **NN/g *Accordion Icons: Which Signifiers Work Best?*** (https://www.nngroup.com/articles/accordion-icons/) 实测:**caret/chevron 是最强的"in-place 展开"signifier**,显著优于 plus、arrow-right 等。用户看到 chevron 即预期"原地展开/进入",而非"跳转到另一页"。
- **Parallel HQ *What Are Affordances in Design*** (https://www.parallelhq.com/blog/what-are-affordances-in-design):"If a card is clickable, give it a shadow or a chevron icon." —— 多 signifier 组合最大化可发现性。

### 4.2 三层信号组合(节点角标 + 视觉态 + tooltip)

对每个 `children.length > 0` 的节点(DSL 里是 nested container),应用:

```css
/* 1. 视觉态 —— 可 drill 节点的 hover / focus 强化 */
.mgm-drillable {
  cursor: pointer;
  transition: filter 0.15s ease-out;
}
.mgm-drillable:hover {
  filter: drop-shadow(0 0 6px var(--mgm-accent));
}
.mgm-drillable:focus-visible {
  outline: 2px solid var(--mgm-accent);
  outline-offset: 2px;
}

/* 2. 角标 —— 右下角 chevron-down(D2 SVG 节点 <g class="shape"> 内 append <text>) */
.mgm-drillable > .mgm-drill-badge {
  /* SVG 内的 <text> 元素,D2 渲染时不带;由 attachDrillHandlers 注入 */
  fill: var(--mgm-accent);
  font-size: 11px;
  pointer-events: none;   /* 不抢点击 */
}

/* 3. Motion Governor 覆盖 */
@media (prefers-reduced-motion: reduce) {
  .mgm-drillable { transition: none !important; }
}
html[data-motion="still"] .mgm-drillable { transition: none !important; }
```

```js
// === attachDrillHandlers(stage, layer) —— 给当前层 SVG 里"可 drill"的节点挂信号 + 事件 ===
function attachDrillHandlers(stage, layer) {
  layer.children.forEach(function(childId){
    var childLayer = LAYERS[childId];
    if (!childLayer) return;

    // 定位节点 DOM:D2 把 container 节点画成 <g class="shape" id="...">,id 通常是 DSL path 转义
    // 这里用 data-id 兜底(D2 渲染时可注入 data-node-id,见 §7 整合点)
    var nodeEl = stage.querySelector('[data-node-id="' + cssEscape(childId) + '"]') ||
                 stage.querySelector('#' + cssEscape(childId));
    if (!nodeEl) return;

    // 1. 视觉类
    nodeEl.classList.add('mgm-drillable');

    // 2. chevron 角标(SVG <text> 元素,绝对定位到节点右下)
    var badge = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    badge.setAttribute('class', 'mgm-drill-badge');
    badge.textContent = '▾';  // 或用 SVG path 画 chevron,更可控
    // 定位由节点 bbox 决定(getBBox 在 SVG 渲染后可用)
    try {
      var bbox = nodeEl.getBBox();
      badge.setAttribute('x', bbox.x + bbox.width - 8);
      badge.setAttribute('y', bbox.y + bbox.height - 4);
    } catch(e) { /* getBBox 跨浏览器有 caveat,Tier 2 优化 */ }
    nodeEl.appendChild(badge);

    // 3. <title> tooltip(原生 hover 提示,零 JS)
    var titleEl = nodeEl.querySelector('title');
    if (!titleEl) {
      titleEl = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      nodeEl.appendChild(titleEl);
    }
    titleEl.textContent = '点击 / 回车 进入「' + childLayer.title + '」子层';

    // 4. a11y 角色
    nodeEl.setAttribute('role', 'button');
    nodeEl.setAttribute('tabindex', '0');
    nodeEl.setAttribute('aria-expanded', 'false');
    nodeEl.setAttribute('aria-label',
      '进入 ' + childLayer.title + ' 子层(共 ' + childLayer.children.length + ' 个下级)');

    // 5. 事件
    nodeEl.addEventListener('click', function(e){
      e.stopPropagation();  // 防 viewer pan 同时触发
      drillInto(childId);
    });
    nodeEl.addEventListener('keydown', function(e){
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        drillInto(childId);
      }
    });
  });
}

function cssEscape(s) {
  return String(s).replace(/[^a-zA-Z0-9_-]/g, function(c){
    return '\\' + c;
  });
}
```

### 4.3 叶子节点的处理(不触发 drill)

`children.length === 0` 的节点**不加** `mgm-drillable` 类、不加 chevron、不加 `role=button`、不加 `tabindex`。它们的 hover 行为走 T4 light-interact 线(本设计不正交实现,留接口):

```js
// 占位:T4 light-interact 线处理叶子 hover 详情(不在本设计交付)
// layer.nodes.forEach(n => attachTooltip(n));
```

**为什么严格区分**:NN/g 证据表明,给叶子节点也加 chevron 会让用户误以为"还能再 drill",点击无效 → 信任崩塌。**信号必须诚实**(01 §3.4 简单与其他质量增强关系:可靠性地基)。

### 4.4 当前位置 breadcrumb 标记(父层 SVG 里高亮"我是从哪下来的")

进入子层后,父层 SVG 在 `stack` 里仍在,只是不显示。**不做什么**:不在父层 SVG 里画"当前在子层 X"的视觉标记(会改 D2 几何,破 INV "viewer 绝不重渲染 SVG")。当前位置完全由**面包屑**(§5)+ URL hash(§6)承担。

---

## 5. 面包屑(顶部 trail)

### 5.1 证据 base

- **NN/g *Breadcrumbs: 11 Design Guidelines*** (https://www.nngroup.com/articles/breadcrumbs/):breadcrumbs 是 **supplement 而非 primary navigation**;层级 ≥3 时才有价值。
- **Smashing Magazine *Designing Effective Breadcrumbs*** (https://www.smashingmagazine.com/2022/04/breadcrumbs-ux-design/):移动端单行,中间折叠省略号是公认模式。
- **IXDF *Mobile Breadcrumbs: 8 Best Practices*** (https://ixdf.org/literature/article/mobile-breadcrumbs):单行 trail,避免溢出。

### 5.2 HTML 结构(模板新增,条件展开)

```html
<!-- 仅多层用例注入;单层用例不渲染此节点(byte-identical 守门) -->
<nav id="mgm-breadcrumb" class="mgm-breadcrumb" aria-label="层级导航"></nav>
```

### 5.3 CSS

```css
.mgm-breadcrumb {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.35rem 0.75rem;
  background: var(--mgm-toolbar-bg);
  border-bottom: 1px solid var(--mgm-toolbar-border);
  flex-shrink: 0;
  overflow: hidden;
  white-space: nowrap;
  font-size: 0.85rem;
}
.mgm-crumb {
  background: transparent;
  border: none;
  color: var(--mgm-fg);
  padding: 0.15rem 0.4rem;
  border-radius: 4px;
  cursor: pointer;
  font: inherit;
  font-size: 0.85rem;
  max-width: 12rem;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mgm-crumb:hover { background: var(--mgm-btn-hover-bg); }
.mgm-crumb:focus-visible { outline: 2px solid var(--mgm-accent); outline-offset: 1px; }
.mgm-crumb[aria-current="page"] {
  color: var(--mgm-accent);
  font-weight: 600;
  cursor: default;
  pointer-events: none;  /* 当前级不可点(已在最高栈位) */
}
.mgm-sep {
  color: var(--mgm-fg-muted);
  user-select: none;
}
.mgm-crumb-ellipsis {
  background: transparent;
  border: none;
  color: var(--mgm-fg-muted);
  cursor: pointer;
  padding: 0.15rem 0.3rem;
  border-radius: 4px;
}
.mgm-crumb-ellipsis:hover { background: var(--mgm-btn-hover-bg); }

@media (max-width: 640px) {
  .mgm-crumb { max-width: 6rem; }  /* 移动端更窄,守"单行" */
}
```

### 5.4 渲染逻辑(含中间折叠)

```js
var COLLAPSE_THRESHOLD = 5;  // stack.length > 5 时折叠中间

function renderBreadcrumb() {
  if (!breadcrumb) return;
  if (stack.length === 1) {
    // 只剩根:面包屑可隐藏(节省垂直空间),或弱化显示
    breadcrumb.style.display = 'none';
    return;
  }
  breadcrumb.style.display = '';

  var html = [];
  var showEllipsis = stack.length > COLLAPSE_THRESHOLD;

  var indicesToShow;
  if (showEllipsis) {
    // 头 2 + 尾 2,中间折叠(head 必含 root,tail 必含 current)
    indicesToShow = [0, 1].concat(
      range(stack.length - 2, stack.length)  // [n-2, n-1]
    );
  } else {
    indicesToShow = range(0, stack.length);
  }

  for (var i = 0; i < indicesToShow.length; i++) {
    var idx = indicesToShow[i];
    // 折叠断点插入省略号
    if (showEllipsis && i === 2) {
      var hidden = stack.length - 4;
      html.push('<button class="mgm-crumb-ellipsis" type="button" ' +
                'data-action="expand-breadcrumb" ' +
                'aria-label="展开 ' + hidden + ' 个中间层级">…</button>');
      html.push('<span class="mgm-sep" aria-hidden="true">›</span>');
    }
    var layer = stack[idx];
    var isCurrent = (idx === stack.length - 1);
    html.push('<button class="mgm-crumb" type="button" data-idx="' + idx + '" ' +
              'aria-current="' + (isCurrent ? 'page' : 'false') + '" ' +
              'aria-label="' + (isCurrent ? '当前层级:' : '返回到 ') + escapeAttr(layer.title) + '">' +
              escapeHtml(layer.title) + '</button>');
    if (i < indicesToShow.length - 1) {
      html.push('<span class="mgm-sep" aria-hidden="true">›</span>');
    }
  }

  breadcrumb.innerHTML = html.join('');

  // 绑事件(事件委托更省内存,这里为可读性直接 query)
  breadcrumb.querySelectorAll('.mgm-crumb[data-idx]').forEach(function(btn){
    btn.addEventListener('click', function(){
      popTo(parseInt(btn.getAttribute('data-idx'), 10));
    });
  });
  var ellipsisBtn = breadcrumb.querySelector('[data-action="expand-breadcrumb"]');
  if (ellipsisBtn) {
    ellipsisBtn.addEventListener('click', function(){
      COLLAPSE_THRESHOLD = Infinity;  // 临时关闭折叠
      renderBreadcrumb();
    });
  }
}

function range(start, end) {
  var r = [];
  for (var i = start; i < end; i++) r.push(i);
  return r;
}
function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }
```

### 5.5 关键决策点

| 决策 | 选择 | 理由 |
|---|---|---|
| 折叠阈值 | `stack.length > 5` | NN/g + IXDF 共识:移动端单行容下 ~5 粒 crumb;超过即折叠 |
| 折叠策略 | 头 2 + 尾 2 + … | root 永远可见(锚定起点);当前级永远可见(锚定当前位置);中间 … 一键展开 |
| 当前级 | `aria-current="page"` + 不可点 | WAI-ARIA 标准;不可点防混淆 |
| 分隔符 | `›`(single right-pointing angle) | 业界惯例(Breadcrumb Pattern | APG) |
| 单层时 | 面包屑 `display:none` | 节省垂直空间;避免 root 单独显示的冗余 |

---

## 6. 深链 / 分享(URL hash)

### 6.1 证据 base

- **MDN *URL.hash*** (https://developer.mozilla.org/en-US/docs/Web/API/URL/hash):hash 完全客户端,不进 server。
- **Stack Overflow #3664257** (https://stackoverflow.com/questions/3664257/):hash fragment 永不到 server。
- **Zulip hashchange 系统** (https://zulip.readthedocs.io/en/latest/subsystems/hashchange-system.html):真实生产级 deep-link + 浏览器 back/forward 案例。
- **HTTP Watch *6 Things About Fragment URLs*** (https://blog.httpwatch.com/2011/03/01/6-things-you-should-know-about-fragment-urls/):fragment 由浏览器处理,适合离线单文件。

### 6.2 URL 协议

```
https://example.com/diagram.html#path=root/order_service/pay
                                          └──────┬──────┘
                                       stack 各层 id 用 / 分隔
```

- **格式**:`#path=` + `encodeURIComponent(ids.join('/'))`
- **编码**:`encodeURIComponent` 处理 DSL id 里的特殊字符(如 `auth.service` 的 `.` 虽合法也编一下,防解析歧义)
- **校验**:`restoreFromHash` 沿 `LAYERS[id].children` 链验证每一段,任一段断裂即放弃(不抛错,降级到 root)—— 这是 INV-2 安全边界

### 6.3 离线 / 单文件场景

| 场景 | hash 是否工作 | 说明 |
|---|---|---|
| `file://` 双击打开 HTML | ✅ | hash 纯客户端,无 server 参与 |
| 邮件/IM 分享 URL 带 `#path=...` | ✅ | 对方打开同 HTML 即恢复视图 |
| 复制 HTML 文件给别人 | ✅ | hash 随 URL 一起被复制(用户需复制 URL 非文件) |
| 嵌 GitHub README | ❌(但本就在 README 不工作) | README 剥 `<script>`,drill JS 全失效;退路是 `<img src=*.svg>` 单层静态图(doc_v12 §3.2) |

### 6.4 与浏览器 history 的关系

**决策**:用 `history.replaceState` 而非 `pushState`。

- `replaceState`:hash 反映当前栈,但**不污染 history**(按浏览器 back 不会在视图栈里翻 —— 那是 Esc / 面包屑 / back 按钮的职责)。
- `pushState`:每次 drill 都 push,浏览器 back 会反向逐层 pop。**反直觉**:用户预期浏览器 back 是"离开这个 HTML 回上一页",不是"在 HTML 内回上一层"。混用两种语义的 back 易混乱(Smashing Magazine 警告过这种陷阱)。

**配套**:`hashchange` 事件监听器在用户**手动改 hash**(粘贴分享链接、手输 URL)时触发 `restoreFromHash`,这是单向入口。

---

## 7. 键盘导航 + 无障碍

### 7.1 键盘映射

| 键 | 行为 | 优先级 |
|---|---|---|
| `Tab` / `Shift+Tab` | 在可 drill 节点 + 面包屑 + toolbar 按钮间移动(roving tabindex) | 高 |
| `Enter` / `Space`(焦点在可 drill 节点) | drill 进该节点子层 | 高 |
| `Escape`(栈深 > 1) | 上一级 | 高 |
| `Escape`(栈深 = 1) | 由 viewer-min 接管(zoom reset) | 已实现 |
| `←`(焦点在面包屑) | 焦点移到上一级 crumb | 中 |
| `?` | 显快捷键帮助(可选,Tier 2) | 低 |

### 7.2 Roving tabindex

可 drill 节点初始 `tabindex="0"`(当前焦点候选),其余 `tabindex="-1"`(可编程 focus,但不进 Tab 序列)。焦点移动时翻 `tabindex` 值。这样 Tab 在大图里不会卡在几百个节点上逐个走。

**简化版**(本设计推荐):所有可 drill 节点都 `tabindex="0"`,允许 Tab 逐个走。N 通常很小(一图里可 drill 节点 3-8 个),不构成可用性问题。完整 roving 留 Tier 2。

### 7.3 ARIA 角色

| 元素 | 角色 | 属性 |
|---|---|---|
| `<nav id="mgm-breadcrumb">` | `navigation`(隐式) | `aria-label="层级导航"` |
| `.mgm-crumb`(当前级) | — | `aria-current="page"` |
| `.mgm-crumb`(祖先级) | `link`(隐式 button) | `aria-label="返回到 X"` |
| `.mgm-drillable` 节点 | `role="button"` | `aria-expanded="false"`(始终 false,因 drill 是 push 而非 in-place expand;真正展开会切到新视图所以 expanded 语义不准确 —— 见 §11 open question #3) |
| `#mgm-stage` | — | `role="region"`、`aria-label="当前层级:X 的图"`(切层时更新) |

### 7.4 Motion Governor 扩展

现有 `motion-governor.ts` 只管 CSS animation/transition。本设计的"视图切换淡入淡出"也要被管:

```css
/* 加入 motion-governor.ts 的 MOTION_GOVERNOR_CSS */
@media (prefers-reduced-motion: reduce) {
  #mgm-stage { transition: none !important; opacity: 1 !important; }
}
html[data-motion="still"] #mgm-stage {
  transition: none !important;
  opacity: 1 !important;
}
```

JS 侧 `FADE_MS = REDUCED ? 0 : 150` 与 CSS 同步(双保险,防 CSS 未生效时 JS 仍延迟)。

---

## 8. 性能策略(全预嵌 vs 懒加载)

### 8.1 体积证据(doc_v12 §3.1 已核实)

- D2 WASM 单文件 = **21.0 MB**(`d2.wasm`)
- D2 browser bundle = **7.8 MB**
- `elk.js` layout engine = **3.5 MB**
- 全部超 S6 cap(256KB)80-125 倍

**结论先行**:在单文件自包含立场下,**懒加载路径物理不可行**(下表 §8.3 详述)。**唯一可行路线 = 全预嵌**。

### 8.2 全预嵌(推荐)

**策略**:后端一次性把 N 层全部渲染为 N 份 SVG,inline 进 HTML(`<script type="application/json" id="mgm-layers-data">` 内,或直接 `<template id="mgm-layer-<id>">`)。前端切层 = 字符串替换。

**体积估算**:

| 单层 SVG 大小 | N=3 层 | N=5 层 | N=8 层 | N=12 层 |
|---|---|---|---|---|
| 5KB(小图) | 15KB | 25KB | 40KB | 60KB |
| 15KB(中图) | 45KB | 75KB | 120KB | 180KB |
| 30KB(大图) | 90KB | 150KB | 240KB | 360KB ❌ |
| 50KB(巨图) | 150KB | 250KB ❌ | 400KB ❌ | — |

- S6 cap = 256KB。N=8 × 30KB = 240KB 贴 cap;N=12 × 30KB 超 cap。
- **守门**:`asserts.ts` 加 `assertLayersSizeUnder(html, maxPerLayer, maxTotal)`,超即抛清晰错误,提示"层级过多/单层过大,考虑减少层级或拆分多 HTML"。
- 软建议:LLM 写 DSL 时,目标 **N ≤ 6,单层 SVG ≤ 25KB**;后端 description 里给此指引。

### 8.3 懒载为什么不推荐

| 路径 | 可行性 | 问题 |
|---|---|---|
| 浏览器内跑 D2 WASM 按需渲染子层 | ❌ | 21MB WASM 超 cap 80-125 倍;且首次 drill 需加载+初始化 WASM(~3-10s) |
| 把 N 份 SVG 存为独立 .svg 文件,按需 fetch | ❌ | 单文件 HTML 无 fetch 源(`file://` 跨域受限;HTTP 场景需把 N 份 .svg 一起部署,破"单文件") |
| inline N 份 SVG 但用 `<template>` 懒解析 | ⚠️ 假优化 | DOM 解析 N 份 SVG 字符串的成本 ≈ inline 直显,差异在 ms 级,远不抵复杂性 |
| Service Worker 缓存子层 | ❌ | 单文件场景 SW 注册需同源 `https://` 或 `file://` 不支持,且 SW 本身是另一份 JS 破 S2 |

**裁决:全预嵌**。这与 doc_v12 §3.1 "浏览器内 D2 重布局不可行" 的证据一致,只是把"重布局"换成"重渲染任意子层"——同样被 21MB WASM 挡死。

### 8.4 全预嵌的优化空间(可选,Tier 2)

1. **SVG gzip 压缩进 HTML**:不可行(HTML 是文本,gzip 需 transport 层)。HTTP 服务器会自动 gzip 整个 HTML,所以 inline SVG 已隐式享受 gzip。
2. **共享 `<defs>`**:N 层 SVG 共用 marker / 箭头 / icon defs,提到顶层 `<svg><defs>` 共享。需后端做 SVG 后处理(提取公共 defs)。节省 5-15%。
3. **同层节点去重**:同一节点在不同层出现(如 root 里有 "order_service",其子层里也有外框),只存一份 + `<use href="#id">`。复杂度高,ROI 低,不做。
4. **图标 Iconify 去 CDN**:已在 generate_diagram 路径解决(data URI inline),不重复。

### 8.5 性能策略小结

> **给实施者的硬规则**:全预嵌,守 S6 ≤256KB;后端在 description 明确建议 N≤6、单层 ≤25KB;`asserts.ts` 加多层体积断言。懒载全部出局,不做。

---

## 9. 与现有 MVP 的整合(条件展开,守 byte-identical)

### 9.1 条件展开原则(复用 P0-5A 三杠杆 conditional expand 范式)

P0-5A 已建立"条件展开最小加性"范式:三杠杆(`darkThemeID`/`noXMLTag`/`salt`)仅在 `generate_interactive_diagram` 路径传,`generate_diagram` 路径不传 → byte-identical。本设计沿用同范式:

| 触发条件 | 注入内容 | 不触发时 |
|---|---|---|
| `layers` 参数存在(或 DSL 含 nested container) | `<nav id="mgm-breadcrumb">` HTML + viewStack JS + 多层 JSON payload + drill CSS | 整块不注入,产物 byte-identical 现状 |
| 单层 DSL(无 nested) | 不注入 drill 相关任何字节 | 与 0.12.x 现状 byte-identical |

### 9.2 inputSchema 加性改动(零 diff 现状)

```ts
// 仅追加可选字段,不改正文任何字段
inputSchema: {
  type: "object",
  properties: {
    code: { /* 不动 */ },
    theme: { /* 不动 */ },
    darkTheme: { /* 不动 */ },
    title: { /* 不动 */ },
    previewPng: { /* 不动 */ },
    name: { /* 不动 */ },
    outDir: { /* 不动 */ },
    // === 新增(本设计) ===
    layers: {
      type: "array",
      description: "Multi-layer drill-down payload. Each entry is a sub-layer D2 snippet. " +
        "When set, the HTML embeds a view-stack + breadcrumb navigation. " +
        "AVOID: large snippets (>25KB SVG each) or too many layers (>6) — risks S6 size cap. " +
        "Default: undefined (single-layer, byte-identical to no-layers mode).",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "Unique dot-path id (e.g. 'order.pay')" },
          title: { type: "string", description: "Breadcrumb label" },
          code: { type: "string", description: "Sub-layer D2 DSL" },
          parentId: { type: "string", description: "Parent layer id (null/omit for root)" }
        },
        required: ["id", "title", "code"]
      }
    }
  },
  required: ["code"]
}
```

**立场守门**:`check-schema.mjs` G2(20 工具数)不动;`generate_diagram`/19 工具 inputSchema 全 byte-identical。`layers` 是 generate_interactive_diagram 独有的可选参数。

### 9.3 golden 测试策略(P0-3 byte-compare 守门)

- **新增 golden**:`test/golden/expected/interactive-html/multi-layer.golden.html`(多层 fixture)
- **现有 golden 不动**:`architecture.golden.html`(单层用例)byte-identical 验证条件展开
- **契约扩展**:`asserts.ts` 加 `assertDrillPayloadValid(html, layersPayload)`(可选)— 校验 payload schema 合法 + 切层逻辑可还原

### 9.4 文件改动清单(给实施者估算)

| 文件 | 改动 | 行数估算 |
|---|---|---|
| `src/interactive-html/index.ts` | 条件展开:若 `layers` 传入 → 渲染 N 层 SVG → 拼 payload → 改 fillTemplate | +40 行 |
| `src/interactive-html/render-d2.ts` | 加 `renderD2ForLayers(layers)` 批量渲染 | +30 行 |
| `src/interactive-html/template.ts` | 条件注入 `<nav id="mgm-breadcrumb">` + `<script type="application/json" id="mgm-layers-data">` 占位符 | +25 行 |
| `src/interactive-html/viewer-stack.ts` | **新增**:本设计的 ~200 行 viewStack JS(inline 字符串) | +200 行 |
| `src/interactive-html/drill.css.ts`(或并入 template) | drillable / breadcrumb CSS | +80 行 |
| `src/interactive-html/asserts.ts` | 加 `assertLayersSizeUnder` | +20 行 |
| `test/golden/fixtures/interactive-html/multi-layer.d2` | 多层 fixture | +30 行 |
| `test/.../multi-layer.golden.html` | checked-in golden | 自动生成 |
| `src/index.ts` | 工具定义 inputSchema 加 `layers` 可选字段 | +20 行 |
| 总计 | | ~+450 行 |

预估工时:**3-4 人日**(设计已就位,主要是落地 + golden + 一轮 review)。

---

## 10. 立场风险与缓解

| 风险 | 缓解 |
|---|---|
| **破 S2 自包含**(误引路由框架) | 全 vanilla JS IIFE,inline 字符串;零 `<script src=`;PR review grep 守门 |
| **破 S5 同输入同输出** | viewStack JS 内无 `Math.random`/`Date.now`;hash 序列化纯字符串;payload 顺序由后端确定性遍历保证 |
| **破 inputSchema 零 diff** | `layers` 是 generate_interactive_diagram 独有可选字段;19 工具 + generate_diagram 不动 |
| **破 S6 ≤256KB** | `assertLayersSizeUnder` 硬断言;description 明确建议 N≤6、单层 ≤25KB |
| **过度工程**(向 T5 拖拽滑) | 收口决策 §2 第 2 条红线:drill-down ≠ 拖拽编辑;drill 只切视图不改图 |
| **D2 几何被 viewer 改** | INV:viewStack 只 `stage.innerHTML =` 替换 SVG 字符串,从不 mutate SVG DOM 属性(pan/zoom 走 `stage.style.transform`,与 viewer-min 一致) |
| **a11y 退化**(aria 角色错配) | `aria-expanded` 语义对 drill 不准确(见 §11 #3),需 review;`aria-current="page"` 标当前级为标准实践 |
| **hash 注入攻击**(恶意 #path) | INV-2 校验:hash 必须沿合法父子链,否则降级 root;不执行任何"代码",只跳 layer id |

---

## 11. 未决问题(open_points)

1. **DSL 自动分层 vs 手动 `layers` 参数** —— 当前设计两手准备(支持 `layers` 显式传入,也支持后端从单 DSL 的 nested container 自动提取)。**实施时决策**:若 D2 WASM 支持按 scope 渲染子图(需实地核实 D2 `RenderOptions` 或 sketch board),走自动;否则只支持 `layers`。建议 MVP 先做 `layers` 手动模式(可控、确定),自动模式 Tier 2。

2. **多层 golden 的 byte-identical 可行性** —— 单层已实测 byte-identical(doc_v11 未决问题 #2)。多层是 N 次独立 D2 渲染拼起来,每次确定则拼起来也确定。**预期可行**,Step 实施时连跑 10 次 diff 验证。

3. **`aria-expanded` 的语义错配** —— drill 是 push 新视图(切层),不是 in-place expand(同视图内展开)。`aria-expanded="false"` 暗示"点击后原地变 expanded=true",但实际是切到新视图,旧视图的 expanded 状态消失。**选项**:(a) 不用 `aria-expanded`,只用 `aria-label="进入 X 子层"` + `role="button"`;(b) 用 `role="link"` 而非 `button`(link 语义是"跳转",更贴近切视图)。建议 (b):`role="link"` + `aria-label`。需 a11y review 确认。

4. **`history.replaceState` vs `pushState` 的 back 语义** —— 本设计选 replaceState(§6.4)。**真实用户测试缺失**:没有 a/b 测试数据支撑"用户预期浏览器 back 不在视图栈里翻"。建议落地后做一轮用户反馈,若抱怨"想用浏览器 back 回上一层"再切 pushState。当前选择基于 Smashing Magazine 的 UX 警告。

5. **多层用例的 README 嵌入退路** —— drill JS 在 README 被剥,GitHub README 看到 drill-down HTML 会变成"只显 root 层的静态图"。**退路**:handler 同时输出 `.svg`(root 层)+ 可选 `format: "html+svg"`;README 嵌 `.svg`,drill 仅浏览器打开 HTML 时可用。doc_v12 §3.3 已建议此路径,不属本设计交付。

6. **条件展开的"零字节泄漏"验证** —— 单层用例必须与 0.12.x byte-identical。**实施时必测**:跑 `generate_interactive_diagram(code="a -> b")`(无 layers)+ diff vs 0.12.1 现状。若哪怕多一个字节,条件展开失败,需补 sentinel 校验(类似 P0-5A F11 sentinel 碰撞防御)。

---

## 12. 给主控的交付清单

| 产出 | 状态 |
|---|---|
| 导航范式决策(替换视图 + 证据) | ✅ §1 |
| 视图栈 vanilla JS 伪代码(可落地) | ✅ §3 |
| 可点击信号设计(chevron + tooltip + 叶子区分) | ✅ §4 |
| 面包屑设计(含折叠 + aria-current) | ✅ §5 |
| 深链/分享(URL hash 协议 + 离线可用性) | ✅ §6 |
| 键盘 + 无障碍(roving tabindex + Esc/Esc 语义切分) | ✅ §7 |
| 性能策略(全预嵌推荐 + 懒载出局证据) | ✅ §8 |
| 与 MVP 整合(条件展开守 byte-identical) | ✅ §9 |
| 立场风险 + open points | ✅ §10/§11 |

**主控裁决点**:
- (a) 是否本设计升 P0-5B 主线(估 3-4 人日)?
- (b) `layers` 参数自动分层(Tier 2)还是手动模式 MVP?
- (c) `aria-expanded` 错配 → `role="link"` 切换是否采纳?

---

**文档结束**。读者读完应能:(1) 判断 drill-down 是否值得做(ROI:3-4 人日换"图不再因过大失去可读性");(2) 直接照 §3 伪代码落地;(3) 知道懒载为何出局;(4) 守住全部 5 条立场 + byte-identical 兼容。
