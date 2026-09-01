<!-- SPDX-License-Identifier: 0BSD -->

<template>
    <div v-if="hosted" class="p-2 space-y-2" data-testid="hosted-account-row">
        <div class="text-xs">
            <div class="text-gray-500 dark:text-zinc-400">{{ $t("accounts.signed_in_as") }}</div>
            <div class="mt-0.5 truncate font-semibold text-gray-700 dark:text-zinc-200" :title="username">
                {{ username }}
            </div>
        </div>
        <button
            type="button"
            class="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-100 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
            data-testid="sidebar-sign-out"
            :disabled="busy"
            @click="signOut"
        >
            <MaterialDesignIcon icon-name="logout" class="size-4" />
            {{ busy ? $t("accounts.signing_out") : $t("accounts.sign_out") }}
        </button>
    </div>
</template>

<script>
/**
 * Sign out, on an instance where people sign in as themselves.
 *
 * A hosted terminal is often a borrowed machine, so leaving it has to be one
 * button and it has to actually clear the session. The reload is the point:
 * the whole shell was built around one identity's data, and navigating alone
 * would leave that data on screen for whoever sits down next.
 *
 * Renders nothing outside accounts mode, where there is no session to end.
 */
import GlobalState from "../../js/GlobalState.js";
import MaterialDesignIcon from "../MaterialDesignIcon.vue";
import ToastUtils from "../../js/ToastUtils.js";
import { isHostedInstance } from "../../js/accountRole.js";

export default {
    name: "HostedAccountRow",
    components: {
        MaterialDesignIcon,
    },
    data() {
        return {
            busy: false,
        };
    },
    computed: {
        hosted() {
            return isHostedInstance(GlobalState);
        },
        username() {
            return GlobalState.accountUsername || "";
        },
    },
    methods: {
        async signOut() {
            if (this.busy) {
                return;
            }
            this.busy = true;
            try {
                await window.api.post("/api/v1/multiuser/logout", {});
            } catch (e) {
                // The session is cleared server side or it is not. Either way
                // the reload below sends this browser back through the entry
                // gate, which is what the person asked for.
                console.log("Sign out request failed:", e);
                ToastUtils.error(this.$t("accounts.sign_out_failed"));
            }
            window.location.href = "/";
        },
    },
};
</script>
