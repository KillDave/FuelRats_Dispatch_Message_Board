import type { QuickMessage, QuickMessageGroup } from './quickMessages';

export const BUTTON_GROUPS_KEY = 'fr-button-groups';
// Legacy keys — kept for one-time migration only
export const DISPATCH_CONFIG_KEY = 'fuelrats-dispatch-config';
export const RESCUE_CONFIG_KEY = 'fuelrats-rescue-config';

/** Walk the subgroup path and return the node there. */
export function getGroupAtPath(root: QuickMessageGroup, path: number[]): QuickMessageGroup {
  return path.reduce<QuickMessageGroup>((node, idx) => node.subgroups![idx], root);
}

/** Return a new root with the group at path replaced by fn(oldGroup). */
export function updateGroupAtPath(
  root: QuickMessageGroup,
  path: number[],
  fn: (g: QuickMessageGroup) => QuickMessageGroup,
): QuickMessageGroup {
  if (path.length === 0) return fn(root);
  const subs = [...(root.subgroups ?? [])];
  subs[path[0]] = updateGroupAtPath(subs[path[0]], path.slice(1), fn);
  return { ...root, subgroups: subs };
}

export function updateMessageAtPath(
  root: QuickMessageGroup,
  groupPath: number[],
  msgIdx: number,
  msg: QuickMessage,
): QuickMessageGroup {
  return updateGroupAtPath(root, groupPath, (g) => {
    const msgs = [...(g.messages ?? [])];
    msgs[msgIdx] = msg;
    return { ...g, messages: msgs };
  });
}

export function addSubgroupAtPath(root: QuickMessageGroup, path: number[]): QuickMessageGroup {
  return updateGroupAtPath(root, path, (g) => ({
    ...g,
    subgroups: [...(g.subgroups ?? []), { label: 'New Group', messages: [] }],
  }));
}

export function addMessageAtPath(root: QuickMessageGroup, path: number[]): QuickMessageGroup {
  return updateGroupAtPath(root, path, (g) => ({
    ...g,
    messages: [...(g.messages ?? []), { label: 'New Button', message: '' }],
  }));
}

export function deleteSubgroupAtPath(root: QuickMessageGroup, path: number[]): QuickMessageGroup {
  if (path.length === 0) throw new Error('Cannot delete root');
  const parentPath = path.slice(0, -1);
  const idx = path[path.length - 1];
  return updateGroupAtPath(root, parentPath, (g) => ({
    ...g,
    subgroups: (g.subgroups ?? []).filter((_, i) => i !== idx),
  }));
}

export function deleteMessageAtPath(
  root: QuickMessageGroup,
  groupPath: number[],
  msgIdx: number,
): QuickMessageGroup {
  return updateGroupAtPath(root, groupPath, (g) => ({
    ...g,
    messages: (g.messages ?? []).filter((_, i) => i !== msgIdx),
  }));
}

export function moveSubgroupAtPath(
  root: QuickMessageGroup,
  path: number[],
  dir: 'up' | 'down',
): QuickMessageGroup {
  if (path.length === 0) return root;
  const parentPath = path.slice(0, -1);
  const idx = path[path.length - 1];
  return updateGroupAtPath(root, parentPath, (g) => {
    const subs = [...(g.subgroups ?? [])];
    const j = dir === 'up' ? idx - 1 : idx + 1;
    if (j < 0 || j >= subs.length) return g;
    [subs[idx], subs[j]] = [subs[j], subs[idx]];
    return { ...g, subgroups: subs };
  });
}

export function moveMessageAtPath(
  root: QuickMessageGroup,
  groupPath: number[],
  msgIdx: number,
  dir: 'up' | 'down',
): QuickMessageGroup {
  return updateGroupAtPath(root, groupPath, (g) => {
    const msgs = [...(g.messages ?? [])];
    const j = dir === 'up' ? msgIdx - 1 : msgIdx + 1;
    if (j < 0 || j >= msgs.length) return g;
    [msgs[msgIdx], msgs[j]] = [msgs[j], msgs[msgIdx]];
    return { ...g, messages: msgs };
  });
}
