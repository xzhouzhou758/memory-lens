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

function fakeDoc(linkSpecs) {
    const links = linkSpecs.map(spec => typeof spec === 'string' ? fakeLink(spec) : fakeLink(spec.href, spec));
    return {
        baseURI: 'https://example.com/',
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
