/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

/**
 * One-off diagnostic: load a serialized IdCompressor (base64) from a file and try to deserialize it.
 *
 * Usage (from packages/runtime/id-compressor, after `pnpm run build:compile`):
 *   node scripts/decodeIdCompressor.mjs <path-to-file> [writeVersion=2]
 *
 * The file may contain either the raw base64 string or the JSON-quoted form stored in the
 * `.idCompressor` summary blob (e.g. `"AAAAAAAAAEA..."`).
 */

import { readFileSync } from "node:fs";

import {
	createSessionId,
	deserializeIdCompressor,
} from "@fluidframework/id-compressor/internal";

const [, , filePath, writeVersionArg] = process.argv;
if (filePath === undefined) {
	console.error("Usage: node scripts/decodeIdCompressor.mjs <path-to-file> [writeVersion=2]");
	process.exit(2);
}
const writeVersion = Number(writeVersionArg ?? 2);

let text = readFileSync(filePath, "utf8")
	.replace(/^\uFEFF/, "")
	.trim();
if (text.startsWith('"')) {
	text = JSON.parse(text);
	console.log("Input was JSON-quoted; unwrapped with JSON.parse.");
}

console.log(`base64 length: ${text.length} (mod 4 = ${text.length % 4})`);

const invalid = [];
for (let i = 0; i < text.length; i++) {
	if (!/[A-Za-z0-9+/=]/.test(text[i])) {
		invalid.push(`${i}:U+${text.charCodeAt(i).toString(16).padStart(4, "0")}`);
	}
}
console.log(
	invalid.length === 0
		? "No characters outside [A-Za-z0-9+/=]."
		: `Characters outside [A-Za-z0-9+/=] (${invalid.length}), as index:codepoint: ${invalid.slice(0, 50).join(", ")}${invalid.length > 50 ? ", ..." : ""}`,
);
const firstPad = text.indexOf("=");
if (firstPad !== -1 && !/^=*$/.test(text.slice(firstPad))) {
	console.log(
		`WARNING: '=' at index ${firstPad} is followed by non-padding characters; decoders drop everything after it.`,
	);
}

// Node's decoder, like the browser one in client-utils, silently skips invalid characters.
const bytes = Buffer.from(text, "base64");
console.log(`decoded byte length: ${bytes.length} (mod 8 = ${bytes.length % 8})`);

// Header layout (8-byte LE doubles): version, hasLocalState, sessionCount, clusterCount,
// then sessionCount * 16-byte UUIDs, then clusterCount * (sessionIndex, capacity, count).
if (bytes.length >= 32) {
	const [version, hasLocalState, sessionCount, clusterCount] = [0, 1, 2, 3].map((i) =>
		bytes.readDoubleLE(i * 8),
	);
	console.log(
		`header: version=${version} hasLocalState=${hasLocalState} sessionCount=${sessionCount} clusterCount=${clusterCount}`,
	);
	const isCount = (n) => Number.isSafeInteger(n) && n >= 0;
	if (!isCount(sessionCount) || !isCount(clusterCount)) {
		console.log(
			"header counts are not valid non-negative integers; data is misaligned or corrupt.",
		);
	} else if (hasLocalState === 0) {
		const expected = (4 + sessionCount * 2 + clusterCount * 3) * 8;
		console.log(
			`expected byte length from header (no local state): ${expected}; actual: ${bytes.length}; diff: ${bytes.length - expected}`,
		);
	}
}

try {
	const compressor = deserializeIdCompressor(text, createSessionId(), writeVersion);
	console.log("Deserialization SUCCEEDED.");
	const roundTrip = compressor.serialize(false);
	console.log(
		`re-serialized length: ${roundTrip.length}; identical to input: ${roundTrip === text}`,
	);
} catch (error) {
	console.log("Deserialization FAILED:");
	console.log(error);
	process.exitCode = 1;
}
