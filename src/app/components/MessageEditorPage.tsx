import React, { useState, useCallback } from 'react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import type { QuickMessage, QuickMessageGroup } from '../config/quickMessages';
import { dispatchMessages, rescueMessages } from '../config/quickMessages';
import {
  BUTTON_GROUPS_KEY,
  DISPATCH_CONFIG_KEY,
  RESCUE_CONFIG_KEY,
  getGroupAtPath,
  updateGroupAtPath,
  updateMessageAtPath,
  addSubgroupAtPath,
  addMessageAtPath,
  deleteSubgroupAtPath,
  deleteMessageAtPath,
  moveSubgroupAtPath,
  moveMessageAtPath,
} from '../config/messageTreeHelpers';
import {
  ArrowLeft, Plus, Trash2, ChevronDown, ChevronRight,
  ArrowUp, ArrowDown, RotateCcw, MessageSquare, Folder, FolderOpen,
} from 'lucide-react';

// ── Types ───────────────────────────────────────────────────────

type Selected =
  | { rootIdx: number; kind: 'group'; path: number[] }
  | { rootIdx: number; kind: 'message'; groupPath: number[]; msgIdx: number }
  | null;

// ── Helpers ─────────────────────────────────────────────────────

function hasAdvancedFeatures(msg: QuickMessage) {
  return !!(msg.variants?.length || msg.trVariants?.length || msg.platformVariants || msg.trPlatformVariants);
}

/** Returns true if the message needs JSON mode (weighted variants or trPlatformVariants). */
function forcesJsonMode(msg: QuickMessage) {
  const hasWeightedV  = msg.variants?.some(v => typeof v !== 'string');
  const hasWeightedTr = msg.trVariants?.some(v => typeof v !== 'string');
  return !!(hasWeightedV || hasWeightedTr || msg.trPlatformVariants);
}

function deepCopy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

const RESCUE_DEFAULT: QuickMessageGroup = { label: 'RESCUE', messages: rescueMessages };
const DEFAULT_BUTTON_GROUPS: QuickMessageGroup[] = [
  deepCopy(RESCUE_DEFAULT),
  deepCopy(dispatchMessages),
];

function loadButtonGroups(): QuickMessageGroup[] {
  try {
    const s = localStorage.getItem(BUTTON_GROUPS_KEY);
    if (s) return JSON.parse(s) as QuickMessageGroup[];
  } catch {}
  // Migrate from old separate keys
  if (localStorage.getItem(RESCUE_CONFIG_KEY) !== null || localStorage.getItem(DISPATCH_CONFIG_KEY) !== null) {
    const rescue = (() => { try { const s = localStorage.getItem(RESCUE_CONFIG_KEY); return s ? JSON.parse(s) as QuickMessageGroup : deepCopy(RESCUE_DEFAULT); } catch { return deepCopy(RESCUE_DEFAULT); } })();
    const dispatch = (() => { try { const s = localStorage.getItem(DISPATCH_CONFIG_KEY); return s ? JSON.parse(s) as QuickMessageGroup : deepCopy(dispatchMessages); } catch { return deepCopy(dispatchMessages); } })();
    return [rescue, dispatch];
  }
  return deepCopy(DEFAULT_BUTTON_GROUPS);
}

// ── Component ────────────────────────────────────────────────────

