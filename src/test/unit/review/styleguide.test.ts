import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getStyleguideContext } from '@/review/styleguide';
import type { Config, Options } from '@/types/Config';
import type { Logger } from '@/types/Logger';

vi.mock('node:fs/promises', () => ({
    readFile: vi.fn(),
}));

describe('getStyleguideContext', () => {
    const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        setEnableDebug: vi.fn(),
        isDebugEnabled: vi.fn(() => false),
    } as Logger;

    const config = {
        gitRoot: '/repo',
        logger,
    } as Config;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns undefined outside of styleguide mode', async () => {
        const options = {
            reviewMode: 'general',
        } as Options;

        const result = await getStyleguideContext(config, options);

        expect(result).toBeUndefined();
    });

    it('returns styleguide from settings', async () => {
        const options = {
            reviewMode: 'styleguide',
            styleguide: 'Always use strict null checks.',
            styleguideUseCopilotInstructions: false,
        } as Options;

        const result = await getStyleguideContext(config, options);

        expect(result).toBe('Always use strict null checks.');
    });

    it('includes copilot instructions when enabled', async () => {
        const { readFile } = await import('node:fs/promises');
        vi.mocked(readFile).mockImplementation((filePath) => {
            const path =
                typeof filePath === 'string'
                    ? filePath
                    : Buffer.isBuffer(filePath)
                      ? filePath.toString('utf8')
                      : filePath instanceof URL
                        ? filePath.pathname
                        : '';
            if (path.endsWith('.github/copilot-instructions.md')) {
                return Promise.resolve('Prefer immutable data structures.');
            }
            const error = new Error('missing') as NodeJS.ErrnoException;
            error.code = 'ENOENT';
            return Promise.reject(error);
        });

        const options = {
            reviewMode: 'styleguide',
            styleguide: '',
            styleguideUseCopilotInstructions: true,
        } as Options;

        const result = await getStyleguideContext(config, options);

        expect(result).toContain('From .github/copilot-instructions.md');
        expect(result).toContain('Prefer immutable data structures.');
    });

    it('returns undefined when no styleguide sources exist', async () => {
        const { readFile } = await import('node:fs/promises');
        vi.mocked(readFile).mockImplementation(() => {
            const error = new Error('missing') as NodeJS.ErrnoException;
            error.code = 'ENOENT';
            return Promise.reject(error);
        });

        const options = {
            reviewMode: 'styleguide',
            styleguide: '',
            styleguideUseCopilotInstructions: true,
        } as Options;

        const result = await getStyleguideContext(config, options);

        expect(result).toBeUndefined();
    });
});
