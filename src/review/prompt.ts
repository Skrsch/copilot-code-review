import type { PromptType } from '../types/PromptType';
import type { ReviewMode } from '../types/ReviewMode';
import { createReviewPromptV1 } from './promptV1';
import { createReviewPromptV2 } from './promptV2';
import { createReviewPromptV2Think } from './promptV2Think';

export const defaultPromptType: PromptType = 'v2think';
const promptTypes: PromptType[] = ['v1', 'v2', 'v2think'];

export const reasoningTag = 'code_review_process';

export type ReviewPromptContext = {
    reviewMode?: ReviewMode;
    styleguide?: string;
    githubInstructions?: string;
};

function toPromptType(type: string): PromptType {
    if (!promptTypes.includes(type as PromptType)) {
        throw new Error(
            `Invalid prompt type: ${type}. Valid types are: ${promptTypes.join(', ')}`
        );
    }
    return type as PromptType;
}

export function toPromptTypes(
    types: string | undefined
): (PromptType | undefined)[] {
    if (!types) {
        return [undefined]; // same as default prompt type, but comments are not marked with it
    }
    return types.split(',').map((type) => toPromptType(type.trim()));
}

export function createReviewPrompt(
    changeDescription: string | undefined,
    diff: string,
    customPrompt: string,
    promptType?: PromptType,
    promptContext?: ReviewPromptContext
): string {
    customPrompt = mergeCustomPrompts(
        customPrompt,
        getGithubInstructionsPrompt(promptContext),
        getReviewModePrompt(promptContext)
    );

    const type = promptType || defaultPromptType;
    if (type === 'v2') {
        return createReviewPromptV2(changeDescription, diff, customPrompt);
    } else if (type === 'v2think') {
        return createReviewPromptV2Think(changeDescription, diff, customPrompt);
    } else {
        return createReviewPromptV1(changeDescription, diff, customPrompt);
    }
}

function mergeCustomPrompts(...prompts: (string | undefined)[]): string {
    const merged = prompts
        .map((prompt) => prompt?.trim())
        .filter((prompt): prompt is string => !!prompt && prompt.length > 0)
        .join('\n\n');
    return merged;
}

function getReviewModePrompt(promptContext?: ReviewPromptContext): string {
    const reviewMode = promptContext?.reviewMode ?? 'general';

    if (reviewMode === 'architectural') {
        return `<Review Mode>
Architectural review mode:
- Focus on high-level design decisions and system structure.
- Prioritize findings about module boundaries, interfaces/contracts, coupling/cohesion, dependency direction, and maintainability.
- Use the broader surrounding diff context to reason about impact across files, classes, and modules.
- Avoid style nitpicks unless they impact architecture, readability, or long-term maintainability.
- Prefer fewer, high-impact findings over many minor points.
</Review Mode>`;
    }

    if (reviewMode === 'styleguide') {
        const styleguide = promptContext?.styleguide?.trim();
        const styleguideSection = styleguide
            ? `<Styleguide>\n${styleguide}\n</Styleguide>\n`
            : '';
        return `<Review Mode>
Styleguide review mode:
- Focus on whether the changes follow the styleguide.
- Prioritize findings that clearly violate explicit styleguide rules.
- Only report issues that are actionable and can be fixed in code.
- If no styleguide text is provided, use common language/framework conventions conservatively.
</Review Mode>
${styleguideSection}`.trim();
    }

    if (reviewMode === 'performance') {
        return `<Review Mode>
Performance review mode:
- Focus on runtime and memory performance risks introduced by the changes.
- Prioritize findings about unnecessary allocations, expensive loops, repeated I/O, inefficient data access, and algorithmic complexity regressions.
- Flag potential N+1 calls, blocking operations on hot paths, and missing caching/batching opportunities when clearly justified by the diff.
- Avoid style or architecture feedback unless it directly affects performance.
- Prefer actionable findings with clear expected impact and concrete optimization direction.
</Review Mode>`;
    }

    return '';
}

function getGithubInstructionsPrompt(
    promptContext?: ReviewPromptContext
): string {
    const githubInstructions = promptContext?.githubInstructions?.trim();
    if (!githubInstructions) {
        return '';
    }

    return `<GitHub Instructions>
${githubInstructions}
</GitHub Instructions>`;
}

export const responseExample = [
    {
        file: 'src/index.html',
        line: 23,
        comment: 'The <script> tag is misspelled as <scirpt>.',
        severity: 4,
        proposedAdjustment: {
            originalCode: '<scirpt src="js/main.js"></scirpt>',
            adjustedCode: '<script src="js/main.js"></script>',
            description: 'Fix the misspelled script tag',
            startLine: 23,
            endLine: 23,
        },
    },
    {
        file: 'src/js/main.js',
        line: 43,
        comment:
            'This method duplicates some of the logic defined in `calculateTotal` inside `src/js/util.js`. Consider refactoring this into a separate helper function to improve readability and reduce duplication.',
        severity: 3,
    },
    {
        file: 'src/js/main.js',
        line: 55,
        comment:
            'Using `eval()` with a possibly user-supplied string may result in code injection.',
        severity: 5,
        proposedAdjustment: {
            originalCode: 'const result = eval(userInput);',
            adjustedCode: 'const result = JSON.parse(userInput);',
            description:
                'Replace eval() with safer JSON.parse() for parsing user input',
            startLine: 55,
            endLine: 55,
        },
    },
];
