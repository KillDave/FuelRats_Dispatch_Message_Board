const TOKEN_KEY = 'fr_dispatch_token';
const OAUTH_STATE_KEY = 'fr_oauth_state';


const CLIENT_ID = import.meta.env.VITE_CLIENT_ID as string;
const REDIRECT_URI = `${window.location.origin}/callback`;
const SCOPES = 'openid profile rescues.read';

export const authService = {
  // ── OAuth2 Implicit Grant ────────────────────────────────────────────────

  /** Redirect the browser to the FuelRats login/authorise page. */
  login(): void {
    const state = crypto.randomUUID();
    sessionStorage.setItem(OAUTH_STATE_KEY, state);

    const params = new URLSearchParams({
      response_type: 'token',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: SCOPES,
      state,
    });

    window.location.href = `https://fuelrats.com/authorize?${params}`;
  },

  /**
   * Call this on the /callback path to extract the token from the URL fragment.
   * Returns the access token on success, or throws on error / state mismatch.
   */
  handleCallback(): string {
    // Implicit grant delivers the token in the URL fragment (#), not the query
    // string, so it is never sent to servers or stored in browser history.
    const params = new URLSearchParams(window.location.hash.substring(1));

    const error = params.get('error');
    if (error) {
      throw new Error(`OAuth error: ${error} — ${params.get('error_description') ?? ''}`);
    }

    const state = params.get('state');
    const savedState = sessionStorage.getItem(OAUTH_STATE_KEY);
    sessionStorage.removeItem(OAUTH_STATE_KEY);
    if (state !== savedState) {
      throw new Error('OAuth state mismatch — possible CSRF attack');
    }

    const token = params.get('access_token');
    if (!token) throw new Error('No access_token in callback URL');

    this.setToken(token);

    // Strip the fragment (and token) from the browser history entry so the
    // token cannot leak via Referer headers or be re-read from history.
    window.history.replaceState({}, '', window.location.pathname);

    return token;
  },

  // ── Token storage (used by both OAuth and manual-token fallback) ─────────

  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY) || null;
  },

  setToken(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
  },

  clearToken(): void {
    localStorage.removeItem(TOKEN_KEY);
  },

  isAuthenticated(): boolean {
    return !!this.getToken();
  },

  logout(): void {
    this.clearToken();
  },
};
