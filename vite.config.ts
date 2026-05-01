import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import path from 'path';
import UnpluginInjectPreload from 'unplugin-inject-preload/vite';
import { renderRuntimeConfig } from './bin/runtime-config';

function runtimeConfigPlugin(): Plugin {
    const writeRuntimeConfig = (
        _request: unknown,
        response: {
            setHeader: (name: string, value: string) => void;
            end: (body: string) => void;
        }
    ) => {
        response.setHeader(
            'Content-Type',
            'application/javascript; charset=utf-8'
        );
        response.setHeader('Cache-Control', 'no-store');
        response.end(renderRuntimeConfig(process.env));
    };

    return {
        name: 'chartdb-runtime-config',
        configureServer(server) {
            server.middlewares.use('/config.js', writeRuntimeConfig);
        },
        configurePreviewServer(server) {
            server.middlewares.use('/config.js', writeRuntimeConfig);
        },
    };
}

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        runtimeConfigPlugin(),
        react(),
        visualizer({
            filename: './stats/stats.html',
            open: false,
        }),
        UnpluginInjectPreload({
            files: [
                {
                    entryMatch: /logo-light.png$/,
                    outputMatch: /logo-light-.*.png$/,
                },
                {
                    entryMatch: /logo-dark.png$/,
                    outputMatch: /logo-dark-.*.png$/,
                },
            ],
        }),
    ],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    build: {
        rollupOptions: {
            external: (id) => /__test__/.test(id),
            output: {
                assetFileNames: (assetInfo) => {
                    if (
                        assetInfo.names &&
                        assetInfo.originalFileNames.some((name) =>
                            name.startsWith('src/assets/templates/')
                        )
                    ) {
                        return 'assets/[name][extname]';
                    }
                    return 'assets/[name]-[hash][extname]';
                },
            },
        },
    },
});
