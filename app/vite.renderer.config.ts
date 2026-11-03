/* eslint-disable import/no-unresolved -- eslint-plugin-import's resolver misses export-map packages */
import { defineConfig } from 'vite';

export default defineConfig(async () => {
    const tailwindcss = (await import('@tailwindcss/vite')).default;

    return {
        plugins: [
            tailwindcss(),
        ],
    };
});