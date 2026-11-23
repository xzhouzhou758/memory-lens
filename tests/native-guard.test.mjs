import test from 'node:test';
import assert from 'node:assert/strict';
import { isNativeMemoryLensPresent, removeOwnStylesheets, retireIfNativeMemoryLens } from '../src/native-guard.js';

function fakeLink(href, { loaded = false } = {}) {
    const listeners = { load: [], error: [] };
    return {
        href,
        media: '',
        disabled: false,
        sheet: loaded ? {} : null,
        removed: false,
        onload: null,
        getAttribute(name) { return name === 'href' ? href : null; },
        addEventListener(type, fn) { listeners[type]?.push(fn); },
        fire(type) {
            if (type === 'load') {
                this.sheet = {};
                this.onload?.();
            }
            for (const fn of listeners[type] || []) fn();
        },
        remove() { this.removed = true; },
    };
}

function fakeDoc(linkSpecs, { baseURI = 'https://example.com/' } = {}) {
    const links = linkSpecs.map(spec => typeof spec === 'string' ? fakeLink(spec) : fakeLink(spec.href, spec));
    return {
        baseURI,
        links,
        head: {
            querySelectorAll() { return links.filter(l => !l.removed); },
        },
    };
}

test('isNativeMemoryLensPresent detects native workbench API or built-in memory-graph lens stylesheet', () => {
    const emptyDoc = fakeDoc(['/scripts/extensions/third-party/memory-lens/style.css']);
    assert.equal(isNativeMemoryLensPresent({}, emptyDoc), false);
    assert.equal(isNativeMemoryLensPresent({ workbench: { registerWorkspace() {} } }, emptyDoc), true);

    const nativeStyleDoc = fakeDoc([
        '/scripts/extensions/memory-graph/lens/style.css',
        '/scripts/extensions/third-party/memory-lens/style.css',
    ]);
    assert.equal(isNativeMemoryLensPresent({}, nativeStyleDoc), true);
});

test('retireIfNativeMemoryLens defers removing in-flight stylesheet until load fires and keeps built-in lens CSS intact', () => {
    const doc = fakeDoc([
        { href: '/scripts/extensions/memory-graph/lens/style.css', loaded: true },
        { href: '/scripts/extensions/third-party/memory-lens/style.css', loaded: false },
    ]);
    let onloadResolved = false;
    doc.links[1].onload = () => { onloadResolved = true; };

    let readyCb = null;
    const notices = [];
    const ctx = {
        workbench: { registerWorkspace() {} },
        eventTypes: { APP_READY: 'app_ready' },
        eventSource: { once(ev, cb) { if (ev === 'app_ready') readyCb = cb; } },
        getCurrentLocale: () => 'zh-cn',
    };

    const retired = retireIfNativeMemoryLens({
        ownStyleHref: 'https://example.com/scripts/extensions/third-party/memory-lens/style.css',
        ctx,
        doc,
        notify: (msg, title) => notices.push({ msg, title }),
    });

    assert.equal(retired, true);
    assert.equal(doc.links[0].removed, false);
    assert.equal(doc.links[1].media, 'not all');
    assert.equal(doc.links[1].removed, false);

    doc.links[1].fire('load');
    assert.equal(onloadResolved, true);
    assert.equal(doc.links[1].disabled, true);
    assert.equal(doc.links[1].removed, true);

    readyCb?.();
    assert.equal(notices.length, 1);
    assert.match(notices[0].msg, /memory-lens/);
});

test('retireIfNativeMemoryLens stays inactive on older Luker', () => {
    const doc = fakeDoc([
        { href: '/scripts/extensions/third-party/memory-lens/style.css', loaded: true },
    ]);
    assert.equal(retireIfNativeMemoryLens({
        ownStyleHref: 'https://example.com/scripts/extensions/third-party/memory-lens/style.css',
        ctx: {},
        doc,
    }), false);
    assert.equal(doc.links[0].removed, false);
    assert.equal(removeOwnStylesheets(doc, 'https://example.com/scripts/extensions/third-party/memory-lens/style.css'), 1);
    assert.equal(doc.links[0].removed, true);
});

test('removeOwnStylesheets avoids Safari WebKit @import race when link.sheet appears before load fires', () => {
    const href = 'https://example.com/scripts/extensions/third-party/memory-lens/style.css';
    const doc = fakeDoc([
        { href: '/scripts/extensions/third-party/memory-lens/style.css', loaded: false },
    ]);
    let onloadResolved = false;
    doc.links[0].onload = () => { onloadResolved = true; };

    assert.equal(removeOwnStylesheets(doc, href), 1);
    assert.equal(doc.links[0].media, 'not all');
    assert.equal(doc.links[0].removed, false);

    // 模拟 Safari/WebKit 在子 @import 尚未加载完前暴露 link.sheet，随后 MutationObserver 再次触发清理
    doc.links[0].sheet = {};
    assert.equal(removeOwnStylesheets(doc, href), 1);
    assert.equal(doc.links[0].disabled, false);
    assert.equal(doc.links[0].removed, false);

    doc.links[0].fire('load');
    assert.equal(onloadResolved, true);
    assert.equal(doc.links[0].disabled, true);
    assert.equal(doc.links[0].removed, true);
});

