<script lang="ts" module>
  import {
    faceFallbacks, fontRefKey, hasFace, isRegularFace, type AvailableFaces, type FaceStyle, type FontProvider, type FontRef,
  } from '../lib/fonts/types';

  /**
   * The family name a font is registered under with `document.fonts`. `fontRefKey` holds `:` and
   * other characters some browsers reject in `new FontFace(...)`, so only letters, digits, and `-` remain.
   */
  function familyName(ref: FontRef): string {
    return 'mm-' + fontRefKey(ref).replace(/[^A-Za-z0-9-]/g, '_');
  }

  /**
   * Faces registered with `document.fonts` for the editor's display, keyed by `fontRefKey(ref, style)`.
   * Shared by every editor so each face registers once. A failed load is forgotten so a later
   * switch to the same font tries again.
   */
  const registeredFaces = new Map<string, Promise<boolean>>();

  /**
   * Bytes for exactly `style`, or null. The provider substitutes a nearer face when one fails to
   * load; registering those bytes as this face would show, say, regular text as "bold".
   */
  async function exactFaceBytes(
    fonts: FontProvider, ref: FontRef, style: FaceStyle, available: AvailableFaces,
  ): Promise<Uint8Array | null> {
    const bytes = await fonts.getBytes(ref, style);
    if (!bytes || isRegularFace(style)) return bytes;
    for (const nearer of faceFallbacks(style).slice(1)) {
      if (!hasFace(available, nearer)) continue;
      if ((await fonts.getBytes(ref, nearer).catch(() => null)) === bytes) return null;
    }
    return bytes;
  }

  /**
   * Register one face of a bundled or Google font under `familyName(ref)`, with bytes from the
   * provider. Only call this for faces `available` lists (regular always exists).
   */
  function registerFace(fonts: FontProvider, ref: FontRef, style: FaceStyle, available: AvailableFaces): Promise<boolean> {
    const key = fontRefKey(ref, style);
    let pending = registeredFaces.get(key);
    if (!pending) {
      pending = (async () => {
        const bytes = await exactFaceBytes(fonts, ref, style, available);
        if (!bytes) return false;
        const face = new FontFace(familyName(ref), bytes as Uint8Array<ArrayBuffer>, {
          weight: style.bold ? '700' : '400',
          style: style.italic ? 'italic' : 'normal',
        });
        document.fonts.add(await face.load());
        return true;
      })().catch(() => false);
      registeredFaces.set(key, pending);
      const settled = pending;
      void settled.then((ok) => {
        if (!ok && registeredFaces.get(key) === settled) registeredFaces.delete(key);
      });
    }
    return pending;
  }

  /** A CSS string literal, for family names in `font-family`. */
  function cssString(s: string): string {
    return `"${s.replace(/["\\]/g, '\\$&')}"`;
  }

  /**
   * Merge-token highlights (CSS Custom Highlight API), shared by every editor that has `fields`.
   * Each editor adds and removes only its own ranges. Null where the API is missing; tokens then
   * show as plain text.
   */
  const tokenHighlights: { known: Highlight; unknown: Highlight } | null = (() => {
    if (typeof CSS === 'undefined' || !('highlights' in CSS) || typeof Highlight === 'undefined') return null;
    const known = new Highlight();
    const unknown = new Highlight();
    CSS.highlights.set('merge-token', known);
    CSS.highlights.set('merge-token-unknown', unknown);
    return { known, unknown };
  })();

  const UI_FAMILY = 'var(--font-ui)';
  const STANDARD_FAMILIES = {
    helvetica: 'Helvetica, Arial, sans-serif',
    times: '"Times New Roman", Times, serif',
  } as const;
</script>

