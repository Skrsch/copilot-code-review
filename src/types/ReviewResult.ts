import { FileComments } from './FileComments';
import { ReviewRequest } from './ReviewRequest';
import { ReviewSummary } from './ReviewSummary';

export type ReviewResult = {
    request: ReviewRequest;
    fileComments: FileComments[];
    errors: Error[];
    summary?: ReviewSummary;
};
