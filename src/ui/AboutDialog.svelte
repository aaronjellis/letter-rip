<script lang="ts">
  import X from '@lucide/svelte/icons/x';

  /*
   * About Letter Rip, in a native modal dialog. The prose is always rendered (a closed <dialog> stays
   * in the DOM), so crawlers still read it. Escape closes natively; a backdrop click and the X close
   * it too. Focus returns to whichever control opened it.
   */
  let dialog = $state<HTMLDialogElement>();
  let body = $state<HTMLDivElement>();
  let opener: HTMLElement | null = null;
  let pressedOnBackdrop = false;

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

  // The dialog box has no padding of its own, so a hit on the <dialog> element itself is the backdrop.
  // Require the press to start there too, so a text selection dragged out of the box doesn't close it.
  function onpointerdown(e: PointerEvent) {
    pressedOnBackdrop = e.target === dialog;
  }
  function onclick(e: MouseEvent) {
    if (pressedOnBackdrop && e.target === dialog) close();
    pressedOnBackdrop = false;
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog bind:this={dialog} class="about" aria-labelledby="about-title" {onclose} {onpointerdown} {onclick}>
  <button type="button" class="close" aria-label="Close" onclick={close}><X size={20} aria-hidden="true" /></button>
  <div class="body" bind:this={body}>
    <h2 id="about-title">What Letter Rip does</h2>
    <p>
      Letter Rip prints addressed envelopes straight from your browser. There is nothing to install
      and no account to create: type a recipient and a return address, see the envelope preview, and
      print.
    </p>
    <p>
      It covers more than 35 envelope sizes, including #10, #9, #6¾, the A2 to A10 announcement sizes,
      DL, C5, square envelopes, and any custom size you enter in inches or millimeters. Each address can
      use a bundled font, a Google Font, or a font installed on your computer, with bold, italic, and a
      different size per line. Anchor and nudge controls line the text up with pre-printed envelopes
      that already carry a logo or a window.
    </p>
    <p>
      Letter Rip works on managed Chromebooks and other locked-down devices because everything runs on
      the device and nothing is uploaded. Font previews for Google Fonts search results are fetched
      from Google. Export your layout to a file and import it on another
      computer to pick up where you left off.
    </p>
    <p>
      It is free and open source. The code is on
      <a href="https://github.com/aaronjellis/letter-rip">GitHub at aaronjellis/letter-rip</a>.
      Letter Rip is MIT licensed. Fonts and libraries are credited in the
      <a href="https://github.com/aaronjellis/letter-rip/blob/main/THIRD_PARTY_LICENSES.md">third-party licenses</a>
      file.
    </p>
    <p>
      To print many envelopes, switch To to <strong>From a list</strong>, load a CSV or Excel file or
      paste cells from a spreadsheet, and build the address from its columns. Letter Rip prints one
      envelope per row.
    </p>
    <p><strong>Coming next:</strong> address labels.</p>

    <h2>How to print an envelope</h2>
    <ol>
      <li>Type the recipient's address. Your return address is remembered on this device.</li>
      <li>Choose the envelope size, from #10 to a custom size.</li>
      <li>Pick a font and style for each address, and nudge the position if your envelope is pre-printed.</li>
      <li>Click <strong>Print envelope</strong>, load the envelope in your printer, and print the PDF that opens.</li>
    </ol>
  </div>
</dialog>

<style>
  .about {
    width: calc(100% - 32px);
    max-width: 640px;
    max-height: 85vh;
    padding: 0;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--text-soft);
    box-shadow: var(--shadow-float);
    overflow: hidden;
  }
  .about[open] { display: flex; flex-direction: column; }
  .about::backdrop { background: rgba(0, 0, 0, 0.4); }

  /* Only the prose scrolls; the close button stays put in the corner. */
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
  h2:not(:first-child) { margin-top: 32px; padding-right: 0; }
  p { margin: 0 0 14px; }
  ol { margin: 0; padding-left: 22px; display: grid; gap: 8px; }
  strong { font-weight: 600; color: var(--text); }
  a { color: var(--text); text-underline-offset: 3px; }
  a:hover { text-decoration-thickness: 2px; }
</style>
