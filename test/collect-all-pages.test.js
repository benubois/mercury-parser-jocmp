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
const maxExtractedContentLength = 5 * 1024 * 1024;

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

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

  it('normalizes null first-page content at the exact aggregate boundary', async () => {
    const heading = '<hr><h4>Page 2</h4>';
    const appendedContent = `${heading}${'b'.repeat(
      maxExtractedContentLength - byteLength(heading)
    )}`;
    Resource.create.mockResolvedValue({ html: () => '<html></html>' });
    RootExtractor.extract.mockReturnValue({
      content: appendedContent.slice(heading.length),
      word_count: 4,
      next_page_url: null,
    });

    const result = await collectAllPages(options({ content: null }));

    assert.strictEqual(byteLength(appendedContent), maxExtractedContentLength);
    assert.strictEqual(result.content, appendedContent);
    assert.strictEqual(result.total_pages, 2);
    assert.strictEqual(result.word_count, 9);
  });

  it('normalizes undefined first-page content with multibyte byte accounting', async () => {
    const heading = '<hr><h4>Page 2</h4>';
    const firstCharacter = '€';
    const appendedContent = `${heading}${firstCharacter}${'b'.repeat(
      maxExtractedContentLength -
        byteLength(heading) -
        byteLength(firstCharacter)
    )}`;
    Resource.create.mockResolvedValue({ html: () => '<html></html>' });
    RootExtractor.extract.mockReturnValue({
      content: appendedContent.slice(heading.length),
      word_count: 4,
      next_page_url: null,
    });

    const result = await collectAllPages(options({ content: undefined }));

    assert.strictEqual(byteLength(appendedContent), maxExtractedContentLength);
    assert.strictEqual(result.content, appendedContent);
    assert.strictEqual(result.total_pages, 2);
    assert.strictEqual(result.word_count, 9);
  });

  it('leaves state unchanged when a candidate exceeds the aggregate budget', async () => {
    const firstPage = 'a'.repeat(maxExtractedContentLength - 1);
    let candidatePreviousUrls;
    Resource.create.mockResolvedValue({ html: () => '<html></html>' });
    RootExtractor.extract.mockImplementation((_Extractor, { previousUrls }) => {
      candidatePreviousUrls = previousUrls;
      return {
        content: '€',
        word_count: 4,
        next_page_url: `${origin}/3`,
      };
    });

    const result = await collectAllPages(
      options({ content: firstPage, word_count: 7 })
    );

    assert.deepStrictEqual(candidatePreviousUrls, [`${origin}/1`]);
    assert.strictEqual(result.content, firstPage);
    assert.strictEqual(result.total_pages, 1);
    assert.strictEqual(result.rendered_pages, 1);
    assert.strictEqual(result.word_count, 7);
  });
});
