// ==UserScript==
// @name         PokeDive - Skill Details
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Displays detailed skill information on pokedive.com
// @author       Cline
// @match        *://pokedive.com/*
// @match        *://www.pokedive.com/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

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

    let settings = { ...CONFIG.defaults };
    let initialized = false;
    let popup = null;

    const log = (...args) => {
        if (settings.debug) {
            console.log('[PokeDive Skill Details]', ...args);
        }
    };

    function loadSettings() {
        try {
            const raw = localStorage.getItem(CONFIG.storageKey);
            if (raw) {
                settings = { ...CONFIG.defaults, ...JSON.parse(raw) };
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

    function parseSkillElement(el) {
        if (!el) return null;
        const nameEl = el.querySelector(CONFIG.selectors.skillName) || el;
        const levelEl = el.querySelector(CONFIG.selectors.skillLevel);
        const xpEl = el.querySelector(CONFIG.selectors.skillXP);
        const name = (nameEl.textContent || nameEl.getAttribute('data-skill-name') || '').trim();
        const level = (levelEl ? levelEl.textContent : '') || el.getAttribute('data-skill-level') || '';
        const xp = (xpEl ? xpEl.textContent : '') || el.getAttribute('data-skill-xp') || '';
        if (!name) return null;
        return { name, level, xp, element: el };
    }

    function findSkills() {
        const skills = [];
        try {
            const containers = document.querySelectorAll(CONFIG.selectors.skillContainer);
            let candidates = [];
            if (containers.length > 0) {
                containers.forEach(c => {
                    const kids = c.querySelectorAll(CONFIG.selectors.skillElements);
                    kids.forEach(k => candidates.push(k));
                });
            } else {
                candidates = Array.from(document.querySelectorAll(CONFIG.selectors.skillElements));
            }
            candidates.forEach(el => {
                const skill = parseSkillElement(el);
                if (skill) skills.push(skill);
            });
        } catch (e) {
            log('Error finding skills:', e);
        }
        return skills;
    }

    function formatSkillInfo(skill) {
        let info = '<strong>' + escapeHtml(skill.name) + '</strong>';
        if (skill.level) info += '<br>Level: ' + escapeHtml(skill.level);
        if (skill.xp) info += '<br>XP: ' + escapeHtml(skill.xp);
        return info;
    }

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    function buildPopup() {
        if (popup) return popup;
        const overlay = document.createElement('div');
        overlay.id = 'pokedive-skilldetails-overlay';
        overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 99998; display: none;';
        const box = document.createElement('div');
        box.id = 'pokedive-skilldetails-popup';
        box.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 90%; max-width: 360px; max-height: 80vh; background: #1a1a1a; color: #fff; border: 1px solid #444; border-radius: 8px; padding: 16px; z-index: 99999; font-family: sans-serif; font-size: 14px; overflow-y: auto; box-shadow: 0 4px 12px rgba(0,0,0,0.5);';
        const header = document.createElement('div');
        header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;';
        const title = document.createElement('h3');
        title.textContent = 'Skill Details';
        title.style.cssText = 'margin: 0; font-size: 18px; color: #00d2ff;';
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        closeBtn.style.cssText = 'background: transparent; border: none; color: #fff; font-size: 20px; cursor: pointer; line-height: 1;';
        closeBtn.onclick = () => { overlay.style.display = 'none'; };
        header.appendChild(title);
        header.appendChild(closeBtn);
        const content = document.createElement('div');
        content.id = 'pokedive-skilldetails-content';
        content.style.cssText = 'max-height: 60vh; overflow-y: auto;';
        box.appendChild(header);
        box.appendChild(content);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        popup = { overlay, box, content };
        return popup;
    }

    function showSkillsPopup() {
        if (!settings.showPopup) return;
        const p = buildPopup();
        const skills = findSkills();
        p.content.innerHTML = '';
        if (skills.length === 0) {
            p.content.innerHTML = '<p style="color:#888; font-size:13px;">No skills found on this page.</p>';
        } else {
            skills.forEach(skill => {
                const row = document.createElement('div');
                row.style.cssText = 'padding: 8px 0; border-bottom: 1px solid #333;';
                row.innerHTML = formatSkillInfo(skill);
                p.content.appendChild(row);
            });
        }
        p.overlay.style.display = 'flex';
        log('Displayed', skills.length, 'skill(s)');
    }
    function injectButton() {
        const existing = document.getElementById('pokedive-skilldetails-btn');
        if (existing) return;
        const btn = document.createElement('button');
        btn.id = 'pokedive-skilldetails-btn';
        btn.textContent = 'Skills';
        btn.style.cssText = 'position: fixed; bottom: 16px; left: 80px; z-index: 100000; background: #00d2ff; color: #000; border: none; border-radius: 4px; padding: 6px 10px; font-size: 12px; font-weight: bold; cursor: pointer; box-shadow: 0 2px 6px rgba(0,0,0,0.4);';
        btn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            showSkillsPopup();
        };
        document.body.appendChild(btn);
    }

    function init() {
        if (initialized) return;
        initialized = true;
        loadSettings();
        if (!window.location.hostname.includes('pokedive.com')) return;
        if (settings.enabled) {
            injectButton();
            if (settings.autoOpen) {
                setTimeout(showSkillsPopup, 500);
            }
        }
        log('Skill Details initialized');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
