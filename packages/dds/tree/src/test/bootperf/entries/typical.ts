/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

/**
 * Typical import scenario: a consumer uses SchemaFactory + TreeViewConfiguration + SharedTree.
 *
 * Imports are used in a minimal but realistic way to prevent tree-shaking from eliminating
 * the dependency. This represents the minimum viable import for a SharedTree-based application.
 */
import { SchemaFactory, TreeViewConfiguration } from "../../../index.js";

export { Tree } from "../../../index.js";
export type { TreeView } from "../../../index.js";

const sf = new SchemaFactory("loadtime-bench");

class TestNode extends sf.object("TestNode", {
	name: sf.string,
	value: sf.number,
}) {}

const config = new TreeViewConfiguration({ schema: TestNode });

// Export all artifacts so webpack cannot eliminate them.
export { sf, TestNode, config };
