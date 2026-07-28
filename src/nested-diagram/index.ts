/**
 * 嵌套架构图工具 —— 主入口(Phase 2:渲染核心 renderManifestLayers)。
 *
 * 端到端链路(全链路在 Phase 3 buildNestedHtml 闭环;Phase 2 落渲染核心):
 *   ManifestNode 树(producer 声明)
 *     → validateManifest(V1-V5 + 字段四态,Phase 1)
 *     → renderManifestLayers(DFS 批量 D2 render,per-node salt,本文件 Phase 2)
 *     → LayerSpec[](viewer 契约,扁平化 id→{title,svg,parent,children,viewMode})
 *     → [Phase 3] fillNestedTemplate(template-store + viewer-stack 导航)
 *     → [Phase 3] 5 契约 asserts(S_NESTED_1..5 + S2/S4/S9/S11)
 *     → 单文件自包含 HTML
 *
 * Phase 2 接口分层(对齐 interactive-html/index.ts 范式):
 *   - renderManifestLayers(manifest, opts, engine?)  渲染核心,不落盘不产 HTML,返回 LayerSpec[]
 *                                                      stub engine 注入测 salt/noXMLTag 杠杆
 *   - [Phase 3] buildNestedHtml(req, engine?)         纯函数,产 HTML,golden + 契约 test 调它
 *   - [Phase 3] renderNestedDiagram(req, engine?)     落盘 wrapper,handler 只调它
 *
 * D2Engine singleton(P0-5A §3.2):严禁 new D2Engine() 触发 22MB WASM 双加载;
 *   通过 getDiagramEngine("d2") 拿 singleton;测试用 stub engine 注入(照搬 S12 范式)。
 *
 * 三杠杆(直接复用 d2.ts:141-149,零改):
 *   - darkThemeID(darkTheme 传时,全大写 Go 反序列化大小写敏感)→ D2 SVG 内联 @media 双调色板
 *   - noXMLTag(硬编码 true)→ 去 <?xml?> 声明(HTML 内联必去)
 *   - salt(per-node = NESTED_SALT_PREFIX + id,id 已校验 ∈ [a-z0-9-])→ 多 SVG 防 ID 冲突 + 确定性
 *
 * 红线(方案 §9.3):
 *   1. D2 render 调用点与 generate_interactive_diagram 同一函数(getDiagramEngine("d2").render),无 fork
 *   2. 任一节点 D2 编译失败 → 整树拒绝(抛错,不部分渲染 —— 防"某层点进去空白"体验崩塌)
 *   3. drill 路径无任何 D2 render(Phase 3 守;display-toggle-only 不变量)
 *
 * License:P0-5B 自研(无第三方源码引用;D2 渲染工艺与 generate_interactive_diagram 同源)。
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { DiagramEngine } from "../diagram/types.js";
import { getDiagramEngine } from "../diagram/render.js";
import { escapeHtml } from "../interactive-html/fill-template.js";
import {
  assertSelfContained,
  assertNoXmlDecl,
  assertDualPalette,
  assertMotionGovernor,
  assertSizeUnder,
} from "../interactive-html/asserts.js";
import { exportPngFromSvg } from "../interactive-html/export-png.js";
import { D2_DARK_THEME_DEFAULT } from "../interactive-html/index.js";
import { validateManifest } from "./manifest-validate.js";
import {
  NESTED_ERROR_PREFIX,
  NESTED_SALT_PREFIX,
} from "./manifest-types.js";
import type { LayerSpec, Manifest, ManifestNode } from "./manifest-types.js";
import { fillNestedTemplate, NESTED_SIZE_CAP } from "./nested-template.js";
import { assertNestedIntegrity } from "./nested-asserts.js";
import { VIEWER_NESTED_JS } from "./viewer-stack.js";

// ──────────────────────────────────────────────────────────────────────────
// 请求 / 结果类型(Phase 3 buildNestedHtml / renderNestedDiagram 用)
// ──────────────────────────────────────────────────────────────────────────

/** generate_nested_diagram 工具请求(handler 注入 outDir)。 */
export interface NestedDiagramRequest {
  /** manifest 树根(producer 声明,shape 未知,validateManifest 校验)。 */
  manifest: unknown;
  /** 全局浅色主题(整树共享,01 §2.5 刻度四:theme 与结构正交)。 */
  theme?: string;
  /** 全局深色主题;renderNestedDiagram 默认 "200"(Phase 3 落)。 */
  darkTheme?: string;
  /** HTML <title> + <h1>;默认 manifest.label(Phase 3 落)。 */
  title?: string;
  /** 导根层 PNG 预览(默认 false)。 */
  previewPng?: boolean;
  /** 文件名(不含扩展名)。 */
  name?: string;
  /** 落盘目录(handler resolveOutDir 注入)。 */
  outDir?: string;
}

