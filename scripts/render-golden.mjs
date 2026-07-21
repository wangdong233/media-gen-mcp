/**
 * P0-3 Golden 刷新器 —— 一键重生成 test/golden/expected/ 下所有 golden 产物。
 *
 * 设计与 Archify render-examples.mjs 完全对偶:同一份 GOLDEN 配置,只换输出路径(覆盖 expected/)。
 *
 * 流程:
 *   1. npm run build         (产 dist/;render.ts 从此 import)
 *   2. npm run build:tests   (产 dist-test/;golden.config/render 经 TS 编译)
 *   3. node scripts/render-golden.mjs(本文件,.mjs 不编译)
 *        → import dist-test/golden/{golden.config,render}.js
 *        → for c of GOLDEN, render(c.tool, c.fixturePath)
 *        → writeFile to test/golden/expected/<expectedPath>
 *        → 人工 git diff test/golden/expected/ review 后 commit
 *
 * R-06:.mjs 不在 tsconfig.test.json 的 include(只含 test 目录下的 .ts 文件),不编译,直接跑。
 * R-05 路径 A:dist-test/golden/{golden.config,render}.js(rootDir=test 不保留 test/ 前缀)。
 *
 * License:本文件为 P0-3 自研。
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, ".."); // = media-gen-mcp/ 项目根

// 用绝对路径 import,避免相对路径在不同 cwd 下解析失败
const { GOLDEN } = await import(path.resolve(ROOT, "dist-test/golden/golden.config.js"));
const { render } = await import(path.resolve(ROOT, "dist-test/golden/render.js"));

const EXPECTED = path.resolve(ROOT, "test/golden/expected");
await mkdir(EXPECTED, { recursive: true });

let updated = 0;
let skipped = 0;
const errors = [];

for (const c of GOLDEN) {
  if (c.skipReason) {
    skipped++;
    console.log(`  ⊘ ${c.id}: skip(${c.skipReason})`);
    continue;
  }
  try {
    const { svg, png } = await render(c.tool, c.fixturePath);
    const out = path.join(EXPECTED, c.expectedPath);
    await mkdir(path.dirname(out), { recursive: true });
    if (c.compareStrategy === "svg-byte") {
      if (!svg) throw new Error("renderer 未返 svg");
      await writeFile(out, svg, "utf8");
    } else if (c.compareStrategy === "png-byte" || c.compareStrategy === "qr-png-verify") {
      if (!png) throw new Error("renderer 未返 png");
      await writeFile(out, png);
    } else {
      throw new Error(`unknown compareStrategy: ${c.compareStrategy}`);
    }
    console.log(`  ✓ ${c.id} → test/golden/expected/${c.expectedPath}`);
    updated++;
  } catch (e) {
    errors.push({ id: c.id, err: e });
    console.error(`  ✗ ${c.id}: ${e?.message ?? String(e)}`);
  }
}

console.log(`\n=== ${updated} golden refreshed, ${skipped} skipped, ${errors.length} errors ===`);
if (errors.length) {
  console.error("\nErrors:");
  for (const { id, err } of errors) console.error(`  ${id}: ${err?.stack ?? err}`);
  process.exit(1);
}
console.log("\nNext:git diff test/golden/expected/  # 人工 review 每个 byte 变化");
console.log("      git commit -am 'refresh golden after <reason>'");
