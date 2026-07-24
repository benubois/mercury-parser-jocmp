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
  let content = result.content || '';
  let contentLength = byteLength(content);
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
    content = `${content}${appendedContent}`;
    result = {
      ...result,
      content,
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
