# Parser CPU and Memory Bounds Design

## Goal

Prevent pathological HTML from monopolizing a CPU core or driving a long-lived
parser process into swap, without changing the public `parse()` signature or
requiring changes in callers such as `extract`.

## Scope

This change is limited to `mercury-parser-jocmp`. It will:

- retain automatic multipage extraction by default;
- reduce the hard multipage maximum from 25 rendered pages to 5;
- stop adding pages when assembled extracted HTML reaches 5 MiB;
- remove the full-DOM reparse used to count words in assembled multipage HTML;
- make parser-owned comment and descendant traversal linear in document size;
- preserve the existing result object and multipage content markup.

It will not add worker threads, request deadlines, or admission control to the
`extract` service. It will not patch or fork Cheerio, css-select, or domutils.

## Root Causes

Wide article bodies expose two quadratic operations. Parser cleaners use
Cheerio descendant searches with thousands of direct children as selector
context. Cheerio prepares that context with `domutils.removeSubsets()`, which
uses repeated array scans. Separately, comment cleanup calls
`find('*').contents()`; Cheerio constructs the combined child list through
repeated array concatenation.

Multipage extraction follows as many as 25 pages, concatenates all extracted
HTML, and reparses the complete aggregate with Cheerio solely to calculate
`word_count`. That creates a second large DOM after all page content has
already been retained.

## Design

### Scoped descendant selection

Add a small internal DOM helper, `findWithin($context, selector)`, which scopes
selectors as `:scope :is(<selector>)`. Cheerio recognizes the leading `:scope`
and searches from the context node itself instead of passing every direct child
through `removeSubsets()`. The descendant combinator keeps the existing
behavior: the context node is not included in results.

Use this helper in parser cleanup utilities that currently call
`$context.find(selector)` or `$(selector, context)`, including image, link,
keep-marker, junk-tag, header, conditional-tag, empty-node, attribute, and link
density cleanup. Nested searches use the same helper so another wide subtree
cannot reintroduce the same problem.

This is an internal helper. It accepts the parser's static selector strings and
is not exposed as public API.

### Linear comment removal

Replace `find('*').contents()` with an iterative traversal beginning at the
Cheerio root. Visit each node once, collect comment nodes, and remove the
collected nodes after traversal. Deferring removal avoids mutating sibling links
while the traversal is active.

### Bounded multipage collection

Introduce named constants in `collect-all-pages.js`:

- `MAX_PAGES = 5`
- `MAX_EXTRACTED_CONTENT_LENGTH = 5 * 1024 * 1024`

`pages` continues to mean successfully appended/rendered pages. The collector
will not request a sixth page. Before appending a fetched page, it will compute
the UTF-8 byte length of the separator plus that page's extracted content. If
the cumulative result would exceed 5 MiB, collection stops and returns the
pages already assembled. Resource-limit exhaustion is therefore a graceful
partial result, consistent with the collector's existing hard page cutoff,
rather than a parser error.

The first page is always retained because it is the primary parse result. If
URL rewriting makes its extracted HTML exceed 5 MiB, no subsequent page is
appended.

### Incremental word count

Track `word_count` while accepting pages. Begin with the first page's count and
add each accepted page's count plus the two words in the synthetic `Page N`
heading. This preserves the logical count of the returned multipage content
without loading the aggregate into another Cheerio DOM. The final response
continues to expose a numeric `word_count` field.

## Data Flow

1. Parse and clean the first page using scoped, linear DOM traversal.
2. If automatic pagination is enabled, follow the next-page URL while fewer
   than five pages have been rendered.
3. Parse each candidate page normally.
4. Append it only when the cumulative extracted HTML remains within 5 MiB.
5. Update page count and word count incrementally.
6. Return the same result structure and `<hr><h4>Page N</h4>` separators used
   today.

## Compatibility and Error Handling

`fetchAllPages` remains enabled by default and remains caller-configurable.
There is no new public page-count option. Documents with more than five pages,
or whose extracted aggregate exceeds 5 MiB, return a successful partial result
with `total_pages` and `rendered_pages` equal to the pages actually included.

Single-page extraction, custom extractors, and browser builds retain their
existing interfaces. Selector scoping must produce the same matched nodes and
cleanup output as the current descendant searches.

## Testing

Automated regression coverage will verify:

- scoped descendant selection handles tag, attribute, class, wildcard, and
  comma-separated selectors without including the context node;
- cleaning a wide context returns the same output without exercising the
  wide-child selector context;
- comments at multiple nesting levels are removed while surrounding text and
  elements are preserved;
- automatic pagination requests and renders no more than five pages;
- aggregate-size exhaustion returns only pages within the 5 MiB budget;
- multipage word count is calculated from accepted pages and synthetic page
  headings without reparsing the aggregate;
- existing Node, browser, build, lint, and extractor tests remain green.

The original synthetic diagnostics will be rerun through the installed parser
and through `extract`. Verification will compare elapsed time, health-check
delay, peak RSS, post-GC heap, rendered page count, and result content against
the recorded pre-fix baselines.

## Acceptance Criteria

- The 16,000-sibling, approximately 5.1 MB reproduction no longer spends most
  CPU time in `domutils.removeSubsets()` or Cheerio `contents()`.
- Default multipage parsing renders at most five pages and never assembles more
  than 5 MiB of extracted follow-on content.
- Multipage word counting does not call `cheerio.load()` on the assembled
  result.
- Parser output remains structurally compatible and all existing test suites
  pass.
