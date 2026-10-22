/**
 * The editor of the paste-to-focus rules (policy key ui.paste_focus.rules), with a test box.
 *
 * The rules are tried in order and the first match wins (static/js/utils/paste-focus.js, the
 * module the page itself uses, so the test box shows what a paste does). Edits stay in the form
 * until "Save rules"; the test box runs on the form, saved or not. The server checks the patterns
 * again on save (annzarro/server/paste_focus.py).
 */
import { h } from './dom.js';
import { compilePattern, matchRules, DATASET_MATCHES, DEFAULT_RULES, MAX_TEXT } from '../utils/paste-focus.js';

const MATCH_TEXT = {
    exact: 'exact: the whole store name',
    prefix: 'prefix: the store name starts with it',
    contains: 'contains: the store name has it somewhere',
};

/** A rule as the form holds it. */
function copyRule(rule) {
    return {
        pattern: String((rule && rule.pattern) || ''),
        dataset_match: DATASET_MATCHES.includes(rule && rule.dataset_match) ? rule.dataset_match : 'prefix',
        enabled: !rule || rule.enabled !== false,
    };
}

/**
 * @param {Object} key - the policy key as GET /admin/policy serves it
 * @param {boolean} disabled - read-only (locked, or not editable here)
 * @param {function(Array, function): void} commit - the whole list and a function that reverts the form
 * @param {function(string): void} fail - a problem found before sending
 */
