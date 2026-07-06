<script lang="ts">
  import {
    renderAllocation,
    renderAllocationTarget,
    renderAllocationTimeline,
    renderNetworthTreemap
  } from "$lib/allocation";
  import COLORS, { generateColorScheme } from "$lib/colors";
  import BoxLabel from "$lib/components/BoxLabel.svelte";
  import LegendCard from "$lib/components/LegendCard.svelte";
  import Table from "$lib/components/Table.svelte";
  import { accountName, nonZeroCurrency } from "$lib/table_formatters";
  import { ajax, formatPercentage, lastName, rem, type Aggregate, type Legend } from "$lib/utils";
  import _ from "lodash";
  import { onMount, tick } from "svelte";
  import type { ColumnDefinition, ProgressBarParams } from "tabulator-tables";

  let showAllocation = false;
  let depth = 2;
  let allocationTimelineLegends: Legend[] = [];
  let aggregateLeafNodes: Aggregate[] = [];
  let total = 0;

  const columns: ColumnDefinition[] = [
    { title: "Account", field: "account", formatter: accountName },
    {
      title: "Market Value",
      field: "market_amount",
      hozAlign: "right",
      formatter: nonZeroCurrency
    },
    {
      title: "Percent",
      field: "percent",
      hozAlign: "right",
      formatter: (cell) => formatPercentage(cell.getValue() / 100, 2)
    },
    {
      title: "%",
      field: "percent",
      hozAlign: "right",
      formatter: "progress",
      cssClass: "has-text-left",
      minWidth: rem(250),
      formatterParams: {
        color: COLORS.assets,
        min: 0
      }
    }
  ];

  onMount(async () => {
    const {
      aggregates: aggregates,
      aggregates_timeline: aggregatesTimeline,
      allocation_targets: allocationTargets
    } = await ajax("/api/allocation");

    // Net worth = assets net of matching mortgages. Subtract each
    // Liabilities:Mortgages:<Property> from Assets:RealEstate:<Property> so the
    // treemap shows house EQUITY. Display-only; the ledger is untouched.
    const { liability_breakdowns: liabilities } = await ajax("/api/liabilities/balance");
    const netAggregates: Record<string, Aggregate> = _.cloneDeep(aggregates);
    _.each(liabilities, (l: any, account: string) => {
      if (!account.startsWith("Liabilities:Mortgages:")) return;
      const property = `Assets:RealEstate:${lastName(account)}`;
      if (netAggregates[property]) {
        (netAggregates[property] as any).gross_amount = netAggregates[property].market_amount;
        (netAggregates[property] as any).mortgage_amount = Math.abs(l.balance_amount);
        netAggregates[property].market_amount -= Math.abs(l.balance_amount);
      }
    });

    const accounts = _.keys(aggregates);
    aggregateLeafNodes = _.filter(_.values(aggregates), (a) => a.market_amount > 0);
    total = _.sumBy(aggregateLeafNodes, (a) => a.market_amount);
    aggregateLeafNodes = _.map(aggregateLeafNodes, (a) => {
      a.percent = (a.market_amount / total) * 100;
      return a;
    });
    const max = _.max(_.map(aggregateLeafNodes, (a) => a.percent)) || 100;
    (_.last(columns).formatterParams as ProgressBarParams).max = max;
    const color = generateColorScheme(accounts);
    depth = _.max(_.map(accounts, (account) => account.split(":").length));

    if (!_.isEmpty(allocationTargets)) {
      showAllocation = true;
    }
    await tick();

    renderNetworthTreemap(netAggregates, color);
    renderAllocationTarget(allocationTargets, color);
    renderAllocation(aggregates, color);
    allocationTimelineLegends = renderAllocationTimeline(aggregatesTimeline);
  });
</script>

<section class="section tab-allocation">
  <div class="container is-fluid">
    <div class="columns">
      <div class="column is-12 has-text-centered">
        <div id="d3-networth-treemap" style="width: 100%; height: 420px" />
      </div>
    </div>
    <BoxLabel text="Net Worth — house equity (real estate net of mortgages)" />
  </div>
</section>
<section class="section tab-allocation" style={showAllocation ? "" : "display: none"}>
  <div class="container is-fluid">
    <div class="columns">
      <div class="column is-12 has-text-centered">
        <div class="box overflow-x-auto">
          <div id="d3-allocation-target-treemap" style="width: 100%; position: relative" />
          <svg id="d3-allocation-target" />
        </div>
      </div>
    </div>
    <BoxLabel text="Allocation Targets" />
  </div>
</section>
<section class="section tab-allocation">
  <div class="container is-fluid">
    <div class="columns">
      <div class="column is-12 has-text-centered">
        <div id="d3-allocation-category" style="width: 100%; height: {depth * 100}px" />
      </div>
    </div>
    <BoxLabel text="Allocation by category" />
  </div>
</section>
<section class="section tab-allocation">
  <div class="container is-fluid">
    <div class="columns">
      <div class="column is-12 has-text-centered">
        <div id="d3-allocation-value" style="width: 100%; height: 300px" />
      </div>
    </div>
    <BoxLabel text="Allocation by value" />
  </div>
</section>
<section class="section tab-allocation">
  <div class="container is-fluid">
    <div class="columns">
      <div class="column is-12">
        <div class="box">
          <LegendCard legends={allocationTimelineLegends} clazz="ml-4" />
          <svg id="d3-allocation-timeline" width="100%" height="300" />
        </div>
      </div>
    </div>
    <BoxLabel text="Allocation Timeline" />
  </div>
</section>
<section class="section tab-allocation">
  <div class="container is-fluid">
    <div class="columns">
      <div class="column is-12">
        <Table data={aggregateLeafNodes} tree {columns} />
      </div>
    </div>
    <BoxLabel text="Allocation Table" />
  </div>
</section>
