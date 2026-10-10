<script lang="ts">
  import { PAPER_POSITIONS, ROTATIONS, type PaperKind, type PaperPosition } from '../lib/envelopes/paper';
  import type { EnvelopeSettings } from '../lib/envelopes/build';
  import AlignStartVertical from '@lucide/svelte/icons/align-start-vertical';
  import AlignCenterVertical from '@lucide/svelte/icons/align-center-vertical';
  import AlignEndVertical from '@lucide/svelte/icons/align-end-vertical';

  /*
   * The sheet the printer gets and how the envelope sits on it: a quiet row under the envelope
   * size. Position only applies to a Letter or A4 sheet, so it shows only then.
   */
  let { settings, onchange }: {
    settings: EnvelopeSettings;
    onchange: (s: EnvelopeSettings) => void;
  } = $props();

  const id = $props.id();

  const POSITION_LABELS: Record<PaperPosition, string> = { left: 'Left', center: 'Center', right: 'Right' };
  const POSITION_ICONS = { left: AlignStartVertical, center: AlignCenterVertical, right: AlignEndVertical };

  function onPaper(e: Event) {
    const kind = (e.target as HTMLSelectElement).value as PaperKind;
    onchange({ ...settings, paper: { ...settings.paper, kind } });
  }
</script>

<div class="paper-controls">
  <div class="field paper">
    <label class="caption" for="{id}-paper">Paper</label>
    <select id="{id}-paper" value={settings.paper.kind} onchange={onPaper}>
      <option value="envelope">Envelope size</option>
      <option value="letter">Letter</option>
      <option value="a4">A4</option>
    </select>
  </div>

  <div class="field">
    <span class="caption" aria-hidden="true">Rotate</span>
    <div class="segmented" role="group" aria-label="Rotate envelope">
      {#each ROTATIONS as r (r)}
        <button type="button" aria-pressed={settings.rotation === r} aria-label="{r} degrees"
          onclick={() => onchange({ ...settings, rotation: r })}>{r}°</button>
      {/each}
    </div>
  </div>

  {#if settings.paper.kind !== 'envelope'}
    <div class="field">
      <span class="caption" aria-hidden="true">Position</span>
      <div class="segmented" role="group" aria-label="Envelope position on the paper">
        {#each PAPER_POSITIONS as p (p)}
          {@const Icon = POSITION_ICONS[p]}
          <button type="button" class="icon-only" aria-pressed={settings.paper.position === p}
            aria-label={POSITION_LABELS[p]} title={POSITION_LABELS[p]}
            onclick={() => onchange({ ...settings, paper: { ...settings.paper, position: p } })}>
            <Icon size={18} aria-hidden="true" />
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .paper-controls { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 12px 16px; min-width: 0; }
  .field { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
  /* Tablet and up: one line; the select shrinks before anything wraps. */
  @media (min-width: 760px) {
    .paper-controls { flex-wrap: nowrap; }
    .field.paper { flex: 0 1 auto; min-width: 0; }
    .field.paper select { flex: 1 1 120px; max-width: 170px; }
  }
  .caption { font-size: 14px; font-weight: 500; color: var(--muted); white-space: nowrap; }
  select { min-height: 40px; padding-top: 6px; padding-bottom: 6px; font-size: 14px; min-width: 0; }
  .segmented { flex: none; }
  .segmented button { min-height: 32px; padding: 0 9px; font-size: 14px; font-variant-numeric: tabular-nums; }
  .segmented .icon-only { width: 36px; padding: 0; }

  /* Phone: each control takes a full row, caption on the left and control on the right. */
  @media (max-width: 759px) {
    .paper-controls { justify-content: stretch; }
    .field { width: 100%; justify-content: space-between; }
    select { flex: 1 1 auto; max-width: 220px; }
  }
</style>
