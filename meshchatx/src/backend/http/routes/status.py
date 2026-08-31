# SPDX-License-Identifier: 0BSD
"""HTTP routes: status."""

from __future__ import annotations

from meshchatx.src.backend.request_context import get_active_context

from meshchatx.src.backend.http.meshchat_names import (  # noqa: F401
    GeoValidationError,
    OutboundHttpBlockedError,
    OverlayExportError,
    OverlaySourceParseError,
    PluginSecurityError,
    AsyncUtils,
    InterfaceConfigParser,
    InterfaceDiscovery,
    InterfaceEditor,
    LOGIN_PATH,
    LXMF,
    LxmfAudioField,
    LxmfFileAttachment,
    LxmfFileAttachmentsField,
    LxmfImageField,
    MAX_EXPORT_TILES,
    MarkdownRenderer,
    NomadnetFileDownloader,
    NomadnetPageDownloader,
    RNProbeHandler,
    RNS,
    ReticulumMeshChat,
    SETUP_PATH,
    TRANSPARENT_TILE,
    Telemeter,
    UTC,
    WSMsgType,
    _is_chaquopy_android,
    _is_loopback_bind_host,
    _request_client_ip,
    aiohttp,
    app_version,
    assert_migration_context_paths,
    asyncio,
    base64,
    bcrypt,
    binascii,
    build_blocklist_export_document,
    build_export_document,
    build_messages_export_bundle,
    cache_stats,
    cancel_inbound_deliveries,
    cast,
    compute_lxmf_conversation_unread_from_latest_row,
    configparser,
    contextlib,
    convert_db_favourite_to_dict,
    convert_db_lxmf_message_to_dict,
    convert_lxmf_message_to_dict,
    convert_nomadnet_field_data_to_map,
    convert_nomadnet_string_data_to_map,
    convert_propagation_node_state_to_string,
    copy,
    datetime,
    describe_port_conflict,
    detect_image_format_from_magic,
    ensure_outbound_http_allowed,
    ensure_session_csrf_token,
    filter_announced_dicts_by_search_query,
    fresh_storage_at_target,
    get_cached_active_link,
    get_file_path,
    get_session,
    get_trusted_proxy_cidrs,
    gif_utils,
    i2p_support,
    import_messages_export_bundle,
    io,
    is_mbtiles_filename,
    is_path_within_dir,
    is_port_in_use,
    is_user_facing_lxmf_payload,
    json,
    list_host_network_interfaces,
    list_inbound_deliveries,
    list_ports,
    load_app_security_settings,
    logger,
    logging,
    lxmf_sidebar_preview_for_conversation_latest_row,
    memory_log_handler,
    message_fields_have_attachments,
    migrate_legacy_to_target,
    mime_for_image_type,
    normalize_identity_storage_hash,
    normalize_lxmf_sieve_filters,
    normalize_message_blocklist,
    os,
    parse_bool_query_param,
    parse_import_document,
    parse_lxmf_display_name,
    parse_lxmf_propagation_node_app_data,
    parse_lxmf_sieve_filters_json,
    parse_lxmf_stamp_cost,
    parse_message_blocklist_json,
    parse_nomadnetwork_node_display_name,
    platform,
    privacy_mode_enabled,
    psutil,
    purge_messages_before_cutoff,
    re,
    resolve_message_age_cutoff,
    reticulum_pathfinding,
    rotate_session_csrf_token,
    rrc_protocol,
    safe_path_under_dir,
    sanitize_sticker_emoji,
    sanitize_sticker_name,
    sanitize_websocket_config_update,
    save_app_security_settings,
    secrets,
    shutil,
    sqlite3,
    sticker_pack_utils,
    sys,
    tempfile,
    threading,
    time,
    traceback,
    user_agent_hash,
    validate_export_document,
    web,
    websocket_type_requires_auth,
    zipfile,
)


