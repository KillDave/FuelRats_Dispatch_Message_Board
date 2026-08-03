const TOKEN_KEY = 'fr_dispatch_token';
const OAUTH_STATE_KEY = 'fr_oauth_state';


/** The group behind "Drilled Dispatch" — displayName is the readable form. */
const DISPATCH_GROUP = 'dispatch';

/**
 * The same group, by id.
 *
 * Needed because `/profile` does not always return group *attributes*. With
 * some tokens the `groups` relationship resolves and `included` carries the
 * right number of entries, but each one arrives as a bare resource identifier
 * with no `name` on it -- so matching by name silently finds nothing and
 * denies everyone.
 *
 * The id is on the relationship itself, which is always present, so it works
 * either way. These are fixed: the FuelRats groups were created in 2017 and
 * the ids have not moved since.
 */
const DISPATCH_GROUP_ID = 'aeb6e019-b818-48e4-84c0-439cb5cc6a3f';

/**
 * "Drilled Rat" — the group the board as a whole requires.
 *
 * Checked instead of the dispatch.read/dispatch.write permissions the gate
 * used to read. Those are granted by this very group (and by owner), so the
 * two agree today, but they are named after the dispatch board while being
 * granted by the *rat* group -- the `dispatch` group grants only
 * twitter.write. If those permission strings were ever moved onto the group
 * whose name they match, which is the obvious tidy-up for someone to make,
 * the old check would have silently started admitting Drilled Dispatch and
 * turning away Drilled Rats. The group is the thing actually meant.
 */
const RAT_GROUP = 'rat';
const RAT_GROUP_ID = '38f37675-d019-4288-abad-b117df4ac09c';

export interface FuelRatsGroup {
  id: string;
  name: string;
  displayName: string;
  priority: number;
}

/** Cleared on sign-out so the next account is not judged on this one. */
let groupsCache: Promise<FuelRatsGroup[]> | null = null;

const CLIENT_ID = import.meta.env.VITE_CLIENT_ID as string;
const REDIRECT_URI = `${window.location.origin}/callback`;
// users.read.me and groups.read.me are what let /profile return the `groups`
// relationship, which the dispatch gate reads. A token minted without them
// still answers /profile -- meta.permissions comes back regardless -- but the
// included groups may not, and a gate that cannot see groups denies everyone.
//
// Adding a scope does not upgrade tokens already issued: anyone signed in
// before this has to sign out and back in to get one that carries them.
const SCOPES = 'openid profile rescues.read users.read.me groups.read.me';

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
    // Textbook implicit grant delivers the token in the URL fragment (#), but
    // FuelRats' /authorize actually redirects with it in the query string
    // instead -- confirmed via the raw redirect Location header, which comes
    // back as `/callback?access_token=...&state=...`, not `#access_token=...`.
    const params = new URLSearchParams(window.location.search);

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
    // Both gates read from this, so it has to go with the token.
    groupsCache = null;
  },

  isAuthenticated(): boolean {
    return !!this.getToken();
  },

  logout(): void {
    this.clearToken();
  },

  // ── Permissions ───────────────────────────────────────────────────────────

  /**
   * The scopes granted to the token (SCOPES above) are just what this app asked
   * for. What a user can actually do comes from their group memberships, which
   * GET /profile reports back as `meta.permissions` regardless of token scope.
   */
  /**
   * The groups this account belongs to.
   *
   * Read rather than inferred from permissions, because the two do not line
   * up. Drilled Dispatch is the `dispatch` group, whose only permission is
   * `twitter.write` -- which admin, moderator, netadmin, operations, overseer,
   * owner and techrat all hold as well. Checking that permission would admit
   * seven groups of people who are not dispatchers, so the group name is the
   * only thing that answers the question.
   *
   * Conversely `dispatch.read`/`dispatch.write` are named after this board's
   * job but come from the `rat` group, not `dispatch`.
   */
  async getGroups(): Promise<FuelRatsGroup[]> {
    // Shared between the two gates. Both run on load, and without this the
    // board asked /profile twice for the same answer.
    if (!groupsCache) {
      groupsCache = this.loadGroups().catch((e) => {
        groupsCache = null;   // a failure should not be remembered
        throw e;
      });
    }
    return groupsCache;
  },

  async loadGroups(): Promise<FuelRatsGroup[]> {
    const token = this.getToken();
    if (!token) return [];

    const res = await fetch('https://api.fuelrats.com/profile', {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();

    // `included` is shared by every relationship on the document, so it is
    // filtered against this user's own group ids rather than trusted whole.
    const memberOf = json?.data?.relationships?.groups?.data;
    if (!Array.isArray(memberOf)) {
      // Says which of the two went missing, because they fail for different
      // reasons: no relationship at all means the token was not allowed to
      // read groups, while an empty `included` means it was allowed and the
      // account simply has none.
      console.warn(
        '[dispatcher gate] /profile returned no groups relationship — ' +
        'the token probably lacks groups.read.me. Sign out and back in.',
      );
      return [];
    }
    // Built from the relationship, which always carries ids, and only then
    // enriched from `included`. The other way round -- filtering `included`
    // and reading names off it -- produced entries with empty names whenever
    // the API sent bare resource identifiers, which is how this gate came to
    // deny an account that is plainly in the group.
    const details = new Map<string, any>();
    for (const item of json?.included ?? []) {
      if (item?.type === 'groups' && item?.attributes) {
        details.set(String(item.id), item.attributes);
      }
    }

    return memberOf
      .filter((g: any) => g?.id)
      .map((g: any) => {
        const id = String(g.id);
        const a = details.get(id);
        return {
          id,
          name: String(a?.name ?? ''),
          displayName: String(a?.displayName ?? ''),
          priority: Number(a?.priority ?? 0),
        };
      });
  },

  /** Whether this account is a Drilled Dispatch. */
  /** Whether this account is a Drilled Rat — what the board itself requires. */
  async isDrilledRat(): Promise<boolean> {
    const groups = await this.getGroups();
    return groups.some((g) => g.id === RAT_GROUP_ID || g.name === RAT_GROUP);
  },

  async isDispatcher(): Promise<boolean> {
    const groups = await this.getGroups();
    // By id first, since the name is not always sent. The name check stays as
    // the readable one for when attributes did come through.
    return groups.some((g) => g.id === DISPATCH_GROUP_ID || g.name === DISPATCH_GROUP);
  },

  async getPermissions(): Promise<string[]> {
    const token = this.getToken();
    if (!token) return [];

    const res = await fetch('https://api.fuelrats.com/profile', {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();
    return (json.data?.meta?.permissions as string[] | undefined) ?? [];
  },
};
