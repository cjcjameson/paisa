import * as d3 from "d3";
import type { Dayjs } from "dayjs";
import chroma from "chroma-js";
import _ from "lodash";
import {
  forEachMonth,
  formatFixedWidthFloat,
  formatCurrency,
  formatCurrencyCrude,
  type Posting,
  skipTicks,
  tooltip,
  restName,
  firstName,
  monthDays,
  rem,
  type Legend
} from "$lib/utils";
import COLORS, { expenseColorScheme, sortExpenseGroups, white } from "$lib/colors";
import { get, type Readable, type Unsubscriber, type Writable } from "svelte/store";
import { iconify } from "$lib/icon";
import { byExpenseGroup, expenseGroup, pieData } from "$lib/expense";

export function renderCalendar(
  month: string,
  expenses: Posting[],
  z: d3.ScaleOrdinal<string, string, never>,
  groups: string[]
) {
  const id = "#d3-current-month-expense-calendar";

  const alpha = d3.scaleLinear().range([0.3, 1]);
  // In this calendar we never abbreviate to "K" and never show cents; whole dollars only.
  const fmtDay = d3.format(",.0f");
  const expensesByDay: Record<string, Posting[]> = {};
  const { days, monthStart, monthEnd } = monthDays(month);
  _.each(days, (d) => {
    expensesByDay[d.format("YYYY-MM-DD")] = _.filter(
      expenses,
      (e) => e.date.isSame(d, "day") && _.includes(groups, expenseGroup(e))
    );
  });

  const expensesByDayTotal = _.mapValues(expensesByDay, (ps) => _.sumBy(ps, (p) => p.amount));

  alpha.domain(d3.extent(_.values(expensesByDayTotal)));

  // Ring size encodes magnitude: sqrt scale so the ring AREA tracks the day's spend.
  const maxDayTotal = d3.max(_.values(expensesByDayTotal), (v) => Math.abs(v)) || 1;
  const radius = d3.scaleSqrt().domain([0, maxDayTotal]).range([7, 17]);

  const root = d3.select(id);
  const dayDivs = root.select("div.days").selectAll("div").data(days);

  const tooltipContent = (d: Dayjs) => {
    const es = expensesByDay[d.format("YYYY-MM-DD")];
    if (_.isEmpty(es)) {
      return null;
    }
    const total = _.sumBy(es, (p) => p.amount);
    return tooltip(
      es.map((p) => {
        return [
          [iconify(restName(p.account), { group: firstName(p.account) })],
          [p.payee, "is-clipped"],
          [formatCurrency(p.amount), "has-text-weight-bold has-text-right"]
        ];
      }),
      { total: formatCurrency(total), header: es[0].date.format("DD MMM YYYY") }
    );
  };

  const dayDiv = dayDivs
    .join("div")
    .attr("class", "date p-1")
    .style("position", "relative")
    .attr("data-tippy-content", tooltipContent)
    .style("visibility", (d) =>
      d.isBefore(monthStart) || d.isAfter(monthEnd) ? "hidden" : "visible"
    );

  dayDiv
    .selectAll("span.day")
    .data((d) => [d])
    .join("span")
    .attr("class", "day has-text-grey-light")
    .style("position", "absolute")
    .text((d) => d.date().toString());

  dayDiv
    .selectAll("span.total")
    .data((d) => [d])
    .join("span")
    .attr("class", "total is-size-7 has-text-weight-bold")
    .style("position", "absolute")
    .style("bottom", "-5px")
    .style("color", (d) =>
      chroma(COLORS.lossText)
        .alpha(alpha(expensesByDayTotal[d.format("YYYY-MM-DD")]))
        .hex()
    )
    .text((d) => {
      const total = expensesByDayTotal[d.format("YYYY-MM-DD")];
      if (total > 0) {
        return fmtDay(total);
      }
      return "";
    });

  const width = 35;
  const height = 50;

  dayDiv
    .selectAll("svg")
    .data((d) => [d])
    .join("svg")
    .attr("width", width)
    .attr("height", height)
    .attr("viewBox", [-width / 2, -height / 2, width, height])
    .attr("style", "max-width: 100%; height: auto; height: intrinsic;")
    .selectAll("path")
    .data((d) => pieData(expensesByDay[d.format("YYYY-MM-DD")]))
    .join("path")
    .attr("fill", function (d) {
      return z(d.data.category);
    })
    .attr("d", function (this: SVGPathElement, arc) {
      const day = d3.select(this.parentNode as any).datum() as Dayjs;
      const outer = radius(Math.abs(expensesByDayTotal[day.format("YYYY-MM-DD")] || 0));
      return d3
        .arc()
        .innerRadius(Math.max(outer - 4, 1))
        .outerRadius(outer)(arc as any);
    });
}

