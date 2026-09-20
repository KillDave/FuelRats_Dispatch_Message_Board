import { useState } from 'react';
import { Bell, Palette, Settings } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import {
  ALERT_PLATFORMS, desktopPermission, loadAlertSettings,
  requestDesktopPermission, saveAlertSettings, testAlert,
  type AlertSettings,
} from '@/app/services/alertService';
import { getAutoExpandQuotes, setAutoExpandQuotes } from '@/app/services/boardOptionsService';

function OptionToggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="flex items-center gap-2 py-1 text-sm text-slate-300 hover:text-white cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-orange-500 w-4 h-4"
      />
      <span className="flex-1">{label}</span>
      {hint && <span className="text-xs text-slate-600">{hint}</span>}
    </label>
  );
}

export function BoardOptionsPage({ onBack }: { onBack: () => void }) {
  const [alertSettings, setAlertSettingsState] = useState<AlertSettings>(loadAlertSettings);
  const [permission, setPermission] = useState(desktopPermission());
  const [autoExpandQuotes, setAutoExpandQuotesState] = useState<boolean>(getAutoExpandQuotes);

  const updateAlertSettings = (next: AlertSettings) => {
    setAlertSettingsState(next);
    saveAlertSettings(next);
  };

  const setDesktop = async (on: boolean) => {
    if (on) {
      const granted = await requestDesktopPermission();
      setPermission(desktopPermission());
      if (!granted) return;
    }
    updateAlertSettings({ ...alertSettings, desktop: on });
  };

  const updateAutoExpandQuotes = (next: boolean) => {
    setAutoExpandQuotesState(next);
    setAutoExpandQuotes(next);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-slate-950 text-white overflow-hidden">
      <div className="p-6 pb-0 flex-shrink-0">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="sm"
            onClick={onBack}
            className="border-slate-400 text-white bg-slate-700 hover:bg-slate-600 hover:border-slate-300"
          >
            ← Back
          </Button>
          <h1 className="text-xl font-bold text-orange-400">Board Options</h1>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 flex flex-col gap-2">
            <h2 className="font-semibold text-slate-200 flex items-center gap-2">
              <Bell className="w-4 h-4" />
              New Case Alerts
            </h2>
            <OptionToggle
              label="Windows notification"
              checked={alertSettings.desktop}
              onChange={(on) => void setDesktop(on)}
              hint={
                permission === 'unsupported' ? 'n/a'
                : permission === 'denied'    ? 'blocked'
                : undefined
              }
            />
            {permission === 'denied' && (
              <p className="text-xs text-slate-600 leading-snug">
                Blocked for this site — allow notifications in the browser's address-bar
                site settings, then re-enable here.
              </p>
            )}
            <OptionToggle
              label="Sound"
              checked={alertSettings.sound}
              onChange={(on) => updateAlertSettings({ ...alertSettings, sound: on })}
            />
            <div className="pt-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => testAlert(alertSettings)}
                disabled={!alertSettings.desktop && !alertSettings.sound}
                className="border-slate-400 text-white bg-slate-700 hover:bg-slate-600 hover:border-slate-300"
              >
                <Bell className="w-3.5 h-3.5" />
                Test alert
              </Button>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 flex flex-col gap-2">
            <h2 className="font-semibold text-slate-200">Alert on Platform</h2>
            {ALERT_PLATFORMS.map(({ key, label }) => (
              <OptionToggle
                key={key}
                label={label}
                checked={alertSettings.platforms[key]}
                onChange={(on) =>
                  updateAlertSettings({
                    ...alertSettings,
                    platforms: { ...alertSettings.platforms, [key]: on },
                  })
                }
              />
            ))}
          </div>

          <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 flex flex-col gap-2">
            <h2 className="font-semibold text-slate-200">Quotes</h2>
            <OptionToggle
              label="Auto expand quotes"
              checked={autoExpandQuotes}
              onChange={updateAutoExpandQuotes}
              hint="Quotes panel and case log open by default"
            />
          </div>

          <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 flex flex-col gap-3">
            <h2 className="font-semibold text-slate-200">Appearance &amp; Translation</h2>
            <Button
              variant="outline"
              onClick={() => { window.location.hash = '#colors'; }}
              className="justify-start border-slate-400 text-white bg-slate-700 hover:bg-slate-600 hover:border-slate-300"
            >
              <Palette className="w-3.5 h-3.5" />
              Message Colors
            </Button>
            <Button
              variant="outline"
              onClick={() => { window.location.hash = '#deepl'; }}
              className="justify-start border-slate-400 text-white bg-slate-700 hover:bg-slate-600 hover:border-slate-300"
            >
              <Settings className="w-3.5 h-3.5" />
              DeepL Settings
            </Button>
            <Button
              variant="outline"
              onClick={() => { window.location.hash = '#langbly'; }}
              className="justify-start border-slate-400 text-white bg-slate-700 hover:bg-slate-600 hover:border-slate-300"
            >
              <Settings className="w-3.5 h-3.5" />
              Langbly Settings
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
