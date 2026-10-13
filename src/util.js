// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Tiny DOM + misc helpers. All text goes through textContent; nothing here
// ever assigns untrusted strings to innerHTML (node content is LLM output).

export function h(tag, props = null, ...children) {
    const el = document.createElement(tag);
    if (props) {
        for (const [key, value] of Object.entries(props)) {
            if (value === undefined || value === null || value === false) continue;
            if (key === 'class') el.className = value;
            else if (key === 'text') el.textContent = String(value);
            else if (key === 'dataset') Object.assign(el.dataset, value);
            else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
            else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
            else if (value === true) el.setAttribute(key, '');
            else el.setAttribute(key, String(value));
        }
    }
    append(el, children);
    return el;
}

function append(el, children) {
    for (const child of children) {
        if (child === null || child === undefined || child === false) continue;
        if (Array.isArray(child)) append(el, child);
        else if (child instanceof Node) el.appendChild(child);
        else el.appendChild(document.createTextNode(String(child)));
    }
}

export function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
}

/**
 * Null-safe append. Native Element.append() stringifies null/undefined
 * into literal "null" text nodes; this skips them (and flattens arrays).
 */
export function put(el, ...children) {
    append(el, children);
    return el;
}

export function debounce(fn, wait) {
    let timer = null;
    const wrapped = (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), wait);
    };
    wrapped.cancel = () => clearTimeout(timer);
    return wrapped;
}

export function truncate(text, max) {
    const value = String(text ?? '');
    return value.length > max ? `${value.slice(0, Math.max(1, max - 1))}…` : value;
}

/** Stable 32-bit FNV-1a hash, used for deterministic colors and layout jitter. */
export function hashString(text) {
    let hash = 0x811c9dc5;
    const value = String(text ?? '');
    for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

/** First visible glyph of a name, upper-cased for Latin scripts. */
export function initialOf(text) {
    const value = String(text ?? '').trim();
    if (!value) return '?';
    const first = Array.from(value)[0];
    return first.toUpperCase();
}

export function formatTime(date) {
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export async function copyText(text) {
    try {
        await navigator.clipboard.writeText(String(text));
        return true;
    } catch {
        const area = document.createElement('textarea');
        area.value = String(text);
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch { ok = false; }
        area.remove();
        return ok;
    }
}

export function prefersReducedMotion() {
    return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}
