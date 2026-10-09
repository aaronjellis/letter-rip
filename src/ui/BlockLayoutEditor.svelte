<script lang="ts">
  import type { BlockLayout, HAnchor, VAnchor } from '../lib/envelopes/layout';
  import { clampOffset, OFFSET_MAX_IN } from '../lib/store/profile';
  import Grid3x3 from '@lucide/svelte/icons/grid-3x3';
  import Crosshair from '@lucide/svelte/icons/crosshair';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';

  let { layout, onchange, title, disabled = false }: {
    layout: BlockLayout;
    onchange: (layout: BlockLayout) => void;
    title: string;
    disabled?: boolean;
  } = $props();

  const id = $props.id();
  const NUDGE_STEP_IN = 0.1;
  const H: HAnchor[] = ['left', 'center', 'right'];
  const V: VAnchor[] = ['top', 'middle', 'bottom'];

  function set<K extends keyof BlockLayout>(key: K, value: BlockLayout[K]) {
    onchange({ ...layout, [key]: value });
  }

  function anchorLabel(v: VAnchor, h: HAnchor): string {
    return v === 'middle' && h === 'center' ? 'Anchor center' : `Anchor ${v} ${h}`;
  }

  function nudge(dx: number, dy: number) {
    onchange({
      ...layout,
      offsetX: clampOffset(layout.offsetX + dx),
      offsetY: clampOffset(layout.offsetY + dy),
    });
  }

  function onOffsetChange(key: 'offsetX' | 'offsetY', e: Event) {
    const input = e.target as HTMLInputElement;
    const raw = input.valueAsNumber;
    const next = Number.isFinite(raw) ? clampOffset(raw) : layout[key];
    input.value = String(next);
    set(key, next);
  }

  /** Enter applies the value here instead of submitting the surrounding form (which prints). */
  function onOffsetKeydown(key: 'offsetX' | 'offsetY', e: KeyboardEvent) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    onOffsetChange(key, e);
  }
</script>

