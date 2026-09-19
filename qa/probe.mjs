// Extra probes: compose, planning mid-state, keyboard focus, first-load 10-second view.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = process.argv[2];
const [W, H] = (process.argv[3] ?? "1920x1080").split("x").map(Number);
const PORT = 9433 + (W % 100);
mkdirSync(OUT, { recursive: true });
const chrome = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(OUT, "probe-" + W)}`,
  `--window-size=${W},${H}`, "--hide-scrollbars", "--no-first-run", "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); break; } catch { await sleep(200); } }
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pending = new Map();
ws.addEventListener("message", (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } });
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const run = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const click = (t) => run(`(() => { const b = [...document.querySelectorAll('button')].filter(b => b.innerText.includes(${JSON.stringify(t)})).pop(); b?.click(); return !!b; })()`);
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(OUT, name + ".png"), Buffer.from(r.result.data, "base64")); };
const tab = () => send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 }).then(() => send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 }));

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: "http://localhost:5173" });
await sleep(2500);
await shot(`${W}-p-home`);

// Keyboard focus: tab 3 times, report what has focus and whether it has a visible outline
const focus = [];
for (let i = 0; i < 4; i++) {
  await tab(); await sleep(150);
  focus.push(await run(`(() => { const e = document.activeElement; const s = getComputedStyle(e); return (e.innerText || e.getAttribute('aria-label') || e.tagName).slice(0,40) + ' | outline: ' + s.outlineStyle + ' ' + s.outlineWidth + ' | shadow: ' + (s.boxShadow === 'none' ? 'none' : 'yes'); })()`));
}
await shot(`${W}-p-focus`);

await run(`document.activeElement.blur()`);
await click("Ask Copilot"); await sleep(900);
await shot(`${W}-p-compose`);
await click("Restock what's running low"); await sleep(200);
await click("Plan my basket"); await sleep(450);
await shot(`${W}-p-planning`);
await sleep(3500);
// hover states
const hoverInfo = await run(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.innerText.includes('Pay ₹780')); return b ? getComputedStyle(b).cursor : 'n/a'; })()`);

writeFileSync(join(OUT, `probe-${W}.txt`), ["FOCUS:", ...focus, "cursor on pay: " + hoverInfo].join("\n"));
console.log(["FOCUS:", ...focus, "cursor on pay: " + hoverInfo].join("\n"));
ws.close(); chrome.kill(); process.exit(0);
