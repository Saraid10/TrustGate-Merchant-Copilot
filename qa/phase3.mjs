// Phase 3 checks: landing explanation, counters, the stop banner and the Two endings hand-off.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = process.argv[2];
const [W, H] = (process.argv[3] ?? "1366x768").split("x").map(Number);
const PORT = 9733 + (W % 100);
mkdirSync(OUT, { recursive: true });
const chrome = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(OUT, "p3-" + W)}`,
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
  if (msg.method === "Runtime.exceptionThrown") problems.push("exception: " + msg.params.exceptionDetails.text);
  if (msg.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(msg.params.type))
    problems.push(msg.params.type + ": " + msg.params.args.map((a) => a.value ?? a.description).join(" "));
});
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const run = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const click = (t) => run(`(() => { const b = [...document.querySelectorAll('button')].filter(b => b.innerText.includes(${JSON.stringify(t)})).pop(); b?.click(); return !!b; })()`);
const key = (k) => run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)} }))`);
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(OUT, name + ".png"), Buffer.from(r.result.data, "base64")); };
const text = () => run(`document.body.innerText`);
const bannerUp = () => run(`!!document.querySelector('[role=status]')`);
const activeTab = () => run(`[...document.querySelectorAll('header button')].find(b => b.querySelector('.bg-white'))?.innerText.replace(/\\d/g,'').trim()`);
const r = [];
const check = (label, ok, detail = "") => r.push(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  ::  " + detail : ""}`);

async function plan() {
  await click("Ask Copilot"); await sleep(600);
  await click("Restock what's running low"); await sleep(200);
  await click("Plan my basket");
}

await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: "http://localhost:5173" });
await sleep(2000);

// 3.1 landing
let t = await text();
check("landing shows the problem line", t.includes("AI agents can be tricked into paying."));
check("landing shows three steps", ["Proposes what to buy", "Prices it from the catalogue", "Paytm must confirm"].every((s) => t.includes(s)));
check("landing has no zero counters", !t.includes("Money that did not move") && !t.includes("Paytm orders from stopped lines"));
check("heading is plain English", t.includes("What the server decided") && !/under the hood/i.test(t));
await shot(`${W}-p3-landing`);

// clean run: no banner, no money tile, decisions strip
await plan(); await sleep(4500);
t = await text();
check("clean: no banner", !(await bannerUp()));
check("clean: no money tile", !t.includes("Money that did not move"));
check("clean: decisions shown", t.includes("Decisions asked of the owner"));
check("clean: always-zero counter removed", !t.includes("Paytm orders from stopped lines"));
await shot(`${W}-p3-clean`);

// compromised run: banner timing and content
await key("r"); await sleep(300); await key("c"); await sleep(300);
await plan();
const t0 = Date.now();
let upAt = null;
while (Date.now() - t0 < 6000) {
  if (await bannerUp()) { upAt = Date.now() - t0; break; }
  await sleep(100);
}
check("compromised: banner appears after the reveal", upAt !== null && upAt > 2000 && upAt < 5000, `${upAt}ms`);
await sleep(600);
const banner = await run(`document.querySelector('[role=status]')?.innerText.replace(/\\n+/g,' | ')`);
check("banner says ₹20,000 did not move", !!banner && banner.includes("₹20,000 did not move"), banner);
check("banner names the payee", !!banner && banner.includes("attacker-controlled-supplier"));
await shot(`${W}-p3-banner`);
check("money tile shown under the banner", (await text()).includes("Money that did not move"));

await click("See both endings"); await sleep(800);
check("See both endings opens the tab", (await activeTab()) === "Two endings", await activeTab());
check("banner gone after hand-off", !(await bannerUp()));

// Dismiss path and tab hint
await key("r"); await sleep(300);
check("R returns to the Live tab", (await activeTab()) === "Live", await activeTab());
await plan();
let seen = false; for (let i = 0; i < 60 && !(seen = await bannerUp()); i++) await sleep(100);
check("banner shows again on the next run", seen);
await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`); await sleep(600);
check("Escape dismisses the banner", !(await bannerUp()));
const hint = await run(`!!document.querySelector('header .animate-ping, header .rounded-full.bg-\\\\[var\\\\(--tg-red\\\\)\\\\]')`);
check("Two endings tab shows a hint dot", hint);
await shot(`${W}-p3-after-banner`);

// Auto-hide
await key("r"); await sleep(300);
await plan();
let seen2 = false; for (let i = 0; i < 60 && !(seen2 = await bannerUp()); i++) await sleep(100);
check("banner shows before auto-hide test", seen2);
await sleep(5600);
check("banner hides on its own", !(await bannerUp()));

// R clears everything
await key("r"); await sleep(400);
t = await text();
check("R returns the landing explanation", t.includes("AI agents can be tricked into paying.") && !(await bannerUp()));
const hintAfterReset = await run(`!!document.querySelector('header .animate-ping')`);
check("R clears the tab hint", !hintAfterReset);

check("no console errors or warnings", problems.length === 0, problems.join(" || "));
const report = r.join("\n");
writeFileSync(join(OUT, `phase3-${W}.txt`), report);
console.log(report);
ws.close(); chrome.kill(); process.exit(0);
