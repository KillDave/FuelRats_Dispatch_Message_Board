import { authService } from '../services/authService';
import { Button } from '@/app/components/ui/button';
import { LogIn } from 'lucide-react';
import fuelRatsLogo from './image/TransparentBackgroundRatto.png';

interface LoginScreenProps {
  onAuthenticated: () => void;
}

export function LoginScreen(_: LoginScreenProps) {
  return (
    <div className="h-full flex items-center justify-center bg-black relative overflow-hidden">
      <div
        className="absolute inset-[10%] bg-contain bg-center bg-no-repeat opacity-10"
        style={{ backgroundImage: `url(${fuelRatsLogo})` }}
      />

      <div className="relative z-10 w-full max-w-sm px-4">
        <div className="bg-slate-900/90 backdrop-blur-md border border-slate-700 rounded-lg p-8 shadow-2xl">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-orange-500">FuelRats Dispatch</h1>
            <p className="text-slate-400 text-sm mt-1">Sign in with your FuelRats account</p>
          </div>

          <Button
            type="button"
            onClick={() => authService.login()}
            className="w-full bg-orange-600 hover:bg-orange-700 text-white"
          >
            <span className="flex items-center gap-2">
              <LogIn className="w-4 h-4" />
              Sign in with FuelRats
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
}
