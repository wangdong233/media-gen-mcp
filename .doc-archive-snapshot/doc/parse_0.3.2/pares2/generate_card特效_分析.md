# pares2 —— generate_card Satori 特效全面增强(功能分析)

> 目标:把 Satori 能力面内的"酷特效"尽量都加到 generate_card,减少助手逃向 HTML+Chrome 的次数。
> 用户诉求:"Satori 还有哪些特效可加,都考虑添加上。"
> 父文档:[../排期.md](../排期.md) · 关联实现:`src/card.ts`

---

## 1. Satori 能力面调研(实测,0.10.14)

逐一探测每个特效是否被 Satori 接受并在 SVG 产出对应原语:

| 特效 | 支持? | SVG 原语 | 备注 |
|---|---|---|---|
| **渐变文字**(background-clip:text) | ✅ | linearGradient + mask | 文字填渐变色 |
| **文字辉光**(text-shadow) | ✅ | filter | 标题发光 |
| **box-shadow** | ✅ | feGaussianBlur + filter | 容器投影 |
| **border + border-radius** | ✅ | rect + mask | 圆角边框 |
| **transform**(rotate/scale/translate) | ✅ | transform 属性 | 倾斜/缩放 |
| **opacity** | ✅ | opacity | 透明度 |
| **filter:blur** | ✅ | filter | 模糊(背景光斑) |
| **text-decoration**(underline) | ✅ | — | 下划线 |
| **letter-spacing / line-height** | ✅ | — | 已用 |
| **多背景/渐变背景** | ✅ | gradient | 已用(pares2) |

**不支持**:JS 执行(星场需静态 div/SVG 模拟)、动画(静态 SVG)。这两项若必须,才退到 HTML+Chrome。

结论:Satori 能力面已覆盖**绝大多数"酷卡片"特效**。

## 2. 要加的特效与模板(综合取舍)

**A. 跨模板生效的选项(作用于标题):**
- `titleGradient?: string` — 标题文字渐变(CSS gradient 串,如 `linear-gradient(90deg,#f59e0b,#ef4444)`)。实现:`backgroundImage`+`backgroundClip:"text"`+`color:"transparent"`。
- `glow?: boolean | string` — 标题辉光(text-shadow)。`true` 用 accent 派生;字符串则作 text-shadow 值。

**B. 新模板:**
- **`hero`** — 居中大标题(默认渐变+辉光)+ 副标题,可叠模糊光斑(filter:blur 背景blob)做纵深感。**展示型**。
- **`panel`** — 标题/副标题/正文置于一个**玻璃面板**(border + border-radius + box-shadow + 半透明背景)内,浮在背景之上。**卡片感**。

A+B 合计覆盖:渐变文字、辉光、box-shadow、border、border-radius、opacity、filter:blur、background-clip —— 即第 1 节"全部"中视觉有意义的特效。transform(倾斜)较 niche,暂不暴露(可后续加)。

## 3. 执行路径(改动点)

`src/card.ts`:
1. `CardRequest` 加 `titleGradient?` `glow?`;`template` enum 加 `"hero"` `"panel"`;加可选 `panel?`/`blob?` 开关(或模板内默认)。
2. 标题节点样式:有 titleGradient → 叠 clip 渐变;有 glow → 叠 textShadow。
3. 新增 `layoutHero`(居中 + 可选模糊光斑)、`layoutPanel`(内容裹玻璃面板)。

`src/index.ts`:`generate_card` schema 加 `titleGradient` `glow` + template enum 扩展;描述注明。

文档:README 卡片行/特效说明;FAQ 补"卡片能做哪些特效"。

## 4. 与既有约束的兼容

- 多子 div 必须显式 `display:flex`(pares2 教训)→ 新模板同样遵守。
- style 对象不能含 `undefined` 值 → 条件展开。
- 渐变背景(pares2)+ CJK(pares1)+ emoji(pares1/pares2-0.3.2)叠加不冲突。
- 渐变文字用 mask clip;与 emoji(图片)无冲突。

## 5. 验收

- [ ] `titleGradient` → 标题呈渐变色(视觉确认)。
- [ ] `glow` → 标题有辉光(视觉确认)。
- [ ] `hero` 模板出图正常(渐变标题+辉光+光斑)。
- [ ] `panel` 模板出图正常(玻璃面板:边框/圆角/阴影/半透明)。
- [ ] 不回归:og/quote/minimal + CJK + 渐变背景 + emoji 叠加仍正常。
- [ ] 单元/集成/冒烟 + 四维度审查零问题。
