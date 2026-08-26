# P0-2 实施规划:LLM 友好错误契约(handler 层引擎 stderr 归一化)

> **P0 ID**:`P0-2`
> **生成日期**:2026-07-21
> **目标仓库**:`/Users/wangdong/Documents/Project/Agnes AI接入/media-gen-mcp`
> **上游依据**:`doc_v11/Archify深度分析与借鉴报告.md` §三 P0-2 + §四 P0-2 详解(行 83-87, 230-263)
> **调查依据**:`inv:p02-mg-errors`(本仓 src/index.ts、src/diagram/{d2,graphviz}.ts、src/chart.ts、src/render-svg.ts 实地核实 + 本机 node v24 实跑引擎 stderr 抓取)
> **范围立场**:本 P0 只做 **handler 层错误归一化**——把引擎透传的裸 stderr 在抛回调用方之前,经 `normalizeEngineError` 改写成 `{engine, line, offendingConstruct, message, remediation}` 的 LLM 友好文本。**不改引擎行为**(除 1 处耦合前置修复,见 §4.1)、**不动 19 工具签名**、**不破 `check-schema.mjs`**、**全部 reimplement(零 Archify 代码引用)**。

---

## 1. 背景与目标

### 1.1 解决什么盲区

media-gen-mcp 的错误消费方是 **LLM(Claude)**,不是人。LLM 拿到一句裸引擎 stderr 既不知道改哪段、也不知道改成什么,经常需要 3-5 轮试错才修对一条 D2/Vega-Lite 输入。调查 `inv:p02-mg-errors` 实测确认 4 类引擎的 stderr 现状都不适合 LLM 直接消费:

| 引擎 | 当前 stderr 形态(实测) | LLM 不可读点 |
|---|---|---|
| **D2**(`@terrastruct/d2@0.1.33`) | `[{"range":"index,1:22:29-1:25:32","errmsg":"index:2:23: expected \"stroke-width\" to be a number between 0 and 15"}]` | **JSON 数组 dump**,人都不好读,LLM 要先解析才知道错在哪 |
| **Graphviz**(`@viz-js/viz@3.28.0`) | 🔴 **`graphviz engine produced no SVG`**(真实错 `syntax error in line 1 near '}'` 被 `src/diagram/graphviz.ts:60-68` 丢弃) | 信息完全丢失,LLM 只能猜 |
| **Vega-Lite**(`vega-lite@5.22.0`) | `Vega-Lite spec error: Invalid field type "undefined"` | 缺"哪个字段、合法值是什么、怎么改"三件套 |
| **resvg**(`@resvg/resvg-js@2.6.2`) | `SVG data parsing failed cause the document does not have a root node` | 同一条消息覆盖 3 种不同失败(非数字坐标/未知元素/负宽度),且对含 `<svg>` 根但缺 `xmlns` 的输入**误报**"无根节点" |

现有 HINT 机制(`enhanceD2Error` 9 条 regex、Vega-Lite 2 条 regex、Graphviz 1 条)是雏形但覆盖不全——调查实测至少漏 6 类真实错误(D2 的 `fill must be style.fill` / `shadow must be style.shadow` / `connection missing destination`;Vega 的 `Invalid field type "undefined"`;Graphviz 全部 4 类语法错因 bug 丢弃;resvg 的"document does not have a root node"误导)。

### 1.2 成功标准(Definition of Done 的量化锚)

1. **契约三件套**:D2 / Graphviz / Vega-Lite / resvg 四引擎的每一种已知错误,经 handler 归一化后,返回文本**必含** ① 定位(path/line/offending construct)、② 问题陈述、③ 修复动词(祈使)。缺任一件视为不达标。
2. **offending 片段回显**:D2 / Graphviz 错误必须回显出错行原文(前缀 `offending: `),Vega-Lite 必须指出出错的 encoding channel / mark 字段,resvg 必须回显 SVG 前 80 字符。
3. **Graphviz bug 修复**:`digraph G { A -> }` 输入返回的 stderr 必须含 `syntax error in line 1 near '}'`(而非 `produced no SVG`)。
4. **向后兼容零感知**:合法调用路径的返回字节不变;`err()` helper 签名不变;19 工具 inputSchema 不变;`check-schema.mjs` 仍 pass;错误仍是 `{content:[{text}], isError:true}` 单字段协议。
5. **覆盖基线**:`knownErrorPatterns` 表首版至少 14 条(D2 ×6 / Graphviz ×3 / Vega-Lite ×3 / resvg ×2),全部带调查实测的真实 stderr 样本作为回归黄金。

---

## 2. 现状(带文件:行号证据)

### 2.1 错误抛给调用方的 3 种模式(全在 `src/index.ts` 1373 行内,**无 `src/handlers/` 目录**)

| 模式 | 代码位置 | 行为 |
|---|---|---|
| **预检 `return err(msg)`** | `src/index.ts:636-637, 639-641, 643-645, 1117-1120` 等 | 不抛,直接返回 `isError:true` |
| **包装后 throw** | `src/diagram/d2.ts:132`(`enhanceD2Error`)、`src/diagram/graphviz.ts:64`(`enhanceGraphvizError`)、`src/chart.ts:101, 116`(`Vega-Lite spec error: ...`) | throw 被顶层 try/catch 捕获 |
| **provider 透传** | `src/index.ts:570, 595, 695, 721-725, 821-828` | 非 fallback-worthy 的 provider 错误原样上抛 |

### 2.2 错误出口(唯一两个)

`src/index.ts:1366-1371`:
```ts
function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function err(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}
```
**无结构化字段**(无 code/path/threshold/severity)、无 exit code 区分、无 cause 链。

### 2.3 顶层兜底

`src/index.ts:1316-1318`:
```ts
} catch (e: unknown) {
  return err(e instanceof Error ? e.message : String(e));
}
```
所有 handler 抛的 Error 在此转成 `err(message)`。**这是 P0-2 的唯一收口点**——无论在 handler 层怎么归一化,最终都经这里变成 `isError:true` 文本。

### 2.4 四引擎实测 stderr 缺陷清单(调查 `inv:p02-mg-errors` 抓取)

**D2**(`src/diagram/d2.ts:75-90` `enhanceD2Error` 9 条 regex):
| 触发输入 | 底层 errmsg | 现有 HINT 覆盖 |
|---|---|---|
| `style.stroke-width: 1.5` | `expected "stroke-width" to be a number between 0 and 15` | ✅ 匹配 `/number between/i` |
| `a: { fill: #ff0000 }` | `missing value after colon` + `maps must be terminated with }` | ✅ 匹配两条 |
| `a: { shape: oval; fill: red }`(同行分号) | `fill must be style.fill` | ❌ **regex 漏**(`/reserved|keyword|cannot be (used|redefined)|redefinition/i` 不匹配 `must be style.X`) |
| `shadow: { fill: red }`(保留字当 shape) | `shadow must be style.shadow` | ❌ **同上,漏** |
| `a -> b ->`(悬空箭头) | `connection missing destination` | ❌ regex 漏 |

**Graphviz**(`src/diagram/graphviz.ts:60-68`):
```ts
try {
  const result = viz.render(req.code, { format: "svg" });
  svg = result.output ?? "";
} catch (e: any) {
  throw new Error(enhanceGraphvizError(`Graphviz (DOT) render failed: ${e?.message ?? String(e)}`));
}
if (!svg || !/<(svg|html|g|path)/.test(svg)) {
  throw new Error("graphviz engine produced no SVG");
}
```
**viz-js v3 语法错不抛错,返回 `{output: undefined, errors: [...]}`**——catch 路径永不触发,`enhanceGraphvizError` 是死代码。实测:

| 输入 | viz-js `result.errors[0].message`(被丢) | 用户实际看到 |
|---|---|---|
| `digraph G { A -> }` | `syntax error in line 1 near '}'` | `graphviz engine produced no SVG` |
| `digraph G { A -> B\n  [label="x"` | `syntax error in line 2` | `graphviz engine produced no SVG` |
| `this is not dot at all` | `syntax error in line 1 near 'this'` | `graphviz engine produced no SVG` |
| `graph G { A -- B; C -> D }`(无向图用 ->) | `syntax error in line 1 near '->'` | `graphviz engine produced no SVG` |

**Vega-Lite**(`src/chart.ts:80-85, 96-102, 112-119`):
- 预编译守卫(`mark:"pie"` → 具体代码模板、mark 对象缺 `type` → 示例)是**优秀范例**,与 Archify 错误契约同形,P0-2 保留不改。
- 编译后错误包装为 `Vega-Lite spec error: <原 msg>` + 可选 `HINT:`。
- 实测 HINT 漏:`{ encoding: { theta: { field:"a", type:"quant" } } }`(type 应是 `quantitative` 缩写但不接受 `quant`)→ 底层把 `"quant"` 静默转 `undefined` → 报 `Invalid field type "undefined"`,HINT regex(`/gradient|length/i`、`/signal|Unrecognized/i`)**均不触发**。

**resvg**(入口 `src/render-svg.ts:201` + 3 处复用 `src/diagram/d2.ts:146-151`、`src/diagram/graphviz.ts:71-78`、`src/chart.ts:108-109`):
- `render-svg.ts:206-207` 有前置 `startsWith("<")` 守卫(好),其余错误原样抛。
- 实测同一条 `SVG data parsing failed cause the document does not have a root node` 覆盖 3 种不同失败(非数字坐标 `<rect x='abc'/>`、未知元素 `<unknownElement/>`、负宽 `<rect width='-50'/>`)。
- 含 `<svg>` 根但缺 `xmlns="http://www.w3.org/2000/svg"` 的输入也误报"无根节点"——信息误导。
- `<svg xmlns='...'><rect filter='url(#missing)'/></svg>`(缺 filter 引用)→ **静默成功渲染无告警**(超出 P0-2 范围,记入 open_points)。

---

## 3. Archify 是怎么做的(带证据)+ 借鉴边界

### 3.1 Archify 错误契约(来源:`tt-a1i/archify` main,经 `mcp__zread__read_file` 全文读出)

**契约三件套 + 一个可选**(每个错误消息必含前三件):
1. **Path/ID** — 如 `"router"`、`/nodes/3 (id/label: "router")`(后者由 `shared/validator.mjs` 的 `annotatePath()` 把 ajv `instancePath` 改写)。
2. **阈值**(数字 + 单位)— 如 `~80px`、`(${c.width}px)`、`less than 8px`、`minimum 24px`、`viewBox width 700 clips the 640px lanes`。
3. **修复动词**(祈使)— 如 `shorten the label`、`move one to another col`、`adjust labelDx/labelDy/labelSegment`、`widen size`。
4. (可选)**Suggested fix** — 来自 `shared/geometry.mjs` 的 `suggestComponentSeparation`: `Suggested fix: move "cache" pos to [168, 80] (right of "api") or [40, 148] (below)`。

真实错误消息样例(可直接抄风格):
- `Label "An Extremely Long Component Label Overflow" (~165px) is wider than component "api" (120px) — shorten the label, move detail to sublabel, or widen size.`
- `Components "api" and "cache" are less than 8px apart — move one or shrink its size.\nSuggested fix: move "cache" pos to [168, 80] (right of "api") or [40, 148] (below)`
- `Connection "api->db" is too short (15px; minimum 24px) — place its components farther apart.`

外层封装:`throw new Error(\`${type} layout validation failed:\\n- ${problems.join('\\n- ')}\`)`(多错聚合)。

### 3.2 测试如何把契约锁死(`test/layout-rules.test.mjs`)

- **手段 1**:每条 mutation 锁多个期望子串 + `assert.notEqual(code, 0)`(行 81-130)。
- **手段 2(反崩溃契约)**:`assert.doesNotMatch(stderr, /TypeError|is not a function|Cannot read/, 'crashed instead of reporting')`(行 166)——渲染器绝不允许原生异常穿透。
- **手段 3(元契约)**:`test('contract: short-edge message carries both the px minimum and a fix verb', ...)`(行 175-181)——确保每条 layout 错都同时带数值阈值。
- **手段 4(ajv 路径 annotation)**:schema 错必须带 `(id/label: ...)` 标注(行 186-192)。

### 3.3 可借鉴 / 不借鉴的边界(立场红线检查)

