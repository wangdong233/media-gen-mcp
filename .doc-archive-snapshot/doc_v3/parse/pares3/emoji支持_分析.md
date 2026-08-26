# pares3 —— emoji 支持(功能分析)

> 迭代目标:generate_card 文本中的 emoji 自动渲染为**彩色 emoji**(非 tofu、非单色轮廓)。
> 来源:0.2.0 已知边界"Satori 不内建彩色 emoji"。父文档:[../排期与里程碑_v3](../排期与里程碑_v3.md)

---

## 1. 问题与目标

- Satori 不内建彩色 emoji 渲染:emoji 字形要么 tofu(无字体覆盖),要么依赖彩色 emoji 字体(Satori 的 opentype.js 不渲染 COLR/CBDT 位图彩色)。
- 目标:卡片任意文本字段(title/subtitle/body/footer)中的 emoji 自动渲染为彩色图片,零配置。

## 2. 技术调研(已实测,关键决策)

### 2.1 Satori 的 emoji 机制(查 README + 实测)
Satori 提供 `loadAdditionalAsset(code, segment)` 异步选项:渲染文本段时若缺字形/图,回调取资源。`code === "emoji"` 时,segment 是该 emoji 字符 → 返回一个**图片源**,Satori 自动把 emoji 作为内联图片嵌入文本流(无需手动拆 run)。

### 2.2 图片源:URL vs data URI(实测关键)
- **URL 不行**:返回 twemoji SVG URL → Satori 在 SVG 输出 `<image href="https://...">` → **resvg 不抓取远程 URL** → PNG 中 emoji 空白(实测复现:只有 "Hello World",emoji 全无)。
- **data URI 行**:返回 `data:image/png;base64,...` → Satori 内联进 SVG → resvg 渲染位图 `<image>` → emoji 正常(实测:🚀🎉 彩色,视觉确认)。
- **SVG-in-SVG 不行**:twemoji SVG data URI 经 resvg 渲染嵌套 SVG 不可靠;改用 **twemoji 72×72 PNG**。

### 2.3 codepoint 转换(twemoji 文件名)
```
cp = [...segment].map(c => c.codePointAt(0)).filter(p => p !== 0xFE0F).map(p => p.toString(16)).join("-")
url = https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${cp}.png
```
- 过滤 variation selector FE0F(twemoji 文件名不含);**保留** ZWJ 200D(序列 emoji 如 👨‍👩‍👧 需要)。
- 实测:🚀→1f680、🎉→1f389、❤️→2764(FE0F 已滤)。

### 2.4 与 CJK 的交互
- Satori 对未覆盖的 CJK 段也会回调(如语言码 `zh-CN`);但 card 已注册 Noto Sans SC,Satori 优先用注册字体,**不会**对 CJK 触发 loadAdditionalAsset。
- 保险:loadAdditionalAsset 仅 `code === "emoji"` 返回图,其余返回 undefined(交注册字体)。

## 3. 执行路径(改动点)

`src/card.ts`:
1. 新增 `emojiToDataUri(seg)`:codepoint 转换 → fetch twemoji PNG → base64 data URI,内存缓存(按 codepoint 键)。
2. satori() 选项加 `loadAdditionalAsset: async (code, segment) => code === "emoji" ? await emojiToDataUri(segment) : undefined`。
3. 全卡片自动生效(无需新参数);emoji fetch 失败 → 返回 undefined → 该 emoji tofu(降级,不阻断,其余正常)。

`src/index.ts`:generate_card 描述补"emoji 自动彩色渲染"。

文档:README 卡片行补 emoji;FAQ 注明 emoji 需联网(twemoji CDN,缓存)。

## 4. 风险与边界

| 风险 | 处理 |
|---|---|
| emoji 需联网取 twemoji | 缓存;失败降级 tofu;文档标注(与 icon 同为联网) |
| 大字号 emoji 清晰度 | 72×72 源,标题字号(≤96px)近 1:1,可接受;远期可换高分辨率源 |
| ZWJ 序列/肤色 emoji | 保留 200D 转 `-`,twemoji 覆盖主流序列;罕见序列可能 404→降级 |
| resvg 不渲染 SVG-in-SVG | 已用 PNG data URI 规避 |

## 5. 验收标准

- [ ] 卡片含 emoji 字段正确渲染彩色 emoji(视觉确认)。
- [ ] 中文 + emoji 混合叠加正确。
- [ ] 非 emoji(CJK)不受影响(仍走 Noto)。
- [ ] emoji fetch 失败降级不崩。
- [ ] 单元/集成/冒烟 + 四维度审查零问题;文档更新。