export function colorScale(postings: Posting[]) {
  const groups = sortExpenseGroups(_.chain(postings).map(expenseGroup).uniq().value());
  return expenseColorScheme(groups);
}

export function renderMonthlyExpensesTimeline(
  postings: Posting[],
  groupsStore: Writable<string[]>,
  monthStore: Writable<string>,
  dateRangeStore: Readable<{ from: Dayjs; to: Dayjs }>
): {
  z: d3.ScaleOrdinal<string, string, never>;
  destroy: Unsubscriber;
  legends: Legend[];
  legendMaxVisible: number;
} {
  const id = "#d3-monthly-expense-timeline";
  const timeFormat = "MMM-YYYY";
  const MAX_BAR_WIDTH = rem(40);
  const svg = d3.select(id),
    margin = { top: rem(15), right: rem(30), bottom: rem(60), left: rem(40) },
    width =
      document.getElementById(id.substring(1)).parentElement.clientWidth -
      margin.left -
      margin.right,
    height = +svg.attr("height") - margin.top - margin.bottom,
    g = svg.append("g").attr("transform", "translate(" + margin.left + "," + margin.top + ")");

  const groups = sortExpenseGroups(_.chain(postings).map(expenseGroup).uniq().value());

  const defaultValues = _.zipObject(
    groups,
    _.map(groups, () => 0)
  );

  const z = expenseColorScheme(groups);

  const [start, end] = d3.extent(_.map(postings, (p) => p.date));

  if (!start) {
    return {
      z: z,
      destroy: () => {
        // void
      },
      legends: [],
      legendMaxVisible: 0
    };
  }

  const ms = _.groupBy(postings, (p) => p.date.format(timeFormat));
  const ys = _.chain(postings)
    .groupBy((p) => p.date.format("YYYY"))
    .map((ps, k) => {
      const trend = _.chain(ps)
        .groupBy(expenseGroup)
        .map((ps, g) => {
          let months = 12;
          if (start.format("YYYY") == k) {
            months -= start.month();
          }

          if (end.format("YYYY") == k) {
            months -= 11 - end.month();
          }

          return [g, _.sum(_.map(ps, (p) => p.amount)) / months];
        })
        .fromPairs()
        .value();

      return [k, _.merge({}, defaultValues, trend)];
    })
    .fromPairs()
    .value();

  interface Point {
    month: string;
    timestamp: Dayjs;
    [key: string]: number | string | Dayjs;
  }

  const points: Point[] = [];

  forEachMonth(start, end, (month) => {
    const postings = ms[month.format(timeFormat)] || [];
    const values = _.chain(postings)
      .groupBy(expenseGroup)
      .map((postings, key) => [key, _.sum(_.map(postings, (p) => p.amount))])
      .fromPairs()
      .value();

    points.push(
      _.merge(
        {
          timestamp: month,
          month: month.format(timeFormat),
          postings: postings,
          trend: {}
        },
        defaultValues,
        values
      )
    );
  });

  const x = d3.scaleBand().range([0, width]).paddingInner(0.1).paddingOuter(0);
  const y = d3.scaleLinear().range([height, 0]);

  const tooltipContent = (allowedGroups: string[]) => {
    return (d: d3.SeriesPoint<Record<string, number>>) => {
      let grandTotal = 0;
      return tooltip(
        _.flatMap(allowedGroups, (key) => {
          const total = (d.data as any)[key];
          if (total > 0) {
            grandTotal += total;
            return [
              [
                iconify(key, { group: "Expenses" }),
                [formatCurrency(total), "has-text-weight-bold has-text-right"]
              ]
            ];
          }
          return [];
        }),
        { total: formatCurrency(grandTotal), header: (d.data.timestamp as any).format("MMM YYYY") }
      );
    };
  };

  const xAxis = g.append("g").attr("class", "axis x");
  const yAxis = g.append("g").attr("class", "axis y");

  const bars = g.append("g");
  const line1 = g
    .append("path")
    .attr("fill", "none")
    .attr("stroke", white())
    .attr("stroke-width", "2px")
    .attr("stroke-linecap", "round");

  const line2 = g
    .append("path")
    .attr("fill", "none")
    .attr("stroke", COLORS.expenses)
    .attr("stroke-width", "2px")
    .attr("stroke-linecap", "round")
    .attr("stroke-dasharray", "4 6");

  let firstRender = true;

  const render = (allowedGroups: string[], dateRange: { from: Dayjs; to: Dayjs }) => {
    groupsStore.set(allowedGroups);
    const allowedPoints = _.filter(
      points,
      (p) => p.timestamp.isSameOrBefore(dateRange.to) && p.timestamp.isSameOrAfter(dateRange.from)
    );
    const sum = (p: Point) => _.sum(_.map(allowedGroups, (k) => p[k]));
    x.domain(allowedPoints.map((p) => p.month));
    y.domain([0, d3.max(allowedPoints, sum)]);

    const t = svg.transition().duration(firstRender ? 0 : 750);
    firstRender = false;
    xAxis
      .attr("transform", "translate(0," + height + ")")
      .transition(t)
      .call(
        d3
          .axisBottom(x)
          .ticks(5)
          .tickFormat(skipTicks(30, x, (d) => d.toString()))
      )
      .selectAll("text")
      .attr("y", 10)
      .attr("x", 0)
      .attr("dy", ".71em")
      .attr("transform", null)
      .style("text-anchor", "middle");

    yAxis.transition(t).call(d3.axisLeft(y).tickSize(-width).tickFormat(formatCurrencyCrude));

    const path = d3
      .line<Point>()
      .curve(d3.curveStepAfter)
      .x((p) => x(p.month))
      .y((p) => {
        const total = _.chain(ys[p.timestamp.format("YYYY")])
          .pick(allowedGroups)
          .values()
          .sum()
          .value();

        return y(total);
      })(allowedPoints);

    line1.attr("d", path);
    line2.attr("d", path);

    bars
      .selectAll("g")
      .data(
        d3.stack().offset(d3.stackOffsetDiverging).keys(allowedGroups)(
          allowedPoints as { [key: string]: number }[]
        ),
        (d: any) => d.key
      )
      .join(
        (enter) =>
          enter.append("g").attr("fill", function (d) {
            return z(d.key);
          }),
        (update) => update.transition(t),
        (exit) =>
          exit.selectAll("rect").transition(t).attr("y", y.range()[0]).attr("height", 0).remove()
      )
      .selectAll("rect")
      .data(
        (d) => d,
        (d: any) => d.data.timestamp.format("YYYY-MM")
      )
      .join(
        (enter) =>
          enter
            .append("rect")
            .attr("class", "zoomable")
            .on("click", (_event, data) => {
              const timestamp: Dayjs = data.data.timestamp as any;
              monthStore.set(timestamp.format("YYYY-MM"));
            })
            .attr("data-tippy-content", tooltipContent(allowedGroups))
            .attr("x", function (d) {
              return (
                x((d.data as any).month) +
                (x.bandwidth() - Math.min(x.bandwidth(), MAX_BAR_WIDTH)) / 2
              );
            })
            .attr("width", Math.min(x.bandwidth(), MAX_BAR_WIDTH))
            .attr("y", y.range()[0])
            .transition(t)
            .attr("y", function (d) {
              return y(d[1]);
            })
            .attr("height", function (d) {
              return y(d[0]) - y(d[1]);
            }),
        (update) =>
          update
            .attr("data-tippy-content", tooltipContent(allowedGroups))
            .transition(t)
            .attr("width", Math.min(x.bandwidth(), MAX_BAR_WIDTH))
            .attr("x", function (d) {
              return (
                x((d.data as any).month) +
                (x.bandwidth() - Math.min(x.bandwidth(), MAX_BAR_WIDTH)) / 2
              );
            })
            .attr("y", function (d) {
              return y(d[1]);
            })
            .attr("height", function (d) {
              return y(d[0]) - y(d[1]);
            }),
        (exit) => exit.remove()
      );
  };

  let selectedGroups = groups;
  render(selectedGroups, get(dateRangeStore));

  const destroy = dateRangeStore.subscribe((dateRange) => render(get(groupsStore), dateRange));

  // Legend leads with the biggest categories (so what matters shows when collapsed),
  // each block colour-sorted; the timeline itself always breaks out every group.
  const groupTotals = _.chain(postings)
    .groupBy(expenseGroup)
    .mapValues((ps) => _.sumBy(ps, (p) => p.amount))
    .value();
  const LEGEND_TOP = 8;
  const topGroups = _.chain(groups)
    .orderBy((g) => groupTotals[g] || 0, "desc")
    .take(LEGEND_TOP)
    .value();
  const legendOrder = [
    ...sortExpenseGroups(topGroups),
    ...sortExpenseGroups(_.difference(groups, topGroups))
  ];

  const legends = legendOrder.map(
    (group) =>
      ({
        label: iconify(group, { group: "Expenses" }),
        color: z(group),
        shape: "square",
        onClick: () => {
          if (selectedGroups.length == 1 && selectedGroups[0] == group) {
            selectedGroups = groups;
          } else {
            selectedGroups = [group];
          }

          render(selectedGroups, get(dateRangeStore));
        }
      }) as Legend
  );

  return { z: z, destroy: destroy, legends, legendMaxVisible: Math.min(LEGEND_TOP, legendOrder.length) };
}

