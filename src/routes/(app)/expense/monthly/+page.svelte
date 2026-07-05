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

  let groups = writable([]);
  let z: d3.ScaleOrdinal<string, string, never>,
    renderer: (ps: Posting[]) => void,
    expenses: Posting[],
    grouped_expenses: Record<string, Posting[]>,
    destroy: () => void;

  let legends: Legend[] = [];
  let legendMaxVisible = Infinity;

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
    ({
      expenses: expenses,
      month_wise: { expenses: grouped_expenses }
    } = await ajax("/api/expense"));

    setAllowedDateRange(_.map(expenses, (e) => e.date));
    ({ z, destroy, legends, legendMaxVisible } = renderMonthlyExpensesTimeline(
      expenses,
      groups,
      month,
      dateRange
    ));
    renderer = renderCurrentExpensesBreakdown(z);
  });
</script>

<section class="section tab-expense">
  <div class="container is-fluid">
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
