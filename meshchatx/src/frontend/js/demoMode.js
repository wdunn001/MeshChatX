// SPDX-License-Identifier: 0BSD

export function isDemoReadonly(status) {
    return Boolean(status && status.demo_mode === true);
}

export function isStampAuthEnabled(status) {
    return Boolean(status && status.stamp_auth_enabled === true);
}
