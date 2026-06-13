/**
 * ai-styles.js — culturally-iconic "writing voices" for AI-assisted post composition.
 *
 * Each language maps to a handful of signature styles (great authors, poets, registers).
 * The client shows the local labels (鲁迅风格 / 古文 / 李白 … for Chinese, Shakespeare /
 * Hemingway … for English, etc.) as selectable chips; on selection, ai.composePost() asks
 * the model — through the single LLM gateway — to write the title + description in that
 * voice. Only id/label/hint are ever sent to the browser; the prompt `directive` stays here.
 *
 *   getStyles(lang)          -> { lang, styles: [{ id, label, hint, directive }] }
 *   getStyleDirective(lang,id) -> directive string | null
 *
 * Languages without a bespoke catalog fall back to UNIVERSAL (language-neutral tones); the
 * gateway still enforces the actual output language, so the generated text is localised.
 */

/** zh-CN / pt_BR / "EN" → primary subtag ("zh" / "pt" / "en"). */
function normLang(lang) {
  return String(lang || '').toLowerCase().split(/[-_]/)[0] || 'en';
}

// directive = an instruction to the model describing the voice. Kept in English on purpose:
// the gateway adds a separate "respond in <language>" directive, so voice and language are
// orthogonal — "write like Lu Xun, in Chinese" / "write like Lu Xun, in English".
const CATALOG = {
  zh: [
    { id: 'luxun',   label: '鲁迅风格', hint: '犀利讽刺', directive: 'Write in the voice of Lu Xun (鲁迅): incisive, ironic, socially critical modern vernacular with biting wit and moral weight.' },
    { id: 'wenyan',  label: '古文',     hint: '文言典雅', directive: 'Write in Classical Chinese (文言文): terse, elegant, literary, using classical grammar and diction.' },
    { id: 'libai',   label: '李白',     hint: '浪漫诗仙', directive: 'Write as a short romantic poem in the spirit of Li Bai (李白): bold, free, soaring imagery, Tang-poem cadence.' },
    { id: 'dufu',    label: '杜甫',     hint: '沉郁顿挫', directive: 'Write as a short poem in the spirit of Du Fu (杜甫): compassionate, socially aware, solemn, refined Tang-poem form.' },
    { id: 'sushi',   label: '苏轼',     hint: '旷达词风', directive: 'Write as a Song-dynasty ci (词) in the spirit of Su Shi (苏轼): expansive, warm, philosophical, lyrical.' },
    { id: 'jinyong', label: '金庸武侠', hint: '侠气纵横', directive: 'Write in the wuxia voice of Jin Yong (金庸): chivalric, vivid, dramatic martial-arts-novel narration.' },
    { id: 'wangluo', label: '网络流行', hint: '俏皮接地气', directive: 'Write in lively contemporary Chinese internet style: casual, playful, warm, with tasteful popular expressions.' },
  ],
  en: [
    { id: 'shakespeare', label: 'Shakespearean', hint: 'Elizabethan verse', directive: 'Write in Shakespearean Early Modern English with poetic, dramatic flair and iambic rhythm.' },
    { id: 'hemingway',   label: 'Hemingway',     hint: 'spare & direct',   directive: 'Write in the spare, plain, declarative style of Ernest Hemingway — short true sentences.' },
    { id: 'austen',      label: 'Jane Austen',   hint: 'witty & genteel',  directive: 'Write in the witty, genteel, gently ironic style of Jane Austen.' },
    { id: 'twain',       label: 'Mark Twain',    hint: 'folksy humour',    directive: 'Write in the folksy, humorous, vernacular American style of Mark Twain.' },
    { id: 'noir',        label: 'Detective noir', hint: 'hard-boiled',     directive: 'Write in moody, terse, hard-boiled detective-noir style.' },
    { id: 'limerick',    label: 'Limerick',      hint: 'playful rhyme',    directive: 'Write as a playful five-line limerick with an AABBA rhyme.' },
  ],
  es: [
    { id: 'cervantes',  label: 'Cervantes',        hint: 'caballeresco',    directive: 'Write in the archaic, chivalric, gently comic style of Cervantes (Don Quixote).' },
    { id: 'marquez',    label: 'García Márquez',   hint: 'realismo mágico', directive: 'Write in the magical-realist style of Gabriel García Márquez: lush, wondrous, flowing.' },
    { id: 'neruda',     label: 'Pablo Neruda',     hint: 'oda lírica',      directive: 'Write as a tender lyrical ode in the spirit of Pablo Neruda, with sensual everyday imagery.' },
    { id: 'lorca',      label: 'Lorca',            hint: 'duende andaluz',  directive: 'Write in the passionate, image-rich Andalusian lyric style of Federico García Lorca.' },
    { id: 'coloquial',  label: 'Coloquial',        hint: 'cercano',         directive: 'Write in warm, close, everyday colloquial Spanish, like a friendly neighbour.' },
  ],
  fr: [
    { id: 'hugo',       label: 'Victor Hugo',  hint: 'souffle romantique', directive: 'Write with the grand, romantic, humane sweep of Victor Hugo.' },
    { id: 'baudelaire', label: 'Baudelaire',   hint: 'poème symboliste',   directive: 'Write as a short symbolist prose-poem in the spirit of Baudelaire: sensory, melancholic, refined.' },
    { id: 'moliere',    label: 'Molière',      hint: 'esprit comique',     directive: 'Write with the comic, satirical theatrical wit of Molière.' },
    { id: 'proust',     label: 'Proust',       hint: 'phrases sensorielles', directive: 'Write in long, sensory, memory-laden sentences in the spirit of Marcel Proust.' },
    { id: 'camus',      label: 'Camus',        hint: 'sobre & lucide',     directive: 'Write in the spare, lucid, understated style of Albert Camus.' },
  ],
  de: [
    { id: 'goethe', label: 'Goethe', hint: 'klassisch',      directive: 'Write in the classical, measured, humane voice of Goethe.' },
    { id: 'rilke',  label: 'Rilke',  hint: 'lyrisch',        directive: 'Write as a short lyric poem in the spirit of Rainer Maria Rilke: introspective, luminous.' },
    { id: 'kafka',  label: 'Kafka',  hint: 'beklemmend',     directive: 'Write in the uncanny, precise, quietly absurd bureaucratic style of Franz Kafka.' },
    { id: 'brecht', label: 'Brecht', hint: 'klar & politisch', directive: 'Write in the plain, pointed, didactic style of Bertolt Brecht.' },
    { id: 'grimm',  label: 'Märchen', hint: 'Grimm',         directive: 'Write as a Brothers Grimm fairy tale: simple, archetypal, once-upon-a-time cadence.' },
  ],
  it: [
    { id: 'dante',    label: 'Dante',    hint: 'terzine solenni', directive: 'Write in the solemn, visionary terza-rima spirit of Dante.' },
    { id: 'petrarca', label: 'Petrarca', hint: 'sonetto',         directive: 'Write as a lyrical love-sonnet in the spirit of Petrarch.' },
    { id: 'calvino',  label: 'Calvino',  hint: 'fiaba lieve',     directive: 'Write in the light, whimsical, inventive style of Italo Calvino.' },
    { id: 'colloquiale', label: 'Colloquiale', hint: 'vicino',    directive: 'Write in warm, everyday colloquial Italian, like a friendly neighbour.' },
  ],
  pt: [
    { id: 'camoes',  label: 'Camões',           hint: 'épico',        directive: 'Write in the elevated, epic, lyrical spirit of Luís de Camões.' },
    { id: 'pessoa',  label: 'Fernando Pessoa',  hint: 'introspectivo', directive: 'Write in the introspective, philosophical lyric style of Fernando Pessoa.' },
    { id: 'machado', label: 'Machado de Assis', hint: 'irônico',      directive: 'Write in the wry, ironic, urbane style of Machado de Assis.' },
    { id: 'cordel',  label: 'Cordel',           hint: 'rima popular', directive: 'Write as Brazilian literatura de cordel: rhymed, rhythmic, folk-storytelling verse.' },
  ],
  ja: [
    { id: 'basho',    label: '俳句（芭蕉）', hint: '季語と余白',  directive: 'Write as a haiku in the spirit of Bashō: a seasonal word, a vivid image, spare and resonant.' },
    { id: 'soseki',   label: '夏目漱石',     hint: '知的な諧謔',  directive: 'Write in the wry, intelligent, gently melancholic modern style of Natsume Sōseki.' },
    { id: 'murakami', label: '村上春樹',     hint: '静かな幻想',  directive: 'Write in the calm, surreal, understated contemporary style of Haruki Murakami.' },
    { id: 'kawabata', label: '川端康成',     hint: '繊細な情景',  directive: 'Write in the delicate, restrained, image-led style of Yasunari Kawabata.' },
    { id: 'tanka',    label: '短歌',         hint: '五七五七七',  directive: 'Write as a tanka: a 5-line lyrical poem of quiet emotion.' },
  ],
  ko: [
    { id: 'kimsowol', label: '김소월', hint: '민요적 서정', directive: 'Write in the folk-lyric, tender, longing style of the poet Kim Sowol (김소월).' },
    { id: 'sijo',     label: '시조',   hint: '3장 정형시',  directive: 'Write as a sijo: a three-line classical Korean poem with a reflective turn.' },
    { id: 'pansori',  label: '판소리', hint: '구성진 가락', directive: 'Write in the rhythmic, dramatic, oral-epic narration style of pansori.' },
    { id: 'ilsang',   label: '일상체', hint: '다정한 동네말', directive: 'Write in warm, everyday colloquial Korean, like a kind neighbour.' },
  ],
  ru: [
    { id: 'pushkin',     label: 'Пушкин',     hint: 'лёгкий стих',   directive: 'Write as a graceful lyric in the spirit of Alexander Pushkin.' },
    { id: 'dostoevsky',  label: 'Достоевский', hint: 'психологизм',  directive: 'Write in the feverish, intense, psychological style of Dostoevsky.' },
    { id: 'chekhov',     label: 'Чехов',      hint: 'сдержанность',  directive: 'Write in the understated, humane, precise style of Anton Chekhov.' },
    { id: 'razgovor',    label: 'Разговорный', hint: 'по-соседски',  directive: 'Write in warm, everyday colloquial Russian, like a friendly neighbour.' },
  ],
  ar: [
    { id: 'mutanabbi', label: 'المتنبي',   hint: 'فخر كلاسيكي', directive: 'Write in the proud, eloquent, classical Arabic ode (qasida) spirit of Al-Mutanabbi.' },
    { id: 'darwish',   label: 'محمود درويش', hint: 'غنائية',     directive: 'Write in the lyrical, evocative, humane poetic style of Mahmoud Darwish.' },
    { id: 'mahfouz',   label: 'نجيب محفوظ', hint: 'واقعية',      directive: 'Write in the warm, realist, observant narrative style of Naguib Mahfouz.' },
    { id: 'ammiya',    label: 'عامية',      hint: 'كلام الحارة', directive: 'Write in warm, everyday colloquial Arabic, like a friendly neighbour.' },
  ],
  hi: [
    { id: 'premchand', label: 'प्रेमचंद', hint: 'सामाजिक यथार्थ', directive: 'Write in the social-realist, compassionate, everyday style of Munshi Premchand.' },
    { id: 'kabir',     label: 'कबीर',     hint: 'दोहा',          directive: 'Write as a Kabir-style doha: a pithy, mystical, two-line couplet with earthy wisdom.' },
    { id: 'bachchan',  label: 'बच्चन',    hint: 'ओजस्वी काव्य',  directive: 'Write as stirring lyric verse in the spirit of Harivansh Rai Bachchan (Madhushala).' },
    { id: 'filmi',     label: 'फ़िल्मी',  hint: 'नाटकीय',        directive: 'Write in a warm, dramatic, Bollywood-flavoured narrative voice.' },
  ],
};

