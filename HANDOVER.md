# TrustGate Merchant Copilot UI: handover

**For:** Saransh Baid. **From:** Vidit Choudhary.
Built against brief revision 4, plus everything agreed since.

## What's in this zip

- `web/`: the app source, without `node_modules`
- `web/dist/`: the production build, ready to mount at `/app` (real backend mode)
- `screenshots/`: Basket clean, Basket compromised, Receipt, Two endings (1920 x 1080), plus the real checkout flow
- `qa/`: the test scripts, including `real.mjs` to run against your backend and the stand-in `mock-backend.mjs` I tested with

## Running it

**Demo (real backend, same origin):** serve `web/dist` at `/app` on your backend and open `http://127.0.0.1:8000/app/`. To rebuild: `cd web`, `npm install`, `npm run build`. The build uses base `/app/` and talks to the real backend by default.

**Sample data fallback:** `cd web`, `npm run dev`, open `http://localhost:5173`. Dev uses the sample data by default. `USE_FIXTURES` is still there, never removed:

- `VITE_USE_FIXTURES=true` or `false` overrides it at build or dev time
- `?fixtures=1` on the page URL forces sample data
- `npm run dev` also proxies `/api` to `http://127.0.0.1:8000` (override with `TG_BACKEND`)

## Your five answers, and what I built

1. **Backend and /app.** Proxy added to `vite.config.ts` as you wrote it. The build has base `/app/`, so all assets load from `/app/...`.
2. **Mode.** `C` and `L` now call `POST /api/v1/merchant/demo/mode`. The chip is driven only by the store that call returns. If the call fails, the chip doesn't change. `createBasket` still sends only `{ goal }`. From COMPROMISED, `C` goes back to the last base mode and `L` switches LIVE/OFFLINE (which also ends the compromise).
3. **Pay.** Opening the modal calls `POST .../lines/{id}/pay` first. The modal only opens once the order exists, and it shows `{host}/sim/checkout?orderId=...&txnToken=...` in a frame. When your callback redirects to `/app`, the copy of the app loading inside that frame renders nothing and messages the parent. The parent closes the modal and calls `POST .../confirm`. Cancel on the real backend closes the modal and shows "Paytm hasn't confirmed yet, so we haven't marked this paid." with Check again, which calls confirm. A 409 or an unconfirmed answer keeps that state; nothing is ever shown as Ready or paid without the server saying so. On sample data, Cancel returns the line to Ready as you agreed.
4. **Listing.** Read from `raw.source_listing = { supplier, text, injected }` on any event for the line, only from events after that line's proposal (so an earlier run's listing never leaks in). The sample data carries your exact text on the discard event.
5. **Events.** Cards appear when a SERVER event with the line's `line_id` and a non-info `tone` arrives. The 2.5 second fallback stays.

## Tested

With my stand-in backend (`qa/mock-backend.mjs`, built from your description, not your code), the built app served at `/app` passes 20 checks at 1366 x 768 and 1920 x 1080. They cover:

- the chip follows the server, and a failed mode call leaves it unchanged
- the compromised basket over HTTP and SSE
- the listing from the discard event, marked
- Pay through the checkout frame and callback, ending Paid
- Cancel shows unconfirmed, and Check again asks the server
- `R`, and `C` back to LIVE
- no console errors

The sample-data path passes 60 more checks at both sizes.

## For the 13:30 run

With your backend on 8000 and `web/dist` mounted:

```bash
node qa/real.mjs out 1366x768 http://127.0.0.1:8000
```

It pauses at the checkout for someone to click Pay inside the frame. Things worth watching together:

- does your callback's redirect land on `/app` inside the frame (it should, the modal is an iframe)
- do your SSE events arrive with `line_id` and `tone`, so cards reveal before the 2.5s fallback
- is your listing on the discard event with the agreed shape

## Wording the brief didn't specify

| Where | Text |
|---|---|
| Right panel heading | `What the server decided` |
| Landing | `AI agents can be tricked into paying. This one can't choose who gets paid.` and three steps |
| Trust boundary | `Trust boundary (last proposal)`, `ASSISTANT`, `GATE`, `Supplier listing the assistant read · <supplier>`, `<amount> to <payee>` |
| Stopped card | `The instruction came from <supplier>'s product listing.` |
| Banner | `₹20,000 did not move`, `The assistant was told to pay <payee>. Nothing was sent to Paytm.`, `See both endings` |
| Counters | `Money that did not move` (only once something is stopped), `Decisions asked of the owner` |
| Chips | `Paytm: test mode`, `Assistant: sample data` on sample data only |
| Supplier | `unverified` flag |
| Sample data only | `This demo only has restock data, so here's what's running low.` for goals it has no basket for |

## Known points

- **Scorecard hidden** until your 24-request results file arrives. Replace `web/src/fixtures/scorecard.json` and set `SHOW_SCORECARD = true` in `web/src/config.ts`.
- **`R` resets the UI, not the server.** It keeps the server's mode, so set compromise once and reset between judges.
- **The presenter bar** (`D`) gets its own strip at the bottom and covers nothing, but keep it hidden while judges watch.
