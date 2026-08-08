import { useState } from 'react';
import { Button } from '@/app/components/ui/button';
import {
  BubbleColors,
  ColorSettings,
  ColorTarget,
  DEFAULT_COLOR_SETTINGS,
  NEUTRAL_BUBBLE,
  getColorSettings,
  setColorSettings,
} from '@/app/services/colorSettingsService';

const MOCK_CONVERSATION: Array<{ role: keyof BubbleColors; sender: string; text: string }> = [
  { role: 'client', sender: 'CMDR Example', text: "HELP! Im out of fuel send help!!!" },
  { role: 'dispatcher', sender: 'Dispatch', text: 'Welcome to FuelRats, disable modules except LS' },
  { role: 'rat', sender: 'RatExample[PC]', text: "#5 5j" },
  { role: 'client', sender: 'CMDR Example', text: 'I sent the Team Invite!' },
  { role: 'rat', sender: 'RatExample[PC]', text: "#5 fuel+" },
];

const ROLE_LABELS: Record<keyof BubbleColors, string> = {
  dispatcher: 'Dispatcher',
  client: 'Client',
  rat: 'Active Rats',
};

const ROLE_DESCRIPTIONS: Record<keyof BubbleColors, string> = {
  dispatcher: 'Messages from a dispatcher who is not currently in an active call with the client.',
  client: 'Messages from the client who needs saving.',
  rat: 'Messages from a rat currently assigned to the case.',
};

const TARGET_OPTIONS: Array<{ value: ColorTarget; label: string; hint: string }> = [
  {
    value: 'bubble',
    label: 'The whole bubble',
    hint: 'Easiest to pick out at a glance across a busy board.',
  },
  {
    value: 'nick',
    label: 'The nickname only',
    hint: 'Quieter. Leaves notices and translations to stand out on their own.',
  },
];

export function ColorSettingsPage({ onBack }: { onBack: () => void }) {
  const [settings, setSettings] = useState<ColorSettings>(() => getColorSettings());
  const [saved, setSaved] = useState(false);

  // Which of the two palettes the pickers below are editing. They are separate
  // sets, so switching the target switches what is on screen rather than
  // repainting one palette into a job it was not chosen for.
  const nickMode = settings.target === 'nick';
  const palette = nickMode ? settings.nick : settings.bubble;

  const updateColor = (role: keyof BubbleColors, value: string) => {
    setSettings((prev) => {
      const key = prev.target === 'nick' ? 'nick' : 'bubble';
      return { ...prev, [key]: { ...prev[key], [role]: value } };
    });
    setSaved(false);
  };

  const updateTarget = (target: ColorTarget) => {
    setSettings((prev) => ({ ...prev, target }));
    setSaved(false);
  };

  const handleSave = () => {
    setColorSettings(settings);
    setSaved(true);
  };

  const handleReset = () => {
    // Only the palette on screen, not both. Somebody reaching for this has one
    // set of colours in front of them and one set they want back; wiping the
    // other one as well would be a surprise they cannot undo.
    const key = nickMode ? 'nick' : 'bubble';
    const restored = { ...settings, [key]: { ...DEFAULT_COLOR_SETTINGS[key] } };
    setSettings(restored);
    setColorSettings(restored);
    setSaved(false);
  };

  return (
    // The #colors route wraps this in a fixed-height flex column, so
    // min-h-screen was a trap: flex-shrink squashed the page to exactly one
    // viewport and painted the dark background over only that much, leaving
    // anything below it on the white body canvas. Scrolling inside the dark
    // box instead means the background cannot run out.
    <div className="flex-1 min-h-0 overflow-y-auto bg-slate-950 text-white">
      <div className="p-6 flex flex-col gap-6">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="sm"
            onClick={onBack}
            className="border-slate-400 text-white bg-slate-700 hover:bg-slate-600 hover:border-slate-300"
          >
            ← Back
          </Button>
          <h1 className="text-xl font-bold text-orange-400">Message Colors</h1>
        </div>

        {/* What the colour paints */}
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 flex flex-col gap-3">
          <h2 className="font-semibold text-slate-200">Color by role</h2>
          <div className="flex flex-col gap-2">
            {TARGET_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={`flex items-start gap-3 rounded border p-3 cursor-pointer ${
                  settings.target === option.value
                    ? 'border-orange-500 bg-slate-800'
                    : 'border-slate-700 hover:border-slate-600'
                }`}
              >
                <input
                  type="radio"
                  name="colorTarget"
                  value={option.value}
                  checked={settings.target === option.value}
                  onChange={() => updateTarget(option.value)}
                  className="mt-1 accent-orange-500"
                />
                <div>
                  <p className="text-sm text-slate-200">{option.label}</p>
                  <p className="text-xs text-slate-500">{option.hint}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Preview */}
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 flex flex-col gap-3">
          <h2 className="font-semibold text-slate-200">Preview</h2>
          <div className="bg-slate-950 border border-slate-800 rounded p-4 flex flex-col gap-3">
            {MOCK_CONVERSATION.map((msg, i) => (
              <div
                key={i}
                className="rounded p-2 backdrop-blur-sm"
                style={{
                  backgroundColor: nickMode ? NEUTRAL_BUBBLE : settings.bubble[msg.role],
                }}
              >
                <div className="flex items-center justify-between mb-1">
                  <span
                    className={`text-xs font-semibold ${nickMode ? '' : 'text-orange-400'}`}
                    style={nickMode ? { color: settings.nick[msg.role] } : undefined}
                  >
                    {msg.sender}
                  </span>
                  <span className="text-xs text-slate-400">{ROLE_LABELS[msg.role]}</span>
                </div>
                <p className="text-sm text-slate-100 break-words">{msg.text}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Color pickers */}
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 flex flex-col gap-4">
          <div>
            <h2 className="font-semibold text-slate-200">
              {nickMode ? 'Nickname colors' : 'Bubble colors'}
            </h2>
            <p className="text-xs text-slate-500">
              {nickMode
                ? 'Kept separately from the bubble colors, which are dark by design and would barely show as text.'
                : 'These sit behind white text, so dark shades read best.'}
            </p>
          </div>
          {(Object.keys(ROLE_LABELS) as Array<keyof BubbleColors>).map((role) => (
            <div key={role} className="flex items-center gap-4">
              <input
                type="color"
                value={palette[role]}
                onChange={(e) => updateColor(role, e.target.value)}
                className="w-12 h-9 rounded border border-slate-600 bg-slate-800 cursor-pointer"
              />
              <div className="flex-1">
                <p className="text-sm text-slate-200">{ROLE_LABELS[role]}</p>
                <p className="text-xs text-slate-500">{ROLE_DESCRIPTIONS[role]}</p>
              </div>
              <span className="text-xs text-slate-500 font-mono w-20 text-right">
                {palette[role]}
              </span>
            </div>
          ))}

          <div className="flex items-center gap-2 pt-2">
            <Button onClick={handleSave} className="bg-orange-600 hover:bg-orange-700">
              {saved ? 'Saved!' : 'Save'}
            </Button>
            <Button
              variant="outline"
              onClick={handleReset}
              className="border-slate-400 text-white bg-slate-700 hover:bg-slate-600 hover:border-slate-300"
            >
              Reset {nickMode ? 'nickname' : 'bubble'} colors
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
