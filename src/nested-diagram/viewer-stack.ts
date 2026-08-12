/**
 * 嵌套架构图工具 —— viewer-stack 导航 JS(P0-5B §5 / 方案 §3.3 + §5)。
 *
 * ~230 行 vanilla JS IIFE,inline 进 HTML(零外链 <script src=,守 S2)。
 *
 * 架构 = template-store(B1 probe 铁证:多 D2 SVG 同 DOM 共享 99 个未前缀 class → CSS 级联冲突;
 *   故同时只 1 SVG 在 DOM,showView 用 stage.innerHTML 切换;display-toggle-only 不变量)。
 *
 * 功能:
 *   - showView(id):template-store swap(diagram svg / container-list 卡片)+ reset zoom + 面包屑 + hash
 *   - drillInto(id):INV-2 安全(目标必须是当前层 child,防 hash/外部链接逃树)
 *   - popTo(idx) / goUp():面包屑回跳 + Esc 上溯
 *   - 面包屑:>5 折叠(head2 + … + tail2),root/current 永显
 *   - URL hash 深链:#path=a/b/c,replaceState 同步,restoreFromHash 沿 children 链校验(INV-2)
 *   - drill 拦截:事件委托 a[href^="drill:"] + button[data-drill](container-list 卡片)
 *   - pan / zoom / theme / motion / export:复用 viewer-min 范式(~130 行文本重复,守 byte-identical 红线,
 *     01 §3.2 duplication > wrong abstraction;抽 viewer-core factory 须改 viewer-min 源码 → Tier 2)
 *   - Esc 语义切分(03 §1.3 condition):stack>1 → goUp;stack=1 → reset zoom(不与 viewer-min 冲突,
 *     本 viewer 是 nested HTML 唯一 JS,viewer-min.ts 冻结在 generate_interactive_diagram)
 *
 * 五不变量(INV-1..5,方案 §5.1):
 *   INV-1  stack[0] === ROOT 永真
 *   INV-2  stack[i+1] 必在 stack[i].children 中(drill/hash 目标必须是当前层 child,防逃树)
 *   INV-3  URL hash 与 stack 一一对应(syncHash/restoreFromHash 双向)
 *   INV-4  从叶子无法继续 drill(cur.children 为空 → drillInto 永远 return);叶子可作为 drill 目标
 *          进栈展示其图(无 drill 出口),但永不在栈中间(INV-2 保证:leaf.children=[] 无法再 push)
 *   INV-5  Motion Governor 管 fade(prefers-reduced-motion / data-motion=still gate)
 *
 * License:P0-5B 自研(标准 DOM API + 事件委托,无第三方源码引用;pan/zoom/theme 工艺与 viewer-min 同源)。
 */
