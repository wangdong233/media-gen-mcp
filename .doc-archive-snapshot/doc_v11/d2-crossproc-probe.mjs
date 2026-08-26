// 跨进程确定性验证(更严格): 同输入 + 三杠杆,不同 Node 进程之间 byte-identical?
// 用法:node d2-crossproc-probe.mjs  —— 跑多次(各为独立进程)
import { D2 } from "file:///Users/wangdong/Documents/Project/Agnes%20AI%E6%8E%A5%E5%85%A5/media-gen-mcp/node_modules/@terrastruct/d2/dist/node-esm/index.js";

const d2 = new D2();
await d2.ready;

const c = "client -> api: request\napi -> db: query\ndb -> api: result\napi -> client: response";
const compiled = await d2.compile(c);
const svg = await d2.render(compiled.diagram, {
  ...compiled.renderOptions,
  darkThemeID: 1,
  noXMLTag: true,
  salt: "media-gen-mcp-interactive",
});

// DJB2 hash(用于跨进程比对;len + hash 足以判定 byte-identical)
const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(16); };

console.log(`LEN=${svg.length} HASH=${hash(svg)} FIRST_ID=${svg.match(/\bid="([^"]+)"/)?.[1] ?? "none"} TAIL_60=${JSON.stringify(svg.slice(-60))}`);