export function renderCurrentExpensesBreakdown(z: d3.ScaleOrdinal<string, string, never>) {
  const id = "#d3-current-month-breakdown";
  const BAR_HEIGHT = rem(20);
  const TEXT_WIDTH = rem(135);
  const svg = d3.select(id),
    margin = { top: 0, right: rem(160), bottom: rem(48), left: rem(100) },
    width =
      document.getElementById(id.substring(1)).parentElement.clientWidth -
      margin.left -
      margin.right,
    g = svg.append("g").attr("transform", "translate(" + margin.left + "," + margin.top + ")");

  const x = d3.scaleLinear().range([0, width]);
  const y = d3.scaleBand().paddingInner(0.1).paddingOuter(0);

  const xAxis = g.append("g").attr("class", "axis y");
  const yAxis = g.append("g").attr("class", "axis y dark");

  const bar = g.append("g");
  const gtotal = g.append("g");

  return (postings: Posting[]) => {
    interface Point {
      category: string;
      postings: Posting[];
      total: number;
    }

    const categories = byExpenseGroup(postings);
    const keys = _.chain(categories)
      .sortBy((c) => c.total)
      .map((c) => c.category)
      .value();

    const points = _.values(categories);
    const total = _.sumBy(points, (p) => p.total);

    const height = BAR_HEIGHT * keys.length;
    svg.attr("height", height + margin.top + margin.bottom);

    y.domain(keys);
    x.domain([0, d3.max(points, (p) => p.total)]);
    y.range([height, 0]);

    const t = svg.transition().duration(750);

    xAxis
      .attr("transform", "translate(0," + height + ")")
      .transition(t)
      .call(
        d3
          .axisBottom(x)
          .tickSize(-height)
          .tickFormat(skipTicks(60, x, formatCurrencyCrude))
      );

    yAxis
      .transition(t)
      .call(d3.axisLeft(y).tickFormat((g) => iconify(g, { group: "Expenses", suffix: true })));

    const tooltipContent = (d: Point) => {
      const total = _.sumBy(d.postings, (p) => p.amount);
      return tooltip(
        d.postings.map((p) => {
          return [
            p.date.format("DD MMM YYYY"),
            [p.payee, "is-clipped"],
            [formatCurrency(p.amount), "has-text-weight-bold has-text-right"]
          ];
        }),
        {
          total: formatCurrency(total),
          header: `${d.postings[0].date.format("MMM YYYY")} ${d.category}`
        }
      );
    };

    bar
      .selectAll("rect")
      .data(points, (p: any) => p.category)
      .join(
        (enter) =>
          enter
            .append("rect")
            .attr("fill", function (d) {
              return z(d.category);
            })
            .attr("data-tippy-content", tooltipContent)
            .attr("x", x(0))
            .attr("y", function (d) {
              return y(d.category) + (y.bandwidth() - Math.min(y.bandwidth(), BAR_HEIGHT)) / 2;
            })
            .attr("width", function (d) {
              return x(d.total);
            })
            .attr("height", y.bandwidth()),

        (update) =>
          update
            .attr("fill", function (d) {
              return z(d.category);
            })
            .attr("data-tippy-content", tooltipContent)
            .transition(t)
            .attr("x", x(0))
            .attr("y", function (d) {
              return y(d.category) + (y.bandwidth() - Math.min(y.bandwidth(), BAR_HEIGHT)) / 2;
            })
            .attr("width", function (d) {
              return x(d.total);
            })
            .attr("height", y.bandwidth()),

        (exit) => exit.remove()
      );

    const labelY = (d: Point) => y(d.category) + y.bandwidth() / 2;
    const labelFill = (d: Point) => chroma(z(d.category)).darken(0.8).hex();

    // Right-hand figures in a plain sans font, split into two aligned columns.
    bar
      .selectAll("text.amount")
      .data(points, (p: any) => p.category)
      .join("text")
      .attr("class", "amount")
      .attr("text-anchor", "end")
      .attr("dominant-baseline", "middle")
      .attr("x", width + rem(72))
      .style("font-size", "0.85rem")
      .style("fill", labelFill)
      .attr("y", labelY)
      .text((d) => formatCurrency(d.total));

    bar
      .selectAll("text.percent")
      .data(points, (p: any) => p.category)
      .join("text")
      .attr("class", "percent")
      .attr("text-anchor", "end")
      .attr("dominant-baseline", "middle")
      .attr("x", width + TEXT_WIDTH)
      .style("font-size", "0.85rem")
      .style("fill", "#7a7a7a")
      .attr("y", labelY)
      .text((d) => `${((d.total / total) * 100).toFixed(1)}%`);

    // Total row, ruled off below the axis.
    gtotal
      .selectAll("line")
      .data([total])
      .join("line")
      .attr("x1", -rem(96))
      .attr("x2", width + TEXT_WIDTH)
      .attr("y1", height + rem(14))
      .attr("y2", height + rem(14))
      .attr("stroke", "#dbdbdb");

    gtotal
      .selectAll("text.total-label")
      .data([total])
      .join("text")
      .attr("class", "total-label")
      .attr("text-anchor", "end")
      .attr("x", -rem(8))
      .attr("y", height + rem(34))
      .style("font-size", "0.9rem")
      .style("font-weight", "bold")
      .text("Total");

    gtotal
      .selectAll("text.total-value")
      .data([total])
      .join("text")
      .attr("class", "total-value")
      .attr("text-anchor", "end")
      .attr("x", width + rem(72))
      .attr("y", height + rem(34))
      .style("font-size", "0.9rem")
      .style("font-weight", "bold")
      .text((v) => formatCurrency(v));

    return;
  };
}
