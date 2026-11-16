// UI language. Source strings are English; i18n/<code>.json maps English text -> translation (missing = English).
// Game names come from the data: name (English) and name_<code> per game language (regenerated with available.py).
export const LANGS = { en: 'English', es: 'Español', pt: 'Português', fr: 'Français', de: 'Deutsch', ru: 'Русский', ja: '日本語', ko: '한국어', th: 'ไทย', zh: '繁體中文' };
const LOCALE = { en: 'en-US', es: 'es-ES', pt: 'pt-BR', fr: 'fr-FR', de: 'de-DE', ru: 'ru-RU', ja: 'ja-JP', ko: 'ko-KR', th: 'th-TH', zh: 'zh-TW' };
const KEY = 'poe2lang';
let saved = null;
try { saved = localStorage.getItem(KEY); } catch {}
export const lang = LANGS[saved] ? saved : 'en';
export const locale = LOCALE[lang];
const dict = lang === 'en' ? {} : await fetch(`i18n/${lang}.json`).then(r => r.ok ? r.json() : {}).catch(() => ({}));

// t('Delete the build «{0}»?', name): translated text with {0}, {1}… filled in
export const t = (s, ...a) => (dict[s] || s).replace(/\{(\d)\}/g, (m, i) => a[i] ?? m);
// game name of a data object (node, gem, base item…) in the current language, English if the data lacks it
export const tn = o => o?.['name_' + lang] || o?.name;
export const fmt = (x, d = 0) => x == null ? '—' : x.toLocaleString(locale, { minimumFractionDigits: d, maximumFractionDigits: d });
export function setLang(l) { try { localStorage.setItem(KEY, l); } catch {} location.reload(); }

// static page text: elements marked data-t get their text, title and placeholder translated
document.documentElement.lang = lang;
for (const el of document.querySelectorAll('[data-t]')) {
  if (el.children.length === 0 && el.textContent.trim()) el.textContent = t(el.textContent.trim());
  for (const a of ['title', 'placeholder']) if (el.hasAttribute(a)) el.setAttribute(a, t(el.getAttribute(a)));
}
export const cap = s => s[0].toUpperCase() + s.slice(1);
