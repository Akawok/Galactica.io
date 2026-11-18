import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// The API and the socket share the client's origin (Caddy in prod), the dev server proxies them.
const target = process.env.API_PROXY ?? 'http://localhost:3000';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		proxy: {
			'/api': target,
			'/socket.io': { target, ws: true }
		}
	}
});
