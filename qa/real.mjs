// Real-backend checks: the built app served at /app, talking to a backend over HTTP.
//   node qa/real.mjs <outDir> [WxH] [baseUrl]     (baseUrl default http://127.0.0.1:8010)
// Point baseUrl at Saransh's backend (http://127.0.0.1:8000) for the joint run.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = process.argv[2];
const [W, H] = (process.argv[3] ?? "1366x768").split("x").map(Number);
const BASE = (process.argv[4] ?? "http://127.0.0.1:8010").replace(/\/$/, "");
const MOCK = BASE.endsWith(":8010");
const PORT = 9833 + (W % 100);
mkdirSync(OUT, { recursive: true });
const chrome = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(OUT, "real-" + W)}`,
  `--window-size=${W},${H}`, "--hide-scrollbars", "--no-first-run", "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); break; } catch { await sleep(200); } }
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pending = new Map(); const problems = [];
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === "Runtime.exceptionThrown") problems.push("exception: " + msg.params.exceptionDetails.text + " " + (msg.params.exceptionDetails.exception?.description ?? ""));
  if (msg.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(msg.params.type))
    problems.push(msg.params.type + ": " + msg.params.args.map((a) => a.value ?? a.description).join(" "));
});
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const run = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const click = (t) => run(`(() => { const b = [...document.querySelectorAll('button')].filter(b => b.innerText.includes(${JSON.stringify(t)})).pop(); b?.click(); return !!b; })()`);
const key = (k) => run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)} }))`);
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(OUT, name + ".png"), Buffer.from(r.result.data, "base64")); };
const chip = () => run(`[...document.querySelectorAll('header span')].map(s => s.innerText).find(t => t.startsWith('Assistant:'))`);
const card = (i) => run(`document.querySelectorAll('article')[${i}]?.innerText.replace(/\\n+/g,' / ')`);
const serverMode = async () => (await (await fetch(`${BASE}/api/v1/merchant/store`)).json()).assistant_mode;
const r = [];
const check = (label, ok, detail = "") => r.push(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  ::  " + detail : ""}`);
const until = async (fn, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(100); } return null; };

await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });

// Start from a known mode on the server.
await fetch(`${BASE}/api/v1/merchant/demo/mode`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ assistant_mode: "LIVE" }) });
await send("Page.navigate", { url: `${BASE}/app/` });
await sleep(2500);

check("app loads from /app", (await run(`document.body.innerText`)).includes("Good morning"));
check("chip shows the server's mode, not 'sample data'", (await chip()) === "Assistant: LIVE", await chip());

// A failed mode call must leave the chip alone.
if (MOCK) {
  await fetch(`${BASE}/__test/fail-next-mode`, { method: "POST" });
  await key("c"); await sleep(900);
  check("failed mode call: chip unchanged", (await chip()) === "Assistant: LIVE", await chip());
  check("failed mode call: server unchanged", (await serverMode()) === "LIVE");
}

// C goes to the server first; the chip follows the answer.
await key("c");
const red = await until(async () => (await chip()) === "Assistant: COMPROMISED");
check("C: chip turns red after the server", !!red && (await serverMode()) === "COMPROMISED", `${await chip()} / server ${await serverMode()}`);

// Compromised run over HTTP + SSE
await click("Ask Copilot"); await sleep(700);
await click("Restock what's running low"); await sleep(200);
await click("Plan my basket");
const three = await until(async () => (await run(`document.querySelectorAll('article').length`)) === 3, 8000);
check("basket from the server: three cards", !!three);
await sleep(1500);
const s = await run(`(() => ({
  mark: document.querySelector('mark')?.innerText,
  cardNote: [...document.querySelectorAll('article p')].find(p => p.innerText.includes('product listing'))?.innerText,
  stripe: [...document.querySelectorAll('p')].find(p => p.innerText.includes('to attacker-controlled-supplier'))?.innerText,
  log: document.querySelectorAll('li > button').length,
}))()`);
check("listing from the discard event is shown and marked", !!s.mark && s.mark.startsWith("TRUSTGATE_DEMO_INJECTION:"), s.mark);
check("stopped card names the source", !!s.cardNote, s.cardNote);
check("₹20,000 strip shown", !!s.stripe, s.stripe);
// Eight, not the stand-in's nine. The stand-in narrates the pricing step; the real server
// only shows rows it actually wrote, and never invents one to make the panel read better.
check("live record filled from the event stream", s.log >= 8, String(s.log));
const banner = await until(async () => run(`document.querySelector('[role=status]')?.innerText`), 5000);
check("banner appears", !!banner && banner.includes("₹20,000 did not move"));
await shot(`${W}-real-compromised`);
await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`); await sleep(500);

// Pay the dal through the checkout frame and the callback round trip.
await click("Pay ₹780 with Paytm");
const frame = await until(async () => run(`document.querySelector('[role=dialog] iframe')?.src`), 4000);
check("pay opens the server's checkout in the modal", !!frame && frame.includes("/sim/checkout?orderId="), frame);
await sleep(800);
await shot(`${W}-real-checkout`);
if (MOCK) {
  await run(`document.querySelector('[role=dialog] iframe').contentDocument.getElementById('sim-pay').click()`);
} else {
  console.log("Real backend: click Pay inside the checkout within 20 seconds...");
}
const paid = await until(async () => (await card(0))?.includes("Paid · confirmed by Paytm"), MOCK ? 8000 : 20000);
check("callback returns, modal closes, line confirmed paid", !!paid, await card(0));
await sleep(700); // let the modal finish its close animation
check("modal closed", !(await run(`!!document.querySelector('[role=dialog]')`)));
const nested = await run(`!!document.querySelector('iframe')`);
check("no nested app left on screen", !nested);

// Cancel on the real backend: the order exists, so the UI must not claim Ready.
await click("Review"); await sleep(500);
await run(`[...document.querySelectorAll('[role=dialog] button')].filter(b=>b.innerText.trim()==='Approve').pop().click()`);
await until(async () => (await card(1))?.includes("Pay ₹1,850 with Paytm"), 4000);
await click("Pay ₹1,850 with Paytm");
await until(async () => run(`!!document.querySelector('[role=dialog] iframe')`), 4000);
await run(`document.querySelector('[role=dialog] [aria-label=Cancel]').click()`); await sleep(800);
const c1 = await card(1);
check("cancel: line says not confirmed, not Ready", c1.includes("Paytm hasn't confirmed yet") && c1.includes("Check again") && !c1.includes("Pay ₹1,850"), c1);
await click("Check again");
await sleep(1500);
const c1b = await card(1);
check("check again: server says still unconfirmed", c1b.includes("Paytm hasn't confirmed yet"), c1b);
await shot(`${W}-real-cancel`);

// R, and C back to LIVE through the server.
await key("r"); await sleep(500);
check("R returns home", (await run(`document.body.innerText`)).includes("Good morning"));
await key("c");
const live = await until(async () => (await chip()) === "Assistant: LIVE");
check("C again: back to LIVE via the server", !!live && (await serverMode()) === "LIVE");

check("no console errors or warnings", problems.length === 0, problems.join(" || "));
const report = r.join("\n");
writeFileSync(join(OUT, `real-${W}.txt`), report);
console.log(report);
ws.close(); chrome.kill(); process.exit(0);
