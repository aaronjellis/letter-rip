<script lang="ts">
  import { untrack } from 'svelte';
  import { resolveEnvelopeSize } from '../lib/envelopes/sizes';
  import { buildEnvelopePdf, type EnvelopeSettings, type EnvelopeWarning } from '../lib/envelopes/build';
  import { isRichEmpty, type RichText } from '../lib/richtext';
  import { createBrowserFontProvider } from '../lib/fonts/loader';
  import { renderPdfPageToCanvas, isRenderCancelled } from '../lib/pdf/preview';
  import { errorMessage } from '../lib/errors';
  import { carryRenames, includedCount, recordFromRow, type Dataset } from '../lib/merge/import';
  import { fieldKey, renameTokens, renderTemplate, unknownTokens } from '../lib/merge/render';
  import ListDialog from './ListDialog.svelte';
  import SizePicker from './SizePicker.svelte';
  import BlockLayoutEditor from './BlockLayoutEditor.svelte';
  import AddressEditor from './AddressEditor.svelte';
  import Send from '@lucide/svelte/icons/send';
  import House from '@lucide/svelte/icons/house';
  import Eye from '@lucide/svelte/icons/eye';
  import Mail from '@lucide/svelte/icons/mail';
  import Move from '@lucide/svelte/icons/move';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Printer from '@lucide/svelte/icons/printer';
  import Download from '@lucide/svelte/icons/download';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import User from '@lucide/svelte/icons/user';
  import Table from '@lucide/svelte/icons/table';
  import Pencil from '@lucide/svelte/icons/pencil';
  import X from '@lucide/svelte/icons/x';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Info from '@lucide/svelte/icons/info';

  let { settings, onsettings, mergeTemplate, onmergetemplate }: {
    settings: EnvelopeSettings;
    onsettings: (s: EnvelopeSettings) => void;
    /** The To template for mail merge, with `{{Field}}` tokens (persisted in the profile). */
    mergeTemplate: RichText;
    onmergetemplate: (t: RichText) => void;
  } = $props();

  /** Above this many rows, warn that building the PDF may be slow. */
  const LARGE_LIST = 2000;

  // Recipient lives only for this session (spec: never persisted).
  let recipient = $state.raw<RichText>({ lines: [] });
  // Mail merge: the To source and the loaded list are session state; both modes stay in memory.
  let toMode = $state<'single' | 'list'>('single');
  let dataset = $state.raw<Dataset | null>(null);
  /** Position in `included` of the record the preview shows. */
  let current = $state(0);
  /** Replaced-character warnings from the last full list build, as 1-based row numbers. */
  let listWarnings = $state<{ rows: number[]; chars: string[] }>({ rows: [], chars: [] });
  /** True while Print or Download builds the whole list. */
  let exporting = $state(false);
  /**
   * Whole-list notes, refreshed by the debounced preview effect rather than on every keystroke:
   * included rows whose block renders empty, and template fields with no matching column.
   */
  let mergeStats = $state.raw<{ skipped: number; unknown: string[] }>({ skipped: 0, unknown: [] });
  // Bytes of the latest preview PDF; also what Download saves.
  let pdfBytes = $state.raw<Uint8Array | null>(null);
  let warnings = $state<EnvelopeWarning[]>([]);
  let returnReplaced = $state<string[]>([]);
  let error = $state('');
  let building = $state(false);
  let rendering = $state(false);
  // True once the current canvas holds a drawn page, so an empty canvas never shows.
  let drawn = $state(false);
  // CSS width available to the envelope picture, measured from the stage.
  let stageWidth = $state(0);
  let panel = $state<HTMLDivElement>();
  let stage = $state<HTMLDivElement>();
  let canvas = $state<HTMLCanvasElement>();
  let listDialog = $state<ReturnType<typeof ListDialog>>();
  let stripEdit = $state<HTMLButtonElement>();
  // Blob URLs handed to print tabs and downloads. Not reactive: only used for cleanup.
  let lastPrintUrl = '';
  const downloadUrls = new Set<string>();

  const listMode = $derived(toMode === 'list');
  /** Dataset row indexes that are included, in order. */
  const included = $derived(dataset ? dataset.included.flatMap((on, i) => (on ? [i] : [])) : []);
  const index = $derived(Math.min(current, Math.max(0, included.length - 1)));
  const currentRow = $derived(included.length > 0 ? included[index] : -1);
  const currentBlock = $derived(
    dataset && currentRow >= 0 ? renderTemplate(mergeTemplate, recordFromRow(dataset, currentRow)) : null,
  );
  const currentCaption = $derived(
    dataset && currentRow >= 0 ? (dataset.rows[currentRow][0] || `Row ${currentRow + 1}`) : '',
  );
  const fieldNames = $derived(dataset ? dataset.columns.map((c) => c.name) : []);
  const listSummary = $derived(
    dataset ? `${includedCount(dataset)} of ${dataset.rows.length} ${dataset.rows.length === 1 ? 'row' : 'rows'}` : '',
  );

  /** Envelopes Print makes, as of the last stats refresh. */
  const printCount = $derived(Math.max(0, included.length - mergeStats.skipped));
  const hasReturn = $derived(settings.showReturn && !isRichEmpty(settings.returnAddress));
  // Something prints when either enabled block has text. In list mode the rows aren't rendered here
  // (that would redo the whole list on every keystroke): the count comes from the debounced stats,
  // and build() still reports a list with no addresses if the stats lag behind.
  const canPrint = $derived(
    listMode
      ? !!dataset && included.length > 0 && printCount > 0 && (settings.showRecipient || hasReturn)
      : (settings.showRecipient && !isRichEmpty(recipient)) || hasReturn,
  );
  /** What the preview draws: the single recipient, or the current record. Null when nothing prints. */
  const previewBlock = $derived(
    listMode
      ? currentBlock && ((settings.showRecipient && !isRichEmpty(currentBlock)) || hasReturn) ? currentBlock : null
      : canPrint ? recipient : null,
  );
  const blankMessage = $derived(
    !settings.showRecipient && !settings.showReturn
      ? 'Turn on From or To to print something.'
      : listMode && settings.showRecipient
        ? !dataset
          ? 'Load a list to preview your envelopes.'
          : included.length === 0
            ? 'No rows included. Select rows in the list to preview them.'
            : 'This row has no address. Step to another row, or add fields to the To template.'
        : settings.showRecipient
          ? 'Type a To address to see your envelope.'
          : 'Type a From address to see your envelope.',
  );
  const size = $derived(resolveEnvelopeSize(settings));

  // One provider for the component's lifetime so fonts load once per session.
  const fonts = createBrowserFontProvider();

  function update<K extends keyof EnvelopeSettings>(key: K, value: EnvelopeSettings[K]) {
    onsettings({ ...settings, [key]: value });
  }

  /**
   * Render the template once per included row, in one pass over a plain copy of the template.
   * Rows whose block is empty are left out; `rows[i]` is the dataset row of `blocks[i]`.
   */
  function mergeRows(ds: Dataset, rowIndexes: number[], template: RichText) {
    const blocks: RichText[] = [];
    const rows: number[] = [];
    for (const r of rowIndexes) {
      const block = renderTemplate(template, recordFromRow(ds, r));
      if (isRichEmpty(block)) continue;
      blocks.push(block);
      rows.push(r);
    }
    return { blocks, rows };
  }

  /** Build the PDF for the current inputs: one page, or in list mode one page per included row. */
  async function build() {
    if (!listMode) return buildEnvelopePdf([recipient], settings, fonts);
    if (!dataset) throw new Error('Load a list first.');
    const { blocks, rows } = mergeRows(dataset, included, $state.snapshot(mergeTemplate) as RichText);
    if (blocks.length === 0) throw new Error('None of the included rows has an address. Check the To template and your list.');
    const result = await buildEnvelopePdf(blocks, settings, fonts);
    const chars = new Set<string>();
    for (const w of result.warnings) for (const c of w.replaced) chars.add(c);
    listWarnings = { rows: result.warnings.map((w) => rows[w.block] + 1), chars: [...chars] };
    return result;
  }

  /**
   * A new list. A column rename (same source, same shape) rewrites matching template tokens so
   * they follow the column. A rebuild from the same source (header or transpose toggle) keeps the
   * user's column names where the column still exists; tokens for a renamed column that's gone
   * revert to its original name.
   */
  function onDataset(incoming: Dataset | null) {
    const prev = dataset;
    let next = incoming;
    if (prev && next && next.source === prev.source && next.headerRow === prev.headerRow
      && next.transposed === prev.transposed && next.columns.length === prev.columns.length) {
      let template = mergeTemplate;
      next.columns.forEach((col, i) => {
        const old = prev.columns[i];
        if (old.id === col.id && old.name !== col.name) template = renameTokens(template, old.name, col.name);
      });
      if (template !== mergeTemplate) onmergetemplate(template);
    } else if (prev && next && next.source === prev.source) {
      const carried = carryRenames(prev, next);
      let template = mergeTemplate;
      for (const old of prev.columns) {
        if (old.name === old.originalName) continue;
        const col = carried.columns.find((c) => c.originalName === old.originalName);
        const to = col ? col.name : old.originalName;
        if (fieldKey(to) !== fieldKey(old.name)) template = renameTokens(template, old.name, to);
      }
      if (template !== mergeTemplate) onmergetemplate(template);
      next = carried;
      current = 0;
    } else {
      current = 0;
    }
    // A different list or shape: the old skipped count no longer applies (the stats refresh shortly).
    if (next?.source !== prev?.source || next?.rows.length !== prev?.rows.length) {
      mergeStats = { skipped: 0, unknown: mergeStats.unknown };
    }
    dataset = next;
  }

  /** Switch To to From a list; with no list yet, open the list dialog on the loader. */
  function chooseListMode(e: MouseEvent) {
    if (toMode === 'list') return;
    toMode = 'list';
    if (!dataset) void listDialog?.open(e.currentTarget as HTMLElement);
  }

  /** Drop the list from the strip. No confirm: loading the file again brings it back. */
  function removeList() {
    listDialog?.remove();
    // The Remove button goes away; keep focus on the strip.
    stripEdit?.focus();
  }

  function stepRecord(delta: number) {
    if (included.length === 0) return;
    current = Math.min(included.length - 1, Math.max(0, index + delta));
  }

  /** Arrow keys step through records unless the user is typing somewhere or a dialog is open. */
  function onRecordKeys(e: KeyboardEvent) {
    if (!listMode || included.length === 0 || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.closest('input, textarea, select, [contenteditable="true"], dialog[open], [role="listbox"]'))) return;
    const jump: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };
    const delta = jump[e.key];
    if (delta === undefined) return;
    e.preventDefault();
    stepRecord(delta);
  }

  function pdfUrl(bytes: Uint8Array): string {
    return URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  }

  // Debounced live preview, plus the whole-list stats in list mode. Only the synchronous reads
  // (preview block, settings, template, list) are tracked; writes inside the timeout do not
  // re-trigger the effect. A build that finishes after its effect run was cleaned up is
  // discarded, so a slow, stale build can never overwrite a newer preview.
  $effect(() => {
    const block = previewBlock;
    void settings;
    // Full-list warnings describe the last export; any change makes them stale.
    const template = mergeTemplate;
    const ds = listMode ? dataset : null;
    const rows = included;
    listWarnings = { rows: [], chars: [] };
    if (!block) {
      pdfBytes = null;
      drawn = false;
      warnings = [];
      returnReplaced = [];
      error = '';
      building = false;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (ds) {
        // One pass over every included row, on a plain copy so rendering skips the state proxy.
        const plain = $state.snapshot(template) as RichText;
        mergeStats = {
          skipped: rows.length - mergeRows(ds, rows, plain).blocks.length,
          unknown: unknownTokens(plain, ds.columns.map((c) => c.name)),
        };
      }
      if (!block) return;
      error = '';
      building = true;
      try {
        const result = await buildEnvelopePdf([block], settings, fonts);
        if (cancelled) return;
        warnings = result.warnings;
        returnReplaced = result.returnReplaced;
        pdfBytes = result.bytes;
      } catch (err) {
        if (!cancelled) error = errorMessage(err);
      } finally {
        if (!cancelled) building = false;
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  });

  // Track the stage width. The first measurement is immediate; later ones are debounced.
  $effect(() => {
    if (!panel || !stage) return;
    const el = stage;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const measure = () => {
      stageWidth = el.clientWidth;
    };
    const observer = new ResizeObserver(() => {
      if (untrack(() => stageWidth) === 0) return measure();
      clearTimeout(timer);
      timer = setTimeout(measure, 100);
    });
    observer.observe(panel);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  });

  // Draw the latest bytes whenever they or the available width change. A newer
  // render on the same canvas cancels the older one inside renderPdfPageToCanvas,
  // and a result for a cleaned-up run is ignored, so stale bytes are never drawn.
  $effect(() => {
    const bytes = pdfBytes;
    const width = stageWidth;
    const el = canvas;
    if (!bytes || !el || width <= 0) {
      rendering = false;
      return;
    }
    let stale = false;
    rendering = true;
    // The canvas has a 1px border on each side.
    renderPdfPageToCanvas(bytes, el, { maxWidthPx: width - 2 })
      .then(() => {
        if (!stale) drawn = true;
      })
      .catch((err) => {
        if (!stale && !isRenderCancelled(err)) error = errorMessage(err);
      })
      .finally(() => {
        if (!stale) rendering = false;
      });
    return () => {
      stale = true;
    };
  });

  // Release blob URLs when the component goes away.
  $effect(() => () => {
    if (lastPrintUrl) URL.revokeObjectURL(lastPrintUrl);
    for (const url of downloadUrls) URL.revokeObjectURL(url);
    downloadUrls.clear();
  });

  async function download() {
    let bytes = pdfBytes;
    if (listMode) {
      if (!canPrint || exporting) return;
      exporting = true;
      error = '';
      try {
        bytes = (await build()).bytes;
      } catch (err) {
        error = errorMessage(err);
        return;
      } finally {
        exporting = false;
      }
    }
    if (!bytes) return;
    const url = pdfUrl(bytes);
    downloadUrls.add(url);
    const a = document.createElement('a');
    a.href = url;
    a.download = listMode ? 'envelopes.pdf' : 'envelope.pdf';
    a.click();
    // The browser reads the blob asynchronously; release it once the download has started.
    setTimeout(() => {
      URL.revokeObjectURL(url);
      downloadUrls.delete(url);
    }, 30_000);
  }

  async function print() {
    if (!canPrint || exporting) return;
    if (lastPrintUrl) {
      URL.revokeObjectURL(lastPrintUrl);
      lastPrintUrl = '';
    }
    exporting = listMode;
    try {
      error = '';
      const url = pdfUrl((await build()).bytes);
      const win = window.open(url, '_blank');
      if (!win) {
        URL.revokeObjectURL(url);
        error = 'Your browser blocked the new tab. Allow pop-ups for this site and try again.';
      } else {
        // The new tab still needs the URL; it is revoked on the next print or on unmount.
        lastPrintUrl = url;
      }
    } catch (err) {
      error = errorMessage(err);
    } finally {
      exporting = false;
    }
  }

  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
</script>

<svelte:window onkeydown={onRecordKeys} />

<div class="workspace">
<!-- Envelope size spans the full width above the form and the preview. -->
<div class="card size-card rise" style="--i: 1">
  <SizePicker {settings} onchange={onsettings} />
</div>

<!-- What we're printing: one envelope, or one per row of a list. Spans both cards so From and To stay alike. -->
<div class="mode-bar rise" style="--i: 2">
  <div class="segmented mode" role="group" aria-label="What to print">
    <button type="button" aria-pressed={toMode === 'single'} onclick={() => (toMode = 'single')}>
      <User size={16} aria-hidden="true" />One envelope
    </button>
    <button type="button" aria-pressed={toMode === 'list'} onclick={chooseListMode}>
      <Table size={16} aria-hidden="true" />Many from a list
    </button>
  </div>
  {#if listMode}
    <!-- The list summary is one pill button that opens the list dialog, plus a small remove button. -->
    <div class="list-chip-row">
      <button type="button" class="list-chip" aria-haspopup="dialog" bind:this={stripEdit}
        title={dataset ? 'Edit list' : 'Load list'} onclick={(e) => listDialog?.open(e.currentTarget)}>
        <Table size={16} aria-hidden="true" />
        {#if dataset}
          <span class="chip-name">{dataset.sourceName}</span>
          <span class="chip-count"><span aria-hidden="true">·</span><span class="sr-only">,</span> {listSummary}<span class="chip-included">{' included'}</span></span>
          <Pencil size={14} aria-hidden="true" class="chip-edit" />
          <span class="sr-only">. Edit list</span>
        {:else}
          Load list
        {/if}
      </button>
      {#if dataset}
        <button type="button" class="chip-remove" aria-label="Remove list" title="Remove list" onclick={removeList}>
          <X size={16} aria-hidden="true" />
        </button>
      {/if}
    </div>
  {/if}
</div>

<section class="quick">
  <div class="preview rise" style="--i: 2" bind:this={panel}>
    <div class="preview-head">
      <div class="title-line">
        <Eye size={20} aria-hidden="true" />
        <h2 class="card-title">Preview</h2>
      </div>
      {#if building || rendering}<p class="updating" aria-live="polite"><LoaderCircle class="spin" size={18} aria-hidden="true" /><span class="updating-label">Updating preview…</span></p>{/if}
      {#if listMode && included.length > 0}
        <span class="record-caption muted" title={currentCaption}>{currentCaption}</span>
      {/if}
    </div>
    <!-- The stage reserves the envelope's shape so the panel does not jump between renders. -->
    <!-- In list mode the preview is a keyboard-navigable carousel of records (arrow keys), so it takes focus. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="stage" bind:this={stage} style:aspect-ratio={`${size.widthIn} / ${size.heightIn}`}
      role={listMode && included.length > 0 ? 'region' : undefined}
      aria-roledescription={listMode && included.length > 0 ? 'carousel' : undefined}
      tabindex={listMode && included.length > 0 ? 0 : undefined}
      aria-label={listMode && included.length > 0 ? 'Envelope preview. Use the left and right arrow keys to move through records.' : undefined}>
      {#if pdfBytes}
        <!-- ARIA allows any role on <canvas>; Svelte's rule treats it as interactive, which it is not here. -->
        <!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
        <canvas bind:this={canvas} class:drawn role="img" aria-label="Envelope preview"></canvas>
      {:else}
        <div class="blank">
          <Mail class="blank-icon" size={48} strokeWidth={1.25} aria-hidden="true" />
          <p>{blankMessage}</p>
        </div>
      {/if}
    </div>
    <!-- Action bar: messages above, Download then Print (primary at the far right). -->
    <div class="action-bar">
      {#if error}<p class="error message status-line" role="alert"><CircleAlert size={18} aria-hidden="true" /><span>{error}</span></p>{/if}
      {#if returnReplaced.length > 0}
        <p class="muted message status-line" aria-live="polite"><TriangleAlert size={18} aria-hidden="true" /><span>Some characters in the From address are not supported and were replaced with "?": {returnReplaced.join(' ')}</span></p>
      {/if}
      {#if listMode}
        {#if settings.showRecipient && listWarnings.rows.length > 0}
          <p class="muted message status-line" aria-live="polite"><TriangleAlert size={18} aria-hidden="true" /><span>Some characters in the To address are not supported and were replaced with "?" in {listWarnings.rows.length === 1 ? 'row' : 'rows'} {listWarnings.rows.join(', ')}: {listWarnings.chars.join(' ')}</span></p>
        {:else if settings.showRecipient && warnings.length > 0}
          <p class="muted message status-line" aria-live="polite"><TriangleAlert size={18} aria-hidden="true" /><span>Some characters in row {currentRow + 1} are not supported and were replaced with "?": {warnings[0].replaced.join(' ')}</span></p>
        {/if}
        {#if dataset && settings.showRecipient}
          {#if mergeStats.unknown.length > 0}
            <p class="muted message status-line"><TriangleAlert size={18} aria-hidden="true" /><span>{mergeStats.unknown.length === 1 ? 'This field isn’t' : 'These fields aren’t'} in your list and will print blank: {mergeStats.unknown.map((u) => `{{${u}}}`).join(', ')}</span></p>
          {/if}
          {#if included.length === 0}
            <p class="muted message status-line"><Info size={18} aria-hidden="true" /><span>No rows included.</span></p>
          {:else if mergeStats.skipped > 0}
            <p class="muted message status-line"><Info size={18} aria-hidden="true" /><span>{plural(mergeStats.skipped, 'row', 'rows')} skipped: no address</span></p>
          {/if}
          {#if included.length > LARGE_LIST}
            <p class="muted message status-line"><Info size={18} aria-hidden="true" /><span>{plural(included.length, 'row', 'rows')} included. Making the PDF may take a while.</span></p>
          {/if}
        {/if}
      {:else if settings.showRecipient && warnings.length > 0}
        <p class="muted message status-line" aria-live="polite"><TriangleAlert size={18} aria-hidden="true" /><span>Some characters in the To address are not supported and were replaced with "?": {warnings[0].replaced.join(' ')}</span></p>
      {/if}
      <div class="actions">
        {#if listMode && included.length > 0}
          <div class="stepper" role="group" aria-label="Preview record">
            <button type="button" class="step" aria-label="Previous record" title="Previous record (←)" disabled={index === 0}
              onclick={() => stepRecord(-1)}><ChevronLeft size={18} aria-hidden="true" /></button>
            <button type="button" class="step" aria-label="Next record" title="Next record (→)" disabled={index >= included.length - 1}
              onclick={() => stepRecord(1)}><ChevronRight size={18} aria-hidden="true" /></button>
            <span class="sr-only" aria-live="polite">Record {index + 1} of {included.length}</span>
          </div>
        {/if}
        <button class="btn btn-secondary btn-download" type="button" aria-label={listMode && dataset ? `Download PDF (${printCount})` : 'Download PDF'}
          disabled={listMode ? !canPrint || exporting : !pdfBytes} onclick={download}>
          <Download size={20} aria-hidden="true" />
          <span class="btn-label">{listMode && dataset ? `Download PDF (${printCount})` : 'Download PDF'}</span>
        </button>
        <!-- Outside the form, so it submits it through the form attribute. -->
        <button class="btn btn-primary" type="submit" form="envelope-form" disabled={!canPrint || exporting}>
          {#if exporting}<LoaderCircle class="spin" size={20} aria-hidden="true" />{:else}<Printer size={20} aria-hidden="true" />{/if}
          <span class="btn-label">{listMode ? (dataset ? `Print ${plural(printCount, 'envelope', 'envelopes')}` : 'Print envelopes') : 'Print envelope'}</span>
          <span class="btn-label-short" aria-hidden="true">{listMode && dataset ? `Print ${printCount}` : 'Print'}</span>
        </button>
      </div>
    </div>
  </div>

  <form class="form" class:list={listMode} id="envelope-form" onsubmit={(e) => { e.preventDefault(); print(); }}>
    <section class="card rise" style="--i: 3" aria-labelledby="from-title" data-ph-capture-attribute-block="from">
      <div class="card-head with-helper">
        <House size={20} aria-hidden="true" class="head-icon" />
        <div class="title-line">
          <h2 id="from-title" class="card-title">From</h2>
          <span class="print-toggle">
            <span class="print-caption" aria-hidden="true">Print</span>
            <button type="button" class="switch" role="switch" aria-label="Print From address" aria-checked={settings.showReturn}
              onclick={() => update('showReturn', !settings.showReturn)}>
              <span class="sr-only">Print From address</span>
            </button>
          </span>
        </div>
        <p class="helper">Your return address</p>
      </div>
      {#if !settings.showReturn}<p class="muted off-note">This address won't print until you turn <strong>Print</strong> on.</p>{/if}
      <div class="card-body" class:off={!settings.showReturn}>
        <AddressEditor label="From: return address" value={settings.returnAddress}
          onchange={(rich) => update('returnAddress', rich)}
          layout={settings.returnLayout} onlayout={(l) => update('returnLayout', l)}
          {fonts}
          placeholder={'First Church\n1 Chapel Rd\nSpringfield, IL 62701'} />
        <details class="layout">
          <summary>
            <Move size={20} aria-hidden="true" />
            <span class="summary-title">Position</span>
            <span class="summary-hint">Where the address sits</span>
            <span class="chevron"><ChevronDown size={20} aria-hidden="true" /></span>
          </summary>
          <div class="layout-body">
            {#if !settings.showReturn}<p class="muted note">Turn on printing for this address to edit its position.</p>{/if}
            <BlockLayoutEditor title="Position" layout={settings.returnLayout}
              disabled={!settings.showReturn} onchange={(l) => update('returnLayout', l)} />
          </div>
        </details>
      </div>
    </section>

    <section class="card to-card rise" style="--i: 4" aria-labelledby="to-title" data-ph-capture-attribute-block="to">
      <div class="card-head with-helper">
        <Send size={20} aria-hidden="true" class="head-icon" />
        <div class="title-line">
          <h2 id="to-title" class="card-title">To</h2>
          <span class="print-toggle">
            <span class="print-caption" aria-hidden="true">Print</span>
            <button type="button" class="switch" role="switch" aria-label="Print To address" aria-checked={settings.showRecipient}
              onclick={() => update('showRecipient', !settings.showRecipient)}>
              <span class="sr-only">Print To address</span>
            </button>
          </span>
        </div>
        <p class="helper">{listMode ? 'One envelope per row of your list' : "Who you're sending to"}</p>
      </div>
      <!-- Mode tabs: a full-width row under the header, so the title row stays as light as From's. -->
      {#if !settings.showRecipient}<p class="muted off-note">This address won't print until you turn <strong>Print</strong> on.</p>{/if}
      <div class="card-body" class:off={!settings.showRecipient}>
        {#if listMode}
          <AddressEditor label="To: address template" value={mergeTemplate}
            onchange={onmergetemplate} fields={fieldNames}
            layout={settings.recipientLayout} onlayout={(l) => update('recipientLayout', l)}
            {fonts}
            placeholder={'{{Name}}\n{{Address}}\n{{City}}, {{State}} {{Zip}}'} />
        {:else}
          <AddressEditor label="To: recipient address" value={recipient}
            onchange={(rich) => (recipient = rich)}
            layout={settings.recipientLayout} onlayout={(l) => update('recipientLayout', l)}
            {fonts}
            placeholder={'Jane Doe\n123 Main St\nSpringfield, IL 62701'} />
        {/if}
        <details class="layout">
          <summary>
            <Move size={20} aria-hidden="true" />
            <span class="summary-title">Position</span>
            <span class="summary-hint">Where the address sits</span>
            <span class="chevron"><ChevronDown size={20} aria-hidden="true" /></span>
          </summary>
          <div class="layout-body">
            {#if !settings.showRecipient}<p class="muted note">Turn on printing for this address to edit its position.</p>{/if}
            <BlockLayoutEditor title="Position" layout={settings.recipientLayout}
              disabled={!settings.showRecipient} onchange={(l) => update('recipientLayout', l)} />
          </div>
        </details>
      </div>
    </section>

  </form>
</section>
</div>

<!-- Outside the form, so Enter in the list's controls never submits it (which prints). -->
<ListDialog bind:this={listDialog} {dataset} onchange={onDataset} />

<style>
  /*
   * Three tiers. The DOM order is size, preview, form (From, To), which is the
   * visual order at medium and narrow widths. At wide widths the form sits left
   * of the preview, and reading-flow (in app.css) makes focus follow the columns.
   */
  .workspace { display: grid; gap: 20px; min-width: 0; }
  .quick { display: grid; grid-template-columns: minmax(0, 1fr); gap: 20px; align-items: start; }
  .form { display: grid; gap: 20px; min-width: 0; align-items: start; }

  .card {
    display: grid;
    gap: 16px;
    min-width: 0;
    padding: var(--pad);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    box-shadow: var(--shadow-card);
    transition: box-shadow 120ms ease;
  }
  .card:hover { box-shadow: var(--shadow-card-hover); }
  .card-head { display: grid; gap: 2px; }
  /* Icon spans the title and helper rows and sits at their vertical center. */
  .card-head.with-helper { grid-template-columns: 20px 1fr; column-gap: 10px; row-gap: 0; align-items: center; }
  .card-head.with-helper :global(.head-icon) { grid-row: 1 / span 2; color: var(--muted); }
  .card-head.with-helper .title-line, .card-head.with-helper .helper { grid-column: 2; }
  .helper { margin: 0; font-size: 14px; line-height: 1.3; color: var(--muted); }

  .card, .preview { --pad: 20px; }
  /* Editor and Position share the card's spacing; a block that won't print is faded but stays editable. */
  .card-body { display: grid; gap: 16px; min-width: 0; transition: opacity 120ms ease; }
  .card-body.off { opacity: 0.6; }
  .off-note { margin: 0; font-size: 14px; }
  .off-note strong { font-weight: 600; color: var(--text); }

  /* List strip: icon, source · count, then Edit list and Remove, on one line at desktop. */
  /* List chip: same 36px height as the mode control, so the bar reads as one row. */
  .list-chip-row { display: inline-flex; align-items: center; gap: 4px; margin-left: auto; min-width: 0; }
  .list-chip {
    display: inline-flex; align-items: center; gap: 8px; min-height: 40px; max-width: min(100%, 420px);
    padding: 0 12px 0 10px; border-radius: 999px; font-size: 14px; font-weight: 500;
  }
  .list-chip > :global(.lucide) { color: var(--muted); flex: none; }
  .chip-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
  .chip-count { white-space: nowrap; color: var(--muted); font-weight: 500; }
  .list-chip :global(.chip-edit) { margin-left: 2px; }
  .chip-remove { width: 40px; min-height: 40px; padding: 0; border-color: transparent; background: transparent; color: var(--muted); border-radius: 999px; }
  .chip-remove:hover:not(:disabled) { background: var(--hover); color: var(--text); border-color: transparent; }

  /* Print switch at the right edge of the card header, centered on the title. */
  .print-toggle { display: inline-flex; align-items: center; gap: 10px; margin-left: auto; }
  /* To header: the Single | From a list toggle sits left of Print and wraps under the title when narrow. */
  /* Mode bar above the cards: the choice on the left, the list summary on the right. */
  .mode-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px 16px; min-width: 0; }
  .segmented.mode { padding: 3px; gap: 3px; }
  .segmented.mode button { min-height: 32px; padding: 0 14px; gap: 8px; font-size: 14px; }
  .print-caption { font-size: 14px; font-weight: 500; color: var(--muted); }
  .switch {
    position: relative;
    flex: none;
    width: 44px;
    min-height: 0;
    height: 26px;
    padding: 0;
    border: 0;
    border-radius: 9999px;
    background: var(--line-control);
    transition: background-color 120ms ease;
  }
  .switch:hover:not(:disabled) { background: var(--muted); border: 0; }
  .switch::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: #ffffff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
    transition: transform 120ms ease;
  }
  .switch[aria-checked='true'],
  .switch[aria-checked='true']:hover:not(:disabled) { background: var(--coral); }
  .switch[aria-checked='true']::after { transform: translateX(18px); }

  /* Position disclosure: a quiet 48px row with a chevron. */
  .layout { margin: 0 calc(-1 * var(--pad)) calc(-1 * var(--pad)); border-top: 1px solid var(--divider); }
  .layout summary {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 48px;
    padding: 0 var(--pad);
    list-style: none;
    cursor: pointer;
    border-radius: 0 0 var(--radius) var(--radius);
    transition: background-color 120ms ease;
  }
  .layout summary::-webkit-details-marker { display: none; }
  .layout summary:hover { background: var(--hover); }
  .layout summary:focus-visible { outline-offset: -2px; }
  .stage:focus-visible { outline: 2px solid var(--text); outline-offset: 4px; border-radius: 6px; }
  .layout[open] summary { border-radius: 0; }
  .layout summary :global(.lucide-move) { color: var(--text-soft); }
  .summary-title { font-size: 15px; font-weight: 600; }
  .summary-hint { color: var(--muted); font-size: 14px; }
  .chevron { display: inline-flex; margin-left: auto; transition: transform 120ms ease; }
  .layout[open] .chevron { transform: rotate(180deg); }
  .layout-body { padding: 8px var(--pad) var(--pad); }
  .note { margin: 0 0 16px; font-size: 14px; }

  .action-bar { display: grid; gap: 12px; padding-top: 4px; }
  .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 12px; }
  .btn-label-short { display: none; }
  /* Record stepper sits at the bottom left, opposite the primary actions. */
  .actions .stepper { margin-right: auto; }
  .message { margin: 0; font-size: 14px; }
  .message :global(.lucide-triangle-alert) { color: #b4690e; }
  :global(:root[data-theme='dark']) .message :global(.lucide-triangle-alert) { color: #f5b25b; }

  /* Preview panel. */
  .preview {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
    min-width: 0;
    overflow: hidden;
    padding: var(--pad);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-float);
  }
  /*
   * One row, always: the updating note comes and goes on every keystroke and record step, so a
   * wrapping header would push the envelope down and back. The record caption truncates instead.
   */
  .preview-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 24px; min-width: 0; }
  .preview-head > .title-line { flex: none; }
  .updating { flex: none; margin: 0; display: inline-flex; align-items: center; gap: 8px; font-size: 14px; color: var(--muted); }
  /* Current record's caption at the header's right edge. */
  .record-caption { margin-left: auto; min-width: 0; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
  .stepper { display: inline-flex; align-items: center; gap: 4px; flex: none; }
  .step { width: 36px; min-height: 36px; padding: 0; }
  .message :global(.lucide-info) { color: var(--muted); }

  /* The envelope scales with the card but stops at 720px wide so a #10 never gets too tall. */
  .stage { display: grid; place-items: center; width: 100%; max-width: 720px; justify-self: center; min-width: 0; }
  canvas, .blank {
    border: 1px solid var(--divider);
    border-radius: var(--radius-sm);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  }
  canvas {
    display: block;
    /* The inline size set by the renderer is the bitmap's CSS size; the border sits outside it. */
    box-sizing: content-box;
    max-width: calc(100% - 2px);
    /* Follow the bitmap's aspect when the stage narrows before the next render. */
    height: auto !important;
    background: white;
    visibility: hidden;
  }
  canvas.drawn { visibility: visible; }
  .blank {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 24px;
    background: var(--subtle);
  }
  .blank :global(.blank-icon) { color: var(--muted); opacity: 0.7; }
  .blank p { margin: 0; max-width: 28ch; text-align: center; font-size: 15px; color: var(--muted); }

  /* Medium: preview full width on top, From and To side by side below it. */
  @media (min-width: 760px) and (max-width: 1179px) {
    .form { grid-template-columns: 1fr 1fr; gap: 24px; }
  }
  /* Wide: form left, a larger sticky preview right. */
  @media (min-width: 1180px) {
    .quick {
      grid-template-columns: minmax(380px, 5fr) minmax(520px, 7fr);
      gap: 32px;
    }
    .preview { grid-column: 2; grid-row: 1; position: sticky; top: 24px; }
    .form { grid-column: 1; grid-row: 1; }
    .card, .preview { --pad: 24px; }
  }
  @media (max-width: 759px) {
    .summary-hint { display: none; }
    /* Phone: buttons share one row. Download is icon-only; Print takes the rest and may truncate. */
    .actions { flex-wrap: nowrap; gap: 8px; min-width: 0; }
    .actions > * { min-width: 0; }
    .actions .stepper { flex: none; gap: 4px; margin-right: auto; }
    .actions .btn-download { flex: none; width: 44px; padding: 0; justify-content: center; }
    .actions .btn-download .btn-label { display: none; }
    .actions .btn-primary { flex: 1 1 0; min-width: 0; padding: 0 16px; }
    .actions .btn-primary .btn-label { display: none; }
    .actions .btn-primary .btn-label-short { display: inline; white-space: nowrap; }
    /*
     * Phone: the mode choice stretches full width; the list chip gets its own row. The bar must be
     * single-line: a wrapping column flexbox sizes its line to the widest child, so a long chip
     * would push both rows past the screen instead of truncating the list name.
     */
    .mode-bar { flex-direction: column; flex-wrap: nowrap; align-items: stretch; }
    .segmented.mode { display: grid; grid-template-columns: 1fr 1fr; }
    .segmented.mode button { justify-content: center; }
    .list-chip-row { margin-left: 0; }
    .list-chip { flex: 1 1 auto; min-width: 0; max-width: none; justify-content: center; }
  }
  @media (max-width: 480px) {
    .print-caption { display: none; }
    /* Phone: the updating note is just the spinner; screen readers still hear the text. */
    .updating-label { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    /* Tighter mode buttons so "Many from a list" stays on one line down to 320px. */
    .segmented.mode button { gap: 6px; padding: 0 6px; }
    /* Phone: the chip reads "3 of 3 rows" so the list name keeps its room; screen readers still hear "included". */
    .chip-included { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  }
</style>
