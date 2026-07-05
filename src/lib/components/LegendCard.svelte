<script lang="ts">
  import * as d3 from "d3";
  import type { Action } from "svelte/action";
  import type { Legend } from "$lib/utils";

  export let clazz = "";
  export let legends: Legend[];
  export let maxVisible = Infinity;

  let expanded = false;
  $: visibleLegends = expanded ? legends : legends.slice(0, maxVisible);
  $: hiddenCount = Math.max(0, legends.length - maxVisible);

  const textureScale = 14;
  const texture: Action<SVGSVGElement, { texture: any }> = (element, props) => {
    const svg = d3.select(element);
    svg.call(props.texture);
    svg
      .append("rect")
      .attr("x", 0)
      .attr("y", 0)
      .attr("height", textureScale)
      .attr("width", textureScale)
      .attr("fill", props.texture.url());

    return {};
  };

  let selectedLegend: Legend;

  function onClick(legend: Legend) {
    if (!legend.onClick) {
      return;
    }

    legend.onClick(legend);
    if (selectedLegend == legend) {
      // toggle
      legend.selected = false;
      selectedLegend = null;
    } else {
      selectedLegend && (selectedLegend.selected = false);
      legend.selected = true;
      selectedLegend = legend;
    }
  }
</script>

<div class="flex flex-wrap items-center justify-start gap-x-3 gap-y-1 {clazz}">
  {#each visibleLegends as legend}
    <div
      class="flex flex-row items-center p-1 gap-1.5 legend-box {legend.onClick && 'cursor-pointer'}"
      on:click={(_e) => onClick(legend)}
      class:selected={selectedLegend == legend}
    >
      {#if legend.texture}
        <svg
          use:texture={{ texture: legend.texture }}
          class="self-center"
          height="1rem"
          width="1rem"
          viewBox="0 0 {textureScale} {textureScale}"
        ></svg>
      {:else if legend.shape == "square"}
        <div
          class="self-center"
          style="background-color: {legend.color}; height: 1rem; width: 1rem;"
        ></div>
      {:else if legend.shape == "line"}
        <div
          class="self-center"
          style="border-top: 3px solid {legend.color}; height: 0.1rem; width: 2rem;"
        ></div>
      {/if}
      <div class="legend-label whitespace-pre is-size-6-5 has-text-grey custom-icon">
        {legend.label}
      </div>
    </div>
  {/each}
  {#if hiddenCount > 0}
    <button
      class="legend-more is-size-6-5 has-text-grey-light"
      on:click={() => (expanded = !expanded)}
    >
      {expanded ? "show less" : `+${hiddenCount} more`}
    </button>
  {/if}
</div>
