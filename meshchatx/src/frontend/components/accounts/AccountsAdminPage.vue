<!-- SPDX-License-Identifier: 0BSD -->

<template>
    <div class="p-4 space-y-6">
        <div class="space-y-1">
            <h1 class="text-xl font-semibold text-gray-900 dark:text-zinc-100">
                {{ $t("accounts_admin.title") }}
            </h1>
            <p class="text-sm text-gray-600 dark:text-zinc-400">
                {{ $t("accounts_admin.description") }}
            </p>
        </div>

        <div class="rounded-xl border border-gray-200 p-3 dark:border-zinc-800">
            <div class="text-sm font-semibold text-gray-900 dark:text-zinc-100">
                {{ $t("accounts_admin.registration_title") }}
            </div>
            <label class="mt-2 flex items-center gap-2 text-sm text-gray-700 dark:text-zinc-300">
                <input
                    type="checkbox"
                    data-testid="accounts-admin-registration"
                    :checked="registrationOpen"
                    :disabled="busy"
                    @change="setRegistrationOpen($event.target.checked)"
                />
                {{ $t("accounts_admin.registration_toggle") }}
            </label>
            <p class="mt-1 text-xs text-gray-500 dark:text-zinc-400">
                {{
                    registrationOpen
                        ? $t("accounts_admin.registration_open_help")
                        : $t("accounts_admin.registration_closed_help")
                }}
            </p>
        </div>

        <p class="text-xs text-gray-500 dark:text-zinc-400">{{ $t("accounts_admin.role_help") }}</p>

        <div v-if="accounts.length === 0" class="text-sm text-gray-500 dark:text-zinc-400">
            {{ $t("accounts_admin.empty") }}
        </div>

        <div v-else class="overflow-x-auto">
            <table class="w-full text-left text-sm">
                <thead class="text-xs uppercase text-gray-500 dark:text-zinc-400">
                    <tr>
                        <th class="py-2 pr-3">{{ $t("accounts_admin.username") }}</th>
                        <th class="py-2 pr-3">{{ $t("accounts_admin.role") }}</th>
                        <th class="py-2 pr-3">{{ $t("accounts_admin.status") }}</th>
                        <th class="py-2 pr-3">{{ $t("accounts_admin.last_login") }}</th>
                        <th class="py-2 pr-3">{{ $t("accounts_admin.identity") }}</th>
                        <th class="py-2"></th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-200 dark:divide-zinc-800">
                    <tr v-for="account in accounts" :key="account.id" :data-testid="`account-row-${account.username}`">
                        <td class="py-2 pr-3 font-semibold text-gray-900 dark:text-zinc-100">
                            {{ account.username }}
                            <span v-if="isMe(account)" class="ml-1 text-xs font-normal text-gray-500">
                                ({{ $t("accounts_admin.you") }})
                            </span>
                        </td>
                        <td class="py-2 pr-3">
                            <select
                                class="rounded-lg border border-gray-300 bg-gray-50 p-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
                                :value="account.role"
                                :disabled="busy"
                                @change="setRole(account, $event.target.value)"
                            >
                                <option value="user">{{ $t("accounts_admin.role_user") }}</option>
                                <option value="contributor">{{ $t("accounts_admin.role_contributor") }}</option>
                                <option value="admin">{{ $t("accounts_admin.role_admin") }}</option>
                            </select>
                        </td>
                        <td class="py-2 pr-3">
                            <label class="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    :checked="account.enabled"
                                    :disabled="busy"
                                    @change="setEnabled(account, $event.target.checked)"
                                />
                                <span class="text-xs text-gray-600 dark:text-zinc-400">
                                    {{ account.enabled ? $t("accounts_admin.enabled") : $t("accounts_admin.disabled") }}
                                </span>
                            </label>
                        </td>
                        <td class="py-2 pr-3 text-xs text-gray-600 dark:text-zinc-400">
                            {{ lastLoginLabel(account) }}
                        </td>
                        <td class="py-2 pr-3 font-mono text-[11px] text-gray-500 dark:text-zinc-500">
                            {{ account.identity_hash }}
                        </td>
                        <td class="py-2">
                            <button
                                v-if="!isMe(account)"
                                type="button"
                                class="rounded-lg border border-gray-300 px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 dark:border-zinc-600 dark:text-red-400 dark:hover:bg-zinc-800"
                                :disabled="busy"
                                @click="remove(account)"
                            >
                                {{ $t("accounts_admin.remove") }}
                            </button>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>

