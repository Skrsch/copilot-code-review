import { describe, expect, it } from 'vitest';

import { normalizeReviewMode, reviewModes } from '@/types/ReviewMode';

describe('ReviewMode', () => {
    it('contains all supported modes', () => {
        expect(reviewModes).toEqual([
            'general',
            'architectural',
            'styleguide',
            'performance',
        ]);
    });

    it('normalizes valid modes', () => {
        expect(normalizeReviewMode('general')).toBe('general');
        expect(normalizeReviewMode('architectural')).toBe('architectural');
        expect(normalizeReviewMode('styleguide')).toBe('styleguide');
        expect(normalizeReviewMode('performance')).toBe('performance');
    });

    it('falls back to general for invalid values', () => {
        expect(normalizeReviewMode(undefined)).toBe('general');
        expect(normalizeReviewMode('unknown-mode')).toBe('general');
    });
});
