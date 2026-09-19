// Drives a headless Chrome over CDP to walk the demo and save screenshots.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = process.argv[2];
const [W, H] = (process.argv[3] ?? "1920x1080").split("x").map(Number);
const PORT = 9333 + (W % 100);
mkdirSync(OUT, { recursive: true });

const chrome = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(OUT, "profile-" + W)}`,
  `--window-size=${W},${H}`, "--hide-scrollbars", "--no-first-run", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); break; } catch { await sleep(200); }
}
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));

let id = 0;
const pending = new Map();
const problems = [];
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === "Runtime.exceptionThrown") problems.push("exception: " + msg.params.exceptionDetails.text + " " + (msg.params.exceptionDetails.exception?.description ?? ""));
  if (msg.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(msg.params.type))
    problems.push(msg.params.type + ": " + msg.params.args.map((a) => a.value ?? a.description).join(" "));
  if (msg.method === "Log.entryAdded" && ["error", "warning"].includes(msg.params.entry.level))
    problems.push("log " + msg.params.entry.level + ": " + msg.params.entry.text);
});
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const run = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const click = (text) => run(`(() => { const b = [...document.querySelectorAll('button')].filter(b => b.innerText.includes(${JSON.stringify(text)})).pop(); b?.click(); return !!b; })()`);
const dialogClick = (text) => run(`(() => { const b = [...document.querySelectorAll('[role=dialog] button')].filter(b => b.innerText.trim() === ${JSON.stringify(text)}).pop(); b?.click(); return !!b; })()`);
const key = (k) => run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)} }))`);
const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(OUT, name + ".png"), Buffer.from(r.result.data, "base64"));
  console.log("saved", name);
};

await send("Runtime.enable");
await send("Log.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: "http://localhost:5173" });
await sleep(2000);

const steps = [];
const log = (label, v) => { steps.push(`${label}: ${JSON.stringify(v)}`); };

// Clean run
await shot(`${W}-home`);
log("restock", await click("Ask Copilot")); await sleep(600);
log("chip", await click("Restock what's running low")); await sleep(200);
log("plan", await click("Plan my basket")); await sleep(3500);
log("screens on phone", await run(`document.querySelector('.rounded-\\\\[44px\\\\] > div.absolute.inset-0').children.length`));
log("strip", await run(`document.querySelector('footer p')?.innerText.replace(/\\n+/g,' ')`));
await shot(`${W}-basket-clean`);

// Approve and pay the oil
log("review", await click("Review")); await sleep(600);
await shot(`${W}-approval-sheet`);
log("approve", await dialogClick("Approve")); await sleep(900);
log("pay oil", await click("Pay ₹1,850 with Paytm")); await sleep(600);
await shot(`${W}-pay-modal`);
log("modal pay", await dialogClick("Pay")); await sleep(2500);
log("strip after", await run(`document.querySelector('footer p')?.innerText.replace(/\\n+/g,' ')`));
await shot(`${W}-oil-paid`);

// Compromised run
await key("r"); await sleep(300);
await key("c"); await sleep(300);
await click("Ask Copilot"); await sleep(600);
await click("Restock what's running low"); await sleep(200);
await click("Plan my basket"); await sleep(4500);
log("compromised strip", await run(`document.querySelector('footer p')?.innerText.replace(/\\n+/g,' ')`));
log("money counter", await run(`[...document.querySelectorAll('p')].find(p => p.innerText === 'Money that did not move')?.nextElementSibling?.innerText`));
await shot(`${W}-basket-compromised`);

await click("Pay ₹780 with Paytm"); await sleep(600);
await dialogClick("Pay"); await sleep(2500);
await click("View receipt"); await sleep(1500);
await shot(`${W}-receipt`);

await key("2"); await sleep(2500);
await shot(`${W}-two-endings`);
await key("3"); await sleep(1500);
await shot(`${W}-scorecard`);

await key("r"); await sleep(100);
log("after R screens", await run(`document.querySelector('.rounded-\\\\[44px\\\\] > div.absolute.inset-0').children.length`));
log("after R events", await run(`document.querySelectorAll('li > button').length`));

// Anything overflowing the viewport?
log("page overflow", await run(`({ x: document.documentElement.scrollWidth > innerWidth, y: document.documentElement.scrollHeight > innerHeight })`));

writeFileSync(join(OUT, `report-${W}.txt`), [...steps, "", "PROBLEMS:", ...(problems.length ? problems : ["none"])].join("\n"));
console.log(steps.join("\n"));
console.log("PROBLEMS:", problems.length ? problems.join("\n") : "none");
ws.close();
chrome.kill();
process.exit(0);