def _public_startup_status_payload(app) -> dict:
    """Boot readiness only, safe to hand to a caller who has not signed in.

    A shared instance answers this endpoint before anyone can obtain a
    session, so the frontend boot gate can tell the app is up at all. It
    carries none of the fields the signed-in payload carries: no listen
    host or port, no interface or plugin state, no identity hashes, and no
    peer or announce data. When startup has failed the real error text is
    withheld too, since it can name interfaces or paths, and replaced with
    a generic message.
    """
    full = app._startup_status_payload()
    stage = full.get("stage")
    payload = {
        "status": full.get("status"),
        "stage": stage if isinstance(stage, str) else None,
        "network_ready": bool(full.get("network_ready")),
        "network_degraded": bool(full.get("network_degraded")),
        "ui_ready": bool(full.get("ui_ready")),
    }
    if full.get("status") == "failed":
        payload["error"] = "Network startup failed"
    return payload


def register_status_routes(routes, app):

    @routes.get("/api/v1/status")
    async def status(request):
        # account_store exists only when the multiuser feature was switched
        # on at startup (register_multiuser_routes is what creates it, and
        # only runs then), so it is the same signal already used to decide
        # whether the multiuser middleware itself is installed. Recomputing
        # "is multiuser enabled" here from the env var or settings file
        # instead would be a second, independent read of the same fact,
        # able to disagree with the one that actually decided whether a
        # session is required to reach this route at all. A signed-in
        # caller in multi-user mode is bound to an identity context by the
        # multiuser middleware before this handler runs; a caller with no
        # session reaches here with no context bound. Give the first the
        # full detailed payload as always, and the second readiness only,
        # so the frontend boot gate can mount the shell without ever
        # needing a session to learn the app is up.
        multiuser_active = getattr(app, "account_store", None) is not None
        if multiuser_active and get_active_context() is None:
            return web.json_response(_public_startup_status_payload(app))
        return web.json_response(app._startup_status_payload())

    @routes.post("/api/v1/reticulum/recover")
    async def reticulum_recover(request):
        """Disable risky interfaces and retry network setup without wiping data."""
        if app._network_ready and app.current_context and app.current_context.running:
            return web.json_response(
                {
                    "message": "Network stack is already running",
                    "status": app._startup_status_payload(),
                },
            )

        identity = app._pending_identity or app.identity
        if identity is None:
            return web.json_response(
                {"message": "No identity available for recovery"},
                status=400,
            )

        config_path = app._reticulum_config_file_path()
        actions: list[str] = []
        try:
            data = await request.json()
        except Exception:
            data = {}
        if not isinstance(data, dict):
            data = {}

        disable_all = bool(data.get("disable_all_interfaces"))
        named = data.get("disable_interfaces")
        if isinstance(named, list) and named:
            from meshchatx.src.backend.rns_startup_recovery import (
                disable_named_interfaces_in_config,
            )

            disabled = disable_named_interfaces_in_config(
                config_path,
                [str(n) for n in named],
            )
            actions.extend(disabled)
        elif disable_all:
            from meshchatx.src.backend.rns_startup_recovery import (
                disable_named_interfaces_in_config,
                list_enabled_interface_names,
            )

            names = list_enabled_interface_names(config_path)
            disabled = disable_named_interfaces_in_config(config_path, names)
            actions.extend(disabled)
        else:
            from meshchatx.src.backend.rns_startup_recovery import (
                apply_startup_recovery_step,
            )

            for attempt in range(4):
                disabled = apply_startup_recovery_step(
                    config_path,
                    app._startup_error or "manual recover",
                    attempt=attempt,
                )
                actions.extend(disabled)
                if disabled:
                    break

        app._rns_recovery_actions = actions
        app._startup_error = None
        app._startup_stage = "starting"
        app._network_degraded = False
        app._ui_ready = True
        app._network_ready = False
        app._reticulum_secondary_started = False
        if hasattr(app, "reticulum"):
            with contextlib.suppress(Exception):
                delattr(app, "reticulum")

        try:
            app.setup_identity(identity)
            app._mark_network_ready()
            app._finish_deferred_startup_services()
            return web.json_response(
                {
                    "message": "Network stack recovered",
                    "disabled_interfaces": actions,
                    "status": app._startup_status_payload(),
                },
            )
        except Exception as exc:
            traceback.print_exc()
            app._mark_network_degraded(str(exc))
            return web.json_response(
                {
                    "message": "Recovery attempt failed",
                    "error": str(exc),
                    "disabled_interfaces": actions,
                    "status": app._startup_status_payload(),
                },
                status=500,
            )

    @routes.get("/api/v1/self-test")
    async def self_test(request):
        results = app.run_self_test()
        return web.json_response(results)
