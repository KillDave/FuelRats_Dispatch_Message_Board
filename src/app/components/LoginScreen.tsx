import { useState } from 'react';
import { authService } from '../services/authService';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { AlertTriangle, LogIn, ExternalLink } from 'lucide-react';
import fuelRatsLogo from './image/TransparentBackgroundRatto.png';

interface LoginScreenProps {
  onAuthenticated: () => void;
}

export function LoginScreen({ onAuthenticated }: LoginScreenProps) {
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);

    // Verify the token works by hitting the API
    try {
      const response = await fetch('https://fuelrats.com/api/fr/rescues?filter[status][ne]=closed&sort=-createdAt', {
        headers: { Authorization: `Bearer ${trimmed}` },
      });

      if (response.status === 401 || response.status === 403) {
        setError('Token rejected — make sure you copied it correctly.');
        setLoading(false);
        return;
      }

      if (!response.ok && response.status !== 404) {
        setError(`API returned ${response.status} — try again.`);
        setLoading(false);
        return;
      }

      authService.setToken(trimmed);
      onAuthenticated();
    } catch {
      setError('Network error — check your connection.');
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex items-center justify-center bg-black relative overflow-hidden">
      {/* Background logo */}
      <div
        className="absolute inset-[10%] bg-contain bg-center bg-no-repeat opacity-10"
        style={{ backgroundImage: `url(${fuelRatsLogo})` }}
      />

      <div className="relative z-10 w-full max-w-sm px-4">
        <div className="bg-slate-900/90 backdrop-blur-md border border-slate-700 rounded-lg p-8 shadow-2xl">
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-orange-500">FuelRats Dispatch</h1>
            <p className="text-slate-400 text-sm mt-1">Enter your FuelRats API token to continue</p>
          </div>

          {/* Instructions */}
          <div className="mb-5 text-xs text-slate-400 bg-slate-800/60 border border-slate-700 rounded p-3 space-y-2">
            <p>Get your token from your FuelRats profile:</p>
            <a
              href="https://fuelrats.com/profile/tokens"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-orange-400 hover:text-orange-300 transition-colors"
            >
              fuelrats.com/profile/tokens
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">API Token</label>
              <Input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste your token here"
                autoComplete="off"
                disabled={loading}
                className="bg-slate-800 border-slate-600 text-white placeholder:text-slate-500 font-mono text-xs"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded p-3">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <Button
              type="submit"
              disabled={loading || !token.trim()}
              className="w-full bg-orange-600 hover:bg-orange-700 text-white"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Verifying…
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <LogIn className="w-4 h-4" />
                  Connect
                </span>
              )}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
