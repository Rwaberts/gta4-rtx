import { defineConfig } from 'vitest/config';

export default defineConfig({
	base: './',
	server: { port: 5173, host: true },
	build: {
		target: 'es2022',
		chunkSizeWarningLimit: 1500,
	},
	test: {
		include: ['tests/unit/**/*.test.ts'],
		environment: 'node',
	},
});