/** 渲染选项(renderManifestLayers 入参,与落盘/文件名解耦)。 */
export interface RenderLayersOptions {
  theme?: string;
  darkTheme?: string;
}

/** renderManifestLayers 结果(Phase 3 buildNestedHtml 消费)。 */
export interface RenderedLayers {
  /** DFS 序 LayerSpec[](byte-identical JSON 顺序基础)。 */
  layers: LayerSpec[];
  /** 根节点 id(viewer 初始显示 + URL hash 起点)。 */
  rootId: string;
  /** 是否双主题烤进(darkTheme 传且非空白时 true)。 */
  hasDarkLightDualPalette: boolean;
}

// ──────────────────────────────────────────────────────────────────────────
// 渲染核心(Phase 2)
// ──────────────────────────────────────────────────────────────────────────

/**
 * 渲染 manifest 树 → LayerSpec[](纯渲染核心,不落盘不产 HTML)。
 *
 * 步骤:
 *   1. validateManifest(manifest) → 归一化 Manifest(V1-V5 + 字段四态,Phase 1)
 *   2. DFS 遍历,每个 diagram !== "" 的节点调 d2Engine.render(per-node salt + noXMLTag:true)
 *   3. 收集 LayerSpec[](id / escapeHtml(label) / svg / parent / children ids / viewMode)
 *
 * 不变量:
 *   - DFS 顺序确定性 → layers 数组顺序稳定 → byte-identical HTML(Phase 3)
 *   - 任一节点 D2 编译失败 → 整树拒绝(throw 传播,partial layers 丢弃,方案 §3.4 失败行为)
 *   - diagram === "" 的分组容器节点:svg="",viewMode="container-list",**不调 D2 render**(省 WASM IPC)
 *   - title = escapeHtml(label):信任边界 blocking B-1 落地(viewer 直接 innerHTML 安全)
 *
 * @param manifest  未知 shape 的 manifest(JSON.parse / MCP args / 测试构造)
 * @param opts      渲染选项(theme/darkTheme 整树共享)
 * @param engine    可选 DiagramEngine(stub 注入,测试用);省略 → getDiagramEngine("d2") singleton
 * @returns         { layers, rootId, hasDarkLightDualPalette }
 * @throws          Error("[nested-diagram] ...") 校验错;D2 render 错原样传播(Phase 4 handler 归一化)
 */
