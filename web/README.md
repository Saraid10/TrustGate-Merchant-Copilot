# TrustGate Merchant Copilot UI

The frontend for TrustGate: a shop owner's phone app on the left, and the server's view on the right.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173.

## Data

Everything goes through `src/api.ts`. With `USE_FIXTURES = true` it serves the sample data in `src/fixtures/`. Set it to `false` to call the real backend.

## Presenter keys

| Key | Does |
|---|---|
| `R` | Reset to Home and clear the live record |
| `C` | Toggle "Compromise the assistant" |
| `L` | Switch the assistant between LIVE and OFFLINE |
| `D` | Show or hide the presenter bar |
| `1` `2` `3` | Switch the right panel tab |

Keys are ignored while typing in a text box.
