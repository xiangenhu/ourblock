/**
 * Hash-based i18n Context
 * Supports real-time translation updates for any language
 * Loads translations from separate JSON files per language
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getHash } from './hashUtils';
import { setCurrentTranslations } from './i18nUtils';
import { syncHelpI18nLanguage } from './helpBridge';

// Supported languages configuration
const SUPPORTED_LANGUAGES = {
  en: { name: 'English', dir: 'ltr' },
  zh: { name: '中文', dir: 'ltr' },
  // Add more languages here - they will be loaded dynamically
  es: { name: 'Español', dir: 'ltr' },
  fr: { name: 'Français', dir: 'ltr' },
  de: { name: 'Deutsch', dir: 'ltr' },
  ja: { name: '日本語', dir: 'ltr' },
  ko: { name: '한국어', dir: 'ltr' },
  ar: { name: 'العربية', dir: 'rtl' },
  he: { name: 'עברית', dir: 'rtl' }
};

// Default translations (English as fallback)
const defaultTranslations = {
  en: {}
};

// Cache for loaded translations
const translationCache = new Map();
// Track in-progress loads to prevent duplicate fetches
const loadingPromises = new Map();

// localStorage keys for offline/restricted access support
const LS_TRANSLATIONS_PREFIX = 'i18n_translations_';
const LS_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Save translations to localStorage for offline/restricted access
 */
function saveToLocalStorage(lang, data) {
  try {
    const storageData = {
      data,
      timestamp: Date.now(),
      version: data._meta?.version || '1.0'
    };
    localStorage.setItem(`${LS_TRANSLATIONS_PREFIX}${lang}`, JSON.stringify(storageData));
    console.log(`[i18n] Saved ${lang} translations to localStorage`);
  } catch (e) {
    console.warn('[i18n] Failed to save translations to localStorage:', e);
  }
}

/**
 * Load translations from localStorage (fallback for restricted regions)
 */
function loadFromLocalStorage(lang) {
  try {
    const stored = localStorage.getItem(`${LS_TRANSLATIONS_PREFIX}${lang}`);
    if (stored) {
      const { data, timestamp } = JSON.parse(stored);
      const age = Date.now() - timestamp;
      if (age < LS_CACHE_MAX_AGE) {
        console.log(`[i18n] Loaded ${lang} from localStorage (age: ${Math.round(age / 1000 / 60)}min)`);
        return data;
      } else {
        console.log(`[i18n] localStorage cache for ${lang} expired`);
      }
    }
  } catch (e) {
    console.warn('[i18n] Failed to load translations from localStorage:', e);
  }
  return null;
}

// Language detection priority: URL > Cookie > localStorage > Browser > Default
function detectLanguage() {
  // 1. URL parameter
  const urlParams = new URLSearchParams(window.location.search);
  const urlLang = urlParams.get('lang');
  console.log('[i18n] detectLanguage - URL param:', urlLang, 'location.search:', window.location.search);
  if (urlLang && SUPPORTED_LANGUAGES[urlLang]) {
    console.log('[i18n] Using URL language:', urlLang);
    return urlLang;
  }

  // 2. Cookie
  const cookieMatch = document.cookie.match(/preferredLanguage=([^;]+)/);
  if (cookieMatch && SUPPORTED_LANGUAGES[cookieMatch[1]]) {
    console.log('[i18n] Using cookie language:', cookieMatch[1]);
    return cookieMatch[1];
  }

  // 3. localStorage
  const storedLang = localStorage.getItem('preferredLanguage');
  if (storedLang && SUPPORTED_LANGUAGES[storedLang]) {
    console.log('[i18n] Using localStorage language:', storedLang);
    return storedLang;
  }

  // 4. Browser language
  const browserLang = navigator.language?.split('-')[0];
  if (browserLang && SUPPORTED_LANGUAGES[browserLang]) {
    console.log('[i18n] Using browser language:', browserLang);
    return browserLang;
  }

  // 5. Default
  console.log('[i18n] Using default language: en');
  return 'en';
}

// i18n Context
const I18nContext = createContext(null);

/**
 * I18n Provider Component
 * Manages translations and language state
 * Loads translations from server (which fetches from GCS with local fallback)
 */
