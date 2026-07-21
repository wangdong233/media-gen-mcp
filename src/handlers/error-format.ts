/**
 * P0-2:LLM 友好错误契约(handler 层引擎 stderr 归一化)。
 *
 * 消费方是 LLM(Claude),不是人。引擎透传的裸 stderr 形态(D2 JSON 数组 dump、
 * Graphviz "produced no SVG"、Vega "Invalid field type \"undefined\""、resvg
 * "does not have a root node")对 LLM 都不可读,常需 3-5 轮试错才修对一条输入。
 *
 * 本模块把 4 类引擎抛的 raw e.message 经 knownErrorPatterns 表归一化为
 * Archify 同款契约三件套(定位 + 阈值 + 修复动词),供 handler 层重新 throw。
 *
 * 立场:全部 reimplement,零 Archify 代码引用。14 条 pattern 的 rx 与 remediation
 * 文本自写,Archify 仅提供"契约三件套"这一纯范式。详见
 * doc_v11/P0-2-LLM友好错误契约实施规划.md §3.3 借鉴边界。
 */

/** P0-2 支持的引擎枚举(与 knownErrorPatterns 的 key 一一对应)。 */
export type NormalizedEngine = "d2" | "graphviz" | "vega-lite" | "resvg";

/**
 * 归一化后的 LLM 友好错误对象。
 * Archify 契约三件套(path + 阈值 + 修复动词)落到字段:
 *   - line / offendingConstruct → 定位
 *   - message(含阈值) → 问题陈述
 *   - remediation → 修复动词(祈使)
 */
export interface NormalizedError {
  engine: NormalizedEngine;
  /** 出错行号(1-based)。D2/Graphviz 有行概念;Vega-Lite/resvg 多为 undefined。 */
  line?: number;
  /**
   * 出错构造的回显片段(降低 LLM 定位成本)。
   * - D2/Graphviz:出错行原文(截断到 120 字符)。
   * - Vega-Lite:出错的 encoding channel 或 mark 字段路径(如 encoding.theta.type)。
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
  /** 原始 raw message(未解析前的 e.message,调试 + 行号回显用)。 */
  raw: string;
}

// ───────────────────────── helper(模块私有,纯函数,对越界/空输入永不抛)─────────────────────────

/**
 * 从 D2 错误信息解析行号。
 *
 * 优先解析 errmsg 字段的 1-indexed 行号(格式 `index:N:col:`),因为这是用户实际看到的形式;
 * fallback 解析 range 字段(`"range":"index,L:C:O-L:C:O"`)并 +1 修正(range 是 0-indexed)。
 *
 * 输入可以是完整 JSON 数组字符串,或单条 errmsg —— `index:N:` 在两种形态里都唯一可识别
 * (range 字段用逗号分隔 `index,N:C`,不会与 errmsg 的 `index:N:` 冲突)。
 *
 * PRD §4.2.3 原写只解析 range 字段且未做 +1 修正,实测对真实 D2 输出会得到 line 0
 * (errmsg 显示 line 1)—— 实施阶段实测发现并订正。
 */
