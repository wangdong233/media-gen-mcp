// P0-5 未决点 #2 实测:D2 默认 salt 行为 + 同输入两次 byte-identical 验证
// 运行: cd "/Users/wangdong/Documents/Project/Agnes AI接入/media-gen-mcp" && node "/Users/wangdong/Documents/Project/Agnes AI接入/doc_v11/d2-salt-determinism-probe.mjs"

// 用 file:// 直链 import media-gen-mcp 的 ESM dist(probe 物理在 doc_v11/)
const D2 = (await import("file:///Users/wangdong/Documents/Project/Agnes%20AI%E6%8E%A5%E5%85%A5/media-gen-mcp/node_modules/@terrastruct/d2/dist/node-esm/index.js")).D2;

const d2 = new D2();
await d2.ready;

// 三组输入(覆盖简单/中等/带样式),每组连跑 3 次,看 SVG 是否 byte-identical
const cases = [
  { name: "trivial",   code: "a -> b" },
  { name: "medium",    code: "client -> api: request\napi -> db: query\ndb -> api: result\napi -> client: response" },
  { name: "styled",    code: "api: { shape: hexagon; style.fill: \"#16213e\" }\ndb: { shape: cylinder; style.fill: \"#1a1a2e\" }\napi -> db: query" },
];

console.log("=== TEST A: 默认 salt 行为(不传 salt) — 同输入连跑 3 次 ===\n");
const defaultBehaviorResults = {};
for (const c of cases) {
  const runs = [];
  for (let i = 0; i < 3; i++) {
    const compiled = await d2.compile(c.code);
    // 不传 salt —— 模拟 generate_diagram 当前路径
    const svg = await d2.render(compiled.diagram, compiled.renderOptions);
    runs.push(svg);
  }
  const r1eq2 = runs[0] === runs[1];
  const r1eq3 = runs[0] === runs[2];
  defaultBehaviorResults[c.name] = { r1eq2, r1eq3, len: runs[0].length };
  console.log(`[${c.name}] len=${runs[0].length}  run1==run2: ${r1eq2}  run1==run3: ${r1eq3}`);
  if (!r1eq2 || !r1eq3) {
    // 找出第一处差异
    const a = runs[0], b = runs[1];
    let diffPos = -1;
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i] !== b[i]) { diffPos = i; break; }
    }
    if (diffPos >= 0) {
      console.log(`  首处差异 @pos ${diffPos}:`);
      console.log(`    run1: ...${JSON.stringify(a.slice(Math.max(0,diffPos-30), diffPos+50))}...`);
      console.log(`    run2: ...${JSON.stringify(b.slice(Math.max(0,diffPos-30), diffPos+50))}...`);
    } else {
      console.log(`  长度不同但前缀相同: len1=${a.length} len2=${b.length}`);
    }
  }
}

console.log("\n=== TEST B: 默认渲染下 SVG 内 ID 模式(找 id=\"...\") ===\n");
for (const c of cases) {
  const compiled = await d2.compile(c.code);
  const svg = await d2.render(compiled.diagram, compiled.renderOptions);
  const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  const uniqueIds = ids.filter((v, i, arr) => arr.indexOf(v) === i);
  console.log(`[${c.name}] id 总数=${ids.length} 唯一 id 数=${uniqueIds.length}`);
  console.log(`  前 5 个 id 样例: ${JSON.stringify(ids.slice(0, 5))}`);
  // 看是否含看似随机/时间戳/uuid 的 id
  const suspicious = ids.filter(id => /[0-9a-f]{8,}/i.test(id) || /\d{10,}/.test(id));
  console.log(`  可疑(疑似随机/uuid/时间戳)id 数=${suspicious.length}  样例=${JSON.stringify(suspicious.slice(0,3))}`);
}

console.log("\n=== TEST C: 显式 salt + darkThemeID + noXMLTag(P0-5 §3.2 三杠杆) — 同输入两次 ===\n");
const c3 = cases[1]; // medium
const compiled = await d2.compile(c3.code);
const renderOpts = {
  ...compiled.renderOptions,
  darkThemeID: 1,
  noXMLTag: true,
  salt: "media-gen-mcp-interactive",
};
const out1 = await d2.render(compiled.diagram, renderOpts);
const out2 = await d2.render(compiled.diagram, renderOpts);
console.log(`[medium + 三杠杆] out1==out2: ${out1 === out2}  len=${out1.length}`);
if (out1 !== out2) {
  const a = out1, b = out2;
  let diffPos = -1;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) { diffPos = i; break; }
  }
  console.log(`  首处差异 @pos ${diffPos}`);
  if (diffPos >= 0) {
    console.log(`    out1: ...${JSON.stringify(a.slice(Math.max(0,diffPos-30), diffPos+50))}...`);
    console.log(`    out2: ...${JSON.stringify(b.slice(Math.max(0,diffPos-30), diffPos+50))}...`);
  }
}

console.log("\n=== TEST D: 不同 salt 之间的 diff(确认 salt 真的影响 ID) ===\n");
const cD = cases[0]; // trivial
const compiledD = await d2.compile(cD.code);
const sA = await d2.render(compiledD.diagram, { ...compiledD.renderOptions, salt: "salt-A" });
const sB = await d2.render(compiledD.diagram, { ...compiledD.renderOptions, salt: "salt-B" });
console.log(`[trivial] salt-A==salt-B: ${sA === sB}  (预期 false,证明 salt 影响 ID)`);
const idsA = [...sA.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
const idsB = [...sB.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
console.log(`  salt-A id 样例: ${JSON.stringify(idsA.slice(0, 5))}`);
console.log(`  salt-B id 样例: ${JSON.stringify(idsB.slice(0, 5))}`);

console.log("\n=== TEST E: 默认 vs 显式空字符串 salt vs 显式 salt —— 看默认是否随机 ===\n");
const cE = cases[0];
const compiledE = await d2.compile(cE.code);
const def  = await d2.render(compiledE.diagram, compiledE.renderOptions);
const def2 = await d2.render(compiledE.diagram, compiledE.renderOptions);
const empty = await d2.render(compiledE.diagram, { ...compiledE.renderOptions, salt: "" });
const fixed = await d2.render(compiledE.diagram, { ...compiledE.renderOptions, salt: "fixed" });
console.log(`default run1==run2: ${def === def2}`);
console.log(`default==empty salt: ${def === empty}`);
console.log(`default==fixed salt "fixed": ${def === fixed}`);

console.log("\n=== 结论 ===");
const allStable = Object.values(defaultBehaviorResults).every(r => r.r1eq2 && r.r1eq3);
console.log(`默认行为(不传 salt)同输入两次 byte-identical: ${allStable ? "YES ✅" : "NO ❌"}`);
console.log(`=> ${allStable
  ? "P0-5 §0 C3 的'salt 默认不传时 D2 内部很可能自动生成随机 salt'假设【不成立】。salt 仅用于多图同 HTML 防冲突,默认渲染对单图是确定性的。"
  : "P0-5 §0 C3 的假设成立,必须传固定 salt。"}`);