| 项 | 决策 | 理由 |
|---|---|---|
| **错误契约三件套(path + 阈值 + 修复动词)** | ✅ **借鉴** | 纯范式,消费方是 LLM 这一判断对 media-gen-mcp 同样成立 |
| **反崩溃 regex 契约**(`TypeError/Cannot read` 禁穿透) | ✅ **借鉴** | 纯范式,零代码 |
| **`annotatePath` 把 `/nodes/3/label` 改写为具名元素** | ✅ **思路借鉴**(reimplement) | Vega-Lite 编译错无此 annotation,可手工补:"encoding.theta.type" 而非裸 path |
| **`Suggested fix: <具体坐标>`** | ❌ **不借鉴**(本 P0 范围外) | 需要 geometry 推导(Archify `shared/geometry.mjs` 670 行),media-gen-mcp 的 D2/Graphviz/Vega-Lite 错误是**语法错**而非**布局冲突**,不存在坐标建议空间 |
| **多错聚合(`${type} validation failed:\\n- ${problems.join('\\n- ')}`)** | ⚠️ **条件借鉴** | D2 一次编译可能抛多个 errmsg(JSON 数组多条),适合聚合;Graphviz/Vega 单错为主,不聚合 |
| **Archify 任何代码** | ❌ **不抄**(license 未明) | 全部 reimplement,立场红线。所有正则/模板自写 |
| **`Suggested fix` 的 `shared/geometry.mjs` 公式** | ❌ **不抄** | license 未明 + 本 P0 不涉及坐标建议 |

---

## 4. 详细实施方案

### 4.1 耦合前置修复(必须先做,否则 handler 层无东西可归一化)

**🔴 Graphviz 错误丢弃 bug** — `src/diagram/graphviz.ts:60-68`

当前代码的 catch 路径是死代码,真实错误被 `result.errors` 丢弃。修复(2 行改动):

```ts
// src/diagram/graphviz.ts:60-68 改为:
let result;
try {
  result = viz.render(req.code, { format: "svg" });
} catch (e: any) {
  // viz-js 严重内部错(极罕见)才走这里
  throw new Error(enhanceGraphvizError(`Graphviz (DOT) render failed: ${e?.message ?? String(e)}`));
}
const svg = result.output ?? "";
// 🔧 新增:viz-js v3 语法错不抛错返 errors 数组,必须显式读取并拼接
const ge = result.errors?.length
  ? result.errors.map((er: any, i: number) => `[${i + 1}] ${er.message ?? String(er)}`).join(" ")
  : "";
if (!svg || !/<(svg|html|g|path)/.test(svg)) {
  throw new Error(
    ge
      ? `graphviz engine rejected the DOT input: ${ge}`
      : "graphviz engine produced no SVG (no error reported by viz-js — check DOT syntax)"
  );
}
```

> **注意**:此修复**改变现有错误消息文本**(从 `produced no SVG` → `rejected the DOT input: syntax error in line 1 near '}'`)。这**不是破坏向后兼容**——原文本对 LLM 完全无信息量,等同于 bug;新文本是契约要求的最低线。`check-schema.mjs` 不锁错误文本,不受影响。

> **open_question**:此 catch 块是否是有意丢弃 `result.errors`(例如担心 viz-js errors 数组格式版本不稳定)?调查结论:更像遗漏(代码注释完全没提 `result.errors`)。本规划按"遗漏"处理,但维护者需 git blame `src/diagram/graphviz.ts:60-68` 确认(见 §9)。

### 4.2 新建文件:`src/handlers/error-format.ts`(同时创建 `src/handlers/` 目录)

> 命名对齐上游报告 §四 P0-2(`src/handlers/error-format.ts` 导出 `normalizeEngineError` + `knownErrorPatterns`)。调查 `inv:p02-mg-errors` 提议的 `src/handlers/error-rewrite.ts` / `rewriteEngineError` 是同一概念的别名,本规划采上游命名。

#### 4.2.1 类型与接口签名(TS)

```ts
// src/handlers/error-format.ts

/** P0-2 支持的引擎枚举(与 knownErrorPatterns 的 key 一一对应)。 */
export type NormalizedEngine =
  | "d2"
  | "graphviz"
  | "vega-lite"  // Vega-Lite compile/render 错
  | "resvg";     // SVG → PNG 栅格化错(含 D2/Graphviz/Vega 的 PNG 复用路径)

/**
 * 归一化后的 LLM 友好错误对象。
 * Archify 契约三件套(path + 阈值 + 修复动词)落到字段:
 *   - path / line / offendingConstruct → 定位
 *   - message(含阈值) → 问题陈述
 *   - remediation → 修复动词(祈使)
 */
export interface NormalizedError {
  engine: NormalizedEngine;
  /** 出错行号(1-based)。D2/Graphviz 有行概念;Vega-Lite/resvg 多为 undefined。 */
  line?: number;
  /**
   * 出错构造的回显片段(降低 LLM 定位成本)。
   * - D2/Graphviz:出错行原文(截断到 120 字符,前缀不加,调用方自加 `offending: `)。
   * - Vega-Lite:出错的 encoding channel 或 mark 字段路径(如 `encoding.theta.type`)。
   * - resvg:SVG 前 80 字符。
   */
  offendingConstruct?: string;
  /** 问题陈述(必含阈值数字,如 "stroke-width 仅接受整数(0–15)")。 */
  message: string;
  /** 修复动词(祈使,如 "把 stroke-width 改为 0–15 之间的整数")。 */
  remediation: string;
}

/** knownErrorPatterns 表的单条结构。 */
export interface KnownErrorPattern {
  /** 匹配底层 engine 抛的原 msg(经 JSON-parse 后的 errmsg 字段,或裸字符串)。 */
  rx: RegExp;
  /** 匹配时从 regex 捕获组生成的归一化错误(捕获组以 m 数组传入)。 */
  make: (m: RegExpExecArray, ctx: ErrorContext) => Omit<NormalizedError, "engine">;
}

/** 归一化时的上下文(让 make 函数能回显 offending 片段)。 */
export interface ErrorContext {
  /** 原始输入(D2/Graphviz 的 DSL 源码、Vega-Lite 的 spec 对象、resvg 的 SVG 字符串)。 */
  input: string | Record<string, unknown>;
  /** 原始 raw message(未解析前的 e.message,调试用)。 */
  raw: string;
}

/**
 * 主入口:把 engine 抛的 raw message 解析成 LLM 友好文本。
 *
 * @param engine 引擎名(决定走哪张 patterns 表)
 * @param rawMsg engine 抛的 e.message(D2 是 JSON 数组字符串、Graphviz 是 `syntax error...`、
 *             Vega 是 `Invalid field type...`、resvg 是 `SVG data parsing failed...`)
 * @param ctx 上下文(回显 offending 片段用)
 * @param engineHint 可选引擎来源标记(结构性信号,优先于 `engine` 参数路由)。
 *                   用于三处 PNG 复用路径(`d2.ts:146-151`、`graphviz.ts:71-78`、`chart.ts:108-109`)
 *                   抛出的 resvg 错误——外层 handler 捕获时 `engine` 是 "d2"/"graphviz"/"vega-lite",
 *                   但物理来源是 resvg。此时传 `engineHint: "resvg"`(或识别 `[resvg]` 前缀),
 *                   跳过 d2/graphviz/vega-lite patterns 表,直接走 resvg patterns 表。
 *                   详见 §4.3.4 升级方案与 §9 open_point #11。
 * @returns 单行可读字符串(失败兜底返回 rawMsg 原样,绝不抛)
 *
 * 实现要点:
 * 1. **优先看 engineHint**:若 hint 存在,直接走 `knownErrorPatterns[engineHint]`(跳过 engine 参数);
 *    否则按 engine 参数走对应 patterns 表。这是结构性信号,100% 可靠(替代旧版内容猜测路由)。
 * 2. D2 路径先 try JSON.parse(rawMsg),若是数组则遍历每条 {errmsg, range},取首条匹配;
 *    JSON 解析失败则按裸字符串匹配。
 * 3. Graphviz / Vega-Lite / resvg 直接对裸字符串走 patterns 表。
 * 4. 表里所有 pattern 都不匹配 → 返回 `[engine] <rawMsg>(未识别的错误形态,请把此消息反馈给维护者补 knownErrorPatterns)`。
 *    不抛、不崩,保证 Archify 反崩溃契约。
 */
export function normalizeEngineError(
  engine: NormalizedEngine,
  rawMsg: string,
  ctx: ErrorContext,
  engineHint?: NormalizedEngine,
): string;

/** 供测试与渐近积累用:返回是否命中已知 pattern(未命中时可写日志)。 */
export function __didMatchLastKnownPattern(): boolean;
```

#### 4.2.2 `knownErrorPatterns` 表骨架(首版 14 条,全部带调查实测的真实 stderr 样本)

