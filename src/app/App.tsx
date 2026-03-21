import { useState } from 'react';
import { DispatchBoard } from '@/app/components/DispatchBoard';
import { LoginScreen } from '@/app/components/LoginScreen';
import { authService } from '@/app/services/authService';

function handleOAuthCallback(): boolean {
  if (window.location.pathname !== '/callback') return false;
  try {
    authService.handleCallback();
  } catch (e) {
    console.error('OAuth callback failed:', e);
  }
  // Clean up the URL regardless of success/failure
  window.history.replaceState({}, '', '/');
  return true;
}

// Run once on load — processes the callback if we're on /callback
handleOAuthCallback();

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
