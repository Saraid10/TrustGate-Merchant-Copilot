// A stand-in for the TrustGate backend, built from the contract in Saransh's messages, so the
// real-backend path of the UI can be tested without his server. Not a copy of his logic.
//
//   node qa/mock-backend.mjs [port]      (default 8010; serves web/dist at /app)
//
// Contract covered: GET store, POST demo/mode, POST baskets, POST lines/:id/approve|pay|confirm,
// SSE events (event name "tg"), GET /sim/checkout, POST /sim/callback -> 302 /app.
// Test hooks: POST /__test/fail-next-mode makes the next mode call fail with 503.
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.argv[2] ?? 8010);
const ROOT = fileURLToPath(new URL("../web/", import.meta.url));
const DIST = join(ROOT, "dist");
const fixture = (name) => JSON.parse(readFileSync(join(ROOT, "src/fixtures", name), "utf8"));

const storeBase = fixture("store.json");
const events = fixture("events.json");
let mode = "LIVE";
let failNextMode = false;
let lines = new Map();
const orders = new Map(); // lineId -> { order_id, status }
const clients = new Set();

const now = () => new Date().toLocaleTimeString("en-GB", { hour12: false });
const money = (minor) => "₹" + (minor / 100).toLocaleString("en-IN");
const store = () => ({ ...storeBase, assistant_mode: mode });

function emit(id, patch = {}) {
  const base = events.find((e) => e.id === id);
  const e = { ...structuredClone(base), ...patch, at: now() };
  e.title = e.title.replace("{amount}", patch._amount ?? "");
  delete e._amount;
  for (const res of clients) res.write(`event: tg\ndata: ${JSON.stringify(e)}\n\n`);
}
const emitSeq = async (ids, gap = 250) => { for (const id of ids) { emit(id); await sleep(gap); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function send(res, status, body, headers = {}) {
  const json = typeof body !== "string";
  res.writeHead(status, { "content-type": json ? "application/json" : "text/html; charset=utf-8", ...headers });
  res.end(json ? JSON.stringify(body) : body);
}
const readBody = (req) => new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => r(b)); });

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
function serveApp(res, path) {
  let file = join(DIST, path.replace(/^\/app\/?/, ""));
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, "index.html");
  res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
}

const checkoutPage = (orderId) => `<!doctype html><meta charset="utf-8">
<body style="font-family:system-ui;padding:20px;text-align:center">
<h3>Paytm simulator</h3><p>Order ${orderId}</p>
<form method="post" action="/sim/callback"><input type="hidden" name="orderId" value="${orderId}">
<button name="status" value="TXN_SUCCESS" id="sim-pay" style="font-size:18px;padding:10px 24px">Pay</button>
<button name="status" value="TXN_FAILURE" id="sim-fail" style="font-size:18px;padding:10px 24px">Fail</button>
</form></body>`;

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const p = url.pathname;
  const m = p.match(/^\/api\/v1\/merchant\/lines\/([^/]+)\/(approve|pay|confirm)$/);

  if (p === "/" ) return send(res, 302, "", { location: "/app/" });
  if (p === "/app" || p.startsWith("/app/")) return serveApp(res, p);

  if (p === "/__test/fail-next-mode") { failNextMode = true; return send(res, 200, { ok: true }); }

  if (p === "/api/v1/merchant/store") return send(res, 200, store());

  if (p === "/api/v1/merchant/demo/mode" && req.method === "POST") {
    if (failNextMode) { failNextMode = false; return send(res, 503, { error: "unavailable" }); }
    const body = JSON.parse((await readBody(req)) || "{}");
    if (!["LIVE", "OFFLINE", "COMPROMISED"].includes(body.assistant_mode)) return send(res, 400, { error: "bad mode" });
    await sleep(150);
    mode = body.assistant_mode;
    return send(res, 200, store());
  }

  if (p === "/api/v1/merchant/events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.write(": connected\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  if (p === "/api/v1/merchant/baskets" && req.method === "POST") {
    const { goal } = JSON.parse((await readBody(req)) || "{}");
    const basket = structuredClone(fixture(mode === "COMPROMISED" ? "basket-compromised.json" : "basket-clean.json"));
    basket.goal = goal ?? basket.goal;
    lines = new Map(basket.lines.map((l) => [l.id, l]));
    orders.clear();
    // Events stream while the assistant plans; the basket answer lands part-way through.
    emitSeq(["e1", "e2", "e3", "e4", "e5", "e6", ...(mode === "COMPROMISED" ? ["e14", "e15", "e16"] : ["e7", "e8"])]);
    await sleep(900);
    return send(res, 200, basket);
  }

  if (m && req.method === "POST") {
    const [, id, action] = m;
    const line = lines.get(id);
    if (!line) return send(res, 404, { error: "no such line" });

    if (action === "approve") {
      line.outcome = "READY";
      line.reason_text = "Approved by you. Within your limits.";
      emit("e9");
      return send(res, 200, line);
    }

    if (action === "pay") {
      if (line.outcome !== "READY") return send(res, 409, { code: "NOT_PAYABLE" });
      const order_id = "TG" + Math.random().toString(16).slice(2, 8).toUpperCase();
      orders.set(id, { order_id, status: "PENDING" });
      line.outcome = "PAYING";
      emit("e10", { line_id: id });
      emit("e11", { line_id: id, _amount: money(line.derived.amount_minor), raw: { order_id, amount_minor: line.derived.amount_minor } });
      return send(res, 200, {
        rail: "SIMULATED", line,
        checkout: { mid: "TGMOCK", order_id, txn_token: "tok-" + order_id, amount: (line.derived.amount_minor / 100).toFixed(2), host: `http://127.0.0.1:${PORT}` },
      });
    }

    if (action === "confirm") {
      const order = orders.get(id);
      if (!order) return send(res, 409, { code: "NOTHING_TO_CONFIRM" });
      if (order.status === "PENDING") { line.outcome = "CONFIRMING"; return send(res, 200, line); }
      if (order.status === "TXN_FAILURE") { line.outcome = "PAYMENT_FAILED"; return send(res, 200, line); }
      line.outcome = "PAID";
      line.paytm = { order_id: order.order_id, status: "TXN_SUCCESS", amount_minor: line.derived.amount_minor };
      emit("e13", { line_id: id, _amount: money(line.derived.amount_minor) });
      return send(res, 200, line);
    }
  }

  if (p === "/sim/checkout") return send(res, 200, checkoutPage(url.searchParams.get("orderId")));

  if (p === "/sim/callback" && req.method === "POST") {
    const form = new URLSearchParams(await readBody(req));
    const orderId = form.get("orderId");
    for (const [id, o] of orders) if (o.order_id === orderId) { o.status = form.get("status"); emit("e12", { line_id: id }); }
    return send(res, 302, "", { location: `/app/?orderId=${encodeURIComponent(orderId)}` });
  }

  send(res, 404, { error: "not found", path: p });
}).listen(PORT, "127.0.0.1", () => console.log(`mock backend on http://127.0.0.1:${PORT}/app/`));