```ts
export const knownErrorPatterns: Record<NormalizedEngine, KnownErrorPattern[]> = {
  // ───────────────────────── D2(6 条)─────────────────────────
  // D2 底层 e.message 是 JSON 数组字符串,normalizeEngineError 内部先 try JSON.parse,
  // 取每条 entry.errmsg 走 patterns(下方 rx 都匹配 errmsg 字段,不含外层 JSON 壳)。
  d2: [
    {
      // 实测样本 errmsg: index:2:23: expected "stroke-width" to be a number between 0 and 15
      rx: /expected "(\w+)" to be a number between (\d+) and (\d+)/,
      make: (m, ctx) => {
        const [_, prop, lo, hi] = m;
        const line = pickD2Line(ctx.raw); // 从 JSON entry.range 解析行号
        return {
          line,
          offendingConstruct: pickD2Offending(ctx.input as string, line),
          message: `D2 属性 "${prop}" 仅接受整数,合法范围 ${lo}–${hi}。`,
          remediation: `把 ${prop} 改为 ${lo}–${hi} 之间的整数(如 ${prop}:2 ✅ / ${prop}:1.5 ❌,小数非法)。`,
        };
      },
    },
    {
      // 实测样本 errmsg: missing value after colon(由 `fill: #ff0000` 未加引号触发)
      rx: /missing value after colon/,
      make: (_m, ctx) => ({
        offendingConstruct: pickLineContaining(ctx.input as string, /#\h{3,}/i),
        message: "值以 `#` 开头被 D2 当作注释起始符吞掉,导致冒号后无值。",
        remediation:
          'D2 的 `#` 是注释符。若值以 # 开头(如 hex 色号)必须加引号:style.fill: "#ff0000" ✅。具名色 red 不需引号。',
      }),
    },
    {
      // 实测样本 errmsg: fill must be style.fill(现 enhanceD2Error regex 漏)
      // 触发输入: a: { shape: oval; fill: red }  (D2 要求属性单独一行,同行多属性把 fill 当 shape 名)
      //
      // ✅ 实测全量覆盖(@terrastruct/d2@0.1.33,node v24.12.0,17 个 style 关键字逐一验证):
      //   - 无连字符 10 个:fill/stroke/shadow/bold/italic/underline/opacity/filled/multiple/3d
      //   - 含连字符 7 个:font-size/font-color/stroke-width/stroke-dash/border-radius/text-transform/double-border
      //   全部触发同一模板 `index:N:N: <KW> must be style.<KW>`,仅 KW 与 range 不同;无任何关键字换形态。
      // ⚠️ rx 用 `[\w-]+` 而非 `\w+`:JS 的 `\w` 等价 `[A-Za-z0-9_]` **不含 `-`**。
      //    原 `\w+` 漏 7 个含连字符关键字(font-size/font-color/stroke-width/stroke-dash/
      //    border-radius/text-transform/double-border),文档样本里恰好没含连字符的,
      //    样本驱动写出来的 rx 把这个 case 藏掉了。详见 §9 open_point #13(gap-fill #4)。
      rx: /([\w-]+) must be style\.\1/,
      make: (m, _ctx) => {
        const [_, kw] = m;
        return {
          message: `"${kw}" 是 D2 保留样式关键字,被误用作属性名(常见于同一行写多个属性)。`,
          remediation: `两步修复:① map 块内每个属性单独一行(分号分隔无效);② 若确实要设该样式,改用 style.${kw}: <value>。`,
        };
      },
    },
    {
      // 实测样本 errmsg: maps must be terminated with }
      rx: /maps must be terminated with \}/,
      make: (_m, ctx) => ({
        message: "D2 map 块 `{ }` 未正确闭合,或块内同一行写了多个属性。",
        remediation:
          "检查:① 每个 `{` 都有匹配的 `}`;② map 内每个属性单独一行(空格或分号分隔多属性会触发此错)。",
        offendingConstruct: pickUnbalancedBrace(ctx.input as string),
      }),
    },
    {
      // 实测样本 errmsg: connection missing destination(触发: a -> b ->)
      rx: /connection missing destination/,
      make: (_m, ctx) => ({
        offendingConstruct: pickLineContaining(ctx.input as string, /->\s*$/),
        message: "连接箭头缺目标节点。",
        remediation: "每条 `->` 后必须有目标节点(如 `a -> b`,不要 `a ->` 或 `a -> b ->` 结尾悬空)。",
      }),
    },
    {
      // 实测样本 errmsg: one of expected: ..., ..., ...(枚举非法)
      rx: /one of[^:]*:\s*(.+)/,
      make: (m, _ctx) => ({
        message: `非法枚举值。该字段合法取值为:${m[1].trim()}`,
        remediation: `从上述清单中选一个替换当前值。`,
      }),
    },
  ],

  // ───────────────────────── Graphviz(3 条)─────────────────────────
  // 前置条件:必须先做 §4.1 的 graphviz.ts bug 修复,否则 rawMsg 永远是
  // "graphviz engine produced no SVG",根本进不到 patterns 表。
  graphviz: [
    {
      // 实测样本(修复后): syntax error in line 1 near '}'
      rx: /syntax error in line (\d+) near '([^']+)'/,
      make: (m, ctx) => {
        const [_, lineStr, token] = m;
        const line = Number(lineStr);
        return {
          line,
          offendingConstruct: pickLine(ctx.input as string, line),
          message: `DOT 语法错(第 ${line} 行,意外 token "${token}")。`,
          remediation:
            "检查:① 大括号 `{}` 配对;② 每条语句以 `;` 或换行结束;③ `->` / `--` 引用的节点须先出现;④ 属性用 `[key=val]` 或 `key=val` 赋值。",
        };
      },
    },
    {
      // 实测样本(修复后): syntax error in line 2(无 near,只有行号)
      rx: /syntax error in line (\d+)(?! near)/,
      make: (m, ctx) => {
        const line = Number(m[1]);
        return {
          line,
          offendingConstruct: pickLine(ctx.input as string, line),
          message: `DOT 语法错(第 ${line} 行)。`,
          remediation: "检查该行及上一行:语句终止符、大括号配对、属性块 `[...]` 闭合。",
        };
      },
    },
    {
      // 兜底:其他 syntax 类(如 syntax error near 'X' 无行号)
      rx: /syntax error[^]*near '([^']+)'/,
      make: (m, _ctx) => ({
        message: `DOT 语法错(意外 token "${m[1]}")。`,
        remediation: "检查 DOT 语法基本规则(分号/大括号/节点声明/属性赋值)。",
      }),
    },
  ],

  // ───────────────────────── Vega-Lite(3 条)─────────────────────────
  // 现有 src/chart.ts:80-85 预编译守卫(mark:pie、mark 无 type)是优秀范例,不改。
  // 这 3 条只补 compile/render 阶段的 HINT 漏洞。
  "vega-lite": [
    {
      // 实测样本: Invalid field type "undefined"(由 type:"quant" 这种缩写触发)
      rx: /Invalid field type "([^"]+)"/,
      make: (m, _ctx) => ({
        // Vega-Lite 编译错无行号;offendingConstruct 指字段路径,调用方从 spec 反查
        offendingConstruct: `encoding.<channel>.type="${m[1] === "undefined" ? "<缩写或空>" : m[1]}"`,
        message: `encoding 通道的 type 值 "${m[1]}" 不合法(${m[1] === "undefined" ? "通常是拼错或用了缩写,被静默转 undefined" : "不在合法集合内"})。`,
        remediation:
          "type 合法值仅有 4 个:quantitative / nominal / ordinal / temporal。不要用缩写(如 quant/quantitativ),必须写全。",
      }),
    },
    {
      // 实测样本: Unrecognized signal name / signal <X> referenced but not defined
      rx: /Unrecognized signal|signal name "([^"]+)"/,
      make: (_m, _ctx) => ({
        message: "condition.test 引用了未定义的 signal。",
        remediation:
          'Vega-Lite 条件式用 datum 语法而非 signal:condition: { test: "datum.<field> === <val>", ... }。signal 名须先在顶层 signals 定义后再引用。',
      }),
    },
    {
      // 实测样本: gradient 写法错(/gradient|length/i 现有 HINT 命中,本条做加固替换)
      rx: /gradient|Cannot read prop.*length/i,
      make: (_m, _ctx) => ({
        message: "gradient 对象写在了不支持的位置(常见于 style 或 encoding 误用)。",
        remediation:
          'gradient 走 mark.fill 的 fill.gradient(如 fill: "gradient(#a,#b)")或 encoding.color.scale,勿在 style 里塞 gradient 对象。',
      }),
    },
  ],

  // ───────────────────────── resvg(2 条)─────────────────────────
  // resvg 入口分散在 4 处(render-svg.ts:201 + d2/graphviz/chart 的 PNG 复用),
  // 统一经 normalizeEngineError("resvg", e.message, { input: svgString })。
  resvg: [
    {
      // 实测样本: SVG data parsing failed cause the document does not have a root node
      // (3 类失败共用:非数字坐标 / 未知元素 / 负宽度;且对缺 xmlns 误报)
      rx: /SVG data parsing failed|does not have a root node/i,
      make: (_m, ctx) => ({
        offendingConstruct: (ctx.input as string).slice(0, 80),
        message:
          "resvg 解析 SVG 失败。真实原因常是下列之一:① 根标签缺 xmlns 属性;② 某些属性值非数字(如 x/y/width/height);③ 含 resvg 不支持的元素。",
        remediation:
          '三步排查:① 根标签写 <svg xmlns="http://www.w3.org/2000/svg" ...>;② 检查所有 rect/path/circle 的 x/y/width/height/r 是纯数字;③ 若用了 feGaussianBlur/CSS filter 等,改用 render_svg 的 backend:"chrome"(100% 滤镜保真)。',
      }),
    },
    {
      // 实测样本(@resvg/resvg-js-darwin-x64 native 二进制 strings 抓取,napi-rs 非 WASM):
      //   - "default font-family '' not found"(注意中间有 '',非连续 'Font not found')
      //   - "No match for '...' font-family."
      //   - 'Failed to load a font face'
      //   - 'malformed font' / "font doesn't have a family name"
      //
      // ⚠️ 规划首版原 rx `/Font not found|No time to read|fontFamily/i` 与 resvg 实际错误文本对不上:
      //    - 精确连续字串 `'Font not found'` 在 native 二进制中**零命中**(resvg 抛的是
      //      `default font-family '' not found`,中间隔 `''` 引号,正则要求连续不匹配)。
      //    - `'No time to read'` 在 resvg native 二进制 / D2 wasm / doc/ **全部零命中**——
      //      疑似规划作者凭印象误写。本条 rx 基于实测重写。详见 §9 open_point #11(gap-fill #1)。
      rx: /default font-family[^']{0,5}not found|No match for[^']{0,5}font-family|Failed to load a font face|malformed font|font doesn't have a family name/i,
      make: (m, _ctx) => ({
        message: `字体加载失败(底层信息:${m[0]})。`,
        remediation:
          "改用系统已装字体(如 PingFang SC / Noto Sans CJK / Microsoft YaHei),或经 generate_card 的 fontPath 参数传本地 .ttf/.otf 文件路径。",
      }),
    },
  ],
};
```

> **风格决策**:消息正文用**中文**(与 `enhanceD2Error` 现有 HINT 中文风格一致,且 README 中文优先);保留 DSL 关键字(`style.fill`、`stroke-width`、`encoding.theta.type`)与代码示例为英文/符号原样,避免翻译失真。Archify 范式是"动词祈使",中文对应是"把 X 改为 Y" / "检查 Z"——同样祈使。

#### 4.2.3 offending 片段回显实现思路(`pickLine` / `pickD2Line` / `pickD2Offending` 等 helper)

这些是 `error-format.ts` 内部的纯函数,无副作用,易测:

```ts
/** 从 D2 entry.range 字段 "index,1:22:29-1:25:32" 解析行号(返回首个 line)。 */
function pickD2Line(rawJsonOrMsg: string): number | undefined {
  // raw 是整个 e.message(JSON 数组字符串),取第一个 entry.range
  const m = rawJsonOrMsg.match(/"range":"[^,]*,(\d+):\d+/);
  return m ? Number(m[1]) : undefined;
}

/** 按行号从 input(DSL 源码)取该行原文,截断 120 字符。 */
function pickLine(input: string, line?: number): string | undefined {
  if (!line || line < 1) return undefined;
  const lines = input.split(/\r?\n/);
  const txt = lines[line - 1];
  return txt ? txt.slice(0, 120) : undefined;
}

/** 按子正则扫描 input,返回首个匹配行的原文(用于 connection missing destination 这类无行号的)。 */
function pickLineContaining(input: string, pat: RegExp): string | undefined {
  const line = input.split(/\r?\n/).find((l) => pat.test(l));
  return line?.slice(0, 120);
}

/** 找最可能未闭合的 `{`(简化版:找最后一个未配对的 { 所在行)。 */
function pickUnbalancedBrace(input: string): string | undefined {
  let depth = 0;
  let suspectLine: string | undefined;
  const lines = input.split(/\r?\n/);
  for (const l of lines) {
    for (const ch of l) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    if (l.includes("{")) suspectLine = l.slice(0, 120);
  }
  return depth > 0 ? suspectLine : undefined;
}

/** D2 专用:从 range 解析行号后再取行(组合 pickD2Line + pickLine)。 */
function pickD2Offending(input: string, line?: number): string | undefined {
  return pickLine(input, line);
}
```

**设计要点**:
- 所有 `pick*` 函数对越界/空输入返回 `undefined`(永不抛),`make` 函数里 `offendingConstruct` 是可选字段,`undefined` 时直接省略。
- normalizeEngineError 把 NormalizedError 拼成单行字符串时,offendingConstruct 用 `offending: <片段> | ` 前缀拼到主消息前,降低 LLM 定位成本。
- 单行拼装格式(契约三件套可视):
  ```
  [d2] D2 属性 "stroke-width" 仅接受整数,合法范围 0–15。 | offending: style.stroke-width: 1.5 | 修复:把 stroke-width 改为 0–15 之间的整数(如 stroke-width:2 ✅ / 1.5 ❌,小数非法)。
  ```

#### 4.2.4 `normalizeEngineError` 主函数骨架

```ts
let lastMatched = false; // 供 __didMatchLastKnownPattern() 读

export function normalizeEngineError(
  engine: NormalizedEngine,
  rawMsg: string,
  ctx: ErrorContext,
  engineHint?: NormalizedEngine,  // §4.3.4 升级方案:PNG 复用路径抛的 resvg 错用 hint 路由
): string {
  // 优先用结构性 hint 路由(替代旧版"按 rawMsg 内容猜测路由"的脆弱方案,见 §9 open_point #11)
  const routeEngine: NormalizedEngine = engineHint ?? engine;
  const patterns = knownErrorPatterns[routeEngine] ?? [];
  lastMatched = false;

  // D2 特殊路径:rawMsg 是 JSON 数组字符串,先 try-parse 取首条匹配
  const candidates: string[] = routeEngine === "d2" ? extractD2Errmsgs(rawMsg) : [rawMsg];

  for (const candidate of candidates) {
    for (const p of patterns) {
      const m = p.rx.exec(candidate);
      if (m) {
        lastMatched = true;
        const partial = p.make(m, { ...ctx, raw: candidate });
        return formatNormalized({ ...partial, engine: routeEngine });
      }
    }
  }

  // 兜底:未命中任何 pattern,返回原 rawMsg + 标记(反崩溃契约,绝不抛)
  return `[${engine}] ${rawMsg}\n(未识别的错误形态,请把此消息反馈给 media-gen-mcp 维护者补 knownErrorPatterns 表。原始输入前 80 字符:${String(ctx.input).slice(0, 80)})`;
}

/** 把 D2 的 JSON 数组 e.message 拆成 errmsg 字符串数组;解析失败回退为 [rawMsg]。 */
function extractD2Errmsgs(rawMsg: string): string[] {
  try {
    const parsed = JSON.parse(rawMsg);
    if (Array.isArray(parsed)) {
      const msgs = parsed.map((e: any) => String(e?.errmsg ?? "")).filter(Boolean);
      return msgs.length ? msgs : [rawMsg];
    }
  } catch {
    /* not JSON, fall through */
  }
  return [rawMsg];
}

/** 把 NormalizedError 拼成单行字符串(契约三件套顺序:定位 → 问题 → 修复)。 */
function formatNormalized(e: NormalizedError): string {
  const parts: string[] = [`[${e.engine}]`];
  if (e.line != null) parts.push(`line ${e.line}:`);
  parts.push(e.message);
  if (e.offendingConstruct) parts.push(`| offending: ${e.offendingConstruct}`);
  parts.push(`| 修复:${e.remediation}`);
  return parts.join(" ");
}

export function __didMatchLastKnownPattern(): boolean {
  return lastMatched;
}
```

### 4.3 改 `src/index.ts`:在 3 个 handler 调用点包 try/catch

> **原则**:不动顶层 `try/catch`(`src/index.ts:1316-1318`),它在;不动 `err()` helper(1369-1371),它签名不变。只在 3 个引擎调用点的外围加 try/catch,catch 里调 `normalizeEngineError` 改写消息后**重新 throw**(让顶层 catch 仍按 `e.message` 走 `err()` 协议输出)。这样改动面最小、向后兼容最稳。

#### 4.3.1 `generate_diagram` handler(`src/index.ts:938-957`)

**改动范围:行 947-954**(engine.render 调用)包一层 try/catch:

```ts
// src/index.ts:947-957 改为:
let rendered;
try {
  rendered = await engine.render({
    code,
    engine: engineName as any,
    format,
    theme: optString(a.theme),
    diagramType: optString(a.diagramType) ?? optString(a.type),
    name: optString(a.name),
  });
} catch (e: any) {
  // P0-2:引擎 stderr 归一化(D2/Graphviz 透传的裸消息 LLM 难读)
  const msg = String(e?.message ?? e);
  // PNG 复用路径抛的 resvg 错带 `[resvg] ` 前缀(§4.3.4 升级方案),用 engineHint 路由到 resvg patterns 表
  const isResvg = /^\[resvg\] /i.test(msg);
  const normalized = normalizeEngineError(
    isResvg ? "resvg" : (engineName === "graphviz" ? "graphviz" : "d2"),
    msg.replace(/^\[resvg\] /i, ""),
    { input: code, raw: msg },
    isResvg ? "resvg" : undefined,
  );
  throw new Error(normalized); // 顶层 catch 会转成 err(normalized)
}
const fp = await writeLocalRender(outDir, "diagram", optString(a.name), format, rendered);
return ok({ engine: engineName, format, local_path: fp });
```

> **注意**:`engine.render` 内部已经走过 `enhanceD2Error` / `enhanceGraphvizError`(d2.ts:132 / graphviz.ts:64)的 HINT 追加。P0-2 的 `normalizeEngineError` 接收到的 `rawMsg` 是**已经带 HINT 的字符串**。为避免双重提示,**P0-2 落地时需把 `enhanceD2Error` 的 HINT 逻辑迁入 `knownErrorPatterns.d2` 表**(即 `d2.ts:132` 改回 `throw new Error(e?.message ?? String(e))`,HINT 由 handler 层统一加)。这是迁移决策,不是删功能——见 §4.4。

#### 4.3.2 `generate_chart` handler(`src/index.ts:976-985`)

**改动范围:行 982**(renderChart 调用)包一层 try/catch:

```ts
// src/index.ts:982-984 改为:
let rendered;
try {
  rendered = await renderChart({ spec: a.spec, format });
} catch (e: any) {
  // P0-2:Vega-Lite compile/render 错归一化
  const msg = String(e?.message ?? e);
  // PNG 复用路径抛的 resvg 错带 `[resvg] ` 前缀(§4.3.4 升级方案),用 engineHint 路由到 resvg patterns 表
  const isResvg = /^\[resvg\] /i.test(msg);
  const normalized = normalizeEngineError(
    isResvg ? "resvg" : "vega-lite",
    msg.replace(/^\[resvg\] /i, ""),
    { input: a.spec as Record<string, unknown>, raw: msg },
    isResvg ? "resvg" : undefined,
  );
  throw new Error(normalized);
}
const fp = await writeLocalRender(outDir, "chart", optString(a.name), format, rendered);
return ok({ format, local_path: fp, ...(rendered.warnings?.length ? { warnings: rendered.warnings } : {}) });
```

> **保留**:`src/chart.ts:80-85` 的预编译守卫(`mark:"pie"` / mark 无 type)直接抛清晰错误,P0-2 **不改**——它本就是 Archify 同款契约范本。这些错经顶层 catch 走 `err(message)`,message 已含"如何改"的代码模板,不在 `knownErrorPatterns` 覆盖范围内(也可后续把这两条迁入 patterns 表,见 open_points)。

#### 4.3.3 `render_svg` handler(`src/index.ts:1050-1063`)

**改动范围:行 1054-1060**(renderSvg 调用)包一层 try/catch:

```ts
// src/index.ts:1054-1062 改为:
let rendered;
try {
  rendered = await renderSvg({
    svg,
    format,
    width: optNumber(a.width),
    backend: optString(a.backend) as any,
    scale: optNumber(a.scale),
  });
} catch (e: any) {
  // P0-2:resvg 栅格化错归一化(Chrome 后端错不在此列,原样抛)
  const msg = String(e?.message ?? e);
  // resvg 错识别:优先看 engineHint 前缀(来自 render_svg 内部 Resvg 调用的 try/catch 包装);
  // 兜底用内容 rx(已基于 resvg native 二进制实测重写,见 §4.2.2 resvg patterns)。
  // 注意:'Font not found'/'No time to read' 在 resvg 实际错误文本中零命中(详见 §9 open_point #11),
  //       不要再写进触发器。
  const isResvgErr = /^\[resvg\] /i.test(msg)
    || /SVG data parsing failed|default font-family[^']{0,5}not found|No match for[^']{0,5}font-family|Failed to load a font face|malformed font/i.test(msg);
  const normalized = isResvgErr
    ? normalizeEngineError("resvg", msg.replace(/^\[resvg\] /i, ""), { input: svg, raw: msg }, isResvgErr ? "resvg" : undefined)
    : msg;
  throw new Error(normalized);
}
const fp = await writeLocalRender(outDir, "svg", optString(a.name), format, rendered);
return ok({ format, backend: rendered.backendUsed, warning: rendered.warning, local_path: fp });
```

> **决策**:`render_svg` 有 resvg 和 Chrome 两个后端。Chrome 错误(如 "Chrome/Edge not available")对 LLM 已足够清晰(含 "install Google Chrome or use backend:'resvg'"),**不归一化**;只对 resvg 类错误走 `knownErrorPatterns.resvg`。

#### 4.3.4 三处 PNG 复用路径(`src/diagram/d2.ts:146-151`、`src/diagram/graphviz.ts:71-78`、`src/chart.ts:108-109`)

这三处是 D2/Graphviz/Vega-Lite 生成 SVG 后转 PNG 时复用 resvg。它们抛的 resvg 错会被 §4.3.1/§4.3.2 的外层 try/catch 捕获,但此时 `normalizeEngineError` 的 engine 参数是 "d2"/"graphviz"/"vega-lite",**走不到 resvg patterns 表**——首版必须在这三处显式标记 engine 来源。

**P0-2 首版方案(原计划为 v2,现已升级为 v1 首版必修)**:把这三处 PNG 复用路径**也包独立 try/catch,以结构化前缀标记 engine 来源**,替代"按内容猜测路由"的脆弱方案。

**为何放弃"内容匹配回退"方案(决策依据,实地核实)**:

规划首版原设计的跨引擎回退触发器 `/SVG data parsing|Font not found|No time to read/i` 经实地二进制 strings 抓取存在两个硬伤:

1. **抓不到本意要抓的字体错误(漏匹配)**:精确连续字串 `'Font not found'` 在 `@resvg/resvg-js-darwin-x64` native 二进制中**零命中**——resvg 实际抛的是 `'default font-family \'\' not found'`(中间隔 `''` 引号,正则要求连续不匹配)、`'No match for \'...\' font-family.'`、`'Failed to load a font face'`、`'malformed font'`。`'No time to read'` 在 resvg / D2 wasm / doc/ **全部零命中**,疑似规划作者凭印象误写。**意图覆盖的字体加载错误场景完全未覆盖**,跨引擎回退实际只有 'SVG data parsing' 一条有效。
2. **当前碰巧安全,未来结构脆弱(误匹配)**:当前 D2 @0.1.33 wasm 与 HINT 文本确实不含这三个串(实测零命中),所以"不会被误路由";但维护者补 d2 HINT 时若引用了 'Font not found' 字样(中概率,最现实),会被误路由到 resvg patterns 表给出错误 remediation。
3. **engine 来源标记 100% 可靠**:用 try/catch 的物理位置(哪个 catch 块)确定 engine 来源,是结构性信号,同时解决误匹配与漏匹配,无脆弱性。

**实施方案(三处 PNG 复用路径加独立 try/catch,推荐方案 A 轻量前缀)**:

```ts
// src/diagram/d2.ts:146-151、src/diagram/graphviz.ts:71-78、src/chart.ts:108-109 三处:
// 把 `new Resvg(...)` + `.render()` 调用包进 try/catch,重抛带结构化前缀:
try {
  const resvg = new Resvg(/* svg */, /* opts */);
  const pngBuffer = resvg.render().asPng();
  // ... 原后续逻辑
} catch (e: any) {
  // 轻量方案 A:加 `[resvg] ` 前缀(不破坏单字段错误协议,顶层 catch 仍取 e.message)
  throw new Error("[resvg] " + (e?.message ?? String(e)));
  // 备选方案(类型化,更干净):新增 `export class ResvgError extends Error`,
  //                   三处 `throw new ResvgError(e?.message ?? String(e))`。
  //                   不破坏单字段错误协议(JSON 序列化形态不变)。
}
```

**配套修改 `normalizeEngineError`**:增加 `engineHint?: "resvg"` 参数,handler 层 catch(`src/index.ts:947/982/1054`)优先用 hint 路由到 resvg patterns 表,**跳过 d2/graphviz/vega-lite patterns 表**。hint 识别方式二选一:`e instanceof ResvgError`(类型化方案)或 `/^\[resvg\] /`(前缀方案)。

**内容匹配 rx 仅作"未知错误兜底"**:已基于实测重写并放在 resvg patterns 表内(见 §4.2.2 第二条 rx 的字体错误匹配),作为 `engineHint` 缺失或前缀被未来改动破坏时的兜底路由,而非跨引擎触发的依据。

**CI 防御**:加 grep 脚本断言 `src/diagram/d2.ts` / `src/diagram/graphviz.ts` / `src/chart.ts` / `src/index.ts` 的 HINT / remediation 文本不得包含任何跨引擎回退触发子串(`SVG data parsing` / `Font not found` / `No time to read`),防未来文本漂移引入误匹配。

**回归测试**:`test/error-format.smoke.mjs` 增加 D2 真实 Go 错误模板样本(`maps must be terminated with }`、`failed to parse map key %q: %w`、`connection missing destination`、`%s" is not a valid theme code` 等,直接从 `node_modules/@terrastruct/d2/dist/{node-esm,node-cjs}/d2.wasm` strings 抓取),断言不会被误路由到 resvg patterns 表。

