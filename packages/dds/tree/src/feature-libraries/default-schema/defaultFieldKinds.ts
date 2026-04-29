/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

// Re-export everything from the lite version.
// Consumers that only need field kind identifiers (e.g. simple-tree) will
// get tree-shaken down to just this module, avoiding the heavy CRDT handler imports.
export {
	noChangeHandler,
	optional,
	required,
	sequence,
	identifier,
	type Identifier,
	forbidden,
	type Forbidden,
	fieldKindConfigurations,
	getCodecTreeForModularChangeFormat,
	fieldKinds,
	FieldKinds,
	defaultSchemaPolicy,
} from "./defaultFieldKindsLite.js";

// Import the shared field kind singletons so we can patch them with real handlers.
import { optional, required, sequence } from "./defaultFieldKindsLite.js";

// These imports pull in the full CRDT editing/rebasing stack.
// When this module is tree-shaken away (because only lite exports are used),
// the heavy handler code is eliminated from the bundle.
import {
	optional as optionalWithHandler,
	required as requiredWithHandler,
} from "../optional-field/index.js";
import { sequence as sequenceWithHandler } from "../sequence-field/index.js";

// Patch the real CRDT handlers onto the shared FlexFieldKind instances.
// The readonly modifier is bypassed intentionally: the lite module constructs these with
// a placeholder handler, and this module patches in the real one at import time.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(optional as any).changeHandler = optionalWithHandler.changeHandler;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(required as any).changeHandler = requiredWithHandler.changeHandler;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(sequence as any).changeHandler = sequenceWithHandler.changeHandler;
