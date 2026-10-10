<script lang="ts">
  import { untrack } from 'svelte';
  import { resolveEnvelopeSize } from '../lib/envelopes/sizes';
  import { buildEnvelopePdf, type EnvelopeSettings, type EnvelopeWarning } from '../lib/envelopes/build';
  import { isRichEmpty, type RichText } from '../lib/richtext';
  import { createBrowserFontProvider } from '../lib/fonts/loader';
  import { renderPdfPageToCanvas, isRenderCancelled } from '../lib/pdf/preview';
  import { errorMessage } from '../lib/errors';
  import { includedCount, recordFromRow, type Dataset } from '../lib/merge/import';
  import { renameTokens, renderTemplate, unknownTokens } from '../lib/merge/render';
  import DataPanel from './DataPanel.svelte';
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
  // Blob URLs handed to print tabs and downloads. Not reactive: only used for cleanup.
  let lastPrintUrl = '';
  const downloadUrls = new Set<string>();

  const listMode = $derived(toMode === 'list');
  /** Dataset row indexes that are included, in order. */
  const included = $derived(dataset ? dataset.included.flatMap((on, i) => (on ? [i] : [])) : []);
  const index = $derived(Math.min(current, Math.max(0, included.length - 1)));
  /**
   * One rendered To block per included row, minus rows whose block is empty. `rows[i]` is the
   * dataset row of `blocks[i]`.
   */
  const merged = $derived.by(() => {
    const blocks: RichText[] = [];
    const rows: number[] = [];
    if (!dataset) return { blocks, rows, skipped: 0 };
    for (const r of included) {
      const block = renderTemplate(mergeTemplate, recordFromRow(dataset, r));
      if (isRichEmpty(block)) continue;
      blocks.push(block);
      rows.push(r);
    }
    return { blocks, rows, skipped: included.length - blocks.length };
  });
  const currentRow = $derived(included.length > 0 ? included[index] : -1);
  const currentBlock = $derived(
    dataset && currentRow >= 0 ? renderTemplate(mergeTemplate, recordFromRow(dataset, currentRow)) : null,
  );
  const currentCaption = $derived(
    dataset && currentRow >= 0 ? (dataset.rows[currentRow][0] || `Row ${currentRow + 1}`) : '',
  );
  const unknown = $derived(dataset ? unknownTokens(mergeTemplate, dataset.columns.map((c) => c.name)) : []);
  const fieldNames = $derived(dataset ? dataset.columns.map((c) => c.name) : []);

  const hasReturn = $derived(settings.showReturn && !isRichEmpty(settings.returnAddress));
  // Something prints when either enabled block has text.
  const canPrint = $derived(
    listMode
      ? merged.blocks.length > 0 && (settings.showRecipient || hasReturn)
      : (settings.showRecipient && !isRichEmpty(recipient)) || hasReturn,
  );
  /** What the preview draws: the single recipient, or the current record. Null when nothing prints. */
  const previewBlock = $derived(
    listMode
      ? currentBlock && ((settings.showRecipient && !isRichEmpty(currentBlock)) || hasReturn) ? currentBlock : null
      : canPrint ? recipient : null,
  );
  const printCount = $derived(merged.blocks.length);
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

  /** Build the PDF for the current inputs: one page, or in list mode one page per included row. */
  async function build() {
    if (!listMode) return buildEnvelopePdf([recipient], settings, fonts);
    const { blocks, rows } = merged;
    const result = await buildEnvelopePdf(blocks, settings, fonts);
    const chars = new Set<string>();
    for (const w of result.warnings) for (const c of w.replaced) chars.add(c);
    listWarnings = { rows: result.warnings.map((w) => rows[w.block] + 1), chars: [...chars] };
    return result;
  }

  /**
   * A new list. A column rename (same source, same shape) rewrites matching template tokens so
   * they follow the column.
   */
  function onDataset(next: Dataset | null) {
    const prev = dataset;
    if (prev && next && next.source === prev.source && next.headerRow === prev.headerRow
      && next.transposed === prev.transposed && next.columns.length === prev.columns.length) {
      let template = mergeTemplate;
      next.columns.forEach((col, i) => {
        const old = prev.columns[i];
        if (old.id === col.id && old.name !== col.name) template = renameTokens(template, old.name, col.name);
      });
      if (template !== mergeTemplate) onmergetemplate(template);
    } else {
      current = 0;
    }
    dataset = next;
  }

  function stepRecord(delta: number) {
    if (included.length === 0) return;
    current = Math.min(included.length - 1, Math.max(0, index + delta));
  }

  function pdfUrl(bytes: Uint8Array): string {
    return URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  }

  // Debounced live preview. Only the synchronous reads of canPrint, recipient,
  // and settings are tracked; writes inside the timeout do not re-trigger the effect.
  // A build that finishes after its effect run was cleaned up is discarded, so a
  // slow, stale build can never overwrite a newer preview.
  $effect(() => {
    const block = previewBlock;
    void settings;
    // Full-list warnings describe the last export; any change makes them stale.
    void mergeTemplate;
    void dataset;
    listWarnings = { rows: [], chars: [] };
    if (!block) {
      pdfBytes = null;
      drawn = false;
      warnings = [];
      returnReplaced = [];
      error = '';
      building = false;
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
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

<div class="workspace">
<!-- Envelope size spans the full width above the form and the preview. -->
<div class="card size-card rise" style="--i: 1">
  <SizePicker {settings} onchange={onsettings} />
</div>

<section class="quick">
  <div class="preview rise" style="--i: 2" bind:this={panel}>
    <div class="preview-head">
      <div class="title-line">
        <Eye size={20} aria-hidden="true" />
        <h2 class="card-title">Preview</h2>
      </div>
      {#if building || rendering}<p class="updating" aria-live="polite"><LoaderCircle class="spin" size={18} aria-hidden="true" />Updating preview…</p>{/if}
      {#if listMode && included.length > 0}
        <div class="record-nav">
          <span class="record-caption muted" title={currentCaption}>{currentCaption}</span>
          <div class="stepper" role="group" aria-label="Preview record">
            <button type="button" class="step" aria-label="Previous record" disabled={index === 0}
              onclick={() => stepRecord(-1)}><ChevronLeft size={18} aria-hidden="true" /></button>
            <span class="record-pos" aria-live="polite"><span class="sr-only">Record </span>{index + 1} / {included.length}</span>
            <button type="button" class="step" aria-label="Next record" disabled={index >= included.length - 1}
              onclick={() => stepRecord(1)}><ChevronRight size={18} aria-hidden="true" /></button>
          </div>
        </div>
      {/if}
    </div>
    <!-- The stage reserves the envelope's shape so the panel does not jump between renders. -->
    <div class="stage" bind:this={stage} style:aspect-ratio={`${size.widthIn} / ${size.heightIn}`}>
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
          {#if unknown.length > 0}
            <p class="muted message status-line"><TriangleAlert size={18} aria-hidden="true" /><span>{unknown.length === 1 ? 'This field isn’t' : 'These fields aren’t'} in your list and will print blank: {unknown.map((u) => `{{${u}}}`).join(', ')}</span></p>
          {/if}
          {#if included.length === 0}
            <p class="muted message status-line"><Info size={18} aria-hidden="true" /><span>No rows included.</span></p>
          {:else if merged.skipped > 0}
            <p class="muted message status-line"><Info size={18} aria-hidden="true" /><span>{plural(merged.skipped, 'row', 'rows')} skipped: no address</span></p>
          {/if}
          {#if included.length > LARGE_LIST}
            <p class="muted message status-line"><Info size={18} aria-hidden="true" /><span>{plural(included.length, 'row', 'rows')} included. Making the PDF may take a while.</span></p>
          {/if}
        {/if}
      {:else if settings.showRecipient && warnings.length > 0}
        <p class="muted message status-line" aria-live="polite"><TriangleAlert size={18} aria-hidden="true" /><span>Some characters in the To address are not supported and were replaced with "?": {warnings[0].replaced.join(' ')}</span></p>
      {/if}
      <div class="actions">
        <button class="btn btn-secondary" type="button" disabled={listMode ? !canPrint || exporting : !pdfBytes} onclick={download}>
          <Download size={20} aria-hidden="true" />
          {listMode && dataset ? `Download PDF (${printCount})` : 'Download PDF'}
        </button>
        <!-- Outside the form, so it submits it through the form attribute. -->
        <button class="btn btn-primary" type="submit" form="envelope-form" disabled={!canPrint || exporting}>
          {#if exporting}<LoaderCircle class="spin" size={20} aria-hidden="true" />{:else}<Printer size={20} aria-hidden="true" />{/if}
          {listMode ? (dataset ? `Print ${plural(printCount, 'envelope', 'envelopes')}` : 'Print envelopes') : 'Print envelope'}
        </button>
      </div>
    </div>
  </div>

  <form class="form" class:list={listMode} id="envelope-form" onsubmit={(e) => { e.preventDefault(); print(); }}>
    <section class="card rise" style="--i: 2" aria-labelledby="from-title" data-ph-capture-attribute-block="from">
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

    <section class="card to-card rise" style="--i: 3" aria-labelledby="to-title" data-ph-capture-attribute-block="to">
      <div class="card-head with-helper">
        <Send size={20} aria-hidden="true" class="head-icon" />
        <div class="title-line to-line">
          <h2 id="to-title" class="card-title">To</h2>
          <div class="segmented mode" role="group" aria-label="Send to">
            <button type="button" aria-pressed={toMode === 'single'} onclick={() => (toMode = 'single')}>
              <User size={16} aria-hidden="true" />Single
            </button>
            <button type="button" aria-pressed={toMode === 'list'} onclick={() => (toMode = 'list')}>
              <Table size={16} aria-hidden="true" />From a list
            </button>
          </div>
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
      {#if !settings.showRecipient}<p class="muted off-note">This address won't print until you turn <strong>Print</strong> on.</p>{/if}
      <div class="card-body" class:off={!settings.showRecipient}>
        {#if listMode}
          <DataPanel {dataset} onchange={onDataset} />
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

  /* Print switch at the right edge of the card header, centered on the title. */
  .print-toggle { display: inline-flex; align-items: center; gap: 10px; margin-left: auto; }
  /* To header: the Single | From a list toggle sits left of Print and wraps under the title when narrow. */
  .to-line { flex-wrap: wrap; row-gap: 8px; }
  .mode { margin-left: auto; }
  .mode + .print-toggle { margin-left: 6px; }
  .segmented.mode { padding: 2px; gap: 2px; }
  .segmented.mode button { min-height: 30px; padding: 0 12px; gap: 6px; font-size: 13px; }
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
  .layout[open] summary { border-radius: 0; }
  .layout summary :global(.lucide-move) { color: var(--text-soft); }
  .summary-title { font-size: 15px; font-weight: 600; }
  .summary-hint { color: var(--muted); font-size: 14px; }
  .chevron { display: inline-flex; margin-left: auto; transition: transform 120ms ease; }
  .layout[open] .chevron { transform: rotate(180deg); }
  .layout-body { padding: 8px var(--pad) var(--pad); }
  .note { margin: 0 0 16px; font-size: 14px; }

  .action-bar { display: grid; gap: 12px; padding-top: 4px; }
  .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 12px; }
  .message { margin: 0; font-size: 14px; }
  .message :global(.lucide-triangle-alert) { color: #b4690e; }
  :global(:root[data-theme='dark']) .message :global(.lucide-triangle-alert) { color: #f5b25b; }

  /* Preview panel. */
  .preview {
    display: grid;
    gap: 16px;
    min-width: 0;
    padding: var(--pad);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-float);
  }
  .preview-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 24px; }
  .preview-head { flex-wrap: wrap; row-gap: 8px; }
  .updating { margin: 0; display: inline-flex; align-items: center; gap: 8px; font-size: 14px; color: var(--muted); }
  /* Record stepper: caption, then ‹ 3 / 42 ›, at the header's right edge. */
  .record-nav { display: flex; align-items: center; gap: 10px; min-width: 0; margin-left: auto; }
  .record-caption { min-width: 0; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
  .stepper { display: inline-flex; align-items: center; gap: 4px; flex: none; }
  .step { width: 36px; min-height: 36px; padding: 0; }
  .record-pos { min-width: 5ch; text-align: center; font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; }
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
    /* The list needs room: in list mode To takes the full width under From. */
    .form.list .to-card { grid-column: 1 / -1; }
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
    .actions .btn { flex: 1 1 140px; }
  }
  @media (max-width: 480px) {
    .print-caption { display: none; }
    /* The mode toggle drops to its own row under the title; Print stays beside the title. */
    .to-line h2 { flex: 1; }
    .mode { order: 3; margin-left: 0; }
    /* The header is taller now; keep the icon level with the title. */
    .to-card .card-head.with-helper :global(.head-icon) { align-self: start; margin-top: 3px; }
    .mode + .print-toggle { margin-left: auto; }
    .record-nav { margin-left: 0; width: 100%; justify-content: space-between; }
  }
</style>
