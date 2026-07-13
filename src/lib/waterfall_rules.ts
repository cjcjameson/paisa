// Single source of truth for the waterfall's account-classification rules
// and the drill-down queries derived from them.
//
// ⚠ ISOMORPHISM CONTRACT: the backend classifies asset deltas as cash vs
// book in internal/server/income_statement.go (isCashConnected). The
// CASH_CONNECTED_PREFIXES list below MUST stay identical to that Go
// function, and the drill queries are BUILT from it so the transactions a
// bar click shows are exactly the transactions the bar counts.
// waterfall_rules.test.ts enforces the TS side; if you touch the Go rule,
// update the prefixes here and the test fixtures will keep the queries
// honest.

// Mirror of Go isCashConnected (internal/server/income_statement.go).
export const CASH_CONNECTED_PREFIXES = [
  "Assets:Checking",
  "Liabilities:CreditCards",
  "Liabilities:Credit_Cards",
  "Liabilities:Courtney:BusinessCard",
  "Equity:Transfers"
];

// Asset accounts excluded from the buys/sales bars even when cash-classified
// (they have their own bars: Vestwell = payroll, Options = vests; Checking is
// the cash side itself).
export const BAR_EXCLUDED_ASSET_HEADS = ["Checking", "Vestwell", "Options"];

const cashConnectedAlternation = `^(${CASH_CONNECTED_PREFIXES.join("|")})`;
const investmentAssetPattern = `^Assets:(?!${BAR_EXCLUDED_ASSET_HEADS.join("|")})`;

// The buys/sales drill: transactions that (a) touch an investment/vehicle
// asset and (b) are cash-connected — the exact backend rule, in query form.
const buysSalesClause =
  `account =~ /${investmentAssetPattern}/` +
  ` AND account =~ /${cashConnectedAlternation}/`;

// Transaction-level predicates matching the query semantics (a DSL condition
// matches a transaction when ANY posting matches). Used by the test to prove
// the drill query selects exactly the backend-cash transactions.
export const txnHasInvestmentAsset = (accounts: string[]) =>
  accounts.some((a) => new RegExp(investmentAssetPattern).test(a));
export const txnIsCashConnected = (accounts: string[]) =>
  accounts.some((a) => CASH_CONNECTED_PREFIXES.some((p) => a.startsWith(p)));
export const buysSalesDrillMatches = (accounts: string[]) =>
  txnHasInvestmentAsset(accounts) && txnIsCashConnected(accounts);

// The Other/Adjustments bar = −(sum of ALL equity postings). Matched transfer
// pairs (both legs in the same Equity:Transfers:<name> bucket) net to zero
// inside the bar, so showing them in the drill is pure noise — the drill
// selects only the equity accounts that can actually net to something:
// openings, historical plugs. CAVEAT: a ONE-SIDED transfer leg does move the
// bar but is excluded here; those are ledger defects, caught by the
// transfer-bucket sweep (`bal Equity:Transfers` ≈ 0, see RECONCILIATION_QC),
// not by this view.
const otherAdjustmentsPattern = "^Equity:(?!Transfers:)";
export const otherAdjustmentsClause = `account =~ /${otherAdjustmentsPattern}/`;
export const otherDrillMatches = (accounts: string[]) =>
  accounts.some((a) => new RegExp(otherAdjustmentsPattern).test(a));

// Drill-down: clicking a bar opens Ledger → Transactions pre-filtered to the
// accounts that feed it (the query is visible and editable there — the point
// is auditability). Computed bars (checkpoints, carried, pnl-derived) have no
// posting-level source, so they get no clause and stay non-clickable. The
// buys/sales pair shares one clause: the split is by sign of the balance
// delta, which a posting filter can't express — the drill shows BOTH sides.
export const DRILL_CLAUSES: Record<string, string> = {
  "Income (Operating)":
    "account =~ /^Income:/ AND NOT account =~ /^Income:(Rental|Dividends|Salary:Vestwell|Business:Courtney)/",
  "Expenses (Operating)":
    "account =~ /^Expenses:/ AND NOT account =~ /^(Expenses:Rental|Expenses:Housing:Mortgage|Expenses:Tax:Property|Expenses:Business(?!:CJ))/",
  "Courtney's Business (Net)":
    "(account =~ /^Income:Business:Courtney/ OR (account =~ /^Expenses:Business/ AND NOT account =~ /^Expenses:Business:CJ/))",
  "Rental (Net Cash)":
    "account =~ /^(Income:Rental|Expenses:Rental|Expenses:Housing:Mortgage|Expenses:Tax:Property|Liabilities:Mortgages)/",
  "Cash → Investments & Assets": buysSalesClause,
  "Investment Sales → Cash": buysSalesClause,
  "Principal (Paid to Ourselves)": "account =~ /^Liabilities:Mortgages:/",
  "Vestwell Contributions (Payroll)": "account =~ /^Income:Salary:Vestwell/",
  "Dividends (Reinvested)": "account =~ /^Income:Dividends/",
  "Other / Adjustments": otherAdjustmentsClause
};
