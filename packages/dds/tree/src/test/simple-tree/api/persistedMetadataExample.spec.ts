import { createIdCompressor } from "@fluidframework/id-compressor/internal";
import { MockFluidDataStoreRuntime } from "@fluidframework/test-runtime-utils/internal";
import { SchemaFactoryAlpha, TreeViewConfiguration } from "../../../simple-tree/index.js";
import { configuredSharedTree, SharedTree, SharedTreeFormatVersion } from "../../../index.js";
import assert from "node:assert";

const sf = new SchemaFactoryAlpha("sample-for-persisted-metadata");

class Engineer extends sf.objectAlpha(
	"Engineer",
	{
		name: sf.required(sf.string),
		id: sf.identifier,
		skills: sf.required(sf.string, {
			persistedMetadata: {
				"eDiscovery-exclude": "comment",
			},
		}),
		maxCapacity: sf.required(sf.number, {
			persistedMetadata: {
				"eDiscovery-exclude": "exclude",
				"search-exclude": "true",
			},
		}),
	},
	{},
) {}

class EngineerList extends sf.arrayAlpha("EngineerList", Engineer) {}

const containerSchema = {
	initialObjects: {
		appState: configuredSharedTree({ formatVersion: SharedTreeFormatVersion.v5 }),
	},
};

describe("Persisted Metadata Example", () => {
	it("should create a SharedTree with persisted metadata", async () => {
		const engineers = [
			{
				name: "Alice",
				maxCapacity: 15,
				skills: "Senior engineer capable of handling complex tasks. Versed in most languages",
			},
			{
				name: "Bob",
				maxCapacity: 12,
				skills:
					"Mid-level engineer capable of handling medium complexity tasks. Versed in React, Node.JS",
			},
		];

		const factory = SharedTree.getFactory();
		const tree = factory.create(
			new MockFluidDataStoreRuntime({ idCompressor: createIdCompressor() }),
			"tree",
		);
		const view = tree.viewWith(new TreeViewConfiguration({ schema: EngineerList }));
		view.initialize(new EngineerList(engineers));

		assert.equal(view.root[0].name, "Alice");
		assert.equal(view.root[1].name, "Bob");
	});
});
