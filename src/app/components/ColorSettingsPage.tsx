import { useState } from 'react';
import { Button } from '@/app/components/ui/button';
import {
  ColorSettings,
  ColorTarget,
  DEFAULT_COLOR_SETTINGS,
  MessageRole,
  getColorSettings,
  setColorSettings,
} from '@/app/services/colorSettingsService';

const MOCK_CONVERSATION: Array<{ role: MessageRole; sender: string; text: string; translation?: string }> = [
  { role: 'client', sender: 'CMDR Example', text: "AIDE ! Je suis à court de carburant, envoyez de l'aide !!!", translation: 'HELP! Im out of fuel send help!!!' },
  { role: 'dispatcher', sender: 'Dispatch', text: 'Bienvenue sur FuelRats, désactivez tous les modules sauf LS', translation: 'Welcome to FuelRats, disable modules except LS' },
  { role: 'rat', sender: 'RatExample[PC]', text: '#5 5j' },
  { role: 'client', sender: 'CMDR Example', text: 'I sent the Team Invite!' },
  { role: 'rat', sender: 'RatExample[PC]', text: '#5 fuel+' },
];

const ROLE_LABELS: Record<MessageRole, string> = {
  dispatcher: 'Dispatcher',
  client: 'Client',
  rat: 'Active Rats',
};

const ROLE_DESCRIPTIONS: Record<MessageRole, string> = {
  dispatcher: 'Messages from a dispatcher who is not currently in an active call with the client.',
  client: 'Messages from the client who needs saving.',
  rat: 'Messages from a rat currently assigned to the case.',
};

const TARGET_OPTIONS: Array<{ value: ColorTarget; label: string; hint: string }> = [
  {
    value: 'bubble',
    label: 'Full Customization',
    hint: 'Bubble, nickname, message, and translation colors, each set per role.',
  },
  {
    value: 'nick',
    label: 'Text Only',
    hint: 'One shared bubble color. Only nickname, message, and translation colors are set per role.',
  },
];

type PaletteKey = 'bubble' | 'nick' | 'text' | 'translation';

const FIELD_LABELS: Record<PaletteKey, string> = {
  bubble: 'Bubble background',
  nick: 'Nickname',
  text: 'Message text',
  translation: 'Translation text',
};

const FIELD_ORDER: PaletteKey[] = ['bubble', 'nick', 'text', 'translation'];

export function ColorSettingsPage({ onBack }: { onBack: () => void }) {
  const [settings, setSettings] = useState<ColorSettings>(() => getColorSettings());
  const [saved, setSaved] = useState(false);

  const nickMode = settings.target === 'nick';

  const updateColor = (paletteKey: PaletteKey, role: MessageRole, value: string) => {
    setSettings((prev) => ({ ...prev, [paletteKey]: { ...prev[paletteKey], [role]: value } }));
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
    const restored = structuredClone(DEFAULT_COLOR_SETTINGS);
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
    <div className="flex-1 min-h-0 flex flex-col bg-slate-950 text-white overflow-hidden">
      <div className="p-6 pb-0 flex flex-col gap-6 flex-shrink-0">
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

        {/* Preview */}
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 flex flex-col gap-3">
          <h2 className="font-semibold text-slate-200">Preview</h2>
          <div className="bg-slate-950 border border-slate-800 rounded p-4 flex flex-col gap-3">
            {MOCK_CONVERSATION.map((msg, i) => (
              <div
                key={i}
                className="rounded p-2 backdrop-blur-sm"
                style={{
                  backgroundColor: nickMode ? settings.neutralBubble : settings.bubble[msg.role],
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
                <p className="text-sm break-words" style={{ color: settings.text[msg.role] }}>
                  {msg.text}
                </p>
                {msg.translation && (
                  <p className="text-sm break-words italic mt-1" style={{ color: settings.translation[msg.role] }}>
                    ⟫ {msg.translation}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* This section scrolls; the header and preview above stay put */}
      <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
        {/* 2x2 grid: how the role shows up, then one tile per role */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 flex flex-col gap-3">
            <h2 className="font-semibold text-slate-200">Bubble Color Setting</h2>
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
            {nickMode && (
              <div className="flex items-center gap-4 pt-1">
                <input
                  type="color"
                  value={settings.neutralBubble}
                  onChange={(e) => {
                    setSettings((prev) => ({ ...prev, neutralBubble: e.target.value }));
                    setSaved(false);
                  }}
                  className="w-12 h-9 rounded border border-slate-600 bg-slate-800 cursor-pointer"
                />
                <p className="flex-1 text-sm text-slate-200">Shared bubble color</p>
                <span className="text-xs text-slate-500 font-mono w-20 text-right">{settings.neutralBubble}</span>
              </div>
            )}
          </div>

          {(Object.keys(ROLE_LABELS) as MessageRole[]).map((role) => (
            <div key={role} className="bg-slate-900 border border-slate-700 rounded-lg p-4 flex flex-col gap-4">
              <div>
                <h2 className="font-semibold text-slate-200">{ROLE_LABELS[role]}</h2>
                <p className="text-xs text-slate-500">{ROLE_DESCRIPTIONS[role]}</p>
              </div>
              {(nickMode ? FIELD_ORDER.filter((f) => f !== 'bubble') : FIELD_ORDER).map((field) => (
                <div key={field} className="flex items-center gap-4">
                  <input
                    type="color"
                    value={settings[field][role]}
                    onChange={(e) => updateColor(field, role, e.target.value)}
                    className="w-12 h-9 rounded border border-slate-600 bg-slate-800 cursor-pointer"
                  />
                  <p className="flex-1 text-sm text-slate-200">{FIELD_LABELS[field]}</p>
                  <span className="text-xs text-slate-500 font-mono w-20 text-right">{settings[field][role]}</span>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={handleSave} className="bg-orange-600 hover:bg-orange-700">
            {saved ? 'Saved!' : 'Save'}
          </Button>
          <Button
            variant="outline"
            onClick={handleReset}
            className="border-slate-400 text-white bg-slate-700 hover:bg-slate-600 hover:border-slate-300"
          >
            Reset to defaults
          </Button>
        </div>
      </div>
    </div>
  );
}
