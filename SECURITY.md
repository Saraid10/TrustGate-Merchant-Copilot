# Security policy

## What this project is, before anything else

TrustGate is a **testbed**, not a deployed service. There is no production instance, no hosted
endpoint, and no live-money path. It runs against Razorpay **Test Mode**: any provider call made
with a key that does not begin `rzp_test_` is refused with `RAZORPAY_NOT_TEST_MODE` rather than
sent, because Razorpay separates test from live by key and not by endpoint — the same request with
a live key would move real money. Nothing here holds real funds, cardholder data, or customer
records.

So there is no running system to attack, and no user to protect from a vulnerability in it. What
there is: source code arguing that a particular design bounds what an AI agent can spend, and
evidence for that argument. A flaw in the argument is worth reporting. A flaw in a deployment is
not, because there is no deployment.

## Reporting something

Use GitHub's private vulnerability reporting on this repository:
**Security → Advisories → Report a vulnerability**. That opens a thread visible only to
maintainers, which is the right place for anything you would not want in a public issue first.

For anything not sensitive — a claim in the documentation the code does not support, a test that
proves less than it says, a scenario that should be in the registry and is not — a normal issue is
better, and discussing it in public is more useful than in private.

There is no response-time commitment. This is one person's project, and a policy promising a
24-hour acknowledgement would be a claim with nothing behind it. Not making claims of that kind is
rather the point of the repository.

## What is already known to be missing

It is worth checking whether you have found something the project already says about itself.
[`docs/limitations.md`](docs/limitations.md) is the authoritative list — every deliberate cut,
stated rather than hidden.

The largest gap is stated there, in the README, and out loud in the demo: **callers are not
authenticated.** Tenant identity arrives as an `X-Tenant-Id` header, so at the HTTP layer, knowing
a tenant UUID is the same as being that tenant. Tenant-scoped queries and composite foreign keys on
`(tenant_id, id)` constrain data *after* an identity is selected; they do not authenticate the
selection. Delegation matches an actor string rather than an authenticated principal. That is a
known hole with a plan attached, not a finding.

Also known, and not defended against:

- **A malicious database administrator.** Every invariant that matters is enforced *in* PostgreSQL.
  Unrestricted rights to it can rewrite them.
- **A compromised host or Python runtime.** Nothing here defends the process it runs in.
- **Denial of service.** Request bodies are capped; request *rate* is not, and there are no measured
  capacity figures at all.
- **Model behaviour in general.** The claim is that a manipulated agent cannot move money, not that
  a model can be made to behave.
- **Supply chain.** Dependencies are declared as version ranges with no lock file, so two installs
  can resolve to different code and neither is reproducible from the commit.
- **Real funds.** Test Mode only, deliberately: a project about bounded spending authority has no
  business holding live keys.

Note that [`docs/threat-model.md`](docs/threat-model.md) on this branch is a scope list rather than
an attacker model, and one of its lines is out of date — it records provider integrations as out of
scope, which stopped being true when Razorpay Test Mode landed. A rewrite around named attackers is
in progress. Until it lands, `limitations.md` is the document to trust.

## What a good report looks like

The same thing that makes any claim in this repository worth believing: something that fails.

A scenario, a request sequence, or a test that demonstrates the problem is worth far more than a
description of it, because the fix has to arrive with a regression that fails without it. If you
can express it in the shape of the adversarial scenarios in `scenarios/tier_a.py`, that is the most
useful form it can take.

## Scope

| In scope | Out of scope |
|---|---|
| The authorization core: `api/`, `policy_engine/`, `delegation/`, `state_machine/`, `models/` | Any deployment, since there is none |
| The MCP tool surface in `mcp_server/` — particularly anything letting an agent name an amount, a merchant, or a currency | The buyer agent in `agent/` behaving badly; that is assumed, not defended against |
| Database invariants: triggers, check constraints, partial unique indexes | Third-party services, including Razorpay itself |
| A documented claim the code does not support, or a test that does not prove what it says | Anything already recorded in [`docs/limitations.md`](docs/limitations.md) |