test('retireIfNativeMemoryLens does not force-remove in-flight link on 15s timeout or 1500ms fallback, only on APP_READY', () => {
    const href = 'https://example.com/scripts/extensions/third-party/memory-lens/style.css';
    const origSetTimeout = globalThis.setTimeout;
    const origMutationObserver = globalThis.MutationObserver;
    const timers = [];
    let observerDisconnected = false;

    globalThis.setTimeout = (fn, ms) => {
        timers.push({ fn, ms });
        return timers.length;
    };
    globalThis.MutationObserver = class FakeObserver {
        observe() {}
        disconnect() { observerDisconnected = true; }
    };

    try {
        const fallbackDoc = fakeDoc([
            { href: '/scripts/extensions/third-party/memory-lens/style.css', loaded: false },
        ]);
        const fallbackNotices = [];
        retireIfNativeMemoryLens({
            ownStyleHref: href,
            ctx: { workbench: { registerWorkspace() {} }, getCurrentLocale: () => 'zh-tw' },
            doc: fallbackDoc,
            notify: (msg, title) => fallbackNotices.push({ msg, title }),
        });

        fallbackDoc.links[0].sheet = {};
        const t15s = timers.find(t => t.ms === 15000);
        const t1500 = timers.find(t => t.ms === 1500);
        assert.ok(t15s && t1500);

        t15s.fn();
        assert.equal(observerDisconnected, true);
        assert.equal(fallbackDoc.links[0].removed, false);

        t1500.fn();
        assert.equal(fallbackNotices.length, 1);
        assert.equal(fallbackDoc.links[0].removed, false);

        const readyDoc = fakeDoc([
            { href: '/scripts/extensions/third-party/memory-lens/style.css', loaded: false },
        ]);
        let readyCb = null;
        retireIfNativeMemoryLens({
            ownStyleHref: href,
            ctx: {
                workbench: { registerWorkspace() {} },
                eventTypes: { APP_READY: 'app_ready' },
                eventSource: { once(ev, cb) { if (ev === 'app_ready') readyCb = cb; } },
                getCurrentLocale: () => 'zh-tw',
            },
            doc: readyDoc,
            notify: () => {},
        });
        readyDoc.links[0].sheet = {};
        assert.equal(readyDoc.links[0].removed, false);
        readyCb?.();
        assert.equal(readyDoc.links[0].disabled, true);
        assert.equal(readyDoc.links[0].removed, true);
    } finally {
        globalThis.setTimeout = origSetTimeout;
        globalThis.MutationObserver = origMutationObserver;
    }
});

test('retireIfNativeMemoryLens localizes zh-TW/zh-Hant and falls back to English for non-zh or empty locale', () => {
    const href = 'https://example.com/scripts/extensions/third-party/memory-lens/style.css';
    for (const locale of ['zh-tw', 'zh-HK', 'zh-MO', 'zh-Hant']) {
        let readyCb = null;
        const notices = [];
        retireIfNativeMemoryLens({
            ownStyleHref: href,
            ctx: {
                workbench: { registerWorkspace() {} },
                eventTypes: { APP_READY: 'app_ready' },
                eventSource: { once(_ev, cb) { readyCb = cb; } },
                getCurrentLocale: () => locale,
            },
            doc: fakeDoc([]),
            notify: (msg, title) => notices.push({ msg, title }),
        });
        readyCb?.();
        assert.equal(notices.length, 1);
        assert.match(notices[0].title, /舊擴充功能已停用/);
        assert.match(notices[0].msg, /管理擴充功能/);
        assert.match(notices[0].msg, /移除/);
        assert.doesNotMatch(notices[0].msg, /管理擴充套件/);
    }

    const origNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { value: { language: '' }, configurable: true });
    try {
        let readyCb = null;
        const notices = [];
        retireIfNativeMemoryLens({
            ownStyleHref: href,
            ctx: {
                workbench: { registerWorkspace() {} },
                eventTypes: { APP_READY: 'app_ready' },
                eventSource: { once(_ev, cb) { readyCb = cb; } },
                getCurrentLocale: () => '',
            },
            doc: fakeDoc([]),
            notify: (msg, title) => notices.push({ msg, title }),
        });
        readyCb?.();
        assert.equal(notices.length, 1);
        assert.match(notices[0].msg, /Manage Extensions/);
    } finally {
        if (origNav) Object.defineProperty(globalThis, 'navigator', origNav);
        else delete globalThis.navigator;
    }
});

test('removeOwnStylesheets and isNativeMemoryLensPresent ignore data: and blob: baseURI', () => {
    const ownHref = 'https://example.com/scripts/extensions/third-party/memory-lens/style.css';
    for (const baseURI of ['data:text/html,<h1>sandbox</h1>', 'blob:https://example.com/1234-5678']) {
        const doc = fakeDoc([
            { href: '/scripts/extensions/memory-graph/lens/style.css?v=1', loaded: true },
            { href: '/scripts/extensions/third-party/memory-lens/style.css?v=1', loaded: true },
        ], { baseURI });
        assert.equal(isNativeMemoryLensPresent({}, doc), true);
        assert.equal(removeOwnStylesheets(doc, ownHref), 1);
        assert.equal(doc.links[0].removed, false);
        assert.equal(doc.links[1].disabled, true);
        assert.equal(doc.links[1].removed, true);
    }
});
