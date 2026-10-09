<script lang="ts">
  import { untrack } from 'svelte';
  import { resolveEnvelopeSize } from '../lib/envelopes/sizes';
  import { buildEnvelopePdf, type EnvelopeSettings, type EnvelopeWarning } from '../lib/envelopes/build';
  import { isRichEmpty, type RichText } from '../lib/richtext';
  import { createBrowserFontProvider } from '../lib/fonts/loader';
  import { renderPdfPageToCanvas, isRenderCancelled } from '../lib/pdf/preview';
  import { errorMessage } from '../lib/errors';
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

  let { settings, onsettings }: {
    settings: EnvelopeSettings;
    onsettings: (s: EnvelopeSettings) => void;
  } = $props();

  // Recipient lives only for this session (spec: never persisted).
  let recipient = $state.raw<RichText>({ lines: [] });
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

  // Something prints when either enabled block has text.
  const canPrint = $derived(
    (settings.showRecipient && !isRichEmpty(recipient)) || (settings.showReturn && !isRichEmpty(settings.returnAddress)),
  );
  const blankMessage = $derived(
    !settings.showRecipient && !settings.showReturn
      ? 'Turn on From or To to print something.'
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

  /** Build the PDF for the current inputs. */
  function build() {
    return buildEnvelopePdf([recipient], settings, fonts);
  }

  function pdfUrl(bytes: Uint8Array): string {
    return URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  }

  // Debounced live preview. Only the synchronous reads of canPrint, recipient,
  // and settings are tracked; writes inside the timeout do not re-trigger the effect.
  // A build that finishes after its effect run was cleaned up is discarded, so a
  // slow, stale build can never overwrite a newer preview.
  $effect(() => {
    const printable = canPrint;
    void recipient;
    void settings;
    if (!printable) {
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
        const result = await build();
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

  function download() {
    if (!pdfBytes) return;
    const url = pdfUrl(pdfBytes);
    downloadUrls.add(url);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'envelope.pdf';
    a.click();
    // The browser reads the blob asynchronously; release it once the download has started.
    setTimeout(() => {
      URL.revokeObjectURL(url);
      downloadUrls.delete(url);
    }, 30_000);
  }

  async function print() {
    if (lastPrintUrl) {
      URL.revokeObjectURL(lastPrintUrl);
      lastPrintUrl = '';
    }
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
    }
  }
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
      {#if settings.showRecipient && warnings.length > 0}
        <p class="muted message status-line" aria-live="polite"><TriangleAlert size={18} aria-hidden="true" /><span>Some characters in the To address are not supported and were replaced with "?": {warnings[0].replaced.join(' ')}</span></p>
      {/if}
      <div class="actions">
        <button class="btn btn-secondary" type="button" disabled={!pdfBytes} onclick={download}>
          <Download size={20} aria-hidden="true" />
          Download PDF
        </button>
        <!-- Outside the form, so it submits it through the form attribute. -->
        <button class="btn btn-primary" type="submit" form="envelope-form" disabled={!canPrint}><Printer size={20} aria-hidden="true" />Print envelope</button>
      </div>
    </div>
  </div>

  <form class="form" id="envelope-form" onsubmit={(e) => { e.preventDefault(); print(); }}>
    <section class="card rise" style="--i: 2" aria-labelledby="from-title">
      <div class="card-head with-helper">
        <House size={20} aria-hidden="true" class="head-icon" />
        <div class="title-line">
          <h2 id="from-title" class="card-title">From</h2>
          <span class="print-toggle">
            <span class="print-caption" aria-hidden="true">Print</span>
            <button type="button" class="switch" role="switch" aria-checked={settings.showReturn}
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

    <section class="card rise" style="--i: 3" aria-labelledby="to-title">
      <div class="card-head with-helper">
        <Send size={20} aria-hidden="true" class="head-icon" />
        <div class="title-line">
          <h2 id="to-title" class="card-title">To</h2>
          <span class="print-toggle">
            <span class="print-caption" aria-hidden="true">Print</span>
            <button type="button" class="switch" role="switch" aria-checked={settings.showRecipient}
              onclick={() => update('showRecipient', !settings.showRecipient)}>
              <span class="sr-only">Print To address</span>
            </button>
          </span>
        </div>
        <p class="helper">Who you're sending to</p>
      </div>
      {#if !settings.showRecipient}<p class="muted off-note">This address won't print until you turn <strong>Print</strong> on.</p>{/if}
      <div class="card-body" class:off={!settings.showRecipient}>
        <AddressEditor label="To: recipient address" value={recipient}
          onchange={(rich) => (recipient = rich)}
          layout={settings.recipientLayout} onlayout={(l) => update('recipientLayout', l)}
          {fonts}
          placeholder={'Jane Doe\n123 Main St\nSpringfield, IL 62701'} />
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
  .updating { margin: 0; display: inline-flex; align-items: center; gap: 8px; font-size: 14px; color: var(--muted); }

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
    .actions .btn { flex: 1 1 140px; }
  }
  @media (max-width: 480px) {
    .print-caption { display: none; }
  }
</style>
