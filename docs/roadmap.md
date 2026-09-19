# Roadmap and scope

The working record of what TrustGate is, what it is not, and what is worth building next. It exists
because scope on this project has been decided in conversation and then partly forgotten — a
Cloudflare tunnel was configured, worked, and vanished from every artifact for a week — and because
a list held in one person's head is a list that gets re-litigated instead of executed.

**Working protocol.** Read this file before planning work. Update it in the same commit as the work
it describes: move finished items to *Landed*, add anything new that scope discussion produced, and
correct anything found to be wrong. An entry here is a claim like any other in this repository, so
it gets checked rather than assumed — every "Landed" line below was verified against the code on the
date shown, not recalled.

---

## What this is

An authorization layer between an AI buying agent and payment execution. The agent proposes a
catalog SKU, a quantity, and a purpose. Every money-critical fact — price, merchant, currency — is
derived server-side, and the ability to *pay* is a separate, short-lived, revocable permission that
the agent never holds.

The argument is not that it refuses things. It is that the refusals are **verified rather than
asserted**: each safety guard is deleted on purpose and a test has to fail.

---

## Where it stands — verified 5 September 2026

| | |
|---|---|
| Tests | 654 passing |
| Mutations | 53, every one caught |
| Tier A scenarios | 16, attack matrix generated from the registry |
| Concurrency races | 9, run genuinely concurrently |
| Migrations | 19, reverse and re-apply from `base` |
| Provider | Razorpay Test Mode, **provider-delivered** webhook proven |
| Branch | merged to `main` and pushed |
| Submitted | 5 September 2026 — Razorpay AI Buildathon, Track 1 |

### Landed

- Narrow MCP tool surface — five tools, none of which can grant authority or set an amount
- Policy engine: per-payment cap, daily cap, merchant allowlist, currency, approval threshold
- Human approval with enforced separation of duties
- Checkout authority: single-use, bound to a hash of the exact purchase, 15-minute TTL
- Razorpay Test Mode orders, signed webhooks verified over raw bytes, amount cross-checked
- Provider-originated delivery proven end to end — `docs/evidence/m3-provider-delivered-webhook.json`
- Evidence receipt and read-only console, both from one shared assembly
- Authorization envelope — one fixed-shape answer to "may money move, and on whose authority"
- Plain-language reason codes on both console and receipt
- **Multi-hop delegated authority**: per-edge narrowing by trigger, budget *partitioned* across
  siblings by check constraint, revocation cascading without touching a descendant
- Delegation consulted at authorization and re-asked before checkout authority is issued and again
  before it is consumed
- Authority relationships as database facts: one payment per request, decisions and approvals keyed
  to a policy version that exists
- Request body size limit refused before the request costs anything
- Mutation suite, Tier A registry, concurrency races, reversible migrations
- Property-based tests generating cases against the policy engine's rule completeness and denial
  precedence, the state machine's legal edges and amount invariants, and webhook verification
  over mutated raw bytes — landed earlier and unlisted here until now
- Refusal vocabulary matched to what the system does rather than to security-appliance habit: the
  console banner says `REFUSED` rather than `BLOCKED`, and a purchase that already paid reads
  *no longer needed* on both banner and receipt instead of being dressed as a refusal — 5 Sept

---

## Now that it is submitted

The buildathon deadline is met. This project always had two audiences, and only one of them is
finished — the other is a payments engineer reading the repository during a hiring conversation.
That has three consequences worth writing down before they get re-argued.

**The ranking below is now the only ranking.** It was always ordered by what a payments reader would
notice missing; that is no longer competing with what demos well. Items with low demo value and high
fintech signal — reconciliation especially — move from "unfortunate" to "obviously next".

**The demo artifacts become an archive, not live documents.** `demo/pitch.md`,
`demo/voiceover.md` and `demo/teleprompter.txt` describe a recording that has been made and
submitted. They should stop being maintained as though a take is still pending, and the tests that
guard their internal consistency should be read as protecting a historical record rather than a
plan. Decide once whether they stay in the repository at all — see *Repository presentation*.

**Nothing is urgent, for the first time.** Every remaining item is optional, and the failure mode
now is not missing a deadline but shipping something half-built that weakens a claim currently
stated cleanly. An honestly stated gap has beaten a partial implementation twice on this project
already.

**One operational thing.** The submitted video link has to stay reachable for the whole judging
window. Do not move, rename, or tidy away the file it points at, and do not clear the storage it
lives in. If it is the OneDrive copy, that link is the deliverable now.

---

## Known issues

- **Intermittent test failure, observed once, not reproduced.** On 5 September a full-suite run
  failed `tests/test_delegation.py::test_a_spend_records_the_chain_that_authorized_it` together with
  `tests/test_mutation_anchors.py::…[the-spend-joins-its-purchase]`. Both passed in isolation
  immediately afterwards, and two subsequent full runs were clean at 601 passed (606 since). Recorded rather
  than dismissed: the two failures were related, and an intermittent fault in the mutation-anchor
  machinery would undermine the one claim the whole project rests on. If it recurs, capture the
  seed and ordering before re-running — a green re-run destroys the evidence.