export function MessageEditorPage({ onBack }: { onBack: () => void }) {
  const [buttonGroups, setButtonGroupsRaw] = useState<QuickMessageGroup[]>(loadButtonGroups);
  const [selected, setSelected] = useState<Selected>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const groups = loadButtonGroups();
    const s = new Set<string>();
    groups.forEach((_, i) => s.add(`${i}-root`));
    return s;
  });

  const [groupDraft, setGroupDraft] = useState({ label: '', keepOpen: false });

  const blankMsg = () => ({
    label: '', message: '',
    hasTrMessage: false, trMessage: '',
    hasVariants: false, variantsText: '',
    hasTrVariants: false, trVariantsText: '',
    hasPlatformVariants: false,
    pvPc: '', pvXbox: '', pvPlaystation: '', pvLegacy: '', pvDefault: '',
    editMode: 'simple' as 'simple' | 'json',
    jsonText: '', jsonError: null as string | null,
  });
  const [msgDraft, setMsgDraft] = useState(blankMsg());

  // Persist on every change
  const setButtonGroups = useCallback((fn: QuickMessageGroup[] | ((prev: QuickMessageGroup[]) => QuickMessageGroup[])) => {
    setButtonGroupsRaw(prev => {
      const next = typeof fn === 'function' ? fn(prev) : fn;
      localStorage.setItem(BUTTON_GROUPS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const cfgFor = (rootIdx: number) => buttonGroups[rootIdx];

  const setCfgForIdx = useCallback((rootIdx: number, updater: QuickMessageGroup | ((prev: QuickMessageGroup) => QuickMessageGroup)) => {
    setButtonGroups((prevGroups: QuickMessageGroup[]) => {
      const next = [...prevGroups];
      next[rootIdx] = typeof updater === 'function' ? updater(prevGroups[rootIdx]) : updater;
      return next;
    });
  }, [setButtonGroups]);

  // ── Selection ─────────────────────────────────────────────────

  const selectGroup = useCallback((rootIdx: number, path: number[], groups?: QuickMessageGroup[]) => {
    const cfg = (groups ?? buttonGroups)[rootIdx];
    const g = getGroupAtPath(cfg, path);
    setGroupDraft({ label: g.label, keepOpen: !!g.keepOpen });
    setSelected({ rootIdx, kind: 'group', path });
  }, [buttonGroups]);

  const selectMessage = useCallback((rootIdx: number, groupPath: number[], msgIdx: number, groups?: QuickMessageGroup[]) => {
    const cfg = (groups ?? buttonGroups)[rootIdx];
    const msg = getGroupAtPath(cfg, groupPath).messages![msgIdx];
    const useJson = forcesJsonMode(msg);
    const pv = msg.platformVariants ?? {};
    const variantsSimple = (msg.variants ?? []).filter((v): v is string => typeof v === 'string');
    const trVariantsSimple = (msg.trVariants ?? []).filter((v): v is string => typeof v === 'string');
    setMsgDraft({
      label: msg.label,
      message: msg.message,
      hasTrMessage: !!msg.trMessage,
      trMessage: msg.trMessage ?? '',
      hasVariants: !!(msg.variants?.length),
      variantsText: variantsSimple.join('\n'),
      hasTrVariants: !!(msg.trVariants?.length),
      trVariantsText: trVariantsSimple.join('\n'),
      hasPlatformVariants: !!msg.platformVariants,
      pvPc: pv.pc ?? '',
      pvXbox: pv.xbox ?? '',
      pvPlaystation: pv.playstation ?? '',
      pvLegacy: pv.legacy ?? '',
      pvDefault: pv.default ?? '',
      editMode: useJson ? 'json' : 'simple',
      jsonText: JSON.stringify(msg, null, 2),
      jsonError: null,
    });
    setSelected({ rootIdx, kind: 'message', groupPath, msgIdx });
  }, [buttonGroups]);

  const toggleExpand = (key: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  // ── Tree mutations (within a root group) ──────────────────────

  const doAddSubgroup = (rootIdx: number, path: number[]) => {
    const cfg = cfgFor(rootIdx);
    const newIdx = (getGroupAtPath(cfg, path).subgroups ?? []).length;
    const newCfg = addSubgroupAtPath(cfg, path);
    const newGroups = [...buttonGroups];
    newGroups[rootIdx] = newCfg;
    setButtonGroups(newGroups);
    setExpanded(prev => new Set([...prev, `${rootIdx}-${path.join('-') || 'root'}`]));
    selectGroup(rootIdx, [...path, newIdx], newGroups);
  };

  const doAddMessage = (rootIdx: number, path: number[]) => {
    const cfg = cfgFor(rootIdx);
    const newIdx = (getGroupAtPath(cfg, path).messages ?? []).length;
    const newCfg = addMessageAtPath(cfg, path);
    const newGroups = [...buttonGroups];
    newGroups[rootIdx] = newCfg;
    setButtonGroups(newGroups);
    setExpanded(prev => new Set([...prev, `${rootIdx}-${path.join('-') || 'root'}`]));
    selectMessage(rootIdx, path, newIdx, newGroups);
  };

  const doDeleteGroup = (rootIdx: number, path: number[]) => {
    if (selected?.kind === 'group' && selected.rootIdx === rootIdx && selected.path.join('-') === path.join('-')) setSelected(null);
    if (selected?.kind === 'message' && selected.rootIdx === rootIdx && selected.groupPath.join('-').startsWith(path.join('-'))) setSelected(null);
    setCfgForIdx(rootIdx, deleteSubgroupAtPath(cfgFor(rootIdx), path));
  };

  const doDeleteMessage = (rootIdx: number, groupPath: number[], msgIdx: number) => {
    if (selected?.kind === 'message' && selected.rootIdx === rootIdx && selected.groupPath.join('-') === groupPath.join('-') && selected.msgIdx === msgIdx) setSelected(null);
    setCfgForIdx(rootIdx, deleteMessageAtPath(cfgFor(rootIdx), groupPath, msgIdx));
  };

  // ── Root-level mutations ──────────────────────────────────────

  const doAddRoot = () => {
    const newGroup: QuickMessageGroup = { label: 'New Group', messages: [] };
    const newGroups = [...buttonGroups, newGroup];
    setButtonGroups(newGroups);
    const newIdx = newGroups.length - 1;
    setExpanded(prev => new Set([...prev, `${newIdx}-root`]));
    selectGroup(newIdx, [], newGroups);
  };

  const doDeleteRoot = (rootIdx: number) => {
    if (!window.confirm(`Delete "${buttonGroups[rootIdx].label}"? This cannot be undone.`)) return;
    if (selected?.rootIdx === rootIdx) setSelected(null);
    setButtonGroups(buttonGroups.filter((_, i) => i !== rootIdx));
  };

  const doMoveRoot = (rootIdx: number, dir: 'up' | 'down') => {
    const j = dir === 'up' ? rootIdx - 1 : rootIdx + 1;
    if (j < 0 || j >= buttonGroups.length) return;
    const newGroups = [...buttonGroups];
    [newGroups[rootIdx], newGroups[j]] = [newGroups[j], newGroups[rootIdx]];
    setButtonGroups(newGroups);
    if (selected?.rootIdx === rootIdx) setSelected({ ...selected, rootIdx: j });
    else if (selected?.rootIdx === j) setSelected({ ...selected, rootIdx });
  };

  const resetToDefaults = () => {
    if (!window.confirm('Reset all messages to defaults? This cannot be undone.')) return;
    const defaults = deepCopy(DEFAULT_BUTTON_GROUPS);
    setButtonGroups(defaults);
    setSelected(null);
    const s = new Set<string>(['0-root', '1-root']);
    defaults[1]?.subgroups?.forEach((_, i) => s.add(`1-${i}`));
    setExpanded(s);
  };

  // ── Edit panel handlers ───────────────────────────────────────

  const saveGroupDraft = () => {
    if (!selected || selected.kind !== 'group' || !groupDraft.label.trim()) return;
    setCfgForIdx(selected.rootIdx, updateGroupAtPath(cfgFor(selected.rootIdx), selected.path, g => ({
      ...g, label: groupDraft.label.trim(), keepOpen: groupDraft.keepOpen,
    })));
  };

  const switchToJson = () =>
    setMsgDraft(f => {
      const pv: Record<string, string> = {};
      if (f.hasPlatformVariants) {
        if (f.pvPc)          pv.pc          = f.pvPc;
        if (f.pvXbox)        pv.xbox        = f.pvXbox;
        if (f.pvPlaystation) pv.playstation = f.pvPlaystation;
        if (f.pvLegacy)      pv.legacy      = f.pvLegacy;
        if (f.pvDefault)     pv.default     = f.pvDefault;
      }
      const obj: Record<string, unknown> = {
        label: f.label || 'Button',
        message: f.message,
        ...(f.hasTrMessage && f.trMessage ? { trMessage: f.trMessage } : {}),
        ...(f.hasVariants && f.variantsText.trim() ? { variants: f.variantsText.split('\n').map(s => s.trim()).filter(Boolean) } : {}),
        ...(f.hasTrVariants && f.trVariantsText.trim() ? { trVariants: f.trVariantsText.split('\n').map(s => s.trim()).filter(Boolean) } : {}),
        ...(f.hasPlatformVariants && Object.keys(pv).length ? { platformVariants: pv } : {}),
      };
      return { ...f, editMode: 'json', jsonError: null, jsonText: JSON.stringify(obj, null, 2) };
    });

  const switchToSimple = () => {
    try {
      const parsed = JSON.parse(msgDraft.jsonText) as QuickMessage;
      if (forcesJsonMode(parsed)) {
        setMsgDraft(f => ({ ...f, jsonError: 'This message has weighted variants or trPlatformVariants — keep it in JSON mode.' }));
        return;
      }
      const pv = parsed.platformVariants ?? {};
      const variantsSimple = (parsed.variants ?? []).filter((v): v is string => typeof v === 'string');
      const trVariantsSimple = (parsed.trVariants ?? []).filter((v): v is string => typeof v === 'string');
      setMsgDraft(f => ({
        ...f,
        editMode: 'simple', jsonError: null,
        label: parsed.label ?? '',
        message: parsed.message ?? '',
        hasTrMessage: !!parsed.trMessage,
        trMessage: parsed.trMessage ?? '',
        hasVariants: !!(parsed.variants?.length),
        variantsText: variantsSimple.join('\n'),
        hasTrVariants: !!(parsed.trVariants?.length),
        trVariantsText: trVariantsSimple.join('\n'),
        hasPlatformVariants: !!parsed.platformVariants,
        pvPc: pv.pc ?? '', pvXbox: pv.xbox ?? '', pvPlaystation: pv.playstation ?? '',
        pvLegacy: pv.legacy ?? '', pvDefault: pv.default ?? '',
      }));
    } catch {
      setMsgDraft(f => ({ ...f, jsonError: 'Fix JSON before switching.' }));
    }
  };

  const saveMsgDraft = () => {
    if (!selected || selected.kind !== 'message') return;
    let entry: QuickMessage;
    if (msgDraft.editMode === 'json') {
      try {
        entry = JSON.parse(msgDraft.jsonText) as QuickMessage;
        if (!entry.label?.trim() || !entry.message?.trim()) throw new Error('label and message are required.');
      } catch (e) {
        setMsgDraft(f => ({ ...f, jsonError: e instanceof Error ? e.message : 'Invalid JSON.' }));
        return;
      }
    } else {
      if (!msgDraft.label.trim() || !msgDraft.message.trim()) return;
      const pv: Record<string, string> = {};
      if (msgDraft.hasPlatformVariants) {
        if (msgDraft.pvPc)          pv.pc          = msgDraft.pvPc;
        if (msgDraft.pvXbox)        pv.xbox        = msgDraft.pvXbox;
        if (msgDraft.pvPlaystation) pv.playstation = msgDraft.pvPlaystation;
        if (msgDraft.pvLegacy)      pv.legacy      = msgDraft.pvLegacy;
        if (msgDraft.pvDefault)     pv.default     = msgDraft.pvDefault;
      }
      entry = {
        label: msgDraft.label.trim(),
        message: msgDraft.message.trim(),
        ...(msgDraft.hasTrMessage && msgDraft.trMessage.trim() ? { trMessage: msgDraft.trMessage.trim() } : {}),
        ...(msgDraft.hasVariants && msgDraft.variantsText.trim()
          ? { variants: msgDraft.variantsText.split('\n').map(s => s.trim()).filter(Boolean) }
          : {}),
        ...(msgDraft.hasTrVariants && msgDraft.trVariantsText.trim()
          ? { trVariants: msgDraft.trVariantsText.split('\n').map(s => s.trim()).filter(Boolean) }
          : {}),
        ...(msgDraft.hasPlatformVariants && Object.keys(pv).length ? { platformVariants: pv } : {}),
      };
    }
    setCfgForIdx(selected.rootIdx, updateMessageAtPath(cfgFor(selected.rootIdx), selected.groupPath, selected.msgIdx, entry));
  };

  // ── Tree rendering ────────────────────────────────────────────

  const renderGroupNode = (rootIdx: number, sg: QuickMessageGroup, path: number[], depth: number): React.ReactNode => {
    const pathStr = path.join('-');
    const expandKey = `${rootIdx}-${pathStr}`;
    const isExpanded = expanded.has(expandKey);
    const isSelected = selected?.kind === 'group' && selected.rootIdx === rootIdx && selected.path.join('-') === pathStr;

    return (
      <div key={`${rootIdx}-g-${pathStr}`}>
        <div
          style={{ paddingLeft: depth * 16 + 8 }}
          className={`flex items-center gap-1 py-[3px] pr-1 rounded select-none group/row cursor-pointer ${
            isSelected ? 'bg-orange-600/20 text-orange-300' : 'text-slate-300 hover:bg-slate-800'
          }`}
        >
          <button onClick={(e) => { e.stopPropagation(); toggleExpand(expandKey); }} className="flex-shrink-0 text-slate-500 hover:text-white p-px rounded">
            {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
          <span className="flex-shrink-0 text-slate-400">
            {isExpanded ? <FolderOpen className="w-3 h-3" /> : <Folder className="w-3 h-3" />}
          </span>
          <span onClick={() => selectGroup(rootIdx, path)} className="flex-1 text-xs font-medium truncate min-w-0 py-0.5">
            {sg.label || <span className="italic text-slate-600">unnamed</span>}
          </span>
          {sg.keepOpen && (
            <span className="text-[9px] text-orange-400 border border-orange-400/30 rounded px-0.5 flex-shrink-0">↩</span>
          )}
          <div className="flex items-center gap-px opacity-0 group-hover/row:opacity-100 transition-opacity flex-shrink-0">
            <button onClick={(e) => { e.stopPropagation(); doAddSubgroup(rootIdx, path); }} className="p-px text-slate-500 hover:text-green-400 rounded" title="Add sub-group"><Folder className="w-3 h-3" /></button>
            <button onClick={(e) => { e.stopPropagation(); doAddMessage(rootIdx, path); }} className="p-px text-slate-500 hover:text-blue-400 rounded" title="Add message"><MessageSquare className="w-3 h-3" /></button>
            <button onClick={(e) => { e.stopPropagation(); setCfgForIdx(rootIdx, c => moveSubgroupAtPath(c, path, 'up')); }} className="p-px text-slate-500 hover:text-white rounded" title="Move up"><ArrowUp className="w-3 h-3" /></button>
            <button onClick={(e) => { e.stopPropagation(); setCfgForIdx(rootIdx, c => moveSubgroupAtPath(c, path, 'down')); }} className="p-px text-slate-500 hover:text-white rounded" title="Move down"><ArrowDown className="w-3 h-3" /></button>
            <button onClick={(e) => { e.stopPropagation(); doDeleteGroup(rootIdx, path); }} className="p-px text-slate-500 hover:text-red-400 rounded" title="Delete group"><Trash2 className="w-3 h-3" /></button>
          </div>
        </div>
        {isExpanded && (
          <div>
            {(sg.subgroups ?? []).map((child, ci) => renderGroupNode(rootIdx, child, [...path, ci], depth + 1))}
            {(sg.messages ?? []).map((msg, mi) => renderMessageNode(rootIdx, msg, path, mi, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const renderMessageNode = (rootIdx: number, msg: QuickMessage, groupPath: number[], msgIdx: number, depth: number): React.ReactNode => {
    const groupPathStr = groupPath.join('-');
    const isSelected = selected?.kind === 'message' && selected.rootIdx === rootIdx && selected.groupPath.join('-') === groupPathStr && selected.msgIdx === msgIdx;
    const key = `${rootIdx}-m-${groupPathStr || 'root'}-${msgIdx}`;

    return (
      <div
        key={key}
        style={{ paddingLeft: depth * 16 + 8 + 16 }}
        className={`flex items-center gap-1 py-[3px] pr-1 rounded select-none group/msg cursor-pointer ${
          isSelected ? 'bg-orange-600/20 text-orange-300' : 'text-slate-400 hover:bg-slate-800'
        }`}
      >
        <span className="flex-shrink-0"><MessageSquare className="w-3 h-3" /></span>
        <span onClick={() => selectMessage(rootIdx, groupPath, msgIdx)} className="flex-1 text-xs truncate min-w-0 py-0.5">
          {msg.label || <span className="italic text-slate-600">unnamed</span>}
        </span>
        {hasAdvancedFeatures(msg) && (
          <span className="text-[9px] text-cyan-400 border border-cyan-400/30 rounded px-0.5 flex-shrink-0">adv</span>
        )}
        <div className="flex items-center gap-px opacity-0 group-hover/msg:opacity-100 transition-opacity flex-shrink-0">
          <button onClick={(e) => { e.stopPropagation(); setCfgForIdx(rootIdx, c => moveMessageAtPath(c, groupPath, msgIdx, 'up')); setSelected(null); }} className="p-px text-slate-500 hover:text-white rounded" title="Move up"><ArrowUp className="w-3 h-3" /></button>
          <button onClick={(e) => { e.stopPropagation(); setCfgForIdx(rootIdx, c => moveMessageAtPath(c, groupPath, msgIdx, 'down')); setSelected(null); }} className="p-px text-slate-500 hover:text-white rounded" title="Move down"><ArrowDown className="w-3 h-3" /></button>
          <button onClick={(e) => { e.stopPropagation(); doDeleteMessage(rootIdx, groupPath, msgIdx); }} className="p-px text-slate-500 hover:text-red-400 rounded" title="Delete"><Trash2 className="w-3 h-3" /></button>
        </div>
      </div>
    );
  };

  const renderRootSection = (rootIdx: number, cfg: QuickMessageGroup) => {
    const expandKey = `${rootIdx}-root`;
    const isExpanded = expanded.has(expandKey);
    const isSelected = selected?.kind === 'group' && selected.rootIdx === rootIdx && selected.path.length === 0;

    return (
      <div key={rootIdx}>
        <div className={`flex items-center gap-1 px-2 py-[3px] rounded select-none group/root cursor-pointer ${
          isSelected ? 'bg-orange-600/20 text-orange-300' : 'text-slate-200 hover:bg-slate-800'
        }`}>
          <button onClick={(e) => { e.stopPropagation(); toggleExpand(expandKey); }} className="flex-shrink-0 text-slate-500 hover:text-white p-px rounded">
            {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
          <span className="flex-shrink-0 text-slate-300">
            {isExpanded ? <FolderOpen className="w-3.5 h-3.5" /> : <Folder className="w-3.5 h-3.5" />}
          </span>
          <span onClick={() => selectGroup(rootIdx, [])} className="flex-1 text-xs font-semibold tracking-wide truncate min-w-0 py-0.5">
            {cfg.label}
          </span>
          <div className="flex items-center gap-px opacity-0 group-hover/root:opacity-100 transition-opacity flex-shrink-0">
            <button onClick={(e) => { e.stopPropagation(); doAddSubgroup(rootIdx, []); }} className="p-px text-slate-500 hover:text-green-400 rounded" title="Add sub-group"><Folder className="w-3 h-3" /></button>
            <button onClick={(e) => { e.stopPropagation(); doAddMessage(rootIdx, []); }} className="p-px text-slate-500 hover:text-blue-400 rounded" title="Add message"><MessageSquare className="w-3 h-3" /></button>
            <button onClick={(e) => { e.stopPropagation(); doMoveRoot(rootIdx, 'up'); }} className="p-px text-slate-500 hover:text-white rounded" title="Move up"><ArrowUp className="w-3 h-3" /></button>
            <button onClick={(e) => { e.stopPropagation(); doMoveRoot(rootIdx, 'down'); }} className="p-px text-slate-500 hover:text-white rounded" title="Move down"><ArrowDown className="w-3 h-3" /></button>
            <button onClick={(e) => { e.stopPropagation(); doDeleteRoot(rootIdx); }} className="p-px text-slate-500 hover:text-red-400 rounded" title="Delete group"><Trash2 className="w-3 h-3" /></button>
          </div>
        </div>
        {isExpanded && (
          <div>
            {(cfg.subgroups ?? []).map((sg, i) => renderGroupNode(rootIdx, sg, [i], 1))}
            {(cfg.messages ?? []).map((msg, mi) => renderMessageNode(rootIdx, msg, [], mi, 1))}
          </div>
        )}
      </div>
    );
  };

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 bg-slate-950 flex flex-col z-50">

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700 bg-slate-900 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Board
          </button>
          <span className="text-slate-700">|</span>
          <h1 className="text-base font-semibold text-white">Message Editor</h1>
          <span className="text-xs text-slate-500">· Configure your dispatch popover buttons</span>
        </div>
        <button
          onClick={resetToDefaults}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-amber-400 hover:bg-amber-500/10 border border-slate-600 hover:border-amber-500/40 rounded transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Reset to Defaults
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 flex min-h-0">

        {/* Left: tree */}
        <div className="w-80 flex-shrink-0 border-r border-slate-700 flex flex-col min-h-0 bg-slate-900/40">
          <div className="px-3 py-2 border-b border-slate-700/50 flex-shrink-0 flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Structure</p>
            <button
              onClick={doAddRoot}
              className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300 transition-colors"
              title="Add a new top-level button group"
            >
              <Plus className="w-3 h-3" /> Add Group
            </button>
          </div>

          <div className="flex-1 overflow-y-auto py-1">
            {buttonGroups.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-slate-600 italic">
                No groups yet. Click "Add Group" to create one.
              </div>
            ) : (
              buttonGroups.map((cfg, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <div className="my-1 mx-2 border-t border-slate-800" />}
                  {renderRootSection(i, cfg)}
                </React.Fragment>
              ))
            )}
          </div>

          {/* Legend */}
          <div className="px-3 py-2 border-t border-slate-700/50 flex-shrink-0 space-y-0.5">
            <div className="flex items-center gap-1.5 text-[10px] text-slate-600">
              <Folder className="w-3 h-3" /> Group → opens a sub-popover
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-slate-600">
              <MessageSquare className="w-3 h-3" /> Message → sends to chat
            </div>
            <div className="text-[10px] text-slate-600">Hover a row to see move/delete actions</div>
          </div>
        </div>

        {/* Right: edit panel */}
        <div className="flex-1 overflow-y-auto px-6 py-6">

          {/* No selection */}
          {!selected && (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
              <p className="text-slate-500 text-sm">Select a group or message from the tree to edit it.</p>
              <p className="text-slate-600 text-xs max-w-sm">
                Top-level groups appear as buttons in the case window. You can add, remove, and reorder them freely.<br /><br />
                Groups open a sub-popover. Messages send text to chat when clicked.
              </p>
            </div>
          )}

          {/* Group edit */}
          {selected?.kind === 'group' && (() => {
            const g = getGroupAtPath(cfgFor(selected.rootIdx), selected.path);
            const subCount = (g.subgroups ?? []).length;
            const msgCount = (g.messages ?? []).length;
            const isRoot = selected.path.length === 0;
            return (
              <div className="space-y-5">
                <h2 className="text-base font-semibold text-white">Edit {isRoot ? 'Button Group' : 'Group'}</h2>

                <div className="space-y-4">
                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 block">Button label</label>
                    <Input
                      value={groupDraft.label}
                      onChange={(e) => setGroupDraft(f => ({ ...f, label: e.target.value }))}
                      onKeyDown={(e) => e.key === 'Enter' && saveGroupDraft()}
                      placeholder="Group name"
                      className="bg-slate-900 border-slate-600 text-white placeholder:text-slate-500 h-9"
                      autoFocus
                    />
                  </div>

                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={groupDraft.keepOpen}
                      onChange={(e) => setGroupDraft(f => ({ ...f, keepOpen: e.target.checked }))}
                      className="accent-orange-500 w-4 h-4"
                    />
                    <span className="text-sm text-slate-300">Keep popup open after clicking a message</span>
                  </label>

                  <Button
                    onClick={saveGroupDraft}
                    disabled={!groupDraft.label.trim()}
                    className="bg-orange-600 hover:bg-orange-700 text-white text-sm h-8 px-5 disabled:opacity-50"
                  >
                    Apply
                  </Button>
                </div>

                {/* Children summary + quick-add */}
                <div className="border border-slate-700 rounded-lg px-4 py-3 space-y-2">
                  <p className="text-xs text-slate-400 font-medium">Children</p>
                  <p className="text-xs text-slate-500">
                    {subCount} sub-group{subCount !== 1 ? 's' : ''} · {msgCount} message{msgCount !== 1 ? 's' : ''}
                  </p>
                  <div className="flex gap-3 pt-0.5">
                    <button
                      onClick={() => doAddSubgroup(selected.rootIdx, selected.path)}
                      className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add sub-group
                    </button>
                    <button
                      onClick={() => doAddMessage(selected.rootIdx, selected.path)}
                      className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add message
                    </button>
                  </div>
                </div>

                <button
                  onClick={() => isRoot ? doDeleteRoot(selected.rootIdx) : doDeleteGroup(selected.rootIdx, selected.path)}
                  className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-400 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete this {isRoot ? 'button group' : 'group'}
                </button>
              </div>
            );
          })()}

          {/* Message edit */}
          {selected?.kind === 'message' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-white">Edit Message</h2>
                <div className="flex rounded overflow-hidden border border-slate-600 text-xs">
                  <button
                    onClick={switchToSimple}
                    className={`px-3 py-1 transition-colors ${msgDraft.editMode === 'simple' ? 'bg-orange-600 text-white' : 'bg-slate-900 text-slate-400 hover:text-white'}`}
                  >
                    Simple
                  </button>
                  <button
                    onClick={switchToJson}
                    className={`px-3 py-1 transition-colors ${msgDraft.editMode === 'json' ? 'bg-orange-600 text-white' : 'bg-slate-900 text-slate-400 hover:text-white'}`}
                  >
                    JSON
                  </button>
                </div>
              </div>

              {msgDraft.editMode === 'simple' ? (
                <div className="space-y-4">
                  {/* Label */}
                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 block">Button label</label>
                    <Input
                      value={msgDraft.label}
                      onChange={(e) => setMsgDraft(f => ({ ...f, label: e.target.value }))}
                      placeholder="Button label"
                      className="bg-slate-900 border-slate-600 text-white placeholder:text-slate-500 h-9"
                      autoFocus
                    />
                  </div>

                  {/* Message */}
                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 block">
                      Message{' '}
                      <span className="text-slate-600 font-normal">
                        — use {'{clientName}'}, {'{caseNumber}'}
                      </span>
                    </label>
                    <Textarea
                      value={msgDraft.message}
                      onChange={(e) => setMsgDraft(f => ({ ...f, message: e.target.value }))}
                      placeholder="Message text…"
                      className="bg-slate-900 border-slate-600 text-white placeholder:text-slate-500 text-sm"
                      rows={4}
                    />
                  </div>

                  {/* TR Message */}
                  <div className="border border-slate-700/60 rounded-lg p-3 space-y-2">
                    <label className="flex items-center gap-2.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={msgDraft.hasTrMessage}
                        onChange={(e) => setMsgDraft(f => ({ ...f, hasTrMessage: e.target.checked }))}
                        className="accent-orange-500 w-4 h-4 flex-shrink-0"
                      />
                      <span className="text-sm text-slate-300">TR message</span>
                      <span className="text-xs text-slate-600">— alternative when /tr translation is active</span>
                    </label>
                    {msgDraft.hasTrMessage && (
                      <Textarea
                        value={msgDraft.trMessage}
                        onChange={(e) => setMsgDraft(f => ({ ...f, trMessage: e.target.value }))}
                        placeholder="Translation-mode message…"
                        className="bg-slate-900 border-slate-600 text-white placeholder:text-slate-500 text-sm"
                        rows={3}
                      />
                    )}
                  </div>

                  {/* Variants */}
                  <div className="border border-slate-700/60 rounded-lg p-3 space-y-2">
                    <label className="flex items-center gap-2.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={msgDraft.hasVariants}
                        onChange={(e) => setMsgDraft(f => ({ ...f, hasVariants: e.target.checked }))}
                        className="accent-orange-500 w-4 h-4 flex-shrink-0"
                      />
                      <span className="text-sm text-slate-300">Variants</span>
                      <span className="text-xs text-slate-600">— one is picked at random each time</span>
                    </label>
                    {msgDraft.hasVariants && (
                      <>
                        <Textarea
                          value={msgDraft.variantsText}
                          onChange={(e) => setMsgDraft(f => ({ ...f, variantsText: e.target.value }))}
                          placeholder={"One variant per line:\nVariant message A\nVariant message B\nVariant message C"}
                          className="bg-slate-900 border-slate-600 text-white placeholder:text-slate-500 text-sm font-mono"
                          rows={5}
                        />
                        <p className="text-[11px] text-slate-600">The main message above is used as the fallback. For weighted variants, switch to JSON mode.</p>
                      </>
                    )}
                  </div>

                  {/* TR Variants */}
                  <div className="border border-slate-700/60 rounded-lg p-3 space-y-2">
                    <label className="flex items-center gap-2.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={msgDraft.hasTrVariants}
                        onChange={(e) => setMsgDraft(f => ({ ...f, hasTrVariants: e.target.checked }))}
                        className="accent-orange-500 w-4 h-4 flex-shrink-0"
                      />
                      <span className="text-sm text-slate-300">TR variants</span>
                      <span className="text-xs text-slate-600">— random variants for /tr mode</span>
                    </label>
                    {msgDraft.hasTrVariants && (
                      <Textarea
                        value={msgDraft.trVariantsText}
                        onChange={(e) => setMsgDraft(f => ({ ...f, trVariantsText: e.target.value }))}
                        placeholder={"One TR variant per line:\nTranslation variant A\nTranslation variant B"}
                        className="bg-slate-900 border-slate-600 text-white placeholder:text-slate-500 text-sm font-mono"
                        rows={4}
                      />
                    )}
                  </div>

                  {/* Platform Variants */}
                  <div className="border border-slate-700/60 rounded-lg p-3 space-y-2">
                    <label className="flex items-center gap-2.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={msgDraft.hasPlatformVariants}
                        onChange={(e) => setMsgDraft(f => ({ ...f, hasPlatformVariants: e.target.checked }))}
                        className="accent-orange-500 w-4 h-4 flex-shrink-0"
                      />
                      <span className="text-sm text-slate-300">Platform variants</span>
                      <span className="text-xs text-slate-600">— different message per platform</span>
                    </label>
                    {msgDraft.hasPlatformVariants && (
                      <div className="space-y-2 pt-1">
                        {([ ['pvPc', 'PC'], ['pvXbox', 'Xbox'], ['pvPlaystation', 'PlayStation'], ['pvLegacy', 'Legacy'], ['pvDefault', 'Default fallback'] ] as const).map(([key, lbl]) => (
                          <div key={key}>
                            <label className="text-[11px] text-slate-500 mb-0.5 block">{lbl}</label>
                            <Input
                              value={msgDraft[key]}
                              onChange={(e) => setMsgDraft(f => ({ ...f, [key]: e.target.value }))}
                              placeholder={`${lbl} message (leave blank to skip)`}
                              className="bg-slate-900 border-slate-600 text-white placeholder:text-slate-500 h-8 text-xs"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Textarea
                    value={msgDraft.jsonText}
                    onChange={(e) => setMsgDraft(f => ({ ...f, jsonText: e.target.value, jsonError: null }))}
                    className="bg-slate-900 border-slate-600 text-white font-mono text-xs min-h-96"
                    spellCheck={false}
                    placeholder={'{\n  "label": "Button",\n  "message": "...",\n  "variants": ["msg A", "msg B"]\n}'}
                  />
                  <p className="text-xs text-slate-500">
                    Supports: variants, trVariants, platformVariants, trPlatformVariants, weighted variants
                  </p>
                </div>
              )}

              {msgDraft.jsonError && (
                <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded px-3 py-2">
                  {msgDraft.jsonError}
                </p>
              )}

              <div className="flex items-center gap-3">
                <Button
                  onClick={saveMsgDraft}
                  disabled={msgDraft.editMode === 'simple' ? !msgDraft.label.trim() || !msgDraft.message.trim() : false}
                  className="bg-orange-600 hover:bg-orange-700 text-white text-sm h-8 px-5 disabled:opacity-50"
                >
                  Apply
                </Button>
                <button
                  onClick={() => { if (selected.kind === 'message') doDeleteMessage(selected.rootIdx, selected.groupPath, selected.msgIdx); }}
                  className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-400 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-2.5 border-t border-slate-700 bg-slate-900 flex-shrink-0">
        <p className="text-xs text-slate-500">
          Changes save automatically. Go back to the board and open a case to see your buttons.
        </p>
      </div>
    </div>
  );
}
