import puppeteer from "puppeteer-core";

// Chrome's remote debugging rejects Host headers that aren't localhost or an IP.
// Resolve host.docker.internal to its IP so puppeteer connects with a numeric Host header.
async function resolveBrowserUrl() {
	if (process.env.BROWSER_URL) return process.env.BROWSER_URL;
	try {
		const { lookup } = await import("node:dns/promises");
		const { address } = await lookup("host.docker.internal");
		return `http://${address}:9222`;
	} catch {
		return "http://host.docker.internal:9222";
	}
}

export const BROWSER_URL = await resolveBrowserUrl();

export async function connectBrowser() {
	const b = await Promise.race([
		puppeteer.connect({
			browserURL: BROWSER_URL,
			defaultViewport: null,
		}),
		new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
	]).catch((e) => {
		console.error(`✗ Could not connect to browser at ${BROWSER_URL}: ${e.message}`);
		console.error("  Start Chrome on host with: chrome --remote-debugging-port=9222");
		process.exit(1);
	});
	return b;
}

export async function getActivePage(browser) {
	const p = (await browser.pages()).at(-1);
	if (!p) {
		console.error("✗ No active tab found");
		process.exit(1);
	}
	return p;
}
