import { lookup } from "node:dns/promises";
import puppeteer from "puppeteer";

const CONNECTION_TIMEOUT_MS = 10000;

// Chrome rejects a non-localhost hostname in the debugging endpoint's Host header.
async function resolveBrowserUrl() {
	const url = new URL(process.env.BROWSER_URL || "http://host.docker.internal:9222");
	if (url.hostname === "host.docker.internal") {
		url.hostname = (await lookup(url.hostname, { family: 4 })).address;
	}
	return url.origin;
}

export const BROWSER_URL = await resolveBrowserUrl();

// Own the transport so an attachment timeout can close the socket immediately,
// even when Puppeteer has not returned a Browser to disconnect yet.
async function openTransport(endpoint) {
	const socket = new WebSocket(endpoint);
	const transport = {
		send: (message) => socket.send(message),
		close: () => socket.close(),
	};
	socket.addEventListener("message", (event) => transport.onmessage?.(event.data));
	socket.addEventListener("close", () => transport.onclose?.());
	let timer;
	try {
		await new Promise((resolve, reject) => {
			timer = setTimeout(
				() => reject(new Error("WebSocket connection timed out")),
				CONNECTION_TIMEOUT_MS,
			);
			socket.addEventListener("open", resolve, { once: true });
			socket.addEventListener("error", () => reject(new Error("WebSocket connection failed")), {
				once: true,
			});
			socket.addEventListener(
				"close",
				() => reject(new Error("WebSocket closed before connecting")),
				{ once: true },
			);
		});
		return transport;
	} catch (error) {
		transport.close();
		throw error;
	} finally {
		clearTimeout(timer);
	}
}

async function openBrowser() {
	let endpoint;
	try {
		const response = await fetch(new URL("/json/version", BROWSER_URL), {
			signal: AbortSignal.timeout(CONNECTION_TIMEOUT_MS),
		});
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		endpoint = (await response.json()).webSocketDebuggerUrl;
		if (typeof endpoint !== "string" || !/^wss?:\/\//.test(endpoint)) {
			throw new Error("Missing Chrome WebSocket endpoint");
		}
	} catch (cause) {
		throw new Error(
			`Chrome HTTP discovery failed at ${BROWSER_URL}: ${cause.message}. Check host reachability and remote debugging.`,
			{ cause },
		);
	}

	let transport;
	try {
		transport = await openTransport(endpoint);
	} catch (cause) {
		throw new Error(
			`Chrome HTTP discovery succeeded at ${BROWSER_URL}, but the debugging WebSocket failed: ${cause.message}.`,
			{ cause },
		);
	}

	let timer;
	const connecting = puppeteer.connect({ transport, defaultViewport: null });
	try {
		return await Promise.race([
			connecting,
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(new Error("Attachment timed out")), CONNECTION_TIMEOUT_MS);
			}),
		]);
	} catch (cause) {
		transport.close();
		connecting.then(
			(browser) => browser.disconnect(),
			() => {},
		);
		throw new Error(
			`Chrome HTTP and WebSocket connections succeeded at ${BROWSER_URL}, but Puppeteer attachment failed: ${cause.message}. Reuse one connection for the workflow; report a persistent attachment failure before changing host processes.`,
			{ cause },
		);
	} finally {
		clearTimeout(timer);
	}
}

// Share both pending and established connections within this Node process.
// Callers keep it open until the whole workflow finishes, then disconnect once.
let connectionPromise;
export function connectBrowser() {
	if (!connectionPromise) {
		const pending = openBrowser();
		connectionPromise = pending;
		const reset = () => {
			if (connectionPromise === pending) connectionPromise = undefined;
		};
		pending.then((browser) => browser.once("disconnected", reset), reset);
	}
	return connectionPromise;
}

export async function getActivePage(browser, targetId = process.env.BROWSER_TARGET_ID) {
	const pages = await browser.pages();
	if (targetId) {
		const page = pages.find((candidate) => candidate.target()._targetId === targetId);
		if (!page)
			throw new Error(
				`Browser tab ${targetId} was not found. Run browser-start.js to list current tab IDs.`,
			);
		return page;
	}
	if (pages.length === 1) return pages[0];
	if (!pages.length) throw new Error("No browser tabs are open.");
	throw new Error(
		"Multiple browser tabs are open. Run browser-start.js and set BROWSER_TARGET_ID to select one; tab order does not indicate focus.",
	);
}
