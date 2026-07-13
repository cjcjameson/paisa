<script lang="ts">
  import COLORS from "$lib/colors";
  import BoxLabel from "$lib/components/BoxLabel.svelte";
  import LegendCard from "$lib/components/LegendCard.svelte";
  import LevelItem from "$lib/components/LevelItem.svelte";
  import {
    renderMonthlyInvestmentTimeline,
    renderYearlyIncomeTimeline,
    renderYearlyTimelineOf
  } from "$lib/income";
  import { ajax, formatCurrency, type Income, type Legend, type Tax } from "$lib/utils";
  import _ from "lodash";
  import { onMount } from "svelte";

  let grossIncome = 0;
  let netTax = 0;

  let monthlyInvestmentTimelineLegends: Legend[] = [];
  let yearlyIncomeTimelineLegends: Legend[] = [];
  let yearlyNetIncomeTimelineLegends: Legend[] = [];
  let yearlyNetTaxTimelineLegends: Legend[] = [];

  let allIncomes: Income[] = [];
  let allTaxes: Tax[] = [];
  let ready = false;

  // Range filter (inclusive, "YYYY-MM"). Defaults to the trailing 3 years.
  let fromMonth = "";
  let toMonth = "";
  let minMonth = "";
  let maxMonth = "";
  let selectedGroup: string | null = null;
  let activePreset: "1y" | "3y" | "all" | null = null;

  function monthOf(d: { date: any }): string {
    return d.date.format("YYYY-MM");
  }

  function setTrailingYears(years: number) {
    toMonth = maxMonth;
    const last = _.last(allIncomes);
    fromMonth = last
      ? last.date
          .subtract(years * 12 - 1, "month")
          .format("YYYY-MM")
      : minMonth;
    if (fromMonth < minMonth) fromMonth = minMonth;
  }

  function setAll() {
    fromMonth = minMonth;
    toMonth = maxMonth;
  }

  function rebuild() {
    if (!ready || !fromMonth || !toMonth || fromMonth > toMonth) return;
    const incomes = _.filter(allIncomes, (i) => {
      const m = monthOf(i);
      return m >= fromMonth && m <= toMonth;
    });
    const legends = renderMonthlyInvestmentTimeline(incomes, selectedGroup);
    monthlyInvestmentTimelineLegends = _.map(legends, (l) => {
      const group = l.label.split("\n")[0];
      l.selected = group === selectedGroup;
      l.onClick = () => {
        selectedGroup = selectedGroup === group ? null : group;
        rebuild();
      };
      return l;
    });

    grossIncome = _.sumBy(incomes, (i) => _.sumBy(i.postings, (p) => -p.amount));
    // Tax timeline buckets are financial YEARS (start_date/end_date), so
    // filter by the individual posting dates instead.
    netTax = _.sumBy(allTaxes, (t) =>
      _.sumBy(t.postings, (p) => {
        const m = p.date.format("YYYY-MM");
        return m >= fromMonth && m <= toMonth ? p.amount : 0;
      })
    );
  }

  onMount(async () => {
    const {
      income_timeline: incomes,
      tax_timeline: taxes,
      yearly_cards: yearlyCards
    } = await ajax("/api/income");
    allIncomes = _.sortBy(incomes, (i) => monthOf(i));
    allTaxes = taxes;
    minMonth = _.isEmpty(allIncomes) ? "" : monthOf(_.first(allIncomes));
    maxMonth = _.isEmpty(allIncomes) ? "" : monthOf(_.last(allIncomes));
    ready = true;
    activePreset = "3y";
    setTrailingYears(3);
    rebuild();

    yearlyIncomeTimelineLegends = renderYearlyIncomeTimeline(yearlyCards);
    yearlyNetIncomeTimelineLegends = renderYearlyTimelineOf(
      "Net Income",
      "net_income",
      COLORS.gain,
      yearlyCards
    );
    yearlyNetTaxTimelineLegends = renderYearlyTimelineOf(
      "Net Tax",
      "net_tax",
      COLORS.loss,
      yearlyCards
    );
  });
</script>

<section class="section tab-income">
  <div class="container">
    <nav class="level">
      <LevelItem title="Gross Income" value={formatCurrency(grossIncome)} color={COLORS.gainText} />
      <LevelItem title="Net Tax" value={formatCurrency(netTax)} color={COLORS.lossText} />
    </nav>
  </div>
</section>
<section class="section">
  <div class="container is-fluid">
    <div class="columns">
      <div class="column is-12">
        <div class="box">
          <div class="is-flex is-align-items-center is-flex-wrap-wrap ml-4 mb-2" style="gap: 0.75rem;">
            <div class="buttons has-addons mb-0">
              <button
                class="button is-small"
                class:is-link={activePreset === "1y"}
                on:click={() => {
                  activePreset = "1y";
                  setTrailingYears(1);
                  rebuild();
                }}>1y</button
              >
              <button
                class="button is-small"
                class:is-link={activePreset === "3y"}
                on:click={() => {
                  activePreset = "3y";
                  setTrailingYears(3);
                  rebuild();
                }}>3y</button
              >
              <button
                class="button is-small"
                class:is-link={activePreset === "all"}
                on:click={() => {
                  activePreset = "all";
                  setAll();
                  rebuild();
                }}>all</button
              >
            </div>
            <div class="is-flex is-align-items-center" style="gap: 0.25rem;">
              <input
                class="input is-small"
                type="month"
                min={minMonth}
                max={maxMonth}
                bind:value={fromMonth}
                on:change={() => {
                  activePreset = null;
                  rebuild();
                }}
              />
              <span class="has-text-grey">→</span>
              <input
                class="input is-small"
                type="month"
                min={minMonth}
                max={maxMonth}
                bind:value={toMonth}
                on:change={() => {
                  activePreset = null;
                  rebuild();
                }}
              />
              <span class="has-text-grey is-size-7">(inclusive)</span>
            </div>
            {#if selectedGroup}
              <button
                class="button is-small is-rounded"
                on:click={() => {
                  selectedGroup = null;
                  rebuild();
                }}>showing {selectedGroup} ✕</button
              >
            {/if}
          </div>
          <LegendCard legends={monthlyInvestmentTimelineLegends} clazz="ml-4" />
          <svg id="d3-income-timeline" width="100%" height="500" />
        </div>
      </div>
    </div>
    <BoxLabel text="Monthly Income Timeline (click a category to filter)" />
  </div>
</section>
<section class="section">
  <div class="container is-fluid">
    <div class="columns">
      <div class="column is-one-third">
        <div class="box px-3">
          <LegendCard legends={yearlyIncomeTimelineLegends} clazz="ml-4" />
          <svg id="d3-yearly-income-timeline" width="100%" />
        </div>
      </div>
      <div class="column is-one-third">
        <div class="box px-3">
          <LegendCard legends={yearlyNetIncomeTimelineLegends} clazz="ml-4" />
          <svg id="d3-yearly-net_income-timeline" width="100%" />
        </div>
      </div>
      <div class="column is-one-third">
        <div class="box px-3">
          <LegendCard legends={yearlyNetTaxTimelineLegends} clazz="ml-4" />
          <svg id="d3-yearly-net_tax-timeline" width="100%" />
        </div>
      </div>
    </div>
    <BoxLabel text="Financial Year Income Timeline" />
  </div>
</section>
