<!-- SPDX-License-Identifier: 0BSD -->

<template>
    <div
        v-if="visible"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        data-testid="hosted-welcome-card"
    >
        <div
            class="w-full max-w-md space-y-5 rounded-2xl bg-white p-5 shadow-xl dark:bg-zinc-900"
            role="dialog"
            aria-modal="true"
            :aria-label="$t('hosted_welcome.title')"
        >
            <h2 class="text-lg font-semibold text-gray-900 dark:text-zinc-100">
                {{ $t("hosted_welcome.title") }}
            </h2>

            <div class="space-y-1">
                <div class="text-xs text-gray-500 dark:text-zinc-400">
                    {{ $t("hosted_welcome.address_label") }}
                </div>
                <button
                    type="button"
                    class="block w-full truncate rounded-lg bg-gray-100 px-3 py-2 text-left font-mono text-xs text-gray-800 hover:text-blue-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:text-blue-400"
                    :title="address"
                    data-testid="hosted-welcome-address"
                    @click="$emit('copy-address', address)"
                >
                    {{ address }}
                </button>
                <p class="text-sm text-gray-600 dark:text-zinc-400">
                    {{ $t("hosted_welcome.address_body") }}
                </p>
            </div>

            <div class="space-y-1">
                <div class="text-xs text-gray-500 dark:text-zinc-400">
                    {{ $t("hosted_welcome.name_label") }}
                </div>
                <div class="truncate text-sm font-semibold text-gray-900 dark:text-zinc-100" :title="displayName">
                    {{ displayName }}
                </div>
                <p class="text-sm text-gray-600 dark:text-zinc-400">
                    {{ $t("hosted_welcome.name_body") }}
                </p>
            </div>

            <p class="text-sm text-gray-600 dark:text-zinc-400">
                {{ $t("hosted_welcome.find_body") }}
            </p>

            <div class="flex flex-wrap gap-2">
                <button
                    type="button"
                    class="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                    data-testid="hosted-welcome-copy"
                    @click="$emit('copy-address', address)"
                >
                    {{ $t("hosted_welcome.copy_address") }}
                </button>
                <button
                    type="button"
                    class="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    @click="$emit('show-qr')"
                >
                    {{ $t("hosted_welcome.show_qr") }}
                </button>
                <button
                    type="button"
                    class="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    data-testid="hosted-welcome-announces"
                    @click="openAnnounces"
                >
                    {{ $t("hosted_welcome.open_announces") }}
                </button>
                <button
                    type="button"
                    class="ml-auto rounded-lg px-3 py-2 text-sm font-semibold text-gray-500 hover:text-gray-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                    data-testid="hosted-welcome-close"
                    @click="close"
                >
                    {{ $t("hosted_welcome.close") }}
                </button>
            </div>
        </div>
    </div>
</template>

<script>
/**
 * What a person sees the first time they sign in to a hosted instance.
 *
 * It replaces the eight step desktop tour, which is written for somebody who
 * installed the application and now operates it. A hosted visitor operates
 * nothing: the interfaces, the bootstrap, the propagation mode and the
 * privacy hop count all belong to the machine and are shared with everyone
 * else signed in. Offering those steps here asks a stranger on a phone to
 * change the network for the whole instance, and the identity step would
 * orphan the identity their account was just bound to.
 *
 * So this states three facts and offers one action. The address, because it
 * is the only thing they cannot guess and the only thing that makes them
 * reachable. The name, because it answers the question the address raises.
 * One way to find somebody, because without it the address is inert.
 *
 * The acknowledgement is stored per identity on the server, not in
 * localStorage, so a shared browser does not carry one account's dismissal
 * onto the next person who signs in.
 *
 * Designed in docs/hosted-onboarding-journey.md, section 6.
 */
export default {
    name: "HostedWelcomeCard",
    props: {
        address: {
            type: String,
            default: "",
        },
        displayName: {
            type: String,
            default: "",
        },
    },
    emits: ["copy-address", "show-qr", "seen"],
    data() {
        return {
            visible: false,
        };
    },
    methods: {
        show() {
            this.visible = true;
        },
        close() {
            this.visible = false;
            this.$emit("seen");
        },
        openAnnounces() {
            this.close();
            this.$router.push({ name: "contacts" });
        },
    },
};
</script>
