#!/usr/bin/env node

import { createServer } from 'node:http';
import { accessSync, constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import open from 'open';
import sirv from 'sirv';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8080;

const helpText = `Usage:
  chartdb-local [options]

Options:
  --host <host>    Host to bind to (default: ${DEFAULT_HOST})
  --port <number>  Port to listen on (default: ${DEFAULT_PORT})
  --open           Open the local URL in the default browser
  --help, -h       Show this help message

Examples:
  chartdb-local
  chartdb-local --port 9090
  chartdb-local --host 0.0.0.0 --port 8080 --open
`;

function parseArgs(argv) {
    const options = {
        host: DEFAULT_HOST,
        port: DEFAULT_PORT,
        open: false,
        help: false,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];

        if (arg === '--help' || arg === '-h') {
            options.help = true;
            continue;
        }

        if (arg === '--open') {
            options.open = true;
            continue;
        }

        if (arg === '--host') {
            index += 1;
            options.host = readValue(argv[index], '--host');
            continue;
        }

        if (arg.startsWith('--host=')) {
            options.host = readValue(arg.slice('--host='.length), '--host');
            continue;
        }

        if (arg === '--port') {
            index += 1;
            options.port = parsePort(readValue(argv[index], '--port'));
            continue;
        }

        if (arg.startsWith('--port=')) {
            options.port = parsePort(
                readValue(arg.slice('--port='.length), '--port')
            );
            continue;
        }

        throw new Error(`Unknown option: ${arg}`);
    }

    return options;
}

function readValue(value, option) {
    if (!value || value.startsWith('--')) {
        throw new Error(`${option} requires a value.`);
    }

    return value;
}

function parsePort(value) {
    const port = Number(value);

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`--port must be a number between 1 and 65535.`);
    }

    return port;
}

function formatUrl(host, port) {
    const urlHost =
        host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
    return `http://${urlHost}:${port}`;
}

function verifyDist(distDir) {
    try {
        accessSync(resolve(distDir, 'index.html'), constants.R_OK);
    } catch {
        console.error(
            'dist/index.html was not found. Run npm run build before using the CLI, or reinstall the package.'
        );
        process.exit(1);
    }
}

function handleListenError(error, host, port) {
    if (error.code === 'EADDRINUSE') {
        console.error(
            `Port ${port} is already in use on ${host}. Try --port <number>.`
        );
    } else if (error.code === 'EACCES') {
        console.error(
            `Permission denied while trying to listen on ${host}:${port}.`
        );
    } else {
        console.error(`Failed to start ChartDB Local: ${error.message}`);
    }

    process.exit(1);
}

function installShutdownHandlers(server) {
    let shuttingDown = false;

    const shutdown = () => {
        if (shuttingDown) {
            return;
        }

        shuttingDown = true;
        console.log('\nShutting down ChartDB Local...');

        server.close(() => {
            process.exit(0);
        });

        setTimeout(() => {
            process.exit(0);
        }, 5000).unref();
    };

    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
}

let options;

try {
    options = parseArgs(process.argv.slice(2));
} catch (error) {
    console.error(error.message);
    console.error('');
    console.error(helpText);
    process.exit(1);
}

if (options.help) {
    console.log(helpText);
    process.exit(0);
}

const binDir = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(binDir, '..', 'dist');

verifyDist(distDir);

const serve = sirv(distDir, {
    dev: true,
    single: true,
});

const server = createServer((request, response) => {
    serve(request, response);
});

server.on('error', (error) =>
    handleListenError(error, options.host, options.port)
);

server.listen(options.port, options.host, () => {
    const url = formatUrl(options.host, options.port);

    installShutdownHandlers(server);
    console.log(`ChartDB Local is running at ${url}`);

    if (options.open) {
        open(url).catch((error) => {
            console.warn(
                `Could not open the browser automatically: ${error.message}`
            );
        });
    }
});
