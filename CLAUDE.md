# Paisa fork — orientation map

This is **our fork of Paisa** (the dashboard at http://localhost:7500), edited to
fit the `personal-finance` hledger stack. We read config from that repo's
`paisa.yaml` (`journal_path: data/main.journal`). Built from source (arm64):
`go build -o paisa .` → run via `personal-finance/scripts/paisa.sh`.

> This file is a navigation aid for code spelunking — start here instead of
> grepping cold. The repo itself is the source of truth; verify before asserting.

## Where the things we keep touching live (Go backend)

- **`internal/service/market.go`** — valuation.
  - `GetUnitPrice(db, commodity, date)`: `BTreeDescendFirstLessOrEqual` on the
    **P-directive** price tree; if nothing ≤ date, falls back to the
    **posting-cost** tree (the `@ price` on transactions). If BOTH miss → zero.
  - `GetMarketPrice(p, date)` = `p.Quantity × GetUnitPrice(...)`, else `p.Amount`
    (cost) when no price found. Currencies return `p.Amount` directly.
  - `PopulateMarketPrice` values **everything at `EndOfToday()`** (today's price) —
    used for the summary cards, NOT the timeline.
- **`internal/server/networth.go`** — `computeNetworthTimeline(db, postings,
  computeBalanceUnits)` builds the per-day series behind the gain chart. For each
  day `start`: accumulates `investment` (Σ positive `p.Amount`), `withdrawal`
  (Σ negative), and re-values each commodity's units at
  `GetUnitPrice(commodity, start)`. `gain = balance + withdrawal − investment`;
  `netInvestment = investment − withdrawal`. Single-snapshot version
  (`ComputeNetworth`) values at `now`.
- **`internal/server/gain.go`** — `GetAccountGain(db, account)` powers
  `/assets/gain/<account>`. `GetGain` powers the `/assets/gain` list.
- Others: `capital_gain.go`, `dashboard.go`, `income_statement.go`, `xirr.go`,
  `internal/accounting/accounting.go` (account-type classification).

## Frontend (SvelteKit)

- Routes under `src/routes/(app)/...`: `assets/gain/[slug]` (per-account all-up),
  `assets/balance`, `assets/networth`, `cash_flow`, `ledger/posting`, etc.

## Known quirks / fix targets (see personal-finance memory `project_paisa_fork_todos`)

1. **Account classifier hard-coded in Go** → `Assets:*:Checking:*` (Schwab, WF,
   Stanford FCU) misclassified as Investment. Fix in `internal/accounting`.
2. **Cash-flow bars not drillable** — wire bar-click → filtered Ledger.
3. **`/assets/gain` list truncates account names** (left-clipped) — Svelte column
   width/flex in the Gain list page.
4. **First-timeline-point mis-values** when no P price exists on-or-before the
   opening date: `computeNetworthTimeline` then values that day via the
   posting-cost fallback / a stale cached price, showing a one-day spike before
   the real curve. Root cause is the price lookup at `start`, not the data.
   Mitigated at the data layer by (a) costing opening lots at the opening-DATE
   market price and (b) ensuring `prices-fetched.journal` history covers the
   opening date. A pure-fork fix would seed the timeline's first point from
   `GetUnitPrice(commodity, start)` with an on-or-before guarantee.
