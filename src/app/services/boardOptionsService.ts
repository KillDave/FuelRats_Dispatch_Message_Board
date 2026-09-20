const AUTO_EXPAND_QUOTES_STORAGE = 'fr_auto_expand_quotes';

export function getAutoExpandQuotes(): boolean {
  return localStorage.getItem(AUTO_EXPAND_QUOTES_STORAGE) === 'true';
}

export function setAutoExpandQuotes(value: boolean): void {
  localStorage.setItem(AUTO_EXPAND_QUOTES_STORAGE, String(value));
}
