<script lang="ts">
  import { createEditor } from "$lib/search_query_editor";
  import type { EditorView } from "codemirror";

  let editorDom: HTMLElement;
  export let autocomplete: Record<string, string[]>;
  // Seed the editor (e.g. from a ?q= URL param — waterfall bar drill-down).
  export let initialQuery: string = "";
  let editor: EditorView;

  $: if (autocomplete && editorDom) {
    if (editor) {
      editor.destroy();
    }

    editor = createEditor(initialQuery, editorDom, autocomplete);
  }

  // Replace the editor's content programmatically (example chips, drills).
  export function setQuery(query: string) {
    if (!editor) return;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: query } });
    editor.focus();
  }
</script>

<div class="search-query-editor" bind:this={editorDom} />
