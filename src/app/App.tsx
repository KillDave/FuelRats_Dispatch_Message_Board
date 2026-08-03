import { useState, useEffect } from 'react';
import { DispatchBoard } from '@/app/components/DispatchBoard';
import { LoginScreen } from '@/app/components/LoginScreen';
import { DeepLTestPage } from '@/app/components/DeepLTestPage';
import { LangblyTestPage } from '@/app/components/LangblyTestPage';
import { ClientTestPage } from '@/app/components/ClientTestPage';
import { TrainingRequiredScreen } from '@/app/components/TrainingRequiredScreen';
import { CaseSearchPage } from '@/app/components/CaseSearchPage';
import { authService } from '@/app/services/authService';
import { useDispatcher, resetDispatcherCache } from '@/app/hooks/useDispatcher';


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
  const dispatcher = useDispatcher();
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
    // The Drilled Rat group, rather than the dispatch.read/dispatch.write
    // permissions this used to read. Those come from this same group, so the
    // two agree -- but they are named for the dispatch board while being
    // granted by the rat group, and would quietly change meaning if that were
    // ever tidied up. See RAT_GROUP in authService.
    authService.isDrilledRat()
      .then((ok) => {
        if (!cancelled) setAccess(ok ? 'granted' : 'denied');
      })
      .catch((e) => {
        console.error('Failed to read groups:', e);
        if (!cancelled) setAccess('denied');
      });
    return () => { cancelled = true; };
  }, [authenticated]);

  const handleLogout = () => {
    authService.logout();
    // The dispatcher answer is cached for the life of the page, so it has to
    // be dropped here: signing back in as a different account would otherwise
    // inherit whether the *previous* one was a dispatch.
    resetDispatcherCache();
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

  // Only a route for a drilled dispatch. For anyone else it is not refused,
  // it simply is not there: the hash falls through and the board renders as
  // though nothing was typed.
  if (hash === '#search' && dispatcher === 'allowed') {
    return (
      <div className="h-[100dvh] flex flex-col">
        <CaseSearchPage onBack={() => { window.location.hash = ''; setHash(''); }} />
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