export const VIEWER_NESTED_JS = `(function(){
  var stage = document.getElementById('mgm-stage');
  var viewer = document.getElementById('mgm-viewer');
  var bcNav = document.getElementById('mgm-breadcrumb');
  var upBtn = document.getElementById('mgm-btn-up');
  var themeBtn = document.getElementById('mgm-btn-theme');
  var motionBtn = document.getElementById('mgm-btn-motion');
  var zIn = document.getElementById('mgm-btn-zoom-in');
  var zOut = document.getElementById('mgm-btn-zoom-out');
  var zReset = document.getElementById('mgm-btn-zoom-reset');
  var expSvg = document.getElementById('mgm-btn-export-svg');
  if (!stage || !viewer) return;
  var htmlEl = document.documentElement;

  // ── 解析 manifest store(template-store 数据源)──
  var manifestEl = document.getElementById('mgm-manifest');
  var manifest = { rootId: '', layers: [] };
  try { manifest = JSON.parse(manifestEl.textContent); } catch (e) { return; }
  var ROOT = manifest.rootId;
  var LAYERS = {};
  for (var i = 0; i < manifest.layers.length; i++) {
    LAYERS[manifest.layers[i].id] = manifest.layers[i];
  }
  if (!LAYERS[ROOT]) return; // root 不在 store → 数据损坏,退出

  // ── 导航栈(INV-1: stack[0]===ROOT 永真)──
  var stack = [ROOT];
  var zoom = 1;

  function currentId() { return stack[stack.length - 1]; }
  function clampZoom(z) { return Math.max(0.2, Math.min(5, z)); }
  function applyZoom() { stage.style.transform = 'scale(' + zoom + ')'; }

  // ── container-list 渲染(分组容器:diagram==="" 的层,显示 children 卡片)──
  function renderContainerList(layer) {
    var cards = layer.children.map(function (cid) {
      var child = LAYERS[cid];
      if (!child) return '';
      var hint = child.children && child.children.length
        ? '<span class="mgm-card-hint" aria-hidden="true">点击进入 ▾</span>'
        : '';
      return '<button class="mgm-child-card" type="button" data-drill="' + cid + '">' +
        '<span class="mgm-card-title">' + child.title + '</span>' + hint + '</button>';
    }).join('');
    return '<div class="mgm-container-list"><p class="mgm-container-placeholder">「' +
      layer.title + '」是聚合层,选择子模块进入</p><div class="mgm-child-cards">' +
      cards + '</div></div>';
  }

  // ── showView:template-store swap + reset + 面包屑 + hash(INV-3)──
  function showView(id) {
    var layer = LAYERS[id];
    if (!layer) return;
    // template-store 核心:同时只 1 SVG 在 DOM(B1 probe:防 class 级联冲突)
    stage.innerHTML = layer.viewMode === 'container-list'
      ? renderContainerList(layer)
      : layer.svg;
    markDrillable(); // 给可下钻节点加 ▾ 信号(防"看不出能点")
    zoom = 1; applyZoom();
    viewer.scrollLeft = 0; viewer.scrollTop = 0;
    renderBreadcrumb();
    syncHash();
    if (upBtn) upBtn.disabled = stack.length <= 1;
    // a11y:切层播报(屏幕阅读器读 layer.title)+ 焦点回退(stage innerHTML 替换后旧焦点链接消失 → 焦点落 upBtn 让键盘用户可继续)
    var live = document.getElementById('mgm-aria-live');
    if (live) live.textContent = layer.title ? '进入:' + layer.title : '';
    if (!stage.contains(document.activeElement) || document.activeElement === document.body) {
      if (upBtn && !upBtn.disabled) { try { upBtn.focus({ preventScroll: true }); } catch (e) { try { upBtn.focus(); } catch (e2) {} } }
    }
  }

  // ── markDrillable:可下钻节点(a[href^="drill:"])加 ▾ 角标 + hover 高亮 + cursor ──
  // 解决"用户不知道哪些节点能点"的可视辨识缺失(设计 §5.2 chevron 角标 + hover 信号)
  function markDrillable() {
    var links = stage.querySelectorAll('a[href^="drill:"]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      try { a.classList.add('mgm-drillable'); } catch (e) { a.className += ' mgm-drillable'; }
      a.style.cursor = 'pointer';
      if (a.querySelector('.mgm-drill-mark')) continue; // 已加
      try {
        var bb = a.getBBox(); // SVGGraphicsElement.getBBox,<a> 内坐标(共享 transform)
        var mark = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        mark.setAttribute('class', 'mgm-drill-mark');
        mark.setAttribute('x', bb.x + bb.width - 3);
        mark.setAttribute('y', bb.y + bb.height - 3);
        mark.setAttribute('text-anchor', 'end');
        mark.textContent = '▾ 点击进入';
        a.appendChild(mark);
      } catch (e) { /* getBBox 失败(隐藏/无几何)→ 跳过,hover 信号仍生效 */ }
    }
  }

  // ── drillInto:INV-2 安全(目标必须是当前层 child,防 hash/外部链接逃树)──
  function drillInto(id) {
    if (!LAYERS[id]) return;
    var cur = LAYERS[currentId()];
    if (!cur.children || cur.children.indexOf(id) < 0) return; // 不是当前层 child → 拒
    stack.push(id);
    showView(id);
  }

  function popTo(idx) {
    if (!(idx >= 0 && idx < stack.length)) return; // NaN 安全(NaN 比较皆 false → 取反 → return);防 slice(0,NaN)=[] 破 INV-1
    stack = stack.slice(0, idx + 1);
    showView(currentId());
  }

  function goUp() { if (stack.length > 1) popTo(stack.length - 2); }

  // ── 面包屑:>5 折叠(head2 + … + tail2),root/current 永显(NN/g supplement navigation)──
  function renderCrumb(id, idx, isCurrent) {
    var t = LAYERS[id].title;
    return isCurrent
      ? '<span class="mgm-crumb mgm-crumb-current" aria-current="page">' + t + '</span>'
      : '<button class="mgm-crumb" type="button" data-pop="' + idx + '">' + t + '</button>';
  }
  function renderBreadcrumb() {
    var n = stack.length;
    bcNav.style.display = n > 1 ? '' : 'none'; // 单层隐藏省垂直空间
    if (n <= 1) { bcNav.innerHTML = ''; return; }
    var parts = [];
    if (n <= 5) {
      for (var i = 0; i < n; i++) parts.push(renderCrumb(stack[i], i, i === n - 1));
    } else {
      // head 2 + … + tail 2(root 与 current 永显)
      parts.push(renderCrumb(stack[0], 0, false));
      parts.push(renderCrumb(stack[1], 1, false));
      parts.push('<span class="mgm-crumb-ellipsis" aria-label="已折叠 ' + (n - 4) + ' 层">…</span>');
      parts.push(renderCrumb(stack[n - 2], n - 2, false));
      parts.push(renderCrumb(stack[n - 1], n - 1, true));
    }
    bcNav.innerHTML = parts.join('<span class="mgm-crumb-sep" aria-hidden="true">/</span>');
  }

  // ── URL hash 深链(INV-3 双向;replaceState 非 pushState:浏览器 back 应是"离开此 HTML")──
  function syncHash() {
    try { history.replaceState(null, '', '#path=' + encodeURIComponent(stack.join('/'))); } catch (e) {}
  }
  function restoreFromHash() {
    var h = location.hash || '';
    var m = h.match(/^#path=(.+)$/);
    if (!m) return;
    var ids;
    try {
      ids = decodeURIComponent(m[1]).split('/').filter(Boolean); // 裸 % / %zz 抛 URIError → catch 降级 root
    } catch (e) {
      return; // malformed URI escape → 降级 root(stack 已是 [ROOT],init showView 兜底渲染)
    }
    if (!ids.length || ids[0] !== ROOT) return; // 链断裂:降级 root
    var newStack = [ROOT];
    for (var i = 1; i < ids.length; i++) {
      var prev = LAYERS[newStack[newStack.length - 1]];
      // INV-2:每跳必须是上一层的 child(防 hash 注入逃树)
      if (!prev || !prev.children || prev.children.indexOf(ids[i]) < 0) return;
      newStack.push(ids[i]);
    }
    stack = newStack;
    showView(currentId()); // 统一所有 stack 变更经 showView(消除 init-only footgun;init 的 showView 幂等)
  }

  // ── drill 拦截:事件委托(container-list 卡片 + D2 <a href^="drill:">)──
  stage.addEventListener('click', function (e) {
    if (moved) { moved = false; return; } // pan 拖拽超阈值 → 视为拖拽非点击,跳过 drill(防误导航)
    var card = e.target.closest('button[data-drill]');
    if (card) { e.preventDefault(); drillInto(card.getAttribute('data-drill')); return; }
    var a = e.target.closest('a');
    if (a) {
      var href = a.getAttribute('href') || a.getAttribute('xlink:href') || '';
      if (href.indexOf('drill:') === 0) {
        e.preventDefault(); // 拦截 drill: 链接(B2 probe:D2 产出 <a href="drill:ID">)
        drillInto(href.slice(6));
      } // 其它 href(外部链接)放行默认行为
    }
  });

  // 面包屑回跳委托
  if (bcNav) bcNav.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-pop]');
    if (!btn) return;
    popTo(parseInt(btn.getAttribute('data-pop'), 10));
  });

  // ── pan(pointer drag;复用 viewer-min 范式 + moved 阈值防误触发 drill)──
  var dragging = false, moved = false, sx = 0, sy = 0, sl = 0, st = 0;
  viewer.addEventListener('pointerdown', function (e) {
    if (e.target.closest('.mgm-actions') || e.target.closest('.mgm-breadcrumb')) return;
    dragging = true; moved = false;
    viewer.classList.add('mgm-dragging');
    sx = e.clientX; sy = e.clientY; sl = viewer.scrollLeft; st = viewer.scrollTop;
    try { viewer.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault();
  });
  viewer.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    if (Math.abs(e.clientX - sx) > 5 || Math.abs(e.clientY - sy) > 5) moved = true; // pan 阈值:超 5px 视为拖拽非点击
    viewer.scrollLeft = sl - (e.clientX - sx);
    viewer.scrollTop = st - (e.clientY - sy);
  });
  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    viewer.classList.remove('mgm-dragging');
    try { if (e && e.pointerId != null) viewer.releasePointerCapture(e.pointerId); } catch (err) {}
  }
  viewer.addEventListener('pointerup', endDrag);
  viewer.addEventListener('pointercancel', endDrag);
  viewer.addEventListener('pointerleave', endDrag);

  // ── zoom(wheel + 按钮)──
  viewer.addEventListener('wheel', function (e) {
    e.preventDefault();
    zoom = clampZoom(zoom * (e.deltaY > 0 ? 0.9 : 1.1));
    applyZoom();
  }, { passive: false });
  if (zIn) zIn.addEventListener('click', function () { zoom = clampZoom(zoom * 1.2); applyZoom(); });
  if (zOut) zOut.addEventListener('click', function () { zoom = clampZoom(zoom / 1.2); applyZoom(); });
  if (zReset) zReset.addEventListener('click', function () {
    zoom = 1; applyZoom(); viewer.scrollLeft = 0; viewer.scrollTop = 0;
  });

  // ── theme/motion toggle(复用 viewer-min 范式)──
  function prefOf() { return htmlEl.dataset.themePref || 'auto'; }
  function labelTheme() {
    var p = prefOf();
    if (themeBtn) themeBtn.textContent = 'Theme: ' + p.charAt(0).toUpperCase() + p.slice(1);
  }
  function labelMotion() {
    if (motionBtn) {
      motionBtn.textContent = 'Motion: ' + (htmlEl.dataset.motion === 'still' ? 'Off' : 'On');
      motionBtn.setAttribute('aria-pressed', htmlEl.dataset.motion === 'still' ? 'false' : 'true');
    }
  }
  function resolveAuto() {
    try {
      return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    } catch (e) { return 'light'; }
  }
  labelTheme(); labelMotion();
  if (themeBtn) themeBtn.addEventListener('click', function () {
    var cur = prefOf();
    var next = cur === 'auto' ? 'light' : (cur === 'light' ? 'dark' : 'auto');
    htmlEl.dataset.themePref = next;
    try { localStorage.setItem('mgm-theme', next); } catch (e) {}
    htmlEl.dataset.theme = next === 'auto' ? resolveAuto() : next;
    labelTheme();
  });
  if (motionBtn) motionBtn.addEventListener('click', function () {
    var cur = htmlEl.dataset.motion === 'still' ? 'still' : 'auto';
    var next = cur === 'still' ? 'auto' : 'still';
    htmlEl.dataset.motion = next;
    try { localStorage.setItem('mgm-motion', next); } catch (e) {}
    labelMotion();
  });
  if (upBtn) upBtn.addEventListener('click', goUp);

  // ── export SVG(序列化当前 stage 的 <svg>;container-list 无 svg 则 noop)──
  if (expSvg) expSvg.addEventListener('click', function () {
    var svg = stage.querySelector('svg');
    if (!svg) return;
    var xml = new XMLSerializer().serializeToString(svg);
    var blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'layer.svg';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  });

  // ── 键盘:Esc 语义切分(stack>1 上溯;stack=1 reset zoom)+/- 缩放(03 §1.3 condition)──
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (dragging) endDrag({ pointerId: null }); // 防 pan 中按 Esc 致 dragging 残留 → 后续 pointermove 跳动
      if (stack.length > 1) { goUp(); }
      else { zoom = 1; applyZoom(); viewer.scrollLeft = 0; viewer.scrollTop = 0; }
    } else if (e.key === '+' || e.key === '=') { zoom = clampZoom(zoom * 1.2); applyZoom(); }
    else if (e.key === '-' || e.key === '_') { zoom = clampZoom(zoom / 1.2); applyZoom(); }
  });

  // ── 初始化:restore hash → showView(确保 stage 渲染;README 剥 <script> 时 stage 已含 root svg 兜底)──
  restoreFromHash();
  showView(currentId());
})();`;
