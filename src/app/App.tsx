import { useState } from 'react';
import { DispatchBoard } from '@/app/components/DispatchBoard';
import { LoginScreen } from '@/app/components/LoginScreen';
import { authService } from '@/app/services/authService';

export default function App() {
  const [authenticated, setAuthenticated] = useState(() => authService.isAuthenticated());

  const handleLogout = () => {
    authService.logout();
    setAuthenticated(false);
  };

  return (
    <div className="h-[100dvh] flex flex-col">
      {authenticated ? (
        <DispatchBoard onLogout={handleLogout} />
      ) : (
        <LoginScreen onAuthenticated={() => setAuthenticated(true)} />
      )}
    </div>
  );
}
