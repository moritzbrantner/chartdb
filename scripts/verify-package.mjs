#!/usr/bin/env node

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nodeCommand = process.platform === 'win32' ? 'node.exe' : 'node';
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const verifierEnv = createVerifierEnv();
const timeouts = {
    build: 6 * 60 * 1000,
    pack: 2 * 60 * 1000,
    install: 3 * 60 * 1000,
    help: 60 * 1000,
};

const requiredFiles = [
    'package.json',
    'bin/chartdb-local.js',
    'dist/index.html',
    'README.md',
    'LICENSE',
];

function createVerifierEnv() {
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

function formatCommand(command, args) {
    return [command, ...args].join(' ');
}

function run(command, args, options = {}) {
    const env = { ...verifierEnv, ...options.env };
    const result = spawnSync(command, args, {
        cwd: options.cwd ?? rootDir,
        encoding: 'utf8',
        stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
        shell: false,
        env,
        timeout: options.timeout,
    });

    if (result.error?.code === 'ETIMEDOUT') {
        const seconds = Math.round((options.timeout ?? 0) / 1000);
        throw new Error(
            `Command timed out after ${seconds}s: ${formatCommand(command, args)}\n` +
                `The verifier must run under real Node.js. Detected PATH: ${env.PATH}`
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

function readPackResult(stdout) {
    try {
        const packResult = JSON.parse(stdout);
        return packResult[0];
    } catch (error) {
        throw new Error(`Unable to parse npm pack output: ${error.message}`);
    }
}

function verifyPackedFiles(files) {
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

function printVerifierEnvironment() {
    const nodeVersion = run(nodeCommand, ['--version'], {
        capture: true,
    }).trim();
    const npmVersion = run(npmCommand, ['--version'], { capture: true }).trim();

    console.log('Verifier environment:');
    console.log(`Node: ${nodeVersion}`);
    console.log(`npm: ${npmVersion}`);

    if (process.versions.bun) {
        console.log(
            'Bun runtime detected for the parent process; child npm commands will run with a sanitized PATH.'
        );
    }
}

let tarballPath;
let tempDir;

try {
    printVerifierEnvironment();

    console.log('Building ChartDB...');
    run(npmCommand, ['run', 'build'], { timeout: timeouts.build });

    console.log('Packing npm package...');
    const packResult = readPackResult(
        run(npmCommand, ['pack', '--json', '--ignore-scripts'], {
            capture: true,
            timeout: timeouts.pack,
        })
    );

    verifyPackedFiles(packResult.files);
    tarballPath = join(rootDir, packResult.filename);

    tempDir = mkdtempSync(join(tmpdir(), 'chartdb-local-'));
    writeFileSync(
        join(tempDir, 'package.json'),
        '{"name":"chartdb-local-verify","private":true}\n'
    );

    console.log('Installing packed package in a temporary project...');
    run(
        npmCommand,
        ['install', tarballPath, '--ignore-scripts', '--no-audit', '--no-fund'],
        { cwd: tempDir, timeout: timeouts.install }
    );

    console.log('Verifying npx help output...');
    run(
        npxCommand,
        ['--no-install', '@moritzbrantner/chartdb-local', '--help'],
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
