// Opening tag of a whitespace-significant element, whose contents must be left
// untouched.
const OPEN_BLOCK_RE = /<(pre|code|textarea)[^>]*>/gi;

// Matching closing tags, searched for as plain literals (no backtracking).
const CLOSE_BLOCK_RE = {
  pre: /<\/pre>/gi,
  code: /<\/code>/gi,
  textarea: /<\/textarea>/gi,
};

// Collapse runs of 2+ whitespace to a single space. Plain and linear.
const WHITESPACE_RE = /\s{2,}/g;

// Collapse whitespace, but preserve it inside <pre>/<code>/<textarea> blocks
// where it is significant.
//
// This walks the string, carving out those blocks and only collapsing
// whitespace in the segments between them. A previous implementation used a
// single regex with a `(?![^<>]*<\/(pre|code|textarea)>)` negative lookahead;
// that ran a lookahead scan at every whitespace run, and on tag-free strings
// (e.g. $node.text()) each scan ran to end-of-string, degrading to O(n^2) and
// pegging the CPU for many seconds on large articles.
//
// The scan below stays O(n): each opening tag triggers at most one forward
// search for its closing tag, and an unmatched open ends the walk rather than
// re-scanning from the next character.
export default function normalizeSpaces(text) {
  let result = '';
  let cursor = 0;
  let open;

  // Reset in case a previous invocation threw mid-loop and left lastIndex set.
  OPEN_BLOCK_RE.lastIndex = 0;

  while ((open = OPEN_BLOCK_RE.exec(text)) !== null) {
    const closeRe = CLOSE_BLOCK_RE[open[1].toLowerCase()];
    closeRe.lastIndex = OPEN_BLOCK_RE.lastIndex;
    const close = closeRe.exec(text);

    // No matching close tag: nothing left to preserve, so stop and let the
    // remainder be collapsed below.
    if (close === null) break;

    const blockEnd = close.index + close[0].length;
    // Collapse the text before the block, keep the block itself verbatim.
    result += text.slice(cursor, open.index).replace(WHITESPACE_RE, ' ');
    result += text.slice(open.index, blockEnd);
    cursor = blockEnd;
    OPEN_BLOCK_RE.lastIndex = blockEnd;
  }
  result += text.slice(cursor).replace(WHITESPACE_RE, ' ');

  return result.trim();
}
