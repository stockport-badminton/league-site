// js-levenshtein ships no types. One function: the edit distance between two strings.
declare module 'js-levenshtein' {
  function levenshtein(a: string, b: string): number;
  export = levenshtein;
}
