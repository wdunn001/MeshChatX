<!-- SPDX-License-Identifier: 0BSD -->

<template>
    <div class="h-dvh min-h-0 w-full flex flex-col bg-slate-50 dark:bg-zinc-950">
        <div
            v-if="demoMode"
            class="relative z-100 shrink-0 bg-amber-600 text-white px-4 py-2 text-center text-sm font-medium shadow-md border-b border-amber-700/80"
            role="status"
        >
            {{ $t("app.demo_mode_active") }}
        </div>

        <div class="flex-1 min-h-0 flex items-center justify-center">
            <div class="w-full max-w-md p-8">
                <div
                    class="bg-white dark:bg-zinc-900 rounded-2xl shadow-lg border border-gray-200 dark:border-zinc-800 p-8"
                >
                    <div class="text-center mb-8">
                        <div
                            class="w-16 h-16 mx-auto mb-4 rounded-2xl overflow-hidden bg-white/70 dark:bg-white/10 border border-gray-200 dark:border-zinc-700 shadow-inner flex items-center justify-center"
                        >
                            <img class="w-16 h-16 object-contain p-2" :src="logoUrl" alt="" />
                        </div>
                        <h1 class="text-2xl font-bold text-gray-900 dark:text-zinc-100 mb-2">
                            {{ isSetup ? $t("auth.setup_title") : $t("auth.login_title") }}
                        </h1>
                        <p class="text-sm text-gray-600 dark:text-zinc-400">
                            {{ isSetup ? $t("auth.setup_subtitle") : $t("auth.login_subtitle") }}
                        </p>
                        <p
                            v-if="authPageHint"
                            class="mt-3 text-xs text-gray-600 dark:text-zinc-400 whitespace-pre-line"
                        >
                            {{ authPageHint }}
                        </p>
                    </div>

                    <form class="space-y-6" @submit.prevent="handleSubmit">
                        <div>
                            <label
                                for="password"
                                class="block text-sm font-medium text-gray-700 dark:text-zinc-300 mb-2"
                            >
                                {{ $t("auth.password_label") }}
                            </label>
                            <input
                                id="password"
                                v-model="password"
                                type="password"
                                required
                                :minlength="isSetup ? 8 : 1"
                                class="w-full px-4 py-2 border border-gray-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                :placeholder="$t('auth.password_placeholder')"
                                autocomplete="current-password"
                            />
                            <p v-if="isSetup" class="mt-2 text-xs text-gray-500 dark:text-zinc-500">
                                {{ $t("auth.password_min_length") }}
                            </p>
                        </div>

                        <div v-if="isSetup">
                            <label
                                for="confirmPassword"
                                class="block text-sm font-medium text-gray-700 dark:text-zinc-300 mb-2"
                            >
                                {{ $t("auth.confirm_password_label") }}
                            </label>
                            <input
                                id="confirmPassword"
                                v-model="confirmPassword"
                                type="password"
                                required
                                minlength="8"
                                class="w-full px-4 py-2 border border-gray-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                :placeholder="$t('auth.confirm_password_placeholder')"
                                autocomplete="new-password"
                            />
                        </div>

                        <div v-if="stampAuthEnabled && solving" class="min-h-[52px] space-y-1">
                            <div class="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-zinc-700">
                                <div class="h-full w-1/3 animate-pulse rounded-full bg-blue-500"></div>
                            </div>
                            <p class="text-xs text-gray-500 dark:text-zinc-400" role="status">
                                {{ $t("auth.stamp_solving") }}
                                {{ $t("auth.stamp_progress", solveProgressParams) }}
                            </p>
                        </div>

                        <div
                            v-if="error"
                            class="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg"
                        >
                            <p class="text-sm text-red-800 dark:text-red-200">{{ error }}</p>
                        </div>

                        <button
                            type="submit"
                            :disabled="isLoading || (isSetup && password !== confirmPassword)"
                            class="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors"
                        >
                            <span v-if="isLoading">{{ $t("auth.processing") }}</span>
                            <span v-else>{{ isSetup ? $t("auth.set_password") : $t("auth.login") }}</span>
                        </button>
                    </form>
                </div>
            </div>
        </div>
    </div>
</template>

<script>
import logoUrl from "../../assets/images/logo.png";
import { solveStampChallenge } from "../../js/stampChallenge.js";

export default {
    name: "AuthPage",
    data() {
        return {
            logoUrl,
            password: "",
            confirmPassword: "",
            error: "",
            isLoading: false,
            isSetup: false,
            stampAuthEnabled: false,
            solving: false,
            solveProgress: { attempts: 0, elapsedMs: 0 },
            demoMode: false,
            authPageHint: "",
        };
    },
    computed: {
        solveProgressParams() {
            return {
                attempts: String(this.solveProgress.attempts),
                seconds: (this.solveProgress.elapsedMs / 1000).toFixed(1),
            };
        },
    },
    async mounted() {
        await this.checkAuthStatus();
    },
    methods: {
        async checkAuthStatus() {
            try {
                const response = await window.api.get("/api/v1/auth/status");
                const status = response.data;

                if (!status.auth_enabled) {
                    this.$router.push("/");
                    return;
                }

                if (status.authenticated) {
                    this.$router.push("/");
                    return;
                }

                this.isSetup = !status.password_set;
                this.stampAuthEnabled = status.stamp_auth_enabled === true;
                this.demoMode = status.demo_mode === true;
                const hint = status.auth_page_hint;
                this.authPageHint = typeof hint === "string" ? hint : "";
            } catch (e) {
                console.error("Failed to check auth status:", e);
                this.error = this.$t("auth.status_check_failed");
            }
        },
        // Fetches a fresh challenge and solves it client side (in wasm),
        // reporting real progress rather than a spinner, since solving can
        // visibly take a few seconds on a phone. Returns the stamp_proof
        // body field, or null with this.error already set.
        async solveStamp() {
            this.solving = true;
            this.solveProgress = { attempts: 0, elapsedMs: 0 };
            try {
                return await solveStampChallenge("/api/v1/auth/stamp/challenge", (progress) => {
                    this.solveProgress = progress;
                });
            } catch (e) {
                this.error = this.$t("auth.stamp_unavailable");
                return null;
            } finally {
                this.solving = false;
            }
        },
        async handleSubmit() {
            this.error = "";

            if (this.isSetup) {
                if (this.password !== this.confirmPassword) {
                    this.error = this.$t("auth.passwords_mismatch");
                    return;
                }

                if (this.password.length < 8) {
                    this.error = this.$t("auth.password_min_length");
                    return;
                }
            }

            this.isLoading = true;

            try {
                const endpoint = this.isSetup ? "/api/v1/auth/setup" : "/api/v1/auth/login";
                const body = { password: this.password };
                if (this.stampAuthEnabled) {
                    const stampProof = await this.solveStamp();
                    if (!stampProof) {
                        if (!this.error) {
                            this.error = this.$t("auth.stamp_required");
                        }
                        this.isLoading = false;
                        return;
                    }
                    body.stamp_proof = stampProof;
                }
                await window.api.post(endpoint, body);

                window.location.reload();
            } catch (e) {
                this.error = e.response?.data?.error || this.$t("auth.failed");
                this.password = "";
                this.confirmPassword = "";
            } finally {
                this.isLoading = false;
            }
        },
    },
};
</script>
