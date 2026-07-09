/**
 * I18nText Component
 * Wraps text with data-i18n attribute for hash-based translation
 *
 * Usage:
 *   <I18nText>Hello World</I18nText>
 *   Output: <span data-i18n="abc123...">Translated Text</span>
 *
 *   With emoji (emoji stays outside):
 *   <I18nText emoji="🎓">Dashboard</I18nText>
 *   Output: 🎓 <span data-i18n="abc123...">仪表板</span>
 */

import React, { useMemo, useEffect, useRef, useCallback } from 'react';
import { useI18n } from './I18nContext';
import { getHash } from './hashUtils';

// Module-level set to track in-flight translation requests across all instances
const inflightHashes = new Set();

// Request queue to throttle concurrent translation requests
const translateQueue = [];
let activeRequests = 0;
const MAX_CONCURRENT = 6;

/**
 * Check if text appears to already be in the target language.
 * For CJK languages, check for CJK characters.
 * For other scripts, check for non-ASCII characters typical of the target.
 */
const LANG_SCRIPT_PATTERNS = {
  zh: /[\u4e00-\u9fff\u3400-\u4dbf]/,        // CJK Unified Ideographs
  ja: /[\u3040-\u30ff\u4e00-\u9fff]/,         // Hiragana, Katakana, CJK
  ko: /[\uac00-\ud7af\u1100-\u11ff]/,         // Hangul
  ar: /[\u0600-\u06ff]/,                       // Arabic
  he: /[\u0590-\u05ff]/,                       // Hebrew
  hi: /[\u0900-\u097f]/,                       // Devanagari
  th: /[\u0e00-\u0e7f]/,                       // Thai
  ru: /[\u0400-\u04ff]/,                       // Cyrillic
  uk: /[\u0400-\u04ff]/,                       // Cyrillic
  vi: /[\u00c0-\u1ef9]/,                       // Vietnamese diacritics
};

function isAlreadyInTargetLang(text, targetLang) {
  const pattern = LANG_SCRIPT_PATTERNS[targetLang];
  if (pattern) return pattern.test(text);
  // For Latin-script languages (es, fr, de, etc.), check for accented chars
  // but this is unreliable — let the server handle it
  return false;
}

function enqueueTranslation(text, hash, targetLang, addTranslations, language) {
  if (inflightHashes.has(hash)) return;

  // Skip empty, whitespace-only, or very short text that doesn't need translation
  if (!text || !text.trim() || !hash || !/^[a-f0-9]{16}$/.test(hash)) return;

  // Skip if text is already in the target language
  if (isAlreadyInTargetLang(text, targetLang)) {
    addTranslations(language, { [hash]: text });
    return;
  }

  inflightHashes.add(hash);
  translateQueue.push({ text, hash, targetLang, addTranslations, language });
  processQueue();
}

function processQueue() {
  while (activeRequests < MAX_CONCURRENT && translateQueue.length > 0) {
    const { text, hash, targetLang, addTranslations, language } = translateQueue.shift();
    activeRequests++;
    fetch('/server/i18n/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, hash, targetLang })
    })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`translate ${r.status}`)))
      .then(data => {
        addTranslations(language, { [data.hash]: data.translation });
      })
      .catch(err => console.warn('[i18n] On-demand translate error:', err.message))
      .finally(() => {
        inflightHashes.delete(hash);
        activeRequests--;
        processQueue();
      });
  }
}

/**
 * I18nText - Translatable text component
 * @param {string} children - English text to translate
 * @param {string} emoji - Optional emoji to display before text (stays outside span)
 * @param {string} as - HTML element to render (default: span)
 * @param {string} className - CSS classes (no inline styles for i18n compliance)
 * @param {object} props - Additional props passed to the element
 */
export function I18nText({
  children,
  emoji,
  as: Component = 'span',
  className = '',
  ...props
}) {
  const { t, registerHash, language, translations, addTranslations } = useI18n();

  // Get the English text and compute hash
  const englishText = typeof children === 'string' ? children : '';
  const hash = useMemo(() => getHash(englishText), [englishText]);

  // Register hash in effect (not during render) to avoid React warning
  useEffect(() => {
    if (englishText && hash) {
      registerHash(englishText, hash);
    }
  }, [englishText, hash, registerHash]);

  // Get translated text
  const translatedText = t(englishText);

  // Check if this text needs on-demand translation
  const needsTranslation = language !== 'en' && englishText && translations[language]?.[hash] === undefined;

  const handleMouseOver = useCallback(() => {
    if (!needsTranslation) return;
    enqueueTranslation(englishText, hash, language, addTranslations, language);
  }, [needsTranslation, hash, englishText, language, addTranslations]);

  const mouseOverProp = needsTranslation ? { onMouseOver: handleMouseOver } : undefined;

  if (emoji) {
    return (
      <>
        {emoji}{' '}
        <Component data-i18n={hash} className={className} {...mouseOverProp} {...props}>
          {translatedText}
        </Component>
      </>
    );
  }

  return (
    <Component data-i18n={hash} className={className} {...mouseOverProp} {...props}>
      {translatedText}
    </Component>
  );
}

/**
 * I18nBlock - Block-level translatable text
 */
export function I18nBlock({ children, emoji, className = '', ...props }) {
  return (
    <I18nText as="div" emoji={emoji} className={className} {...props}>
      {children}
    </I18nText>
  );
}

/**
 * I18nParagraph - Paragraph translatable text
 */
export function I18nParagraph({ children, emoji, className = '', ...props }) {
  return (
    <I18nText as="p" emoji={emoji} className={className} {...props}>
      {children}
    </I18nText>
  );
}

/**
 * I18nHeading - Heading translatable text
 */
export function I18nHeading({ level = 1, children, emoji, className = '', ...props }) {
  const Component = `h${level}`;
  return (
    <I18nText as={Component} emoji={emoji} className={className} {...props}>
      {children}
    </I18nText>
  );
}

/**
 * I18nLabel - Label translatable text
 */
export function I18nLabel({ children, emoji, htmlFor, className = '', ...props }) {
  return (
    <I18nText as="label" emoji={emoji} className={className} htmlFor={htmlFor} {...props}>
      {children}
    </I18nText>
  );
}

/**
 * I18nButton - Button with translatable text
 * Note: The button itself doesn't have data-i18n, the text inside does
 */
export function I18nButton({
  children,
  emoji,
  className = '',
  onClick,
  disabled,
  type = 'button',
  ...props
}) {
  const { t, registerHash, language, translations, addTranslations } = useI18n();
  const englishText = typeof children === 'string' ? children : '';
  const hash = useMemo(() => getHash(englishText), [englishText]);

  // Register hash in effect (not during render) to avoid React warning
  useEffect(() => {
    if (englishText && hash) {
      registerHash(englishText, hash);
    }
  }, [englishText, hash, registerHash]);

  const translatedText = t(englishText);

  const needsTranslation = language !== 'en' && englishText && translations[language]?.[hash] === undefined;

  const handleMouseOver = useCallback(() => {
    if (!needsTranslation) return;
    enqueueTranslation(englishText, hash, language, addTranslations, language);
  }, [needsTranslation, hash, englishText, language, addTranslations]);

  return (
    <button
      type={type}
      className={className}
      onClick={onClick}
      disabled={disabled}
      onMouseOver={needsTranslation ? handleMouseOver : undefined}
      {...props}
    >
      {emoji && <>{emoji}{' '}</>}
      <span data-i18n={hash}>{translatedText}</span>
    </button>
  );
}

export default I18nText;
