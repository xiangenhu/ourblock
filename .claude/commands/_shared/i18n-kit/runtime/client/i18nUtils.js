/**
 * i18n Utilities
 * Dynamic text handling and translation file generation
 */

import { getHash } from './hashUtils';

/**
 * Registry of all text strings used in the application
 * Maps hash -> { englishText, usageLocations }
 */
const textRegistry = new Map();

/**
 * Current translations loaded
 */
let currentTranslations = {};
let currentLanguage = 'en';

/**
 * Set current language and translations
 */
export function setCurrentTranslations(language, translations) {
  currentLanguage = language;
  currentTranslations = translations;
}

/**
 * Add text dynamically and return wrapped HTML string
 * Use this for dynamic content injected via innerHTML
 *
 * @param {string} englishText - The English text to translate
 * @param {string} tag - HTML tag to wrap with (default: 'span')
 * @returns {Promise<string>} - HTML string with data-i18n attribute
 *
 * Usage:
 *   element.innerHTML = await addText("Welcome to UALS");
 *   // Returns: <span data-i18n="abc123...">欢迎使用UALS</span>
 */
export async function addText(englishText, tag = 'span') {
  const hash = getHash(englishText.trim());

  // Register the text
  registerText(englishText, hash);

  // Get translation
  const translatedText = getTranslation(hash, englishText);

  return `<${tag} data-i18n="${hash}">${translatedText}</${tag}>`;
}

/**
 * Synchronous version of addText
 */
export function addTextSync(englishText, tag = 'span') {
  const hash = getHash(englishText.trim());
  registerText(englishText, hash);
  const translatedText = getTranslation(hash, englishText);
  return `<${tag} data-i18n="${hash}">${translatedText}</${tag}>`;
}

/**
 * Register text in the registry
 */
export function registerText(englishText, hash = null, location = null) {
  const textHash = hash || getHash(englishText.trim());

  if (!textRegistry.has(textHash)) {
    textRegistry.set(textHash, {
      englishText: englishText.trim(),
      hash: textHash,
      usageLocations: [],
      firstSeen: new Date().toISOString()
    });
  }

  if (location) {
    const entry = textRegistry.get(textHash);
    if (!entry.usageLocations.includes(location)) {
      entry.usageLocations.push(location);
    }
  }

  return textHash;
}

/**
 * Get translation for a hash
 */
export function getTranslation(hash, fallback = '') {
  if (currentTranslations[hash]) {
    return currentTranslations[hash];
  }
  return fallback;
}

/**
 * Generate a translation template file for a new language
 * Returns JSON that can be saved as a new language file
 *
 * @param {string} languageCode - Target language code (e.g., 'es', 'fr')
 * @param {string} languageName - Language name (e.g., 'Español', 'Français')
 * @returns {object} - Translation template object
 */
export function generateTranslationTemplate(languageCode, languageName) {
  const template = {
    _meta: {
      language: languageCode,
      name: languageName,
      direction: 'ltr',
      version: '1.0.0',
      lastUpdated: new Date().toISOString().split('T')[0],
      status: 'pending_translation'
    },
    translations: {}
  };

  // Add all registered texts with English as placeholder
  textRegistry.forEach((entry, hash) => {
    template.translations[hash] = `[TRANSLATE] ${entry.englishText}`;
  });

  return template;
}

/**
 * Export all registered texts for translation
 * Useful for creating translation files
 *
 * @returns {object} - Object with hash -> englishText mapping
 */
export function exportTextRegistry() {
  const export_data = {
    _meta: {
      exportedAt: new Date().toISOString(),
      totalStrings: textRegistry.size
    },
    strings: {}
  };

  textRegistry.forEach((entry, hash) => {
    export_data.strings[hash] = {
      english: entry.englishText,
      locations: entry.usageLocations,
      firstSeen: entry.firstSeen
    };
  });

  return export_data;
}

/**
 * Get missing translations for a language
 *
 * @param {object} translations - Current translations for the language
 * @returns {array} - Array of { hash, englishText } for missing translations
 */
export function getMissingTranslations(translations) {
  const missing = [];

  textRegistry.forEach((entry, hash) => {
    if (!translations[hash]) {
      missing.push({
        hash,
        englishText: entry.englishText
      });
    }
  });

  return missing;
}

/**
 * Validate a translation file
 *
 * @param {object} translationFile - Translation file content
 * @returns {object} - { valid: boolean, errors: [], warnings: [] }
 */
export function validateTranslationFile(translationFile) {
  const result = {
    valid: true,
    errors: [],
    warnings: []
  };

  if (!translationFile._meta) {
    result.errors.push('Missing _meta section');
    result.valid = false;
  }

  if (!translationFile.translations) {
    result.errors.push('Missing translations section');
    result.valid = false;
  }

  // Check for untranslated strings
  Object.entries(translationFile.translations || {}).forEach(([hash, text]) => {
    if (text.startsWith('[TRANSLATE]')) {
      result.warnings.push(`Untranslated string: ${hash}`);
    }
  });

  // Check for missing strings that exist in registry
  const missing = getMissingTranslations(translationFile.translations || {});
  if (missing.length > 0) {
    result.warnings.push(`${missing.length} strings in app not in translation file`);
  }

  return result;
}

/**
 * Download translation template as JSON file
 */
export function downloadTranslationTemplate(languageCode, languageName) {
  const template = generateTranslationTemplate(languageCode, languageName);
  const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${languageCode}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default {
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
};