export function renderPasteRules(key, disabled, commit, fail) {
    const limits = key.type || {};
    const maxRules = limits.max_rules || 20;
    const maxPattern = limits.max_pattern || 500;
    const original = () => (Array.isArray(key.value) ? key.value : []).map(copyRule);
    let rules = original();
    const root = h('div', { class: 'paste-rules', data: { key: key.name } });
    const list = h('div', { class: 'paste-rules-list' });
    const result = h('div', { class: 'paste-rules-result small mt-1', role: 'status' });
    const saveButton = h('button', { type: 'button', class: 'btn btn-sm btn-primary', text: 'Save rules' });
    const sample = h('textarea', {
        class: 'form-control form-control-sm font-monospace', rows: 2, id: 'paste-rules-test',
        placeholder: 'Paste sample text to see which rule takes it', spellcheck: 'false',
    });

    const problemOf = (rule) => {
        if (rule.pattern.length > maxPattern) return `At most ${maxPattern} characters.`;
        const compiled = compilePattern(rule.pattern);
        return compiled.error || '';
    };

    function refresh() {
        const problems = rules.map(problemOf);
        problems.forEach((text, i) => {
            const note = list.querySelector(`[data-rule="${i}"] .paste-rule-error`);
            if (note) { note.textContent = text; note.hidden = !text; }
            const input = list.querySelector(`[data-rule="${i}"] .paste-rule-pattern`);
            if (input) input.classList.toggle('is-invalid', !!text);
        });
        const dirty = JSON.stringify(rules) !== JSON.stringify(original());
        saveButton.disabled = disabled || !dirty || problems.some(Boolean) || rules.length > maxRules;
        testSample(problems);
    }

    function testSample(problems) {
        const text = sample.value;
        result.className = 'paste-rules-result small mt-1';
        result.textContent = '';
        if (!text.trim()) { result.textContent = 'The test shows the rule that takes the text and what it extracts.'; result.classList.add('text-muted'); return; }
        if (text.length > MAX_TEXT) { result.textContent = `Text over ${MAX_TEXT.toLocaleString('en-GB')} characters is ignored.`; result.classList.add('text-muted'); return; }
        const usable = rules.map((r, i) => (problems[i] ? { ...r, enabled: false } : r));
        const hit = matchRules(text, usable);
        if (!hit) { result.textContent = 'No rule matches: a paste of this text does nothing.'; result.classList.add('text-muted'); return; }
        const parts = [
            hit.cell ? `cell = ${JSON.stringify(hit.cell)}` : null,
            hit.gene ? `gene = ${JSON.stringify(hit.gene)}` : null,
            hit.dataset ? `dataset = ${JSON.stringify(hit.dataset)} (${hit.datasetMatch} match)` : 'no dataset',
        ].filter(Boolean);
        result.classList.add('text-success');
        result.textContent = `Rule ${hit.rule + 1} matches: ${parts.join(', ')}.`;
    }

    function move(i, by) {
        const j = i + by;
        if (j < 0 || j >= rules.length) return;
        [rules[i], rules[j]] = [rules[j], rules[i]];
        draw();
    }

    function card(rule, i) {
        const error = h('div', { class: 'invalid-feedback d-block paste-rule-error', hidden: true });
        const label = `Rule ${i + 1}`;
        return h('div', { class: 'paste-rule border rounded p-2 mb-2', data: { rule: i } },
            h('div', { class: 'd-flex flex-wrap align-items-center gap-2 mb-1' },
                h('span', { class: 'fw-semibold small', text: label }),
                h('div', { class: 'form-check form-switch m-0' },
                    h('input', {
                        class: 'form-check-input paste-rule-enabled', type: 'checkbox', role: 'switch', id: `paste-rule-on-${i}`,
                        checked: rule.enabled, disabled, 'aria-label': `${label} enabled`,
                        onchange: (e) => { rule.enabled = e.target.checked; refresh(); },
                    }),
                    h('label', { class: 'form-check-label small', for: `paste-rule-on-${i}`, text: 'on' })),
                h('span', { class: 'ms-auto d-flex gap-1' },
                    disabled ? null : [
                        h('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary paste-rule-up', 'aria-label': `Move ${label} up`, title: 'Earlier', disabled: i === 0, onclick: () => move(i, -1) },
                            h('i', { class: 'fas fa-arrow-up', 'aria-hidden': 'true' })),
                        h('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary paste-rule-down', 'aria-label': `Move ${label} down`, title: 'Later', disabled: i === rules.length - 1, onclick: () => move(i, 1) },
                            h('i', { class: 'fas fa-arrow-down', 'aria-hidden': 'true' })),
                        h('button', { type: 'button', class: 'btn btn-sm btn-outline-danger paste-rule-remove', 'aria-label': `Remove ${label}`, title: 'Remove',
                            onclick: () => { rules.splice(i, 1); draw(); } },
                            h('i', { class: 'fas fa-times', 'aria-hidden': 'true' })),
                    ])),
            h('input', {
                type: 'text', class: 'form-control form-control-sm font-monospace paste-rule-pattern', value: rule.pattern, disabled,
                spellcheck: 'false', autocomplete: 'off', 'aria-label': `${label} pattern`, placeholder: '^(?<dataset>[^\\t]+)\\t[^\\t]*\\t[^\\t]*\\t(?<cell>[^\\t]+)',
                oninput: (e) => { rule.pattern = e.target.value; refresh(); },
            }),
            error,
            h('div', { class: 'd-flex align-items-center gap-2 mt-1' },
                h('label', { class: 'small text-muted', for: `paste-rule-match-${i}`, text: 'Dataset group matches the store name by' }),
                h('select', {
                    class: 'form-select form-select-sm w-auto paste-rule-match', id: `paste-rule-match-${i}`, disabled,
                    onchange: (e) => { rule.dataset_match = e.target.value; refresh(); },
                }, DATASET_MATCHES.map((m) => h('option', { value: m, selected: m === rule.dataset_match, text: MATCH_TEXT[m] })))));
    }

    function draw() {
        while (list.firstChild) list.removeChild(list.firstChild);
        if (!rules.length) list.appendChild(h('p', { class: 'text-muted small mb-2', text: 'No rules: pasting does nothing.' }));
        rules.forEach((rule, i) => list.appendChild(card(rule, i)));
        refresh();
    }

    saveButton.addEventListener('click', () => {
        fail('');
        const problem = rules.map(problemOf).find(Boolean);
        if (problem) { fail(problem); return; }
        commit(rules.map(copyRule), () => { rules = original(); draw(); });
    });
    sample.addEventListener('input', refresh);

    const actions = disabled ? null : h('div', { class: 'd-flex flex-wrap gap-2 mb-2' },
        h('button', {
            type: 'button', class: 'btn btn-sm btn-outline-secondary paste-rules-add', text: 'Add rule',
            onclick: () => { if (rules.length < maxRules) { rules.push({ pattern: '', dataset_match: 'prefix', enabled: true }); draw(); } },
        }),
        h('button', {
            type: 'button', class: 'btn btn-sm btn-outline-secondary paste-rules-default', text: 'Restore the default rule',
            title: 'Replace the list with the one rule that takes the whole text as a cell or gene name',
            onclick: () => { rules = DEFAULT_RULES.map(copyRule); draw(); },
        }),
        saveButton);

    root.append(
        h('p', { class: 'small text-muted mb-2' },
            'Tried in order, the first rule that matches wins. A pattern is a JavaScript regular expression with the named groups ',
            h('code', { text: '(?<cell>...)' }), ', ', h('code', { text: '(?<gene>...)' }), ' and optionally ',
            h('code', { text: '(?<dataset>...)' }), `; the pasted text is trimmed and ignored above ${MAX_TEXT.toLocaleString('en-GB')} characters.`),
        list, actions,
        h('label', { class: 'form-label small mb-1', for: 'paste-rules-test', text: 'Test' }), sample, result);
    draw();
    return root;
}
