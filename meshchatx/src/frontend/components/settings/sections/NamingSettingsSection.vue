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
                <input
                    type="text"
                    class="input-field font-mono"
                    spellcheck="false"
                    autocapitalize="off"
                    autocomplete="off"
                    placeholder="32 character hex destination hash of a resolver"
                    :value="resolvers[0] || ''"
                    @change="(e) => setResolver(0, e.target.value)"
                />
                <input
                    type="text"
                    class="input-field font-mono"
                    spellcheck="false"
                    autocapitalize="off"
                    autocomplete="off"
                    placeholder="A second resolver, used as a fallback (optional)"
                    :value="resolvers[1] || ''"
                    @change="(e) => setResolver(1, e.target.value)"
                />
                <p class="text-xs text-gray-600 dark:text-gray-400">
                    A resolver is only consulted when a typed name is not already pinned.
                    The first is asked, and the second is a fallback used only when the
                    first cannot be reached or does not know the name. Every record is
                    checked against the identity that registered it.
                </p>
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
        };
    },
    computed: {
        resolvers() {
            return this.parseResolvers(this.config.rns_resolve_resolver_destination_hashes);
        },
    },
    methods: {
        onEnabledChange(event) {
            this.$emit("update-field", {
                key: "rns_resolve_enabled",
                value: !!event.target.checked,
            });
        },
        setResolver(index, value) {
            // Two slots, so a slot is set or cleared. Anything that is not a
            // destination hash clears it rather than being stored.
            const hash = (value || "").trim().toLowerCase();
            const list = this.resolvers.slice();
            list[index] = /^[0-9a-f]{32}$/.test(hash) ? hash : null;
            const kept = list.filter(Boolean).filter((h, i, a) => a.indexOf(h) === i);
            this.$emit("update-field", {
                key: "rns_resolve_resolver_destination_hashes",
                value: kept.length ? kept.join("\n") : null,
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
    },
};
</script>
