<script lang="ts">
  import { onMount } from 'svelte';
  import { loadProfile, saveProfile, type Profile } from './lib/store/profile';
  import { applyTheme, watchSystemTheme } from './lib/store/theme';
  import ThemeToggle from './ui/ThemeToggle.svelte';
  import SettingsBackup from './ui/SettingsBackup.svelte';
  import QuickEnvelope from './ui/QuickEnvelope.svelte';
  import AboutDialog from './ui/AboutDialog.svelte';
  import Coffee from '@lucide/svelte/icons/coffee';
  import Info from '@lucide/svelte/icons/info';

  let profile = $state<Profile>(loadProfile());
  let about = $state<ReturnType<typeof AboutDialog>>();
  const openAbout = (e: MouseEvent) => about?.open(e.currentTarget as HTMLElement);

  $effect(() => {
    saveProfile(profile);
    applyTheme(profile.theme);
  });

  onMount(() => watchSystemTheme(() => profile.theme));
</script>

<main>
  <header class="masthead rise" style="--i: 0">
    <div class="brand">
      <svg class="monogram" viewBox="0 0 44 44" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linejoin="round" aria-hidden="true">
        <rect x="4" y="10" width="36" height="26" rx="3" />
        <path d="M4 13l18 13 18-13" />
        <path class="fold" d="M4 36l13-12M40 36L27 24" />
      </svg>
      <div class="brand-text">
        <h1>Letter Rip</h1>
        <p class="tagline">Address and print envelopes from your browser.</p>
      </div>
    </div>
    <div class="tools">
      <button type="button" class="about-btn" aria-label="About" onclick={openAbout}>
        <Info size={18} aria-hidden="true" /><span class="label">About</span>
      </button>
      <SettingsBackup {profile} onimport={(p) => (profile = p)} />
      <ThemeToggle pref={profile.theme} onchange={(t) => (profile = { ...profile, theme: t })} />
    </div>
  </header>

  <QuickEnvelope settings={profile.envelope} onsettings={(s) => (profile = { ...profile, envelope: s })} />

  <footer class="footnote">
    <p>Need to print many? Mail merge from a spreadsheet is coming next.</p>
    <div class="footnote-links">
      <button type="button" class="text-link" onclick={openAbout}>About Letter Rip</button>
      <a class="coffee" href="https://buymeacoffee.com/madebyaaron" target="_blank" rel="noopener">
        <Coffee size={18} aria-hidden="true" />
        Support my experiments
      </a>
    </div>
  </footer>

  <AboutDialog bind:this={about} />
</main>

<style>
  .masthead {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px 24px;
    flex-wrap: wrap;
    margin-bottom: 32px;
  }
  .brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .brand-text { display: grid; gap: 2px; min-width: 0; }
  .tagline { margin: 0; font-size: 13px; line-height: 1.3; color: var(--muted); }
  /* Two-color line envelope: body and flap in ink, the lower folds in coral. */
  .monogram { flex: none; width: 44px; height: 44px; color: var(--text); }
  .monogram .fold { stroke: var(--coral-icon); }
  /* Wordmark: Clash Display 600. */
  h1 { margin: 0; font-size: 28px; font-weight: 600; line-height: 1.1; letter-spacing: -0.01em; }
  .tools { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

  /* Header actions: quiet ghost pills. */
  .about-btn,
  .tools :global(.backup button) {
    min-height: 40px;
    padding: 0 14px;
    background: transparent;
    border-color: transparent;
    color: var(--text);
  }
  .about-btn:hover:not(:disabled),
  .tools :global(.backup button:hover:not(:disabled)) { background: var(--subtle); border-color: transparent; }
  :global(:root[data-theme='dark']) .about-btn:hover:not(:disabled),
  :global(:root[data-theme='dark']) .tools :global(.backup button:hover:not(:disabled)) { background: var(--hover); }

  .footnote {
    margin-top: 48px;
    padding-top: 24px;
    border-top: 1px solid var(--divider);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }
  .footnote p { margin: 0; font-size: 14px; color: var(--muted); }
  /* Support link: quiet outlined pill in the app's own system, no third-party script. */
  .coffee {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 40px;
    padding: 0 16px;
    border: 1px solid color-mix(in srgb, var(--text) 25%, transparent);
    border-radius: 999px;
    color: var(--text);
    font-size: 14px;
    font-weight: 500;
    text-decoration: none;
    transition: background 120ms ease, border-color 120ms ease;
  }
  .coffee:hover { background: var(--subtle); }
  .coffee:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
  .coffee :global(.lucide) { color: var(--coral-icon); }
  .footnote-links { display: flex; align-items: center; gap: 8px 16px; flex-wrap: wrap; }
  /* Opens the About dialog: a plain text link, not another pill. */
  .text-link {
    min-height: 40px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted);
    font-size: 14px;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .text-link:hover:not(:disabled) { background: none; color: var(--text); }

  @media (max-width: 760px) {
    .masthead { margin-bottom: 24px; }
    h1 { font-size: 24px; }
    .monogram { width: 36px; height: 36px; }
    .tools { width: calc(100% + 16px); margin: 0 -8px; gap: 0; }
    .tools :global(.backup) { gap: 0; }
    .about-btn,
    .tools :global(.backup button) { padding: 0 8px; }
  }
  @media (max-width: 480px) {
    .about-btn { width: 40px; padding: 0; }
    .about-btn .label { display: none; }
  }
</style>
