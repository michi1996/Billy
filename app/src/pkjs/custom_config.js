/**
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Runs inside the configuration page (not in PebbleKit JS). Clay copies this function's source
// into the page, so it must be self-contained ES5 and must not contain dollar-sign replacement
// patterns or a closing script tag. The layout follows the Pebble Authenticator settings page.
module.exports = function() {
    var clayConfig = this;

    // Must match settings_page.SECRET_PLACEHOLDER: the page gets this instead of a stored secret.
    var SECRET_PLACEHOLDER = '__buddy_unchanged__';
    // Must match settings_page.PAGE_ENCODED_PREFIX: values with characters that would break the
    // page arrive URL-encoded behind this marker.
    var PAGE_ENCODED_PREFIX = '__buddy_encoded__:';
    var SECRET_KEYS = ['CF_ACCESS_CLIENT_ID', 'CF_ACCESS_CLIENT_SECRET', 'LLM_API_KEY'];
    // Must match quick_prompts.js.
    var CUSTOM_KEYS = ['CUSTOM_PROMPT_1', 'CUSTOM_PROMPT_2', 'CUSTOM_PROMPT_3',
                       'CUSTOM_PROMPT_4', 'CUSTOM_PROMPT_5', 'CUSTOM_PROMPT_6'];
    var MAX_CUSTOM_BYTES = 250;
    var MAX_PROMPT_CHARS = 60;

    var WATCH_NAMES = {
        aplite: 'Pebble Classic',
        basalt: 'Pebble Time',
        chalk: 'Pebble Time Round',
        diorite: 'Pebble 2',
        emery: 'Pebble Time 2',
        flint: 'Pebble 2 Duo',
        gabbro: 'Pebble Round 2'
    };

    // resources/icons/billy_general.svg in white, 64 x 64.
    var APP_ICON = 'data:image/png;base64,' +
        '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' +
        'Zw3vAAAAAElFTkSuQmCC';

    var SVG_OPEN = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" ';
    var STROKE = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
                 'stroke-linejoin="round"';
    var ICONS = {
        watch: SVG_OPEN + 'width="16" height="16" ' + STROKE + '>' +
            '<rect x="6.5" y="6" width="11" height="12" rx="3"/><path d="M9 6l.8-3h4.4L15 6M9 18l.8 3h4.4l.8-3"/></svg>',
        lock: SVG_OPEN + 'width="18" height="18" ' + STROKE + '>' +
            '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>'
    };

    var ui = {};
    var initial = null; // snapshot at page load, for the unsaved-changes hint

    // --- Helpers ---

    function el(tag, props, children) {
        var node = document.createElement(tag);
        Object.keys(props || {}).forEach(function(key) {
            var value = props[key];
            if (value === undefined || value === null || value === false) {
                return;
            }
            if (key === 'text') {
                node.textContent = value;
            } else if (key === 'html') {
                node.innerHTML = value; // static markup only, never user data
            } else if (key === 'className') {
                node.className = value;
            } else {
                node.setAttribute(key, value === true ? '' : value);
            }
        });
        (children || []).forEach(function(child) {
            node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
        });
        return node;
    }

    function isEnter(event) {
        return event.key === 'Enter' || event.keyCode === 13;
    }

    function utf8Length(text) {
        return unescape(encodeURIComponent(text)).length;
    }

    // --- Components ---

    var displayOnly = {
        get: function() {
            return '';
        },
        set: function() {
            return this;
        }
    };

    clayConfig.registerComponent({
        name: 'buddy-header',
        template: '<div class="component buddy-header"></div>',
        manipulator: displayOnly,
        initialize: function() {
            var root = this.$element[0];
            root.appendChild(el('div', {className: 'hero'}, [
                el('div', {className: 'hero-icon'}, [el('img', {src: APP_ICON, alt: ''})]),
                el('div', {}, [
                    el('h1', {text: 'Buddy'}),
                    el('p', {text: 'Your voice assistant, powered by your own server'})
                ])
            ]));
            var info = clayConfig.meta && clayConfig.meta.activeWatchInfo;
            var watchName = info && WATCH_NAMES[info.platform];
            if (watchName) {
                root.appendChild(el('div', {className: 'watch-chip'}, [
                    el('span', {className: 'watch-chip-icon', html: ICONS.watch}),
                    el('span', {text: watchName})
                ]));
            }
        }
    });

    clayConfig.registerComponent({
        name: 'buddy-privacy',
        template: '<div class="component buddy-privacy"></div>',
        manipulator: displayOnly,
        initialize: function() {
            var root = this.$element[0];
            root.appendChild(el('span', {className: 'buddy-privacy-icon', html: ICONS.lock}));
            root.appendChild(el('p', {text: 'Your server address and access token stay on this phone. ' +
                'They are only sent to your own server, never to the watch.'}));
        }
    });

    // --- Stored values ---

    function decodeStoredValues() {
        clayConfig.getAllItems().forEach(function(item) {
            var value = item.messageKey ? item.get() : null;
            if (typeof value !== 'string' || value.indexOf(PAGE_ENCODED_PREFIX) !== 0) {
                return;
            }
            try {
                item.set(decodeURIComponent(value.substring(PAGE_ENCODED_PREFIX.length)));
            } catch (e) {
                item.set('');
            }
        });
    }

    // --- Unsaved changes ---

    function snapshot() {
        var values = {};
        clayConfig.getAllItems().forEach(function(item) {
            if (item.messageKey) {
                values[item.messageKey] = item.get();
            }
        });
        return JSON.stringify(values);
    }

    function updateDirty() {
        if (initial === null) {
            return;
        }
        var dirty = snapshot() !== initial;
        document.body.classList.toggle('is-dirty', dirty);
        if (ui.saveHint) {
            ui.saveHint.textContent = dirty ? 'You have unsaved changes' :
                'Changes take effect when you save';
        }
    }

    // --- Access token fields ---

    // A stored secret arrives as the placeholder. It shows as dots with a "Saved" badge and
    // behaves like one block: typing replaces it, deleting clears it.
    function setupSecret(item) {
        var input = item.$manipulatorTarget[0];
        var label = item.$element[0].querySelector('.label');
        var badge = el('span', {className: 'saved-badge', text: 'Saved'});
        if (label) {
            label.appendChild(badge);
        }
        var previous = input.value;

        function update() {
            badge.classList.toggle('hide', input.value !== SECRET_PLACEHOLDER);
        }

        input.addEventListener('focus', function() {
            if (input.value !== SECRET_PLACEHOLDER) {
                return;
            }
            setTimeout(function() {
                try {
                    input.setSelectionRange(0, input.value.length);
                } catch (e) {
                    input.select();
                }
            }, 0);
        });
        input.addEventListener('input', function() {
            var value = input.value;
            if (previous === SECRET_PLACEHOLDER && value !== SECRET_PLACEHOLDER) {
                if (value.indexOf(SECRET_PLACEHOLDER) === 0) {
                    input.value = value.substring(SECRET_PLACEHOLDER.length);
                } else if (SECRET_PLACEHOLDER.indexOf(value) === 0) {
                    input.value = '';
                }
            }
            previous = input.value;
            update();
        });
        update();
    }

    // --- Sliders ---

    // Fills the track left of the thumb. Clay draws this with a pseudo-element on the thumb,
    // which Android web views do not render.
    function setupSlider(item) {
        var slider = item.$manipulatorTarget[0];

        function update() {
            var min = parseFloat(slider.min) || 0;
            var max = parseFloat(slider.max) || 100;
            var ratio = max > min ? (parseFloat(slider.value) - min) / (max - min) : 0;
            slider.style.setProperty('--fill', String(Math.max(0, Math.min(1, ratio))));
        }

        slider.addEventListener('input', update);
        item.on('change', update);
        update();
    }

    // --- Server check ---

    // Result of the check that runs after the server settings are saved (server_check.js),
    // shown above the server fields. It fades while those fields are being edited.
    function setupServerStatus() {
        var check = clayConfig.meta && clayConfig.meta.userData && clayConfig.meta.userData.serverCheck;
        var urlItem = clayConfig.getItemByMessageKey('LLM_BASE_URL');
        if (!check || !urlItem) {
            return;
        }
        var when = '';
        try {
            when = check.time ? new Date(check.time).toLocaleString([], {
                day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
            }) : '';
        } catch (e) {
            when = '';
        }
        var detail = check.ok ? check.model + ' \u00b7 ' + (check.ms / 1000).toFixed(1) + ' s' : check.message;
        var status = el('div', {className: 'component server-status ' + (check.ok ? 'is-ok' : 'is-error')}, [
            el('span', {className: 'server-status-dot', 'aria-hidden': 'true'}),
            el('div', {className: 'server-status-text'}, [
                el('strong', {text: check.ok ? 'Connected' : 'Last check failed'}),
                el('span', {text: detail + (when ? ' \u00b7 ' + when : '')})
            ])
        ]);
        var urlElement = urlItem.$element[0];
        urlElement.parentNode.insertBefore(status, urlElement);
        ['LLM_BASE_URL', 'LLM_MODEL'].concat(SECRET_KEYS).forEach(function(key) {
            var item = clayConfig.getItemByMessageKey(key);
            if (item) {
                item.$manipulatorTarget[0].addEventListener('input', function() {
                    status.classList.add('is-stale');
                });
            }
        });
    }

    // --- Quick prompts ---

    // Same rules as quick_prompts.customText: prompts that do not fit are left out.
    function promptBudget(fields) {
        var text = '';
        var count = 0;
        var dropped = [];
        fields.forEach(function(field, index) {
            var prompt = String(field.get() || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
            if (!prompt) {
                return;
            }
            prompt = prompt.substring(0, MAX_PROMPT_CHARS);
            count++;
            var candidate = text ? text + '\n' + prompt : prompt;
            if (utf8Length(candidate) <= MAX_CUSTOM_BYTES) {
                text = candidate;
            } else {
                dropped.push(index + 1);
            }
        });
        return {count: count, used: utf8Length(text), dropped: dropped};
    }

    function setupQuickPrompts() {
        var choice = clayConfig.getItemByMessageKey('QUICK_PROMPTS');
        var fields = [];
        CUSTOM_KEYS.forEach(function(key) {
            var field = clayConfig.getItemByMessageKey(key);
            if (field) {
                fields.push(field);
            }
        });
        if (!choice || !fields.length) {
            return;
        }
        var budget = el('div', {className: 'component prompt-budget', 'aria-live': 'polite'});
        var last = fields[fields.length - 1].$element[0];
        last.parentNode.insertBefore(budget, last.nextSibling);

        function updateBudget() {
            var result = promptBudget(fields);
            var message;
            if (!result.count) {
                message = 'Add up to six prompts. Without any, Buddy shows the automatic list.';
            } else {
                message = result.used + ' of ' + MAX_CUSTOM_BYTES + ' bytes used';
            }
            if (result.dropped.length) {
                message += ' \u2013 ' + (result.dropped.length === 1 ? 'prompt ' : 'prompts ') +
                    result.dropped.join(', ') + (result.dropped.length === 1 ? ' does' : ' do') +
                    ' not fit and will not appear on the watch.';
            }
            budget.textContent = message;
            budget.classList.toggle('is-warning', result.dropped.length > 0);
        }

        function update() {
            var custom = choice.get() === 'custom';
            fields.forEach(function(field) {
                if (custom) {
                    field.show();
                } else {
                    field.hide();
                }
            });
            budget.classList.toggle('hide', !custom);
            updateBudget();
        }

        choice.on('change', update);
        fields.forEach(function(field) {
            field.$manipulatorTarget[0].addEventListener('input', updateBudget);
        });
        update();
    }

    // --- Styles ---

    var css = [
        ':root{--bg:#f2f2f7;--card:#fff;--text:#16161b;--text-2:#62626d;--text-3:#8e8e99;',
        '--line:rgba(60,60,67,.14);--field:#f0f0f4;--accent:#cf4310;--accent-pressed:#b53a0d;',
        '--accent-text:#c2410c;--accent-soft:rgba(207,67,16,.12);--success:#1b7a43;',
        '--success-soft:rgba(27,122,67,.1);--warning:#8a5300;--warning-soft:rgba(214,138,0,.14);',
        '--danger:#d70015;--danger-soft:rgba(215,0,21,.08);',
        '--switch-off:#e3e3e8;--savebar-bg:rgba(242,242,247,.86);',
        '--shadow:0 1px 2px rgba(16,16,24,.05),0 8px 24px rgba(16,16,24,.06);--savebar-h:104px;',
        '--button-glow:0 6px 18px rgba(207,67,16,.3)}',
        '@media (prefers-color-scheme:dark){:root{--bg:#0e0e11;--card:#1c1c21;--text:#f4f4f7;',
        '--text-2:#a5a5af;--text-3:#7a7a84;--line:rgba(255,255,255,.09);--field:#28282e;',
        '--accent-text:#ff8f61;--accent-soft:rgba(255,143,97,.14);--success:#3ddc6f;',
        '--success-soft:rgba(61,220,111,.13);--warning:#ffc457;--warning-soft:rgba(255,196,87,.13);',
        '--danger:#ff5a50;--danger-soft:rgba(255,90,80,.14);',
        '--switch-off:#3a3a40;--savebar-bg:rgba(14,14,17,.84);--shadow:none;--button-glow:none}}',

        'html,body{background:var(--bg)!important;color:var(--text);',
        'font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;',
        'font-size:16px;line-height:1.45;-webkit-text-size-adjust:100%}',
        'html,body{height:auto!important;min-height:100%}',
        'body{padding:calc(16px + env(safe-area-inset-top)) 16px 0!important;',
        '-webkit-tap-highlight-color:transparent}',
        '#main-form{max-width:640px;margin:0 auto;',
        'padding-bottom:calc(var(--savebar-h) + 24px + env(safe-area-inset-bottom))}',
        '#main-form .component{padding:0}',
        '#main-form h1,#main-form h4{font-family:inherit;text-transform:none;letter-spacing:-.01em;',
        'top:0;color:var(--text)}',
        '#main-form p{margin:0}',
        '#main-form button{font:inherit;text-transform:none;letter-spacing:normal;min-width:0;margin:0;',
        'padding:0;border:0;border-radius:0;background:none;color:inherit;display:inline-flex;',
        'align-items:center;gap:6px;cursor:pointer;-webkit-tap-highlight-color:transparent;',
        'transition:background-color .15s,color .15s,transform .1s}',
        '#main-form button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}',
        '#main-form svg{display:block;flex:none}',

        '#main-form .buddy-header{padding:4px 2px 20px}',
        '.hero{display:flex;align-items:center;gap:14px}',
        '.hero-icon{flex:0 0 52px;height:52px;border-radius:15px;display:flex;align-items:center;',
        'justify-content:center;background:linear-gradient(145deg,#ff8040,#cf3a0b);',
        'box-shadow:0 8px 20px rgba(207,58,11,.28)}',
        '.hero-icon img{display:block;width:32px;height:32px}',
        '#main-form .hero h1{font-size:26px;line-height:1.15;font-weight:700;letter-spacing:-.02em}',
        '.hero p{color:var(--text-2);font-size:15px;margin-top:2px!important}',
        '.watch-chip{display:inline-flex;align-items:center;gap:6px;margin-top:14px;padding:6px 12px 6px 9px;',
        'border-radius:999px;background:var(--card);box-shadow:var(--shadow);color:var(--text-2);',
        'font-size:13px;font-weight:600}',
        '.watch-chip-icon{color:var(--accent-text)}',

        '#main-form .section{background:var(--card);border-radius:18px;box-shadow:var(--shadow);',
        'margin:0 0 16px;padding:0 0 6px;overflow:hidden}',
        '#main-form .section>.component{margin:0;padding:0 16px}',
        '#main-form .section>.component:after{display:none!important}',
        '#main-form .section>.component-heading:first-child{background:none;border-radius:0;padding:16px 16px 2px}',
        '#main-form .component-heading h4{font-size:18px;line-height:1.3;font-weight:650}',
        '#main-form .tap-highlight:active{background:none}',
        '#main-form .component-text p{font-size:14px;line-height:1.45;color:var(--text-2);padding:4px 0 2px}',
        '#main-form .section .description{padding:6px 0 0;font-size:13px;line-height:1.4;color:var(--text-2)}',

        '#main-form .component-input label,#main-form .component-select label,',
        '#main-form .component-slider label{display:block;padding:14px 0 0;border-radius:0}',
        '#main-form .component-input .label,#main-form .component-select .label{display:flex;',
        'align-items:center;gap:8px;padding:0;margin:0 0 6px;font-size:13px;font-weight:600;color:var(--text-2)}',
        '#main-form .component-input .input{display:block;min-width:0;max-width:none;margin:0}',
        '#main-form .component-input input,#main-form .component-select select{display:block;width:100%;',
        'font:inherit;font-size:16px;line-height:1.4;color:var(--text);background:var(--field);',
        'border:1.5px solid transparent;border-radius:12px;padding:12px 14px;margin:0;min-height:0;',
        'height:auto;-webkit-appearance:none;appearance:none;',
        'transition:border-color .15s,box-shadow .15s,background-color .15s}',
        '#main-form .component-input input::placeholder{color:var(--text-3);opacity:1}',
        '#main-form .component-input input:focus,#main-form .component-select select:focus{outline:none;',
        'border-color:var(--accent);background:var(--card);box-shadow:0 0 0 4px var(--accent-soft)}',
        '#main-form .component-select label{position:relative}',
        '#main-form .component-select .value{display:none}',
        '#main-form .component-select select{position:static;opacity:1;padding-right:40px;',
        'text-overflow:ellipsis;white-space:nowrap;overflow:hidden;cursor:pointer}',
        '#main-form .component-select label:after{content:"";position:absolute;right:18px;bottom:21px;',
        'width:7px;height:7px;border-right:2px solid var(--text-2);border-bottom:2px solid var(--text-2);',
        'transform:rotate(45deg);pointer-events:none}',
        '#main-form .section>.server-status{display:flex;align-items:flex-start;gap:10px;margin:14px 16px 0;',
        'padding:10px 12px;border-radius:12px;font-size:13px;line-height:1.4;transition:opacity .2s}',
        '.server-status.is-ok{background:var(--success-soft);color:var(--success)}',
        '.server-status.is-error{background:var(--danger-soft);color:var(--danger)}',
        '.server-status.is-stale{opacity:.45}',
        '.server-status-dot{flex:none;width:8px;height:8px;border-radius:50%;background:currentColor;margin-top:5px}',
        '.server-status-text{min-width:0}',
        '#main-form .server-status strong{display:block;color:inherit;font-weight:650}',
        '.server-status-text span{display:block;color:var(--text-2);word-break:break-word}',
        '.saved-badge{font-size:11px;font-weight:650;letter-spacing:.02em;color:var(--success);',
        'background:var(--success-soft);border-radius:999px;padding:1px 8px}',

        '#main-form .component-slider .label-container{display:flex;align-items:center;padding:0 0 2px}',
        '#main-form .component-slider .label{flex:1;font-size:16px;color:var(--text);padding:0 12px 0 0}',
        '#main-form .component-slider .value,#main-form .component-slider .value-pad{font:inherit;',
        'font-size:15px;font-weight:650;line-height:1.4;color:var(--accent-text);background:var(--accent-soft);',
        'border:0;border-radius:9px;padding:4px 10px;min-width:48px;text-align:center}',
        '#main-form .component-slider .value:focus{outline:2px solid var(--accent)}',
        '#main-form .component-slider .input{height:36px;margin:0;max-width:none;overflow:visible}',
        '#main-form .component-slider .input:before{height:4px;top:16px;border-radius:2px;background:var(--switch-off)}',
        '#main-form .component-slider .slider{height:36px;',
        'background:linear-gradient(var(--accent),var(--accent)) no-repeat 0 16px;',
        'background-size:calc(14px + (100% - 28px) * var(--fill,0)) 4px}',
        '#main-form .component-slider .slider::-webkit-slider-runnable-track{height:36px}',
        '#main-form .component-slider .slider::-webkit-slider-thumb{width:28px;height:28px;margin-top:4px;',
        'background:#fff;box-shadow:0 2px 5px rgba(0,0,0,.2),0 0 1px rgba(0,0,0,.25)}',
        '#main-form .component-slider .slider::-webkit-slider-thumb:before{display:none}',

        '#main-form .component-toggle label{padding:14px 0 12px;border-radius:0}',
        '#main-form .component-toggle .label{font-size:16px;color:var(--text)}',
        '#main-form .component-toggle .input{max-width:none;margin-left:16px}',
        '#main-form .component-toggle .slide{width:51px;height:31px;border-radius:31px;background:var(--switch-off);',
        'transition:background-color .2s}',
        '#main-form .component-toggle .marker{width:27px;height:27px;top:2px;left:2px;border-radius:50%;',
        'background:#fff;box-shadow:0 2px 5px rgba(0,0,0,.2),0 0 1px rgba(0,0,0,.25);transition:transform .2s}',
        '#main-form .component-toggle input:checked+.graphic .slide{background:var(--accent)}',
        '#main-form .component-toggle input:checked+.graphic .marker{background:#fff;transform:translateX(20px)}',
        '#main-form .section .component-toggle .description{padding:0 0 10px;margin-top:-4px}',

        '#main-form .section>.prompt-budget{padding:12px 16px 4px;font-size:13px;line-height:1.4;color:var(--text-2)}',
        '#main-form .section>.prompt-budget.is-warning{color:var(--warning);font-weight:600}',

        '#main-form .buddy-privacy{display:flex;gap:10px;align-items:flex-start;padding:2px 6px 8px;',
        'color:var(--text-2);font-size:13px;line-height:1.45}',
        '.buddy-privacy-icon{color:var(--text-3);margin-top:1px}',

        '#main-form .component-submit{position:fixed;left:0;right:0;bottom:0;z-index:20;margin:0;',
        'padding:10px 16px calc(12px + env(safe-area-inset-bottom));text-align:center;background:var(--savebar-bg);',
        '-webkit-backdrop-filter:saturate(180%) blur(18px);backdrop-filter:saturate(180%) blur(18px);',
        'border-top:1px solid var(--line)}',
        '.save-hint{font-size:13px;color:var(--text-2);margin:0 0 8px!important}',
        '.is-dirty .save-hint{color:var(--accent-text);font-weight:600}',
        '#main-form .component-submit button{display:flex;justify-content:center;width:100%;max-width:608px;',
        'height:52px;margin:0 auto;border-radius:14px;background:var(--accent);color:#fff;font-size:17px;',
        'font-weight:650;box-shadow:var(--button-glow)}',
        '#main-form .component-submit button:active{background:var(--accent-pressed);transform:scale(.985)}',

        '@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}'
    ].join('');

    var style = document.createElement('style');
    style.appendChild(document.createTextNode(css));
    document.head.appendChild(style);

    clayConfig.on(clayConfig.EVENTS.AFTER_BUILD, function() {
        decodeStoredValues();

        // Let the page use the full screen on phones with a notch / home indicator.
        var viewport = document.querySelector('meta[name="viewport"]');
        if (viewport && viewport.content.indexOf('viewport-fit') < 0) {
            viewport.content += ', viewport-fit=cover';
        }

        SECRET_KEYS.forEach(function(key) {
            var item = clayConfig.getItemByMessageKey(key);
            if (item) {
                setupSecret(item);
            }
        });
        setupServerStatus();
        clayConfig.getItemsByType('slider').forEach(setupSlider);
        setupQuickPrompts();

        var submit = clayConfig.getItemsByType('submit')[0];
        if (submit) {
            ui.saveBar = submit.$element[0];
            ui.saveHint = el('p', {className: 'save-hint'});
            ui.saveBar.insertBefore(ui.saveHint, ui.saveBar.firstChild);
            var syncSaveBarHeight = function() {
                document.documentElement.style.setProperty('--savebar-h', ui.saveBar.offsetHeight + 'px');
            };
            syncSaveBarHeight();
            window.addEventListener('resize', syncSaveBarHeight);
        }

        var root = clayConfig.$rootContainer[0];
        // Enter in a single-line field would submit the form and close the page.
        root.addEventListener('keydown', function(event) {
            if (isEnter(event) && event.target.tagName === 'INPUT') {
                event.preventDefault();
            }
        });
        root.addEventListener('input', updateDirty);
        root.addEventListener('change', updateDirty);

        initial = snapshot();
        updateDirty();
    });
};
