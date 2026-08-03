import { useState, useEffect } from 'react';
import { DispatchBoard } from '@/app/components/DispatchBoard';
import { LoginScreen } from '@/app/components/LoginScreen';
import { DeepLTestPage } from '@/app/components/DeepLTestPage';
import { LangblyTestPage } from '@/app/components/LangblyTestPage';
import { ClientTestPage } from '@/app/components/ClientTestPage';
import { TrainingRequiredScreen } from '@/app/components/TrainingRequiredScreen';
import { authService } from '@/app/services/authService';

const DISPATCH_PERMISSIONS = ['dispatch.read', 'dispatch.write'];

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

type AccessState = 'checking' | 'granted' | 'denied';

export default function App() {
  const [authenticated, setAuthenticated] = useState(() => authService.isAuthenticated());
  const [hash, setHash] = useState(() => window.location.hash);
  const [access, setAccess] = useState<AccessState>('checking');

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    if (!authenticated) {
      setAccess('checking');
      return;
    }
    let cancelled = false;
    authService.getPermissions()
      .then((permissions) => {
        if (cancelled) return;
        const hasDispatchAccess = DISPATCH_PERMISSIONS.every((p) => permissions.includes(p));
        setAccess(hasDispatchAccess ? 'granted' : 'denied');
      })
      .catch((e) => {
        console.error('Failed to fetch permissions:', e);
        if (!cancelled) setAccess('denied');
      });
    return () => { cancelled = true; };
  }, [authenticated]);

  const handleLogout = () => {
    authService.logout();
    setAuthenticated(false);
  };

  if (hash === '#deepl') {
    return (
      <div className="h-[100dvh] flex flex-col">
        <DeepLTestPage onBack={() => { window.location.hash = ''; setHash(''); }} />
      </div>
    );
  }

  if (hash === '#langbly') {
    return (
      <div className="h-[100dvh] flex flex-col">
        <LangblyTestPage onBack={() => { window.location.hash = ''; setHash(''); }} />
      </div>
    );
  }

  if (hash === '#clienttest') {
    return (
      <div className="h-[100dvh] flex flex-col">
        <ClientTestPage onBack={() => { window.location.hash = ''; setHash(''); }} />
      </div>
    );
  }

  if (hash === '#training') {
    return (
      <div className="h-[100dvh] flex flex-col">
        <TrainingRequiredScreen onLogout={() => { window.location.hash = ''; setHash(''); }} />
      </div>
    );
  }

  return (
    <div className="h-[100dvh] flex flex-col">
      {!authenticated ? (
        <LoginScreen onAuthenticated={() => setAuthenticated(true)} />
      ) : access === 'granted' ? (
        <DispatchBoard onLogout={handleLogout} />
      ) : access === 'denied' ? (
        <TrainingRequiredScreen onLogout={handleLogout} />
      ) : null}
    </div>
  );
}