---

## Next — ranked by what it is worth to a fintech reader

**Where these came from.** (1) is this project's own stated limitation — said twice in
`docs/limitations.md` and out loud in the demo, which is why stating it does not undermine the work
but closing it would strengthen it. (2) and (3) came from reading comparable buildathon entries:
tamper-evident evidence and property-based fuzzing were both things another entrant had and this
one did not. The rest is ordinary hardening that any payments reviewer would expect.

The ranking is by what a payments reader would notice **missing**, not by effort. Nothing here is
required for the submission; all of it is what turns a strong testbed into something that survives
being read closely.

**Suggested order, which is not the ranking.** Do (3) first: it is the smallest, it needs no schema
change, and it hardens the claim most likely to be probed. Then (1), which is the largest and
touches the most surfaces, so it wants a clear run rather than being wedged between smaller things.
(2) after that, because a signature over evidence is more convincing once the identity in that
evidence means something. (4) through (7) are independent and can be taken in any order, or left.

### 1. Actor authentication

**The one gap any payments interviewer finds in five minutes.** `actor_id` and
`delegate_actor_id` are strings the caller supplies, so the delegation chain enforces bounds
against an identity nobody verified. It is stated honestly in `docs/limitations.md` twice and said
out loud in the demo, which is why it does not undermine the work — but closing it is what turns an
impressive testbed into a coherent system.

Shape: an `Actor` table, tenant-scoped hashed agent credentials, and the MCP server resolving the
credential server-side so the caller never supplies an actor id at all. Then
`active_delegation_for` looks up an *authenticated* identity.

Medium slice. Highest value here by a distance.

### 2. Signed evidence snapshots

The receipt says, in its own footer, that it is **not tamper-evident**. Closing that converts a
stated limitation into a feature: an Ed25519 signature over the assembled record plus a small
offline verifier, so a reader can check a receipt without trusting the server that produced it.

Bounded scope, crisp demo, and it is the kind of thing that gets remembered.

### 3. Property-based coverage over delegation

Hypothesis already generates cases against the policy engine, the state machine, and webhook
verification. It generates **nothing** against delegation — which is simultaneously the most
intricate arithmetic in the system, the part no comparable project has built, and therefore the
part a reviewer is most likely to probe.

The example-based tests there are good and were written against bugs that actually happened. What
they cannot do is search. Three properties are worth stating and then attacking with generated
sequences of grants, spends and revocations:

- children can never, between them, hold more than their root, under any ordering
- a revoked hop makes every descendant refuse, however deep and however it is reached
- a refused spend leaves every budget in the chain exactly where it started

Small slice. It turns the strongest claim in the project from *tested* into *searched*, and the
mutation suite already proves the tests would notice if the guards disappeared.

### 4. Rewrite `docs/threat-model.md`

130 words, the shortest document in a security project, and structurally a scope list rather than a
threat model: no attacker model, no capabilities, no attack paths. `docs/architecture.md`'s trust
boundaries section is a better threat model than the threat model is.

The problem is not that it is thin. It is that an interviewer opening files by name opens that one
first, and its title writes a cheque the contents do not cover. It needs the attackers the system
actually assumes — a supplier who controls catalogue text, a compromised agent, a caller who knows a
tenant UUID, a replayed provider event — each with what they can do and what stops them. Every one
of those already exists in the Tier A registry; the document just does not draw them together.

Small, and it removes the sharpest available criticism of the documentation.

### 5. Scheduled Razorpay reconciliation

Low demo value, high *fintech* signal. Payment systems drift — an order created but never
confirmed, a webhook that never arrived — and the job is repairing that drift. A reconciliation
pass that finds and resolves it shows an understanding of the work that a feature list does not.

### 6. Rate limiting on write routes

Grants, revokes, approvals, checkout authority, order creation. Deliberately not done before the
recording: a 429 mid-demo reads as a refusal. There is no reason to hold it back now.

### 7. Per-tenant webhook secrets

One secret serves every tenant today. Needs a pre-verification secret-selection design, because the
tenant must be known before the signature can be checked — which is the interesting part.

### 8. Structured observability

Events for granted, revoked, authority blocked, provider action blocked, webhook rejected — each
carrying a correlation id and reason code. Cheap, additive, invisible in a demo.

---

## Known ceilings on the strongest claims

Not gaps to close, but the honest bound on things worth leaning on. Better said here first than
found by a reader.

- **53 mutations are hand-picked.** They prove the invariants that could be named. A generated set
  — `mutmut`, `cosmic-ray` — would bound the ones that could not, and would almost certainly find
  survivors. That is a strengthening, not a repair, and the two answer different questions.
