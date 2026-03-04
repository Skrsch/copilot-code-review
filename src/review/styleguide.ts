import { readFile } from 'node:fs/promises';
import * as path from 'path';

import type { Config, Options } from '@/types/Config';

const maxStyleguideChars = 12000;
const copilotInstructionsCandidates = [
    '.github/copilot-instructions.md',
    'copilot-instructions.md',
];

/**
 * Gather styleguide content for styleguide review mode from:
 * 1) the `codeReview.styleguide` setting
 * 2) optional repository copilot instructions file(s)
 */
export async function getStyleguideContext(
    config: Config,
    options: Options
): Promise<string | undefined> {
    if (options.reviewMode !== 'styleguide') {
        return undefined;
    }

    const sections: string[] = [];

    const customStyleguide = options.styleguide?.trim();
    if (customStyleguide) {
        sections.push(customStyleguide);
    }

    if (options.styleguideUseCopilotInstructions) {
        const instructions = await loadCopilotInstructions(config.gitRoot);
        if (instructions) {
            sections.push(instructions);
        }
    }

    if (sections.length === 0) {
        return undefined;
    }

    const styleguide = sections.join('\n\n');
    if (styleguide.length <= maxStyleguideChars) {
        return styleguide;
    }

    config.logger.info(
        `Styleguide context truncated from ${styleguide.length} to ${maxStyleguideChars} characters`
    );
    return styleguide.slice(0, maxStyleguideChars);
}

async function loadCopilotInstructions(
    gitRoot: string
): Promise<string | undefined> {
    const sections: string[] = [];
    for (const relativePath of copilotInstructionsCandidates) {
        const absolutePath = path.join(gitRoot, relativePath);
        const content = await readFileIfExists(absolutePath);
        if (!content) {
            continue;
        }

        sections.push(`From ${relativePath}:\n${content.trim()}`);
    }

    if (sections.length === 0) {
        return undefined;
    }

    return sections.join('\n\n');
}

async function readFileIfExists(filePath: string): Promise<string | undefined> {
    try {
        return await readFile(filePath, 'utf8');
    } catch (error) {
        if (isErrnoCode(error, 'ENOENT')) {
            return undefined;
        }
        throw error;
    }
}

function isErrnoCode(
    error: unknown,
    code: string
): error is NodeJS.ErrnoException {
    return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === code
    );
}
