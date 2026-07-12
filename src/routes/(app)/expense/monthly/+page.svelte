<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import _ from "lodash";
  import { ajax, type Posting, type Legend } from "$lib/utils";
  import {
    renderMonthlyExpensesTimeline,
    renderCurrentExpensesBreakdown,
    renderCalendar
  } from "$lib/expense/monthly";
  import { dateRange, month, setAllowedDateRange } from "../../../../store";
  import { writable } from "svelte/store";
  import ZeroState from "$lib/components/ZeroState.svelte";
  import BoxLabel from "$lib/components/BoxLabel.svelte";
  import dayjs from "dayjs";
  import LegendCard from "$lib/components/LegendCard.svelte";
  import * as d3 from "d3";

  let groups = writable([]);
  let z: d3.ScaleOrdinal<string, string, never>,
    renderer: (ps: Posting[]) => void,
    expenses: Posting[],
    grouped_expenses: Record<string, Posting[]>,
    destroy: () => void;

  let legends: Legend[] = [];
  let legendMaxVisible = Infinity;

  // Default view = pure household spending (matches the waterfall's Operating
  // section). Courtney's business and the rentals are cost centers with their
  // own income; include them explicitly when you want the full picture.
  let includeCourtney = false;
  let includeRental = false;
  let rawExpenses: Posting[] = null;
  let rawGrouped: Record<string, Posting[]> = null;

  const isCourtneyExpense = (a: string) =>
    a.startsWith("Expenses:Business") && !a.startsWith("Expenses:Business:CJ");
  const isRentalExpense = (a: string) =>
    a.startsWith("Expenses:Rental") ||
    a === "Expenses:Housing:Mortgage" ||
    a.startsWith("Expenses:Tax:Property");
  const keep = (p: Posting) =>
    (includeCourtney || !isCourtneyExpense(p.account)) &&
    (includeRental || !isRentalExpense(p.account));

  function rebuild() {
    if (!rawExpenses) return;
    if (destroy) destroy();
    // The renderers append into these svgs; clear before re-initializing.
    d3.select("#d3-monthly-expense-timeline").selectAll("*").remove();
    d3.select("#d3-current-month-breakdown").selectAll("*").remove();
    expenses = _.filter(rawExpenses, keep);
    grouped_expenses = _.mapValues(rawGrouped, (ps) => _.filter(ps, keep));
    ({ z, destroy, legends, legendMaxVisible } = renderMonthlyExpensesTimeline(
      expenses,
      groups,
      month,
      dateRange
    ));
    renderer = renderCurrentExpensesBreakdown(z);
  }

  function toggle(which: "courtney" | "rental") {
    if (which === "courtney") includeCourtney = !includeCourtney;
    else includeRental = !includeRental;
    rebuild();
  }

  $: if (grouped_expenses) {
    renderCalendar($month, grouped_expenses[$month], z, $groups);
    renderer(grouped_expenses[$month] || []);
  }

  onDestroy(async () => {
    if (destroy) {
      destroy();
    }
  });

  onMount(async () => {
    let allExpenses: Posting[], allGrouped: Record<string, Posting[]>;
    ({
      expenses: allExpenses,
      month_wise: { expenses: allGrouped }
    } = await ajax("/api/expense"));
    rawExpenses = allExpenses;
    rawGrouped = allGrouped;

    setAllowedDateRange(_.map(rawExpenses, (e) => e.date));
    rebuild();
  });
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
      <div class="column is-full">
        <div class="columns is-flex-wrap-wrap">
          <div class="column is-4">
            <div class="p-3 box">
              <div id="d3-current-month-expense-calendar" class="d3-calendar">
                <div class="weekdays">
                  {#each dayjs.weekdaysShort(true) as day}
                    <div>{day}</div>
                  {/each}
                </div>
                <div class="days" />
              </div>
            </div>
          </div>
          <div class="column is-8">
            <div class="px-3 box" style="height: 100%">
              <ZeroState item={grouped_expenses?.[$month]}>
                <strong>Hurray!</strong> You have no expenses this month.
              </ZeroState>
              <svg id="d3-current-month-breakdown" width="100%" />
            </div>
          </div>
          <div class="column is-full">
            <div class="box">
              <ZeroState item={expenses}>
                <strong>Oops!</strong> You have no expenses.
              </ZeroState>
              <LegendCard {legends} maxVisible={legendMaxVisible} clazz="ml-4" />
              <svg id="d3-monthly-expense-timeline" width="100%" height="400" />
            </div>
          </div>
        </div>
        <BoxLabel text="Monthly Expenses" />
      </div>
    </div>
  </div>
</section>
