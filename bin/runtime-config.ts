const runtimeEnvKeys = [
    'OPENAI_API_KEY',
    'OPENAI_API_ENDPOINT',
    'LLM_MODEL_NAME',
    'HIDE_CHARTDB_CLOUD',
    'DISABLE_ANALYTICS',
] as const;

export type RuntimeEnv = Record<string, string | undefined>;

export function renderRuntimeConfig(env: RuntimeEnv): string {
    const entries = runtimeEnvKeys
        .map((key) => `    ${key}: ${JSON.stringify(env[key] ?? '')},`)
        .join('\n');

    return `window.env = {\n${entries}\n};\n`;
}
