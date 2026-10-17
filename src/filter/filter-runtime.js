// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Keeps the 标签过滤 regex scripts registered with Luker's regex engine.
// Started from index.js (works while the lens is closed). Scripts are
// runtime-only: never written to the user's regex list, and scoped
// pluginOnly + promptOnly so they only touch text plugins read.

import { buildScripts } from './tag-filter.js';

const OWNER = 'memory-lens-tag-filter';
const SETTINGS_KEY = 'memory_lens';
export const FILTER_CHANGED_EVENT = 'memory-lens:tagfilter';

/** Settings shape: { enabled, active, presets: [{ id, name, black, white }] } */
export function readFilterSettings(ctx) {
    const all = ctx?.extensionSettings || {};
    const raw = all[SETTINGS_KEY]?.tagFilter;
    const presets = Array.isArray(raw?.presets) ? raw.presets.filter(p => p && p.id) : [];
    if (!presets.length) presets.push({ id: 'default', name: '默认', black: '', white: '' });
    const active = presets.some(p => p.id === raw?.active) ? raw.active : presets[0].id;
    return { enabled: Boolean(raw?.enabled), active, presets };
}

export function activePlan(settings) {
    const preset = settings.presets.find(p => p.id === settings.active) || settings.presets[0];
    return { enabled: settings.enabled, black: preset?.black || '', white: preset?.white || '' };
}

export function writeFilterSettings(ctx, settings) {
    const all = ctx.extensionSettings;
    all[SETTINGS_KEY] ||= {};
    all[SETTINGS_KEY].tagFilter = structuredClone(settings);
    ctx.saveSettingsDebounced?.();
    globalThis.dispatchEvent?.(new CustomEvent(FILTER_CHANGED_EVENT));
}

export async function startTagFilter(getCtx) {
    const engine = await import('/scripts/extensions/regex/engine.js');
    if (typeof engine.registerManagedRegexProvider !== 'function') throw new Error('regex engine has no runtime providers');
    const provider = engine.registerManagedRegexProvider(OWNER);
    if (!provider) throw new Error('could not register regex provider');
    const sync = () => {
        try { provider.setScripts(buildScripts(activePlan(readFilterSettings(getCtx())))); } catch (err) { console.warn('[memory-lens] tag filter sync failed', err); }
    };
    sync();
    globalThis.addEventListener?.(FILTER_CHANGED_EVENT, sync);
    return () => {
        globalThis.removeEventListener?.(FILTER_CHANGED_EVENT, sync);
        provider.unregister();
    };
}
