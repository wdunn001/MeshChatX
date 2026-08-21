<!-- SPDX-License-Identifier: 0BSD -->

<template>
    <section v-show="visible" class="settings-section break-inside-avoid">
        <header class="settings-section__header">
            <div>
                <div class="settings-section__eyebrow">Naming</div>
                <h2>Human-readable names (rns-resolve)</h2>
                <p>
                    Type a name instead of a destination hash in the NomadNet browser.
                    A 32 character hex hash is always used directly and is never sent to
                    a resolver. Names you pin are remembered locally and answered with no
                    network traffic.
                </p>
            </div>
        </header>
        <div class="settings-section__body space-y-4">
            <div class="flex items-center justify-between">
                <div>
                    <div class="text-sm font-medium text-gray-900 dark:text-gray-100">
                        Enable name resolution
                    </div>
                    <p class="text-xs text-gray-600 dark:text-gray-400">
                        When off, only pinned names and raw hashes are used.
                    </p>
                </div>
                <input
                    type="checkbox"
                    class="toggle"
                    :checked="!!config.rns_resolve_enabled"
                    @change="onEnabledChange"
                />
            </div>

            <div class="space-y-2">
                <div class="text-sm font-medium text-gray-900 dark:text-gray-100">
                    Resolvers
                </div>
                <div v-if="resolverRows.length === 0" class="text-xs text-gray-500 dark:text-gray-400">
                    No resolvers added. Names cannot be looked up until you add one.
                </div>
                <table v-else class="w-full text-xs">
                    <tbody>
                        <tr
                            v-for="(hash, index) in resolverRows"
                            :key="hash"
                            class="border-b border-gray-100 dark:border-gray-700"
                        >
                            <td class="py-1 pr-2 font-mono text-gray-600 dark:text-gray-300">
                                {{ hash }}
                            </td>
                            <td class="py-1 text-right">
                                <button
                                    class="btn btn-secondary btn-xs"
                                    @click="removeResolver(index)"
                                >
                                    Remove
                                </button>
                            </td>
                        </tr>
                    </tbody>
                </table>
                <div class="flex gap-2">
                    <input
                        v-model="newResolver"
                        type="text"
                        class="input-field font-mono flex-1"
                        spellcheck="false"
                        autocapitalize="off"
                        autocomplete="off"
                        placeholder="32 character hex destination hash of a resolver"
                        @keyup.enter="addResolver"
                    />
                    <button class="btn btn-primary btn-xs" @click="addResolver">Add</button>
                </div>
                <p v-if="resolverError" class="text-xs text-red-600 dark:text-red-400">
                    {{ resolverError }}
                </p>
                <p class="text-xs text-gray-600 dark:text-gray-400">
                    A resolver is only consulted when a typed name is not already pinned.
                    An answer is one resolver's view of a name, not proof. With more than
                    one added, the first two are asked and their answers compared, and a
                    name they disagree about is reported instead of being resolved.
                </p>
            </div>

            <div class="space-y-2">
                <div class="flex items-center justify-between">
                    <div class="text-sm font-medium text-gray-900 dark:text-gray-100">
                        Pinned names
                    </div>
                    <button class="btn btn-secondary btn-xs" @click="loadPins">Refresh</button>
                </div>
                <div v-if="pinRows.length === 0" class="text-xs text-gray-500 dark:text-gray-400">
                    No names pinned yet. Browsing a name and choosing a result pins it here.
                </div>
                <table v-else class="w-full text-xs">
                    <tbody>
                        <tr
                            v-for="row in pinRows"
                            :key="row.name"
                            class="border-b border-gray-100 dark:border-gray-700"
                        >
                            <td class="py-1 pr-2 font-medium">{{ row.name }}</td>
                            <td class="py-1 font-mono text-gray-500 dark:text-gray-400">
                                {{ row.hash }}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </section>
</template>

<script>
export default {
    name: "NamingSettingsSection",
    props: {
        visible: {
            type: Boolean,
            default: true,
        },
        config: {
            type: Object,
            required: true,
        },
    },
    emits: ["update-field"],
    data() {
        return {
            pins: {},
            newResolver: "",
            resolverError: "",
        };
    },
    computed: {
        resolverRows() {
            return this.parseResolvers(this.config.rns_resolve_resolver_destination_hashes);
        },
        pinRows() {
            return Object.keys(this.pins || {})
                .sort()
                .map((name) => {
                    return { name, hash: (this.pins[name] || {}).hash || "" };
                });
        },
    },
    mounted() {
        this.loadPins();
    },
    methods: {
        onEnabledChange(event) {
            this.$emit("update-field", {
                key: "rns_resolve_enabled",
                value: !!event.target.checked,
            });
        },
        parseResolvers(text) {
            const seen = [];
            for (const part of String(text || "").split(/[\s,]+/)) {
                const hash = part.trim().toLowerCase();
                if (/^[0-9a-f]{32}$/.test(hash) && !seen.includes(hash)) {
                    seen.push(hash);
                }
            }
            return seen;
        },
        saveResolvers(list) {
            this.$emit("update-field", {
                key: "rns_resolve_resolver_destination_hashes",
                value: list.length ? list.join("\n") : null,
            });
        },
        addResolver() {
            const hash = (this.newResolver || "").trim().toLowerCase();
            if (!/^[0-9a-f]{32}$/.test(hash)) {
                this.resolverError = "A resolver hash is 32 hexadecimal characters.";
                return;
            }
            const list = this.resolverRows.slice();
            if (list.includes(hash)) {
                this.resolverError = "That resolver is already in the list.";
                return;
            }
            list.push(hash);
            this.saveResolvers(list);
            this.newResolver = "";
            this.resolverError = "";
        },
        removeResolver(index) {
            const list = this.resolverRows.slice();
            list.splice(index, 1);
            this.saveResolvers(list);
            this.resolverError = "";
        },
        async loadPins() {
            try {
                const api = window.api;
                if (!api) {
                    return;
                }
                const response = await api.get("/api/v1/resolve/pins");
                this.pins = (response.data && response.data.pins) || {};
            } catch (e) {
                this.pins = {};
            }
        },
    },
};
</script>
