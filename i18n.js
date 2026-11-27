// UI language. Source strings are English; i18n/<code>.json maps English text -> translation (missing = English).
// Game names come from the data: name (English) and name_<code> per game language (regenerated with available.py).
export const LANGS = { en: 'English', es: 'Español', pt: 'Português', fr: 'Français', de: 'Deutsch', ru: 'Русский', ja: '日本語', ko: '한국어', th: 'ไทย', zh: '繁體中文' };
const LOCALE = { en: 'en-US', es: 'es-ES', pt: 'pt-BR', fr: 'fr-FR', de: 'de-DE', ru: 'ru-RU', ja: 'ja-JP', ko: 'ko-KR', th: 'th-TH', zh: 'zh-TW' };
const KEY = 'poe2lang';
let saved = null;
try { saved = localStorage.getItem(KEY); } catch {}
const system = (navigator.language || '').slice(0, 2);   // until one is picked: the language of Windows, if the game has it
export const lang = LANGS[saved] ? saved : LANGS[system] ? system : 'en';
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
  for (const a of ['title', 'placeholder', 'aria-label']) if (el.hasAttribute(a)) el.setAttribute(a, t(el.getAttribute(a)));
}
export const cap = s => s[0].toUpperCase() + s.slice(1);

// the game's keyword markup in a description: "[Ignite|ignited]" ("[Fire]": the word is its own key)
const KWRE = /\[([^\]|]+)(?:\|([^\]]*))?\]/g;
export const KW = await fetch('poe2_data/available/keywords.json').then(r => r.ok ? r.json() : {}).catch(() => ({}));
// a text as HTML, also inside a quoted attribute
// text to search by: no accents or other marks, lower case ("cañón" finds "Canon" and back)
export const fold = s => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const kwPlain = s => (s || '').replace(KWRE, (m, k, x) => x ?? k);
// as HTML: a keyword the game explains on hover (KeywordPopups) shows that explanation as its tooltip (escaping
// leaves the markup's [ | ] alone)
export const kwHtml = s => esc(s || '').replace(KWRE, (m, k, x, _, __, w = KW[k]) =>
  w ? `<span class="kw" title="${esc((w['term_' + lang] || w.term) + '\n' + (w['def_' + lang] || w.def))}">${x ?? k}</span>` : x ?? k);
