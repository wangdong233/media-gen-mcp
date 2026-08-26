# pares1 —— emoji 落盘缓存(功能分析)

> 目标:修掉 emoji 在网络抖动(VPN 代理间歇拦 jsDelivr)时静默失效的问题。
> 现状:emoji(twemoji PNG)仅内存缓存(`emojiDataUriCache` Map),进程重启即失,每次重取;代理拦 → fetch 失败 → `loadAdditionalAsset` 返回 undefined → emoji 空白(tofu)。
> 父文档:[../../parse... ](../../) · 关联实现:`src/card.ts`

---

## 1. 问题复现与根因(已实测)

- 实测:`generate_card` + 🚀 → jsDelivr 通时 SVG 含 emoji base64 图(正常);IP 为 `198.18.4.180`,与拦 GitHub 的 `198.18.5.203` 同属代理段,**代理间歇性服务/拦截 jsDelivr**。
- 拦截时:`emojiToDataUri` fetch 抛错/非 2xx → catch 返回 undefined → Satori 无图 → emoji 空白。**静默降级**,用户不知为何 emoji 没了。
- 根因:**emoji 仅内存缓存**。一次成功取图后,进程重启或代理抖动,都得重新联网。

## 2. 方案(对标 Inter 字体的落盘缓存)

`emojiToDataUri(segment)` 三级查找:
1. **内存缓存**(`emojiDataUriCache`,进程内快路径)→ 命中即返回。
2. **磁盘缓存**(`~/.media-gen-mcp/emoji/{cp}.png`)→ 命中则读盘 + 转 base64 data URI + 回填内存。
3. **CDN 取**(jsDelivr twemoji)→ 成功则写盘 + 回填内存;失败则内存负缓存(本进程内不再重试同 emoji,避免狂打;重启后重试)。

`cp` 计算不变:`[...seg].map(codePointAt).filter(!FE0F).map(hex).join("-")`(滤 variation selector、保留 ZWJ)。

## 3. 收益

- **跨重启 + 跨代理抖动复用**:每个 emoji 只要成功取过一次,永久离线可用(直至用户清缓存)。
- 内存负缓存避免代理 down 时同进程内对同 emoji 反复请求。
- 行为不变:`loadAdditionalAsset` 仍只对 `code==="emoji"` 返回;失败仍返回 undefined(其余卡片正常)。

## 4. 风险与边界

| 风险 | 处理 |
|---|---|
| 磁盘写失败(权限) | try/catch 忽略,不阻断渲染(回退内存/CDN) |
| 缓存膨胀 | 每个 emoji PNG ~1KB,实际用量有限;远期可加 LRU/上限 |
| twemoji 版本/URL 变 | 缓存按 cp 键,URL 变不影响已缓存;新版可手动清 `~/.media-gen-mcp/emoji/` |
| 负缓存导致代理恢复后本进程仍不重试 | 仅进程内负缓存,重启即重试(可接受) |

## 5. 验收

- [ ] emoji 首次取后,`~/.media-gen-mcp/emoji/{cp}.png` 存在。
- [ ] 删 CDN 不可达模拟(断网/改坏 URL)后,已缓存 emoji 仍渲染(磁盘命中)。
- [ ] 未缓存 emoji 在 CDN down 时仍优雅降级(空白,不崩)。
- [ ] 其余卡片功能不回归。
- [ ] 单元/集成/冒烟 + 四维度审查零问题。
