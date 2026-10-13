// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Left sidebar: stats, "what the AI remembers right now", and filters.

import { h, clear, formatTime, put } from '../util.js';
import { icon } from '../icons.js';
import { t, typeLabel, relationLabel } from '../i18n.js';
import { isDefaultFilters, typeVisual, relationCategory } from '../model.js';
import { segmented, switchControl, typeDot, sectionTitle, button } from '../ui/components.js';

export function createSidebar(app) {
    const inner = h('div', { class: 'ml-sidebar-inner' });
    const el = h('aside', { class: 'ml-sidebar', 'aria-label': t('filters') }, inner);

    function stat(label, value) {
        return h('div', { class: 'ml-stat' }, h('div', { class: 'ml-stat-value', text: String(value) }), h('div', { class: 'ml-stat-label', text: label }));
    }

    function contextCard(model) {
        const { recalled, pinned } = model.injection;
        const recalledCount = [...recalled].filter(id => model.nodes.has(id)).length;
        const pinnedCount = [...pinned].filter(id => model.nodes.has(id) && !recalled.has(id)).length;
        const at = model.lastRecall?.at;
        const onlyContext = app.state().filters.onlyContext;
        return h('div', { class: 'ml-ctxcard' },
            h('div', { class: 'ml-ctxcard-head' },
                h('span', { class: 'ml-ctxcard-pulse', 'aria-hidden': 'true' }),
                h('span', { class: 'ml-ctxcard-title', text: t('context') }),
                h('span', { class: 'ml-ctxcard-time', text: at ? formatTime(at) : t('never') })),
            h('div', { class: 'ml-ctxcard-rows' },
                h('button', { type: 'button', class: 'ml-ctxrow', dataset: { ctx: 'recalled' }, onClick: () => app.setFilter({ onlyContext: !onlyContext }) },
                    h('span', { class: 'ml-ctxrow-dot', 'aria-hidden': 'true' }), h('span', { text: t('recalled') }), h('b', { text: String(recalledCount) })),
                h('button', { type: 'button', class: 'ml-ctxrow', dataset: { ctx: 'pinned' }, onClick: () => app.setFilter({ onlyContext: !onlyContext }) },
                    h('span', { class: 'ml-ctxrow-dot', 'aria-hidden': 'true' }), h('span', { text: t('pinned') }), h('b', { text: String(pinnedCount) }))),
            h('div', { class: 'ml-ctxcard-actions' },
                switchControl(t('onlyInContext'), onlyContext, (value) => app.setFilter({ onlyContext: value })),
                model.lastRecall ? button(t('viewInjection'), () => app.showInjection(), { iconName: 'doc', className: 'ml-btn-ghost ml-btn-sm' }) : null));
    }

    function typeFilters(model, filters) {
        return h('div', { class: 'ml-filterlist' }, model.typeList.map(type => {
            const hidden = filters.hiddenTypes.has(type);
            return h('button', {
                type: 'button',
                class: 'ml-filteritem',
                'aria-pressed': String(!hidden),
                dataset: { tone: typeVisual(type).tone },
                onClick: () => {
                    const next = new Set(filters.hiddenTypes);
                    if (hidden) next.delete(type); else next.add(type);
                    app.setFilter({ hiddenTypes: next });
                },
            },
            h('span', { class: 'ml-filteritem-check', 'aria-hidden': 'true' }, icon('chevronRight', { size: 10 })),
            typeDot(type),
            h('span', { class: 'ml-filteritem-label', text: typeLabel(type) }),
            h('span', { class: 'ml-filteritem-count', text: String(model.typeCounts.get(type) || 0) }));
        }));
    }

    function relationFilters(model, filters) {
        const types = [...model.relationCounts.keys()]
            .filter(type => relationCategory(type) !== 'hierarchy')
            .sort((a, b) => model.relationCounts.get(b) - model.relationCounts.get(a));
        if (!types.length) return null;
        return h('div', { class: 'ml-chips' }, types.map(type => {
            const hidden = filters.hiddenRelations.has(type);
            return h('button', {
                type: 'button',
                class: 'ml-relchip',
                'aria-pressed': String(!hidden),
                dataset: { category: relationCategory(type) },
                onClick: () => {
                    const next = new Set(filters.hiddenRelations);
                    if (hidden) next.delete(type); else next.add(type);
                    app.setFilter({ hiddenRelations: next });
                },
            }, h('span', { text: relationLabel(type) }), h('span', { class: 'ml-relchip-count', text: String(model.relationCounts.get(type)) }));
        }));
    }

    function render() {
        const model = app.model();
        clear(inner);
        if (!model) return;
        const filters = app.state().filters;
        const events = model.typeCounts.get('event') || 0;
        put(inner,
            h('div', { class: 'ml-stats' },
                stat(t('nodes'), model.nodes.size),
                stat(t('edges'), model.edges.filter(edge => !edge.internal).length),
                stat(t('events'), events)),
            contextCard(model),
            h('div', { class: 'ml-sidebar-section' },
                sectionTitle(t('types'), isDefaultFilters(filters) ? null : h('button', { type: 'button', class: 'ml-linkbtn', onClick: () => app.resetFilters() }, h('span', { text: t('resetFilters') }))),
                typeFilters(model, filters)),
            events
                ? h('div', { class: 'ml-sidebar-section' },
                    sectionTitle(t('depth')),
                    segmented([
                        { value: 'all', label: t('depthAll') },
                        { value: 'leaf', label: t('depthLeaf') },
                        { value: 'rollup', label: t('depthRollup') },
                    ], filters.depth, (value) => app.setFilter({ depth: value }), { className: 'ml-seg-block ml-seg-sm' }))
                : null,
            model.relationCounts.size
                ? h('div', { class: 'ml-sidebar-section' }, sectionTitle(t('relations')), relationFilters(model, filters))
                : null,
            h('div', { class: 'ml-sidebar-section' },
                sectionTitle(t('display')),
                switchControl(t('showHierarchy'), filters.showHierarchy, (value) => app.setFilter({ showHierarchy: value })),
                switchControl(t('showArchived'), filters.showArchived, (value) => app.setFilter({ showArchived: value }))),
        );
    }

    return { el, render };
}
