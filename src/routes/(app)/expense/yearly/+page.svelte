<script lang="ts">
  import * as d3 from "d3";
  import { onMount } from "svelte";
  import _ from "lodash";
  import { ajax, formatCurrency, formatPercentage, type Legend, type Posting } from "$lib/utils";
  import {
    renderYearlyExpensesTimeline,
    renderCurrentExpensesBreakdown,
    renderCalendar
  } from "$lib/expense/yearly";
  import { dateMin, dateMax, year } from "../../../../store";
  import { writable } from "svelte/store";
  import LevelItem from "$lib/components/LevelItem.svelte";
  import COLORS from "$lib/colors";
  import ZeroState from "$lib/components/ZeroState.svelte";
  import BoxLabel from "$lib/components/BoxLabel.svelte";
  import LegendCard from "$lib/components/LegendCard.svelte";

  let groups = writable([]);
  let z: d3.ScaleOrdinal<string, string, never>,
    renderer: (ps: Posting[]) => void,
    expenses: Posting[],
    grouped_expenses: Record<string, Posting[]>,
    grouped_incomes: Record<string, Posting[]>,
    grouped_taxes: Record<string, Posting[]>;

  let rawExpenses: Posting[] = null;
  let rawGroupedExpenses: Record<string, Posting[]> = null;

  let currentYearExpenses: Posting[] = [];

  let legends: Legend[] = [];

  // Default view = pure household spending, same as the monthly page and the
  // waterfall's Operating section. Courtney's business and the rentals are
  // cost centers with their own income; include them explicitly.
  let includeCourtney = false;
  let includeRental = false;

  const isCourtneyExpense = (a: string) =>
    a.startsWith("Expenses:Business") && !a.startsWith("Expenses:Business:CJ");
  const isRentalExpense = (a: string) =>
    a.startsWith("Expenses:Rental") ||
    a === "Expenses:Housing:Mortgage" ||
    a.startsWith("Expenses:Tax:Property");
  const keep = (p: Posting) =>
    (includeCourtney || !isCourtneyExpense(p.account)) &&
    (includeRental || !isRentalExpense(p.account));

  // Topline tiles mirror the waterfall's OPERATING section (income_statement.ts):
  // operating income excludes rental rent, reinvested dividends, payroll-withheld
  // Vestwell contributions and Courtney's revenue; operating expenses exclude
  // rental & Courtney costs but include household (non-property) tax.
  const isRentalIncome = (a: string) => a.startsWith("Income:Rental");
  const isDividendIncome = (a: string) => a.startsWith("Income:Dividends");
  const isVestwellIncome = (a: string) => a.startsWith("Income:Salary:Vestwell");
  const isCourtneyIncome = (a: string) => a.startsWith("Income:Business:Courtney");
  const isPropertyTax = (a: string) => a.startsWith("Expenses:Tax:Property");

  let operatingIncome = "",
    operatingExpense = "",
    netCourtney = "",
    opCashFlow = "",
    opCashFlowValue = 0,
    incomeSubtitle = "",
    expenseSubtitle = "",
    courtneySubtitle = "",
    opCfSubtitle = "";

  function toggle(which: "courtney" | "rental") {
    if (which === "courtney") includeCourtney = !includeCourtney;
    else includeRental = !includeRental;
    rebuild();
  }

  function rebuild() {
    if (!rawExpenses) return;
    d3.select("#d3-yearly-expense-timeline").selectAll("*").remove();
    d3.select("#d3-current-year-breakdown").selectAll("*").remove();
    expenses = _.filter(rawExpenses, keep);
    grouped_expenses = _.mapValues(rawGroupedExpenses, (ps) => _.filter(ps, keep));
    ({ z, legends } = renderYearlyExpensesTimeline(expenses, groups, year));
    renderer = renderCurrentExpensesBreakdown(z);
    grouped_expenses = { ...grouped_expenses }; // retrigger the reactive block
  }

  $: if (grouped_expenses) {
    currentYearExpenses = grouped_expenses[$year] || [];
    renderCalendar(currentYearExpenses, z, $groups);

    const chartExpenses = grouped_expenses[$year] || [];
    // Topline is definition-fixed (waterfall Operating), independent of the
    // chart toggles: always household-only.
    const allExpenses = (rawGroupedExpenses || {})[$year] || [];
    const incomes = (grouped_incomes || {})[$year] || [];
    const taxes = (grouped_taxes || {})[$year] || [];

    const opIncomePostings = _.reject(
      incomes,
      (p) =>
        isRentalIncome(p.account) ||
        isDividendIncome(p.account) ||
        isVestwellIncome(p.account) ||
        isCourtneyIncome(p.account)
    );
    const opInc = -sum(opIncomePostings);

    const householdExpenses = _.reject(
      allExpenses,
      (p) => isRentalExpense(p.account) || isCourtneyExpense(p.account)
    );
    const householdTax = _.reject(taxes, (p) => isPropertyTax(p.account));
    const opExp = sum(householdExpenses) + sum(householdTax);

    const courtneyNet =
      -sum(_.filter(incomes, (p) => isCourtneyIncome(p.account))) -
      sum(_.filter(allExpenses, (p) => isCourtneyExpense(p.account)));

    opCashFlowValue = opInc - opExp + courtneyNet;

    operatingIncome = formatCurrency(opInc);
    operatingExpense = formatCurrency(opExp);
    netCourtney = formatCurrency(courtneyNet);
    opCashFlow = formatCurrency(opCashFlowValue);

    incomeSubtitle = "excl. rental, dividends, Courtney, 401k withheld";
    expenseSubtitle =
      opInc > 0
        ? formatPercentage(opExp / opInc) + " of operating income (incl. household tax)"
        : "incl. household tax";
    courtneySubtitle = "her revenue − her costs";
    opCfSubtitle = "matches the waterfall's Operating Cash Flow bar";

    renderer(chartExpenses);
  }

  onMount(async () => {
    ({
      expenses: rawExpenses,
      year_wise: {
        expenses: rawGroupedExpenses,
        incomes: grouped_incomes,
        taxes: grouped_taxes
      }
    } = await ajax("/api/expense"));

    const [start, end] = d3.extent(_.map(rawExpenses, (e) => e.date));
    if (start) {
      dateMin.set(start);
      dateMax.set(end);
    }

    rebuild();
  });

  function sum(postings: Posting[], sign = 1) {
    return sign * _.sumBy(postings, (p) => p.amount);
  }
