import { describe, expect, it } from 'vitest';
import { page } from '../page.ts';

/** Inline <script> blocks of the page (external scripts are skipped). */
function scripts(html: string): string[] {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? '');
}

describe('demo page', () => {
  it.each([
    { live: false, maxLiveAmount: 200, withKkiapay: false },
    { live: false, maxLiveAmount: 200, withKkiapay: true },
    { live: true, maxLiveAmount: 200, withKkiapay: false },
  ])('has a valid inline script (%o)', (options) => {
    const inline = scripts(page(options));
    expect(inline.length).toBeGreaterThan(0);
    // Parses without running: a quote or escape mistake in the template throws here.
    for (const script of inline) expect(() => new Function(script)).not.toThrow();
  });

  it('only offers the outage switch when Kkiapay is configured', () => {
    expect(page({ live: false, maxLiveAmount: 200, withKkiapay: true })).toContain(
      'type="checkbox" name="outage"',
    );
    expect(page({ live: false, maxLiveAmount: 200, withKkiapay: false })).not.toContain(
      'type="checkbox" name="outage"',
    );
  });
});
