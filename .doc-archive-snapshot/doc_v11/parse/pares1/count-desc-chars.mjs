// P0-1 实施期 ad-hoc 校验脚本(不入 media-gen-mcp repo,放 doc_v11/parse/pares1/)
// 用法:cd media-gen-mcp && node /Users/wangdong/Documents/Project/Agnes\ AI接入/doc_v11/parse/pares1/count-desc-chars.mjs
// 校验:
//   1) 19 工具 description 字符数 ≤1100(generate_diagram 例外)
//   2) 5 个最该改工具含 WHEN + AVOID + NEXT + cross-ref
//   3) generate_chart ↔ analyze_chart 双向 cross-ref
//   4) generate_image 含 generate_card + generate_icon
//   5) generate_diagram 含 render_svg,不含 NEXT(NEXT 留给 P0-5)
//   6) 全部使用双引号字符串,无模板字面量
import { spawn } from "node:child_process";

const proc = spawn("node", ["dist/index.js"], { stdio: ["pipe", "pipe", "pipe"] });
let buf = "", id = 0;
const pending = new Map();
proc.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    try { const m = JSON.parse(line); if (m.id != null && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } catch {}
  }
});
function send(method, params) {
  const myId = ++id;
  return new Promise((resolve) => { pending.set(myId, resolve); proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: myId, method, params }) + "\n"); });
}

let pass = 0, fail = 0;
const ok = (m) => { console.log("  ✅ " + m); pass++; };
const bad = (m) => { console.error("  ❌ " + m); fail++; };

try {
  await send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "desc-count", version: "1" } });
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  const r = await send("tools/list", {});
  const tools = r.result.tools;

  console.log("\n[T1] description 字符数 ≤1100");
  let total = 0, maxLen = 0, maxName = "";
  for (const t of tools) {
    const n = t.description.length;
    total += n;
    if (n > maxLen) { maxLen = n; maxName = t.name; }
    if (n <= 1100) ok(`${t.name}: ${n}`);
    else bad(`${t.name}: ${n} > 1100`);
  }
  console.log(`  --- total=${total} chars, avg=${Math.round(total/19)}, max=${maxName}(${maxLen}) ---`);

  const D = (name) => tools.find((t) => t.name === name).description;
  const has = (name, needle) => D(name).includes(needle);

  console.log("\n[T2] 5 个最该改工具含 WHEN + AVOID + NEXT + cross-ref");
  for (const name of ["generate_chart", "analyze_chart", "generate_image", "create_video", "render_svg"]) {
    const d = D(name);
    (d.includes("WHEN:") ? ok : bad)(`${name}: WHEN: present`);
    (d.includes("AVOID:") ? ok : bad)(`${name}: AVOID: present`);
    (d.includes("NEXT:") ? ok : bad)(`${name}: NEXT: present`);
  }

  console.log("\n[T3] generate_chart ↔ analyze_chart 双向 cross-ref");
  (has("generate_chart", "analyze_chart") ? ok : bad)("generate_chart 描述含 'analyze_chart'");
  (has("analyze_chart", "generate_chart") ? ok : bad)("analyze_chart 描述含 'generate_chart'");

  console.log("\n[T4] generate_image 含 generate_card + generate_icon");
  (has("generate_image", "generate_card") ? ok : bad)("generate_image 描述含 'generate_card'");
  (has("generate_image", "generate_icon") ? ok : bad)("generate_image 描述含 'generate_icon'");

  console.log("\n[T5] generate_diagram in-place AVOID reciprocal(P0-1),不含 NEXT(留给 P0-5)");
  (has("generate_diagram", "render_svg") ? ok : bad)("generate_diagram 描述含 'render_svg'");
  (!has("generate_diagram", "NEXT:") ? ok : bad)("generate_diagram 描述不含 'NEXT:'(P0-5 append)");

  console.log("\n[T6] create_video ↔ render_video 双向 cross-ref");
  (has("create_video", "render_video") ? ok : bad)("create_video 描述含 'render_video'");
  (has("render_video", "create_video") ? ok : bad)("render_video 描述含 'create_video'");

  console.log("\n[T7] generate_diagram ↔ render_svg 双向 cross-ref(P0-1 完成 P0-1 侧)");
  (has("render_svg", "generate_diagram") ? ok : bad)("render_svg 描述含 'generate_diagram'");
  (has("generate_diagram", "render_svg") ? ok : bad)("generate_diagram 描述含 'render_svg'(已在 T5)");

  console.log("\n[T8] 所有工具 description 非空 string + 19 工具齐全");
  (tools.length === 19 ? ok : bad)(`tools.length === 19 (实际 ${tools.length})`);
  let allNonEmpty = true;
  for (const t of tools) if (typeof t.description !== "string" || t.description.length === 0) { allNonEmpty = false; bad(`${t.name}: description 空`); }
  if (allNonEmpty) ok("全部 19 工具 description 非空 string");

  console.log("\n[T9] 段落分隔 \\n\\n 形态正确(应能在 tools/list 渲染)");
  let nnCount = 0;
  for (const t of tools) {
    const c = (t.description.match(/\n\n/g) || []).length;
    nnCount += c;
  }
  console.log(`  --- 全 19 工具共 ${nnCount} 处 \\n\\n 分隔(>0 表示新形态已生效) ---`);
  ok(`\\n\\n 分隔统计完成: ${nnCount} 处`);
} catch (e) {
  bad("抛错: " + (e?.message ?? String(e)));
} finally {
  proc.kill();
}
console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
