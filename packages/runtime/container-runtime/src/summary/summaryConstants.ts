/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

/**
 * The maximum amount of time that the summarizer will wait for pending ops to be acked before
 * generating a summary while the container is dirty.
 */
export const defaultPendingOpsWaitTimeoutMs = 1000;

/**
 * The retry delay (in milliseconds) applied when a summary attempt is failed because there are
 * pending ops that have not yet been acked.
 */
export const defaultPendingOpsRetryDelayMs = 1000;
