<!-- SPDX-License-Identifier: 0BSD -->

<template>
    <div class="flex items-center justify-center min-h-screen p-4">
        <div class="w-full max-w-sm space-y-4">
            <div class="text-center space-y-1">
                <h1 class="text-xl font-semibold text-gray-900 dark:text-gray-100">
                    {{ mode === "register" ? "Create an account" : "Sign in" }}
                </h1>
                <p class="text-sm text-gray-600 dark:text-gray-400">
                    {{
                        mode === "register"
                            ? "You get your own address on the mesh, and your messages stay yours."
                            : "Sign in to reach the mesh through this instance."
                    }}
                </p>
            </div>

            <form class="space-y-3" @submit.prevent="submit">
                <div class="space-y-1">
                    <label class="text-sm text-gray-700 dark:text-gray-300">Username</label>
                    <input
                        v-model="username"
                        type="text"
                        class="input-field"
                        autocomplete="username"
                        autocapitalize="off"
                        spellcheck="false"
                        :disabled="busy"
                    />
                </div>

                <div class="space-y-1">
                    <label class="text-sm text-gray-700 dark:text-gray-300">Password</label>
                    <input
                        v-model="password"
                        type="password"
                        class="input-field"
                        :autocomplete="mode === 'register' ? 'new-password' : 'current-password'"
                        :disabled="busy"
                    />
                    <p v-if="mode === 'register'" class="text-xs text-gray-500 dark:text-gray-400">
                        At least 8 characters. There is no way to recover it, so
                        pick something you will remember.
                    </p>
                </div>

                <p v-if="error" class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>

                <button type="submit" class="btn btn-primary w-full" :disabled="busy">
                    {{ busy ? "Working..." : mode === "register" ? "Create account" : "Sign in" }}
                </button>
            </form>

            <div v-if="registrationOpen" class="text-center">
                <button class="text-sm text-blue-600 dark:text-blue-400" @click="toggleMode">
                    {{
                        mode === "register"
                            ? "I already have an account"
                            : "I need an account"
                    }}
                </button>
            </div>
            <p v-else-if="mode === 'login'" class="text-center text-xs text-gray-500 dark:text-gray-400">
                Sign ups are closed on this instance. Ask whoever runs it for an account.
            </p>
        </div>
    </div>
</template>

<script>
export default {
    name: "AccountsAuthPage",
    data() {
        return {
            mode: "login",
            username: "",
            password: "",
            error: "",
            busy: false,
            registrationOpen: true,
        };
    },
    async mounted() {
        await this.loadStatus();
    },
    methods: {
        async loadStatus() {
            try {
                const response = await window.api.get("/api/v1/multiuser/status");
                const status = response.data || {};
                this.registrationOpen = status.registration_open !== false;
                // Nobody has signed up yet, so the first person through is
                // making the admin account rather than joining.
                if (status.accounts === 0 && this.registrationOpen) {
                    this.mode = "register";
                }
                if (status.signed_in) {
                    this.$router.push("/");
                }
            } catch (e) {
                // A status that cannot be read should not block sign in.
            }
        },
        toggleMode() {
            this.mode = this.mode === "register" ? "login" : "register";
            this.error = "";
        },
        async submit() {
            this.error = "";
            if (!this.username || !this.password) {
                this.error = "Enter a username and a password";
                return;
            }
            this.busy = true;
            const path =
                this.mode === "register"
                    ? "/api/v1/multiuser/register"
                    : "/api/v1/multiuser/login";
            try {
                await window.api.post(path, {
                    username: this.username,
                    password: this.password,
                });
                // A fresh sign in changes which identity the whole app is
                // reading, so reload rather than navigate, to drop any state
                // belonging to whoever was here before.
                window.location.href = "/";
            } catch (e) {
                const detail = e?.response?.data?.error;
                this.error = detail || "That did not work. Try again.";
                this.busy = false;
            }
        },
    },
};
</script>
