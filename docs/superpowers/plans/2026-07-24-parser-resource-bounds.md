# Parser Resource Bounds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound parser CPU and memory use on wide and multipage documents while preserving the public `parse()` interface and default automatic pagination.

**Architecture:** Replace parser-owned quadratic DOM operations with an iterative comment walk and a scoped descendant selector that prevents Cheerio from preparing thousands of sibling context nodes. Keep multipage extraction enabled, but cap rendered pages and assembled extracted HTML, and derive aggregate word count from accepted pages instead of constructing a second aggregate DOM.

**Tech Stack:** JavaScript, Node.js 22+, Cheerio 1.x, Jest, Vitest/Playwright, Rollup.

## Global Constraints

- Change only `mercury-parser-jocmp`; do not modify `extract`.
- Keep `fetchAllPages` enabled by default and preserve the `parse()` signature.
- Render at most 5 pages. Always retain the first page, then append follow-on
  pages only while assembled extracted HTML remains within 5 MiB.
- Preserve the existing result fields and `<hr><h4>Page N</h4>` content markup.
- Return a successful partial result when a page or aggregate limit is reached.
- Do not patch or fork Cheerio, css-select, or domutils.
- Keep Node, browser, CommonJS, ESM, and web builds working.
- Follow red-green-refactor: every production change must be preceded by a test that fails for the expected reason.

---

### Task 1: Remove comments with a linear tree walk

**Files:**

- Modify: `src/resource/utils/dom/clean.test.js`
- Modify: `src/resource/utils/dom/clean.js`

**Interfaces:**

- Consumes: a Cheerio root function `$`.
- Produces: unchanged `clean($) -> $` behavior without calling `find('*').contents()`.

- [ ] **Step 1: Add a failing regression test that forbids descendant querying**

Append this test inside the existing `describe('clean($)')` block in `src/resource/utils/dom/clean.test.js`:

```js
it('removes nested comments without querying every descendant', () => {
  const $ = cheerio.load(
    '<div>before<!-- outer --><span>middle<!-- inner --></span>after</div>',
    null,
    false
  );
  const $root = $.root();
  $root.find = () => {
    throw new Error('cleanComments must not query all descendants');
  };
  $.root = () => $root;

  assert.strictEqual(
    clean($).html(),
    '<div>before<span>middle</span>after</div>'
  );
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
rtk npx jest src/resource/utils/dom/clean.test.js --runInBand
```

Expected: the new test fails with `cleanComments must not query all descendants` from the existing `$.root().find('*')` call.

- [ ] **Step 3: Replace `cleanComments` with an iterative traversal**

Replace `isComment` and `cleanComments` in `src/resource/utils/dom/clean.js` with:

```js
function cleanComments($) {
  const root = $.root().get(0);
  const stack = root && root.children ? [...root.children] : [];
  const comments = [];

  while (stack.length > 0) {
    const node = stack.pop();
    if (node.type === 'comment') {
      comments.push(node);
    } else if (node.children) {
      stack.push(...node.children);
    }
  }

  $(comments).remove();
  return $;
}
```

Keep the existing `clean($)` export unchanged.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
rtk npx jest src/resource/utils/dom/clean.test.js --runInBand
```

Expected: all `clean($)` tests pass, including nested comment removal.

- [ ] **Step 5: Commit the linear comment fix**

```bash
rtk git add src/resource/utils/dom/clean.js src/resource/utils/dom/clean.test.js
rtk git commit -m "fix: remove comments with linear traversal"
```

---

### Task 2: Scope parser descendant searches

**Files:**

- Create: `src/utils/dom/find-within.js`
- Create: `src/utils/dom/find-within.test.js`
- Modify: `src/cleaners/content.test.js`
- Modify: `src/utils/dom/clean-images.js`
- Modify: `src/utils/dom/make-links-absolute.js`
- Modify: `src/utils/dom/mark-to-keep.js`
- Modify: `src/utils/dom/strip-junk-tags.js`
- Modify: `src/utils/dom/clean-h-ones.js`
- Modify: `src/utils/dom/clean-headers.js`
- Modify: `src/utils/dom/clean-tags.js`
- Modify: `src/utils/dom/remove-empty.js`
- Modify: `src/utils/dom/clean-attributes.js`
- Modify: `src/utils/dom/link-density.js`

**Interfaces:**

- Produces: internal `findWithin($context, selector) -> Cheerio`.
- Selector contract: `selector` is a non-empty parser-owned selector string; results include descendants but never the context node.
- Consumers: parser DOM cleaners only; this helper is not exported from the public DOM index.

- [ ] **Step 1: Add failing selector-semantics tests**

Create `src/utils/dom/find-within.test.js`:

```js
import assert from 'assert';
import * as cheerio from 'cheerio';

