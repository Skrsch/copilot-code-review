import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getGithubInstructionsContext } from '@/review/instructions';
import type { Config, Options } from '@/types/Config';
import type { Logger } from '@/types/Logger';

describe('getGithubInstructionsContext', () => {
    let gitRoot: string;
    const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        setEnableDebug: vi.fn(),
        isDebugEnabled: vi.fn(() => false),
    } as Logger;

    beforeEach(async () => {
        gitRoot = await mkdtemp(
            path.join(os.tmpdir(), 'code-review-instructions-')
        );
        vi.clearAllMocks();
    });

    afterEach(async () => {
        await rm(gitRoot, { recursive: true, force: true });
    });

    function createConfig(): Config {
        return {
            gitRoot,
            logger,
        } as Config;
    }

    it('returns undefined when disabled', async () => {
        await mkdir(path.join(gitRoot, '.github', 'instructions'), {
            recursive: true,
        });
        await writeFile(
            path.join(gitRoot, '.github', 'instructions', 'any.md'),
            'Always use typed errors.'
        );

        const result = await getGithubInstructionsContext(
            createConfig(),
            { useGithubInstructions: false } as Options,
            ['src/index.ts']
        );

        expect(result).toBeUndefined();
    });

    it('includes instructions files without applyTo for any scope', async () => {
        await mkdir(path.join(gitRoot, '.github', 'instructions', 'backend'), {
            recursive: true,
        });
        await writeFile(
            path.join(
                gitRoot,
                '.github',
                'instructions',
                'backend',
                'general.md'
            ),
            'Prefer small focused functions.'
        );

        const result = await getGithubInstructionsContext(
            createConfig(),
            { useGithubInstructions: true } as Options,
            ['src/index.ts']
        );

        expect(result).toContain(
            'From .github/instructions/backend/general.md'
        );
        expect(result).toContain('Prefer small focused functions.');
    });

    it('respects applyTo frontmatter patterns', async () => {
        await mkdir(path.join(gitRoot, '.github', 'instructions'), {
            recursive: true,
        });
        await writeFile(
            path.join(gitRoot, '.github', 'instructions', 'typescript.md'),
            `---
applyTo:
  - "**/*.ts"
---
Use strict TypeScript settings.`
        );
        await writeFile(
            path.join(gitRoot, '.github', 'instructions', 'docs.md'),
            `---
applyTo: "**/*.md"
---
Write docs in active voice.`
        );

        const result = await getGithubInstructionsContext(
            createConfig(),
            { useGithubInstructions: true } as Options,
            ['src/app.ts']
        );

        expect(result).toContain('From .github/instructions/typescript.md');
        expect(result).toContain('Use strict TypeScript settings.');
        expect(result).not.toContain('From .github/instructions/docs.md');
    });
});
