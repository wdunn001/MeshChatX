// SPDX-License-Identifier: 0BSD

/**
 * The two surfaces a hosted visitor meets that a desktop user never does: a
 * way out of the session, and a first-run card that fits a borrowed machine.
 */

import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HostedAccountRow from "../../meshchatx/src/frontend/components/layout/HostedAccountRow.vue";
import HostedWelcomeCard from "../../meshchatx/src/frontend/components/onboarding/HostedWelcomeCard.vue";
import GlobalState from "../../meshchatx/src/frontend/js/GlobalState.js";

const translate = (key, params) => {
    if (!params) {
        return key;
    }
    let text = key;
    for (const [name, value] of Object.entries(params)) {
        text = text.replace(`{${name}}`, value);
    }
    return text;
};

const mountRow = () =>
    mount(HostedAccountRow, {
        global: {
            mocks: { $t: translate },
            stubs: { MaterialDesignIcon: true },
        },
    });

describe("HostedAccountRow", () => {
    let originalLocation;

    beforeEach(() => {
        originalLocation = window.location;
        delete window.location;
        window.location = { href: "/#/messages" };
        window.api = { post: vi.fn().mockResolvedValue({ data: {} }) };
        GlobalState.authMode = "accounts";
        GlobalState.accountRole = "user";
        GlobalState.accountUsername = "wren";
    });

    afterEach(() => {
        window.location = originalLocation;
        GlobalState.authMode = null;
        GlobalState.accountRole = null;
        GlobalState.accountUsername = null;
    });

    it("offers a way out of a shared instance", () => {
        const wrapper = mountRow();
        expect(wrapper.find('[data-testid="sidebar-sign-out"]').exists()).toBe(true);
        expect(wrapper.text()).toContain("wren");
    });

    it("renders nothing on a build where nobody signed in", () => {
        GlobalState.authMode = null;
        const wrapper = mountRow();
        expect(wrapper.find('[data-testid="hosted-account-row"]').exists()).toBe(false);
    });

    it("ends the session on the server and then leaves the shell", async () => {
        const wrapper = mountRow();
        await wrapper.find('[data-testid="sidebar-sign-out"]').trigger("click");
        await Promise.resolve();
        expect(window.api.post).toHaveBeenCalledWith("/api/v1/multiuser/logout", {});
        expect(window.location.href).toBe("/");
    });

    it("still leaves the shell when the server never answers", async () => {
        window.api.post = vi.fn().mockRejectedValue(new Error("offline"));
        const wrapper = mountRow();
        await wrapper.find('[data-testid="sidebar-sign-out"]').trigger("click");
        await Promise.resolve();
        await Promise.resolve();
        expect(window.location.href).toBe("/");
    });
});

describe("HostedWelcomeCard", () => {
    const push = vi.fn();

    const mountCard = () =>
        mount(HostedWelcomeCard, {
            props: {
                address: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
                displayName: "wren",
            },
            global: {
                mocks: { $t: translate, $router: { push } },
            },
        });

    beforeEach(() => {
        push.mockClear();
    });

    it("stays hidden until it is shown", () => {
        const wrapper = mountCard();
        expect(wrapper.find('[data-testid="hosted-welcome-card"]').exists()).toBe(false);
    });

    it("states the address and the name, which is all a stranger needs", async () => {
        const wrapper = mountCard();
        wrapper.vm.show();
        await wrapper.vm.$nextTick();
        expect(wrapper.find('[data-testid="hosted-welcome-address"]').text()).toBe(
            "a1b2c3d4e5f60718293a4b5c6d7e8f90",
        );
        expect(wrapper.text()).toContain("wren");
    });

    it("never uses the desktop tour's wording, which promises a setup nobody here can do", async () => {
        const wrapper = mountCard();
        wrapper.vm.show();
        await wrapper.vm.$nextTick();
        expect(wrapper.text()).not.toContain("Skip Setup");
        expect(wrapper.text()).not.toContain("Continue");
    });

    it("hands the address up rather than copying it itself", async () => {
        const wrapper = mountCard();
        wrapper.vm.show();
        await wrapper.vm.$nextTick();
        await wrapper.find('[data-testid="hosted-welcome-copy"]').trigger("click");
        expect(wrapper.emitted("copy-address")[0]).toEqual(["a1b2c3d4e5f60718293a4b5c6d7e8f90"]);
    });

    it("records the acknowledgement when it is closed", async () => {
        const wrapper = mountCard();
        wrapper.vm.show();
        await wrapper.vm.$nextTick();
        await wrapper.find('[data-testid="hosted-welcome-close"]').trigger("click");
        expect(wrapper.emitted("seen")).toHaveLength(1);
        expect(wrapper.find('[data-testid="hosted-welcome-card"]').exists()).toBe(false);
    });

    it("sends someone to the announces list, and counts that as seen too", async () => {
        const wrapper = mountCard();
        wrapper.vm.show();
        await wrapper.vm.$nextTick();
        await wrapper.find('[data-testid="hosted-welcome-announces"]').trigger("click");
        expect(wrapper.emitted("seen")).toHaveLength(1);
        expect(push).toHaveBeenCalledWith({ name: "contacts" });
    });
});
