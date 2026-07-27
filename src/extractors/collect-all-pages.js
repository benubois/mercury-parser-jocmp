import { removeAnchor } from 'utils/text';
import RootExtractor from 'extractors/root-extractor';
import Resource from 'resource';

// A document paginated past this is almost always a slideshow or a broken
// next-page selector rather than a real article.
export const MAX_PAGES = 5;

// Ceiling on the assembled extracted HTML. Every page is held in memory at
// once, so without a cap a long pagination chain can drive a long-lived parser
// process into swap.
export const MAX_EXTRACTED_CONTENT_LENGTH = 5 * 1024 * 1024;

const encoder = new TextEncoder();

// The budget is memory, so measure UTF-8 bytes rather than UTF-16 code units.
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
  // The first page is the primary parse result and is always kept.
  let pages = 1;
  let content = result.content || '';
  let contentLength = byteLength(content);
  let word_count = Number(result.word_count) || 0;
  const previousUrls = [removeAnchor(url)];

  while (next_page_url && pages < MAX_PAGES) {
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
    const appendedContent = `<hr><h4>Page ${pages + 1}</h4>${
      nextPageResult.content || ''
    }`;
    const appendedLength = byteLength(appendedContent);

    // Over budget: return the pages assembled so far rather than erroring,
    // matching how the page cutoff above degrades.
    if (contentLength + appendedLength > MAX_EXTRACTED_CONTENT_LENGTH) break;

    previousUrls.push(next_page_url);
    content += appendedContent;
    contentLength += appendedLength;
    // Counted incrementally: reparsing the assembled HTML to count words would
    // build a second full DOM over content already held in memory. The 2 is the
    // synthetic "Page N" heading.
    word_count += (Number(nextPageResult.word_count) || 0) + 2;
    pages += 1;

    next_page_url = nextPageResult.next_page_url;
  }

  return {
    ...result,
    content,
    total_pages: pages,
    rendered_pages: pages,
    word_count,
  };
}
