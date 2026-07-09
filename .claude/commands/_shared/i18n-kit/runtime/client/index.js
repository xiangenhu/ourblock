/**
 * Hash-based i18n runtime — public surface.
 *
 * Wrap your app once:
 *   import { I18nProvider } from './i18n';
 *   <I18nProvider><App /></I18nProvider>
 *
 * Render translatable text:
 *   import { I18nText } from './i18n';
 *   <I18nText>Save changes</I18nText>   // → <span data-i18n="{hash}">…</span>
 *
 * Optional: mount the teacher/admin correction tool (see SuggestionMode.jsx):
 *   import SuggestionMode from './i18n/SuggestionMode';
 *   <SuggestionMode canUse={isTeacherOrAdmin} getAuthHeaders={() => ({...})} />
 */

export { I18nProvider, useI18n, useTranslation, SUPPORTED_LANGUAGES } from './I18nContext';
export { I18nText } from './I18nText';
export { default as SuggestionMode } from './SuggestionMode';
export { getHash, generateHash, generateHashSync } from './hashUtils';
export {
  addText,
  addTextSync,
  registerText,
  getTranslation,
  generateTranslationTemplate,
  exportTextRegistry,
  getMissingTranslations,
  validateTranslationFile,
  downloadTranslationTemplate,
  setCurrentTranslations
} from './i18nUtils';