- **The delegation result is one project's testbed finding**, not a published one, and
  `docs/positioning.md` already says so. The set-intersection-is-wrong-for-money argument is sharp;
  the evidence for it is a repository, not a paper.
- **No performance figure exists anywhere**, and the tenant row lock puts a per-merchant ceiling on
  throughput by construction. Documented in `docs/limitations.md` as of 5 Sept.

---

## Explicitly out of scope

Kept here so it is decided once rather than re-argued.

- **Live Mode.** A project about bounded spending authority has no business holding live keys, and
  the code refuses one. This is a position, not a shortfall.
- **Being a payment processor, compliance product, fraud model, or consent system.** Each is a
  different product; claiming any would be the overreach the rest of the repository avoids.
- **Reclaiming a revoked hop's unspent allocation.** Requires subtree-safe accounting under locks
  without racing a spend in flight. Conservative and lossy was chosen over clever and wrong, and
  `docs/limitations.md` says so.
- **Breadth** — more currencies, more providers, a cleverer agent. Depth is the signal here; breadth
  dilutes it.
- **Production identity infrastructure** — OIDC, KMS, mTLS. A different project.

---

## Repository presentation

Separate from the system, and worth finishing. The submission is in, so the reader these are for
is no longer a judge with four minutes but an engineer deciding whether to take the project
seriously. **The test for each is the same: would someone who has never met this project be helped
or confused by finding it?**

Three of the demo files describe a recording that now exists and has been submitted. They are a
record, not a plan. Whatever is decided, decide it once and write it below rather than leaving the
boxes open.

- [x] Buildathon submission artifacts moved to `docs/buildathon/` — 4 Sept
- [x] `demo/architecture.html` — trust boundary, the authorized-but-cannot-pay gap, sibling budget
      partitioning, layer stack, enforcement ladder. One offline page, no server, no network — 5 Sept
- [ ] `demo/pitch.md`, `demo/voiceover.md`, `demo/teleprompter.txt` — narration for a take that has
      been recorded and submitted. Recommendation: move all three to `docs/buildathon/` beside the
      other submission artifacts, where they read as *what was said on the day* rather than as
      instructions to a reader. `tests/test_pitch.py` moves with them or goes; its guards protect a
      historical record now, which is worth less than it was but is not worth nothing — the figures
      in those files are still claims about this system
- [ ] `JUDGE.md` — genuinely useful ("for a reader with four minutes" is a recruiter, not only a
      judge). Rename rather than delete
- [ ] `demo/script.md` — reframe as `demo/walkthrough.md`, keeping the three guards that hang off it
- [ ] Ten `*-verification.md` notes — collect into `docs/verification/`
- [ ] `docs/trustgate-scenario-map.md` — check whether the generated attack matrix supersedes it

---

## Scope decisions, dated

- **5 Sept 2026** — External review acted on. Three documents citing a retired mutation as live
  evidence were repointed at the trigger and test that hold the invariant now; five drifted figures
  corrected; the tenant-row throughput ceiling and the actor-authentication design written down
  rather than left discoverable. A test now counts the figures, because this was the third time they
  drifted and the second time a human found it before the suite did.
- **5 Sept 2026** — Submitted. Two audiences were always in play; one is now finished, so the
  ranking by fintech signal stops competing with what demos well. Reconciliation in particular moves
  from "low demo value" to simply next. Nothing outstanding is urgent, and the failure mode changes
  from missing a deadline to weakening a cleanly stated claim by half-building around it.
- **5 Sept 2026** — Property-based coverage of delegation adopted from a comparable project and
  ranked third, above reconciliation. Delegation is the claim the project is judged on and the only
  intricate arithmetic with no generated-case coverage; example tests there were written against
  bugs that already happened, which is exactly the coverage that does not generalise.
- **5 Sept 2026** — Refusal vocabulary changed from `BLOCKED` to `REFUSED` across console and
  receipt. "Blocked" implies a detector, and the entire argument is that nothing detects anything.
  A settled purchase now reads *no longer needed* rather than being rendered as a refusal, because
  the two states are opposite and were sharing one wording.

- **4 Sept 2026** — Submission artifacts moved rather than deleted: a claim made in a submission
  form is worth being able to check later against what the system does.
- **3 Sept 2026** — `agent.capture` kept alongside the tunnel. The tunnel is better evidence and it
  dropped 31 times in five minutes on QUIC; a fallback that cannot fail is worth its own command.
- **3 Sept 2026** — Rate limiting deliberately deferred past the recording.
- **1 Sept 2026** — Actor authentication deferred until after the demo, on the reasoning that an
  honestly stated gap beats a half-built identity layer.
- **31 Aug 2026** — Delegation integrated into the payment path rather than kept as a standalone
  engine.
