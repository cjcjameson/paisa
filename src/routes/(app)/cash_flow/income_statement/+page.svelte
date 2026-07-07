<script lang="ts">
  import { onMount } from "svelte";
  import _ from "lodash";
  import { renderIncomeStatement } from "$lib/income_statement";
  import {
    ajax,
    formatCurrency,
    formatPercentage,
    restName,
    type IncomeStatement,
    firstName
  } from "$lib/utils";
  import { dateMin, year } from "../../../../store";
  import ZeroState from "$lib/components/ZeroState.svelte";
  import { iconify } from "$lib/icon";

  let isEmpty = false;

  let svg: Element;
  let incomeStatement: IncomeStatement;
  let renderer: (data: IncomeStatement) => void;
  let yearly: Record<string, IncomeStatement> = {};
  let monthly: Record<string, IncomeStatement> = {};
  let diff: number;
  let diffPercent: number;
  let years: string[] = [];

  // Custom range mode: aggregate monthly buckets ("2026-01") into any
  // contiguous window instead of a whole FY.
  let rangeMode = false;
  let fromMonth = "";
  let toMonth = "";
  $: monthKeys = _.sortBy(_.keys(monthly));

  const AGG_MAPS = [
    "income",
    "interest",
    "equity",
    "pnl",
    "assets",
    "liabilities",
    "tax",
    "expenses"
  ] as const;

  function aggregateRange(from: string, to: string): IncomeStatement | null {
    if (!from || !to || from > to) return null;
    const keys = monthKeys.filter((k) => k >= from && k <= to);
    if (_.isEmpty(keys)) return null;
    const agg: any = {
      date: monthly[keys[0]].date,
      startingBalance: monthly[keys[0]].startingBalance,
      endingBalance: monthly[_.last(keys)].endingBalance
    };
    for (const m of AGG_MAPS) agg[m] = {};
    for (const k of keys) {
      const s: any = monthly[k];
      for (const m of AGG_MAPS) {
        for (const [acct, v] of Object.entries(s[m] || {})) {
          agg[m][acct] = (agg[m][acct] || 0) + (v as number);
        }
      }
    }
    return agg as IncomeStatement;
  }

  type AccountGroupName =
    | "income"
    | "interest"
    | "equity"
    | "pnl"
    | "liabilities"
    | "tax"
    | "expenses";
  interface AccountGroup {
    key: AccountGroupName;
    accounts: string[];
    label: string;
    multiplier: number;
  }

  function formatUnlessZero(value: number) {
    if (value != 0) {
      return formatCurrency(value);
    }
    return "";
  }

  function changeClass(value: number) {
    if (value > 0) {
      return "has-text-success";
    } else if (value < 0) {
      return "has-text-danger";
    } else {
      return "has-text-grey";
    }
  }

  const sum = (object: Record<string, number>) => Object.values(object).reduce((a, b) => a + b, 0);

  const accountGroups: AccountGroup[] = [];

  $: if (renderer) {
    const statement = rangeMode ? aggregateRange(fromMonth, toMonth) : yearly && yearly[$year];
    if (statement == null) {
      incomeStatement = null;
      isEmpty = true;
    } else {
      incomeStatement = statement;
      years = _.sortBy(_.keys(yearly)).reverse();
      diff = incomeStatement.endingBalance - incomeStatement.startingBalance;
      diffPercent = diff / incomeStatement.startingBalance;

      renderer(incomeStatement);
      isEmpty = false;
    }
  }

  function uniqueAccounts(statements: IncomeStatement[], key: AccountGroupName) {
    const accounts = new Set<string>();
    for (const statement of statements) {
      for (const account of _.keys(statement[key])) {
        accounts.add(account);
      }
    }
    return Array.from(accounts).sort();
  }

  onMount(async () => {
    ({ yearly, monthly } = await ajax("/api/income_statement"));
    const y = _.minBy(_.values(yearly), (y) => y.date);
    renderer = renderIncomeStatement(svg);
    if (y) {
      dateMin.set(y.date);
    }

    // Default custom range: trailing 6 months.
    const keys = _.sortBy(_.keys(monthly));
    if (keys.length > 0) {
      toMonth = _.last(keys);
      fromMonth = keys[Math.max(0, keys.length - 6)];
    }

    accountGroups.push({
      key: "income",
      accounts: uniqueAccounts(_.values(yearly), "income"),
      label: "Income",
      multiplier: -1
    });

    accountGroups.push({
      key: "tax",
      accounts: uniqueAccounts(_.values(yearly), "tax"),
      label: "Tax",
      multiplier: -1
    });

    accountGroups.push({
      key: "interest",
      accounts: uniqueAccounts(_.values(yearly), "interest"),
      label: "Interest",
      multiplier: -1
    });

    accountGroups.push({
      key: "pnl",
      accounts: uniqueAccounts(_.values(yearly), "pnl"),
      label: "Gain / Loss",
      multiplier: 1
    });

    accountGroups.push({
      key: "equity",
      accounts: uniqueAccounts(_.values(yearly), "equity"),
      label: "Equity",
      multiplier: -1
    });

    accountGroups.push({
      key: "liabilities",
      accounts: uniqueAccounts(_.values(yearly), "liabilities"),
      label: "Liabilities",
      multiplier: -1
    });

    accountGroups.push({
      key: "expenses",
      accounts: uniqueAccounts(_.values(yearly), "expenses"),
      label: "Expenses",
      multiplier: -1
    });
  });
