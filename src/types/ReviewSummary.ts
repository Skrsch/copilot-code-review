import type { ReviewMode } from './ReviewMode';

export type ReviewSummary = {
    reviewMode: ReviewMode;
    scopeKey: string;
    incrementalEnabled: boolean;
    totalFiles: number;
    reviewedFiles: number;
    skippedUnchangedFiles: number;
    findingsTotal: number;
    findingsOpen: number;
    findingsTriaged: number;
    findingsNew: number;
    findingsCarried: number;
    findingsResolved: number;
    severityCounts: Record<number, number>;
    modelUsed: string;
    resourcesUsed: string[];
    toolsUsed: string[];
};
