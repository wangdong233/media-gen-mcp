/**
 * 交互式 HTML 图 —— viewer 极简版(P0-5A §3.5)。
 *
 * ~150 行 vanilla JS,inline 进 HTML(零外链 <script src=,守 S2)。
 *
 * 功能:
 *   - pan(pointer drag 滚动 viewer)
 *   - zoom(wheel + ±/reset 按钮,transform: scale)
 *   - theme toggle(auto → light → dark → auto 循环,翻 data-theme/data-themePref)
 *   - motion toggle(auto → still → auto,翻 data-motion)
 *   - export SVG(序列化当前 SVG 为 .svg 下载,不加 <?xml?>)
 *
 * 不变量(P0-5A §3.3):绝不重渲染 SVG、绝不重算几何。
 *
 * License:P0-5 自研(标准 DOM API,无第三方源码引用)。
 */
export const VIEWER_MIN_JS = `(function(){
  var stage = document.getElementById('mgm-stage');
  var viewer = document.getElementById('mgm-viewer');
  var themeBtn = document.getElementById('mgm-btn-theme');
  var motionBtn = document.getElementById('mgm-btn-motion');
  var zIn = document.getElementById('mgm-btn-zoom-in');
  var zOut = document.getElementById('mgm-btn-zoom-out');
  var zReset = document.getElementById('mgm-btn-zoom-reset');
  var expSvg = document.getElementById('mgm-btn-export-svg');
  if (!stage || !viewer) return;
  var htmlEl = document.documentElement;
  var zoom = 1;
  function clampZoom(z){ return Math.max(0.2, Math.min(5, z)); }
  function applyZoom(){
    stage.style.transform = 'scale(' + zoom + ')';
  }
  function prefOf(){ return htmlEl.dataset.themePref || 'auto'; }
  function resolvedTheme(){
    return htmlEl.dataset.theme || 'light';
  }
  function labelTheme(){
    var p = prefOf();
    themeBtn.textContent = 'Theme: ' + p.charAt(0).toUpperCase() + p.slice(1);
  }
  function labelMotion(){
    var m = htmlEl.dataset.motion === 'still' ? 'Off' : 'On';
    motionBtn.textContent = 'Motion: ' + m;
  }
  function resolveAuto(){
    try {
      return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    } catch(e){ return 'light'; }
  }
  labelTheme(); labelMotion();
  // pan
  var dragging = false, sx = 0, sy = 0, sl = 0, st = 0;
  viewer.addEventListener('pointerdown', function(e){
    if (e.target.closest('.mgm-actions')) return;
    dragging = true;
    viewer.classList.add('mgm-dragging');
    sx = e.clientX; sy = e.clientY; sl = viewer.scrollLeft; st = viewer.scrollTop;
    try { viewer.setPointerCapture(e.pointerId); } catch(err){}
    e.preventDefault();
  });
  viewer.addEventListener('pointermove', function(e){
    if (!dragging) return;
    viewer.scrollLeft = sl - (e.clientX - sx);
    viewer.scrollTop = st - (e.clientY - sy);
  });
  function endDrag(e){
    if (!dragging) return;
    dragging = false;
    viewer.classList.remove('mgm-dragging');
    try { if (e && e.pointerId != null) viewer.releasePointerCapture(e.pointerId); } catch(err){}
  }
  viewer.addEventListener('pointerup', endDrag);
  viewer.addEventListener('pointercancel', endDrag);
  viewer.addEventListener('pointerleave', endDrag);
  // zoom(wheel)
  viewer.addEventListener('wheel', function(e){
    e.preventDefault();
    var delta = e.deltaY > 0 ? 0.9 : 1.1;
    zoom = clampZoom(zoom * delta);
    applyZoom();
  }, { passive: false });
  if (zIn) zIn.addEventListener('click', function(){ zoom = clampZoom(zoom * 1.2); applyZoom(); });
  if (zOut) zOut.addEventListener('click', function(){ zoom = clampZoom(zoom / 1.2); applyZoom(); });
  if (zReset) zReset.addEventListener('click', function(){
    zoom = 1; applyZoom();
    viewer.scrollLeft = 0; viewer.scrollTop = 0;
  });
  // theme toggle
  if (themeBtn) themeBtn.addEventListener('click', function(){
    var cur = prefOf();
    var next = cur === 'auto' ? 'light' : (cur === 'light' ? 'dark' : 'auto');
    htmlEl.dataset.themePref = next;
    try { localStorage.setItem('mgm-theme', next); } catch(e){}
    htmlEl.dataset.theme = next === 'auto' ? resolveAuto() : next;
    labelTheme();
  });
  // motion toggle
  if (motionBtn) motionBtn.addEventListener('click', function(){
    var cur = htmlEl.dataset.motion === 'still' ? 'still' : 'auto';
    var next = cur === 'still' ? 'auto' : 'still';
    htmlEl.dataset.motion = next;
    try { localStorage.setItem('mgm-motion', next); } catch(e){}
    labelMotion();
  });
  // export SVG(serialize via XMLSerializer + Blob download; no XML declaration added)
  if (expSvg) expSvg.addEventListener('click', function(){
    var svg = stage.querySelector('svg');
    if (!svg) return;
    var xml = new XMLSerializer().serializeToString(svg);
    var blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'diagram.svg';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1500);
  });
  // 键盘快捷键:Esc 重置视图,+/- 缩放
  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape') { zoom = 1; applyZoom(); viewer.scrollLeft = 0; viewer.scrollTop = 0; }
    else if (e.key === '+' || e.key === '=') { zoom = clampZoom(zoom * 1.2); applyZoom(); }
    else if (e.key === '-' || e.key === '_') { zoom = clampZoom(zoom / 1.2); applyZoom(); }
  });
})();`;
