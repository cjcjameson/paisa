import * as d3 from "d3";
import {
  formatCurrency,
  formatCurrencyCrude,
  tooltip,
  type IncomeStatement,
  rem,
  firstNames
} from "./utils";
import COLORS from "./colors";
import _ from "lodash";
import { iconGlyph, iconify } from "./icon";
import { pathArrows } from "d3-path-arrows";

export function renderIncomeStatement(element: Element) {
  const BARS = 16;
  const BAR_HEIGHT = 45;

  const svg = d3.select(element),
    margin = { top: rem(20), right: rem(20), bottom: rem(10), left: rem(260) },
    width = Math.max(element.parentElement.clientWidth, 600) - margin.left - margin.right,
    g = svg.append("g").attr("transform", "translate(" + margin.left + "," + margin.top + ")");

  const height = BAR_HEIGHT * BARS;
  svg
    .attr("height", height + margin.top + margin.bottom)
    .attr("width", width + margin.left + margin.right);

  const sum = (object: Record<string, number>) => Object.values(object).reduce((a, b) => a + b, 0);
  const y = d3.scaleBand().range([height, 0]).paddingInner(0.4).paddingOuter(0.6);
  const x = d3.scaleLinear().range([0, width]);

  const xAxis = g
    .append("g")
    .attr("class", "axis y")
    .attr("transform", "translate(0," + height + ")");

  const yAxis = g.append("g").attr("class", "axis y dark is-large");

  const garrows = g.append("g");
  const gdivider = g.append("g");
  const gbars = g.append("g");
  const glines = g.append("g");
  const gmarks = g.append("g");
  const gamounts = g.append("g");
  const gicons = g.append("g");
  // Topmost group: invisible rects that carry the tooltips, so labels and
  // amount text never steal the hover and sliver bars get a usable target.
  const ghover = g.append("g");

  interface Bar {
    label: string;
    value: number;
    start: number;
    end: number;
    color: string;
    breakdown: Record<string, number>;
    multiplier: number;
  }

  const arrows = pathArrows()
    .arrowLength(10)
    .gapLength(100)
    .arrowHeadSize(3)
    .path((d: Bar) => {
      const path = d3.path();

      const startY = y(d.label) + y.bandwidth() + 4;
      const startX = x(d.start);
      const endX = x(d.end);

      path.moveTo(startX, startY);
      path.lineTo(endX, startY);
      return path.toString();
    });

  let firstRender = true;
  return function (
    statement: IncomeStatement,
    months?: IncomeStatement[],
    allMonths?: IncomeStatement[]
  ) {
    // Helper to sum properties matching a filter/regex
    const sumMatching = (obj: Record<string, number>, filter: (k: string) => boolean) => {
      let total = 0;
      for (const [k, v] of Object.entries(obj || {})) {
        if (filter(k)) total += v;
      }
      return total;
    };
    const sumAll = (obj: Record<string, number>) => Object.values(obj || {}).reduce((a, b) => a + b, 0);

    // 1. Rental & Investment Exclusions
    const isRentalIncome = (acct: string) => acct.toLowerCase().startsWith("income:rental");
    const isDividend = (acct: string) => acct.toLowerCase().startsWith("income:dividends");
    const isRentalExpense = (acct: string) => acct.toLowerCase().startsWith("expenses:rental") || acct === "Expenses:Housing:Mortgage";
    // Michigan property taxes are a rental cost (Jul+Dec lumps), not household tax.
    const isPropertyTax = (acct: string) => acct.toLowerCase().startsWith("expenses:tax:property");

    // Keep all intermediate amounts as POSITIVE numbers:
    const grossRental = Math.abs(sumMatching(statement.income, isRentalIncome));
    const rentalExpenses =
      Math.abs(sumMatching(statement.expenses, isRentalExpense)) +
      Math.abs(sumMatching(statement.tax, isPropertyTax));
    const netRental = grossRental - rentalExpenses; // Positive if income > expenses, negative if expenses > income

    // Vestwell contributions are payroll-withheld (the importer books them
    // Income:Salary:VestwellWithheld -> Assets:Vestwell); the cash never
    // touched checking, so they're excluded from operating income and get
    // their own net-worth bar below the line.
    const isVestwellIncome = (acct: string) =>
      acct.toLowerCase().startsWith("income:salary:vestwell");
    const isVestwell = (acct: string) => acct.toLowerCase().startsWith("assets:vestwell");
    const vestwellContributions = Math.abs(sumMatching(statement.income, isVestwellIncome));

    // Operating Income (excluding rental, dividends and payroll withholding)
    const isOperatingIncome = (acct: string) =>
      !isRentalIncome(acct) && !isDividend(acct) && !isVestwellIncome(acct);
    const operatingIncome = Math.abs(
      sumMatching(statement.income, isOperatingIncome) +
        sumMatching(statement.interest, isOperatingIncome)
    );

    const assetsMap = (statement as any).assets || {};

    // Operating Expenses (excluding rental expenses and mortgage interest, but including
    // non-property taxes; property tax nets against rental above)
    const isOperatingExpense = (acct: string) => !isRentalExpense(acct);
    const operatingExpenses =
      Math.abs(sumMatching(statement.expenses, isOperatingExpense)) +
      Math.abs(sumMatching(statement.tax, (k) => !isPropertyTax(k)));

    // Operating cash flows
    const operatingStart = statement.startingBalance;
    const operatingEnd = operatingStart + operatingIncome - operatingExpenses + netRental;
    const operatingCashFlow = operatingIncome - operatingExpenses + netRental;

    // --- Section 2: cash <-> asset swaps that really moved through checking
    // or the credit cards (Vanguard sells into checking, car purchases,
    // mortgage principal, card paydown). Vestwell is payroll, not cash.
    const isChecking = (acct: string) => acct.toLowerCase().startsWith("assets:checking");
    const isCreditCard = (acct: string) => {
      const lower = acct.toLowerCase();
      return lower.startsWith("liabilities:creditcards") || lower.startsWith("liabilities:credit_cards") || lower.startsWith("liabilities:courtney:businesscard");
    };

    const checkingBreakdown: Record<string, number> = {};
    for (const [k, v] of Object.entries(assetsMap)) {
      if (isChecking(k)) checkingBreakdown[k] = v as number;
    }

    let investmentSales = 0;
    let investmentBuys = 0;
    for (const [acct, val] of Object.entries(assetsMap)) {
      if (!isChecking(acct) && !isVestwell(acct)) {
        if ((val as number) < 0) {
          investmentSales += Math.abs(val as number);
        } else {
          investmentBuys += val as number;
        }
      }
    }

    // Mortgage Principal Paydown
    const isMortgageAccount = (acct: string) => acct.toLowerCase().startsWith("liabilities:mortgages:");
    const mortgagePaydown = Math.abs(sumMatching(statement.liabilities, isMortgageAccount));

    // Per-payment texture from the monthly buckets: count payments per
    // mortgage and the min/max principal portion, for the tooltip.
    const mortgageDetail: Record<string, { count: number; min: number; max: number; total: number }> =
      {};
    for (const m of months || []) {
      for (const [k, v] of Object.entries(m.liabilities || {})) {
        if (isMortgageAccount(k) && Math.abs(v) > 0.01) {
          const dtl = mortgageDetail[k] || { count: 0, min: Infinity, max: -Infinity, total: 0 };
          dtl.count++;
          dtl.min = Math.min(dtl.min, v);
          dtl.max = Math.max(dtl.max, v);
          dtl.total += v;
          mortgageDetail[k] = dtl;
        }
      }
    }

    // Credit-card float: expenses are booked at charge time, so the extra
    // cash that leaves checking is the debt DECREASE (paydown beyond new
    // charges). Positive = debt shrank = cash out — but net worth-wise a
    // good thing; the liquid checkpoint nets it back.
    const ccPaydown = sumMatching(statement.liabilities, isCreditCard);

    // Card balance levels (before/after) for the tooltip: liability postings
    // sum to the account balance from inception (openings included), so
    // accumulating the monthly deltas up to the view boundary gives levels.
    const ccLevels: Record<string, { start: number; end: number }> = {};
    if (months && months.length > 0 && allMonths && allMonths.length > 0) {
      const sortedView = _.sortBy(months, (m) => m.date);
      const startDate = sortedView[0].date;
      const endDate = _.last(sortedView).date;
      const running: Record<string, number> = {};
      let startSnap: Record<string, number> | null = null;
      for (const m of _.sortBy(allMonths, (m) => m.date)) {
        if (startSnap === null && m.date >= startDate) startSnap = { ...running };
        if (m.date > endDate) break;
        for (const [k, v] of Object.entries(m.liabilities || {})) {
          if (isCreditCard(k)) running[k] = (running[k] || 0) + (v as number);
        }
      }
      if (startSnap === null) startSnap = { ...running };
      for (const k of _.union(_.keys(running), _.keys(startSnap))) {
        ccLevels[k] = { start: startSnap[k] || 0, end: running[k] || 0 };
      }
    }

    // Liquid position: checking minus card balances. Paying a card from
    // checking is liquid-neutral, so this delta is usually near zero.
    const afterBuysLevel = operatingEnd + investmentSales - investmentBuys;
    const liquidEnd = afterBuysLevel - mortgagePaydown;
    const pureCheckingEnd = liquidEnd - ccPaydown;
    const liquidDelta = liquidEnd - operatingStart;

    const liquidBreakdown: Record<string, number> = { ...checkingBreakdown };
    for (const [k, v] of Object.entries(statement.liabilities)) {
      if (isCreditCard(k)) liquidBreakdown[k] = v as number;
    }

    // --- Section 3: pure net-worth accruals that never touched checking.
    const dividendIncome = Math.abs(sumMatching(statement.income, isDividend));
    const isOptions = (acct: string) => acct.toLowerCase().startsWith("assets:options");
    const optionsVested = sumMatching(statement.pnl, isOptions);
    const marketGains = sumAll(statement.pnl) - optionsVested;

    // Net Worth Delta (ending net worth matches exactly)
    const totalChange = statement.endingBalance - statement.startingBalance;
    // By double entry this plug equals -(equity postings): untracked
    // transfers, historical plugs, and opening balances. Liabilities never
    // appear here (mortgage/cards are already in their cash-flow bars).
    const junk =
      totalChange -
      (operatingCashFlow + vestwellContributions + optionsVested + dividendIncome + marketGains);

    const junkBreakdown: Record<string, number> = {};
    for (const [k, v] of Object.entries(statement.equity || {})) {
      junkBreakdown[k] = -(v as number);
    }

    const t = svg.transition().duration(firstRender ? 0 : 750);
    firstRender = false;

    const incomeBreakdown: Record<string, number> = _.omitBy(
      { ...statement.income, ...statement.interest },
      (v, k) => !isOperatingIncome(k)
    );

    // Chain checkpoints
    const afterIncome = operatingStart + operatingIncome;
    const afterExpenses = afterIncome - operatingExpenses;
    const afterSales = operatingEnd + investmentSales;
    const afterBuys = afterSales - investmentBuys;
    const afterMortgage = afterBuys - mortgagePaydown;
    const afterVestwell = operatingEnd + vestwellContributions;
    const afterOptions = afterVestwell + optionsVested;
    const afterDividends = afterOptions + dividendIncome;
    const afterMarket = afterDividends + marketGains;

    // Build the 16 waterfall bars
    const bars: Bar[] = [
      {
        label: "Income (Operating)",
        start: operatingStart,
        end: afterIncome,
        color: COLORS.income,
        value: operatingIncome,
        breakdown: incomeBreakdown,
        multiplier: -1
      },
      {
        label: "Expenses (Operating)",
        start: afterIncome,
        end: afterExpenses,
        color: COLORS.expenses,
        value: -operatingExpenses,
        breakdown: _.omitBy({ ...statement.expenses, ...statement.tax }, (v, k) => !isOperatingExpense(k) || isPropertyTax(k)),
        multiplier: -1
      },
      {
        label: "Rental Income (Net)",
        start: afterExpenses,
        end: operatingEnd,
        color: COLORS.primary,
        value: netRental,
        breakdown: {
          ..._.pickBy(statement.income, (v, k) => isRentalIncome(k)),
          ..._.pickBy(statement.expenses, (v, k) => isRentalExpense(k)),
          ..._.pickBy(statement.tax, (v, k) => isPropertyTax(k))
        },
        multiplier: -1
      },
      {
        label: "🏁 Operating Cash Flow",
        start: operatingStart,
        end: operatingEnd,
        color: COLORS.secondary,
        value: operatingCashFlow,
        breakdown: {},
        multiplier: 1
      },
      // --- Cash <-> asset swaps: money that really moved through checking
      // or the cards, connected with assets. ---
      {
        label: "Investment Sales → Cash",
        start: operatingEnd,
        end: afterSales,
        color: COLORS.income,
        value: investmentSales,
        breakdown: _.pickBy(assetsMap, (v, k) => !isChecking(k) && !isVestwell(k) && v < 0),
        multiplier: -1
      },
      {
        label: "Cash → Investments & Assets",
        start: afterSales,
        end: afterBuys,
        color: COLORS.expenses,
        value: -investmentBuys,
        breakdown: _.pickBy(assetsMap, (v, k) => !isChecking(k) && !isVestwell(k) && v > 0),
        multiplier: 1
      },
      {
        label: "Mortgage Principal Paydown",
        start: afterBuys,
        end: afterMortgage,
        color: COLORS.liabilities,
        value: -mortgagePaydown,
        breakdown: _.pickBy(statement.liabilities, (v, k) => isMortgageAccount(k)),
        multiplier: -1
      },
      {
        label: "Credit Card Paydown (Float)",
        start: afterMortgage,
        end: pureCheckingEnd,
        color: COLORS.liabilities,
        value: -ccPaydown,
        breakdown: _.pickBy(statement.liabilities, (v, k) => isCreditCard(k)),
        multiplier: -1
      },
      {
        label: "🏁 Liquid Delta (Checking − Cards)",
        start: operatingStart,
        end: afterMortgage,
        color: COLORS.assets,
        value: liquidDelta,
        breakdown: liquidBreakdown,
        multiplier: 1
      },
      // --- NET WORTH group: restarts from the period-start balance. The
      // cash<->asset swaps above are net-worth-neutral, so they don't appear;
      // instead we add the accruals that never touched checking. ---
      {
        label: "Operating Cash Flow (carried)",
        start: operatingStart,
        end: operatingEnd,
        color: COLORS.secondary,
        value: operatingCashFlow,
        breakdown: {},
        multiplier: 1
      },
      {
        label: "Vestwell Contributions (Payroll)",
        start: operatingEnd,
        end: afterVestwell,
        color: COLORS.income,
        value: vestwellContributions,
        breakdown: _.pickBy(statement.income, (v, k) => isVestwellIncome(k)),
        multiplier: -1
      },
      {
        label: "Options Vested",
        start: afterVestwell,
        end: afterOptions,
        color: COLORS.primary,
        value: optionsVested,
        breakdown: _.pickBy(statement.pnl, (v, k) => isOptions(k)),
        multiplier: 1
      },
      {
        label: "Dividends (Reinvested)",
        start: afterOptions,
        end: afterDividends,
        color: COLORS.income,
        value: dividendIncome,
        breakdown: _.mapValues(_.pickBy(statement.income, (v, k) => isDividend(k)), (v) => -(v as number)),
        multiplier: 1
      },
      {
        label: "Market Gains & Growth",
        start: afterDividends,
        end: afterMarket,
        color: marketGains > 0 ? COLORS.gain : COLORS.loss,
        value: marketGains,
        breakdown: _.omitBy(statement.pnl, (v, k) => isOptions(k)),
        multiplier: 1
      },
      {
        label: "Other / Adjustments",
        start: afterMarket,
        end: statement.endingBalance,
        color: COLORS.neutral,
        value: junk,
        breakdown: junkBreakdown,
        multiplier: 1
      },
      {
        label: "🏁 Net Worth Delta",
        start: operatingStart,
        end: statement.endingBalance,
        color: COLORS.success,
        value: totalChange,
        breakdown: {},
        multiplier: 1
      }
    ];

    interface Line {
      label: string;
      value: number;
      anchor: string;
      down?: boolean;
      icon?: string;
    }

    const lines: Line[] = [
      { label: "Income (Operating)", value: operatingStart, anchor: "start", icon: "fa6-solid:caret-down" },
      { label: "Expenses (Operating)", value: afterIncome, anchor: "end" },
      { label: "Rental Income (Net)", value: afterExpenses, anchor: "end" },
      { label: "🏁 Operating Cash Flow", value: operatingEnd, anchor: "end" },
      { label: "Investment Sales → Cash", value: operatingEnd, anchor: "end" },
      { label: "Cash → Investments & Assets", value: afterSales, anchor: "end" },
      { label: "Mortgage Principal Paydown", value: afterBuys, anchor: "end" },
      { label: "Credit Card Paydown (Float)", value: afterMortgage, anchor: "end" },
      { label: "🏁 Liquid Delta (Checking − Cards)", value: afterMortgage, anchor: "end" },
      { label: "Operating Cash Flow (carried)", value: operatingStart, anchor: "start" },
      { label: "Vestwell Contributions (Payroll)", value: operatingEnd, anchor: "end" },
      { label: "Options Vested", value: afterVestwell, anchor: "end" },
      { label: "Dividends (Reinvested)", value: afterOptions, anchor: "end" },
      { label: "Market Gains & Growth", value: afterDividends, anchor: "end" },
      { label: "Other / Adjustments", value: afterMarket, anchor: "end" },
      {
        label: "🏁 Net Worth Delta",
        value: statement.endingBalance,
        down: true,
        anchor: "end",
        icon: "fa6-solid:caret-up"
      }
    ];

    y.domain(bars.map((d) => d.label).reverse());
    x.domain(
      d3.extent([
        operatingStart,
        afterIncome,
        afterExpenses,
        operatingEnd,
        afterSales,
        afterBuys,
        afterMortgage,
        pureCheckingEnd,
        afterVestwell,
        afterOptions,
        afterDividends,
        afterMarket,
        statement.endingBalance
      ])
    );

    xAxis.transition(t).call(d3.axisTop(x).tickSize(height).tickFormat(formatCurrencyCrude));
    yAxis.transition(t).call(d3.axisLeft(y).tickSize(-width).tickPadding(10));

    // Divider between the CASH FLOW group (bars 1-8) and the NET WORTH group
    // (bars 9-12), which restarts its own waterfall from the period start.
    gdivider.selectAll("*").remove();
    const dividerY =
      (y("🏁 Liquid Delta (Checking − Cards)") + y.bandwidth() + y("Operating Cash Flow (carried)")) / 2;
    gdivider
      .append("line")
      .attr("class", "svg-grey")
      .attr("stroke-width", 1.5)
      .attr("stroke-dasharray", "6,4")
      .attr("x1", -margin.left + rem(8))
      .attr("x2", width)
      .attr("y1", dividerY)
      .attr("y2", dividerY);
    gdivider
      .append("text")
      .attr("class", "svg-text-grey")
      .attr("font-size", "0.7rem")
      .attr("letter-spacing", "0.1em")
      .attr("x", -margin.left + rem(8))
      .attr("y", dividerY - rem(6))
      .text("▲ CASH FLOW — did checking fund the period?");
    gdivider
      .append("text")
      .attr("class", "svg-text-grey")
      .attr("font-size", "0.7rem")
      .attr("letter-spacing", "0.1em")
      .attr("x", -margin.left + rem(8))
      .attr("y", dividerY + rem(12))
      .text("▼ NET WORTH — full change, markets included");

    garrows.selectAll("g").remove();
    t.on("end", () => {
      garrows.selectAll("g").data(bars).join("g").attr("class", "g-arrow is-light").call(arrows);
    });

    // Computed bars have no account breakdown; explain the arithmetic instead
    // of showing an empty tooltip.
    const BAR_DESCRIPTIONS: Record<string, string> = {
      "🏁 Operating Cash Flow":
        "Operating income + net rental − operating expenses (the three bars above, netted). Did day-to-day cash cover the period?",
      "🏁 Liquid Delta (Checking − Cards)":
        "Change in net liquid position: checking balances minus card balances. Usually near zero — negative means new pending card charges or less cash on hand; positive means cards paid off or cash built up. (Paying a card from checking doesn't move this number.)",
      "Operating Cash Flow (carried)":
        "The same operating cash flow from the group above, restated as the first step of the net-worth walk. The cash↔asset swaps above the line are net-worth-neutral, so they don't appear here.",
      "Vestwell Contributions (Payroll)":
        "Retirement savings withheld from the paycheck before it reached checking — excluded from operating income above, counted here as new net worth.",
      "Options Vested":
        "Startup options that vested during the period, at their nominal price — assets that appeared without spending cash.",
      "Dividends (Reinvested)":
        "Dividends earned inside investment accounts (reinvested or held there) — they accrue to net worth without passing through checking.",
      "🏁 Net Worth Delta":
        "Ending net worth − starting net worth: operating cash flow + payroll contributions + options + dividends + market gains + adjustments, netted."
    };

    const barTooltip = (d: Bar) => {
      // Rental nets several Expenses:Housing/Tax subaccounts; show 3 levels
      // there so "Expenses:Housing:Mortgage" isn't mistaken for home rent.
      const groupDepth = d.label === "Rental Income (Net)" ? 3 : 2;
      const secondLevelBreakdown = _.chain(d.breakdown)
          .toPairs()
          .groupBy((pair) => firstNames(pair[0], groupDepth))
          .map((pairs, label) => [label, _.sumBy(pairs, (pair) => pair[1])])
          .fromPairs()
          .value();

        // Per-payment texture: "N payments, principal X–Y each".
        if (d.label === "Mortgage Principal Paydown" && !_.isEmpty(mortgageDetail)) {
          const rows = _.chain(mortgageDetail)
            .toPairs()
            .sortBy(([, dtl]) => -dtl.total)
            .map(([acct, dtl]) => {
              const range =
                Math.abs(dtl.max - dtl.min) < 0.01
                  ? formatCurrency(dtl.min)
                  : `${formatCurrency(dtl.min)}–${formatCurrency(dtl.max)}`;
              return [
                `🏠 ${_.last(acct.split(":"))} — ${dtl.count} payments of ${range}`,
                [formatCurrency(dtl.total * d.multiplier), "has-text-right has-text-weight-bold"]
              ] as Array<string | string[]>;
            })
            .value();

          return tooltip(rows, { header: d.label, total: formatCurrency(d.value) });
        }

        // Card-by-card audit: balance before -> after (owed amounts shown
        // positive), top movers first.
        if (d.label === "Credit Card Paydown (Float)" && !_.isEmpty(ccLevels)) {
          const byIssuer: Record<string, { start: number; end: number }> = {};
          for (const [k, lvl] of Object.entries(ccLevels)) {
            const issuer = firstNames(k, 3);
            const agg = byIssuer[issuer] || { start: 0, end: 0 };
            agg.start += lvl.start;
            agg.end += lvl.end;
            byIssuer[issuer] = agg;
          }
          const rows = _.chain(byIssuer)
            .toPairs()
            .filter(([, lvl]) => Math.abs(lvl.end - lvl.start) > 0.01)
            .sortBy(([, lvl]) => -Math.abs(lvl.end - lvl.start))
            .take(4)
            .map(([issuer, lvl]) => {
              const owedStart = Math.abs(lvl.start);
              const owedEnd = Math.abs(lvl.end);
              const dir = owedEnd < owedStart ? "▼ down to" : "▲ up to";
              return [
                `💳 ${_.last(issuer.split(":"))} ${formatCurrency(owedStart)} ${dir} ${formatCurrency(owedEnd)}`,
                [
                  formatCurrency((lvl.end - lvl.start) * d.multiplier),
                  "has-text-right has-text-weight-bold"
                ]
              ] as Array<string | string[]>;
            })
            .value();

          rows.push([
            [
              `<div style="max-width: 22rem; white-space: normal;" class="has-text-grey">Cash spent shrinking card balances beyond new charges — debt going down is good. The 🏁 bar below nets this back against checking.</div>`,
              "",
              "2"
            ]
          ]);

          return tooltip(rows, { header: d.label, total: formatCurrency(d.value) });
        }

        // Other/Adjustments = -(equity postings) exactly: untracked transfers,
        // historical plugs, and accounts entering tracking mid-period.
        if (d.label === "Other / Adjustments") {
          const FRIENDLY: Record<string, string> = {
            "Equity:Historical": "🔌 Untracked Card Payments (historical plugs)",
            "Equity:Transfers": "💸 Transfer Residuals (untracked side)",
            "Equity:OpeningBalance": "🏁 Opening Balances (accounts entering tracking)"
          };
          const rows = _.chain(secondLevelBreakdown)
            .toPairs()
            .filter(([, v]) => Math.abs(v) > 0.01)
            .sortBy(([, v]) => -Math.abs(v))
            .map(
              ([k, v]) =>
                [
                  FRIENDLY[k] || iconify(k),
                  [formatCurrency(v * d.multiplier), "has-text-right has-text-weight-bold"]
                ] as Array<string | string[]>
            )
            .value();

          return tooltip(rows, { header: d.label, total: formatCurrency(d.value) });
        }

        const entries = _.chain(secondLevelBreakdown)
          .toPairs()
          .filter(([, value]) => Math.abs(value) > 0.01)
          .sortBy(([, value]) => -Math.abs(value))
          .map(
            ([label, value]) =>
              [
                iconify(label),
                [formatCurrency(value * d.multiplier), "has-text-right has-text-weight-bold"]
              ] as Array<string | string[]>
          )
          .value();

        const description = BAR_DESCRIPTIONS[d.label];

        if (_.isEmpty(entries)) {
          if (description) {
            return tooltip([
              [[d.label, "has-text-weight-bold has-text-centered", "2"]],
              [[`<div style="max-width: 20rem; white-space: normal;">${description}</div>`, "", "2"]],
              [
                ["Total", "has-text-weight-bold"],
                [formatCurrency(d.value), "has-text-weight-bold has-text-right"]
              ]
            ]);
          }
        } else if (description) {
          entries.push([
            [
              `<div style="max-width: 22rem; white-space: normal;" class="has-text-grey">${description}</div>`,
              "",
              "2"
            ]
          ]);
        }

        return tooltip(entries, { header: d.label, total: formatCurrency(d.value) });
      };

    gbars
      .selectAll("rect")
      .data(bars)
      .join("rect")
      .attr("stroke", (d) => d.color)
      .attr("fill", (d) => d.color)
      .attr("fill-opacity", 0.5)
      .transition(t)
      .attr("x", function (d) {
        if (d.value < 0) {
          return x(d.end);
        }
        return x(d.start);
      })
      .attr("y", function (d) {
        return y(d.label) + (y.bandwidth() - Math.min(y.bandwidth(), BAR_HEIGHT)) / 2;
      })
      .attr("width", function (d) {
        if (d.value < 0) {
          return x(d.start) - x(d.end);
        }
        return x(d.end) - x(d.start);
      })
      .attr("height", y.bandwidth());

    glines
      .selectAll("line")
      .data(lines)
      .join("line")
      .attr("class", "svg-grey")
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "2,2")
      .attr("stroke-opacity", 0.5)
      .transition(t)
      .attr("x1", function (d) {
        return x(d.value);
      })
      .attr("x2", function (d) {
        return x(d.value);
      })
      .attr("y1", function (d) {
        if (d.down) {
          return y(d.label);
        } else {
          return y(d.label) - y.step() * y.paddingInner();
        }
      })
      .attr("y2", function (d) {
        if (d.down) {
          return y(d.label) + y.bandwidth() + y.step() * y.paddingInner();
        } else {
          return y(d.label) + y.bandwidth();
        }
      });

    gmarks
      .selectAll("text")
      .data(lines)
      .join("text")
      .attr("text-anchor", (d) => d.anchor)
      .attr("font-size", "0.7rem")
      .attr("pointer-events", "none")
      .attr("class", "svg-text-grey")
      .attr("dy", (d) => (d.down ? "-0.5rem" : "1rem"))
      .attr("dx", (d) => (d.anchor === "start" ? "0.3rem" : "-0.3rem"))
      .transition(t)
      .attr("x", function (d) {
        return x(d.value);
      })
      .attr("y", function (d) {
        if (d.down) {
          return y(d.label) + y.bandwidth() + y.step() * y.paddingInner();
        } else {
          return y(d.label) - y.step() * y.paddingInner();
        }
      })
      .text((d) => formatCurrency(d.value));

    gamounts
      .selectAll("text")
      .data(bars)
      .join("text")
      .attr("dy", "0.3rem")
      .attr("text-anchor", "middle")
      .attr("pointer-events", "none")
      .attr("class", "svg-text-black-ter has-text-weight-bold")
      .transition(t)
      .attr("x", function (d) {
        return (x(d.start) + x(d.end)) / 2;
      })
      .attr("y", function (d) {
        return y(d.label) + y.bandwidth() / 2;
      })
      .text((d) => formatCurrency(d.value));

    // Invisible hover targets: at least HOVER_MIN_WIDTH wide (centered on the
    // bar) so tiny bars and their overhanging amount labels are hoverable.
    const HOVER_MIN_WIDTH = rem(90);
    ghover
      .selectAll("rect")
      .data(bars)
      .join("rect")
      .attr("fill", "transparent")
      .attr("data-tippy-content", barTooltip)
      .attr("x", (d) => {
        const x0 = Math.min(x(d.start), x(d.end));
        const w = Math.abs(x(d.end) - x(d.start));
        return w >= HOVER_MIN_WIDTH ? x0 : x0 + w / 2 - HOVER_MIN_WIDTH / 2;
      })
      .attr("width", (d) => Math.max(Math.abs(x(d.end) - x(d.start)), HOVER_MIN_WIDTH))
      .attr("y", (d) => y(d.label))
      .attr("height", y.bandwidth());

    gicons
      .selectAll("text")
      .data([_.first(lines), _.last(lines)])
      .join("text")
      .attr("text-anchor", "middle")
      .attr("font-size", "1.2rem")
      .attr("class", "svg-text-grey")
      .attr("dy", (d) => (d.down ? "0.8rem" : "0.2rem"))
      .transition(t)
      .attr("x", function (d) {
        return x(d.value);
      })
      .attr("y", function (d) {
        if (d.down) {
          return y(d.label) + y.bandwidth() + y.step() * y.paddingInner();
        } else {
          return y(d.label) - y.step() * y.paddingInner();
        }
      })
      .text((d) => iconGlyph(d.icon));
  };
}