<script>
/**
 * Who may sign in to this instance, for the person who runs it.
 *
 * The account routes existed before this page did, so an operator's only way
 * to change somebody's role or close sign ups was to call the API by hand or
 * edit app_security.json and restart.
 *
 * Two refusals come back from the server rather than being predicted here,
 * because the server is the only place that can count: the last admin cannot
 * be demoted, disabled, or removed, and an account cannot remove itself. The
 * self case is also hidden below, since the person reading this page has a
 * sign out button in the sidebar and does not need a button that deletes them.
 *
 * Removing an account leaves its identity and its messages on disk. Deleting
 * somebody's keys because their account was closed destroys conversations
 * other people are still part of, and it cannot be undone.
 */
import GlobalState from "../../js/GlobalState.js";
import ToastUtils from "../../js/ToastUtils.js";
import DialogUtils from "../../js/DialogUtils.js";

export default {
    name: "AccountsAdminPage",
    data() {
        return {
            accounts: [],
            registrationOpen: true,
            busy: false,
        };
    },
    mounted() {
        this.load();
    },
    methods: {
        isMe(account) {
            return account.username === GlobalState.accountUsername;
        },
        lastLoginLabel(account) {
            if (!account.last_login_at) {
                return this.$t("accounts_admin.never");
            }
            return new Date(account.last_login_at * 1000).toLocaleString();
        },
        async load() {
            try {
                const [accountsResponse, registrationResponse] = await Promise.all([
                    window.api.get("/api/v1/multiuser/accounts"),
                    window.api.get("/api/v1/multiuser/registration"),
                ]);
                this.accounts = accountsResponse.data?.accounts || [];
                this.registrationOpen = registrationResponse.data?.registration_open !== false;
            } catch (e) {
                console.log("Failed to load accounts:", e);
                ToastUtils.error(this.$t("accounts_admin.load_failed"));
            }
        },
        async patchAccount(account, body) {
            this.busy = true;
            try {
                await window.api.patch(`/api/v1/multiuser/accounts/${account.id}`, body);
                ToastUtils.success(this.$t("accounts_admin.updated"));
            } catch (e) {
                const detail = e?.response?.data?.error;
                ToastUtils.error(detail || this.$t("accounts_admin.update_failed"));
            } finally {
                this.busy = false;
                await this.load();
            }
        },
        setRole(account, role) {
            return this.patchAccount(account, { role });
        },
        setEnabled(account, enabled) {
            return this.patchAccount(account, { enabled });
        },
        async setRegistrationOpen(wanted) {
            this.busy = true;
            try {
                await window.api.patch("/api/v1/multiuser/registration", { registration_open: wanted });
                this.registrationOpen = wanted;
                ToastUtils.success(this.$t("accounts_admin.updated"));
            } catch (e) {
                const detail = e?.response?.data?.error;
                ToastUtils.error(detail || this.$t("accounts_admin.update_failed"));
            } finally {
                this.busy = false;
                await this.load();
            }
        },
        async remove(account) {
            const confirmed = await DialogUtils.confirm(
                this.$t("accounts_admin.remove_confirm", { username: account.username })
            );
            if (!confirmed) {
                return;
            }
            this.busy = true;
            try {
                await window.api.delete(`/api/v1/multiuser/accounts/${account.id}`);
                ToastUtils.success(this.$t("accounts_admin.removed"));
            } catch (e) {
                const detail = e?.response?.data?.error;
                ToastUtils.error(detail || this.$t("accounts_admin.update_failed"));
            } finally {
                this.busy = false;
                await this.load();
            }
        },
    },
};
</script>
