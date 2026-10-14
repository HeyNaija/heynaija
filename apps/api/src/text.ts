const segmenter = new Intl.Segmenter()

/** Length as the person typing sees it: an emoji or an accented letter is one. */
export const graphemes = (text: string) => [...segmenter.segment(text)].length

// Control and format characters, except the zero-width joiner that holds emoji
// sequences together. Among them are the direction overrides and invisible marks
// that let text look like something it is not (a different name, a fake handle).
const HIDDEN = /(?!‍)[\p{Cc}\p{Cf}]/gu

/** One line: hidden characters removed, any run of whitespace becomes a space. */
export const cleanLine = (text: string) => text.replace(/\s+/g, ' ').replace(HIDDEN, '').replace(/ {2,}/g, ' ').trim()

/** Several lines: hidden characters removed, at most one blank line in a row. */
export const cleanLines = (text: string) =>
  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').replace(HIDDEN, '').replace(/ {2,}/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
