<!-- SPDX-License-Identifier: 0BSD -->

<template>
    <div class="flex items-center justify-center min-h-screen p-4">
        <div class="w-full max-w-lg space-y-4">
            <div class="space-y-1">
                <h1 class="text-xl font-semibold text-gray-900 dark:text-gray-100">Who uses this instance?</h1>
                <p class="text-sm text-gray-600 dark:text-gray-400">
                    Asked once. It decides whether anyone signs in, and how.
                </p>
            </div>

            <div class="space-y-2">
                <label
                    v-for="option in options"
                    :key="option.id"
                    class="flex gap-3 p-3 rounded border cursor-pointer"
                    :class="
                        chosen === option.id
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                            : 'border-gray-200 dark:border-gray-700'
                    "
                >
                    <input v-model="chosen" type="radio" :value="option.id" class="mt-1" />
                    <div>
                        <div class="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {{ option.title }}
                        </div>
                        <p class="text-xs text-gray-600 dark:text-gray-400">
                            {{ option.description }}
                        </p>
                    </div>
                </label>
            </div>

            <p v-if="error" class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>

            <div
                v-if="restartRequired"
                class="p-3 rounded border border-amber-300 bg-amber-50 dark:bg-amber-900/20 space-y-1"
            >
                <div class="text-sm font-medium text-gray-900 dark:text-gray-100">
                    Saved. Restart this instance to finish.
                </div>
                <p class="text-xs text-gray-600 dark:text-gray-400">
                    Accounts change how every request is handled, and that is built when the app starts, so it has to
                    come back before anyone can sign up. Once it is running again, the first person to sign up becomes
                    the admin.
                </p>
            </div>

            <button v-else class="btn btn-primary w-full" :disabled="!chosen || busy" @click="save">
                {{ busy ? "Saving..." : "Continue" }}
            </button>
        </div>
    </div>
</template>

<script>
const ALL_OPTIONS = [
    {
        id: "open",
        title: "Just me, no sign in",
        description: "Anyone who can reach this page can use it. Right for a machine only you touch.",
    },
    {
        id: "single",
        title: "Just me, with a password",
        description: "One password protects the whole app. Right when it is reachable from elsewhere on your network.",
    },
    {
        id: "accounts",
        title: "Several people, an account each",
        description:
            "Everyone signs up and gets their own address, messages and contacts. Right for an instance other people connect to.",
    },
];

export default {
    name: "SetupModePage",
    data() {
        return {
            chosen: "",
            available: ["open", "single"],
            error: "",
            busy: false,
            restartRequired: false,
        };
    },
    computed: {
        options() {
            return ALL_OPTIONS.filter((o) => this.available.includes(o.id));
        },
    },
    async mounted() {
        try {
            const response = await window.api.get("/api/v1/auth/status");
            const status = response.data || {};
            if (Array.isArray(status.auth_modes_available)) {
                this.available = status.auth_modes_available;
            }
            // Already answered, so there is nothing to ask.
            if (status.auth_mode) {
                this.$router.push("/");
            }
        } catch (e) {
            // Fall back to the two modes every build supports.
        }
    },
    methods: {
        async save() {
            this.error = "";
            this.busy = true;
            try {
                const response = await window.api.post("/api/v1/auth/mode", {
                    mode: this.chosen,
                });
                // Accounts change how every request resolves, and the parts
                // that do it are only built at startup, so the instance has to
                // come back before anyone can sign up.
                if (response?.data?.restart_required) {
                    this.restartRequired = true;
                    this.busy = false;
                    return;
                }
                window.location.href = "/";
            } catch (e) {
                const detail = e?.response?.data?.error;
                this.error = detail || "That could not be saved.";
                this.busy = false;
            }
        },
    },
};
</script>