<fieldset class="editor" {disabled}>
  <legend class="sr-only">{title}</legend>

  <div class="controls">
    <div class="col">
      <span class="label with-icon" id="{id}-anchor"><Grid3x3 size={16} aria-hidden="true" />Anchor</span>
      <div class="anchor-grid" role="group" aria-labelledby="{id}-anchor">
        {#each V as v (v)}
          {#each H as h (h)}
            {@const pressed = layout.anchorV === v && layout.anchorH === h}
            <button type="button" aria-label={anchorLabel(v, h)} aria-pressed={pressed}
              onclick={() => onchange({ ...layout, anchorH: h, anchorV: v })}>
              <span class="dot" aria-hidden="true"></span>
            </button>
          {/each}
        {/each}
      </div>
    </div>

    <div class="col nudge-col">
      <span class="label with-icon" id="{id}-nudge"><Crosshair size={16} aria-hidden="true" />Nudge</span>
      <div class="nudge" role="group" aria-labelledby="{id}-nudge">
        <!-- DOM order matches reading order: up, left, reset, right, down. -->
        <div class="pad">
          <button type="button" class="up" aria-label="Nudge up {NUDGE_STEP_IN} in" title="Nudge up" onclick={() => nudge(0, -NUDGE_STEP_IN)}><ArrowUp size={18} aria-hidden="true" /></button>
          <button type="button" class="left" aria-label="Nudge left {NUDGE_STEP_IN} in" title="Nudge left" onclick={() => nudge(-NUDGE_STEP_IN, 0)}><ArrowLeft size={18} aria-hidden="true" /></button>
          <button type="button" class="reset" aria-label="Reset nudge" title="Reset nudge"
            disabled={layout.offsetX === 0 && layout.offsetY === 0}
            onclick={() => onchange({ ...layout, offsetX: 0, offsetY: 0 })}><RotateCcw size={16} aria-hidden="true" /></button>
          <button type="button" class="right" aria-label="Nudge right {NUDGE_STEP_IN} in" title="Nudge right" onclick={() => nudge(NUDGE_STEP_IN, 0)}><ArrowRight size={18} aria-hidden="true" /></button>
          <button type="button" class="down" aria-label="Nudge down {NUDGE_STEP_IN} in" title="Nudge down" onclick={() => nudge(0, NUDGE_STEP_IN)}><ArrowDown size={18} aria-hidden="true" /></button>
        </div>
        <div class="xy">
          <div>
            <label for="{id}-x">X (in)</label>
            <input id="{id}-x" type="number" step="0.05" min={-OFFSET_MAX_IN} max={OFFSET_MAX_IN}
              title="Positive X moves right" aria-describedby="{id}-axis-hint"
              value={layout.offsetX} onchange={(e) => onOffsetChange('offsetX', e)}
              onkeydown={(e) => onOffsetKeydown('offsetX', e)} />
          </div>
          <div>
            <label for="{id}-y">Y (in)</label>
            <input id="{id}-y" type="number" step="0.05" min={-OFFSET_MAX_IN} max={OFFSET_MAX_IN}
              title="Positive Y moves down" aria-describedby="{id}-axis-hint"
              value={layout.offsetY} onchange={(e) => onOffsetChange('offsetY', e)}
              onkeydown={(e) => onOffsetKeydown('offsetY', e)} />
          </div>
        </div>
      </div>
      <p id="{id}-axis-hint" class="sr-only">Positive X moves right; positive Y moves down.</p>
    </div>
  </div>
</fieldset>

<style>
  .editor { border: 0; margin: 0; padding: 0; min-width: 0; display: grid; gap: 16px; }
  .editor:disabled { opacity: 0.5; }
  .label { display: block; margin-bottom: 8px; font-size: 14px; font-weight: 500; }
  .with-icon { display: flex; align-items: center; gap: 6px; }
  .with-icon :global(.lucide) { color: var(--muted); }
  .xy input { width: 100%; }

  /* Anchor and nudge side by side; nudge wraps under the anchor when the card is narrow. */
  .controls { display: flex; flex-wrap: wrap; gap: 16px 32px; align-items: flex-start; }
  .col { min-width: 0; }

  /* Position: nine rounded squares; the selected one is filled. */
  .anchor-grid { display: grid; grid-template-columns: repeat(3, 32px); grid-template-rows: repeat(3, 32px); gap: 6px; }
  .anchor-grid button {
    min-height: 0;
    padding: 0;
    border: 1px solid var(--line-control);
    border-radius: 6px;
    background: var(--field);
  }
  .anchor-grid button:hover:not(:disabled) { border-color: var(--text); background: var(--hover); }
  .dot { display: none; }
  .anchor-grid button[aria-pressed='true'],
  .anchor-grid button[aria-pressed='true']:hover:not(:disabled) { background: var(--ink); border-color: var(--ink); }

  /* Nudge: the pad with the X/Y readout directly beneath it. */
  .nudge { display: grid; gap: 12px; justify-items: center; }
  .pad { display: grid; grid-template-columns: repeat(3, 36px); grid-template-rows: repeat(3, 36px); gap: 4px; }
  .pad button { min-height: 0; padding: 0; }
  .pad .up { grid-area: 1 / 2; }
  .pad .left { grid-area: 2 / 1; }
  .pad .reset { grid-area: 2 / 2; border-color: var(--divider); color: var(--text-soft); }
  .pad .right { grid-area: 2 / 3; }
  .pad .down { grid-area: 3 / 2; }
  .xy { display: grid; grid-template-columns: 80px 80px; gap: 8px; }
  .xy input { min-height: 40px; padding: 8px 10px; }
  .xy label { margin-bottom: 4px; }

  /* Phone: one column, left-aligned. */
  @media (max-width: 480px) {
    .controls { display: grid; justify-items: start; }
    .nudge { justify-items: start; }
  }
</style>
