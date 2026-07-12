<script lang="ts">
  import { ajax, formatCurrency, isMobile, type LedgerFile, type Transaction as T } from "$lib/utils";
  import _ from "lodash";
  import { onDestroy, onMount } from "svelte";
  import VirtualList from "svelte-tiny-virtual-list";
  import Transaction from "$lib/components/Transaction.svelte";
  import BulkEditForm from "$lib/components/BulkEditForm.svelte";
  import { slide } from "svelte/transition";
  import * as bulkEdit from "$lib/bulk_edit";
  import * as toast from "bulma-toast";
  import DiffViewModal from "$lib/components/DiffViewModal.svelte";
  import SearchQuery from "$lib/components/SearchQuery.svelte";
  import { editorState } from "$lib/search_query_editor";
  import { get } from "svelte/store";
  import { download } from "$lib/export";

  // Arriving from a waterfall bar click: ?q= seeds the query, ?bar= names the
  // bar so the provenance is visible ("these transactions ARE that bar").
  const urlParams = new URLSearchParams(window.location.search);
  const initialQuery = urlParams.get("q") ?? "";
  let drillBar = urlParams.get("bar");

  let searchQuery: SearchQuery;
  let buldEditOpen = false;
  let cookbookOpen = false;
  let transactions: T[] = null;
  let filtered: T[] = [];
  let files: LedgerFile[] = [];
  let newFiles: LedgerFile[] = [];
  let updatedTransactionsCount = 0;
  let openPreviewModal = false;
  let accounts: string[] = [];
  let commodities: string[] = [];

  const debits = (t: T) => {
    return _.filter(t.postings, (p) => p.amount < 0);
  };

  const credits = (t: T) => {
    return _.filter(t.postings, (p) => p.amount >= 0);
  };

  function handleInputRaw(predicate: (t: T) => boolean) {
    filtered = _.filter(transactions, predicate);
  }

  const handleInput = _.debounce(handleInputRaw, 100);

  const unsubscribe = editorState.subscribe((state) => {
    handleInput(state.predicate);
  });

  onDestroy(async () => {
    unsubscribe();
  });

  // Trust check: sum every posting in the filtered transactions by top-level
  // account. When you drill in from a waterfall bar, the matching root here
  // should reproduce the bar's magnitude (ledger sign convention: expenses
  // positive, income negative).
  const ROOT_ORDER = ["Income", "Expenses", "Assets", "Liabilities", "Equity"];
  let rootTotals: Array<[string, number]> = [];
  $: rootTotals = _.chain(filtered)
    .flatMap((t) => t.postings)
    .groupBy((p) => p.account.split(":")[0])
    .map((ps, root) => [root, _.sumBy(ps, (p) => p.amount)] as [string, number])
    .filter(([, v]) => Math.abs(v) >= 0.01)
    .sortBy(([root]) => {
      const i = ROOT_ORDER.indexOf(root);
      return i === -1 ? ROOT_ORDER.length : i;
    })
    .value();

  // Query cookbook: click an example to run it. Doubles as the DSL tutorial —
  // each row is a pattern worth stealing.
  const COOKBOOK: Array<{ query: string; teaches: string }> = [
    { query: "account =~ /^Expenses:/ AND [2026-06]", teaches: "regex on account + a whole month" },
    { query: "payee =~ /amazon/i", teaches: "payee regex, /i = ignore case" },
    {
      query: "account = Expenses:Travel:Vacation AND amount > 500",
      teaches: "exact account + amount threshold"
    },
    {
      query: "account =~ /^Equity:Transfers/",
      teaches: "transfer legs — a healthy ledger nets these to zero"
    },
    {
      query: "account =~ /^Expenses:/ AND NOT account =~ /^Expenses:(Business|Rental)/",
      teaches: "NOT carves out Courtney/rental — household only"
    },
    {
      query: "account =~ /^Expenses:/ AND date >= [2026-01-01] AND date <= [2026-03-31]",
      teaches: "explicit date range (Q1)"
    }
  ];

  const mobile = isMobile();

  const itemSize = (i: number) => {
    const t = filtered[i];
    const count = mobile ? t.postings.length : Math.max(credits(t).length, debits(t).length);
    return 8 + count * 22 + (mobile ? 25 : 0);
  };

  async function loadTransactions() {
    ({ files, accounts, commodities } = await ajax("/api/editor/files"));
    ({ transactions } = await ajax("/api/transaction"));
    handleInputRaw(get(editorState).predicate);

    newFiles = files;
  }

  async function downloadTransactions() {
    const { balancedPostings } = await ajax("/api/transaction/balanced");
    download(balancedPostings);
  }

  function showPreview(detail: any) {
    ({ newFiles, updatedTransactionsCount } = bulkEdit.applyChanges(
      files,
      filtered,
      detail.operation,
      detail.args
    ));
    openPreviewModal = true;
  }

  async function saveAll(newFiles: LedgerFile[]) {
    for (const newFile of newFiles) {
      const { saved, message } = await ajax("/api/editor/save", {
        method: "POST",
        body: JSON.stringify({ name: newFile.name, content: newFile.content }),
        background: true
      });

      if (!saved) {
        toast.toast({
          message: `Failed to save ${newFile.name}. reason: ${message}`,
          type: "is-danger",
          duration: 10000
        });
      } else {
        toast.toast({
          message: `Saved ${newFile.name}`,
          type: "is-success"
        });
      }
    }
    await loadTransactions();
  }

  onMount(async () => {
    await loadTransactions();
  });