</script>

<section class="section">
  <div class="container is-fluid">
    <div class="columns flex-wrap">
      <div class="column is-12">
        <div class="box py-2 my-0 overflow-x-auto">
          <div class="is-flex mr-2 is-align-items-baseline" style="min-width: fit-content">
            <div class="ml-3 custom-icon is-size-5 whitespace-nowrap">
              {rangeMode ? `${fromMonth} → ${toMonth}` : $year}
            </div>
            {#if incomeStatement}
              <div class="ml-3 whitespace-nowrap">
                <span class="mr-1 is-size-7 has-text-grey">Start</span>
                <span class="has-text-weight-bold"
                  >{formatCurrency(incomeStatement.startingBalance)}</span
                >
              </div>
              <div class="ml-3 whitespace-nowrap">
                <span class="mr-1 is-size-7 has-text-grey">End</span>
                <span class="has-text-weight-bold"
                  >{formatCurrency(incomeStatement.endingBalance)}</span
                >
              </div>

              <div class="ml-3 whitespace-nowrap">
                <span class="mr-1 is-size-7 has-text-grey">change</span>
                <span class="has-text-weight-bold {changeClass(diff)}">{formatCurrency(diff)}</span>
                <span class="mr-1 is-size-7 has-text-weight-bold {changeClass(diff)}"
                  >{formatPercentage(diffPercent, 2)}</span
                >
              </div>
            {/if}
            <div class="ml-auto is-flex is-align-items-center whitespace-nowrap">
              <label class="checkbox is-size-7 mr-3">
                <input type="checkbox" bind:checked={rangeMode} /> custom range
              </label>
              {#if rangeMode}
                <input
                  class="input is-small mr-1"
                  style="width: 9.5rem"
                  type="month"
                  bind:value={fromMonth}
                  min={_.first(monthKeys)}
                  max={toMonth}
                />
                <span class="is-size-7 mr-1">→</span>
                <input
                  class="input is-small"
                  style="width: 9.5rem"
                  type="month"
                  bind:value={toMonth}
                  min={fromMonth}
                  max={_.last(monthKeys)}
                />
              {/if}
            </div>
          </div>
        </div>
      </div>
      <div class="column is-12">
        <div class="box overflow-x-auto">
          <ZeroState item={!isEmpty}
            ><strong>Oops!</strong> You have not made any transactions for the selected year.</ZeroState
          >

          <svg class:is-not-visible={isEmpty} bind:this={svg}></svg>
        </div>
      </div>
    </div>
  </div>
</section>

<section class="section py-0">
  <div class="container is-fluid">
    <div class="columns">
      <div class="column is-12 pb-0">
        <div class="box pt-0 overflow-x-auto max-h-screen max-w-fit">
          <table
            class="table is-narrow is-hoverable is-light-border has-sticky-header has-sticky-column"
          >
            <thead>
              <tr>
                <th class="py-2">Account</th>
                {#each years as y}
                  <th class="py-2 has-text-right">{y}</th>
                {/each}
              </tr>
            </thead>
            <tbody class="has-text-grey-dark">
              {#each accountGroups as group}
                <tr class="has-text-weight-bold is-sub-header">
                  <th>{group.label}</th>
                  {#each years as y}
                    <td class="has-text-right">
                      {#if yearly[y]?.[group.key]}
                        {formatUnlessZero(sum(yearly[y][group.key]) * group.multiplier)}
                      {/if}
                    </td>
                  {/each}
                </tr>
                {#each group.accounts as account}
                  <tr>
                    <th class="custom-icon whitespace-nowrap"
                      ><span class="pl-3 has-text-weight-normal"
                        >{iconify(restName(account), { group: firstName(account) })}</span
                      ></th
                    >
                    {#each years as y}
                      <td class="has-text-right">
                        {#if yearly[y]?.[group.key]?.[account]}
                          {formatUnlessZero(yearly[y][group.key][account] * group.multiplier)}
                        {/if}
                      </td>
                    {/each}
                  </tr>
                {/each}
                <tr><td colspan={years.length + 1}>&nbsp;</td></tr>
              {/each}

              <tr class="has-text-weight-bold">
                <th>Change</th>
                {#each years as y}
                  {#if yearly[y]}
                    {@const diff = yearly[y].endingBalance - yearly[y].startingBalance}
                    <td class="has-text-right {changeClass(diff)}">
                      <div>{formatCurrency(diff)}</div>
                      <div>{formatPercentage(diff / yearly[y].startingBalance)}</div>
                    </td>
                  {:else}
                    <td></td>
                  {/if}
                {/each}
              </tr>
              <tr class="has-text-weight-bold">
                <th>End Balance</th>
                {#each years as y}
                  <td class="has-text-right">
                    {#if yearly[y]}
                      {formatCurrency(yearly[y].endingBalance)}
                    {/if}
                  </td>
                {/each}
              </tr>
              <tr class="has-text-weight-bold">
                <th>Start Balance</th>
                {#each years as y}
                  <td class="has-text-right">
                    {#if yearly[y]}
                      {formatCurrency(yearly[y].startingBalance)}
                    {/if}
                  </td>
                {/each}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</section>