<script lang="ts">
  import { tick, untrack } from 'svelte';
  import type { BlockLayout, HAnchor } from '../lib/envelopes/layout';
  import { NO_FACES, REGULAR_FACE } from '../lib/fonts/types';
  import {
    ensureLines as wrapLines, hasMixedSizes, lineSize, touchedLines, type LineSpan,
  } from '../lib/editor-lines';
  import { isRichEmpty, normalizeRich, type RichText } from '../lib/richtext';
  import { domToRich, plainToPasteHtml, richToDom, sanitizePasteHtml } from '../lib/richtext-dom';
  import { clampFontSize, FONT_SIZE_MAX, FONT_SIZE_MIN } from '../lib/store/profile';
  import { fieldKey, TOKEN_RE } from '../lib/merge/render';
  import FontPicker from './FontPicker.svelte';
  import Bold from '@lucide/svelte/icons/bold';
  import Italic from '@lucide/svelte/icons/italic';
  import TextAlignStart from '@lucide/svelte/icons/text-align-start';
  import TextAlignCenter from '@lucide/svelte/icons/text-align-center';
  import TextAlignEnd from '@lucide/svelte/icons/text-align-end';
  import ALargeSmall from '@lucide/svelte/icons/a-large-small';
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Braces from '@lucide/svelte/icons/braces';

  let {
    value,
    onchange,
    layout,
    onlayout,
    fonts,
    label,
    disabled = false,
    placeholder = '',
    fields,
  }: {
    value: RichText;
    onchange: (rich: RichText) => void;
    layout: BlockLayout;
    onlayout: (layout: BlockLayout) => void;
    fonts: FontProvider;
    label: string;
    disabled?: boolean;
    placeholder?: string;
    /** Merge field names. When set, the toolbar offers Insert field and `{{Field}}` tokens are highlighted. */
    fields?: string[];
  } = $props();

  const SIZE_HINT = 'Applies to the selected lines, or to the whole address when nothing is selected.';
  const ALIGNS: { value: HAnchor; label: string; icon: typeof TextAlignStart }[] = [
    { value: 'left', label: 'Align left', icon: TextAlignStart },
    { value: 'center', label: 'Align center', icon: TextAlignCenter },
    { value: 'right', label: 'Align right', icon: TextAlignEnd },
  ];
  const ALL_FACES: AvailableFaces = { bold: true, italic: true, boldItalic: true };
  const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl+';

  const id = $props.id();
  let root = $state<HTMLDivElement>();
  let el = $state<HTMLDivElement>();

  // Toolbar state, read from the selection while the editor has focus.
  let bold = $state(false);
  let italic = $state(false);
  /** With text selected, the first selected line's size override; null for none, a caret, or no selection. */
  let selectionSize = $state<number | null>(null);
  /** True when the selected lines have different sizes. */
  let mixed = $state(false);
  let faces = $state<AvailableFaces>(ALL_FACES);
  let family = $state(UI_FAMILY);
  // Drives the placeholder; an empty editor may still hold `<div><br></div>`.
  let empty = $state(true);

  /** JSON of the value last rendered or emitted, so our own changes never re-render the DOM. */
  let lastJson = '';
  /** The last selection inside the editor; toolbar buttons apply to it. */
  let savedRange: Range | null = null;
  /** Indices of the first and last line divs the selection touches; Size applies to these. */
  let span: LineSpan | null = null;
  /** True while text dragged from inside the editor is in flight (the browser moves it). */
  let internalDrag = false;

  /**
   * What the Size control shows and steps from: with text selected, the first selected line's
   * size; with a caret or no selection, the block size (which is what Size then changes).
   */
  const displaySize = $derived(selectionSize ?? layout.fontSize);

  /** Replace the editor's DOM with the canonical markup for `rich`. */
  function render(rich: RichText) {
    if (!el) return;
    richToDom(rich, el);
    lastJson = JSON.stringify(rich);
    empty = isRichEmpty(rich);
    decorate();
    // The old nodes are gone, so no selection is left for the toolbar to act on.
    savedRange = null;
    span = null;
    selectionSize = null;
    mixed = false;
    bold = false;
    italic = false;
  }

  // Render when the value changes from outside (first mount, an imported file). Our own edits
  // match lastJson and are skipped, so typing never resets the caret.
  $effect(() => {
    const json = JSON.stringify(value);
    if (!el || json === lastJson) return;
    untrack(() => render(value));
  });

  /** Parse the DOM, report the normalized value, and update the placeholder. Never touches the DOM text. */
  function emit() {
    if (!el) return;
    ensureLines();
    decorate();
    const raw = domToRich(el);
    empty = isRichEmpty(raw);
    const rich = normalizeRich(raw);
    const json = JSON.stringify(rich);
    if (json === lastJson) return;
    lastJson = json;
    onchange(rich);
  }

  /** Keep one div per line, keeping the selection where it was (see `ensureLines` in editor-lines). */
  function ensureLines() {
    if (el) wrapLines(el, document.getSelection());
  }

  function onSelectionChange() {
    const sel = document.getSelection();
    if (!el || !sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return;
    savedRange = range.cloneRange();
    span = touchedLines(el, range);
    refreshState();
  }

  /** Read bold, italic, and (with text selected) the selected lines' sizes for the toolbar. */
  function refreshState() {
    try {
      bold = document.queryCommandState('bold');
      italic = document.queryCommandState('italic');
    } catch {
      // Unsupported: keep the last state.
    }
    if (!el || !span || !hasTextSelection()) {
      selectionSize = null;
      mixed = false;
      return;
    }
    selectionSize = lineSize(el.childNodes[span.start]);
    mixed = hasMixedSizes(el, span, layout.fontSize);
  }

  function onFocus() {
    if (!el || disabled) return;
    // New lines are divs in every browser; bold and italic are <b> and <i>, not styled spans.
    document.execCommand('defaultParagraphSeparator', false, 'div');
    document.execCommand('styleWithCSS', false, 'false');
    if (el.childNodes.length === 0) {
      el.innerHTML = '<div><br></div>';
      const range = document.createRange();
      range.setStart(el.firstChild!, 0);
      range.collapse(true);
      document.getSelection()?.removeAllRanges();
      document.getSelection()?.addRange(range);
    } else {
      ensureLines();
    }
  }

  // Selection changes outside the editor are ignored, so focus moving into the toolbar keeps the
  // last editor selection. Listening for the component's lifetime (rather than from focus to blur)
  // also catches the selection a click sets while focus arrives.
  $effect(() => {
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  });

  /**
   * When focus leaves the editor and its toolbar, re-render canonical markup. Focus moving into the
   * toolbar keeps the DOM, and with it the selection the toolbar acts on.
   */
  function onFocusOut(e: FocusEvent) {
    const next = e.relatedTarget;
    if (next instanceof Node && root?.contains(next)) return;
    // Switching windows blurs too; keep the caret for when the user comes back.
    if (!document.hasFocus()) return;
    canonicalize();
  }

  function canonicalize() {
    if (!el) return;
    const rich = normalizeRich(domToRich(el));
    const json = JSON.stringify(rich);
    if (json !== lastJson) onchange(rich);
    render(rich);
  }

  /** Put focus and the saved selection back in the editor before a command. */
  function restoreSelection() {
    if (!el) return;
    if (document.activeElement !== el) el.focus({ preventScroll: true });
    const sel = document.getSelection();
    if (!sel) return;
    if (savedRange && el.contains(savedRange.startContainer) && el.contains(savedRange.endContainer)) {
      sel.removeAllRanges();
      sel.addRange(savedRange);
    } else if (sel.rangeCount === 0 || !el.contains(sel.anchorNode)) {
      const range = document.createRange();
      range.selectNodeContents(el.lastChild ?? el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  /**
   * Bold or italic at the saved selection. `returnTo` is the button when it was activated from the
   * keyboard: focus goes back to it so screen readers announce its new pressed state.
   */
  function toggle(command: 'bold' | 'italic', returnTo: HTMLElement | null = null) {
    if (disabled || !(command === 'bold' ? faces.bold : faces.italic)) return;
    restoreSelection();
    document.execCommand(command);
    emit();
    refreshState();
    returnTo?.focus();
  }

  /** A toolbar button's click: `detail` is 0 for keyboard activation (Enter or Space). */
  function onStyleClick(command: 'bold' | 'italic', e: MouseEvent & { currentTarget: HTMLButtonElement }) {
    toggle(command, e.detail === 0 ? e.currentTarget : null);
  }

  /** True when the editor still holds a non-collapsed selection the toolbar can act on. */
  function hasTextSelection(): boolean {
    return !!el && !!span && !!savedRange && !savedRange.collapsed
      && el.contains(savedRange.startContainer) && el.contains(savedRange.endContainer);
  }

  function setLineSize(line: HTMLElement, size: number | null) {
    if (size === null) {
      delete line.dataset.size;
      line.style.removeProperty('font-size');
      if (line.getAttribute('style') === '') line.removeAttribute('style');
    } else {
      line.dataset.size = String(size);
      line.style.fontSize = `${size}pt`;
    }
  }

  /**
   * Size: with text selected, a size override on every line the selection touches; otherwise the
   * block size, clearing every line override so the whole address uses it.
   */
  function applySize(raw: number) {
    if (el && hasTextSelection()) {
      const next = clampFontSize(raw, displaySize);
      ensureLines();
      const lines = Array.from(el.children) as HTMLElement[];
      const last = lines.length - 1;
      for (const line of lines.slice(Math.min(span!.start, last), Math.min(span!.end, last) + 1)) setLineSize(line, next);
      selectionSize = next;
      mixed = false;
      emit();
      return;
    }
    const next = clampFontSize(raw, layout.fontSize);
    if (el) {
      for (const line of el.querySelectorAll<HTMLElement>('[data-size]')) setLineSize(line, null);
      emit();
    }
    selectionSize = null;
    mixed = false;
    if (next !== layout.fontSize) onlayout({ ...layout, fontSize: next });
  }

  function onSizeChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    // An emptied field (or "Mixed" left blank) changes nothing.
    if (Number.isFinite(input.valueAsNumber)) applySize(input.valueAsNumber);
    // Reflect the clamped value even when nothing changed (no re-render then).
    input.value = mixed ? '' : String(displaySize);
  }

  /** Arrow keys and the stepper buttons step by 1pt and apply at once. */
  function step(delta: number) {
    applySize(displaySize + delta);
  }

  function onSizeKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      // Apply here rather than submitting the surrounding form (which prints).
      e.preventDefault();
      onSizeChange(e);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      step(e.key === 'ArrowUp' ? 1 : -1);
    }
  }

  function onKeydown(e: KeyboardEvent) {
    const mod = (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
    if (mod) {
      const key = e.key.toLowerCase();
      if (key === 'b' || key === 'i') {
        e.preventDefault();
        toggle(key === 'b' ? 'bold' : 'italic');
      } else if (key === 'u') {
        // Underline is not part of an address.
        e.preventDefault();
      }
    } else if (e.key === 'Enter' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // Shift+Enter makes a new line too, as a div rather than a <br>.
      e.preventDefault();
      document.execCommand('insertParagraph');
    }
  }

  /** Sanitized HTML for clipboard or drag data: lines, bold, and italic only. */
  function sanitizedFrom(data: DataTransfer): string {
    const html = data.getData('text/html');
    return (html && sanitizePasteHtml(html)) || plainToPasteHtml(data.getData('text/plain'));
  }

  function onPaste(e: ClipboardEvent) {
    e.preventDefault();
    if (disabled || !e.clipboardData) return;
    const html = sanitizedFrom(e.clipboardData);
    if (html) document.execCommand('insertHTML', false, html);
    emit();
  }

  function onDrop(e: DragEvent) {
    // Text moved within the editor: the browser moves it and an input event follows.
    if (internalDrag || disabled || !e.dataTransfer || !el) return;
    e.preventDefault();
    const html = sanitizedFrom(e.dataTransfer);
    if (!html) return;
    let range: Range | null = null;
    if ('caretPositionFromPoint' in document) {
      const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
      if (pos) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
      }
    } else if ('caretRangeFromPoint' in document) {
      range = (document as Document).caretRangeFromPoint(e.clientX, e.clientY);
    }
    el.focus({ preventScroll: true });
    if (range && el.contains(range.startContainer)) {
      range.collapse(true);
      document.getSelection()?.removeAllRanges();
      document.getSelection()?.addRange(range);
    }
    document.execCommand('insertHTML', false, html);
    emit();
  }

  // ---- Merge fields: Insert field menu and token highlighting ----

  /** This editor's ranges in the shared token highlights. */
  let tokenRanges: Range[] = [];
  let fieldsOpen = $state(false);
  /** Index of the active option in the Insert field list. */
  let activeField = $state(0);
  let fieldsTrigger = $state<HTMLButtonElement>();
  let fieldsList = $state<HTMLUListElement>();
  const hasFields = $derived(!!fields && fields.length > 0);

  function clearTokenRanges() {
    if (!tokenHighlights) return;
    for (const r of tokenRanges) {
      tokenHighlights.known.delete(r);
      tokenHighlights.unknown.delete(r);
    }
    tokenRanges = [];
  }

  /**
   * Highlight `{{Field}}` tokens without touching the DOM: one Range per token, known fields in
   * `merge-token`, unknown ones in `merge-token-unknown`. Tokens split across runs are not tokens.
   */
  function decorate() {
    if (!tokenHighlights) return;
    clearTokenRanges();
    if (!el || !fields) return;
    const known = new Set(fields.map(fieldKey));
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? '';
      if (!text.includes('{{')) continue;
      for (const m of text.matchAll(TOKEN_RE)) {
        if (m[1].trim() === '') continue;
        const range = document.createRange();
        range.setStart(node, m.index!);
        range.setEnd(node, m.index! + m[0].length);
        (known.has(fieldKey(m[1])) ? tokenHighlights.known : tokenHighlights.unknown).add(range);
        tokenRanges.push(range);
      }
    }
  }

  // Re-highlight when the field names change (a list loads or a column is renamed).
  $effect(() => {
    void fields;
    untrack(decorate);
  });
  $effect(() => clearTokenRanges);

  async function openFields() {
    if (!hasFields) return;
    fieldsOpen = true;
    activeField = 0;
    await tick();
    fieldsList?.focus();
  }

  // Keep the active option in view as the keyboard (or pointer) moves through a long list.
  $effect(() => {
    if (!fieldsOpen || !fieldsList) return;
    fieldsList.children[activeField]?.scrollIntoView({ block: 'nearest' });
  });

  function closeFields(returnFocus: boolean) {
    if (!fieldsOpen) return;
    fieldsOpen = false;
    if (returnFocus) fieldsTrigger?.focus();
  }

  /** Insert `{{name}}` at the saved caret as plain text in the current run, or at the end of the last line. */
  function insertField(name: string) {
    fieldsOpen = false;
    if (!el || disabled) return;
    const sel = document.getSelection();
    const valid = savedRange && el.contains(savedRange.startContainer) && el.contains(savedRange.endContainer);
    if (document.activeElement !== el) el.focus({ preventScroll: true });
    if (!sel) return;
    if (valid) {
      sel.removeAllRanges();
      sel.addRange(savedRange!);
    } else {
      ensureLines();
      const last = el.lastChild ?? el;
      const range = document.createRange();
      range.selectNodeContents(last);
      // An empty line holds only <br>; insert before it.
      if (last.lastChild?.nodeName === 'BR') range.setEndBefore(last.lastChild);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    document.execCommand('insertText', false, `{{${name}}}`);
    emit();
  }

  function onFieldsKeydown(e: KeyboardEvent) {
    const list = fields ?? [];
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeField = (activeField + 1) % list.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeField = (activeField - 1 + list.length) % list.length;
    } else if (e.key === 'Home') {
      e.preventDefault();
      activeField = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      activeField = list.length - 1;
    } else if (e.key === 'Enter' || e.key === ' ') {
      // Enter must not submit the surrounding form (which prints).
      e.preventDefault();
      if (list[activeField] !== undefined) insertField(list[activeField]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeFields(true);
    } else if (e.key === 'Tab') {
      closeFields(false);
    }
  }

  function onFieldsTriggerKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      void openFields();
    }
  }

  function onWindowPointerDown(e: PointerEvent) {
    if (!fieldsOpen || !(e.target instanceof Node)) return;
    if (fieldsList?.contains(e.target) || fieldsTrigger?.contains(e.target)) return;
    fieldsOpen = false;
  }

  /** Toolbar buttons keep focus, and so the selection, in the editor. */
  function keepSelection(e: MouseEvent) {
    e.preventDefault();
  }

  // Display font and the faces the toolbar offers. Runs only when the font itself changes.
  const fontKey = $derived(fontRefKey(layout.font));
  $effect(() => {
    void fontKey;
    const ref = untrack(() => layout.font);
    let stale = false;
    const available = fonts.availableFaces(ref).catch(() => ({ ...NO_FACES }));
    void available.then((f) => {
      if (!stale) faces = f;
    });
    if (ref.kind === 'standard') {
      family = STANDARD_FAMILIES[ref.id];
    } else if (ref.kind === 'local') {
      family = `${cssString(ref.family)}, ${UI_FAMILY}`;
    } else {
      // Keep the previous family until the new one is ready; fall back to the UI font on failure.
      // Only faces the font has are registered, so the editor never shows a stand-in face.
      void (async () => {
        const f = await available;
        const ok = await registerFace(fonts, ref, REGULAR_FACE, f);
        if (stale) return;
        family = ok ? `${cssString(familyName(ref))}, ${UI_FAMILY}` : UI_FAMILY;
        if (!ok) return;
        if (f.bold) void registerFace(fonts, ref, { bold: true, italic: false }, f);
        if (f.italic) void registerFace(fonts, ref, { bold: false, italic: true }, f);
        if (f.boldItalic) void registerFace(fonts, ref, { bold: true, italic: true }, f);
      })();
    }
    return () => {
      stale = true;
    };
  });
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<!-- focusout bubbles from the toolbar and the editor; it only decides when to tidy the markup. -->
<div class="address-editor" class:disabled bind:this={root} onfocusout={onFocusOut}>
  <fieldset class="toolbar" {disabled}>
    <legend class="sr-only">{label} formatting</legend>
    <FontPicker compact label="Font" value={layout.font} onchange={(font) => onlayout({ ...layout, font })} />
    <span class="size-field" title={mixed ? `Mixed sizes. ${SIZE_HINT}` : SIZE_HINT}>
      <ALargeSmall size={16} aria-hidden="true" />
      <input type="number" min={FONT_SIZE_MIN} max={FONT_SIZE_MAX} step="1" aria-label="Size (pt)"
        aria-describedby="{id}-size-hint" class:mixed placeholder={mixed ? 'Mixed' : undefined}
        value={mixed ? '' : displaySize} onchange={onSizeChange} onkeydown={onSizeKeydown} />
      {#if !mixed}<span class="unit" aria-hidden="true">pt</span>{/if}
      <span class="sr-only" id="{id}-size-hint">{mixed ? `Mixed sizes. ${SIZE_HINT}` : SIZE_HINT}</span>
      <!-- Pointer shortcut for the arrow keys; they keep the editor's selection, so they skip the tab order. -->
      <span class="stepper">
        <button type="button" tabindex="-1" aria-label="Increase size" onmousedown={keepSelection}
          onclick={() => step(1)}><ChevronUp size={12} aria-hidden="true" /></button>
        <button type="button" tabindex="-1" aria-label="Decrease size" onmousedown={keepSelection}
          onclick={() => step(-1)}><ChevronDown size={12} aria-hidden="true" /></button>
      </span>
    </span>
    <div class="segmented" role="group" aria-label="Text style">
      <button type="button" class="icon-only" aria-label="Bold" aria-pressed={bold}
        aria-disabled={!faces.bold} aria-keyshortcuts="Control+B Meta+B"
        title={faces.bold ? `Bold (${MOD}B)` : 'This font has no bold face'}
        onmousedown={keepSelection} onclick={(e) => onStyleClick('bold', e)}>
        <Bold size={18} aria-hidden="true" />
      </button>
      <button type="button" class="icon-only" aria-label="Italic" aria-pressed={italic}
        aria-disabled={!faces.italic} aria-keyshortcuts="Control+I Meta+I"
        title={faces.italic ? `Italic (${MOD}I)` : 'This font has no italic face'}
        onmousedown={keepSelection} onclick={(e) => onStyleClick('italic', e)}>
        <Italic size={18} aria-hidden="true" />
      </button>
    </div>
    <div class="segmented" role="group" aria-label="Alignment">
      {#each ALIGNS as a (a.value)}
        <button type="button" class="icon-only" aria-label={a.label} title={a.label}
          aria-pressed={layout.align === a.value} onmousedown={keepSelection}
          onclick={() => onlayout({ ...layout, align: a.value })}>
          <a.icon size={18} aria-hidden="true" />
        </button>
      {/each}
    </div>
    {#if fields}
      <span class="insert-field" title={hasFields ? undefined : 'Load a list first'}>
        <button type="button" class="insert-trigger" bind:this={fieldsTrigger} aria-label="Insert field"
          aria-haspopup="listbox" aria-expanded={fieldsOpen} aria-controls="{id}-fields"
          aria-disabled={!hasFields} onmousedown={keepSelection} onkeydown={onFieldsTriggerKeydown}
          onclick={() => (fieldsOpen ? closeFields(false) : openFields())}>
          <Braces size={16} aria-hidden="true" /><span class="insert-label">Insert field</span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      </span>
      {#if fieldsOpen && fields.length > 0}
        <ul class="fields" id="{id}-fields" role="listbox" tabindex="-1" aria-label="Fields"
          bind:this={fieldsList} aria-activedescendant="{id}-field-{activeField}" onkeydown={onFieldsKeydown}>
          {#each fields as name, i (name)}
            <!-- Options are picked with the pointer here; the listbox handles the keyboard. -->
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <li id="{id}-field-{i}" role="option" aria-selected={i === activeField} class:active={i === activeField}
              onmousedown={keepSelection} onmouseenter={() => (activeField = i)} onclick={() => insertField(name)}>
              <Braces size={14} aria-hidden="true" /><span>{name}</span>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </fieldset>

  <div bind:this={el} class="editable" class:is-empty={empty}
    contenteditable={disabled ? 'false' : 'true'} data-ph-no-capture role="textbox" aria-multiline="true" aria-label={label}
    aria-disabled={disabled} tabindex={disabled ? undefined : 0} data-placeholder={placeholder}
    style:font-family={family} style:font-size="{layout.fontSize}pt" style:text-align={layout.align}
    onfocus={onFocus} oninput={emit} onkeydown={onKeydown} onpaste={onPaste}
    ondragstart={() => (internalDrag = true)} ondragend={() => (internalDrag = false)} ondrop={onDrop}></div>
</div>

<style>
  /* One framed control: the toolbar on top, the editing area below, a single focus ring. */
  .address-editor {
    position: relative;
    min-width: 0;
    background: var(--field);
    border: 1px solid var(--line-control);
    border-radius: var(--radius);
    transition: border-color 120ms ease, box-shadow 120ms ease;
  }
  .address-editor:hover:not(.disabled) { border-color: var(--text); }
  .address-editor:not(.disabled):has(.editable:focus) { border-color: var(--text); box-shadow: inset 0 0 0 1px var(--text); }

  /* Size: icon, number, "pt", and a two-button stepper inside one pill. */
  .size-field { position: relative; display: inline-flex; align-items: center; }
  .size-field > :global(.lucide-a-large-small) { position: absolute; left: 12px; color: var(--muted); pointer-events: none; }
  .size-field input {
    width: 104px;
    min-height: 38px;
    padding: 0 48px 0 34px;
    font-size: 14px;
    border-radius: 9999px;
    appearance: textfield;
    -moz-appearance: textfield;
  }
  /* "Mixed" takes the unit's place. */
  .size-field input.mixed { padding-right: 26px; }
  .size-field input::placeholder { color: var(--muted); opacity: 1; }
  .size-field input::-webkit-inner-spin-button,
  .size-field input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  .unit { position: absolute; right: 30px; font-size: 13px; color: var(--muted); pointer-events: none; }
  .stepper { position: absolute; right: 6px; top: 4px; bottom: 4px; display: grid; grid-template-rows: 1fr 1fr; }
  .stepper button {
    min-height: 0;
    width: 20px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--text-soft);
  }
  .stepper button:hover:not(:disabled) { background: var(--hover); border: 0; }

  .editable {
    /* Anchors the placeholder at the start of the text. */
    position: relative;
    min-height: 112px;
    padding: 12px 14px;
    line-height: 1.25;
    overflow-wrap: anywhere;
    color: var(--text);
    border-radius: 0 0 var(--radius) var(--radius);
    cursor: text;
    /* The PDF never fakes bold or italic, so neither does the editor. */
    font-synthesis: none;
  }
  /* The frame shows focus. */
  .editable:focus, .editable:focus-visible { outline: none; }
  .editable.is-empty::before, .editable:empty::before {
    content: attr(data-placeholder);
    position: absolute;
    white-space: pre-line;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: 15px;
    line-height: 1.5;
    text-align: left;
    pointer-events: none;
  }
  /* Insert field: a pill trigger; its list floats under the toolbar's right edge. */
  .insert-field { display: inline-flex; margin-left: auto; }
  .insert-trigger { min-height: 38px; gap: 6px; padding: 0 10px 0 12px; font-size: 14px; }
  .insert-trigger :global(.lucide-braces) { color: var(--muted); }
  .fields {
    position: absolute;
    top: calc(100% + 4px);
    right: 8px;
    z-index: 20;
    min-width: 200px;
    max-width: calc(100% - 16px);
    max-height: 280px;
    overflow-y: auto;
    margin: 0;
    padding: 6px;
    /* scrollIntoView on the active option keeps the list's padding visible. */
    scroll-padding: 6px;
    list-style: none;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    box-shadow: var(--shadow-float);
  }
  .fields:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
  .fields li {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 36px;
    padding: 0 10px;
    border-radius: var(--radius-sm);
    font-size: 14px;
    cursor: pointer;
  }
  .fields li span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fields li :global(.lucide) { color: var(--muted); }
  .fields li.active { background: var(--hover); }
  :global(:root[data-theme='dark']) .fields li.active { background: var(--subtle); }
  @media (max-width: 480px) {
    .insert-label { display: none; }
    .insert-trigger { padding: 0 8px 0 10px; }
  }

  /* A disabled editor is read-only and cannot take focus. */
  .disabled { background: var(--subtle); border-color: var(--divider); }
  .disabled .editable { color: var(--muted); cursor: default; }
</style>
