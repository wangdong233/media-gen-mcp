// pdfjs-dist 可选依赖类型 shim。
//
// 背景:pdfjs-dist 是 optionalDependencies(终端用户不需要 PDF 时不强求安装)。
// 其子路径 `pdfjs-dist/legacy/build/pdf.mjs` 的类型声明,在某些 Node + npm 组合下
// 不可解析 —— CI Node 20 job 实测报:
//   `Cannot find module 'pdfjs-dist/legacy/build/pdf.mjs' or its corresponding type declarations.`
// (Node 22 job 正常;本地 macOS 也正常。差异来自 Node 20 环境 optionalDep 的 exports/类型解析。)
//
// 修法理由:可选依赖的类型缺失/不可解析 **不应让 build 硬失败**。
// pdfjs-loader.ts 用自定义 PdfjsModule 接口 + `as unknown as PdfjsModule` 断言,
// 不依赖 pdfjs 自带类型 —— 故把该子路径 ambient 声明为 any 即可,build 对
// pdfjs-dist 是否安装 / 类型是否可解析 完全免疫。运行时缺失已由 loadPdfjs 的
// try/catch 优雅降级(抛 PDFJS_INSTALL_HINT)。
declare module "pdfjs-dist/legacy/build/pdf.mjs";
