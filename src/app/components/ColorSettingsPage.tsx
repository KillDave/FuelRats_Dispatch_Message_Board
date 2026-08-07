import { useState } from 'react';
import { Button } from '@/app/components/ui/button';
import {
  BubbleColors,
  DEFAULT_BUBBLE_COLORS,
  getBubbleColors,
  setBubbleColors,
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

export function ColorSettingsPage({ onBack }: { onBack: () => void }) {
  const [colors, setColors] = useState<BubbleColors>(() => getBubbleColors());
  const [saved, setSaved] = useState(false);

  const updateColor = (role: keyof BubbleColors, value: string) => {
    setColors((prev) => ({ ...prev, [role]: value }));
    setSaved(false);
  };

  const handleSave = () => {
    setBubbleColors(colors);
    setSaved(true);
  };

  const handleReset = () => {
    setColors({ ...DEFAULT_BUBBLE_COLORS });
    setBubbleColors(DEFAULT_BUBBLE_COLORS);
    setSaved(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
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
          <h1 className="text-xl font-bold text-orange-400">Message Bubble Colors</h1>
        </div>

        {/* Preview */}
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 flex flex-col gap-3">
          <h2 className="font-semibold text-slate-200">Preview</h2>
          <div className="bg-slate-950 border border-slate-800 rounded p-4 flex flex-col gap-3">
            {MOCK_CONVERSATION.map((msg, i) => (
              <div
                key={i}
                className="rounded p-2 backdrop-blur-sm"
                style={{ backgroundColor: colors[msg.role] }}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-orange-400">{msg.sender}</span>
                  <span className="text-xs text-slate-400">{ROLE_LABELS[msg.role]}</span>
                </div>
                <p className="text-sm text-slate-100 break-words">{msg.text}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Color pickers */}
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 flex flex-col gap-4">
          <h2 className="font-semibold text-slate-200">Colors</h2>
          {(Object.keys(ROLE_LABELS) as Array<keyof BubbleColors>).map((role) => (
            <div key={role} className="flex items-center gap-4">
              <input
                type="color"
                value={colors[role]}
                onChange={(e) => updateColor(role, e.target.value)}
                className="w-12 h-9 rounded border border-slate-600 bg-slate-800 cursor-pointer"
              />
              <div className="flex-1">
                <p className="text-sm text-slate-200">{ROLE_LABELS[role]}</p>
                <p className="text-xs text-slate-500">{ROLE_DESCRIPTIONS[role]}</p>
              </div>
              <span className="text-xs text-slate-500 font-mono w-20 text-right">{colors[role]}</span>
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
              Reset to defaults
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
