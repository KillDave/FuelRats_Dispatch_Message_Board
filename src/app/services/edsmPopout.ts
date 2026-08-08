import type { Case } from '../components/DispatchBoard';

/**
 * The slice of a Case the popout window actually renders. Sent whole, the
 * full Case carries messages/injections/etc. that would bloat the URL for
 * no reason -- the popout re-fetches its own EDSM data by system name and
 * only needs this much to render the header around it.
 */
export interface EdsmPopoutCaseInfo {
  id: string;
  clientName: string;
  ircNick?: string;
  oxygenStatus?: string;
  status: Case['status'];
  clientInChannel: boolean;
  platform: string;
  system: string;
  landmark?: { name: string; distance: number };
  language?: string;
  createdAt: string;
}

/** Opens (or refocuses) a standalone browser window showing this case's EDSM data. */
export function openEdsmPopout(caseData: Case): void {
  const info: EdsmPopoutCaseInfo = {
    id: caseData.id,
    clientName: caseData.clientName,
    ircNick: caseData.ircNick,
    oxygenStatus: caseData.oxygenStatus,
    status: caseData.status,
    clientInChannel: caseData.clientInChannel,
    platform: caseData.platform,
    system: caseData.system,
    landmark: caseData.landmark,
    language: caseData.language,
    createdAt: caseData.createdAt.toISOString(),
  };
  const encoded = encodeURIComponent(JSON.stringify(info));
  const url = `${window.location.origin}${window.location.pathname}#edsm?d=${encoded}`;
  // A stable per-case window name means clicking the trigger again for the
  // same case refocuses/reloads the existing popout instead of stacking more.
  window.open(url, `edsm-${caseData.id}`, 'width=760,height=880,noopener');
}

export function parseEdsmPopoutInfo(hash: string): EdsmPopoutCaseInfo | null {
  const qIndex = hash.indexOf('?');
  if (qIndex === -1) return null;
  const params = new URLSearchParams(hash.slice(qIndex + 1));
  const raw = params.get('d');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
