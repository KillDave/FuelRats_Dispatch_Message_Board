const TOKEN_KEY = 'fr_dispatch_token';

export const authService = {
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
