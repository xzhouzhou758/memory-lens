// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Memory Lens — Luker entry point. Adds a wand-menu item and lazily loads
// the workspace UI the first time it is opened, so the extension costs
// nothing until used.

const MENU_ID = 'memory_lens_wand_item';
let handle = null;
let opening = null;

function isZh() {
    try {
        const locale = String(globalThis.Luker?.getContext?.()?.getCurrentLocale?.() || navigator.language || '');
        return locale.toLowerCase().startsWith('zh');
    } catch {
        return true;
    }
}

async function open() {
    if (handle) {
        handle.focus();
        return;
    }
    if (opening) return opening;
    opening = (async () => {
        const [{ mountMemoryLens }, { createLukerSource }] = await Promise.all([
            import('./src/app.js'),
            import('./src/source-luker.js'),
        ]);
        handle = mountMemoryLens({
            source: createLukerSource(),
            onClose: () => { handle = null; },
        });
    })();
    try {
        await opening;
    } catch (err) {
        console.error('[memory-lens] failed to open', err);
        globalThis.toastr?.error?.(String(err?.message || err), 'Memory Lens');
    } finally {
        opening = null;
    }
}

function close() {
    handle?.close();
}

function addMenuItem() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu) return false;
    if (document.getElementById(MENU_ID)) return true;
    const item = document.createElement('div');
    item.id = MENU_ID;
    item.className = 'list-group-item flex-container flexGap5';
    item.tabIndex = 0;
    item.setAttribute('role', 'button');
    const icon = document.createElement('div');
    icon.className = 'fa-solid fa-circle-nodes extensionsMenuExtensionButton';
    const label = document.createElement('span');
    label.textContent = isZh() ? '记忆透镜' : 'Memory Lens';
    item.append(icon, label);
    item.addEventListener('click', open);
    item.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            open();
        }
    });
    menu.appendChild(item);
    return true;
}

// The wand menu is rendered by Luker after extensions activate; wait for it.
if (!addMenuItem()) {
    const observer = new MutationObserver(() => {
        if (addMenuItem()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 120000);
}

// Token counter: records every generation's injection, even with the lens closed.
import('./src/token-stats.js')
    .then(({ startRecorder }) => startRecorder(() => globalThis.Luker?.getContext?.() || globalThis.SillyTavern?.getContext?.()))
    .catch(err => console.warn('[memory-lens] token recorder unavailable', err));

globalThis.MemoryLens = Object.freeze({ open, close });
