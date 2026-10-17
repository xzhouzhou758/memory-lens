// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Token counter stats (opened from the sidebar's 「注入 token」 row).

import { h, formatTime } from '../util.js';
import { t } from '../i18n.js';
import { button } from '../ui/components.js';
import { summarize, formatTokens } from '../token-stats.js';

const RECENT = 20;

/** Content for the stats dialog. */
export function tokenPanel(model, { onClear = null } = {}) {
    const tokens = model?.tokens || { current: null, entries: [] };
    const cur = tokens.current;
    const entries = tokens.entries || [];
    const sum = summarize(entries);
    const num = (n) => h('b', { class: 'ml-tok-num', text: formatTokens(n), title: String(n) });

    const big = (label, value, tone = '') => h('div', { class: 'ml-tok-cell', dataset: { tone } },
        h('span', { class: 'ml-tok-label' }, tone ? h('span', { class: 'ml-tok-dot', 'aria-hidden': 'true' }) : null, h('span', { text: label })),
        num(value));

    const nowRow = h('div', { class: 'ml-tok-grid' },
        big(t('tokNow'), cur ? cur.core + cur.focus : 0),
        big(t('tokFocus'), cur?.focus || 0, 'focus'),
        big(t('tokCore'), cur?.core || 0, 'core'));
    const histRow = h('div', { class: 'ml-tok-grid' },
        big(t('tokHistory'), sum.total),
        big(t('tokAvg'), sum.avg),
        big(t('tokMax'), sum.max));

    return h('div', { class: 'ml-tok' },
        h('p', { class: 'ml-tok-when', text: cur ? `${t('lastRecall')} · ${formatTime(cur.at)}` : t('tokNoRecall') }),
        nowRow,
        h('div', { class: 'ml-tok-sub' },
            h('span', { text: `${t('tokCount')} ${t('tokTimes', sum.count)}` }),
            sum.count ? h('span', { text: `${t('tokLegendFocus')} ${formatTokens(sum.avgFocus)} + ${t('tokLegendCore')} ${formatTokens(sum.avgCore)} / 次` }) : null),
        histRow,
        entries.length ? chart(entries.slice(-RECENT)) : h('p', { class: 'ml-tok-empty', text: t('tokEmpty') }),
        h('p', { class: 'ml-tok-note', text: t('tokNote') }),
        onClear && entries.length ? button(t('tokClear'), onClear, { iconName: 'trash', className: 'ml-btn-ghost ml-btn-sm ml-tok-clear' }) : null);
}

/** Stacked bars: core (blue) under focus (amber), newest on the right. */
function chart(list) {
    const max = Math.max(1, ...list.map(e => e.core + e.focus));
    return h('figure', { class: 'ml-tok-chart' },
        h('figcaption', { class: 'ml-tok-chart-head' },
            h('span', { text: t('tokRecent', list.length) }),
            h('span', { class: 'ml-tok-legend' },
                h('span', { dataset: { tone: 'focus' } }, h('span', { class: 'ml-tok-dot', 'aria-hidden': 'true' }), t('tokLegendFocus')),
                h('span', { dataset: { tone: 'core' } }, h('span', { class: 'ml-tok-dot', 'aria-hidden': 'true' }), t('tokLegendCore')))),
        h('div', { class: 'ml-tok-bars', role: 'img', 'aria-label': t('tokRecent', list.length) },
            list.map(e => {
                const total = e.core + e.focus;
                return h('div', {
                    class: 'ml-tok-bar',
                    title: `${e.floor >= 0 ? `#${e.floor} · ` : ''}${formatTime(e.at)}\n${t('tokLegendFocus')} ${e.focus} · ${t('tokLegendCore')} ${e.core}`,
                    style: { height: `${Math.max(3, (total / max) * 100)}%` },
                },
                h('span', { class: 'ml-tok-bar-focus', style: { flexGrow: String(e.focus || 0) } }),
                h('span', { class: 'ml-tok-bar-core', style: { flexGrow: String(e.core || 0) } }));
            })));
}