</script>

<section class="section tab-expense">
  <div class="container is-fluid">
    <div class="columns">
      <div class="column is-12 py-0">
        <div class="tags are-medium mb-0">
          <span class="tag is-white has-text-grey is-size-7">Showing: household spending</span>
          <button
            class="tag button {includeCourtney ? 'is-link' : 'is-light'}"
            title="Courtney's business expenses (Expenses:Business, except CJ's software)"
            on:click={() => toggle("courtney")}
          >
            {includeCourtney ? "✓" : "+"} Courtney's business
          </button>
          <button
            class="tag button {includeRental ? 'is-link' : 'is-light'}"
            title="Rental expenses (Expenses:Rental, mortgage interest, Michigan property tax)"
            on:click={() => toggle("rental")}
          >
            {includeRental ? "✓" : "+"} Rental
          </button>
        </div>
      </div>
    </div>
    <div class="columns is-flex-wrap-wrap">
      <div class="column is-3">
        <div class="columns is-flex-wrap-wrap">
          <div class="column is-full">
            <div>
              <nav class="level grid-2">
                <LevelItem
                  title="Operating Income"
                  value={operatingIncome}
                  color={COLORS.gainText}
                  subtitle={incomeSubtitle}
                />
                <LevelItem
                  title="Operating Expenses"
                  value={operatingExpense}
                  color={COLORS.lossText}
                  subtitle={expenseSubtitle}
                />
              </nav>
            </div>
          </div>
          <div class="column is-full">
            <div>
              <nav class="level grid-2">
                <LevelItem
                  title="Courtney's Business (Net)"
                  value={netCourtney}
                  color={COLORS.secondary}
                  subtitle={courtneySubtitle}
                />

                <LevelItem
                  title="Operating Cash Flow"
                  value={opCashFlow}
                  color={opCashFlowValue >= 0 ? COLORS.gainText : COLORS.lossText}
                  subtitle={opCfSubtitle}
                />
              </nav>
            </div>
          </div>
        </div>
      </div>
      <div class="column is-3">
        <div class="px-3 box">
          <div id="d3-current-year-expense-calendar" class="d3-calendar">
            <div class="months" />
          </div>
        </div>
      </div>
      <div class="column is-full-tablet is-half-fullhd">
        <div class="px-3 box" style="height: 100%">
          <ZeroState item={currentYearExpenses}>
            <strong>Hurray!</strong> You have no expenses this year.
          </ZeroState>
          <svg id="d3-current-year-breakdown" width="100%" />
        </div>
      </div>
      <div class="column is-12">
        <div class="box">
          <ZeroState item={expenses}>
            <strong>Oops!</strong> You have no expenses.
          </ZeroState>

          <LegendCard {legends} clazz="ml-4" />
          <svg id="d3-yearly-expense-timeline" width="100%" height="500" />
        </div>
      </div>
    </div>
    <BoxLabel text="Yearly Expenses" />
  </div>
</section>
