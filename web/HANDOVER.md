# TrustGate Merchant Copilot UI: handover

**For:** Saransh Baid. **From:** Vidit Choudhary.
Built against brief revision 4, plus everything agreed since.

## Status

The backend integration is on hold, so **the demo runs on the sample data**. Everything for the real backend is built and tested, ready to switch back on.

## What's in this zip

- `web/`: the app source, without `node_modules`
- `web/dist/`: the production build for mounting at `/app` (real backend mode)
- `screenshots/`:
  - Basket clean
  - Basket compromised
  - Receipt
  - Two endings
  - the real checkout flow

  All at 1920 x 1080.
- `qa/`: the test scripts, including `real.mjs` for your backend and the stand-in `mock-backend.mjs` I tested with

## Running it

**Demo (sample data):**

```bash
cd web
npm install
npm run dev
```

Open `http://localhost:5173`. Use a normal browser window: embedded previews pause animations when they're in the background.

**Real backend, when integration resumes:** serve `web/dist` at `/app` on your backend and open `http://127.0.0.1:8000/app/`. To rebuild, run `npm run build` in `web`. The build uses base `/app/` and talks to the backend by default.

**Switching modes.** `USE_FIXTURES` is still there and never removed:
- `VITE_USE_FIXTURES=true` or `false` overrides it
- `?fixtures=1` on the page URL forces sample data
- `npm run dev` also proxies `/api` to `http://127.0.0.1:8000` (override with `TG_BACKEND`)

## New since the last handover

1. **Auto-pay for verified suppliers (sample data only).** A Ready line from a verified supplier pays itself about a second after the basket settles:
   - the card shows "Verified supplier. Paying automatically..." then "Paid automatically · confirmed by Paytm"
   - the live record logs "Verified supplier, within limits. Paying automatically." followed by the usual order, callback and status-check events

   Lines from an unverified supplier still need a tap. Anything over the limit still needs approval first, then pays itself if the supplier is verified.

   **For your backend:** this is UI-side on sample data only. On the real backend every payment still goes through `/pay` and the checkout. If you want auto-pay there too, it needs doing server-side (it consumes a payment authority without a checkout), and the UI would just render it.
2. **Back button on the basket.** `‹` next to the quoted request returns to Compose with the request kept. It cancels anything in flight for that basket (replays, auto-pay), so nothing lands after you leave.
3. **Greeting follows the clock.** "Good morning", "Good afternoon" or "Good evening", instead of "Good morning" all day.
4. **Layout fixes:**
   - at 1024 wide (projector size) the top bar no longer wraps: the tagline hides and the chips stay on one line
   - the longer greeting no longer collides with the shop icon
   - step labels no longer break

## Your five answers (real backend), as built

1. **Proxy and /app.** Your proxy line is in `vite.config.ts`. The build has base `/app/`.
2. **Mode.**
   - `C` and `L` call `POST /api/v1/merchant/demo/mode`, and the chip follows only the returned store. If the call fails, nothing changes.
   - `createBasket` sends only `{ goal }`.
   - From COMPROMISED, `C` returns to the last base mode, and `L` switches LIVE/OFFLINE (which also ends the compromise).
3. **Pay.**
   - The modal opens only after `POST .../lines/{id}/pay`, and shows `{host}/sim/checkout?orderId=...&txnToken=...` in a frame.
   - When the callback redirects to `/app` inside the frame, that copy of the app renders nothing and messages the parent. The parent closes the modal and calls `.../confirm`.
   - Cancel shows "Paytm hasn't confirmed yet" with Check again. A 409 or an unconfirmed answer keeps that state.
4. **Listing.** Read from `raw.source_listing = { supplier, text, injected }` on any event for the line after its proposal. The sample data carries your exact text on the discard event.
5. **Events.** Cards appear on a SERVER event with the line's `line_id` and a non-info `tone`. The 2.5 second fallback stays.

## Tested

At both 1366 x 768 and 1920 x 1080, each suite passes in full:

| Suite | Checks |
|---|---|
| Phase 1: input, cancel, double taps, event order, presenter bar | 18 |
| Phase 2: reveal order, listing, strike-through | 19 |
| Phase 3: landing, banner, counters, reset | 23 |
| Auto-pay and Back | 20 |
| Real backend, built app at `/app` against the stand-in | 20 |

That's 100 checks per size, plus a full walk-through with no console errors. The walk-through also passes with no overflow at 1536 x 864 (a Windows laptop at 125% scaling) and 1024 x 768 (a projector).

The stand-in (`qa/mock-backend.mjs`) is built from your description, not your code. A joint run is still needed before the real backend is used on stage:

```bash
node qa/real.mjs out 1366x768 http://127.0.0.1:8000
```

It pauses at the checkout for someone to click Pay inside the frame.

## Wording the brief didn't specify

| Where | Text |
|---|---|
| Right panel heading | `What the server decided` |
| Landing | `AI agents can be tricked into paying. This one can't choose who gets paid.` and three steps |
| Trust boundary | `Trust boundary (last proposal)`, `ASSISTANT`, `GATE`, `Supplier listing the assistant read · <supplier>`, `<amount> to <payee>` |
| Stopped card | `The instruction came from <supplier>'s product listing.` |
| Banner | `₹20,000 did not move`, `The assistant was told to pay <payee>. Nothing was sent to Paytm.`, `See both endings` |
| Auto-pay | `Verified supplier. Paying automatically...`, `Paid automatically · confirmed by Paytm`, log: `Verified supplier, within limits. Paying automatically.` |
| Counters | `Money that did not move` (only once something is stopped), `Decisions asked of the owner` |
| Chips | `Paytm: test mode`, `Assistant: sample data` on sample data only |
| Supplier | `unverified` flag |
| Greeting | `Good morning` / `Good afternoon` / `Good evening`, then `Nandi Kirana` |
| Sample data only | `This demo only has restock data, so here's what's running low.` for goals it has no basket for |

## Known points

- **Scorecard hidden** until your 24-request results file arrives. Replace `web/src/fixtures/scorecard.json` and set `SHOW_SCORECARD = true` in `web/src/config.ts`.
- **`R` resets the UI, not the server's mode.** Set compromise once and reset between judges.
- **Presenter bar (`D`):** it gets its own strip and covers nothing, but keep it hidden while judges watch.
- **LIVE and OFFLINE produce the same basket and the same payment behaviour on sample data.** OFFLINE adds the "offline planner" bubble and hides the Hinglish suggestion. Payment is decided entirely after the gate, so the planner can't change it.
