#!/usr/bin/env node
/**
 * A complete, dependency-free Longbox plugin.
 *
 * It exists to be read and copied. It implements the whole protocol in one file with
 * nothing but Node's standard library, so you can see exactly what Longbox expects
 * before you commit to a framework, a language, or a repository layout.
 *
 * What it does: reports one made-up upcoming issue per followed series, dated the next
 * Wednesday. That is enough to watch a release appear on the calendar end to end.
 *
 *   node server.js                 # listens on 8099
 *   PORT=9000 node server.js
 *
 * Then in Longbox: Settings → Server → Plugins → Register, with the base URL
 * http://<host>:8099/longbox/v1
 */

const http = require('node:http')

const PORT = Number(process.env.PORT ?? 8099)
const BASE_PATH = '/longbox/v1'

/**
 * Longbox reads this before it will store anything about you. `capabilities` is what it
 * will actually call; `config` is what it will render a settings form from, store on
 * your behalf (encrypting anything typed `secret`), and hand back on every call.
 */
const MANIFEST = {
	protocol: 1,
	id: 'com.longbox.reference',
	name: 'Reference Plugin',
	version: '1.0.0',
	description: 'A worked example. Reports one invented issue per followed series.',
	capabilities: ['release-source'],
	config: [
		{
			key: 'label',
			label: 'Issue title prefix',
			type: 'string',
			required: false,
			default: 'Upcoming',
			help: 'Prepended to every invented issue title, so you can tell this plugin’s rows apart.',
		},
		{
			key: 'api_key',
			label: 'API key',
			type: 'secret',
			required: false,
			help: 'Unused here. Present so you can see how Longbox handles a secret: it is stored encrypted and never sent back to the browser.',
		},
	],
}

/**
 * `manifest` and `health` are deliberately servable without the token — they carry no
 * secrets, and Longbox has to be able to read the manifest during registration, before
 * you have had a chance to paste the token in. Capability endpoints are the ones that
 * must check it.
 */
function isAuthorized(req) {
	if (!process.env.PLUGIN_TOKEN) {
		return true // No token configured: accept anything. Fine for a demo, not for real.
	}
	return req.headers.authorization === `Bearer ${process.env.PLUGIN_TOKEN}`
}

/** The next Wednesday on or after today, as ISO `YYYY-MM-DD` — comics ship on Wednesdays. */
function nextWednesday() {
	const date = new Date()
	date.setUTCDate(date.getUTCDate() + ((3 - date.getUTCDay() + 7) % 7))
	return date.toISOString().slice(0, 10)
}

/**
 * The `release-source` capability.
 *
 * Longbox tells you which series it cares about and echoes their ids; you answer using
 * those same ids. Nothing has to be reconciled afterwards, and a release naming a series
 * that was not in the request is dropped rather than trusted.
 */
function releases(body) {
	const prefix = body.config?.label ?? 'Upcoming'
	const date = nextWednesday()

	return {
		releases: (body.series ?? []).map((series) => ({
			series_id: series.id,
			// Stable per (series, date): Longbox upserts on this, so a re-sweep updates
			// the row rather than adding another one.
			external_id: `reference-${series.id}-${date}`,
			number: '1',
			title: `${prefix}: ${series.name}`,
			release_date: date,
		})),
	}
}

function send(res, status, payload) {
	const body = JSON.stringify(payload)
	res.writeHead(status, {
		'content-type': 'application/json',
		'content-length': Buffer.byteLength(body),
	})
	res.end(body)
}

function readJson(req) {
	return new Promise((resolve, reject) => {
		let raw = ''
		req.on('data', (chunk) => {
			raw += chunk
			if (raw.length > 1_000_000) reject(new Error('request too large'))
		})
		req.on('end', () => {
			try {
				resolve(raw ? JSON.parse(raw) : {})
			} catch (error) {
				reject(error)
			}
		})
		req.on('error', reject)
	})
}

const server = http.createServer(async (req, res) => {
	const url = new URL(req.url, `http://${req.headers.host}`)
	const route = url.pathname.startsWith(BASE_PATH) ? url.pathname.slice(BASE_PATH.length) : null

	console.log(
		`${req.method} ${url.pathname}`,
		`protocol=${req.headers['x-longbox-protocol'] ?? '-'}`,
		`request-id=${req.headers['x-longbox-request-id'] ?? '-'}`,
	)

	if (req.method === 'GET' && route === '/manifest') {
		return send(res, 200, MANIFEST)
	}

	if (req.method === 'GET' && route === '/health') {
		return send(res, 200, { ok: true, detail: 'Reference plugin is running' })
	}

	if (req.method === 'POST' && route === '/releases') {
		if (!isAuthorized(req)) {
			return send(res, 401, { error: 'bad token' })
		}
		try {
			return send(res, 200, releases(await readJson(req)))
		} catch (error) {
			return send(res, 400, { error: String(error) })
		}
	}

	send(res, 404, { error: 'no such endpoint' })
})

server.listen(PORT, () => {
	console.log(`Reference plugin listening on http://0.0.0.0:${PORT}${BASE_PATH}`)
	if (!process.env.PLUGIN_TOKEN) {
		console.log('PLUGIN_TOKEN is unset — every request will be accepted.')
	}
})
