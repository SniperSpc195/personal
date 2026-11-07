// ==UserScript==
// @name         PokeDive - Skill Details
// @namespace    http://tampermonkey.net/
// @version      1.1.0
// @description  Displays detailed skill information on pokedive.com
// @author       Cline
// @match        *://pokedive.com/*
// @match        *://www.pokedive.com/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    const SCRIPT_NAME = 'PokeDive Skill Details';
    const INIT_KEY = '__pokedive_skill_details_initialized';

    // Guard against double initialization (userscript manager re-injection)
    if (window[INIT_KEY]) return;
    window[INIT_KEY] = true;

    const CONFIG = {
        storageKey: 'pokedive_skilldetails_settings',
        defaults: {
            enabled: true,
            debug: false,
            showPopup: true,
            autoOpen: false
        },
        selectors: {
            skillElements: '[class*="skill"], [data-skill], .skill-item, .skill-card',
            skillName: '[class*="skill-name"], [data-skill-name], .skill-name',
            skillLevel: '[class*="skill-level"], [data-skill-level], .skill-level',
            skillXP: '[class*="skill-xp"], [data-skill-xp], .skill-xp',
            skillContainer: '[class*="skills"], [class*="skill-list"], .skills, .skill-list'
        }
    };

    let settings = Object.assign({}, CONFIG.defaults);
    let popup = null;
    let lastUrl = null;
    let urlWatcher = null;

    const log = (...args) => {
        if (settings.debug) {
            console.log('[' + SCRIPT_NAME + ']', ...args);
        }
    };

    function validateSettings(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var s = {};
        s.enabled = typeof raw.enabled === 'boolean' ? raw.enabled : CONFIG.defaults.enabled;
        s.debug = typeof raw.debug === 'boolean' ? raw.debug : CONFIG.defaults.debug;
        s.showPopup = typeof raw.showPopup === 'boolean' ? raw.showPopup : CONFIG.defaults.showPopup;
        s.autoOpen = typeof raw.autoOpen === 'boolean' ? raw.autoOpen : CONFIG.defaults.autoOpen;
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
        var overlay = document.getElementById('pokedive-skilldetails-overlay');
        if (overlay) overlay.remove();
        popup = null;
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

    function parseSkillElement(el) {
        if (!el) return null;
        var nameEl = el.querySelector(CONFIG.selectors.skillName) || el;
        var levelEl = el.querySelector(CONFIG.selectors.skillLevel);
        var xpEl = el.querySelector(CONFIG.selectors.skillXP);
        var name = (nameEl.textContent || nameEl.getAttribute('data-skill-name') || '').trim();
        var level = (levelEl ? levelEl.textContent : '') || el.getAttribute('data-skill-level') || '';
        var xp = (xpEl ? xpEl.textContent : '') || el.getAttribute('data-skill-xp') || '';
        if (!name) return null;
        return { name: name, level: level, xp: xp, element: el };
    }

    function findSkills() {
        var skills = [];
        try {
            var containers = document.querySelectorAll(CONFIG.selectors.skillContainer);
            var candidates = [];
            if (containers.length > 0) {
                containers.forEach(function(c) {
                    var kids = c.querySelectorAll(CONFIG.selectors.skillElements);
                    kids.forEach(function(k) { candidates.push(k); });
                });
            } else {
                candidates = Array.from(document.querySelectorAll(CONFIG.selectors.skillElements));
            }
            candidates.forEach(function(el) {
                var skill = parseSkillElement(el);
                if (skill) skills.push(skill);
            });
        } catch (e) {
            log('Error finding skills:', e);
        }
        return skills;
    }

    function formatSkillInfo(skill) {
        var info = '<strong>' + escapeHtml(skill.name) + '</strong>';
        if (skill.level) info += '<br>Level: ' + escapeHtml(skill.level);
        if (skill.xp) info += '<br>XP: ' + escapeHtml(skill.xp);
        return info;
    }

    function escapeHtml(text) {
        if (!text) return '';
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function buildPopup() {
        if (popup) return popup;

        var overlay = document.createElement('div');
        overlay.id = 'pokedive-skilldetails-overlay';
        overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 99998; display: none;';

        var box = document.createElement('div');
        box.id = 'pokedive-skilldetails-popup';
        box.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 90%; max-width: 360px; max-height: 80vh; background: #1a1a1a; color: #fff; border: 1px solid #444; border-radius: 8px; padding: 16px; z-index: 99999; font-family: sans-serif; font-size: 14px; overflow-y: auto; box-shadow: 0 4px 12px rgba(0,0,0,0.5);';

        var header = document.createElement('div');
        header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;';
        var title = document.createElement('h3');
        title.textContent = 'Skill Details';
        title.style.cssText = 'margin: 0; font-size: 18px; color: #00d2ff;';
        var closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        closeBtn.style.cssText = 'background: transparent; border: none; color: #fff; font-size: 20px; cursor: pointer; line-height: 1;';
        closeBtn.onclick = function() { overlay.style.display = 'none'; };
        header.appendChild(title);
        header.appendChild(closeBtn);

        var content = document.createElement('div');
        content.id = 'pokedive-skilldetails-content';
        content.style.cssText = 'max-height: 60vh; overflow-y: auto;';

        box.appendChild(header);
        box.appendChild(content);
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        popup = { overlay: overlay, box: box, content: content };
        return popup;
    }

    function showSkillsPopup() {
        if (!settings.showPopup) return;
        var p = buildPopup();
        var skills = findSkills();
        p.content.innerHTML = '';
        if (skills.length === 0) {
            p.content.innerHTML = '<p style="color:#888; font-size:13px;">No skills found on this page.</p>';
        } else {
            skills.forEach(function(skill) {
                var row = document.createElement('div');
                row.style.cssText = 'padding: 8px 0; border-bottom: 1px solid #333;';
                row.innerHTML = formatSkillInfo(skill);
                p.content.appendChild(row);
            });
        }
        p.overlay.style.display = 'flex';
        log('Displayed', skills.length, 'skill(s)');
    }

    function injectButton() {
        var existing = document.getElementById('pokedive-skilldetails-btn');
        if (existing) return;
        var btn = document.createElement('button');
        btn.id = 'pokedive-skilldetails-btn';
        btn.textContent = 'Skills';
        btn.style.cssText = 'position: fixed; bottom: 16px; left: 80px; z-index: 100000; background: #00d2ff; color: #000; border: none; border-radius: 4px; padding: 6px 10px; font-size: 12px; font-weight: bold; cursor: pointer; box-shadow: 0 2px 6px rgba(0,0,0,0.4);';
        btn.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            showSkillsPopup();
        };
        document.body.appendChild(btn);
    }

    function init() {
        if (window[INIT_KEY]) return;
        window[INIT_KEY] = true;

        loadSettings();

        if (!window.location.hostname.includes('pokedive.com')) return;

        if (settings.enabled) {
            injectButton();
            if (settings.autoOpen) {
                setTimeout(showSkillsPopup, 500);
            }
        }

        startUrlWatcher();
        log('Skill Details initialized');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
