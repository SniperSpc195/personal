// ==UserScript==
// @name         PokeDive - Skill Details
// @namespace    http://tampermonkey.net/
// @version      1.2.0
// @description  Shows detailed stats (power, cooldown, effects) for the move you are choosing, next to the game's own learn-popup
// @author       Cline
// @match        *://pokedive.com/*
// @match        *://www.pokedive.com/*
// @grant        none
// @run-at       document-end
// ==/UserScript==
// @ts-nocheck

(function() {
    'use strict';

    const SCRIPT_NAME = 'PokeDive Skill Details';
    const INIT_KEY = '__pokedive_skill_details_initialized';

    if (window[INIT_KEY]) return;
    window[INIT_KEY] = true;

    const CONFIG = {
        storageKey: 'pokedive_skilldetails_settings',
        defaults: {
            enabled: true,
            debug: false,
            showPopup: true,
            position: 'right'
        },
        selectors: {
            learnBox: '.win.learn-box',
            newMoveName: '.lnew .nm',
            learnTitle: '.head .ttl'
        }
    };

    /* ------------------------------------------------------------------ */
    /* Move database. Power / cooldown / kind come from the official      */
    /* client data. Effect text is inferred from the move kind. Status    */
    /* durations are not published by the client, so only the status type */
    /* is shown. Heal moves restore `power` % HP.                         */
    /* ------------------------------------------------------------------ */
    const MOVE_DB = {
        // Electric
        'thundershock': { name: 'Thunder Shock', type: 'Electric', kind: 'projectile', power: 7, cooldown: 0.62 },
        'thunderbolt': { name: 'Thunderbolt', type: 'Electric', kind: 'strike', power: 20, cooldown: 3.6, status: 'paralyze' },
        'thunderwave': { name: 'Thunder Wave', type: 'Electric', kind: 'ring', power: 5, cooldown: 6, status: 'paralyze' },
        'spark': { name: 'Spark', type: 'Electric', kind: 'dash', power: 15, cooldown: 3.5 },
        'electricterrain': { name: 'Electric Terrain', type: 'Electric', kind: 'zone', power: 0, cooldown: 7.5 },
        // Water
        'bubble': { name: 'Bubble', type: 'Water', kind: 'projectile', power: 6, cooldown: 1 },
        'waterpulse': { name: 'Water Pulse', type: 'Water', kind: 'burst', power: 12, cooldown: 4 },
        'withdraw': { name: 'Withdraw', type: 'Water', kind: 'shield', power: 0, cooldown: 8 },
        'bubblebeam': { name: 'Bubble Beam', type: 'Water', kind: 'line', power: 14, cooldown: 3.2 },
        'aquajet': { name: 'Aqua Jet', type: 'Water', kind: 'dash', power: 0, cooldown: 3.5 },
        // Fire
        'ember': { name: 'Ember', type: 'Fire', kind: 'projectile', power: 7, cooldown: 0.7, status: 'burn' },
        'incinerate': { name: 'Incinerate', type: 'Fire', kind: 'burst', power: 16, cooldown: 4, status: 'burn' },
        'firespin': { name: 'Fire Spin', type: 'Fire', kind: 'zone', power: 0, cooldown: 7, status: 'burn' },
        'flamethrower': { name: 'Flamethrower', type: 'Fire', kind: 'line', power: 18, cooldown: 4, status: 'burn' },
        'flamecharge': { name: 'Flame Charge', type: 'Fire', kind: 'dash', power: 0, cooldown: 3.5, status: 'burn' },
        // Grass
        'razorleaf': { name: 'Razor Leaf', type: 'Grass', kind: 'projectile', power: 7, cooldown: 0.65 },
        'vinewhip': { name: 'Vine Whip', type: 'Grass', kind: 'line', power: 18, cooldown: 3 },
        'synthesis': { name: 'Synthesis', type: 'Grass', kind: 'heal', power: 25, cooldown: 9, status: 'heal' },
        'magicalleaf': { name: 'Magical Leaf', type: 'Grass', kind: 'strike', power: 17, cooldown: 3.2 },
        'leechseed': { name: 'Leech Seed', type: 'Grass', kind: 'trap', power: 0, cooldown: 4.5 },

        // Normal
        'swift': { name: 'Swift', type: 'Normal', kind: 'projectile', power: 7, cooldown: 0.65 },
        'hypervoice': { name: 'Hyper Voice', type: 'Normal', kind: 'ring', power: 13, cooldown: 5 },
        'bodyslam': { name: 'Body Slam', type: 'Normal', kind: 'burst', power: 18, cooldown: 4, status: 'paralyze' },
        'protect': { name: 'Protect', type: 'Normal', kind: 'shield', power: 0, cooldown: 8 },
        'quickattack': { name: 'Quick Attack', type: 'Normal', kind: 'dash', power: 0, cooldown: 3 },
        // Bug
        'bugbite': { name: 'Bug Bite', type: 'Bug', kind: 'projectile', power: 6, cooldown: 0.6 },
        'stringshot': { name: 'String Shot', type: 'Bug', kind: 'ring', power: 4, cooldown: 6 },
        'signalbeam': { name: 'Signal Beam', type: 'Bug', kind: 'line', power: 16, cooldown: 3.4 },
        'stickyweb': { name: 'Sticky Web', type: 'Bug', kind: 'zone', power: 0, cooldown: 4.5 },
        'uturn': { name: 'U-turn', type: 'Bug', kind: 'dash', power: 0, cooldown: 3.2 },
        // Rock
        'rockthrow': { name: 'Rock Throw', type: 'Rock', kind: 'projectile', power: 9, cooldown: 0.9 },
        'rockslide': { name: 'Rock Slide', type: 'Rock', kind: 'burst', power: 19, cooldown: 4.2 },
        'harden': { name: 'Harden', type: 'Rock', kind: 'shield', power: 0, cooldown: 7 },
        'stealthrock': { name: 'Stealth Rock', type: 'Rock', kind: 'trap', power: 0, cooldown: 4.5 },
        'rollout': { name: 'Rollout', type: 'Rock', kind: 'dash', power: 0, cooldown: 4 },
        // Ground
        'mudslap': { name: 'Mud-Slap', type: 'Ground', kind: 'projectile', power: 7, cooldown: 0.8 },
        'bulldoze': { name: 'Bulldoze', type: 'Ground', kind: 'ring', power: 14, cooldown: 5.5 },
        'mudshot': { name: 'Mud Shot', type: 'Ground', kind: 'line', power: 15, cooldown: 3.4 },
        'spikes': { name: 'Spikes', type: 'Ground', kind: 'trap', power: 0, cooldown: 4.5 },
        'sandtomb': { name: 'Sand Tomb', type: 'Ground', kind: 'zone', power: 0, cooldown: 7 },

        // Flying
        'gust': { name: 'Gust', type: 'Flying', kind: 'projectile', power: 6, cooldown: 0.6 },
        'wingattack': { name: 'Wing Attack', type: 'Flying', kind: 'line', power: 17, cooldown: 3 },
        'roost': { name: 'Roost', type: 'Flying', kind: 'heal', power: 22, cooldown: 9, status: 'heal' },
        'aerialace': { name: 'Aerial Ace', type: 'Flying', kind: 'dash', power: 0, cooldown: 3 },
        'aircutter': { name: 'Air Cutter', type: 'Flying', kind: 'burst', power: 0, cooldown: 4 },
        // Poison
        'poisonsting': { name: 'Poison Sting', type: 'Poison', kind: 'projectile', power: 5, cooldown: 0.7, status: 'poison' },
        'sludge': { name: 'Sludge', type: 'Poison', kind: 'burst', power: 14, cooldown: 4, status: 'poison' },
        'poisongas': { name: 'Poison Gas', type: 'Poison', kind: 'ring', power: 4, cooldown: 6, status: 'poison' },
        'toxicspikes': { name: 'Toxic Spikes', type: 'Poison', kind: 'trap', power: 0, cooldown: 4.5 },
        'banefulbunker': { name: 'Baneful Bunker', type: 'Poison', kind: 'counter', power: 0, cooldown: 6, status: 'poison' },
        // Ice
        'powdersnow': { name: 'Powder Snow', type: 'Ice', kind: 'projectile', power: 6, cooldown: 0.7, status: 'freeze' },
        'icebeam': { name: 'Ice Beam', type: 'Ice', kind: 'line', power: 16, cooldown: 4, status: 'freeze' },
        'icywind': { name: 'Icy Wind', type: 'Ice', kind: 'ring', power: 9, cooldown: 5.5 },
        'iceshard': { name: 'Ice Shard', type: 'Ice', kind: 'dash', power: 0, cooldown: 3.2 },
        'hail': { name: 'Hail', type: 'Ice', kind: 'zone', power: 0, cooldown: 8 },

        // Fighting
        'vacuumwave': { name: 'Vacuum Wave', type: 'Fighting', kind: 'projectile', power: 8, cooldown: 0.75 },
        'brickbreak': { name: 'Brick Break', type: 'Fighting', kind: 'line', power: 19, cooldown: 3.2 },
        'bulkup': { name: 'Bulk Up', type: 'Fighting', kind: 'shield', power: 0, cooldown: 7.5 },
        'counter': { name: 'Counter', type: 'Fighting', kind: 'counter', power: 0, cooldown: 5.5 },
        'machpunch': { name: 'Mach Punch', type: 'Fighting', kind: 'dash', power: 0, cooldown: 3 },
        // Psychic
        'confusion': { name: 'Confusion', type: 'Psychic', kind: 'projectile', power: 7, cooldown: 0.7 },
        'psybeam': { name: 'Psybeam', type: 'Psychic', kind: 'line', power: 16, cooldown: 3.4 },
        'psychic': { name: 'Psychic', type: 'Psychic', kind: 'strike', power: 21, cooldown: 4 },
        'futuresight': { name: 'Future Sight', type: 'Psychic', kind: 'trap', power: 0, cooldown: 4.5 },
        'magiccoat': { name: 'Magic Coat', type: 'Psychic', kind: 'counter', power: 0, cooldown: 6 },
        // Ghost
        'astonish': { name: 'Astonish', type: 'Ghost', kind: 'projectile', power: 7, cooldown: 0.7 },
        'shadowball': { name: 'Shadow Ball', type: 'Ghost', kind: 'burst', power: 18, cooldown: 4 },
        'nightshade': { name: 'Night Shade', type: 'Ghost', kind: 'strike', power: 17, cooldown: 3.4 },
        'shadowsneak': { name: 'Shadow Sneak', type: 'Ghost', kind: 'dash', power: 0, cooldown: 3 },
        'destinybond': { name: 'Destiny Bond', type: 'Ghost', kind: 'counter', power: 0, cooldown: 6.5 },

        // Dragon
        'dragonbreath': { name: 'Dragon Breath', type: 'Dragon', kind: 'projectile', power: 8, cooldown: 0.8 },
        'dragonpulse': { name: 'Dragon Pulse', type: 'Dragon', kind: 'burst', power: 19, cooldown: 4.2 },
        'twister': { name: 'Twister', type: 'Dragon', kind: 'ring', power: 13, cooldown: 5 },
        'dragonrush': { name: 'Dragon Rush', type: 'Dragon', kind: 'dash', power: 0, cooldown: 4 },
        'dragondance': { name: 'Dragon Dance', type: 'Dragon', kind: 'shield', power: 0, cooldown: 7 },
        // Dark
        'bite': { name: 'Bite', type: 'Dark', kind: 'projectile', power: 8, cooldown: 0.75 },
        'crunch': { name: 'Crunch', type: 'Dark', kind: 'line', power: 19, cooldown: 3.4 },
        'snarl': { name: 'Snarl', type: 'Dark', kind: 'ring', power: 9, cooldown: 5.5 },
        'suckerpunch': { name: 'Sucker Punch', type: 'Dark', kind: 'dash', power: 0, cooldown: 3 },
        'foulplay': { name: 'Foul Play', type: 'Dark', kind: 'counter', power: 0, cooldown: 5.5 },
        // Steel
        'bulletpunch': { name: 'Bullet Punch', type: 'Steel', kind: 'projectile', power: 8, cooldown: 0.75 },
        'flashcannon': { name: 'Flash Cannon', type: 'Steel', kind: 'line', power: 17, cooldown: 3.6 },
        'irondefense': { name: 'Iron Defense', type: 'Steel', kind: 'shield', power: 0, cooldown: 7 },
        'metalburst': { name: 'Metal Burst', type: 'Steel', kind: 'counter', power: 0, cooldown: 6 },
        'gyroball': { name: 'Gyro Ball', type: 'Steel', kind: 'dash', power: 0, cooldown: 4 },
        // Fairy
        'fairywind': { name: 'Fairy Wind', type: 'Fairy', kind: 'projectile', power: 7, cooldown: 0.7 },
        'dazzlinggleam': { name: 'Dazzling Gleam', type: 'Fairy', kind: 'ring', power: 14, cooldown: 5 },
        'drainingkiss': { name: 'Draining Kiss', type: 'Fairy', kind: 'heal', power: 22, cooldown: 9, status: 'heal' },
        'mistyterrain': { name: 'Misty Terrain', type: 'Fairy', kind: 'zone', power: 0, cooldown: 7.5 },
        'playrough': { name: 'Play Rough', type: 'Fairy', kind: 'dash', power: 0, cooldown: 3.5 }
    };

    // Localized move-name aliases (best effort; extend as needed). Keys are
    // normalized English move names; values are localized spellings.
    const ALIASES = {
        'thunderbolt': ['rayo'],
        'thundershock': ['impactrueno'],
        'thunderwave': ['onda trueno'],
        'spark': ['chispa'],
        'bubble': ['burbuja'],
        'waterpulse': ['pulsión agua'],
        'withdraw': ['retirada'],
        'bubblebeam': ['burbujazo'],
        'aquajet': ['jet agua'],
        'ember': ['brasas'],
        'flamethrower': ['llamarada'],
        'bodyslam': ['placaje'],
        'poisonsting': ['picadura venenosa'],
        'sludge': ['lodo'],
        'powdersnow': ['polvo nieve'],
        'icebeam': ['rayo hielo'],
        'synthesis': ['síntesis'],
        'roost': ['refugio'],
        'drainingkiss': ['beso drenante']
    };

    const STATUS_LABEL = {
        paralyze: 'Paralyze',
        poison: 'Poison',
        freeze: 'Freeze',
        burn: 'Burn',
        heal: 'Heal'
    };

    const KIND_LABEL = {
        projectile: 'Ranged',
        strike: 'Strike',
        burst: 'Burst',
        line: 'Line',
        dash: 'Dash',
        zone: 'Zone',
        shield: 'Shield',
        heal: 'Heal',
        trap: 'Trap',
        counter: 'Counter'
    };

    let settings = Object.assign({}, CONFIG.defaults);
    let popup = null;
    let currentLearnBox = null;
    let pollTimer = null;
    let lastUrl = null;
    let urlWatcher = null;
    let learnObserver = null;
    let hideUntilNext = false;   // user closed the popup for this learn-box
    let closedLearnBox = null;   // learn-box instance the user dismissed

    const log = (...args) => {
        if (settings.debug) {
            console.log('[' + SCRIPT_NAME + ']', ...args);
        }
    };

    function normalize(text) {
        return String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    function validateSettings(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var s = {};
        s.enabled = typeof raw.enabled === 'boolean' ? raw.enabled : CONFIG.defaults.enabled;
        s.debug = typeof raw.debug === 'boolean' ? raw.debug : CONFIG.defaults.debug;
        s.showPopup = typeof raw.showPopup === 'boolean' ? raw.showPopup : CONFIG.defaults.showPopup;
        s.position = ['right', 'below', 'left'].indexOf(raw.position) !== -1 ? raw.position : CONFIG.defaults.position;
        return s;
    }

    function loadSettings() {
        try {
            var raw = localStorage.getItem(CONFIG.storageKey);
            if (raw) {
                var parsed = JSON.parse(raw);
                var validated = validateSettings(parsed);
                if (validated) {
                    settings = Object.assign({}, CONFIG.defaults, validated);
                } else {
                    log('Invalid stored settings, using defaults');
                }
            }
        } catch (e) {
            log('Failed to load settings:', e);
        }
    }

    function saveSettings() {
        try {
            localStorage.setItem(CONFIG.storageKey, JSON.stringify(settings));
        } catch (e) {
            log('Failed to save settings:', e);
        }
    }

    function cleanup() {
        if (urlWatcher) {
            clearInterval(urlWatcher);
            urlWatcher = null;
        }
        stopPoll();
        if (learnObserver) {
            learnObserver.disconnect();
            learnObserver = null;
        }
        removePopup();
        popup = null;
        window[INIT_KEY] = false;
        log('Cleanup complete');
    }

    function startUrlWatcher() {
        lastUrl = location.href;
        urlWatcher = setInterval(function() {
            if (location.href !== lastUrl) {
                log('URL change detected, cleaning up and reinitializing');
                cleanup();
                window[INIT_KEY] = false;
                setTimeout(function() {
                    window[INIT_KEY] = true;
                    init();
                }, 100);
            }
        }, 1000);
    }

    function startPoll() {
        if (pollTimer) return;
        pollTimer = setInterval(syncLearnBox, 350);
    }

    function stopPoll() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    function lookupMove(rawName) {
        if (!rawName) return null;
        var norm = normalize(rawName);
        if (MOVE_DB[norm]) return MOVE_DB[norm];
        for (var key in ALIASES) {
            if (!ALIASES.hasOwnProperty(key)) continue;
            var aliases = ALIASES[key];
            for (var i = 0; i < aliases.length; i++) {
                if (normalize(aliases[i]) === norm) {
                    return MOVE_DB[key];
                }
            }
        }
        return null;
    }

    function extractMoveName(learnBox) {
        if (!learnBox) return null;
        var nameEl = learnBox.querySelector(CONFIG.selectors.newMoveName);
        if (!nameEl) return null;
        var text = (nameEl.textContent || '').trim();
        if (!text) return null;
        // "Pikachu wants to learn Thunderbolt!"  /  "¡Pikachu quiere aprender Rayo!"
        var m = text.match(/(?:wants to learn|quiere aprender)\s*(.+?)\s*!?\s*$/i);
        if (m) {
            return m[1].trim().replace(/^¡\s*/, '').trim();
        }
        return text;
    }

    function isLearnTitle(el) {
        if (!el) return false;
        var t = (el.textContent || '').toLowerCase();
        return t.indexOf('new move') !== -1 || t.indexOf('nuevo movimiento') !== -1;
    }

    function visibleLearnBox() {
        var lb = document.querySelector(CONFIG.selectors.learnBox);
        if (!lb) return null;
        if (!isLearnTitle(lb.querySelector(CONFIG.selectors.learnTitle))) return null;
        if (lb.closest('[hidden]')) return null;
        if (lb.offsetParent === null) return null;
        return lb;
    }

    /* ------------------------------------------------------------------ */
    /* Popup                                                                */
    /* ------------------------------------------------------------------ */
    function buildPopup() {
        if (popup && popup.box) return popup;
        var overlay = document.createElement('div');
        overlay.id = 'pokedive-skilldetails-box';
        overlay.style.cssText =
            'position: fixed; z-index: 2147483647; visibility: hidden; ' +
            'width: min(250px, 92vw); max-height: 60vh; overflow-y: auto; ' +
            'background: #111; color: #eee; border: 1px solid #444; border-radius: 8px; ' +
            'padding: 10px 12px; font-family: sans-serif; font-size: 13px; line-height: 1.35; ' +
            'box-shadow: 0 4px 12px rgba(0,0,0,0.55); display: flex; flex-direction: column; gap: 8px;';
        var header = document.createElement('div');
        header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 2px;';
        var title = document.createElement('div');
        title.textContent = 'Move details';
        title.style.cssText = 'font-weight: 800; font-size: 14px; color: #00d2ff; flex: 1;';
        var closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        closeBtn.style.cssText = 'background: transparent; border: 1px solid #444; color: #eee; font-size: 14px; cursor: pointer; line-height: 1; padding: 1px 6px; border-radius: 4px; flex: none;';
        closeBtn.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            hideUntilNext = true;
            closedLearnBox = currentLearnBox;
            removePopup();
            currentLearnBox = null;
            stopPoll();
        };
        header.appendChild(title);
        header.appendChild(closeBtn);
        var content = document.createElement('div');
        content.id = 'pokedive-skilldetails-content';
        content.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';
        var note = document.createElement('div');
        note.id = 'pokedive-skilldetails-note';
        note.style.cssText = 'font-size: 11px; color: #9aa0a6; border-top: 1px solid #333; margin-top: 6px; padding-top: 6px; line-height: 1.4;';
        note.textContent = 'Status durations are not published by the client. Heal % = power.';
        overlay.appendChild(header);
        overlay.appendChild(content);
        overlay.appendChild(note);
        document.body.appendChild(overlay);
        popup = { overlay: overlay, box: overlay, content: content, note: note };
        return popup;
    }
    function removePopup() {
        if (popup && popup.overlay && popup.overlay.parentNode) {
            popup.overlay.remove();
        }
        popup = null;
    }
    function escapeHtml(text) {
        if (!text) return '';
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    function powerText(entry) {
        if (entry.kind === 'heal') return 'Heals ' + entry.power + '% HP';
        if (entry.kind === 'zone') return entry.power + ' dmg over time';
        if (entry.power > 0) return entry.power;
        return '—';
    }
    function cooldownText(entry) {
        return entry.cooldown > 0 ? entry.cooldown + ' s' : '—';
    }
    function effectText(entry) {
        var parts = [];
        if (entry.kind === 'heal') parts.push('Restores ' + entry.power + '% HP.');
        else if (entry.kind === 'shield') parts.push('Raises defense.');
        else if (entry.kind === 'counter') parts.push('Retaliates when hit.');
        else if (entry.kind === 'trap') parts.push('Places a trap.');
        else if (entry.kind === 'zone') parts.push('Damaging zone.');
        else parts.push('Deals ' + entry.type + ' damage.');
        if (entry.status) {
            parts.push('Can ' + STATUS_LABEL[entry.status] + '.');
        }
        return parts.join(' ');
    }

    function renderMove(entry) {
        var rows = '';
        function row(label, value) {
            return '<div style="display: flex; justify-content: space-between; gap: 8px; font-size: 12.5px;"><span style="color:#9aa0a6;">' + escapeHtml(label) + '</span><span style="color:#eee;">' + escapeHtml(value) + '</span></div>';
        }
        rows += row('Move', entry.name);
        rows += row('Type', entry.type);
        rows += row('Kind', KIND_LABEL[entry.kind] || entry.kind);
        rows += row('Power', powerText(entry));
        rows += row('Cooldown', cooldownText(entry));
        rows += row('Effect', effectText(entry));
        return '<div style="display:flex;flex-direction:column;gap:6px;">' + rows + '</div>';
    }
    function renderUnknown(rawName) {
        return '<div style="display:flex;flex-direction:column;gap:6px;">' +
            '<div style="display:flex;justify-content:space-between;"><span style="color:#9aa0a6;">Move</span><span style="color:#00d2ff;font-weight:700;">' + escapeHtml(rawName) + '</span></div>' +
            '<div style="color:#e8343a;font-size:12px;">Stats not in database for this name/language.</div>' +
            '</div>';
    }
    function measureAndShow(p, learnBox, html) {
        p.content.innerHTML = html;
        p.overlay.style.visibility = 'hidden';
        p.overlay.style.left = '0';
        p.overlay.style.top = '0';
        p.overlay.style.transform = 'none';
        var w = p.overlay.offsetWidth;
        var h = p.overlay.offsetHeight;
        positionPopup(p, learnBox, w, h);
        p.overlay.style.visibility = 'visible';
        log('Move details popup shown');
    }
    function positionPopup(p, learnBox, w, h) {
        var rect = learnBox.getBoundingClientRect();
        var gap = 8;
        var vpW = window.innerWidth;
        var vpH = window.innerHeight;
        var left, top;
        if (rect.right + gap + w <= vpW - 8) {
            left = rect.right + gap;
            top = rect.top;
        } else if (rect.left - gap - w >= 8) {
            left = rect.left - gap - w;
            top = rect.top;
        } else if (rect.bottom + gap + h <= vpH - 8) {
            left = rect.left;
            top = rect.bottom + gap;
        } else if (rect.top - gap - h >= 8) {
            left = rect.left;
            top = rect.top - gap - h;
        } else if (rect.right + gap + w <= vpW - 8) {
            left = rect.right + gap;
            top = rect.top;
        } else {
            left = rect.left;
            top = rect.bottom + gap;
        }
        left = Math.max(6, Math.min(left, vpW - w - 6));
        top = Math.max(6, Math.min(top, vpH - h - 6));
        p.overlay.style.left = Math.round(left) + 'px';
        p.overlay.style.top = Math.round(top) + 'px';
        p.overlay.style.transform = 'none';
    }
    function showPopupFor(learnBox) {
        if (!settings.showPopup || hideUntilNext) return;
        var p = buildPopup();
        var rawName = extractMoveName(learnBox);
        var entry = lookupMove(rawName);
        var html = entry ? renderMove(entry) : (rawName ? renderUnknown(rawName) : null);
        if (!html) {
            removePopup();
            return;
        }
        measureAndShow(p, learnBox, html);
        currentLearnBox = learnBox;
        startPoll();
    }

    function syncLearnBox() {
        var lb = visibleLearnBox();
        if (!lb) {
            if (currentLearnBox) {
                log('Learn-box closed');
                removePopup();
                currentLearnBox = null;
                hideUntilNext = false;
                closedLearnBox = null;
                stopPoll();
            }
            return;
        }
        if (lb === closedLearnBox) return; // user dismissed this one
        if (lb !== currentLearnBox) {
            hideUntilNext = false;
            showPopupFor(lb);
        } else {
            if (popup && popup.overlay && popup.overlay.style.visibility === 'visible') {
                var p = popup;
                var w = p.overlay.offsetWidth;
                var h = p.overlay.offsetHeight;
                positionPopup(p, lb, w, h);
            }
        }
    }

    function init() {
        loadSettings();

        if (!window.location.hostname.includes('pokedive.com')) return;

        if (settings.enabled) {
            syncLearnBox();
            try {
                learnObserver = new MutationObserver(syncLearnBox);
                learnObserver.observe(document.documentElement, { childList: true, subtree: true });
            } catch (e) {
                log('Observer failed:', e);
            }
        }

        startUrlWatcher();
        window[INIT_KEY] = true;
        log('Skill Details initialized');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