export async function renderManifestLayers(
  manifest: unknown,
  opts: RenderLayersOptions,
  engine?: DiagramEngine,
): Promise<RenderedLayers> {
  // 1. 校验(写前先校验,03 §1.2 项 3;任一违例整树拒绝)
  const validated: Manifest = validateManifest(manifest);

  // 2. D2 engine singleton(严禁 new;测试用 stub 注入)
  // nit 审查:engine 类型 DiagramEngine 比契约(D2 专属)宽 —— 入口守卫防非 d2 引擎静默接受(类型签名撒谎)
  if (engine && engine.name !== "d2") {
    throw new Error(
      `${NESTED_ERROR_PREFIX} E_ENGINE: engine must be d2, got ${engine.name}`,
    );
  }
  const d2Engine = engine ?? getDiagramEngine("d2");
  if (!d2Engine) {
    throw new Error(`${NESTED_ERROR_PREFIX} E_ENGINE: D2 engine unavailable`);
  }
  if (!d2Engine.isAvailable()) {
    throw new Error(`${NESTED_ERROR_PREFIX} E_ENGINE: D2 engine not available`);
  }

  // F12 对齐:darkTheme 空白串等价"未提供"(与 interactive-html/index.ts:124 + d2.ts resolveD2Theme 一致)
  const hasDark =
    opts.darkTheme != null && opts.darkTheme.trim() !== "";

  // 3. DFS 遍历 + 渲染 + 收集 LayerSpec(闭包捕获 d2Engine/opts/layers,visit 只带 node/parentId)
  const layers: LayerSpec[] = [];
  const visit = async (node: ManifestNode, parentId: string | null): Promise<void> => {
    const children = node.children ?? []; // 解构一次(nit:原本 ?? [] 重复计算)
    const isContainer = node.diagram === "";
    const viewMode: LayerSpec["viewMode"] = isContainer
      ? "container-list"
      : "diagram";

    // 容器节点不渲染(svg="");非容器节点 per-node salt 调 D2
    let svg = "";
    if (!isContainer) {
      const rendered = await d2Engine.render({
        code: node.diagram,
        engine: "d2",
        format: "svg",
        theme: opts.theme,
        darkTheme: opts.darkTheme,
        noXMLTag: true, // C2:HTML 内联必去 <?xml?>
        salt: NESTED_SALT_PREFIX + node.id, // C3:per-node 确定性 salt(blocking B-3)
      });
      svg = rendered.svg;
    }

    layers.push({
      id: node.id,
      title: escapeHtml(node.label), // blocking B-1:viewer 侧强制 escape(信任边界)
      svg,
      parent: parentId,
      children: children.map((c) => c.id),
      viewMode,
    });

    // DFS 递归(顺序确定性:await 串行,非 Promise.all 并发 —— 保 D2 chain 顺序 + layers DFS 先序)
    for (const child of children) {
      await visit(child, node.id);
    }
  };
  await visit(validated, null);

  return { layers, rootId: validated.id, hasDarkLightDualPalette: hasDark };
}

// ──────────────────────────────────────────────────────────────────────────
// buildNestedHtml / renderNestedDiagram(Phase 3:HTML 装配 + 落盘)
// ──────────────────────────────────────────────────────────────────────────

/** buildNestedHtml 结果(纯函数,不落盘)。golden + 契约 test 调它。 */
export interface NestedDiagramBuildResult {
  /** 完整自包含 HTML 字符串。 */
  html: string;
  /** HTML byte 长度(NESTED_SIZE_CAP 校验)。 */
  bytes: number;
  /** 是否双主题烤进(darkTheme 传且非空白时 true)。 */
  hasDarkLightDualPalette: boolean;
  /** 实际渲染 SVG 数(diagram !== "" 的节点数;不含 container-list 分组容器)。 */
  layerCount: number;
  /** root 层 SVG(PNG 预览用;类比 InteractiveDiagramBuildResult.svg)。 */
  rootSvg: string;
}

/** renderNestedDiagram 结果(落盘 wrapper)。handler 只调它。 */
export interface NestedDiagramResult extends NestedDiagramBuildResult {
  /** HTML 落盘绝对路径。 */
  localPath: string;
  /** PNG 预览绝对路径(previewPng=true 时存在)。 */
  previewPngPath?: string;
}

/**
 * 防御性从 unvalidated manifest 提取 root label(HTML <title> 默认值)。
 * 不做完整校验(那在 renderManifestLayers 内);若 manifest 非法则 renderManifestLayers 抛错,
 * 此处返回值未被使用。纯提取,无副作用。
 */
function extractRootLabel(manifest: unknown): string | undefined {
  if (typeof manifest !== "object" || manifest === null) return undefined;
  const m = manifest as Record<string, unknown>;
  const label = m.label;
  return typeof label === "string" && label.trim() ? label : undefined;
}

/**
 * 构建 nested HTML(纯函数,不落盘)。golden pipeline 与契约 test 调它。
 *
 * 链路:renderManifestLayers(Phase 2,validate + 批量 D2 → LayerSpec[])
 *      → fillNestedTemplate(template-store HTML + viewer-stack 导航)
 *      → 契约 asserts(复用 S2/S4/S9/S11 + NESTED_SIZE_CAP;Phase 4 加 S_NESTED_1..5)
 *
 * @param req     请求(manifest 必填)
 * @param engine  可选 DiagramEngine(stub 注入,测试用);省略 → getDiagramEngine("d2")
 */
