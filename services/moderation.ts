// Automated Content Moderation & Profanity Filtering for Pentric Staff Room

const PROFANE_WORDS = [
  // Profanities and swear words
  'fuck', 'fucking', 'fucker', 'fucked', 'fucks', 'fuk', 'fck', 'fuking', 'f u c k',
  'shit', 'shitting', 'shitty', 'shite', 'sh1t', 's h i t',
  'bitch', 'bitches', 'bitching', 'b1tch', 'b i t c h',
  'asshole', 'ass', 'asses', 'dumbass', 'jackass', 'a$$', 'a$$hole',
  'bastard', 'bastards',
  'cunt', 'cunts',
  'dick', 'dicks', 'dickhead',
  'cock', 'cocks', 'cocksucker',
  'pussy', 'pussies',
  'whore', 'whores',
  'slut', 'sluts',
  'nigger', 'nigga', 'n1gger', 'n1gga', // Racial slurs
  'faggot', 'fag', // Homophobic slurs
  'retard', 'retarded',
  'wanker', 'twat', 'prick',
  'bollocks', 'motherfucker', 'motherfucking',
  'bullshit', 'horseshit',
  'porn', 'porno', 'sex', 'nude', 'nudes'
];

/**
 * Normalizes text to catch leetspeak and spaced-out swear words
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/@/g, 'a')
    .replace(/\$/g, 's')
    .replace(/!/g, 'i')
    .replace(/1/g, 'i')
    .replace(/0/g, 'o')
    .replace(/3/g, 'e')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/8/g, 'b');
}

/**
 * Checks if the text contains any prohibited profanity, vulgarity, or slurs.
 */
export function checkProfanity(text: string): { isClean: boolean; matchedWord?: string; reason?: string } {
  if (!text || typeof text !== 'string') {
    return { isClean: true };
  }

  const rawLower = text.toLowerCase();
  const normalized = normalizeText(text);
  const words = normalized.split(/[\s,._\-+*#~:;!?/\\|()\[\]{}"'<>`]+/);

  for (const badWord of PROFANE_WORDS) {
    // 1. Exact word token match
    if (words.includes(badWord)) {
      return {
        isClean: false,
        matchedWord: badWord,
        reason: 'Message contains prohibited vulgar language or profanity.'
      };
    }

    // 2. Continuous collapsed string match for multi-char words (e.g. "s.h.i.t" or "f u c k")
    const collapsed = normalized.replace(/[^a-z]/g, '');
    if (badWord.length >= 4 && collapsed.includes(badWord.replace(/\s+/g, ''))) {
      return {
        isClean: false,
        matchedWord: badWord,
        reason: 'Message contains prohibited vulgar language or profanity.'
      };
    }

    // 3. Word boundary regex on raw lowercase text
    const escaped = badWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    if (regex.test(rawLower)) {
      return {
        isClean: false,
        matchedWord: badWord,
        reason: 'Message contains prohibited vulgar language or profanity.'
      };
    }
  }

  return { isClean: true };
}
