import type { Case } from '../components/DispatchBoard';

/**
 * Alerts for incoming cases.
 *
 * Both channels are opt-in and off by default. A desktop notification needs
 * browser permission anyway, and a board that started making noise on its own
 * the first time it was opened would be worse than one that does nothing until
 * asked.
 */

/**
 * PC is split by expansion because they are effectively separate platforms to
 * fly for: an Odyssey ship cannot reach a Horizons client. Consoles have no
 * expansion variants, so they stay whole.
 *
 * "Legacy" is horizons3 and "Horizons" is horizons4, matching the names the API
 * transform already produces for display.
 */
export type AlertPlatform =
  | 'PC-Odyssey' | 'PC-Horizons' | 'PC-Legacy' | 'Xbox' | 'PlayStation';

export const ALERT_PLATFORMS: { key: AlertPlatform; label: string }[] = [
  { key: 'PC-Odyssey',  label: 'PC — Odyssey' },
  { key: 'PC-Horizons', label: 'PC — Horizons' },
  { key: 'PC-Legacy',   label: 'PC — Legacy' },
  { key: 'Xbox',        label: 'Xbox' },
  { key: 'PlayStation', label: 'PlayStation' },
];

export interface AlertSettings {
  /** Which platforms are worth alerting on -- a rat usually only flies one. */
  platforms: Record<AlertPlatform, boolean>;
  /** Windows notification via the browser's Notification API. */
  desktop: boolean;
  sound: boolean;
}

const KEY = 'dispatchboard-alerts';

const DEFAULTS: AlertSettings = {
  platforms: {
    'PC-Odyssey': true, 'PC-Horizons': true, 'PC-Legacy': true,
    Xbox: true, PlayStation: true,
  },
  desktop: false,
  sound: false,
};

export function loadAlertSettings(): AlertSettings {
  try {
    const stored = localStorage.getItem(KEY);
    if (!stored) return DEFAULTS;
    const parsed = JSON.parse(stored) as Partial<AlertSettings>;
    // Merged rather than trusted, so a settings blob written by an older build
    // cannot leave a platform key undefined and silently mute that platform.
    return {
      platforms: { ...DEFAULTS.platforms, ...(parsed.platforms ?? {}) },
      desktop: parsed.desktop ?? DEFAULTS.desktop,
      sound: parsed.sound ?? DEFAULTS.sound,
    };
  } catch {
    return DEFAULTS;
  }
}

export function saveAlertSettings(settings: AlertSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* private mode or quota — the in-memory settings still apply this session */
  }
}

/**
 * Which alert target a case belongs to, read off the display string the API
 * transform produces ("PC - Odyssey", "Xbox", "PlayStation").
 *
 * Consoles are checked first: "playstation" does not contain "pc", but ordering
 * the checks makes that independent of the substring happening not to collide.
 * Returns null for a PC case with no expansion -- the API allows both fields to
 * be null -- and alertNewCase treats an unclassified case as worth alerting.
 */
export function platformOf(platform: string): AlertPlatform | null {
  const p = platform.toLowerCase();
  if (p.includes('playstation')) return 'PlayStation';
  if (p.includes('xbox')) return 'Xbox';
  if (p.includes('pc')) {
    if (p.includes('odyssey')) return 'PC-Odyssey';
    if (p.includes('horizons')) return 'PC-Horizons';
    if (p.includes('legacy')) return 'PC-Legacy';
  }
  return null;
}

// ------------------------------------------------------------------ desktop

export function desktopPermission(): NotificationPermission | 'unsupported' {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

/** Returns whether notifications may now be shown. Safe to call repeatedly. */
export async function requestDesktopPermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

// -------------------------------------------------------------------- sound

let audioCtx: AudioContext | null = null;

/**
 * Two rising tones, synthesised rather than shipped as a file.
 *
 * Keeps the release assets unchanged and avoids a fetch that could fail at the
 * moment the alert is needed.
 */
function playChime(): void {
  try {
    type Ctor = typeof AudioContext;
    const Ctx: Ctor | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
    if (!Ctx) return;
    audioCtx ??= new Ctx();
    // Browsers start the context suspended until a user gesture. Enabling the
    // toggle is that gesture; this covers the case where it was enabled in an
    // earlier session and the page has not been clicked yet.
    if (audioCtx.state === 'suspended') void audioCtx.resume();

    const now = audioCtx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = audioCtx!.createOscillator();
      const gain = audioCtx!.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = now + i * 0.16;
      // Ramped rather than switched on, which would click.
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.15);
      osc.connect(gain).connect(audioCtx!.destination);
      osc.start(start);
      osc.stop(start + 0.16);
    });
  } catch {
    /* audio is a nicety — never let it break case handling */
  }
}

// ------------------------------------------------------------------- firing

function show(title: string, body: string): void {
  if (desktopPermission() !== 'granted') return;
  try {
    const n = new Notification(title, { body, icon: '/favicon.png', tag: title });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* some platforms throw when notifications are disabled at OS level */
  }
}

/** Fire whatever is enabled for a newly arrived case. */
export function alertNewCase(caseData: Case, settings: AlertSettings): void {
  const platform = platformOf(caseData.platform);
  // An unrecognised platform still alerts: better a spurious ping than silence
  // on a case the board could not classify.
  if (platform && !settings.platforms[platform]) return;

  if (settings.sound) playChime();
  if (settings.desktop) {
    const num = caseData.id.split('-')[1] ?? caseData.id;
    const codeRed = caseData.oxygenStatus ? ' — CODE RED' : '';
    show(
      `Case #${num}${codeRed}`,
      `${caseData.clientName} · ${caseData.platform} · ${caseData.system}`,
    );
  }
}

/** Fire both channels regardless of platform, for the settings "Test" button. */
export function testAlert(settings: AlertSettings): void {
  if (settings.sound) playChime();
  if (settings.desktop) show('Dispatch Board', 'Alerts are working.');
}