</script>

<DiffViewModal
  on:save={(e) => saveAll(e.detail)}
  bind:open={openPreviewModal}
  oldFiles={files}
  {newFiles}
  {updatedTransactionsCount}
/>

{#if transactions}
  <section class="section tab-journal">
    <div class="container is-fluid">
      {#if drillBar}
        <div class="notification is-link is-light py-2 px-4 mb-3">
          <button class="delete" on:click={() => (drillBar = null)} />
          Showing the transactions behind the <strong>{drillBar}</strong> bar of the Income
          Statement. The query below is exactly how that bar selects accounts — edit it freely to
          poke around.
        </div>
      {/if}
      <div class="columns">
        <div class="column is-12">
          <nav class="level">
            <div class="level-left">
              <div class="level-item">
                <div class="field">
                  <div class="control">
                    <SearchQuery
                      bind:this={searchQuery}
                      {initialQuery}
                      autocomplete={{
                        account: accounts,
                        commodity: commodities,
                        filename: files.map((f) => f.name)
                      }}
                    />
                  </div>
                </div>
              </div>
              <div class="level-item">
                <button
                  class="button is-small is-light invertable"
                  class:is-link={cookbookOpen}
                  on:click={(_e) => (cookbookOpen = !cookbookOpen)}
                  title="Example queries — click one to run it"
                >
                  <span class="icon is-small"><i class="fas fa-graduation-cap"></i></span>
                  <span>How to search</span>
                </button>
              </div>
              <div class="level-item">
                <button
                  class="button is-small is-light invertable"
                  on:click={(_e) => (buldEditOpen = !buldEditOpen)}
                >
                  <span>Bulk Edit</span>
                  <span class="icon is-small">
                    <i class="fas {buldEditOpen ? 'fa-angle-up' : 'fa-angle-down'}"></i>
                  </span>
                </button>
              </div>
            </div>
            <div class="level-right">
              <div class="level-item">
                <p class="is-6"><b>{filtered.length}</b> transaction(s)</p>
              </div>
              <div class="level-item">
                <a on:click={(_e) => downloadTransactions()}>
                  <span class="icon is-small">
                    <i class="fa-solid fa-file-arrow-down"></i>
                  </span>
                  download
                </a>
              </div>
            </div>
          </nav>
        </div>
      </div>

      {#if cookbookOpen}
        <div class="columns" transition:slide>
          <div class="column is-12">
            <div class="box py-3">
              <p class="is-size-7 has-text-grey mb-2">
                Queries combine <code>account</code>, <code>payee</code>, <code>date</code>,
                <code>amount</code>, <code>commodity</code>, <code>note</code> with
                <code>=</code> (exact), <code>=~ /regex/</code> (pattern, add <code>i</code> for
                case-insensitive), <code>&gt;</code>/<code>&lt;</code> for numbers and dates, glued
                by <code>AND</code>, <code>OR</code>, <code>NOT</code>, parentheses. Bare
                <code>[2026]</code> or <code>[2026-03]</code> filters a year or month. Click an
                example to run it:
              </p>
              <table class="table is-narrow is-fullwidth is-size-7">
                <tbody>
                  {#each COOKBOOK as example}
                    <tr>
                      <td class="is-family-monospace">
                        <a on:click={() => searchQuery.setQuery(example.query)}
                          >{example.query}</a
                        >
                      </td>
                      <td class="has-text-grey">{example.teaches}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      {/if}

      {#if buldEditOpen}
        <div class="columns">
          <div class="column is-12" transition:slide>
            <BulkEditForm {accounts} on:preview={(e) => showPreview(e.detail)} />
          </div>
        </div>
      {/if}

      {#if !_.isEmpty(rootTotals) && filtered.length < transactions.length}
        <div class="columns">
          <div class="column is-12 pt-0">
            <div class="tags are-medium mb-0">
              <span class="tag is-white has-text-grey is-size-7"
                >postings in these {filtered.length} transactions, by top level:</span
              >
              {#each rootTotals as [root, total]}
                <span class="tag is-light">
                  <strong>{root}</strong>&nbsp;{formatCurrency(total)}
                </span>
              {/each}
            </div>
          </div>
        </div>
      {/if}

      <div class="columns">
        <div class="column is-12">
          <div class="box">
            <VirtualList
              width="100%"
              height={window.innerHeight - 150}
              itemCount={filtered.length}
              {itemSize}
            >
              <div slot="item" let:index let:style {style}>
                {@const t = filtered[index]}
                <Transaction {t} />
              </div>
            </VirtualList>
          </div>
        </div>
      </div>
    </div>
  </section>
{/if}