// Language-neutral fallback tones (labels in English; output language is enforced separately).
const UNIVERSAL = [
  { id: 'warm',     label: 'Warm & neighbourly', hint: 'friendly',   directive: 'Write warmly and plainly, like a kind neighbour.' },
  { id: 'poetic',   label: 'Poetic',             hint: 'lyrical',    directive: 'Write as a short poem with vivid, gentle imagery.' },
  { id: 'witty',    label: 'Witty',              hint: 'light humour', directive: 'Write with light, tasteful humour.' },
  { id: 'formal',   label: 'Formal',             hint: 'polished',   directive: 'Write in a polished, formal, respectful register.' },
  { id: 'reporter', label: 'Reporter',           hint: 'just facts', directive: 'Write like a concise, neutral news reporter.' },
  { id: 'kids',     label: 'For kids',           hint: 'cheerful',   directive: 'Write simply and cheerfully, the way you would for children.' },
];

export function getStyles(lang) {
  const l = normLang(lang);
  return { lang: l, styles: CATALOG[l] || UNIVERSAL };
}

export function getStyleDirective(lang, id) {
  if (!id) return null;
  const { styles } = getStyles(lang);
  const found = styles.find((s) => s.id === id) || UNIVERSAL.find((s) => s.id === id);
  return found ? found.directive : null;
}

export { normLang };