export async function buildNestedHtml(
  req: NestedDiagramRequest,
  engine?: DiagramEngine,
): Promise<NestedDiagramBuildResult> {
  if (req.manifest == null) {
    throw new Error(`${NESTED_ERROR_PREFIX} \`manifest\` is required`);
  }

  // 1. 渲染核心(Phase 2:validate + DFS 批量 D2 → LayerSpec[])
  const rendered = await renderManifestLayers(
    req.manifest,
    { theme: req.theme, darkTheme: req.darkTheme },
    engine,
  );

  // 2. root SVG(stage 内联,README 兜底)
  // 注:兜底仅适用 diagram 根(rootSvg 非空);若根是 container(diagram="",已校验必有 children
  // 故 rootSvg=""),剥 <script> 环境只见空 stage —— 需 JS 跑起才见 container-list 卡片(可接受边界)。
  const rootLayer = rendered.layers.find((l) => l.id === rendered.rootId);
  if (!rootLayer) {
    // 不应发生(rootId 来自 validated manifest,必在 layers 中)—— 防御性契约错
    throw new Error(`${NESTED_ERROR_PREFIX} S_NESTED_1: root layer missing from rendered layers`);
  }
  const rootSvg = rootLayer.svg;

  // 3. 装配 HTML(title 默认 = root label)
  const title = req.title ?? extractRootLabel(req.manifest) ?? "Nested Architecture";
  const html = fillNestedTemplate({
    title,
    rootSvg,
    rootId: rendered.rootId,
    layers: rendered.layers,
    viewerJs: VIEWER_NESTED_JS,
  });

  // 4. 契约 asserts(复用 interactive-html asserts + 嵌套尺寸 cap + S_NESTED_1..5 嵌套专属结构)
  assertSelfContained(html); // S2:无外链 <script src=
  assertNoXmlDecl(html); // S11:无 <?xml?(C2 防线)
  if (rendered.hasDarkLightDualPalette) assertDualPalette(html); // S4:darkTheme 传时双调色板
  assertMotionGovernor(html); // S9:prefers-reduced-motion + data-motion=still
  assertSizeUnder(html, NESTED_SIZE_CAP); // S6_nested:≤ 1MB
  assertNestedIntegrity(html, rendered.layers, rendered.rootId); // S_NESTED_1..5:store/stage/root svg 完整

  return {
    html,
    bytes: Buffer.byteLength(html, "utf-8"),
    hasDarkLightDualPalette: rendered.hasDarkLightDualPalette,
    layerCount: rendered.layers.filter((l) => l.viewMode === "diagram").length,
    rootSvg,
  };
}

/**
 * 构建 nested HTML + 落盘 + 可选 PNG(handler 调它)。
 *
 * @param req     请求(manifest 必填,outDir 必填)
 * @param engine  可选 DiagramEngine(stub 注入,测试用)
 */
export async function renderNestedDiagram(
  req: NestedDiagramRequest,
  engine?: DiagramEngine,
): Promise<NestedDiagramResult> {
  // darkTheme 缺省 D2_DARK_THEME_DEFAULT("200") —— 让 GitHub README 自动跟随系统主题开箱即反色。
  // ?? 只拦 undefined(omitted);显式 "" / 空白串仍走 buildNestedHtml 的 F12 单调色板分支。
  const reqWithDefault: NestedDiagramRequest = {
    ...req,
    darkTheme: req.darkTheme ?? D2_DARK_THEME_DEFAULT,
  };
  const built = await buildNestedHtml(reqWithDefault, engine);

  // 落盘(HTML 非 raster/vector format,直写不经 writeLocalRender;对齐 interactive-html)
  const outDir = req.outDir;
  if (!outDir) {
    throw new Error(`${NESTED_ERROR_PREFIX} \`outDir\` is required (handler resolves it via resolveOutDir)`);
  }
  const safeName = path.basename(req.name ?? `nested_${Date.now().toString(36)}`); // BL-04: sanitize
  await fs.mkdir(outDir, { recursive: true });
  const localPath = path.join(outDir, safeName + ".html");
  await fs.writeFile(localPath, built.html, "utf-8");

  // 可选 root 层 PNG 预览
  let previewPngPath: string | undefined;
  if (req.previewPng) {
    previewPngPath = await exportPngFromSvg(built.rootSvg, outDir, safeName);
  }

  return {
    ...built,
    localPath,
    ...(previewPngPath ? { previewPngPath } : {}),
  };
}
