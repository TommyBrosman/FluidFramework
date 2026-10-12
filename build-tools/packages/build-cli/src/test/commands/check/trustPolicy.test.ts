/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { assert } from "chai";
import { afterEach, beforeEach, describe, it } from "mocha";
import pacote from "pacote";

import { enrichViolations, type TrustViolation } from "../../../commands/check/trustPolicy.js";

type Evidence = NonNullable<TrustViolation["evidence"]>;
type FixturePackument = pacote.Packument &
	pacote.AbbreviatedPackument &
	pacote.PackumentResult;

function makePackument(
	entries: [version: string, publishedAt: string, evidence: Evidence][],
): FixturePackument {
	const versions: FixturePackument["versions"] = {};
	const time: pacote.Packument["time"] = {
		created: "2026-01-01T00:00:00Z",
		modified: "2026-01-10T00:00:00Z",
	};
	for (const [version, publishedAt, evidence] of entries) {
		versions[version] = {
			name: "test-package",
			version,
			deprecated: undefined,
			_id: `test-package@${version}`,
			_nodeVersion: "22.22.2",
			_npmVersion: "10.9.0",
			maintainers: [],
			_npmUser: {
				name: "test-publisher",
				...(evidence === "trustedPublisher" ? { trustedPublisher: {} } : {}),
			},
			dist: {
				tarball: `https://registry.example/test-package-${version}.tgz`,
				...(evidence === "provenance" ? { attestations: { provenance: {} } } : {}),
			},
		};
		time[version] = publishedAt;
	}
	return {
		_contentLength: 0,
		name: "test-package",
		maintainers: [],
		"dist-tags": { latest: "1.0.0" },
		versions,
		time,
	};
}

describe("trustPolicy enrichment", () => {
	const originalPackument = pacote.packument;
	const originalFetch = globalThis.fetch;
	let packument: FixturePackument;
	let violation: TrustViolation;

	beforeEach(() => {
		packument = makePackument([["1.0.0", "2026-01-10T00:00:00Z", "none"]]);
		violation = { name: "test-package", version: "1.0.0" };
		pacote.packument = async () => packument;
		// The tests exercise registry evidence selection, not Sigstore verification.
		globalThis.fetch = async () => new Response(null, { status: 404 });
	});

	afterEach(() => {
		pacote.packument = originalPackument;
		globalThis.fetch = originalFetch;
	});

	it("selects the strongest earlier evidence and the latest publish at that strength", async () => {
		packument = makePackument([
			["1.0.0", "2026-01-10T00:00:00Z", "none"],
			["2.0.0", "2026-01-09T00:00:00Z", "provenance"],
			["3.0.0", "2026-01-07T00:00:00Z", "trustedPublisher"],
			["4.0.0", "2026-01-08T00:00:00Z", "trustedPublisher"],
			["5.0.0", "2026-01-06T00:00:00Z", "trustedPublisher"],
		]);

		await enrichViolations([violation], process.cwd(), () => {});

		assert.deepEqual(violation.priorTrusted, {
			version: "4.0.0",
			publishedAt: "2026-01-08T00:00:00Z",
			publisher: "test-publisher",
			evidence: "trustedPublisher",
		});
	});

	it("does not report prior evidence equal to or weaker than the offender's", async () => {
		packument = makePackument([
			["1.0.0", "2026-01-10T00:00:00Z", "provenance"],
			["2.0.0", "2026-01-09T00:00:00Z", "provenance"],
			["3.0.0", "2026-01-08T00:00:00Z", "none"],
		]);

		await enrichViolations([violation], process.cwd(), () => {});

		assert.isUndefined(violation.priorTrusted);
		assert.equal(violation.evidence, "provenance");
	});

	it("reports a trusted publisher when the offender already has provenance", async () => {
		packument = makePackument([
			["1.0.0", "2026-01-10T00:00:00Z", "provenance"],
			["2.0.0", "2026-01-09T00:00:00Z", "trustedPublisher"],
		]);

		await enrichViolations([violation], process.cwd(), () => {});

		assert.equal(violation.priorTrusted?.version, "2.0.0");
		assert.equal(violation.priorTrusted?.evidence, "trustedPublisher");
	});

	it("rejects an invalid offender timestamp and continues enriching other violations", async () => {
		packument = makePackument([
			["1.0.0", "not-a-date", "none"],
			["2.0.0", "2026-01-08T00:00:00Z", "trustedPublisher"],
			["3.0.0", "2026-01-10T00:00:00Z", "none"],
		]);
		const next: TrustViolation = { name: "test-package", version: "3.0.0" };

		await enrichViolations([violation, next], process.cwd(), () => {});

		assert.include(violation.enrichmentError, "invalid publish timestamp");
		assert.isUndefined(violation.priorTrusted);
		assert.equal(next.priorTrusted?.version, "2.0.0");
		assert.isUndefined(next.enrichmentError);
	});

	it("ignores invalid, simultaneous, later, and prerelease candidate timestamps for stable offenders", async () => {
		packument = makePackument([
			["1.0.0", "2026-01-10T00:00:00Z", "none"],
			["2.0.0", "not-a-date", "trustedPublisher"],
			["3.0.0", "2026-01-10T00:00:00Z", "trustedPublisher"],
			["4.0.0", "2026-01-11T00:00:00Z", "trustedPublisher"],
			["5.0.0-beta.1", "2026-01-09T00:00:00Z", "trustedPublisher"],
			["6.0.0", "2026-01-08T00:00:00Z", "provenance"],
		]);

		await enrichViolations([violation], process.cwd(), () => {});

		assert.equal(violation.priorTrusted?.version, "6.0.0");
	});

	it("considers prior prereleases when the offender is a prerelease", async () => {
		packument = makePackument([
			["1.0.0-beta.2", "2026-01-10T00:00:00Z", "none"],
			["1.0.0-beta.1", "2026-01-09T00:00:00Z", "trustedPublisher"],
		]);
		violation.version = "1.0.0-beta.2";

		await enrichViolations([violation], process.cwd(), () => {});

		assert.equal(violation.priorTrusted?.version, "1.0.0-beta.1");
	});
});