export function I18nProvider({ children, localesPath = '/server/i18n/locales' }) {
  const [language, setLanguageState] = useState(detectLanguage);
  const [translations, setTranslations] = useState(defaultTranslations);
  const [loading, setLoading] = useState(true);
  const [registeredHashes, setRegisteredHashes] = useState(new Map());
  const [languageMeta, setLanguageMeta] = useState({});

  // Load translations for a language from JSON file
  const loadTranslations = useCallback(async (lang) => {
    console.log(`[i18n] loadTranslations called for: ${lang}`);

    // Check cache first
    if (translationCache.has(lang)) {
      const cached = translationCache.get(lang);
      console.log(`[i18n] Using cached translations for ${lang}:`, Object.keys(cached.translations || cached).length, 'keys');
      const langTranslations = cached.translations || cached;
      setTranslations(prev => ({
        ...prev,
        [lang]: langTranslations
      }));
      setLanguageMeta(prev => ({
        ...prev,
        [lang]: cached._meta
      }));
      setCurrentTranslations(lang, langTranslations);
      return cached;
    }

    // Check if already loading this language
    // Wait for it, then apply cached result to THIS component's state
    if (loadingPromises.has(lang)) {
      console.log(`[i18n] Already loading ${lang}, waiting...`);
      const existingPromise = loadingPromises.get(lang);
      // Wait for the existing load to complete, then apply from cache
      existingPromise.then(() => {
        if (translationCache.has(lang)) {
          const cached = translationCache.get(lang);
          const langTranslations = cached.translations || cached;
          console.log(`[i18n] Applying cached ${lang} translations after wait`);
          setTranslations(prev => ({
            ...prev,
            [lang]: langTranslations
          }));
          setCurrentTranslations(lang, langTranslations);
        }
      });
      return existingPromise;
    }

    setLoading(true);

    const loadPromise = (async () => {
      try {
        console.log(`[i18n] Fetching ${localesPath}/${lang}.json`);

        // Add timeout for slow/blocked connections (5 seconds)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(`${localesPath}/${lang}.json`, {
          signal: controller.signal,
          // Revalidate with the server every load (cheap 304 via ETag when
          // unchanged) so an approved translation edit shows up immediately
          // instead of being masked by a stale cached locale file.
          cache: 'no-cache'
        });
        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json();
          const langTranslations = data.translations || data;

          console.log(`[i18n] Loaded ${lang} translations:`, Object.keys(langTranslations).length, 'keys');

          // Cache the translations in memory
          translationCache.set(lang, data);

          // Save to localStorage for offline/restricted access
          saveToLocalStorage(lang, data);

          setTranslations(prev => {
            console.log(`[i18n] Setting translations for ${lang}, prev keys:`, Object.keys(prev));
            return {
              ...prev,
              [lang]: langTranslations
            };
          });

          if (data._meta) {
            setLanguageMeta(prev => ({
              ...prev,
              [lang]: data._meta
            }));
          }

          // Update the utils module
          setCurrentTranslations(lang, langTranslations);

          return data;
        } else {
          console.warn(`Translation file not found for ${lang}, trying localStorage fallback`);
          throw new Error('Translation not found on server');
        }
      } catch (error) {
        console.warn(`Failed to load translations for ${lang} from server:`, error.message);

        // Try localStorage fallback (for restricted regions / offline)
        const localData = loadFromLocalStorage(lang);
        if (localData) {
          const langTranslations = localData.translations || localData;
          console.log(`[i18n] Using localStorage fallback for ${lang}`);

          translationCache.set(lang, localData);
          setTranslations(prev => ({
            ...prev,
            [lang]: langTranslations
          }));
          setCurrentTranslations(lang, langTranslations);

          if (localData._meta) {
            setLanguageMeta(prev => ({
              ...prev,
              [lang]: localData._meta
            }));
          }
          return localData;
        }

        // Fall back to English if no localStorage cache
        if (lang !== 'en') {
          console.log(`[i18n] No localStorage cache for ${lang}, falling back to English`);
          return loadTranslations('en');
        }
      } finally {
        setLoading(false);
        loadingPromises.delete(lang);
      }
    })();

    loadingPromises.set(lang, loadPromise);
    return loadPromise;
  }, [localesPath]);

  // Persist language preference
  const setLanguage = useCallback((lang) => {
    setLanguageState(lang);
    localStorage.setItem('preferredLanguage', lang);
    document.cookie = `preferredLanguage=${lang};path=/;max-age=31536000`;
    document.documentElement.lang = lang;

    // Set RTL based on language config
    const langConfig = SUPPORTED_LANGUAGES[lang];
    document.documentElement.dir = langConfig?.dir || 'ltr';
  }, []);

  // Load translations when language changes
  useEffect(() => {
    console.log('[i18n] Language effect triggered, loading:', language);
    loadTranslations(language);
  }, [language, loadTranslations]);

  // Keep the contextual-help.js chrome (injected outside React) in sync: once the
  // active language's translations are live in the registry, tell the help bridge
  // to re-translate its chip/card. Runs on mount and on every language switch.
  useEffect(() => {
    if (translations[language]) {
      syncHelpI18nLanguage(language);
    }
  }, [language, translations]);

  // Debug: log when translations state changes
  useEffect(() => {
    console.log('[i18n] Translations state updated:', {
      languages: Object.keys(translations),
      zhCount: translations.zh ? Object.keys(translations.zh).length : 0,
      enCount: translations.en ? Object.keys(translations.en).length : 0
    });
  }, [translations]);

  // Initial load - persist detected language and preload English fallback
  useEffect(() => {
    console.log('[i18n] Initial mount, language:', language);

    // Persist the detected language (from URL, browser, etc.) to storage
    localStorage.setItem('preferredLanguage', language);
    document.cookie = `preferredLanguage=${language};path=/;max-age=31536000`;
    document.documentElement.lang = language;
    document.documentElement.dir = SUPPORTED_LANGUAGES[language]?.dir || 'ltr';

    // Preload English as fallback (the language effect will load current language)
    if (language !== 'en') {
      loadTranslations('en');
    }
  }, [language, loadTranslations]);

  // Register a new hash with its English text
  const registerHash = useCallback((englishText, hash = null) => {
    const textHash = hash || getHash(englishText);
    setRegisteredHashes(prev => {
      const newMap = new Map(prev);
      newMap.set(textHash, englishText);
      return newMap;
    });

    // Also add to English translations if not present
    setTranslations(prev => {
      if (!prev.en?.[textHash]) {
        return {
          ...prev,
          en: { ...prev.en, [textHash]: englishText }
        };
      }
      return prev;
    });

    return textHash;
  }, []);

  // Add translations for a specific language
  // Also updates module-level cache, i18nUtils, and localStorage
  const addTranslations = useCallback((lang, newTranslations) => {
    setTranslations(prev => {
      const merged = { ...prev[lang], ...newTranslations };
      // Update module-level cache so translations survive re-mounts/navigation
      const cached = translationCache.get(lang);
      if (cached) {
        const existing = cached.translations || cached;
        Object.assign(existing, newTranslations);
      } else {
        translationCache.set(lang, { translations: merged });
      }
      // Update i18nUtils so addTextSync also has access
      setCurrentTranslations(lang, merged);
      // Debounced save to localStorage
      clearTimeout(addTranslations._saveTimer);
      addTranslations._saveTimer = setTimeout(() => {
        saveToLocalStorage(lang, translationCache.get(lang) || { translations: merged });
      }, 2000);
      return { ...prev, [lang]: merged };
    });
  }, []);

  // Get translation by hash
  const getTranslation = useCallback((hash, fallback = '') => {
    const langTranslations = translations[language];
    if (langTranslations?.[hash]) {
      return langTranslations[hash];
    }
    // Fallback to English
    if (translations.en?.[hash]) {
      return translations.en[hash];
    }
    // Final fallback
    return registeredHashes.get(hash) || fallback;
  }, [language, translations, registeredHashes]);

  // Translate English text directly (auto-registers hash)
  // Note: Not using useCallback - needs fresh closure each render to get latest translations
  const t = (englishText) => {
    // For English, return text directly without hash lookup
    if (language === 'en') {
      return englishText;
    }
    const hash = getHash(englishText);

    // Direct lookup in translations
    const langTranslations = translations[language];

    if (langTranslations?.[hash]) {
      return langTranslations[hash];
    }
    // Fallback to English
    if (translations.en?.[hash]) {
      return translations.en[hash];
    }
    // Final fallback to original English text
    return englishText;
  };

  // Get all registered hashes (for export/sync)
  const getRegisteredHashes = useCallback(() => {
    return Object.fromEntries(registeredHashes);
  }, [registeredHashes]);

  // Bulk update translations (for real-time updates)
  const updateTranslations = useCallback((updates) => {
    setTranslations(prev => {
      const newTranslations = { ...prev };
      Object.entries(updates).forEach(([lang, langUpdates]) => {
        newTranslations[lang] = { ...newTranslations[lang], ...langUpdates };
      });
      return newTranslations;
    });
  }, []);

  // Reload translations (for real-time updates)
  const reloadTranslations = useCallback(async (lang = language) => {
    translationCache.delete(lang);
    return loadTranslations(lang);
  }, [language, loadTranslations]);

  const value = {
    language,
    setLanguage,
    t,
    getTranslation,
    registerHash,
    addTranslations,
    updateTranslations,
    getRegisteredHashes,
    reloadTranslations,
    translations,
    languageMeta,
    loading,
    isRTL: SUPPORTED_LANGUAGES[language]?.dir === 'rtl',
    supportedLanguages: SUPPORTED_LANGUAGES
  };

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  );
}

// Export supported languages for external use
export { SUPPORTED_LANGUAGES };

/**
 * Hook to access i18n context
 */
export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
}

/**
 * Hook for simple translation access
 */
export function useTranslation() {
  const { t, language } = useI18n();
  return { t, language };
}

export default I18nContext;
