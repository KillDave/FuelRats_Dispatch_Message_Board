import { useState } from 'react';
import { authService } from '../services/authService';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { AlertTriangle, LogIn, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';
import fuelRatsLogo from './image/TransparentBackgroundRatto.png';

interface LoginScreenProps {
  onAuthenticated: () => void;
}

export function LoginScreen({ onAuthenticated }: LoginScreenProps) {
  const [showManual, setShowManual] = useState(false);
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleOAuthLogin = () => {
    authService.login();
    // Page will redirect — nothing more to do here.
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        'https://fuelrats.com/api/fr/rescues?filter[status][ne]=closed&sort=-createdAt',
        { headers: { Authorization: `Bearer ${trimmed}` } },
      );

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
            <p className="text-slate-400 text-sm mt-1">Sign in with your FuelRats account</p>
          </div>

          {/* OAuth login button */}
          <Button
            onClick={handleOAuthLogin}
            className="w-full bg-orange-600 hover:bg-orange-700 text-white mb-6"
          >
            <LogIn className="w-4 h-4 mr-2" />
            Login with FuelRats
          </Button>

          {error && (
            <div className="flex items-start gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded p-3 mb-4">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Manual token fallback */}
          <div className="border-t border-slate-700 pt-4">
            <button
              type="button"
              onClick={() => setShowManual((v) => !v)}
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors w-full"
            >
              {showManual ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              Use an API token instead
            </button>

            {showManual && (
              <div className="mt-4 space-y-3">
                <div className="text-xs text-slate-400 bg-slate-800/60 border border-slate-700 rounded p-3 space-y-2">
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

                <form onSubmit={handleManualSubmit} className="space-y-3">
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

                  <Button
                    type="submit"
                    disabled={loading || !token.trim()}
                    className="w-full bg-slate-700 hover:bg-slate-600 text-white"
                  >
                    {loading ? (
                      <span className="flex items-center gap-2">
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Verifying…
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <LogIn className="w-4 h-4" />
                        Connect with Token
                      </span>
                    )}
                  </Button>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
