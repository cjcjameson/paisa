import { describe, expect, test } from "bun:test";
import {
  buysSalesDrillMatches,
  otherDrillMatches,
  txnIsCashConnected,
  CASH_CONNECTED_PREFIXES,
  DRILL_CLAUSES
} from "./waterfall_rules";

// Each fixture is a transaction (its posting accounts) plus the CLASSIFICATION
// the Go backend gives its asset legs (internal/server/income_statement.go,
// isCashConnected). The buys/sales drill query must select exactly the
// transactions whose investment-asset legs are classified CASH — that is the
// bar↔drill isomorphism this file pins down.
const TXNS: Array<{ name: string; accounts: string[]; cash: boolean; inDrill: boolean }> = [
  {
    name: "Bronco bought by wire from checking",
    accounts: ["Assets:Checking:Schwab:3391", "Assets:Vehicles:FordBronco"],
    cash: true,
    inDrill: true
  },
  {
    name: "Vanguard sale, transfer-paired (deposit arrives in a separate txn)",
    accounts: ["Assets:Vanguard:Trust", "Equity:Transfers:Vanguard"],
    cash: true,
    inDrill: true
  },
  {
    name: "Carvana payout for the Corolla into checking",
    accounts: ["Assets:Checking:Schwab:3391", "Assets:Vehicles:ToyotaCorolla"],
    cash: true,
    inDrill: true
  },
  {
    name: "dividend reinvestment inside Vanguard",
    accounts: ["Income:Dividends:VTI", "Assets:Vanguard:Roth:CJ"],
    cash: false,
    inDrill: false
  },
  {
    name: "HSA dividend / reconcile (in-account)",
    accounts: ["Income:Dividends:VTI", "Assets:Investments:FidelityHSA"],
    cash: false,
    inDrill: false
  },
  {
    name: "Vestwell payroll contribution (withheld, never touched checking)",
    accounts: ["Income:Salary:VestwellWithheld", "Assets:Vestwell:Roth"],
    cash: false,
    inDrill: false
  },
  {
    name: "options vest (no cash, equity-countered)",
    accounts: ["Assets:Options:Parabola:Unexercised", "Equity:OpeningBalance"],
    cash: false,
    inDrill: false
  },
  {
    name: "opening balance entering tracking mid-window",
    accounts: ["Assets:Investments:FidelityHSA", "Equity:OpeningBalance"],
    cash: false,
    inDrill: false
  },
  {
    name: "Vestwell corrective refund INTO checking (cash, but Vestwell is bar-excluded)",
    accounts: ["Assets:Checking:Schwab:3391", "Assets:Vestwell:Roth"],
    cash: true,
    inDrill: false // Vestwell has its own bar; buys/sales exclude it
  },
  {
    name: "plain card expense (no investment asset at all)",
    accounts: ["Liabilities:CreditCards:Bilt", "Expenses:Groceries"],
    cash: true,
    inDrill: false
  }
];

describe("bar ↔ drill isomorphism (buys/sales)", () => {
  for (const t of TXNS) {
    test(t.name, () => {
      expect(txnIsCashConnected(t.accounts)).toBe(t.cash);
      expect(buysSalesDrillMatches(t.accounts)).toBe(t.inDrill);
    });
  }

  test("Other/Adjustments drill: openings in, matched transfer pairs out", () => {
    // The bar sums ALL equity, but matched Equity:Transfers pairs net to zero
    // inside it — the drill shows only equity that can net to something.
    expect(
      otherDrillMatches(["Assets:Investments:FidelityHSA", "Equity:OpeningBalance"])
    ).toBe(true);
    expect(
      otherDrillMatches(["Equity:Transfers:Schwab", "Equity:Historical:InterAccount"])
    ).toBe(true); // plugs stay visible even when paired with a transfer bucket
    expect(otherDrillMatches(["Assets:Checking:Schwab:3391", "Equity:Transfers:Schwab"])).toBe(
      false
    );
    expect(DRILL_CLAUSES["Other / Adjustments"]).toContain("(?!Transfers:)");
  });

  test("Income Tax drill and Expenses drill partition household tax", () => {
    // Household income tax has its own bar: the tax drill selects it, the
    // operating-expenses drill must NOT, and property tax belongs to neither
    // (it lives in the rental bar).
    const taxClause = DRILL_CLAUSES["Income Tax (Net)"];
    const expensesClause = DRILL_CLAUSES["Expenses (Operating)"];
    expect(taxClause).toContain("Expenses:Tax:");
    expect(taxClause).toContain("Expenses:Tax:Property");
    expect(expensesClause).toContain("Expenses:Tax");
    expect(DRILL_CLAUSES["Rental (Net Cash)"]).toContain("Expenses:Tax:Property");
  });

  test("drill clause string embeds every cash-connected prefix", () => {
    // The query shown to the user must be built from the same prefix list the
    // backend uses — if the Go rule gains a prefix, this list must too, and
    // the derived query updates automatically.
    const clause = DRILL_CLAUSES["Investment Sales → Cash"];
    for (const prefix of CASH_CONNECTED_PREFIXES) {
      expect(clause).toContain(prefix);
    }
    expect(DRILL_CLAUSES["Cash → Investments & Assets"]).toEqual(clause);
  });
});
