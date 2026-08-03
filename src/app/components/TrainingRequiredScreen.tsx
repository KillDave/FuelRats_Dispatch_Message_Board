import { Button } from '@/app/components/ui/button';
import { LogOut, GraduationCap, ClipboardCheck } from 'lucide-react';
import fuelRatsLogo from './image/TransparentBackgroundRatto.png';

interface TrainingRequiredScreenProps {
  onLogout: () => void;
}

export function TrainingRequiredScreen({ onLogout }: TrainingRequiredScreenProps) {
  return (
    <div className="h-full flex items-center justify-center bg-black relative overflow-hidden">
      <div
        className="absolute inset-[10%] bg-contain bg-center bg-no-repeat opacity-10"
        style={{ backgroundImage: `url(${fuelRatsLogo})` }}
      />

      <div className="relative z-10 w-full max-w-md px-4">
        <div className="bg-slate-900/90 backdrop-blur-md border border-slate-700 rounded-lg p-8 shadow-2xl flex flex-col gap-4">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-orange-500">404: Tail Not Found!</h1>
            <p className="text-slate-400 text-sm mt-2">
              Your account isn't drilled for dispatch yet, so the board is locked for now.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-sm text-slate-300">Think you're ready to get your drill?</p>
            <Button asChild className="w-full bg-orange-600 hover:bg-orange-700">
              <a href="https://confluence.fuelrats.com/display/FRKB/People+Who+Do+Stuff" target="_blank" rel="noopener noreferrer">
                <span className="flex items-center gap-2">
                  <ClipboardCheck className="w-4 h-4" />
                  Get Drilled
                </span>
              </a>
            </Button>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-sm text-slate-300">Need training first?</p>
            <Button asChild className="w-full bg-orange-600 hover:bg-orange-700">
              <a href="https://t.fuelr.at/training" target="_blank" rel="noopener noreferrer">
                <span className="flex items-center gap-2">
                  <GraduationCap className="w-4 h-4" />
                  Get Training
                </span>
              </a>
            </Button>
          </div>

          <Button
            type="button"
            onClick={onLogout}
            variant="outline"
            className="w-full border-slate-600 text-white bg-slate-800 hover:bg-slate-700 mt-2"
          >
            <span className="flex items-center gap-2">
              <LogOut className="w-4 h-4" />
              Log out
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
}