import findWithin from './find-within';

describe('findWithin($context, selector)', () => {
  it('matches descendants for compound and comma-separated selectors', () => {
    const $ = cheerio.load(
      '<main class="context"><p class="note">One</p><section><img data-keep="yes"><p>Two</p></section></main>',
      null,
      false
    );
    const $context = $('main');
    const matches = findWithin($context, 'p.note, img[data-keep="yes"]');

    assert.deepStrictEqual(
      matches.toArray().map(node => node.tagName),
      ['p', 'img']
    );
  });

  it('does not include the context node for a wildcard selector', () => {
    const $ = cheerio.load(
      '<main class="context"><div><span>Text</span></div></main>',
      null,
      false
    );
    const $context = $('main');
    const matches = findWithin($context, '*');

    assert.strictEqual(matches.filter('.context').length, 0);
    assert.deepStrictEqual(
      matches.toArray().map(node => node.tagName),
      ['div', 'span']
    );
  });
});
```

- [ ] **Step 2: Run the helper test and verify RED**

Run:

```bash
rtk npx jest src/utils/dom/find-within.test.js --runInBand
```

Expected: Jest fails because `./find-within` does not exist.

- [ ] **Step 3: Implement the scoped helper**

Create `src/utils/dom/find-within.js`:

```js
export default function findWithin($context, selector) {
  return $context.find(`:scope :is(${selector})`);
}
```

- [ ] **Step 4: Run the helper test and verify GREEN**

Run:

```bash
rtk npx jest src/utils/dom/find-within.test.js --runInBand
```

Expected: both selector-semantics tests pass.

- [ ] **Step 5: Add a failing wide-context regression test**

Add `const domutils = require('domutils');` beside the existing `fs` require in `src/cleaners/content.test.js`, then append this test inside its existing `describe` block:

```js
it('does not pass a wide sibling list to selector context preparation', () => {
  const html = `<article>${'<p>article words remain here</p>'.repeat(
    2000
  )}</article>`;
  const $ = cheerio.load(html, null, false);
  const contextSizes = [];
  const removeSubsets = domutils.removeSubsets;
  const spy = jest
    .spyOn(domutils, 'removeSubsets')
    .mockImplementation(nodes => {
      contextSizes.push(nodes.length);
      return removeSubsets(nodes);
    });

  try {
    extractCleanNode($('article'), {
      $,
      cleanConditionally: false,
      title: '',
      url: 'https://example.com/article',
    });
  } finally {
    spy.mockRestore();
  }

  assert.ok(contextSizes.length > 0);
  assert.ok(
    Math.max(...contextSizes) <= 1,
    `largest selector context was ${Math.max(...contextSizes)}`
  );
});
```

- [ ] **Step 6: Run the wide-context test and verify RED**

Run:

```bash
rtk npx jest src/cleaners/content.test.js --runInBand
```

Expected: the new assertion fails with a largest selector context near 2,000.

- [ ] **Step 7: Route cleaner descendant searches through `findWithin`**

Add `import findWithin from './find-within';` to each DOM utility in the same directory that uses it. Apply these exact replacements:

```js
// clean-images.js
findWithin($article, 'img').each((index, img) => {

// make-links-absolute.js, inside absolutizeSet
findWithin($content, '[srcset]').each((_, node) => {

// mark-to-keep.js
findWithin(article, tags.join(',')).addClass(KEEP_CLASS);

// strip-junk-tags.js
findWithin(article, tags.join(',')).not(`.${KEEP_CLASS}`).remove();

// clean-h-ones.js
const $hOnes = findWithin(article, 'h1');

// clean-headers.js
findWithin($article, HEADER_TAG_LIST).each((index, header) => {

// clean-tags.js, removeUnlessContent
const pCount = findWithin($node, 'p').length;
const inputCount = findWithin($node, 'input').length;
const imgCount = findWithin($node, 'img').length;
const scriptCount = findWithin($node, 'script').length;

// clean-tags.js, exported cleaner
findWithin($article, CLEAN_CONDITIONALLY_TAGS).each((index, node) => {
if (
  $node.hasClass(KEEP_CLASS) ||
  findWithin($node, `.${KEEP_CLASS}`).length > 0
)
  return;

// remove-empty.js
findWithin($article, 'p').each((index, p) => {
if (
  findWithin($p, 'iframe, img').length === 0 &&
  $p.text().trim() === ''
)
  $p.remove();

// clean-attributes.js
findWithin($article, '*').each((index, node) => {
findWithin($article, `.${KEEP_CLASS}`).removeClass(KEEP_CLASS);

// link-density.js
const linkText = findWithin($node, 'a').text();
```

Do not change global document searches such as `$(`[${attr}]`)` in `absolutize`; their selector context begins at the single document root and does not contain the wide sibling array.

- [ ] **Step 8: Run focused cleaner tests and verify GREEN**

Run:

```bash
rtk npx jest src/cleaners/content.test.js src/utils/dom/find-within.test.js src/utils/dom/clean-images.test.js src/utils/dom/make-links-absolute.test.js src/utils/dom/mark-to-keep.test.js src/utils/dom/strip-junk-tags.test.js src/utils/dom/clean-h-ones.test.js src/utils/dom/clean-headers.test.js src/utils/dom/clean-tags.test.js src/utils/dom/remove-empty.test.js src/utils/dom/clean-attributes.test.js src/utils/dom/link-density.test.js --runInBand
```

Expected: all focused tests pass, and the widest `removeSubsets` input recorded by the regression test is one node.

- [ ] **Step 9: Commit scoped descendant selection**

```bash
rtk git add src/cleaners/content.test.js src/utils/dom/find-within.js src/utils/dom/find-within.test.js src/utils/dom/clean-images.js src/utils/dom/make-links-absolute.js src/utils/dom/mark-to-keep.js src/utils/dom/strip-junk-tags.js src/utils/dom/clean-h-ones.js src/utils/dom/clean-headers.js src/utils/dom/clean-tags.js src/utils/dom/remove-empty.js src/utils/dom/clean-attributes.js src/utils/dom/link-density.js
rtk git commit -m "fix: scope cleaner descendant searches"
```

---

### Task 3: Bound multipage aggregation and count words incrementally

**Files:**

- Create: `test/collect-all-pages.test.js`
- Modify: `src/extractors/collect-all-pages.js`

**Interfaces:**

- Produces internal constants `MAX_PAGES = 5` and `MAX_EXTRACTED_CONTENT_LENGTH = 5242880`.
- Preserves `collectAllPages(options) -> Promise<result>` and result fields.
- Counts two synthetic heading words for every accepted page after the first.

- [ ] **Step 1: Add failing page-count, byte-budget, and word-count tests**

Create `test/collect-all-pages.test.js`:

```js
import assert from 'assert';
import Resource from 'resource';
import RootExtractor from 'extractors/root-extractor';
import GenericExtractor from 'extractors/generic';
import collectAllPages from 'extractors/collect-all-pages';

jest.mock('resource', () => ({
  __esModule: true,
  default: { create: jest.fn() },
}));

jest.mock('extractors/root-extractor', () => ({
  __esModule: true,
  default: { extract: jest.fn() },
}));

jest.mock('extractors/generic', () => ({
  __esModule: true,
  default: { word_count: jest.fn(() => -1) },
}));

const origin = 'https://example.com/article';

function options(result = {}) {
  return {
    next_page_url: `${origin}/2`,
    html: '<html></html>',
    $: null,
    metaCache: {},
    result: {
      content: '<p>page one words</p>',
      word_count: 3,
      ...result,
    },
    Extractor: {},
    title: 'Article',
    url: `${origin}/1`,
  };
}

function installPages(lastPage = 10, wordsPerPage = 3) {
  Resource.create.mockImplementation(async url => ({
    html: () => `<html data-url="${url}"></html>`,
  }));
  RootExtractor.extract.mockImplementation((_Extractor, { url }) => {
    const page = Number(url.split('/').pop());
    return {
      content: `<p>page ${page} words</p>`,
      word_count: wordsPerPage,
      next_page_url: page < lastPage ? `${origin}/${page + 1}` : null,
    };
  });
}

describe('collectAllPages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders at most five pages', async () => {
    installPages(10);

    const result = await collectAllPages(options());

    assert.strictEqual(Resource.create.mock.calls.length, 4);
    assert.strictEqual(result.total_pages, 5);
    assert.strictEqual(result.rendered_pages, 5);
    assert.match(result.content, /Page 5/);
    assert.doesNotMatch(result.content, /Page 6/);
  });

  it('does not append a page that exceeds the five MiB aggregate budget', async () => {
    const firstPage = 'a'.repeat(5 * 1024 * 1024 - 32);
    Resource.create.mockResolvedValue({ html: () => '<html></html>' });
    RootExtractor.extract.mockReturnValue({
      content: 'b'.repeat(64),
      word_count: 1,
      next_page_url: null,
    });

    const result = await collectAllPages(
      options({ content: firstPage, word_count: 1 })
    );

    assert.strictEqual(Resource.create.mock.calls.length, 1);
    assert.strictEqual(result.total_pages, 1);
    assert.strictEqual(result.rendered_pages, 1);
    assert.strictEqual(result.content, firstPage);
  });

  it('counts accepted pages without reparsing the assembled HTML', async () => {
    installPages(2, 4);

    const result = await collectAllPages(options());

    assert.strictEqual(GenericExtractor.word_count.mock.calls.length, 0);
    assert.strictEqual(result.word_count, 9);
  });
});
```

- [ ] **Step 2: Run the new tests and verify RED**

Run:

```bash
rtk npx jest test/collect-all-pages.test.js --runInBand
```

Expected: the page-limit test observes nine follow-up fetches, the aggregate test renders two pages, and the word-count test observes one aggregate reparse.

- [ ] **Step 3: Implement bounded collection and incremental counting**

Replace `src/extractors/collect-all-pages.js` with:

```js
import { removeAnchor } from 'utils/text';
import RootExtractor from 'extractors/root-extractor';
import Resource from 'resource';

export const MAX_PAGES = 5;
export const MAX_EXTRACTED_CONTENT_LENGTH = 5 * 1024 * 1024;

const encoder = new TextEncoder();

function byteLength(value) {
  return encoder.encode(value).byteLength;
}

export default async function collectAllPages({
  next_page_url,
  html,
  $,
  metaCache,
  result,
  Extractor,
  title,
  url,
}) {
  let pages = 1;
  let contentLength = byteLength(result.content || '');
  let word_count = Number(result.word_count) || 0;
  const previousUrls = [removeAnchor(url)];

  while (next_page_url && pages < MAX_PAGES) {
    const pageNumber = pages + 1;

    $ = await Resource.create(next_page_url);
    html = $.html();

    const extractorOpts = {
      url: next_page_url,
      html,
      $,
      metaCache,
      extractedTitle: title,
      previousUrls,
    };

    const nextPageResult = RootExtractor.extract(Extractor, extractorOpts);
    const appendedContent = `<hr><h4>Page ${pageNumber}</h4>${
      nextPageResult.content || ''
    }`;
    const appendedLength = byteLength(appendedContent);

    if (contentLength + appendedLength > MAX_EXTRACTED_CONTENT_LENGTH) {
      break;
    }

    previousUrls.push(next_page_url);
    result = {
      ...result,
      content: `${result.content}${appendedContent}`,
    };
    contentLength += appendedLength;
    word_count += (Number(nextPageResult.word_count) || 0) + 2;
    pages = pageNumber;
    next_page_url = nextPageResult.next_page_url;
  }

  return {
    ...result,
    total_pages: pages,
    rendered_pages: pages,
    word_count,
  };
}
```

- [ ] **Step 4: Run the multipage tests and verify GREEN**

Run:

```bash
rtk npx jest test/collect-all-pages.test.js nock/mercury.test.js --runInBand
```

Expected: all new tests pass and the recorded three-page Ars Technica extraction remains three pages.

- [ ] **Step 5: Commit bounded multipage collection**

```bash
rtk git add src/extractors/collect-all-pages.js test/collect-all-pages.test.js
rtk git commit -m "fix: bound multipage parser aggregation"
```

---

### Task 4: Rebuild distributions and verify the original symptoms

**Files:**

- Modify through Rollup: `dist/mercury.js`
- Modify through Rollup: `dist/mercury.js.map`
- Modify through Rollup: `dist/mercury.esm.js`
- Modify through Rollup: `dist/mercury.esm.js.map`
- Modify through Rollup: `dist/mercury.web.js`
- Modify through Rollup: `dist/mercury.web.js.map`

**Interfaces:**

- Produces distributable CommonJS, ESM, and browser bundles containing all three fixes.
- Consumed by Git dependencies such as `extract` through package `main`, `module`, and `browser` fields.

- [ ] **Step 1: Run source lint and complete Node/browser tests**

```bash
rtk npm run lint:ci
rtk npm test
```

Expected: lint exits zero; Jest and Vitest report zero failures.

- [ ] **Step 2: Rebuild and test every distribution format**

```bash
rtk npm run build:ci
rtk npm run build:esm:ci
rtk npm run build:web:ci
```

Expected: all Rollup builds and their bundle smoke tests exit zero.

- [ ] **Step 3: Verify the generated bundles contain the resource bounds**

```bash
rtk rg -n "MAX_PAGES|MAX_EXTRACTED_CONTENT_LENGTH|:scope :is" dist/mercury.js
rtk git diff --check
```

Expected: the CommonJS bundle contains the five-page/5 MiB logic and scoped selector; `git diff --check` reports no whitespace errors.

- [ ] **Step 4: Rerun the wide-document CPU/RSS diagnostic against the rebuilt CommonJS bundle**

In `/private/tmp/parser-shape-worker.js`, replace its parser import with this
exact line using `apply_patch`:

```js
const parser = require('/Users/ben/Sites/mercury-parser-jocmp/dist/mercury.js');
```

Then run:

```bash
rtk node /private/tmp/parser-shape-controller.js siblings 4000 8000 12000 16000
```

Expected: all four parses complete; the 16,000-sibling case is materially faster than the 4.34-second baseline, and a fresh CPU profile no longer attributes most samples to `removeSubsets` or Cheerio `contents()`.

- [ ] **Step 5: Rerun multipage memory diagnostics against the rebuilt CommonJS bundle**

In `/private/tmp/parser-multipage-diagnostic.js`, replace its parser import with
this exact line using `apply_patch`:

```js
const parser = require('/Users/ben/Sites/mercury-parser-jocmp/dist/mercury.js');
```

Then run:

```bash
rtk node --expose-gc /private/tmp/parser-multipage-diagnostic.js 25 2000 true
```

Expected: `hits` and `renderedPages` are 5, elapsed time and peak RSS are below the previous 25-page result (4.85 seconds and 775 MiB), and forced-GC heap does not grow linearly.

- [ ] **Step 6: Inspect the final diff and commit generated distributions**

```bash
rtk git status --short
rtk git diff --stat
rtk git add dist/mercury.js dist/mercury.js.map dist/mercury.esm.js dist/mercury.esm.js.map dist/mercury.web.js dist/mercury.web.js.map
rtk git commit -m "build: update parser distributions"
```

Expected: only the design/plan history, source/tests, and generated parser bundles are part of the completed change; the worktree is clean after the commit.
