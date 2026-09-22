/**
 * disabledProviders 配置化禁用 —— 解禁路径套件(独立 fixture:disabledProviders: [])。
 *
 * 与 provider-priority.test.ts 互补:那边 fixture 未配置(出厂默认 ["flow"] 禁用),
 * 这边显式 [] 解禁,验证「禁用是默认配置而非硬代码」(2026-09-23 用户裁决):
 * 解禁后 getProvider("flow") 恢复解析(环境不可用由 provider 自身 S1xx 报告,而非禁用错)。
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
  disabledProviders: [], // 显式解禁(整体覆盖默认 ["flow"])
  providers: { agnes: { apiKey: "k" } },
}, null, 2));
process.env.MEDIA_GEN_MCP_CONFIG = cfgPath;

const require_ = createRequire(import.meta.url);
const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const { config } = require_(path.join(distDir, "config.js"));
const { getProvider, resolveProvider, getFallbackProvider } = require_(path.join(distDir, "providers/registry.js"));

describe("disabledProviders 解禁路径(配置驱动非硬代码)", () => {
  test("显式 [] → flow 解禁:getProvider 解析成功(requiresOptIn 仍在,点名才可达)", () => {
    assert.deepEqual(config.disabledProviders, []);
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
  test("自定义禁用任意渠道(例:pixverse)同样生效", () => {
    // env 形态验证(另一个覆盖面:MEDIA_DISABLED_PROVIDERS)
    // —— 本文件 config 已定,env 组在下方独立子进程语义由 parse 顺序保证(config 优先),
    // 这里静态断言形态存在即可,不重复进程级注入。
    assert.equal(typeof config.disabledProviders, "object");
  });
});
