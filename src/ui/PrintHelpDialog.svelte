<script lang="ts">
  import X from '@lucide/svelte/icons/x';
  import { formatSizeLabel, getEnvelopeSize, resolveEnvelopeSize } from '../lib/envelopes/sizes';
  import { pageSizeFor, type EnvelopeSettings } from '../lib/envelopes/build';

  /*
   * How to print with the current settings, in a native modal dialog (the AboutDialog pattern).
   * Escape, a backdrop click, and the X close it; focus returns to the control that opened it.
   */
  let { settings, touchDevice = false }: { settings: EnvelopeSettings; touchDevice?: boolean } = $props();

  let dialog = $state<HTMLDialogElement>();
  let body = $state<HTMLDivElement>();
  let opener: HTMLElement | null = null;
  let pressedOnBackdrop = false;

  const PAPER_NAMES = { letter: 'Letter', a4: 'A4' } as const;
  const SPOTS = { left: 'top left', center: 'top center', right: 'top right' } as const;
  const GUIDES = {
    left: 'against the left paper guide',
    center: 'centered between the paper guides',
    right: 'against the right paper guide',
  } as const;

  /** Such as `#10 (4⅛ × 9½ in)`, or `a custom size (5 × 7 in)`. */
  const sizeName = $derived.by(() => {
    const size = settings.size === 'custom'
      ? { id: 'num10' as const, name: 'a custom size', group: 'US commercial' as const, ...resolveEnvelopeSize(settings) }
      : getEnvelopeSize(settings.size);
    const [name, dims] = formatSizeLabel(size).split(' · ');
    return `${name} (${dims})`;
  });
  const sheet = $derived(settings.paper.kind === 'envelope' ? null : PAPER_NAMES[settings.paper.kind]);
  const exceeds = $derived(pageSizeFor(settings).exceedsPaper);

  export function open(trigger?: HTMLElement) {
    if (!dialog || dialog.open) return;
    opener = trigger ?? (document.activeElement as HTMLElement | null);
    document.documentElement.classList.add('dialog-open');
    if (body) body.scrollTop = 0;
    dialog.showModal();
  }

  function close() {
    dialog?.close();
  }

  function onclose() {
    document.documentElement.classList.remove('dialog-open');
    opener?.focus();
    opener = null;
  }

  // A hit on the <dialog> element itself is the backdrop; the press must start there too.
  function onpointerdown(e: PointerEvent) {
    pressedOnBackdrop = e.target === dialog;
  }
  function onclick(e: MouseEvent) {
    if (pressedOnBackdrop && e.target === dialog) close();
    pressedOnBackdrop = false;
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog bind:this={dialog} class="help" aria-labelledby="print-help-title" {onclose} {onpointerdown} {onclick}>
  <button type="button" class="close" aria-label="Close" onclick={close}><X size={20} aria-hidden="true" /></button>
  <div class="body" bind:this={body}>
    <h2 id="print-help-title">How to print this envelope</h2>
    {#if sheet}
      <p>
        Each page is a full {sheet} sheet with the envelope at the {SPOTS[settings.paper.position]}{settings.rotation === 0 ? '' : `, turned ${settings.rotation}°`}.
      </p>
      <ol>
        <li>Load the envelope in the paper tray at the {SPOTS[settings.paper.position]}, usually {GUIDES[settings.paper.position]}.</li>
        <li>In the print dialog, choose <strong>{sheet}</strong> paper and a scale of <strong>100%</strong> or <strong>Actual size</strong>.</li>
        <li>Print one test on plain paper first, and hold it against an envelope to check the position.</li>
      </ol>
      {#if exceeds}
        <p class="note">This envelope is larger than {sheet} paper, so part of it won't print. Try another <strong>Rotate</strong> setting, or switch <strong>Printer paper</strong> to <strong>Envelope size</strong>.</p>
      {/if}
    {:else}
      <ol>
        <li>Load the envelope in the printer's envelope slot or tray, as the printer's guide shows.</li>
        <li>In the print dialog, choose the paper size that matches: <strong>{sizeName}</strong>.</li>
        <li>If that size isn't offered, switch <strong>Printer paper</strong> to <strong>Letter</strong> or <strong>A4</strong> here and load the envelope where the preview shows it.</li>
      </ol>
    {/if}
    {#if touchDevice}
      <p>
        On a phone or tablet, <strong>Print</strong> opens your device's print screen. Choose your printer
        there. For the PDF, use <strong>Download</strong>.
      </p>
    {/if}
    <p class="tip">
      Most printers feed envelopes short edge first. If text prints sideways or upside down, change
      <strong>Rotate</strong> here rather than in the printer.
    </p>
  </div>
</dialog>

<style>
  .help {
    width: calc(100% - 32px);
    max-width: 560px;
    max-height: 85vh;
    padding: 0;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--text-soft);
    box-shadow: var(--shadow-float);
    overflow: hidden;
  }
  .help[open] { display: flex; flex-direction: column; }
  .help::backdrop { background: rgba(0, 0, 0, 0.4); }

  .body {
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 24px;
    font-size: 15px;
    line-height: 1.65;
  }
  .close {
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 1;
    width: 40px;
    padding: 0;
    border-color: transparent;
    background: var(--surface);
    color: var(--muted);
  }
  .close:hover:not(:disabled) { background: var(--subtle); border-color: transparent; color: var(--text); }
  :global(:root[data-theme='dark']) .close:hover:not(:disabled) { background: var(--hover); }

  h2 { margin: 0 0 12px; padding-right: 40px; font-size: 22px; line-height: 1.3; color: var(--text); }
  p { margin: 0 0 14px; }
  ol { margin: 0 0 14px; padding-left: 22px; display: grid; gap: 8px; }
  .tip { margin: 0; padding-top: 14px; border-top: 1px solid var(--divider); color: var(--muted); }
  strong { font-weight: 600; color: var(--text); }
</style>
