import type { Git } from '@/utils/git';
import type { Logger } from './Logger';
import type { Model } from './Model';
import type { ReviewMode } from './ReviewMode';

export type Config = {
    workspaceRoot: string;
    gitRoot: string;
    git: Git;
    getModel: () => Promise<Model>;
    getOptions: () => Options;
    logger: Logger;
};

export type Options = {
    minSeverity: number;
    customPrompt: string;
    excludeGlobs: string[];
    repositoryPath?: string;
    reviewMode?: ReviewMode;
    styleguide?: string;
    styleguideUseCopilotInstructions?: boolean;
    useGithubInstructions?: boolean;
    architecturalContextLines?: number;
    incrementalReReview?: boolean;
    hideTriagedFindings?: boolean;
    baselineFilePath?: string;
    enableDebugOutput: boolean;
    chatModel: string;
    mergeFileReviewRequests: boolean;
    maxInputTokensFraction: number;
    comparePromptTypes?: string;
};