### 4.4 HINT 逻辑迁移(enhanceD2Error → knownErrorPatterns.d2)

现有 `enhanceD2Error`(`src/diagram/d2.ts:75-90`)的 9 条 regex 与 `knownErrorPatterns.d2` 的 6 条**部分重叠**(number between、hex/missing value、one of、maps must be terminated 等)。为避免**双重 HINT**(engine 层加一次、handler 层加一次),迁移决策:

- **迁移**:`d2.ts:132` 的 `throw new Error(enhanceD2Error(...))` 改回 `throw new Error(e?.message ?? String(e))`(engine 层只抛裸 errmsg,不再加 HINT)。HINT 逻辑全部由 handler 层 `normalizeEngineError("d2", ...)` 接管。
- **删除**:`enhanceD2Error` 函数在 P0-2 一次性整体删除(`src/diagram/d2.ts:74-90` 共 16 行)。**原"标 @deprecated 留到下一版"方案技术上不可行**——会直接 break `npm run build`。三条理由:
  1. **硬性 blocker(决定性证据)**:`media-gen-mcp/tsconfig.json:15` 设了 `"noUnusedLocals": true`。Step 6 把 `d2.ts:132` 改回抛裸 errmsg 后,`enhanceD2Error` 在整个仓库零调用方(全仓 grep 仅命中定义 line 75 + 唯一调用 line 132,无第三处)。模块私有非导出函数零引用时 TS 5.9.3 会报 `TS6133: 'enhanceD2Error' is declared but its value is never read`,导致 `tsc` 退出码非零 → `npm run build` 失败 → `prepublishOnly`(链跑 build)也失败。JSDoc `@deprecated` **不**抑制 TS6133(已用 media-gen-mcp 自带 TS 5.9.3 实测复现)。
  2. **无行为变更**:HINT 知识已全量迁出——§4.4 对齐清单证明 9 条 regex 中 5 条直接 ✅、1 条 pattern 2 超集 ⚠️ 覆盖、1 条扩为 pattern 3(`must be style.X`,且 rx 改为 `[\w-]+` 覆盖 17 个 style 关键字)、2 条按设计延后(open_points 而非遗漏)。删除函数丢失的 HINT 知识为 **0**。
  3. **"保守"对纯死代码删除不适用**:16 行纯死代码移除无行为变更、无回归网可破坏(当前仓库无 `*.test.ts` 自动化测试)。

  所谓"下一版再删"在工程上不存在可行路径:备选 B1(给函数加 `export` 让 noUnusedLocals 不报)会污染模块 API,且 @deprecated 一个导出 API 比删掉更难追踪;备选 B2(临时降 `noUnusedLocals: false`)会削弱全仓安全网,代价远大于删 16 行。两种 B 都比直接删差。

  > **删除前的提取动作(重要,与 §9 open_point #7 联动)**:`enhanceD2Error` 函数体首行 `if (/^(strict\s+)?(di)?graph\b/mi.test(code.trim()) || /\brankdir\b/mi.test(code))`(d2.ts:77-78)是 **DOT 误入 D2 的预编译启发式**,不是 errmsg 归一化,open_point #7 决定**保留在 d2.ts**。删除 `enhanceD2Error` 时必须**先提取这段启发式**为独立函数(如 `detectDotAsD2(code): string | null`)或 inline 到 d2.ts:132 的 catch 块前,然后再删剩余 8 条 errmsg regex。否则会顺带删掉这条无关的启发式检查。
- **内部一致性修订(顺带消除 §4.1 vs §9 的张力)**:§9 open_point #1 末句"若有意则改为双路径(读取 + 保留 produced no SVG 兜底)"描述的"双路径",**§4.1 line 175-181 的修复代码已经实现**——`ge ? \`graphviz engine rejected the DOT input: ${ge}\` : "graphviz engine produced no SVG (no error reported by viz-js — check DOT syntax)"` 已经把 `produced no SVG` 作为 errors 为空时的兜底文本保留。无需额外动作。
- **覆盖对齐**:`knownErrorPatterns.d2` 的 6 条必须覆盖 `enhanceD2Error` 9 条中的有效部分。对齐清单:
  | enhanceD2Error 现有 | knownErrorPatterns.d2 对应 |
  |---|---|
  | `/number between/i`(stroke-width 整数) | ✅ pattern 1 |
  | `/reserved\|keyword\|cannot be (used\|redefined)\|redefinition/i` | ✅ **pattern 3** 覆盖(rx 改为 `/([\w-]+) must be style\.\1/`,覆盖全部 17 个 D2 style 关键字,比 enhanceD2Error HINT 文案列的 7 个更全;见 §9 open_point #13) |
  | `/valid named color\|hex code/i` | ⚠️ pattern 2(`missing value after colon`)覆盖更常见路径,hex 命名色错可后补 |
  | `/one of/i` | ✅ pattern 6 |
  | `/maps must be terminated/i` | ✅ pattern 4 |
  | `/unexpected text after/i` | ❌ **首版不补**(低频,open_points) |
  | `/non-integer/i` | ✅ pattern 1 覆盖 |
  | `/missing value after/i` | ✅ pattern 2 |
  | DOT 误入 D2 检测(`/^(di\|graph\b/)`) | ❌ **首版不迁**(这是 input.code 启发式,不是 errmsg 匹配;P0-2 之外,可独立保留) |

> **红线**:`enhanceD2Error` 里 DOT 误入 D2 的启发式检查(`rx: /^(strict\s+)?(di)?graph\b/mi.test(code.trim())`)是**预编译前**的 input 检测,与 P0-2 错误归一化不同层。P0-2 不动它(保留在 d2.ts 里),或迁移到 P1-1 的 lint 层。

### 4.5 步骤分解(可勾选 TODO,每步预估工时)

> 工时按"熟悉 media-gen-mcp 代码的维护者"估算。单人串行总计 **3-4 工作日**。

- [ ] **Step 1**(30 min)创建 `src/handlers/` 目录与 `src/handlers/error-format.ts` 空骨架(类型 + 函数签名 + 空 patterns 表 + `normalizeEngineError` 兜底返回 rawMsg)。跑 `npm run build` 确认编译过。
- [ ] **Step 2**(2 h)实现 `knownErrorPatterns` 4 引擎 14 条 pattern(D2 ×6 / Graphviz ×3 / Vega-Lite ×3 / resvg ×2),全部带调查实测样本作注释。每条 pattern 写一行 `// 实测样本: ...` 注释,方便后续回归测试对齐。
- [ ] **Step 3**(1 h)实现 `pickLine` / `pickD2Line` / `pickLineContaining` / `pickUnbalancedBrace` / `extractD2Errmsgs` / `formatNormalized` helper。全部纯函数,对越界/空输入返回 `undefined`,永不抛。
- [ ] **Step 4**(1 h)实现 `normalizeEngineError` 主函数 + `engineHint?: "resvg"` 参数(§4.3.4 升级方案)+ `__didMatchLastKnownPattern`。
- [ ] **Step 5**(30 min)做 §4.1 的 `src/diagram/graphviz.ts:60-68` bug 修复(读取 `result.errors` 拼进 throw)。**这是 P0-2 能工作的前置条件**。
  - **前置 checkbox(已完成,2026-07-21)**:git blame 已确认 errors 丢弃是遗漏,非有意丢弃(commit `41e2ac4d` 首次创建即引入,后续 `28e6962`/`6b22a2a6` 均未触及 errors 读取;commit `41e2ac4d` body 自述"非法 DOT 清晰错误,全通过"证明维护者当时误以为 catch 路径已抓到非法 DOT,实际是测试盲区)。直接按单路径修复执行,无需再做 git blame 前置步骤。详见 §9 open_point #1。
- [ ] **Step 6**(1 h)做 §4.4 的 `enhanceD2Error` 迁移:`src/diagram/d2.ts:132` 改回抛裸 errmsg,`knownErrorPatterns.d2` 已覆盖;**同步删除 `enhanceD2Error` 整个函数(d2.ts:74-90 共 16 行,不标 @deprecated——标了 build 也过不了)**。删除前**先提取** d2.ts:77-78 的 DOT 误入 D2 启发式(保留为独立函数或 inline 到 catch 前,见 §4.4 提取动作)。三处 PNG 复用路径(d2.ts:146-151、graphviz.ts:71-78、chart.ts:108-109)的 Resvg 调用同步包 try/catch 加 `[resvg]` 前缀(§4.3.4 升级方案)。
- [ ] **Step 7**(1 h)做 §4.3.1 的 `src/index.ts:947-957`(generate_diagram)包装。
- [ ] **Step 8**(30 min)做 §4.3.2 的 `src/index.ts:982-984`(generate_chart)包装。
- [ ] **Step 9**(30 min)做 §4.3.3 的 `src/index.ts:1054-1062`(render_svg)包装,用 `engineHint`/前缀优先路由 + 内容 rx 兜底(§4.3.3/§4.3.4)。
- [ ] **Step 10**(2 h)写 `test/error-format.smoke.mjs` 冒烟测试(node:test,与 P0-3 runner 引入前的临时形态,见 §5)。覆盖 14 条 pattern 各一个真实样本 + 含连字符 style 关键字样本(`font-size`/`border-radius`,锁死 §9 open_point #13 回归)+ D2 真实 Go 错误模板负样本(锁死不被误路由到 resvg patterns,§9 open_point #11),断言 `normalizeEngineError` 返回文本含三件套 + 不含 TypeError/Cannot read。
- [ ] **Step 11**(30 min)加 CI grep 防御脚本:`d2.ts`/`graphviz.ts`/`chart.ts`/`index.ts` 的 HINT/remediation 文本不得含跨引擎回退触发子串(`SVG data parsing`/`Font not found`/`No time to read`)。
- [ ] **Step 12**(30 min)手动 e2e 验证:`node dist/index.js` 起服务,用 MCP inspector 喂 4 类错输入,确认错误文本含 offending 片段与修复动词。
- [ ] **Step 13**(30 min)更新 `MEMORY.md` 的 media-gen-mcp 条目,记 P0-2 落地状态。

**总计**:~12 h ≈ 1.5 工作日(理想)+ 调试缓冲 → **3-4 工作日**。

---

## 5. 测试方案

### 5.1 现状约束(诚实声明)

`media-gen-mcp` **当前没有任何自动化测试套件**。`package.json` 的 `"test": "node scripts/check-schema.mjs"` 只校验 inputSchema enum,不跑任何断言。`scripts/` 只有 `check-schema.mjs`(3520 字节)。memory 记载的"97/97 测试"实际指 `doc/OCR_测试集/` 下的 ad-hoc node 脚本(非单测)。

**结论**:P0-2 的正式契约测试(单点 mutation + 反崩溃 regex + 元契约)依赖 P0-3 引入 `node:test` runner。本 P0-2 只交付**冒烟测试**(用 `node --test` 跑单文件,不接 `npm test`),正式测试框架留给 P0-3 / P0-4。

### 5.2 P0-2 冒烟测试(`test/error-format.smoke.mjs`)

**形态**:`node --test test/error-format.smoke.mjs` 单文件可跑(node 18+ 内置,零依赖)。不修改 `package.json` 的 `"test"` 脚本(保 `check-schema.mjs` 立场)。

**测试矩阵**(14 条 pattern 各 1 真实样本 + 4 条反崩溃 + 1 条元契约):

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeEngineError } from "../dist/handlers/error-format.js";

// ── D2(6 条)── 每条喂调查实测的真实 stderr 样本
test("D2: float stroke-width", () => {
  const raw = JSON.stringify([{ range: "index,1:22:29-1:25:32", errmsg: 'index:2:23: expected "stroke-width" to be a number between 0 and 15' }]);
  const out = normalizeEngineError("d2", raw, { input: "x: { style.stroke-width: 1.5 }", raw });
  assert.match(out, /stroke-width/);
  assert.match(out, /0–15|0-15/);
  assert.match(out, /整数/);              // 阈值 + 修复动词
  assert.match(out, /offending:/);        // offending 片段回显
  assert.doesNotMatch(out, /TypeError|Cannot read/);  // 反崩溃
});
// ... 余 5 条 D2 + 3 条 Graphviz + 3 条 Vega-Lite + 2 条 resvg 同形

// ── D2 含连字符 style 关键字(锁死 §9 open_point #13 回归)──
test("D2: hyphenated style keyword (font-size must be style.font-size)", () => {
  const raw = JSON.stringify([{ range: "index,0:0:0-0:7:7", errmsg: "index:1:1: font-size must be style.font-size" }]);
  const out = normalizeEngineError("d2", raw, { input: "x: { font-size: red }", raw });
  assert.match(out, /font-size/);
  assert.match(out, /保留样式关键字/);
  assert.doesNotMatch(out, /未识别的错误形态/);  // 必须命中 pattern 3,不落入兜底
});
test("D2: hyphenated style keyword (border-radius must be style.border-radius)", () => {
  const raw = JSON.stringify([{ range: "index,0:0:0-0:11:11", errmsg: "index:1:1: border-radius must be style.border-radius" }]);
  const out = normalizeEngineError("d2", raw, { input: "x: { border-radius: red }", raw });
  assert.match(out, /border-radius/);
  assert.match(out, /保留样式关键字/);
  assert.doesNotMatch(out, /未识别的错误形态/);
});

// ── D2 真实 Go 错误模板负样本(锁死 §9 open_point #11 不被误路由到 resvg patterns)──
test("D2 negative: Go-style error not misrouted to resvg patterns", () => {
  for (const goErr of [
    "maps must be terminated with }",
    'failed to parse map key %q: %w',
    "connection missing destination",
    '%s" is not a valid theme code',
    "classes cannot contain an edge",
  ]) {
    const out = normalizeEngineError("d2", JSON.stringify([{ errmsg: goErr, range: "index,0:0:0-0:1:1" }]), { input: "", raw: goErr });
    // 要么命中对应 d2 pattern,要么走 d2 兜底;**绝不能**返回 resvg 归一化文本
    assert.doesNotMatch(out, /字体加载失败|resvg 解析 SVG 失败/);
  }
});

// ── Graphviz(修复后的样本)──
test("Graphviz: syntax error near '}'", () => {
  const out = normalizeEngineError("graphviz", "syntax error in line 1 near '}'", { input: "digraph G { A -> }", raw: "" });
  assert.match(out, /line 1/);
  assert.match(out, /offending:.*\}/);
  assert.match(out, /大括号|配对|节点/);  // 修复动词
});

// ── 反崩溃契约(Archify layout-rules.test.mjs:166 同款)──
test("anti-crash: unknown error shape returns raw, not throws", () => {
  const out = normalizeEngineError("d2", "some totally unknown error xyz123", { input: "", raw: "" });
  assert.match(out, /some totally unknown error xyz123/);  // 原样保留
  assert.match(out, /未识别的错误形态/);                   // 兜底标记
  assert.doesNotMatch(out, /TypeError|is not a function|Cannot read/);
});

// ── 元契约(三件套必须齐)──
test("contract: every normalized message carries engine tag + fix verb", () => {
  for (const { engine, raw, input } of CASES) {
    const out = normalizeEngineError(engine, raw, { input, raw });
    assert.match(out, new RegExp(`\\[${engine}\\]`));  // ① 定位
    assert.match(out, /修复|修复:/);                    // ③ 修复动词(中文)
  }
});
```

### 5.3 Graphviz bug 锁死测试(P0-3 正式引入前的临时形态)

冒烟测试里**额外加一条 e2e** 直接调 `dist/diagram/graphviz.js`:

```js
test("regression: graphviz exposes viz-js errors (not 'produced no SVG')", async () => {
  const { GraphvizEngine } = await import("../dist/diagram/graphviz.js");
  const eng = new GraphvizEngine();
  await assert.rejects(
    () => eng.render({ code: "digraph G { A -> }", format: "svg" }),
    (e) => {
      assert.match(e.message, /syntax error in line 1 near '}'/);
      assert.doesNotMatch(e.message, /produced no SVG/);  // 🔒 bug 锁死
      return true;
    },
  );
});
```

> **依赖声明**:此测试需 P0-3 把 `node --test` 接入 `npm test` 才会自动跑。P0-2 交付时它只是 `test/error-format.smoke.mjs` 里的一个可手动 `node --test` 触发的 case。

### 5.4 不破坏现有行为的验证清单

- [ ] `npm run build` 编译过(`tsc` 无错)。
- [ ] `npm test` 仍只跑 `check-schema.mjs` 且 pass(P0-2 不改 `package.json` test 脚本)。
- [ ] **happy path 回归**:用 MCP inspector 喂合法 D2 / Graphviz / Vega-Lite / SVG 输入各 1 个,确认成功返回字节与 P0-2 前完全一致(handler 只在 catch 里加逻辑,success 路径零改动)。
- [ ] 19 工具 inputSchema 字节比对:`git diff src/index.ts` 只在 947-957 / 982-984 / 1054-1062 三处 case body 内,`name:` / `description:` / `inputSchema:` 行不动。
- [ ] `check-schema.mjs` 对 create_video 两 enum 的校验仍 pass(本 P0 不碰 create_video)。

---

## 6. 向后兼容策略(旧调用方零感知)

### 6.1 协议层零变更

- 错误返回仍是 `{content: [{type: "text", text: <string>}], isError: true}` 单字段协议(P0-2 不加 code/path/severity 结构化字段,只把 `text` 字符串本身变得对 LLM 更可读)。
- 调用方(MCP client)解析错误的代码不需要任何改动——`isError` 仍是 boolean、`content[0].text` 仍是 string。

### 6.2 工具签名零变更

- 19 工具的 `name` / `description` / `inputSchema` 全部字节不变。
- 所有 handler 的 happy path(`ok(...)` 返回)字节不变——P0-2 只在 catch 里加包装,success 路径零改动。

### 6.3 行为层:错误文本**会变**,但这是修复不是破坏

- 4 类错误(D2 JSON 数组、Graphviz `produced no SVG`、Vega `Invalid field type`、resvg `no root node`)的返回文本会变。这些都是 bug 或 LLM 不可读的现状,变化方向是"更清晰",无任何下游依赖原文本(若有 CI grep 原文本,是 CI 的 bug)。
- **唯一需点名**:`enhanceD2Error` 的 9 条 HINT 迁入 `knownErrorPatterns.d2` 后,D2 错误文本风格会从英文 HINT(` HINT: D2 numeric properties...`)切换到中文(`修复:把 stroke-width 改为...`)。这是 P0-2 的有意识决策(对齐 README 中文优先 + Archify 祈使动词风格),在 CHANGELOG 显式声明。

### 6.4 `check-schema.mjs` 零影响

P0-2 不碰 `scripts/check-schema.mjs`,不碰 create_video 的 inputSchema enum。

---

## 7. 风险与缓解

| 风险 | 严重度 | 缓解 |
|---|---|---|
| **R1: D2 JSON 数组 e.message 格式版本不稳定**(`@terrastruct/d2` 升级可能换格式) | 🟡 中 | `extractD2Errmsgs` 内 `try JSON.parse` 失败回退 `[rawMsg]`,正则也直接匹配裸字符串;**不硬依赖 JSON 结构**。`@terrastruct/d2@0.1.33` 锁在 package.json,P0-2 只对当前版本承诺。 |
| **R2: Graphviz bug 修复可能是有意行为**(维护者曾担心 viz-js errors 格式不稳定而显式丢弃) | 🟢 低 / **已闭环** | **已 git blame 确认是遗漏**(2026-07-21):commit `41e2ac4d`(2026-07-14,pares4 阶段 v0.3.0,文件首次创建)一次性引入 try/catch + 丢弃 `result.errors` 模式,无"曾经读取后来移除"轨迹;commit body 自述"非法 DOT 清晰错误 全通过"与实际"produced no SVG"行为矛盾,证明维护者当时是测试盲区而非有意丢弃。errors 是 viz-js public API(`@viz-js/viz@3.28.0` types/index.d.ts:L52 JSDoc + L179-192 `RenderResult` + L208-211 `RenderError {level?, message}`),v3 谱系内 20 个连续 minor 版本结构未变;npm 用 `^3.28.0` caret 不跨 major。§4.1 line 175-181 修复已含可选链 + length + produced-no-SVG 兜底,具备防御性。详见 §9 open_point #1。 |
| **R3: knownErrorPatterns 首版覆盖率不足**(14 条覆盖不了所有真实错误形态) | 🟢 低 | **这是预期**,设计上就是"渐近积累"。兜底返回 `[engine] <rawMsg>(未识别...)`,LLM 仍能拿到原 stderr;`__didMatchLastKnownPattern()` 供后续加日志统计未命中率。 |
| **R4: 正则误匹配**(某条 rx 太宽,匹配到不该匹配的 msg,给出错误 remediation) | 🟡 中 | 14 条 rx 都从实测 stderr 精确抓取(含锚点 / 捕获组),review 时重点审 rx 严格度;冒烟测试的 14 条 case 锁死正样本;未命中兜底走原 rawMsg 不会崩。 |
| **R5: License 风险(Archify license 未明)** | 🔴 高(立场) | **全部 reimplement**。`knownErrorPatterns` 14 条正则与 remediation 文本自写,不抄 Archify 任何字符串。Archify 仅提供"契约三件套"这一**纯范式**。立场红线守住。 |
| **R6: 中文消息 + 英文 DSL 关键字混排,LLM 解析歧义** | 🟢 低 | 决策已定(§4.2.2 风格决策):正文中文 + DSL/code 原样英文。与现有 `enhanceD2Error` 的中文 HINT 风格一致,无新歧义。 |
| **R7: P0-2 落地后 enhanceD2Error 双重 HINT**(engine 层加一次 + handler 层加一次) | 🟢 低 / **已闭环** | §4.4 明确迁移路径:engine 层改回抛裸 errmsg,handler 层统一归一化。Step 6 强制对齐;**且 §9 open_point #12(gap-fill #3)已决定 Step 6 同步删除整个 `enhanceD2Error` 函数**(tsconfig `noUnusedLocals` 守门,标 @deprecated 会让 build 失败)。 |
| **R8: PNG 复用路径(d2.ts:146 等)的 resvg 错走不到 patterns 表** | 🟢 低 / **已闭环** | §4.3.4 升级方案:三处 PNG 复用包独立 try/catch 加 `[resvg]` 前缀 + `normalizeEngineError` 加 `engineHint` 参数路由(替代旧版脆弱的内容匹配)。详见 §9 open_point #11(gap-fill #1)。 |
| **R9: 测试套件缺失,P0-2 自身无回归门** | 🟡 中 | §5 诚实声明:冒烟测试单文件可跑,正式契约测试依赖 P0-3。**建议 P0-2 与 P0-3 同批落地**(P0-3 先引入 runner,P0-2 紧接落地)。 |

---

## 8. 验收清单(Definition of Done)

### 8.1 代码交付

- [ ] 新建 `src/handlers/error-format.ts`,导出 `normalizeEngineError` / `NormalizedError` / `KnownErrorPattern` / `knownErrorPatterns` / `__didMatchLastKnownPattern`;`normalizeEngineError` 支持 `engineHint?: "resvg"` 参数(§4.3.4)。
- [ ] `knownErrorPatterns` 含 4 引擎共 ≥14 条 pattern,每条带 `// 实测样本: ...` 注释;D2 pattern 3 rx 用 `/([\w-]+) must be style\.\1/`(覆盖 17 个 style 关键字);resvg pattern 2 rx 基于实测重写(不含 'Font not found'/'No time to read')。
- [ ] `src/diagram/graphviz.ts:60-68` bug 修复(读取 `result.errors`),`produced no SVG` 兜底保留。
- [ ] `src/diagram/d2.ts:132` 改回抛裸 errmsg;**`enhanceD2Error` 函数(d2.ts:74-90)已整体删除**——`npm run build` pass 无 TS6133(noUnusedLocals 守门);d2.ts:77-78 的 DOT 误入 D2 启发式已提取为独立函数或 inline(保留行为)。
- [ ] 三处 PNG 复用路径(`d2.ts:146-151`、`graphviz.ts:71-78`、`chart.ts:108-109`)的 Resvg 调用已包 try/catch 加 `[resvg]` 前缀。
- [ ] `src/index.ts` 三处 handler 包装(generate_diagram 行 947-957、generate_chart 行 982-984、render_svg 行 1054-1062)。
- [ ] CI grep 防御脚本就位:`d2.ts`/`graphviz.ts`/`chart.ts`/`index.ts` 的 HINT/remediation 文本不含跨引擎回退触发子串。
- [ ] `npm run build` 编译过。

### 8.2 测试交付

- [ ] `test/error-format.smoke.mjs` 含 ≥14 条 pattern 正样本 + 反崩溃 case + 元契约 case + Graphviz bug 锁死 case。
- [ ] `node --test test/error-format.smoke.mjs` 全绿。
- [ ] `npm test`(check-schema.mjs)仍 pass。

### 8.3 契约验收(手动 e2e)

用 MCP inspector 喂下列输入,确认返回文本含三件套(定位 + 阈值 + 修复动词)+ offending 回显:
- [ ] D2 float:`x: { style.stroke-width: 1.5 }` → 含"整数"+"0–15"+ offending 片段。
- [ ] D2 unquoted hex:`a: { style.fill: #ff0000 }` → 含"注释符"+ 加引号修复。
- [ ] D2 reserved word:`shadow: { fill: red }` → 含"保留样式关键字"。
- [ ] D2 reserved word 含连字符(锁死 §9 open_point #13):`x: { font-size: red }` → 含"font-size"+"保留样式关键字",**不**落入兜底(无"未识别的错误形态")。
- [ ] Graphviz syntax:`digraph G { A -> }` → 含"line 1"+"syntax error"+ offending `}`(而非 `produced no SVG`)。
- [ ] Vega-Lite bad type:`{ mark:"bar", encoding:{ theta:{ field:"a", type:"quant" } } }` → 含"quantitative/nominal/ordinal/temporal"。
- [ ] resvg no xmlns:`<svg><rect width="50" height="50"/></svg>` → 含"xmlns"+ offending 前 80 字符。

### 8.4 向后兼容验收

- [ ] 合法 D2 / Graphviz / Vega-Lite / SVG 各 1 个 happy path,返回字节 diff 为空(`git diff` 对比 P0-2 前后 dist/)。
- [ ] 19 工具 inputSchema 字节比对:不动。
- [ ] `check-schema.mjs` pass。

### 8.5 文档交付

- [ ] CHANGELOG 记 P0-2 落地,显式声明"错误文本风格从英文 HINT 切换到中文归一化"。
- [ ] MEMORY.md 的 media-gen-mcp 条目补 P0-2 状态。

---

## 9. 未决问题(open_points,诚实列)

1. ~~**Graphviz `result.errors` 丢弃是否有意为之**~~ — ✅ **已闭环(2026-07-21 via git blame)**:确认是**遗漏**,非有意。可直接按 §4.1 单路径修复执行(且 §4.1 line 175-181 已隐式实现双路径,见 §4.4 内部一致性修订)。
   - **原文(保留)**:代码注释完全没提 `result.errors`,从代码看更像遗漏,但需 git blame `src/diagram/graphviz.ts:60-68` 确认原始 commit message。若有意(如担心 viz-js errors 格式版本不稳定),P0-2 改为双路径(读取 + 保留 `produced no SVG` 兜底)而非完全替换。
   - **答案**:`git blame` 决定性证据——7/8 行来自单一 commit `41e2ac4d`(wangdong,2026-07-14 12:52:27 +0800,文件首次创建);唯一后期编辑 `6b22a2a6`(2026-07-17)在第 64 行,只给 catch 内 throw 加 HINT,**反而强化 catch 路径**,与"有意丢弃 errors"完全矛盾。commit `41e2ac4d` body 自述"与 D2Engine 同型"+"非法 DOT 清晰错误,全通过",证明维护者**照搬 D2Engine 模板**但 viz-js v3 API 契约相反(语法错不抛错返 errors 数组),且**当时误以为 catch 路径已抓到非法 DOT**(测试盲区)。
   - **证据 A(env 更正)**:`env` 块写的"Is directory a git repo: No"是**错的**——media-gen-mcp 实际有完整 `.git`(`ls .git` 可见 COMMIT_EDITMSG/FETCH_HEAD;`git log`/`git blame` 成功)。对 P0-2 是好消息:本未决点不再是阻塞。
   - **证据 B(blame 输出)**:`git -C media-gen-mcp blame -L 60,68 src/diagram/graphviz.ts` → L60-63/65-68 全部 `41e2ac4d`,L64 = `6b22a2a6`。
   - **证据 C(全史)**:`git log --follow -- src/diagram/graphviz.ts` 仅 3 个 commit(`41e2ac4` 首创 / `28e6962` 改 PNG size / `6b22a2a6` 加 HINT),无任何 commit "移除"过 errors 读取。
   - **证据 D(commit body 逐字摘录)**:`41e2ac4d` "Graphviz:新增 GraphvizEngine(@viz-js/viz Graphviz WASM,进程内无浏览器),**与 D2Engine 同型**(lazy singleton + 清晰错误 + resvg PNG)。"+"验证:graphviz SVG/PNG、d2 不回归、mermaid 清晰错误、**非法 DOT 清晰错误,全通过**;无全局污染。" Co-Authored-By: Claude <noreply@anthropic.com>。维护者当时以为 catch 路径已抓到非法 DOT,与实际"produced no SVG"矛盾——证明是测试盲区,非有意。
   - **证据 E(viz-js public API 稳定性)**:`node_modules/@viz-js/viz/types/index.d.ts`(v3.28.0)L52:`render` JSDoc "This method does not throw an error if rendering failed, **including for invalid DOT syntax**, but it will throw for invalid types in input or unexpected runtime errors.";L174:`type RenderResult = SuccessResult | FailureResult`;L179-183:`SuccessResult { status: "success"; output: string; errors: RenderError[] }`;L188-192:`FailureResult { status: "failure"; output: undefined; errors: RenderError[] }`;L208-211:`interface RenderError { level?: "error" | "warning"; message: string }`。npm registry 共 37 版,latest=3.28.0,next=3.0.0-pre.1(无 v4 计划);media-gen-mcp 用 `^3.28.0` caret 不跨 major。GitHub issue 调研(mdaines/viz-js)13 个 errors 相关 issue 无一反映"格式不稳定";最相关 #391(open)讨论"是否升级为 throw",反向证明 errors 是被依赖的稳定 API。
   - **影响**:R2(§7 风险表)降级 🟡 中 → 🟢 低 / 已闭环;§4.5 Step 5 直接执行,无需 Step 0 git blame 前置步骤(已在本次完成)。

2. **D2 JSON 数组 e.message 格式是否长期稳定** — `@terrastruct/d2@0.1.33` 当前 dump 成 `[{range, errmsg}]`,但未来 WASM 版本升级可能换格式。`extractD2Errmsgs` 已做 `try JSON.parse` 失败回退,但若格式变成"非 JSON 的结构化字符串"(如 `Error: at line N: msg`),现有 6 条 rx(基于 errmsg 字段)会全部失配,需重新抓样本补表。**建议**:package.json 锁 `@terrastruct/d2@0.1.33`,升级时强制重跑错误样本抓取脚本。

3. **Vega-Lite compile 对若干非法 spec 静默接受** — 调查实测 `{ mark:{type:"bar"} }`(无 data 无 encoding)和 `{ encoding:{ x:{ field:"a" } } }`(缺 type)compile 都不报错。边界未完整探明,P0-2 的 3 条 Vega pattern 只覆盖**有错报**的形态,**不覆盖静默接受**的形态(后者属于 P1-2 Vega-Lite 官方 Schema 校验范畴)。

4. **resvg 错误形态枚举不完整** — 调查只抓了 3 类(SVG parsing / Font / 误报 root node)。`@napi-rs/resvg-js` 对 SVG-in-SVG / foreignObject / CSS filter 等场景的错误覆盖未深入;resvg 的 rust 源码错误常量集未读。P0-2 首版 2 条 pattern 是最小集,后续根据生产未命中率(`__didMatchLastKnownPattern=false`)渐近补。

5. **PDF 管线错误风格未探** — `src/pdf/*` 的异步 job 失败错误(尤其 `src/index.ts:1261-1270` 已有 `hint: 修正后请重新调用 extract_pdf` 这种类 Archify remediation)格式不统一,P0-2 **不纳入**(范围声明)。建议后续单独 P 项统一。

6. **D2 图标解析失败路径未探** — `src/diagram/d2.ts:20-50 resolveD2Icons` 的 Iconify fetch 失败当前是静默移除 `<image>`,不抛错。P0-2 不改此行为(open_points 记录,用户若想看到碎图告警可后续加 warning)。

7. **`enhanceD2Error` 的 DOT 误入 D2 启发式** — `/^(strict\s+)?(di)?graph\b/mi.test(code.trim()) || /\brankdir\b/mi.test(code)` 是**预编译前**的 input 启发式检测(d2.ts:77-78),不属于 errmsg 归一化范畴。**因 §9 open_point #12(gap-fill #3)决定整体删除 `enhanceD2Error`,本启发式必须在删除前提取**——保留为独立函数(如 `detectDotAsD2(code): string | null`)或 inline 到 d2.ts:132 catch 块前。建议最终归宿是 P1-1 的 DSL pre-flight lint 层,但 P0-2 期内先保留在 d2.ts(行为不变)。详见 §4.4 删除前的提取动作。

8. **是否把 `src/chart.ts:80-85` 预编译守卫也迁入 `knownErrorPatterns.vega-lite`** — 现有 mark:"pie" / mark 无 type 两条守卫是抛清晰错误(优秀范例),P0-2 保留不动。后续可考虑统一到 patterns 表(让 Vega 错误有单一入口),但首版不做以缩范围。

9. **冒烟测试是否接入 `npm test`** — P0-2 交付时 `npm test` 仍只跑 `check-schema.mjs`(保 P0-3 立场)。冒烟测试是 `node --test test/error-format.smoke.mjs` 手动跑。**建议 P0-2 与 P0-3 同批落地**,P0-3 引入 runner 后 P0-2 冒烟测试自动接入 `npm test`。

10. **offending 片段回显的截断长度** — 当前定 120 字符(DSL 行)/ 80 字符(SVG)。若 D2 单行极长(如 style 块内联),120 可能截到中半;是否用 `...` 前后缀指示截断未定,首版简单 `slice(0, 120)`。

---

### 9.1 外部审查新增未决点(已闭环,2026-07-21 gap-fill)

> 以下三条来自 P0-2 文档的外部审查(gap-fill),原文档未列入首批 open_points,但经实测/二进制核实已闭环。原文 + 答案 + 证据完整保留,供落地实施时按图施工。

11. ~~**§4.3.4 跨引擎回退触发器内容匹配方案脆弱**~~(原 §4.3.4 缓解方案) — ✅ **已闭环(2026-07-21 via resvg native 二进制 strings + D2 wasm strings 抓取)**:**触发器三条里有两条与 resvg 实际错误文本对不上,既"防不住误匹配"也"抓不到本意要抓的字体错误"**。v2 升级为 v1(三处 PNG 复用包独立 try/catch + `engineHint`),详见 §4.3.4 重写后的方案。
    - **原文(保留)**:`if (!lastMatched && /SVG data parsing|Font not found|No time to read/i.test(rawMsg)) { ... 走 resvg patterns }`(§4.3.4 跨引擎回退);以及 §4.2.2 resvg patterns 第二条 `rx: /Font not found|No time to read|fontFamily/i`。
    - **答案**:
      1. **误匹配风险(原未决点标的)**:当前 D2 @0.1.33 + 当前 HINT/remediation 文本下,**实际不会被误路由**——D2 wasm 与 HINT 都不抛含这三串的文本。但这是"碰巧"安全,不是"结构"安全。未来最现实风险面:维护者补 d2 HINT 时引用了 'Font not found' 字样(中概率)。
      2. **更严重的问题——触发器与 resvg 实际文本对不上,既漏又误**:'Font not found' 匹配不到 resvg 真实抛的 `default font-family '' not found`(中间隔 `''` 引号,正则要求连续);'No time to read' 在所有相关二进制中都不存在。**跨引擎回退实际只有 'SVG data parsing' 一条有效,意图覆盖的字体加载错误场景完全未覆盖**——这是比误匹配更紧迫的设计缺陷。
      3. **结论**:engine 来源标记(try/catch 物理位置)替代内容猜测是结构性信号,100% 可靠。规划 §4.3.4 已自承"更好方案(P0-2 v2):三处 PNG 复用独立 try/catch 抛 engine:'resvg'",鉴于上面的事实错误,**v2 直接升级为 v1 首版必修**——内容匹配方案既脆弱又基于错误样本,没有保留价值。
    - **证据**:
      - media-gen-mcp `src` 全文 grep `'Font not found|SVG data parsing|No time to read'`:除合法 `fontFamily` 属性 key(`src/index.ts:399/1042`、`src/card.ts` 多处)外,**零错误消息文本命中**。`enhanceD2Error`(d2.ts:75-90)9 条 HINT、`enhanceGraphvizError`(graphviz.ts:33-37)、Vega HINT(chart.ts:99-100/115)均不含这三个串。
      - D2 WASM @0.1.33 严格二进制 grep(`node_modules/@terrastruct/d2/dist/{node-esm,node-cjs}/d2.wasm`,`grep -aoE "Font not found|No time to read|SVG data parsing"`):**三串全部零命中**。D2 是 Go 编译为 WASM,错误文化是 `%s %q %w` 格式串(实测样本:`classes cannot contain an edge`、`failed to parse map key %q: %w`、`maps must be terminated with }`、`connection missing destination`、`%s" is not a valid theme code`、`expected element name after </`、`cannot create edge inside edge`),与 resvg 的 Rust 错误文本文化完全无重叠面。
      - resvg native(`node_modules/@resvg/resvg-js-darwin-x64/resvgjs.darwin.x64.node`,napi-rs 非 WASM):`grep -aoE "Font not found|No time to read|SVG data parsing"` → `'SVG data parsing failed cause'` ✅ 命中(usvg-parser/src/lib.rs);`'Font not found'`(精确连续字串)**❌ 零命中**;`'No time to read'` **❌ 零命中**。resvg 实际字体错误串(grep 抽取):`'default font-family \'\' not found'`(注意中间有 `''`,与 'Font not found' 不连续匹配)、`'No match for \'...\' font-family.'`、`'Failed to load a font face'`、`'malformed font'`、`"font doesn't have a family name"`、`'Warning: The default font-family \'\' not found, set to ...'`(警告非 error)。其他 resvg 错误文化样本:`'the document does not have a root node'`、`'Masking of zero-sized shapes is not allowed'`、`'Invalid \'font-size\' value:'`、`'Image lacks the \'xlink:href\' attribute. Skipped.'`、`'Text layouting failed.'`。
      - viz-js / vega-lite / vega 包内 grep `'Font not found|SVG data parsing|No time to read'`:零命中。
      - PNG 复用 Resvg 调用点(`src/diagram/d2.ts:144-152`、`src/diagram/graphviz.ts:70-78`、`src/chart.ts:106-110`):三处 `new Resvg(...)` + `.render()` 均无独立 try/catch,抛的 resvg 错误被外层 handler 捕获时 engine 参数是 "d2"/"graphviz"/"vega-lite",走不到 resvg patterns 表,只能靠跨引擎回退——而回退触发器又错位。
      - icon 解析路径(`src/diagram/d2.ts:20-50`)用 Resvg 渲染图标 SVG,catch 块第 37-40 行**静默吞**(`catch { d2IconCache.set(key, null); dataUri = null; }`),不泄漏 resvg 错误消息到外层。当前不会引入误匹配,但若未来图标路径改不静默,会放大来源混淆。
      - D2 错误抛出点(`src/diagram/d2.ts:132`):P0-2 后会改回抛裸 errmsg,handler 层 `normalizeEngineError("d2",...)` 接管。迁移后 rawMsg 是裸 D2 Go 错误(如 `maps must be terminated with }`),与三个触发器完全不重叠。
    - **落地动作(给实施者)**:① 三处 PNG 复用包 `try { new Resvg(...).render() } catch (e) { throw new Error("[resvg] " + (e?.message ?? String(e))) }`(轻量方案 A);② `normalizeEngineError` 加 `engineHint?: "resvg"` 参数(或前缀 `/^\[resvg\] /` 识别),优先用 hint 路由;③ §4.2.2 resvg patterns 第二条 rx 基于实测重写(已落地);④ CI 加 grep 防御脚本(已加入 Step 11);⑤ 回归测试加 D2 真实 Go 错误模板样本断言不被误路由(已加入 Step 10)。

12. ~~**§4.4 `enhanceD2Error` 标 @deprecated 但不删,P0-2 首版保守**~~(原 §4.4) — ✅ **已闭环(2026-07-21 via tsconfig + TS 5.9.3 实测)**:一次性在 P0-2 内**删除** `enhanceD2Error`(否决"标 @deprecated 留到下一版")。原方案**技术上不可行**——会直接 break `npm run build`。详见 §4.4 重写后的方案。
    - **原文(保留)**:"保留:`enhanceD2Error` 函数本身不删(P0-2 首版保守,避免一次性删太多)——只是不再被调用。可标 `@deprecated` 注释,P0-2 落地后下一个版本删。"
    - **答案**:`media-gen-mcp/tsconfig.json:15` 设了 `"noUnusedLocals": true`。Step 6 把 `d2.ts:132` 改回抛裸 errmsg 后,`enhanceD2Error`(d2.ts:75-90)在整个仓库零调用方。模块私有非导出函数零引用时 TS 报 `TS6133: 'enhanceD2Error' is declared but its value is never read`,导致 `tsc` 退出码非零 → `npm run build` 失败 → `prepublishOnly`(链跑 build)也失败。JSDoc `@deprecated` **不**抑制 TS6133(已用 media-gen-mcp 自带 TS 5.9.3 实测复现)。HINT 知识已全量迁入 `knownErrorPatterns.d2`(§4.4 对齐清单 9 条 regex 中 7 条 ✅/⚠️/❌→✅ 覆盖、2 条按设计延后),删除函数零信息丢失。
    - **证据**:
      - `tsconfig.json:8,15`:`"strict": true` + `"noUnusedLocals": true`,无 `allowUnreachableCode`/`allowUnusedLabels` 豁免。
      - 全仓 grep `enhanceD2Error`:仅 2 命中(定义 `d2.ts:75` + 唯一调用 `d2.ts:132`),无第三处 → Step 6 后零调用。
      - TS 5.9.3 实测复现(临时目录起同款 tsconfig):Case 1(带 `/** @deprecated */` 的 module-private 函数无调用方,镜像 Step 6 后的 d2.ts)→ `mod.ts(3,10): error TS6133: 'deadFn' is declared but its value is never read.`(tsc 非零退出,`@deprecated` 标签未抑制);Case 2(带 1 个调用方,镜像当前 d2.ts)→ 无 TS6133。**实证 Step 6 一旦改 line 132,build 必崩**。
      - 备选方案对比:方案 A(直接删 16 行纯死代码)胜出;B1(加 `export` 让 noUnusedLocals 不报)污染模块 API 且 @deprecated 导出 API 比删除更难追踪;B2(临时降 `noUnusedLocals: false`)削弱全仓安全网,代价远大于删 16 行。
      - 9 条 regex 迁移清单(§4.4 对齐表):5 条 ✅ 直接覆盖、1 条 ⚠️ pattern 2 超集覆盖、1 条 ❌→✅ pattern 3 扩展覆盖(且 rx 改 `[\w-]+` 覆盖 17 个 style 关键字)、1 条 ❌"首版不补"(open_points)、1 条 ❌"首版不迁"(DOT 启发式,见下条附带发现)。
    - **附带发现(供决策参考,不阻塞 P0-2)**:
      1. 任务描述说"仍 import 在 d2.ts 里"不精确——`enhanceD2Error` 是 d2.ts 内定义的**本地函数**(line 75),不是 import。语义不变(仍是死代码),但文档行文已订正。
      2. **对称问题**:`graphviz.ts:33` `enhanceGraphvizError` **不**受影响——§4.1 修复保留 line 64 catch 块的 wrap(`throw new Error(enhanceGraphvizError(...))`),所以 graphviz 侧函数仍有 1 个调用方,noUnusedLocals 不报。但这造成**契约不对称**(D2 错误裸抛归一化、Graphviz 错误仍带英文 HINT)。若要彻底对齐,P0-2 应同步在 Step 5/6 把 `enhanceGraphvizError` 也迁入 `knownErrorPatterns.graphviz` 表并删除函数——但这是另一议题,原 P2 未决点只问 `enhanceD2Error`,此处仅 flag 供后续决策。
      3. **删除前的提取动作(重要,与 §9 open_point #7 联动)**:`enhanceD2Error` 函数体首行 `if (/^(strict\s+)?(di)?graph\b/mi.test(code.trim()) || /\brankdir\b/mi.test(code))`(d2.ts:77-78)是 **DOT 误入 D2 的预编译启发式**,不是 errmsg 归一化,open_point #7 决定**保留在 d2.ts**。删除 `enhanceD2Error` 时必须**先提取这段启发式**为独立函数或 inline 到 catch 前,然后再删剩余 8 条 errmsg regex。

13. ~~**§4.2.2 pattern 3 的 rx `/(\w+) must be style\.\1/` 仅样本验证 fill/shadow 两例,其余 style 关键字未实测**~~(原 §4.2.2) — ✅ **已闭环(2026-07-21 via 全量 17 个 style 关键字实测 @terrastruct/d2@0.1.33 node v24.12.0)**:D2 对所有 17 个 style 关键字都用同一 errmsg 形态 `<KW> must be style.<KW>`,无任何关键字换其他形态。**真正的 bug 是字符类漏写——`\w+` 不含 `-`,漏 7 个含连字符关键字**。rx 改为 `/([\w-]+) must be style\.\1/`,17/17 全命中。详见 §4.2.2 pattern 3 重写后的注释。
    - **原文(保留)**:D2 errmsg 实际样本仅给了 'fill must be style.fill' 和 'shadow must be style.shadow' 两例,其余 6 个保留字(bold/3d/font-size/opacity 等)是否会触发同形态 errmsg 未实测。
    - **答案**:
      1. **原假设部分证伪**:任务原未决点担心 D2 对其他保留字可能换不同形态(如 "bold is reserved, use style.bold")。**实测证伪**:所有 17 个 D2 style 关键字(远不止文档列的 9 个)触发时,errmsg 都是同一模板 `index:N:N: <KW> must be style.<KW>`。无任何关键字换其他形态。
      2. **真正的 bug——字符类漏写**:JS 的 `\w` 等价 `[A-Za-z0-9_]`,**不含 `-`**。含连字符的 7 个关键字虽然 D2 报了相同形态 errmsg,但原 rx **匹配不上**,落入兜底 raw errmsg 路径——正是任务担心的失败模式,只是根因不是 errmsg 形态不一致,而是字符类漏写。
      3. **修复**:改 `\w+` 为 `[\w-]+`,rx = `/([\w-]+) must be style\.\1/`:17/17 全命中,捕获组每次等于完整关键字(含连字符部分);反向验证 8 条其他形态 errmsg(`expected "X" to be a number` / `missing value after colon` / `maps must be terminated` / `connection missing destination` / `one of ...` / `non-integer width` / `unknown shape` / `direction must be one of`)全部不匹配,无误匹配风险;`3d` 以数字开头也正常(`\w` 含数字);反向引用 `\1` 在含 `-` 关键字下逐一重构对比原文全部 ==true。备选方案 B `(\\S+) must be style\\.\\1` 也 17/17 命中,但 `[\w-]+` 更严(拒绝空格/标点),本规划采 A。
    - **证据**:
      - 实测脚本(`/tmp/d2-tests/`,可复现):`test-keywords.mjs`(喂 25+ 候选关键字给 `D2.compile` 抓 errmsg,3 种触发模式 map 同行/顶层/独立行都验证);`verify-regex.mjs`(原 rx 逐一匹配 17 样本,确认 10 命中/7 漏,7 漏全含 `-`);`verify-fix.mjs`(对比 3 候选 rx 覆盖率:原 10/17、A `[\w-]+` 17/17、B `\S+` 17/17 + 8 负样本反误匹配);`final-verify.mjs`(含 `index:N:N:` 行号前缀的真实 errmsg 形态再验,原 10/17、修复 17/17,捕获组全等于完整 KW)。
      - D2 真实 errmsg 黄金回归(全部 17 个,JSON 数组形态,即 `src/diagram/d2.ts:132` 实际抛的):`[{"range":"index,0:0:0-0:N:N","errmsg":"index:1:1: <KW> must be style.<KW>"}]`,仅 KW 与 range 不同。完整触发清单——无连字符 10 个:fill/stroke/shadow/bold/italic/underline/opacity/filled/multiple/3d;含连字符 7 个:font-size/font-color/stroke-width/stroke-dash/border-radius/text-transform/double-border。
    - **附带发现(同步修)**:`src/diagram/d2.ts:79` 的 `enhanceD2Error` HINT 文本只列了 7 个关键字(`fill/stroke/shadow/font-size/bold/3d/opacity`),实际 D2 style 关键字集合是 17+,HINT 列表本身也不全(漏 italic/underline/filled/multiple/text-transform/font-color/stroke-width/stroke-dash/border-radius/double-border)。P0-2 §4.4 已决定删除 `enhanceD2Error`、HINT 全量迁入 `knownErrorPatterns.d2`,pattern 3 的 `make` 函数 message 文案改为动态回显捕获组 kw(`"${kw}" 是 D2 保留样式关键字...`,不列硬编码清单),避免再次出现"清单不全"的同款问题。
    - **落地可勾选项(全部已写入 §4.5 Step 10 与 §8.3 验收清单)**:
      - [x] §4.2.2 pattern 3 的 rx 改 `/([\w-]+) must be style\.\1/`(1 字符补丁)
      - [x] §4.2.2 pattern 3 的 `make` 函数 message 文案用 `m[1]` 动态回显(已用 `${kw}` 插值)
      - [x] §5.2 冒烟测试加 2 个含连字符关键字的 case(`font-size`、`border-radius`)锁死回归
      - [x] §4.4 迁移清单 pattern 3 行更新为"覆盖 17 个 style 关键字(含 7 个含连字符的),比 enhanceD2Error HINT 文案更全"
