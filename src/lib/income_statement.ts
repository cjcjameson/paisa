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
  const BARS = 18;
  const BAR_HEIGHT = 45;

  const svg = d3.select(element),
    margin = { top: rem(20), right: rem(20), bottom: rem(10), left: rem(290) },
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

    // Courtney's business, netted like the rental: her income minus business
    // expenses. Expenses:Business:CJ is CJ's software, not hers.
    const isCourtneyIncome = (acct: string) =>
      acct.toLowerCase().startsWith("income:business:courtney");
    const isCourtneyExpense = (acct: string) => {
      const l = acct.toLowerCase();
      return l.startsWith("expenses:business") && !l.startsWith("expenses:business:cj");
    };
    const grossCourtney = Math.abs(sumMatching(statement.income, isCourtneyIncome));
    const courtneyExpenses = sumMatching(statement.expenses, isCourtneyExpense);
    const netCourtney = grossCourtney - courtneyExpenses;

    // Vestwell contributions are payroll-withheld (the importer books them
    // Income:Salary:VestwellWithheld -> Assets:Vestwell); the cash never
    // touched checking, so they're excluded from operating income and get
    // their own net-worth bar below the line.
    const isVestwellIncome = (acct: string) =>
      acct.toLowerCase().startsWith("income:salary:vestwell");
    const isVestwell = (acct: string) => acct.toLowerCase().startsWith("assets:vestwell");
    const vestwellContributions = Math.abs(sumMatching(statement.income, isVestwellIncome));

    // Operating Income (excluding rental, Courtney's business, dividends and
    // payroll withholding)
    const isOperatingIncome = (acct: string) =>
      !isRentalIncome(acct) &&
      !isDividend(acct) &&
      !isVestwellIncome(acct) &&
      !isCourtneyIncome(acct);
    const operatingIncome = Math.abs(
      sumMatching(statement.income, isOperatingIncome) +
        sumMatching(statement.interest, isOperatingIncome)
    );

    const assetsMap = (statement as any).assets || {};

    // Operating Expenses (excluding rental and Courtney business expenses,
    // but including non-property taxes; property tax nets against rental)
    const isOperatingExpense = (acct: string) => !isRentalExpense(acct) && !isCourtneyExpense(acct);
    const operatingExpenses =
      Math.abs(sumMatching(statement.expenses, isOperatingExpense)) +
      Math.abs(sumMatching(statement.tax, (k) => !isPropertyTax(k)));

    // Operating cash flows. Rental is NOT part of operating: the user thinks
    // of the rentals as an asset position, so all rental cash (rent in,
    // expenses out, the FULL mortgage check out) lives in the cash↔asset
    // section, and the principal slice is handed back in the net-worth
    // section as "we paid ourselves".
    const operatingStart = statement.startingBalance;
    const operatingCashFlow = operatingIncome - operatingExpenses + netCourtney;
    const operatingEnd = operatingStart + operatingCashFlow;

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

    // Options are excluded here: vests arrive without cash moving (see the
    // Options Vested bar below the line).
    const isOptionsAsset = (acct: string) => acct.toLowerCase().startsWith("assets:options");
    let investmentSales = 0;
    let investmentBuys = 0;
    for (const [acct, val] of Object.entries(assetsMap)) {
      if (!isChecking(acct) && !isVestwell(acct) && !isOptionsAsset(acct)) {
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

    // Rental, CASH view: rent received minus rental expenses minus the FULL
    // mortgage checks. netRental already nets out interest (the ledger
    // reclasses principal to the liability), so cash = netRental − principal.
    const rentalNetCash = netRental - mortgagePaydown;

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
    // Order: dip further negative first — every way we "pay ourselves with
    // assets" (buys, mortgage principal) — then the Vanguard sales that
    // balance the budget close the section. Card paydown does NOT appear as
    // a bar: in the liquid frame (checking − cards) it's an internal
    // transfer; its per-card audit lives in the checkpoint tooltip.
    const afterBuys = operatingEnd - investmentBuys;
    const afterRentalCash = afterBuys + rentalNetCash;
    const liquidEnd = afterRentalCash + investmentSales;

    const liquidBreakdown: Record<string, number> = { ...checkingBreakdown };
    for (const [k, v] of Object.entries(statement.liabilities)) {
      if (isCreditCard(k)) liquidBreakdown[k] = v as number;
    }

    // The checkpoint reports ACTUAL balance changes (checking + cards), not
    // the walk: asset book deltas include in-account flows (reinvested
    // dividends, margin, card rewards) that never touch cash, so the section
    // bars can land slightly off. The gap is disclosed in the tooltip.
    const liquidDelta = sumAll(liquidBreakdown);
    const nonCashGap = liquidDelta - (liquidEnd - operatingStart);

    // --- Section 3: pure net-worth accruals that never touched checking.
    const dividendIncome = Math.abs(sumMatching(statement.income, isDividend));
    // Options Vested = NEW units arriving during the period. Paisa values a
    // no-cost vest posting at its market price on arrival, so the vest value
    // lives in the asset delta (counter: Equity:OpeningBalance), not in pnl.
    const isOptions = (acct: string) => acct.toLowerCase().startsWith("assets:options");
    let optionsVested = 0;
    for (const [acct, val] of Object.entries(assetsMap)) {
      if (isOptions(acct) && (val as number) > 0) optionsVested += val as number;
    }
    // Manual marks: properties, the Bronco, and illiquid options/shares —
    // price changes set by hand in prices.journal, not by a market feed.
    const isManualMark = (acct: string) => {
      const l = acct.toLowerCase();
      return (
        l.startsWith("assets:realestate") || l.startsWith("assets:vehicles") || isOptions(acct)
      );
    };
    const manualMarks = sumMatching(statement.pnl, isManualMark);
    const marketGains = sumAll(statement.pnl) - manualMarks;

    // Net Worth Delta (ending net worth matches exactly)
    const totalChange = statement.endingBalance - statement.startingBalance;
    // By double entry this plug equals -(equity postings): untracked
    // transfers, historical plugs, and opening balances. Liabilities never
    // appear here (mortgage/cards are already in their cash-flow bars).
    const junk =
      totalChange -
      (operatingCashFlow +
        rentalNetCash +
        mortgagePaydown +
        vestwellContributions +
        dividendIncome +
        marketGains +
        optionsVested +
        manualMarks);

    const junkBreakdown: Record<string, number> = {};
    for (const [k, v] of Object.entries(statement.equity || {})) {
      junkBreakdown[k] = -(v as number);
    }
    // Vests are booked against Equity:OpeningBalance; their value is shown as
    // the Options Vested bar, so back it out here to keep the rows summing.
    if (optionsVested > 0.01) {
      junkBreakdown["Less: Options Vested (own bar above)"] = -optionsVested;
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
    const afterCourtney = afterExpenses + netCourtney; // == operatingEnd
    const afterRentalCarried = operatingEnd + rentalNetCash;
    const afterPrincipalBack = afterRentalCarried + mortgagePaydown;
    const afterVestwell = afterPrincipalBack + vestwellContributions;
    const afterDividends = afterVestwell + dividendIncome;
    const afterMarket = afterDividends + marketGains;
    const afterOptions = afterMarket + optionsVested;
    const afterMarks = afterOptions + manualMarks;

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
        label: "Courtney's Business (Net)",
        start: afterExpenses,
        end: afterCourtney,
        color: COLORS.primary,
        value: netCourtney,
        breakdown: {
          ..._.pickBy(statement.income, (v, k) => isCourtneyIncome(k)),
          ..._.pickBy(statement.expenses, (v, k) => isCourtneyExpense(k))
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
      // or the cards, connected with assets. Uses first (paying ourselves
      // with assets), then the sales that balance the budget. ---
      {
        label: "Cash → Investments & Assets",
        start: operatingEnd,
        end: afterBuys,
        color: COLORS.expenses,
        value: -investmentBuys,
        breakdown: _.pickBy(
          assetsMap,
          (v, k) => !isChecking(k) && !isVestwell(k) && !isOptionsAsset(k) && v > 0
        ),
        multiplier: 1
      },
      {
        label: "Rental (Net Cash)",
        start: afterBuys,
        end: afterRentalCash,
        color: COLORS.primary,
        value: rentalNetCash,
        breakdown: {
          ..._.pickBy(statement.income, (v, k) => isRentalIncome(k)),
          ..._.mapKeys(
            _.pickBy(statement.expenses, (v, k) => isRentalExpense(k)),
            (v, k) => (k === "Expenses:Housing:Mortgage" ? "Mortgage Interest" : k)
          ),
          ..._.mapKeys(
            _.pickBy(statement.liabilities, (v, k) => isMortgageAccount(k)),
            (v, k) => `Mortgage Principal:${_.last(k.split(":"))}`
          ),
          ..._.pickBy(statement.tax, (v, k) => isPropertyTax(k))
        },
        multiplier: -1
      },
      {
        label: "Investment Sales → Cash",
        start: afterRentalCash,
        end: liquidEnd,
        color: COLORS.income,
        value: investmentSales,
        breakdown: _.pickBy(
          assetsMap,
          (v, k) => !isChecking(k) && !isVestwell(k) && !isOptionsAsset(k) && v < 0
        ),
        multiplier: -1
      },
      {
        label: "🏁 Liquid Delta (Checking − Cards)",
        start: operatingStart,
        end: operatingStart + liquidDelta,
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
        label: "Rental Cash Flow (carried)",
        start: operatingEnd,
        end: afterRentalCarried,
        color: COLORS.primary,
        value: rentalNetCash,
        breakdown: {},
        multiplier: 1
      },
      {
        label: "Principal (Paid to Ourselves)",
        start: afterRentalCarried,
        end: afterPrincipalBack,
        color: COLORS.liabilities,
        value: mortgagePaydown,
        breakdown: _.pickBy(statement.liabilities, (v, k) => isMortgageAccount(k)),
        multiplier: 1
      },
      {
        label: "Vestwell Contributions (Payroll)",
        start: afterPrincipalBack,
        end: afterVestwell,
        color: COLORS.income,
        value: vestwellContributions,
        breakdown: _.pickBy(statement.income, (v, k) => isVestwellIncome(k)),
        multiplier: -1
      },
      {
        label: "Dividends (Reinvested)",
        start: afterVestwell,
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
        breakdown: _.omitBy(statement.pnl, (v, k) => isOptions(k) || isManualMark(k)),
        multiplier: 1
      },
      {
        label: "Options Vested",
        start: afterMarket,
        end: afterOptions,
        color: COLORS.primary,
        value: optionsVested,
        breakdown: _.pickBy(assetsMap, (v, k) => isOptions(k) && v > 0),
        multiplier: 1
      },
      {
        label: "Appreciation / Depreciation (Marks)",
        start: afterOptions,
        end: afterMarks,
        color: COLORS.neutral,
        value: manualMarks,
        breakdown: _.pickBy(statement.pnl, (v, k) => isManualMark(k)),
        multiplier: 1
      },
      {
        label: "Other / Adjustments",
        start: afterMarks,
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
      { label: "Courtney's Business (Net)", value: afterExpenses, anchor: "end" },
      { label: "🏁 Operating Cash Flow", value: operatingEnd, anchor: "end" },
      { label: "Cash → Investments & Assets", value: operatingEnd, anchor: "end" },
      { label: "Rental (Net Cash)", value: afterBuys, anchor: "end" },
      { label: "Investment Sales → Cash", value: afterRentalCash, anchor: "end" },
      {
        label: "🏁 Liquid Delta (Checking − Cards)",
        value: operatingStart + liquidDelta,
        anchor: "end"
      },
      { label: "Operating Cash Flow (carried)", value: operatingStart, anchor: "start" },
      { label: "Rental Cash Flow (carried)", value: operatingEnd, anchor: "end" },
      { label: "Principal (Paid to Ourselves)", value: afterRentalCarried, anchor: "end" },
      { label: "Vestwell Contributions (Payroll)", value: afterPrincipalBack, anchor: "end" },
      { label: "Dividends (Reinvested)", value: afterVestwell, anchor: "end" },
      { label: "Market Gains & Growth", value: afterDividends, anchor: "end" },
      { label: "Options Vested", value: afterMarket, anchor: "end" },
      { label: "Appreciation / Depreciation (Marks)", value: afterOptions, anchor: "end" },
      { label: "Other / Adjustments", value: afterMarks, anchor: "end" },
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
        afterCourtney,
        operatingEnd,
        afterBuys,
        afterRentalCash,
        liquidEnd,
        operatingStart + liquidDelta,
        afterRentalCarried,
        afterPrincipalBack,
        afterVestwell,
        afterDividends,
        afterMarket,
        afterOptions,
        afterMarks,
        statement.endingBalance
      ])
    );

    xAxis.transition(t).call(d3.axisTop(x).tickSize(height).tickFormat(formatCurrencyCrude));
    yAxis.transition(t).call(d3.axisLeft(y).tickSize(-width).tickPadding(10));

    // Divider between the CASH FLOW group (bars 1-8) and the NET WORTH group
    // (bars 9-12), which restarts its own waterfall from the period start.
    // The chart tells a three-part story: (1) operating cash flow is what it
    // is; (2) assets were sold/bought to balance checking & cards; (3) big
    // picture, net worth moves on despite the operating back-heel.
    gdivider.selectAll("*").remove();
    const drawDivider = (labelAbove: string, labelBelow: string, above: string, below: string) => {
      const dy = (y(labelAbove) + y.bandwidth() + y(labelBelow)) / 2;
      gdivider
        .append("line")
        .attr("class", "svg-grey")
        .attr("stroke-width", 1.5)
        .attr("stroke-dasharray", "6,4")
        .attr("x1", -margin.left + rem(8))
        .attr("x2", width)
        .attr("y1", dy)
        .attr("y2", dy);
      for (const [text, offset] of [
        [above, -rem(6)],
        [below, rem(12)]
      ] as const) {
        gdivider
          .append("text")
          .attr("class", "svg-text-grey")
          .attr("font-size", "0.7rem")
          .attr("letter-spacing", "0.1em")
          .attr("x", -margin.left + rem(8))
          .attr("y", dy + offset)
          .text(text);
      }
    };
    drawDivider(
      "🏁 Operating Cash Flow",
      "Cash → Investments & Assets",
      "▲ OPERATING — did income cover daily life?",
      "▼ CASH ↔ ASSETS — selling & buying assets to keep checking + cards stable"
    );
    drawDivider(
      "🏁 Liquid Delta (Checking − Cards)",
      "Operating Cash Flow (carried)",
      "▲ CASH FLOW",
      "▼ NET WORTH — the big picture: contributions, dividends, markets, vesting, marks"
    );

    garrows.selectAll("g").remove();
    t.on("end", () => {
      garrows.selectAll("g").data(bars).join("g").attr("class", "g-arrow is-light").call(arrows);
    });

    // Computed bars have no account breakdown; explain the arithmetic instead
    // of showing an empty tooltip.
    const BAR_DESCRIPTIONS: Record<string, string> = {
      "🏁 Operating Cash Flow":
        "Operating income − operating expenses + Courtney's business (the bars above, netted). Rental is deliberately NOT here — it lives in the cash↔asset section below as its own cash flow. Did day-to-day cash cover the period?",
      "🏁 Liquid Delta (Checking − Cards)": `Actual change in net liquid position: checking balances minus card balances. Usually near zero — negative means new pending card charges or less cash on hand; positive means cards paid off or cash built up.${
        Math.abs(nonCashGap) > 1
          ? ` The section bars above land ${formatCurrency(nonCashGap)} away because asset book values also move without cash — reinvested dividends, margin, card rewards.`
          : ""
      }`,
      "Cash → Investments & Assets":
        "Asset purchases funded from cash — plus some book-value increases that did NOT use cash: reinvested dividends inside Vanguard/HSA, card-reward deposits into Robinhood, margin. The 🏁 bar below reports actual balances.",
      "Operating Cash Flow (carried)":
        "The same operating cash flow from the group above, restated as the first step of the net-worth walk. The cash↔asset swaps above the line are net-worth-neutral, so they don't appear here.",
      "Vestwell Contributions (Payroll)":
        "Retirement savings withheld from the paycheck before it reached checking — excluded from operating income above, counted here as new net worth.",
      "Courtney's Business (Net)":
        "Courtney's business income net of business expenses (the WF business account and her cards). Negative expense lines are card credits/refunds.",
      "Rental (Net Cash)": `The rentals from the cash side: rent received minus rental expenses minus the FULL mortgage checks (interest + principal). The principal slice (${formatCurrency(mortgagePaydown)}) wasn't lost — it became home equity, handed back below as Principal (Paid to Ourselves).`,
      "Rental Cash Flow (carried)":
        "The same rental net cash from the group above, restated as a step of the net-worth walk.",
      "Principal (Paid to Ourselves)":
        "The principal slice of the mortgage payments. It left checking (counted in the rental cash bar) but became equity in the properties — money we paid ourselves, not an expense.",
      "Options Vested":
        "NEW startup options/shares that vested during the period, valued at their price on arrival (Parabola at 10¢). No cash moved — they simply appeared in net worth. Later repricing shows under Appreciation / Depreciation.",
      "Appreciation / Depreciation (Marks)":
        "Manual markups/markdowns on illiquid assets: the properties, the Bronco, and startup shares/options. These are hand-set prices, not market feeds.",
      "Dividends (Reinvested)":
        "Dividends earned inside investment accounts (reinvested or held there) — they accrue to net worth without passing through checking.",
      "🏁 Net Worth Delta":
        "Ending net worth − starting net worth: operating cash flow + payroll contributions + options + dividends + market gains + adjustments, netted."
    };

    const barTooltip = (d: Bar) => {
      // Rental nets several Expenses:Housing/Tax subaccounts; show 3 levels
      // there so "Expenses:Housing:Mortgage" isn't mistaken for home rent.
      const groupDepth =
        d.label === "Rental (Net Cash)" || d.label === "Courtney's Business (Net)" ? 3 : 2;
      const secondLevelBreakdown = _.chain(d.breakdown)
          .toPairs()
          .groupBy((pair) => firstNames(pair[0], groupDepth))
          .map((pairs, label) => [label, _.sumBy(pairs, (pair) => pair[1])])
          .fromPairs()
          .value();

        // Per-payment texture: "N payments, principal X–Y each".
        if (d.label === "Principal (Paid to Ourselves)" && !_.isEmpty(mortgageDetail)) {
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

        // Liquid checkpoint: checking deltas plus a card-by-card audit —
        // balance before -> after (owed shown positive), top movers first.
        if (d.label === "🏁 Liquid Delta (Checking − Cards)") {
          const rows = _.chain(checkingBreakdown)
            .toPairs()
            .filter(([, v]) => Math.abs(v) > 0.01)
            .sortBy(([, v]) => -Math.abs(v))
            .map(
              ([k, v]) =>
                [
                  iconify(k),
                  [formatCurrency(v), "has-text-right has-text-weight-bold"]
                ] as Array<string | string[]>
            )
            .value();

          const byIssuer: Record<string, { start: number; end: number }> = {};
          for (const [k, lvl] of Object.entries(ccLevels)) {
            const issuer = firstNames(k, 3);
            const agg = byIssuer[issuer] || { start: 0, end: 0 };
            agg.start += lvl.start;
            agg.end += lvl.end;
            byIssuer[issuer] = agg;
          }
          for (const [issuer, lvl] of _.sortBy(
            Object.entries(byIssuer),
            ([, lvl]) => -Math.abs(lvl.end - lvl.start)
          ).slice(0, 4)) {
            if (Math.abs(lvl.end - lvl.start) < 0.01) continue;
            const owedStart = Math.abs(lvl.start);
            const owedEnd = Math.abs(lvl.end);
            const dir = owedEnd < owedStart ? "▼ down to" : "▲ up to";
            rows.push([
              `💳 ${_.last(issuer.split(":"))} ${formatCurrency(owedStart)} ${dir} ${formatCurrency(owedEnd)}`,
              [formatCurrency(lvl.end - lvl.start), "has-text-right has-text-weight-bold"]
            ]);
          }

          const description = BAR_DESCRIPTIONS[d.label];
          if (description) {
            rows.push([
              [
                `<div style="max-width: 22rem; white-space: normal;" class="has-text-grey">${description}</div>`,
                "",
                "2"
              ]
            ]);
          }

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
