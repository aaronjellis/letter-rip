<script lang="ts">
  import {
    ENVELOPE_SIZES,
    SIZE_GROUPS,
    CUSTOM_MIN_IN,
    CUSTOM_MAX_IN,
    clampCustomInches,
    formatSizeLabel,
    inchesToMm,
    mmToInches,
  } from '../lib/envelopes/sizes';
  import type { EnvelopeSettings } from '../lib/envelopes/build';
  import Ruler from '@lucide/svelte/icons/ruler';

  let { settings, onchange, compact = false }: {
    settings: EnvelopeSettings;
    onchange: (s: EnvelopeSettings) => void;
    compact?: boolean;
  } = $props();

  const id = $props.id();

  // Entry unit only; settings always store inches.
  let unit = $state<'in' | 'mm'>('in');

  const groups = SIZE_GROUPS.map((group) => ({
    group,
    sizes: ENVELOPE_SIZES.filter((s) => s.group === group),
  }));

  const hint = $derived(
    unit === 'in'
      ? `${CUSTOM_MIN_IN}–${CUSTOM_MAX_IN} in`
      : `${toDisplay(CUSTOM_MIN_IN)}–${toDisplay(CUSTOM_MAX_IN)} mm`,
  );

  /** Inches to the current unit, rounded for display (0.1 mm or 0.001 in). */
  function toDisplay(inches: number): number {
    return unit === 'mm' ? Math.round(inchesToMm(inches) * 10) / 10 : Math.round(inches * 1000) / 1000;
  }

  function toInches(value: number): number {
    return unit === 'mm' ? mmToInches(value) : value;
  }

  function onSizeChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value as EnvelopeSettings['size'];
    onchange({ ...settings, size: value });
  }

  // `change` on a number input fires on blur or Enter, so this is where clamping happens.
  function onDimensionChange(key: 'customWidthIn' | 'customHeightIn', e: Event) {
    const input = e.target as HTMLInputElement;
    const raw = input.valueAsNumber;
    const next = Number.isFinite(raw) ? clampCustomInches(toInches(raw)) : settings[key];
    // Reflect the clamped value even when the setting does not change (no re-render then).
    input.value = String(toDisplay(next));
    onchange({ ...settings, [key]: next });
  }
</script>

<div class="size-picker" class:compact>
  <div class="head title-line">
    {#if compact}
      <label class="sr-only" for="{id}-size">Envelope size</label>
    {:else}
      <Ruler size={20} aria-hidden="true" />
      <label class="title card-title" for="{id}-size">Envelope size</label>
    {/if}
  </div>
  <select id="{id}-size" value={settings.size} onchange={onSizeChange}>
    {#each groups as g (g.group)}
      <optgroup label={g.group}>
        {#each g.sizes as s (s.id)}<option value={s.id}>{formatSizeLabel(s)}</option>{/each}
      </optgroup>
    {/each}
    <option value="custom">Custom…</option>
  </select>

  {#if settings.size === 'custom'}
    <div class="custom">
      <div>
        <label for="{id}-w">Width ({unit})</label>
        <input id="{id}-w" type="number" inputmode="decimal" step="any"
          min={toDisplay(CUSTOM_MIN_IN)} max={toDisplay(CUSTOM_MAX_IN)}
          value={toDisplay(settings.customWidthIn)}
          aria-describedby="{id}-hint"
          onchange={(e) => onDimensionChange('customWidthIn', e)} />
      </div>
      <div>
        <label for="{id}-h">Height ({unit})</label>
        <input id="{id}-h" type="number" inputmode="decimal" step="any"
          min={toDisplay(CUSTOM_MIN_IN)} max={toDisplay(CUSTOM_MAX_IN)}
          value={toDisplay(settings.customHeightIn)}
          aria-describedby="{id}-hint"
          onchange={(e) => onDimensionChange('customHeightIn', e)} />
      </div>
      <div class="segmented" role="group" aria-label="Units">
        <button type="button" aria-pressed={unit === 'in'} onclick={() => (unit = 'in')}>in</button>
        <button type="button" aria-pressed={unit === 'mm'} onclick={() => (unit = 'mm')}>mm</button>
      </div>
    </div>
    <p id="{id}-hint" class="muted hint"><Ruler size={16} aria-hidden="true" />Each side {hint}.</p>
  {/if}
</div>

<style>
  select, input { width: 100%; }
  /* The select's label doubles as the card title (styles from .card-title). */
  .head { margin-bottom: 16px; }
  .title { margin: 0; }
  /* Compact: no visible label; the select's options show the size. */
  .compact .head { margin: 0; display: contents; }
  .compact select { min-width: 0; }
  .custom { display: grid; grid-template-columns: 1fr 1fr auto; gap: 12px; align-items: end; margin-top: 16px; }
  .custom .segmented { height: 48px; align-items: center; }
  .hint { display: flex; align-items: center; gap: 6px; margin: 8px 0 0; font-size: 14px; }

  /* Phone: Width and Height share the row and the unit toggle drops below, so a value like 104.8 fits. */
  @media (max-width: 480px) {
    .custom { grid-template-columns: 1fr 1fr; }
    .custom .segmented { grid-column: 1 / -1; justify-self: start; }
  }

  /* Desktop: one header row, title on the left and the select at the right edge (like the print
     switches). Custom fields appear on a second row, right-aligned under the select. */
  @media (min-width: 760px) {
    .size-picker:not(.compact) {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 360px);
      column-gap: 24px;
      row-gap: 16px;
      align-items: center;
    }
    .head { grid-column: 1; grid-row: 1; margin: 0; }
    select { grid-column: 2; grid-row: 1; }
    .custom { grid-column: 1 / -1; justify-self: end; width: min(100%, 480px); margin-top: 0; }
    .hint { grid-column: 1 / -1; justify-self: end; margin-top: -8px; }
  }
</style>
