# pares1 —— CJK 字体内置(功能分析)

> 迭代目标:让 generate_card 在**离线、开箱即用**前提下正确渲染中文(及混合中英文),无需用户手动传 fontPath。
> 来源:0.2.0 已知边界"默认 Inter 仅 Latin,中文卡片需 fontPath 指向 CJK 字体"。本迭代消除该限制。
> 父文档:[../排期与里程碑 v3](../) · 关联实现:`src/card.ts`

---

## 1. 问题与目标

### 1.1 现状(0.2.0)
- `generate_card` 默认字体 Inter,从 jsDelivr @fontsource 取 Latin 子集(Latin-only)。
- 中文/中日韩字符不在 Inter 字形覆盖内 → 渲染为 **tofu(缺字矩形)**。
- 当前唯一解法:用户传 `fontPath` 指向本地 CJK 字体(.ttf/.otf/.woff)。摩擦高,违背"内置/开箱即用"。

### 1.2 目标(pares1)
- generate_card 检测到文本含 CJK 时,**自动**加载内置 CJK 字体并正确渲染,零配置、离线可用。
- 不破坏既有:无 CJK 文本仍只用 Inter(避免无谓加载 3.2MB);`fontPath` 覆盖仍生效。

---

## 2. 架构梳理与执行路径

### 2.1 字体源选型(已调查确定)

| 候选 | 结论 |
|---|---|
| 打包原始 Noto Sans SC 全集(~16MB OTF / ~5MB woff2) | 体积过大 ✗ |
| 自建 GB2312 子集 | 需 fonttools 工具链,构建复杂 ✗ |
| **依赖 `@fontsource/noto-sans-sc`,读其 `chinese-simplified` 子集** | ✅ 选用 |

- `@fontsource/noto-sans-sc@5.2.9` 已加为 dependency → 包安装时随 deps 进入 `node_modules`,**离线可用**(满足"内置":随包分发,运行时不联网)。
- `chinese-simplified` 子集是**单文件**(覆盖常用简体),400+700 两权重各 ~1.6MB(woff)。
- **关键约束**:必须用 `.woff`,**不能用 `.woff2`** —— Satori 的 opentype 解析器(`@shuding/opentype.js`)不支持 woff2,报 `Unsupported OpenType signature wOF2`(已实测)。

### 2.2 运行时定位字体文件(已实测)

```
createRequire(import.meta.url).resolve("@fontsource/noto-sans-sc/package.json")
→ path.dirname(...) + "/files/noto-sans-sc-chinese-simplified-{weight}-normal.woff"
```
- `resolve('pkg/package.json')` 绕过 `exports` 限制(package.json 总可解析),手动拼 `files/` 子路径直读磁盘。
- 失败(包未安装/路径变)→ 跳过 CJK 字体,降级为仅 Inter(中文回退 tofu,英文正常),不阻断渲染。

### 2.3 Satori 多字体回退(已实测)

- **错误做法**:多个字体用**相同 `name`**(如都叫 "Card")→ Satori 仅认第一个,其余被遮蔽 → CJK tofu(首次实测复现)。
- **正确做法**:字体用**各自 family 名**("Inter" / "Noto Sans SC"),文本 `fontFamily: "Inter, Noto Sans SC"`(逗号栈)。Satori **逐字形回退**:Inter 无该字形 → 用 Noto Sans SC。
- 实测:`设计平静的软件 · Designing Calm Software` 渲染正确,中文为正常字形、英文正常。

### 2.4 CJK 检测

- 正则 `/[一-鿿㐀-䶿]/`(CJK 统一表意 + 扩展 A)扫 title/subtitle/body/footer 任一含 CJK → 标记 needsCJK。
- needsCJK=false 时只加载 Inter(避免无谓 3.2MB 读盘)。

### 2.5 执行路径(实现改动点)

`src/card.ts`:
1. 新增 `hasCJK(text)` 与 `loadCJKFonts()`(读 @fontsource woff,内存缓存)。
2. `renderCard` 中:
   - 计算 needsCJK = 任一字段 hasCJK。
   - base family:fontPath → 用户 fontFamily(默认 "Card");否则 "Inter"。
   - fontFamily 栈:needsCJK 时 `"{base}, Noto Sans SC"`,否则 `"{base}"`。
   - fonts 数组:base 字体(400+700) [+ Noto Sans SC 400+700 if needsCJK]。
   - 所有文本节点 style 设 `fontFamily` 为该栈。
3. `fontPath` 覆盖保留;needsCJK 时即便 fontPath 也叠加 Noto SC 兜底(用户传 Latin 字体但文本含中文也能渲染)。

`src/index.ts`:无 schema 改动(CJK 自动);描述可选补一句"自动支持中文"。

文档:8 语言 README generate_card 行去掉"中文需 fontPath"限制说明(改为"自动支持中文,可 fontPath 覆盖")。

---

## 3. 数据/体积影响

- npm 包:`@fontsource/noto-sans-sc` 作为 dep 加入(node_modules ~74MB 全集,但仅按需读 chinese-simplified 两文件 ~3.2MB;包 tarball 不含 node_modules,体积不增)。
- 运行时内存:首次 CJK 卡片读 3.2MB → ArrayBuffer 缓存,后续复用。
- 离线:包安装后字体随 deps 存在,无需联网(对比 0.2.0 默认 Inter 仍需 CDN 首取)。

---

## 4. 风险与边界

| 风险 | 处理 |
|---|---|
| @fontsource `files/` 路径未来变动 | resolve 失败 → 降级 Inter,不崩 |
| 罕见 CJK 字形不在 chinese-simplified 子集 | 该字回退 tofu(英文/常用中文正常);可后续加全量子集 |
| npx 未安装可选 deps | @fontsource 是普通 dependency,正常安装;resolve 兜底 |
| woff2 误用 | 代码固定读 `.woff`;review 卡此项 |

---

## 5. 验收标准

- [ ] 中文/混合文本卡片正确渲染(视觉验证无 tofu)。
- [ ] 纯英文卡片不加载 CJK 字体(needsCJK=false)。
- [ ] fontPath 覆盖仍工作;needsCJK 时 fontPath+中文仍渲染。
- [ ] @fontsource 不可用时降级不崩。
- [ ] 单元 + 集成 + 冒烟测试通过;四维度审查零问题。
- [ ] 文档更新(README + 排期 + 本分析)。
