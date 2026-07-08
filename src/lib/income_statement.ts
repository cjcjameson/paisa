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
  const BARS = 12;
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
  return function (statement: IncomeStatement) {
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

    // Operating Income (excluding rental and dividends)
    const isOperatingIncome = (acct: string) => !isRentalIncome(acct) && !isDividend(acct);
    const operatingIncome = Math.abs(sumMatching(statement.income, isOperatingIncome) + sumMatching(statement.interest, isOperatingIncome));

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

    // Market Gains & Dividends
    const dividendIncome = Math.abs(sumMatching(statement.income, isDividend));
    const pnl = sumAll(statement.pnl);
    const marketGains = pnl + dividendIncome;

    // Retirement / Investment Contributions (cash outflow from checking)
    const isChecking = (acct: string) => acct.toLowerCase().startsWith("assets:checking");
    const isCreditCard = (acct: string) => {
      const lower = acct.toLowerCase();
      return lower.startsWith("liabilities:creditcards") || lower.startsWith("liabilities:credit_cards") || lower.startsWith("liabilities:courtney:businesscard");
    };

    const assetsMap = (statement as any).assets || {};

    const liquidBreakdown: Record<string, number> = {};
    for (const [k, v] of Object.entries(assetsMap)) {
      if (isChecking(k)) liquidBreakdown[k] = v as number;
    }
    for (const [k, v] of Object.entries(statement.liabilities)) {
      if (isCreditCard(k)) liquidBreakdown[k] = v as number;
    }

    let vanguardWithdrawals = 0;
    let contributions = 0;
    for (const [acct, val] of Object.entries(assetsMap)) {
      if (!isChecking(acct)) {
        if (val < 0) {
          vanguardWithdrawals += Math.abs(val);
        } else {
          contributions += val;
        }
      }
    }

    // Mortgage Principal Paydown
    const isMortgageAccount = (acct: string) => acct.toLowerCase().startsWith("liabilities:mortgages:");
    const mortgagePaydown = Math.abs(sumMatching(statement.liabilities, isMortgageAccount));

    // Checking Cash Delta calculations
    const checkingEnd = operatingEnd + vanguardWithdrawals - contributions - mortgagePaydown;
    const checkingDelta = checkingEnd - operatingStart;

    // Net Worth Delta (ending net worth matches exactly)
    const totalChange = statement.endingBalance - statement.startingBalance;
    // junk makes the math closed-loop
    const junk = totalChange - (operatingCashFlow + marketGains);

    const junkBreakdown: Record<string, number> = {};
    for (const [k, v] of Object.entries(statement.equity || {})) {
      junkBreakdown[k] = -(v as number);
    }
    for (const [k, v] of Object.entries(statement.liabilities || {})) {
      junkBreakdown[k] = -(v as number);
    }

    const t = svg.transition().duration(firstRender ? 0 : 750);
    firstRender = false;

    // Build the 14 waterfall bars
    const bars: Bar[] = [
      {
        label: "Income (Operating)",
        start: operatingStart,
        end: operatingStart + operatingIncome,
        color: COLORS.income,
        value: operatingIncome,
        breakdown: _.omitBy({ ...statement.income, ...statement.interest }, (v, k) => !isOperatingIncome(k)),
        multiplier: -1
      },
      {
        label: "Expenses (Operating)",
        start: operatingStart + operatingIncome,
        end: operatingStart + operatingIncome - operatingExpenses,
        color: COLORS.expenses,
        value: -operatingExpenses,
        breakdown: _.omitBy({ ...statement.expenses, ...statement.tax }, (v, k) => !isOperatingExpense(k)),
        multiplier: -1
      },
      {
        label: "Rental Income (Net)",
        start: operatingStart + operatingIncome - operatingExpenses,
        end: operatingEnd,
        color: COLORS.primary,
        value: netRental,
        breakdown: {
          ..._.pickBy(statement.income, (v, k) => isRentalIncome(k)),
          ..._.pickBy(statement.expenses, (v, k) => isRentalExpense(k))
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
      {
        label: "Vanguard & Investment Sales",
        start: operatingEnd,
        end: operatingEnd + vanguardWithdrawals,
        color: COLORS.income,
        value: vanguardWithdrawals,
        breakdown: _.pickBy(assetsMap, (v, k) => !isChecking(k) && v < 0),
        multiplier: -1
      },
      {
        label: "Retirement & Investment Savings",
        start: operatingEnd + vanguardWithdrawals,
        end: operatingEnd + vanguardWithdrawals - contributions,
        color: COLORS.expenses,
        value: -contributions,
        breakdown: _.pickBy(assetsMap, (v, k) => !isChecking(k) && v > 0),
        multiplier: 1
      },
      {
        label: "Mortgage Principal Paydown",
        start: operatingEnd + vanguardWithdrawals - contributions,
        end: checkingEnd,
        color: COLORS.liabilities,
        value: -mortgagePaydown,
        breakdown: _.pickBy(statement.liabilities, (v, k) => isMortgageAccount(k)),
        multiplier: -1
      },
      {
        label: "🏁 Checking & Card Float Delta",
        start: operatingStart,
        end: checkingEnd,
        color: COLORS.assets,
        value: checkingDelta,
        breakdown: liquidBreakdown,
        multiplier: 1
      },
      // --- NET WORTH group: restarts from the period-start balance. The
      // retirement/withdrawal/paydown moves above are asset<->asset transfers,
      // invisible to net worth, so they simply don't appear here. ---
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
        label: "Market Gains & Growth",
        start: operatingEnd,
        end: operatingEnd + marketGains,
        color: marketGains > 0 ? COLORS.gain : COLORS.loss,
        value: marketGains,
        breakdown: {
          ...statement.pnl,
          ..._.mapValues(_.pickBy(statement.income, (v, k) => isDividend(k)), (v) => -(v as number))
        },
        multiplier: 1
      },
      {
        label: "Other / Adjustments",
        start: operatingEnd + marketGains,
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
      { label: "Expenses (Operating)", value: operatingStart + operatingIncome, anchor: "end" },
      { label: "Rental Income (Net)", value: operatingStart + operatingIncome - operatingExpenses, anchor: "end" },
      { label: "🏁 Operating Cash Flow", value: operatingEnd, anchor: "end" },
      { label: "Vanguard & Investment Sales", value: operatingEnd, anchor: "end" },
      { label: "Retirement & Investment Savings", value: operatingEnd + vanguardWithdrawals, anchor: "end" },
      { label: "Mortgage Principal Paydown", value: operatingEnd + vanguardWithdrawals - contributions, anchor: "end" },
      { label: "🏁 Checking & Card Float Delta", value: checkingEnd, anchor: "end" },
      { label: "Operating Cash Flow (carried)", value: operatingStart, anchor: "start" },
      { label: "Market Gains & Growth", value: operatingEnd, anchor: "end" },
      { label: "Other / Adjustments", value: operatingEnd + marketGains, anchor: "end" },
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
        operatingStart + operatingIncome,
        operatingStart + operatingIncome - operatingExpenses,
        operatingEnd,
        operatingEnd + vanguardWithdrawals,
        operatingEnd + vanguardWithdrawals - contributions,
        checkingEnd,
        operatingEnd + marketGains,
        statement.endingBalance
      ])
    );

    xAxis.transition(t).call(d3.axisTop(x).tickSize(height).tickFormat(formatCurrencyCrude));
    yAxis.transition(t).call(d3.axisLeft(y).tickSize(-width).tickPadding(10));

    // Divider between the CASH FLOW group (bars 1-8) and the NET WORTH group
    // (bars 9-12), which restarts its own waterfall from the period start.
    gdivider.selectAll("*").remove();
    const dividerY =
      (y("🏁 Checking & Card Float Delta") + y.bandwidth() + y("Operating Cash Flow (carried)")) / 2;
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
      "🏁 Checking & Card Float Delta":
        "Operating cash flow + investment sales − savings − mortgage paydown: the actual change in checking & credit-card balances over the period.",
      "Operating Cash Flow (carried)":
        "The same operating cash flow from the group above, restated as the first step of the net-worth walk. The investment transfers above it move money between accounts, so they don't appear here.",
      "🏁 Net Worth Delta":
        "Ending net worth − starting net worth: operating cash flow + market gains + other adjustments, netted."
    };

    const barTooltip = (d: Bar) => {
      const secondLevelBreakdown = _.chain(d.breakdown)
          .toPairs()
          .groupBy((pair) => firstNames(pair[0], 2))
          .map((pairs, label) => [label, _.sumBy(pairs, (pair) => pair[1])])
          .fromPairs()
          .value();

        if (d.label === "Other / Adjustments") {
          const rows = [];
          
          const ccVal = secondLevelBreakdown["Liabilities:CreditCards"] || 0;
          if (ccVal !== 0) {
            rows.push([
              "💳 Credit Card Debt Decrease (Net Worth +)",
              [formatCurrency(ccVal * d.multiplier), "has-text-right has-text-weight-bold"]
            ]);
          }

          const mtgVal = secondLevelBreakdown["Liabilities:Mortgages"] || 0;
          if (mtgVal !== 0) {
            rows.push([
              "🏠 Mortgage Principal Reduction (Net Worth +)",
              [formatCurrency(mtgVal * d.multiplier), "has-text-right has-text-weight-bold"]
            ]);
          }

          const histVal = secondLevelBreakdown["Equity:Historical"] || 0;
          if (histVal !== 0) {
            rows.push([
              "🔌 Untracked Card Payments (Chase/Courtney)",
              [formatCurrency(histVal * d.multiplier), "has-text-right has-text-weight-bold"]
            ]);
          }

          const transfersVal = secondLevelBreakdown["Equity:Transfers"] || 0;
          if (transfersVal !== 0) {
            rows.push([
              "💸 Stanford FCU (Untracked Transfer)",
              [formatCurrency(transfersVal * d.multiplier), "has-text-right has-text-weight-bold"]
            ]);
          }

          const openVal = secondLevelBreakdown["Equity:OpeningBalance"] || 0;
          if (openVal !== 0) {
            rows.push([
              "🏁 Bilt & Robinhood (Opening Balances)",
              [formatCurrency(openVal * d.multiplier), "has-text-right has-text-weight-bold"]
            ]);
          }

          const marginVal = secondLevelBreakdown["Liabilities:Robinhood"] || 0;
          if (marginVal !== 0) {
            rows.push([
              "📈 Robinhood Margin (Loan Increase)",
              [formatCurrency(marginVal * d.multiplier), "has-text-right has-text-weight-bold"]
            ]);
          }

          const handledKeys = new Set([
            "Liabilities:CreditCards",
            "Liabilities:Mortgages",
            "Equity:Historical",
            "Equity:Transfers",
            "Equity:OpeningBalance",
            "Liabilities:Robinhood"
          ]);
          for (const [k, v] of Object.entries(secondLevelBreakdown)) {
            if (!handledKeys.has(k) && Math.abs(v) > 0.01) {
              rows.push([
                iconify(k),
                [formatCurrency(v * d.multiplier), "has-text-right has-text-weight-bold"]
              ]);
            }
          }

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

        if (_.isEmpty(entries)) {
          const description = BAR_DESCRIPTIONS[d.label];
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
