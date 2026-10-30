// Копия руководств в web/src/guide/content должна совпадать с docs/ (образ web собирается без ../docs).
import { describe, expect, it } from 'vitest';
import { check } from '../../scripts/sync-guide.mjs';

describe('копия руководств для приложения', () => {
  it('совпадает с docs/manuals, docs/images и docs/pdf', () => {
    const problems = check();
    expect(problems, `Копия руководств устарела — выполните npm run guide:sync\n  ${problems.join('\n  ')}`).toEqual([]);
  });
});
