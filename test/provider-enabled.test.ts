/**
 * enabledProviders 白名单 —— 显式启用路径套件(独立 fixture:白名单含 flow)。
 *
 * 与 provider-priority.test.ts 互补:那边 fixture 未配置(出厂缺省 [agnes,zhipu]),
 * 这边显式启用 flow,验证「启用是用户配置而非硬代码」(2026-09-24 用户裁决):
 * 启用后 getProvider("flow") 恢复解析(环境不可用由 provider 自身 S1xx 报告,而非未启用错)。
 * 零网络零 CDP:只断言路由层解析,不调任何生成方法。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "provider-disabled-"));
const cfgPath = path.join(tmpDir, "config.json");
fs.writeFileSync(cfgPath, JSON.stringify({
  defaultImageProvider: "agnes",
  enabledProviders: ["agnes", "zhipu", "flow"], // 显式启用(白名单模型;想启用哪种就配哪种)
  providers: { agnes: { apiKey: "k" } },
}, null, 2));
process.env.MEDIA_GEN_MCP_CONFIG = cfgPath;

const require_ = createRequire(import.meta.url);
const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const { config } = require_(path.join(distDir, "config.js"));
const { getProvider, resolveProvider, getFallbackProvider } = require_(path.join(distDir, "providers/registry.js"));

describe("enabledProviders 显式启用路径(配置驱动非硬代码)", () => {
  test("白名单显式列名 flow → getProvider 解析成功(requiresOptIn 仍在,点名才可达)", () => {
    assert.deepEqual(config.enabledProviders, ["agnes", "zhipu", "flow"]);
    const p = getProvider("flow");
    assert.equal(p.name, "flow");
    assert.equal(p.requiresOptIn?.("image"), true, "解禁 ≠ 默认可用:opt-in 语义保留(点名即用)");
  });
  test("解禁后 flow 模型恢复归属(abra 助记 → 自动路由到 flow)", () => {
    const r = resolveProvider(undefined, "abra_t2v_8s", "video");
    assert.equal(r.provider.name, "flow");
  });
  test("解禁后 flow 仍不进隐式 fallback(optIn 门禁独立于禁用表)", () => {
    assert.notEqual(getFallbackProvider("agnes", "image", {})?.name, "flow");
  });
  // P2-1(审查):原"自定义禁用任意渠道"用例为空转断言(typeof 检查不可能失败)已删。
  // env 形态(MEDIA_ENABLED_PROVIDERS)的进程级真测试待独立 fixture 文件(模块加载期读 env,
  // 单进程多形态不可行);行为由 config 解析优先级(config 数组 > env > 默认)的解析函数语义保证。
});
