import assert from 'assert';
import * as cheerio from 'cheerio';

import { normalizeSpaces } from './index';

describe('normalizeSpaces(text)', () => {
  it('normalizes spaces from text', () => {
    const $ = cheerio.load(`
      <div>
        <p>What do you think?</p>
      </div>
    `);

    const result = normalizeSpaces(
      $('*')
        .first()
        .text()
    );
    assert.strictEqual(result, 'What do you think?');
  });

  it('preserves spaces in preformatted text blocks', () => {
    const $ = cheerio.load(
      `
      <div>
        <p>What   do  you    think?</p>
        <pre>  What     happens to        spaces?    </pre>
      </div>
    `,
      null,
      false
    );

    const result = normalizeSpaces($.html());
    assert.strictEqual(
      result,
      '<div> <p>What do you think?</p> <pre>  What     happens to        spaces?    </pre> </div>'
    );
  });

  // Guards against a catastrophic O(n^2) regression: a negative-lookahead in the
  // normalize regex made every whitespace run scan to end-of-string on tag-free
  // text (e.g. $node.text()), pegging the CPU for many seconds on large articles.
  it('normalizes large tag-free text in linear time', () => {
    // ~350KB of tag-free, whitespace-heavy text, like a big article's .text().
    const text = 'lorem ipsum dolor  sit amet  '.repeat(12000);

    const start = process.hrtime.bigint();
    const result = normalizeSpaces(text);
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;

    assert.strictEqual(result.includes('  '), false);
    assert.ok(
      elapsedMs < 1000,
      `normalizeSpaces took ${elapsedMs.toFixed(0)}ms on ${
        text.length
      } chars; expected < 1000ms`
    );
  }, 20000);

  // cheerio never emits unclosed tags, but the util must stay linear even on
  // malformed input so it can never become a CPU sink in a long-running process.
  it('stays linear on malformed input with many unclosed preserve tags', () => {
    const text = '<pre>  x  '.repeat(60000); // ~600KB, no closing tags

    const start = process.hrtime.bigint();
    normalizeSpaces(text);
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;

    assert.ok(
      elapsedMs < 1000,
      `normalizeSpaces took ${elapsedMs.toFixed(
        0
      )}ms on malformed input; expected < 1000ms`
    );
  }, 20000);
});
