// Phase 1 checks: input fallback, pay modal cancel paths, double taps, event order, presenter bar room.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = process.argv[2];
const [W, H] = (process.argv[3] ?? "1366x768").split("x").map(Number);
const PORT = 9533 + (W % 100);
mkdirSync(OUT, { recursive: true });
const chrome = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(OUT, "p1-" + W)}`,
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
const dbl = (t) => run(`(() => { const b = [...document.querySelectorAll('button')].filter(b => b.innerText.includes(${JSON.stringify(t)})).pop(); b?.click(); b?.click(); return !!b; })()`);
const key = (k) => run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)} }))`);
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(OUT, name + ".png"), Buffer.from(r.result.data, "base64")); };
const card = (i) => run(`document.querySelectorAll('article')[${i}]?.innerText.replace(/\\n+/g,' / ')`);
const events = () => run(`[...document.querySelectorAll('li > button')].map(b => b.innerText.split('\\n').filter(Boolean).slice(0,3).join(' | '))`);
const setGoal = (text) => run(`(() => { const ta = document.querySelector('textarea'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(ta, ${JSON.stringify(text)}); ta.dispatchEvent(new Event('input', { bubbles: true })); return ta.value; })()`);
const r = [];
const check = (label, ok, detail = "") => r.push(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  ::  " + detail : ""}`);

await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: "http://localhost:5173" });
await sleep(2000);

// Clock
const clock = await run(`document.querySelector('.tabular')?.innerText`);
check("status bar shows real time", clock !== "9:41", clock);

// 1.1 typed goal falls back with an explanation
await click("Ask Copilot"); await sleep(600);
await setGoal("buy me 10 kg of rice");
await click("Plan my basket"); await sleep(3000);
const note = await run(`[...document.querySelectorAll('p')].map(p=>p.innerText).find(t => t.startsWith('This demo only has restock data'))`);
check("typed goal shows sample-data note", !!note, note ?? "none");
const goalShown = await run(`[...document.querySelectorAll('p')].map(p=>p.innerText).find(t => t.includes('rice'))`);
check("typed goal is quoted back", !!goalShown, goalShown ?? "");
await shot(`${W}-p1-fallback`);

// Canonical goal shows the real note instead
await key("r"); await sleep(300);
await click("Ask Copilot"); await sleep(600);
await click("Restock what's running low"); await sleep(200);
await click("Plan my basket"); await sleep(4200);
const canon = await run(`[...document.querySelectorAll('p')].map(p=>p.innerText).find(t => t.startsWith('Dal, oil and carry bags'))`);
check("restock goal shows the assistant note", !!canon, canon ?? "none");
await shot(`${W}-p1-basket-note`);
const fits = await run(`(() => { const s = document.querySelector('.overflow-y-auto'); return s ? { over: s.scrollHeight - s.clientHeight, fits: s.scrollHeight - s.clientHeight <= 12 } : null; })()`);
check("basket fits without scrolling (bottom padding may overlap)", fits?.fits === true, JSON.stringify(fits));

// 1.2 cancel paths: X button, Escape, backdrop
for (const how of ["x", "escape", "backdrop"]) {
  await click("Pay ₹780 with Paytm"); await sleep(500);
  if (how === "x") await run(`document.querySelector('[role=dialog] [aria-label=Cancel]').click()`);
  if (how === "escape") await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  if (how === "backdrop") await run(`document.querySelector('.backdrop-blur-\\\\[2px\\\\]').click()`);
  await sleep(500);
  const c0 = await card(0);
  check(`cancel via ${how} returns line to Ready`, c0.includes("Pay ₹780 with Paytm"), c0);
  const created = (await events()).filter((e) => e.includes("Paytm order created")).length;
  check(`cancel via ${how} logs no Paytm order`, created === 0, String(created));
}

// Escape closes the approval sheet
await click("Review"); await sleep(500);
await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`); await sleep(500);
check("Escape closes approval sheet", (await card(1)).includes("Review"));

// 1.3 double tap on Pay opens one checkout and one set of events
const before = (await events()).length;
await dbl("Pay ₹360 with Paytm"); await sleep(600);
check("double tap on Pay opens one checkout", (await run(`document.querySelectorAll("[role=dialog]").length`)) === 1);


await run(`[...document.querySelectorAll('[role=dialog] button')].filter(b=>b.innerText.trim()==='Leave pending').pop().click()`); await sleep(1200);
await dbl("Check again"); await sleep(2600);
const pays = (await events()).filter((e) => e.includes("Marked paid")).length;
check("double tap on Check again marks paid once", pays === 1, `${pays}`);

// cursor
const cursor = await run(`getComputedStyle([...document.querySelectorAll('button')].find(b=>b.innerText.includes('View receipt'))).cursor`);
check("buttons show pointer cursor", cursor === "pointer", cursor);

// 1.4 event times are in order
const times = await run(`[...document.querySelectorAll('li > button span.font-mono')].map(s=>s.innerText)`);
const sorted = [...times].sort();
check("live record times in order", JSON.stringify(times) === JSON.stringify(sorted), times.join(" "));

// presenter bar does not cover the counters or the phone
await key("d"); await sleep(800);
const overlap = await run(`(() => {
  const bar = document.querySelector('.fixed.bottom-3').getBoundingClientRect();
  const tiles = [...document.querySelectorAll('p')].filter(p => p.innerText === 'Decisions asked of the owner').map(p => p.parentElement.getBoundingClientRect());
  const phone = document.querySelector('.rounded-\\\\[56px\\\\]').getBoundingClientRect();
  const hit = (a) => a.bottom > bar.top && a.top < bar.bottom && a.right > bar.left && a.left < bar.right;
  return { counters: tiles.some(hit), phone: hit(phone) };
})()`);
check("presenter bar covers nothing", !overlap.counters && !overlap.phone, JSON.stringify(overlap));
await shot(`${W}-p1-presenter`);
await key("d"); await sleep(400);

check("no console errors or warnings", problems.length === 0, problems.join(" || "));
const report = r.join("\n");
writeFileSync(join(OUT, `phase1-${W}.txt`), report);
console.log(report);
ws.close(); chrome.kill(); process.exit(0);
