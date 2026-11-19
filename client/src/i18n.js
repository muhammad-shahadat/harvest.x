// FR-39: Bangla (default) + English. All texts live in src/locales/bn.json and en.json.
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import bn from './locales/bn.json';
import en from './locales/en.json';

const saved = localStorage.getItem('hx_lang');

i18n.use(initReactI18next).init({
  resources: { bn: { translation: bn }, en: { translation: en } },
  lng: saved === 'en' ? 'en' : 'bn',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export function setLanguage(lang) {
  localStorage.setItem('hx_lang', lang);
  i18n.changeLanguage(lang);
  document.documentElement.lang = lang;
}

// Dates are always shown in Bangladesh time (FR-39).
export function formatDate(value) {
  if (!value) return '';
  const locale = i18n.language === 'bn' ? 'bn-BD' : 'en-GB';
  return new Date(value).toLocaleString(locale, { timeZone: 'Asia/Dhaka', dateStyle: 'medium', timeStyle: 'short' });
}

// Turn an API error into a message in the current language.
export function errorMessage(err) {
  if (!err) return '';
  if (err.code === 'VALIDATION_ERROR' && err.details?.length) {
    return err.details.map((d) => `${d.field}: ${i18n.t(`errors.${d.message}`, { defaultValue: d.message })}`).join(' · ');
  }
  return i18n.t(`errors.${err.code}`, { defaultValue: err.message || err.code });
}

export default i18n;
