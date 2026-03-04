import { describe, expect, it } from 'vitest';

import { createReviewPrompt } from '@/review/prompt';

const changeDescription = 'Various refactorings';
const diff = 'diff\nhere';
const customPrompt = 'custom prompt';

describe('createReviewPrompt', () => {
    it('creates prompt with custom prompt (default)', async () => {
        const prompt = createReviewPrompt(
            changeDescription,
            diff,
            customPrompt
        );
        await expect(prompt).toMatchFileSnapshot(
            'review-prompt-v2think-custom-prompt.snap'
        );
    });

    it('creates prompt with v1 type', async () => {
        const prompt = createReviewPrompt(
            changeDescription,
            diff,
            customPrompt,
            'v1'
        );
        await expect(prompt).toMatchFileSnapshot('review-prompt-v1.snap');
    });

    it('creates prompt with v2 type', async () => {
        const prompt = createReviewPrompt(
            changeDescription,
            diff,
            customPrompt,
            'v2'
        );
        await expect(prompt).toMatchFileSnapshot('review-prompt-v2.snap');
    });

    it('creates prompt with v2think type', async () => {
        const prompt = createReviewPrompt(
            changeDescription,
            diff,
            customPrompt,
            'v2think'
        );
        await expect(prompt).toMatchFileSnapshot('review-prompt-v2think.snap');
    });

    it('adds architectural mode instructions', () => {
        const prompt = createReviewPrompt(
            changeDescription,
            diff,
            customPrompt,
            'v2',
            { reviewMode: 'architectural' }
        );

        expect(prompt).toContain('Architectural review mode');
        expect(prompt).toContain('module boundaries');
    });

    it('adds styleguide mode instructions and styleguide text', () => {
        const prompt = createReviewPrompt(
            changeDescription,
            diff,
            customPrompt,
            'v2',
            {
                reviewMode: 'styleguide',
                styleguide: 'Use camelCase for identifiers.',
            }
        );

        expect(prompt).toContain('Styleguide review mode');
        expect(prompt).toContain('<Styleguide>');
        expect(prompt).toContain('Use camelCase for identifiers.');
    });

    it('adds performance mode instructions', () => {
        const prompt = createReviewPrompt(
            changeDescription,
            diff,
            customPrompt,
            'v2',
            { reviewMode: 'performance' }
        );

        expect(prompt).toContain('Performance review mode');
        expect(prompt).toContain('runtime and memory performance');
    });

    it('adds GitHub instructions context when provided', () => {
        const prompt = createReviewPrompt(
            changeDescription,
            diff,
            customPrompt,
            'v2',
            {
                githubInstructions:
                    'From .github/instructions/ts.instructions.md:\nPrefer readonly arrays.',
            }
        );

        expect(prompt).toContain('<GitHub Instructions>');
        expect(prompt).toContain('Prefer readonly arrays.');
    });
});
