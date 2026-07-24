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