function pickD2Line(rawJsonOrMsg: string): number | undefined {
  // 优先:errmsg 格式 'index:N:col:'(1-indexed,用户实际看到的形式)
  const m1 = rawJsonOrMsg.match(/index:(\d+):/);
  if (m1) return Number(m1[1]);
  // Fallback:range 字段 `"range":"index,L:C:O-..."`(0-indexed,+1 修正)
  const m2 = rawJsonOrMsg.match(/"range":"[^,]*,(\d+):\d+/);
  return m2 ? Number(m2[1]) + 1 : undefined;
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

/** 找最可能未闭合的 `{`(简化版:找最后一个含 `{` 的行,配合全局深度判断)。 */
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

// ───────────────────────── knownErrorPatterns(首版 14 条,全部带实测样本)─────────────────────────

export const knownErrorPatterns: Record<NormalizedEngine, KnownErrorPattern[]> = {
  // ───────────────────────── D2(6 条)─────────────────────────
  // D2 底层 e.message 是 JSON 数组字符串,normalizeEngineError 内部先 try JSON.parse,
  // 取每条 entry.errmsg 走 patterns(下方 rx 都匹配 errmsg 字段,不含外层 JSON 壳)。
  d2: [
    {
      // 实测样本 errmsg: index:2:23: expected "stroke-width" to be a number between 0 and 15
      // ⚠️ rx 用 `[\w-]+` 而非 `\w+`:与 pattern 3 同款 bug —— D2 数值属性的 prop 名大量含连字符
      //    (stroke-width / font-size / border-radius / stroke-dash),`\w` 不含 `-` 会全部漏匹配。
      //    PRD §4.2.2 原写 `\w+` 是该 bug 的源头,实施阶段实测发现并订正。
      rx: /expected "([\w-]+)" to be a number between (\d+) and (\d+)/,
      make: (m, ctx) => {
        const prop = m[1];
        const lo = m[2];
        const hi = m[3];
        const line = pickD2Line(ctx.raw);
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
      // 实测样本 errmsg: fill must be style.fill(原 enhanceD2Error regex 漏;含连字符的 7 个关键字也漏)
      // 触发输入: a: { shape: oval; fill: red }  (D2 要求属性单独一行,同行多属性把 fill 当 shape 名)
      //
      // ✅ 实测全量覆盖(@terrastruct/d2@0.1.33,node v24.12.0,17 个 style 关键字逐一验证):
      //   - 无连字符 10 个:fill/stroke/shadow/bold/italic/underline/opacity/filled/multiple/3d
      //   - 含连字符 7 个:font-size/font-color/stroke-width/stroke-dash/border-radius/text-transform/double-border
      //   全部触发同一模板 `index:N:N: <KW> must be style.<KW>`,仅 KW 与 range 不同;无任何关键字换形态。
      // ⚠️ rx 用 `[\w-]+` 而非 `\w+`:JS 的 `\w` 等价 `[A-Za-z0-9_]` **不含 `-`**。
      //    原 `\w+` 漏 7 个含连字符关键字(font-size/font-color/stroke-width/stroke-dash/
      //    border-radius/text-transform/double-border)。
      rx: /([\w-]+) must be style\.\1/,
      make: (m, _ctx) => {
        const kw = m[1];
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
  // 前置条件:graphviz.ts:60-68 bug 已修(读取 result.errors),否则 rawMsg 永远是
  // "produced no SVG",根本进不到 patterns 表。
  graphviz: [
    {
      // 实测样本(修复后): syntax error in line 1 near '}'
      rx: /syntax error in line (\d+) near '([^']+)'/,
      make: (m, ctx) => {
        const line = Number(m[1]);
        const token = m[2];
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
      // 实测样本: Invalid field type "undefined"
      // 触发输入实测(type:"quant" 不触发,被静默接受为 quantitative 缩写;真触发是
      // type:"quantitativ" 拼写错 / type:"foo" 任意无效串 / type:null):
      //   { mark:"bar", encoding:{ x:{ field:"a", type:"quantitativ" } } }
      // 详见 pares2/01-功能分析.md §9.1 open_point #14(样本订正)。
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
        // P0-2 第 2 轮审查修复:chart handler 传 Vega-Lite spec 对象作为 ctx.input
        // (src/index.ts:1008 `{ input: a.spec as Record<string,unknown>, ... }`),
        // 裸 `(ctx.input as string).slice` 会抛 TypeError: ctx.input.slice is not a function,
        // 穿透到顶层 catch 违反 PRD §1.2.4 + §3.2 反崩溃契约(/TypeError|Cannot read/ 禁穿透)。
        // 防御:字符串照旧;对象则 JSON.stringify 成可读片段,既有诊断价值又不崩。
        offendingConstruct: (typeof ctx.input === "string"
          ? ctx.input
          : JSON.stringify(ctx.input)
        ).slice(0, 80),
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
      // ⚠️ 原计划 rx `/Font not found|No time to read|fontFamily/i` 与 resvg 实际错误文本对不上:
      //    - 精确连续字串 'Font not found' 在 native 二进制中**零命中**(resvg 抛的是
      //      `default font-family '' not found`,中间隔 `''` 引号,正则要求连续不匹配)。
      //    - 'No time to read' 在 resvg / D2 wasm / doc/ **全部零命中** —— 疑似凭印象误写。
      // ⚠️ PRD §4.2.2 原写 `[^']{0,5}` 排除单引号也是 bug:resvg 实际消息**中间就是有 '' 引号**,
      //    排除单引号会让真消息反而匹配不上。实施阶段实测发现并订正为 `.{0,15}`(允许引号 + 短距离)。
      rx: /default font-family.{0,15}not found|No match for.{0,30}font-family|Failed to load a font face|malformed font|font doesn't have a family name/i,
      make: (m, _ctx) => ({
        message: `字体加载失败(底层信息:${m[0]})。`,
        remediation:
          "改用系统已装字体(如 PingFang SC / Noto Sans CJK / Microsoft YaHei),或经 generate_card 的 fontPath 参数传本地 .ttf/.otf 文件路径。",
      }),
    },
  ],
};

// ───────────────────────── 主入口 ─────────────────────────

let lastMatched = false; // 供 __didMatchLastKnownPattern() 读

/**
 * 主入口:把 engine 抛的 raw message 解析成 LLM 友好文本。
 *
 * @param engine 引擎名(决定走哪张 patterns 表)
 * @param rawMsg engine 抛的 e.message(D2 是 JSON 数组字符串、Graphviz 是 `syntax error...`、
 *             Vega 是 `Invalid field type...`、resvg 是 `SVG data parsing failed...`)
 * @param ctx 上下文(回显 offending 片段用)
 * @param engineHint 可选引擎来源标记(结构性信号,优先于 `engine` 参数路由)。
 *                   用于三处 PNG 复用路径(`d2.ts:146`、`graphviz.ts:71`、`chart.ts:108`)
 *                   抛出的 resvg 错误 —— 外层 handler 捕获时 `engine` 是 "d2"/"graphviz"/"vega-lite",
 *                   但物理来源是 resvg。此时传 `engineHint: "resvg"`(或识别 `[resvg]` 前缀),
 *                   跳过 d2/graphviz/vega-lite patterns 表,直接走 resvg patterns 表。
 * @returns 单行可读字符串(失败兜底返回 rawMsg 原样,绝不抛)
 */
export function normalizeEngineError(
  engine: NormalizedEngine,
  rawMsg: string,
  ctx: ErrorContext,
  engineHint?: NormalizedEngine,
): string {
  // 优先用结构性 hint 路由(替代旧版"按 rawMsg 内容猜测路由"的脆弱方案)
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
        // 注意:不覆盖 ctx.raw —— make 函数内 pickD2Line 需要从原始 rawMsg(D2 的 JSON 数组
        // 字符串)里解析 entry.range 提取行号;若覆盖为 candidate(单条 errmsg 字符串)
        // 则 JSON 壳丢失、行号永远 undefined。PRD §4.2.4 骨架写的 `{ ...ctx, raw: candidate }`
        // 与 §4.2.3 helper 注释"raw 是整个 e.message(JSON 数组字符串)"自相矛盾,本实现采 §4.2.3。
        //
        // P0-2 第 2 轮审查修复(反崩溃契约兜底):p.make 是模式表自写代码,任何意外输入形态
        // 都可能在 make 内抛 TypeError(如 resvg pattern 1 历史 bug:对象 ctx.input 调 .slice)。
        // PRD §1.2.4 + §3.2 反崩溃契约要求 /TypeError|Cannot read|is not a function/ 禁穿透,
        // 此处加 try/catch 守住契约 —— make 抛错时回退到 rawMsg 兜底,绝不冒到顶层 catch。
        try {
          const partial = p.make(m, ctx);
          return formatNormalized({ ...partial, engine: routeEngine });
        } catch (makeErr) {
          return `[${routeEngine}] ${rawMsg}\n(已识别错误形态但归一化失败,请把此消息反馈给 media-gen-mcp 维护者。make error: ${String((makeErr as Error)?.message ?? makeErr).slice(0, 120)})`;
        }
      }
    }
  }

  // 兜底:未命中任何 pattern,返回原 rawMsg + 标记(反崩溃契约,绝不抛)
  // P0-2 测试工程师修复(R3 F1 medium):与 make 函数/主函数 make 调用层的 R2 同源修复对称 ——
  // 兜底分支原 `String(ctx.input).slice(0, 80)` 对 object ctx.input(Vega-Lite spec 对象,
  // generate_chart handler src/index.ts:1008 传入)输出字面 "[object Object]",失去诊断价值。
  // 触发路径真实可达:Vega-Lite 错误形态多样,落到兜底是常态。修复:对象用 JSON.stringify。
  const inputPreview = typeof ctx.input === "string"
    ? ctx.input
    : JSON.stringify(ctx.input);
  return `[${engine}] ${rawMsg}\n(未识别的错误形态,请把此消息反馈给 media-gen-mcp 维护者补 knownErrorPatterns 表。原始输入前 80 字符:${inputPreview.slice(0, 80)})`;
}

/** 供测试与渐近积累用:返回是否命中已知 pattern(未命中时可写日志)。 */
export function __didMatchLastKnownPattern(): boolean {
  return lastMatched;
}
