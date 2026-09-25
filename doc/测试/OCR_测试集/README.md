# OCR 测试集(pares5 vision 识图测试)

pares5 vision 模态 `extract_text` 工具的端到端测试样本。8 个用户视角场景,覆盖 `languages` / `digitOnly` / `segmentation` / `layout` 能力轴。详见 [`OCR_对比报告.md`](OCR_对比报告.md) 与 [用户场景测试清单 §⑨](../用户场景测试清单.md)。

## 文件清单

### 可控夹具(7 个,带 ground-truth,精确计分)

由 `gen-fixtures.mjs` 用 `@napi-rs/canvas` + macOS PingFang 程序化渲染;文本写入图片同时落 `<id>.txt` 作 ground-truth。

| 文件 | 场景 | 对应能力轴 |
|---|---|---|
| `s1_manual.png` / `.txt` | 中英混排说明书 | languages=zh+en, layout=natural |
| `s2_digits.png` / `.txt` | 身份证/银行卡/手机号 | digitOnly=true, segmentation=single-line |
| `s3_code.png` / `.txt` | JS 代码截图 | layout=code |
| `s4_receipt.png` / `.txt` | 中文超市小票 | languages=zh-Hans, layout=natural |
| `s6_multilang.png` / `.txt` | 中英日韩包装 | languages=zh+en+ja+ko |
| `s7_chat.png` / `.txt` | 中文微信聊天 | languages=zh-Hans, layout=natural |
| `s8_formula.png` / `.txt` | 数学公式 | layout=plain |

### 真实图(1 个主样本,鲁棒性测试)

| 文件 | 场景 | 来源 / 许可 |
|---|---|---|
| `s5_menu.jpg` | 港式茶餐厅两栏繁体菜单 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:HK_Sheung_Wan_%E5%BE%B7%E9%87%97%E8%A8%98%E8%8C%B6%E9%A4%90%E5%BB%B3_Tak_Chiu_Kee_Restaurant_Menu_02.JPG) · 作者 Hoicelatina · **CC BY-SA 3.0**(署名-相同方式共享) |

### 存档边界样本(2 个,语言不符场景的行为观察)

原始采集的语言不符场景图,保留作「语言/脚本不匹配」行为测试。

| 文件 | 场景 | 来源 / 许可 |
|---|---|---|
| `s4_receipt_real_nl.jpg` | 库拉索岛超市荷兰文小票 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:B%E1%BB%8Dn_Bini_Supermarket_receipt_(2019\)_01.jpg) · 作者 Donald Trung · **CC BY-SA 4.0** |
| `s7_chat_real_bn.jpg` | WhatsApp 风格孟加拉语聊天 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:WeChat_(screenshot_on_Android_device\)_chat_example.jpg) · 作者 Anubhab91 · **CC BY-SA 4.0** |

> **许可声明**:以上 3 张真实图均为 CC BY-SA 协议,再分发/衍生须保留作者署名并以同等协议发布。可控夹具(`gen-fixtures.mjs` 渲染产物)无版权限制。

## 复现方法

```bash
# 1. 重新生成 7 个可控夹具(需 @napi-rs/canvas + macOS PingFang)
node doc/OCR_测试集/gen-fixtures.mjs

# 2. 跑单张 OCR(本 MCP extract_text,经 handler 全链路含 filterIgnoreAreas+applyTbpu)
node doc/OCR_测试集/run-ocr.mjs --image doc/OCR_测试集/s1_manual.png \
  --params '{"languages":["zh-Hans","en"],"layout":"natural"}'

# 3. 智谱基线对比(智谱 MCP 工具)
#    mcp__zai-mcp-server__extract_text_from_screenshot(image_source="<本地路径>")

# 4. tesseract 语言预缓存(首次跑 CJK 场景前)
node -e 'import("tesseract.js").then(async m=>{for(const l of["chi_sim","chi_tra","eng","jpn","kor"]){const w=await m.createWorker(l);await w.terminate();}})'
```

## 复现环境

- tesseract 语言包:`chi_sim` / `chi_tra` / `eng` / `jpn` / `kor` traineddata(进程内 WASM)
- 默认 provider 链:`tesseract → paddle → vlm`;本批次 8/8 走 tesseract 兜底(paddle/vlm 上游未部署)
- 字体:macOS `/System/Library/Fonts/PingFang.ttc`(CJK);Linux/CI 需改 Noto Sans CJK
