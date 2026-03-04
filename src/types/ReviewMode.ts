export const reviewModes = [
    'general',
    'architectural',
    'styleguide',
    'performance',
] as const;

export type ReviewMode = (typeof reviewModes)[number];

export function normalizeReviewMode(mode: string | undefined): ReviewMode {
    if (
        mode === 'architectural' ||
        mode === 'styleguide' ||
        mode === 'performance'
    ) {
        return mode;
    }
    return 'general';
}
