#!/usr/bin/env bun

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { SpawnSyncOptionsWithStringEncoding } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bunCommand = process.platform === 'win32' ? 'bun.exe' : 'bun';
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const verifierEnv = createVerifierEnv();
const timeouts = {
    build: 6 * 60 * 1000,
    pack: 2 * 60 * 1000,
    install: 3 * 60 * 1000,
    help: 60 * 1000,
};

const requiredFiles = [
    'package.json',
    'bin/local-chartdb.ts',
    'bin/runtime-config.ts',
    'dist/index.html',
    'README.md',
    'LICENSE',
];

type RunOptions = {
    capture?: boolean;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeout?: number;
};

type PackedFile = {
    path: string;
};

type PackResult = {
    filename: string;
    files: PackedFile[];
};

function createVerifierEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env };

    delete env.BUN_INTERNAL_BUNX_INSTALL;
    delete env.npm_execpath;
    delete env.npm_node_execpath;
    delete env.npm_config_user_agent;
    delete env.NODE;

    const pathEntries = (env.PATH ?? '')
        .split(delimiter)
        .filter(Boolean)
        .filter((entry) => {
            const normalized = entry.replaceAll('\\', '/');
            return (
                !normalized.includes('/tmp/bun-node-') &&
                !normalized.includes('/tmp/bunx-')
            );
        });

    if (env.NVM_BIN) {
        pathEntries.unshift(env.NVM_BIN);
    }

    env.PATH = [...new Set(pathEntries)].join(delimiter);
    return env;
}

function formatCommand(command: string, args: string[]): string {
    return [command, ...args].join(' ');
}

function run(
    command: string,
    args: string[],
    options: RunOptions = {}
): string {
    const env = { ...verifierEnv, ...options.env };
    const spawnOptions: SpawnSyncOptionsWithStringEncoding = {
        cwd: options.cwd ?? rootDir,
        encoding: 'utf8',
        stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
        shell: false,
        env,
        timeout: options.timeout,
    };
    const result = spawnSync(command, args, spawnOptions);

    const spawnError = result.error as NodeJS.ErrnoException | undefined;

    if (spawnError?.code === 'ETIMEDOUT') {
        const seconds = Math.round((options.timeout ?? 0) / 1000);
        throw new Error(
            `Command timed out after ${seconds}s: ${formatCommand(command, args)}\n` +
                `The verifier must run under real Bun. Detected PATH: ${env.PATH}`
        );
    }

    if (result.error) {
        throw result.error;
    }

    if (result.status !== 0) {
        const output = [result.stdout, result.stderr]
            .filter(Boolean)
            .join('\n');
        throw new Error(
            `Command failed: ${formatCommand(command, args)}${output ? `\n${output}` : ''}`
        );
    }

    return result.stdout;
}

function readPackResult(stdout: string): PackResult {
    try {
        const packResult = JSON.parse(stdout) as PackResult[];
        return packResult[0];
    } catch (error: unknown) {
        if (!(error instanceof Error)) {
            throw error;
        }

        throw new Error(`Unable to parse npm pack output: ${error.message}`);
    }
}

function verifyPackedFiles(files: PackedFile[]): void {
    const paths = new Set(files.map((file) => file.path));

    for (const file of requiredFiles) {
        if (!paths.has(file)) {
            throw new Error(`Packed package is missing ${file}.`);
        }
    }

    if (![...paths].some((file) => file.startsWith('dist/assets/'))) {
        throw new Error('Packed package is missing dist/assets/* files.');
    }
}

function printVerifierEnvironment(): void {
    const bunVersion = run(bunCommand, ['--version'], {
        capture: true,
    }).trim();
    const npmVersion = run(npmCommand, ['--version'], { capture: true }).trim();

    console.log('Verifier environment:');
    console.log(`Bun: ${bunVersion}`);
    console.log(`npm: ${npmVersion}`);

    console.log('Package CLI will be verified with bunx --bun.');
}

let tarballPath: string | undefined;
let tempDir: string | undefined;

try {
    printVerifierEnvironment();

    console.log('Building ChartDB...');
    run(bunCommand, ['run', 'build'], { timeout: timeouts.build });

    console.log('Packing npm package...');
    const packResult = readPackResult(
        run(npmCommand, ['pack', '--json', '--ignore-scripts'], {
            capture: true,
            timeout: timeouts.pack,
        })
    );

    verifyPackedFiles(packResult.files);
    tarballPath = join(rootDir, packResult.filename);

    tempDir = mkdtempSync(join(tmpdir(), 'local-chartdb-'));
    writeFileSync(
        join(tempDir, 'package.json'),
        '{"name":"local-chartdb-verify","private":true}\n'
    );

    console.log('Installing packed package with Bun in a temporary project...');
    run(bunCommand, ['add', tarballPath, '--ignore-scripts'], {
        cwd: tempDir,
        timeout: timeouts.install,
    });

    console.log('Verifying bunx --bun help output...');
    run(
        bunCommand,
        [
            'x',
            '--bun',
            '--no-install',
            '@moritzbrantner/local-chartdb',
            '--help',
        ],
        {
            cwd: tempDir,
            timeout: timeouts.help,
        }
    );

    console.log(`Verified ${basename(packResult.filename)}.`);
} finally {
    if (tempDir) {
        rmSync(tempDir, { recursive: true, force: true });
    }

    if (tarballPath) {
        rmSync(tarballPath, { force: true });
    }
}
