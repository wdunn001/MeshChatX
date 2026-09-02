// SPDX-License-Identifier: 0BSD

import { solveStamp } from "./StampSolver.js";

/**
 * Fetches a stamp challenge and solves it, reporting progress along the
 * way. Shared by AuthPage.vue (single-user setup/login) and
 * AccountsAuthPage.vue (multi-user sign up/sign in), which both gate on
 * the same server-side stamp_auth module and only differ in which
 * endpoint issues the challenge.
 *
 * Returns the object to send back as `stamp_proof` in the request body:
 * the untouched challenge fields plus the solved `stamp`.
 */
export async function solveStampChallenge(challengeUrl, onProgress) {
    const response = await window.api.get(challengeUrl);
    const challenge = response.data;
    const stamp = await solveStamp(challenge, onProgress);
    return { ...challenge, stamp };
}
