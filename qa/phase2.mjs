// Phase 2 checks: reveal order during planning, the malicious listing, the discarded-field strip.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = process.argv[2];
const [W, H] = (process.argv[3] ?? "1366x768").split("x").map(Number);
const PORT = 9633 + (W % 100);
mkdirSync(OUT, { recursive: true });
const chrome = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(OUT, "p2-" + W)}`,
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
const r = [];
const check = (label, ok, detail = "") => r.push(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  ::  " + detail : ""}`);

// Snapshot of what is on screen: which cards are real, and which lines have a verdict in the log.
const snapshot = () => run(`(() => {
  const cards = [...document.querySelectorAll('article')].map(a => a.innerText.split('\\n')[0]);
  const log = [...document.querySelectorAll('li > button')].map(b => b.innerText.replace(/\\n+/g,' | '));
  const money = [...document.querySelectorAll('p')].find(p => p.innerText === 'Money that did not move')?.nextElementSibling?.innerText;
  return { cards, log, money, footer: !!document.querySelector('footer') };
})()`);

async function planAndWatch(label) {
  await click("Ask Copilot"); await sleep(600);
  await click("Restock what's running low"); await sleep(200);
  const t0 = Date.now();
  await click("Plan my basket");
  const timeline = [];
  let allAt = null;
  while (Date.now() - t0 < 4000) {
    const s = await snapshot();
    timeline.push({ t: Date.now() - t0, ...s });
    if (s.cards.length === 3 && allAt === null) allAt = Date.now() - t0;
    await sleep(100);
  }
  // A card may only be on screen if its verdict is already in the log.
  const verdicts = {
    "Toor dal": /Within limits\. Ready to pay\./,
    "Sunflower oil": /Owner must approve/,
    "Carry bags": /Within limits\. Ready to pay\.|Stopped\.|discarded/,
  };
  let early = [];
  for (const s of timeline) {
    for (const name of s.cards) {
      const k = Object.keys(verdicts).find((v) => name.startsWith(v));
      const logText = s.log.join(" || ");
      if (k === "Toor dal" && !/SERVER \| Within limits/.test(logText)) early.push(`${s.t}ms ${k}`);
      if (k === "Sunflower oil" && !/Owner must approve/.test(logText)) early.push(`${s.t}ms ${k}`);
      if (k === "Carry bags" && s.log.filter((l) => /SERVER/.test(l) && /(Within limits|Stopped|discarded)/.test(l)).length < 2) early.push(`${s.t}ms ${k}`);
    }
  }
  check(`${label}: no card appears before its verdict`, early.length === 0, early.slice(0, 3).join(", "));
  check(`${label}: all cards shown within 2.5s`, allAt !== null && allAt <= 2500, `${allAt}ms`);
  const firstLog = timeline.find((s) => s.log.length > 0)?.t;
  const firstCard = timeline.find((s) => s.cards.length > 0)?.t;
  check(`${label}: record starts before the first card`, firstLog !== undefined && firstCard !== undefined && firstLog < firstCard, `log ${firstLog}ms, card ${firstCard}ms`);
  const footerBeforeAll = timeline.some((s) => s.footer && s.cards.length < 3);
  check(`${label}: footer waits for the full reveal`, !footerBeforeAll);
  return timeline;
}

await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: "http://localhost:5173" });
await sleep(2000);

// Clean run
await planAndWatch("clean");
const listingClean = await run(`document.body.innerText.includes('Supplier listing the assistant read')`);
check("clean: no listing shown", !listingClean);
await shot(`${W}-p2-clean`);

// Compromised run
await key("r"); await sleep(300); await key("c"); await sleep(300);
const tl = await planAndWatch("compromised");
const moneyEarly = tl.some((s) => s.money && s.money !== "₹0" && s.cards.length < 3);
check("compromised: ₹20,000 waits for the stopped card", !moneyEarly);
await sleep(1500);
const final = await run(`(() => ({
  listing: [...document.querySelectorAll('p')].some(p => p.innerText.startsWith('Supplier listing the assistant read')),
  mark: document.querySelector('mark')?.innerText,
  strip: [...document.querySelectorAll('p')].find(p => p.innerText.includes('to attacker-controlled-supplier'))?.innerText,
  caption: document.body.innerText.includes('discarded at the gate · never used'),
  cardNote: [...document.querySelectorAll('article p')].find(p => p.innerText.includes('product listing'))?.innerText,
  metaKeyHidden: ![...document.querySelectorAll('.font-mono')].some(e => e.innerText.includes('source_listing')),
  money: [...document.querySelectorAll('p')].find(p => p.innerText === 'Money that did not move')?.nextElementSibling?.innerText,
}))()`);
check("compromised: listing shown", final.listing);
check("compromised: injected text marked", !!final.mark && final.mark.startsWith("TRUSTGATE_DEMO_INJECTION:"), final.mark);
check("compromised: ₹20,000 strip shown", !!final.strip, final.strip);
check("compromised: brief caption kept", final.caption);
check("compromised: stopped card names the source", !!final.cardNote, final.cardNote);
check("compromised: source_listing not drawn as a proposal field", final.metaKeyHidden);
check("compromised: counter reads ₹20,000", final.money === "₹20,000", final.money);
await shot(`${W}-p2-compromised`);

// Reset mid-planning still leaves nothing behind
await key("r"); await sleep(300);
await click("Ask Copilot"); await sleep(600);
await click("Restock what's running low"); await sleep(200);
await click("Plan my basket"); await sleep(700);
await key("r"); await sleep(3500);
const after = await run(`({ events: document.querySelectorAll('li > button').length, cards: document.querySelectorAll('article').length, home: document.body.innerText.includes('Good morning') })`);
check("R mid-planning leaves no events or cards", after.events === 0 && after.cards === 0 && after.home, JSON.stringify(after));

check("no console errors or warnings", problems.length === 0, problems.join(" || "));
const report = r.join("\n");
writeFileSync(join(OUT, `phase2-${W}.txt`), report);
console.log(report);
ws.close(); chrome.kill(); process.exit(0);
