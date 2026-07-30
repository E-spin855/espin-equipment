(function () {
  "use strict";

  const CONTEXT_FIELDS = [
    "operation_id",
    "operation_type",
    "project_group_id",
    "facility_id",
    "asset_id",
    "serial_number",
    "source_record_id",
    "equipment_model",
    "facility"
  ];
  const clean = value => String(value ?? "").trim();
  const normalizeType = value => {
    const type = clean(value).toLowerCase();
    return /install/.test(type) && !/deinstall|de-install|removal|disposal/.test(type)
      ? "install"
      : "deinstall";
  };
  const hash = value => {
    let result = 2166136261;
    for (const char of clean(value)) {
      result ^= char.charCodeAt(0);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(36);
  };
  const params = new URLSearchParams(location.search);
  const activeProjectId = clean(
    params.get("projectId") ||
    params.get("id") ||
    localStorage.getItem("activeProjectId")
  );
  const direct = {
    operation_id: clean(params.get("operation_id")),
    operation_type: normalizeType(
      params.get("operation_type") ||
      params.get("project_type") ||
      params.get("created_type") ||
      params.get("handoff")
    ),
    project_group_id: clean(params.get("project_group_id")),
    facility_id: clean(params.get("facility_id")),
    asset_id: clean(params.get("asset_id")),
    serial_number: clean(params.get("serial_number")),
    source_record_id: clean(
      params.get("source_record_id") ||
      params.get("axis_record_id")
    ),
    equipment_model: clean(
      params.get("equipment_model") ||
      params.get("model")
    ),
    facility: clean(params.get("facility"))
  };
  let stored = {};
  for (const key of [
    direct.operation_id && `espin_operation_context:${direct.operation_id}`,
    activeProjectId && `espin_project_operation_context:${activeProjectId}`
  ].filter(Boolean)) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "{}");
      if (parsed && typeof parsed === "object") stored = { ...stored, ...parsed };
    } catch (_) {}
  }
  const context = {};
  CONTEXT_FIELDS.forEach(field => {
    context[field] = clean(direct[field] || stored[field]);
  });
  context.operation_type = normalizeType(context.operation_type);

  const reliable = clean(
    context.source_record_id ||
    context.asset_id ||
    context.serial_number
  );
  if (!context.operation_id && reliable) {
    context.operation_id =
      `legacy-${context.operation_type}-${hash([
        context.source_record_id,
        context.asset_id,
        context.serial_number
      ].join("|"))}`;
  }

  function saveContext(projectId = activeProjectId) {
    if (context.operation_id) {
      localStorage.setItem(
        `espin_operation_context:${context.operation_id}`,
        JSON.stringify(context)
      );
    }
    if (projectId) {
      localStorage.setItem(
        `espin_project_operation_context:${projectId}`,
        JSON.stringify(context)
      );
    }
  }

  function enrich(record = {}) {
    const enriched = { ...record };
    CONTEXT_FIELDS.forEach(field => {
      if (!clean(enriched[field]) && clean(context[field])) {
        enriched[field] = context[field];
      }
    });
    enriched.operation_type = normalizeType(
      enriched.operation_type ||
      enriched.project_type ||
      context.operation_type
    );
    return enriched;
  }

  function identity(record = {}) {
    return {
      operation_id: clean(record.operation_id),
      operation_type: normalizeType(
        record.operation_type ||
        record.project_type ||
        record.type
      ),
      source_record_id: clean(
        record.source_record_id ||
        record.axis_record_id ||
        record.record_id
      ).toLowerCase(),
      asset_id: clean(record.asset_id || record.equipment_id).toLowerCase(),
      serial_number: clean(
        record.serial_number ||
        record.serial ||
        record.system_serial
      ).toLowerCase()
    };
  }

  function matches(a, b) {
    const left = identity(a);
    const right = identity(b);
    if (left.operation_id && right.operation_id) {
      return left.operation_id === right.operation_id;
    }
    if (left.operation_type !== right.operation_type) return false;
    return Boolean(
      (left.source_record_id && right.source_record_id &&
        left.source_record_id === right.source_record_id) ||
      (left.asset_id && right.asset_id && left.asset_id === right.asset_id) ||
      (left.serial_number && right.serial_number &&
        left.serial_number === right.serial_number)
    );
  }

  function url(value) {
    const target = new URL(value, location.href);
    CONTEXT_FIELDS.forEach(field => {
      if (clean(context[field])) target.searchParams.set(field, context[field]);
    });
    if (activeProjectId) {
      target.searchParams.set("projectId", activeProjectId);
      target.searchParams.set("id", activeProjectId);
    }
    return target.toString();
  }

  function upsertActiveProject(project) {
    const key = "espin_active_project_progress_v1";
    const enriched = enrich(project);
    let records = [];
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "[]");
      if (Array.isArray(parsed)) records = parsed;
    } catch (_) {}
    const index = records.findIndex(item => matches(item, enriched));
    if (index >= 0) records[index] = { ...records[index], ...enriched };
    else records.unshift(enriched);
    localStorage.setItem(key, JSON.stringify(records));
    return enriched;
  }

  saveContext();

  const originalFetch = window.fetch.bind(window);
  window.fetch = function (input, init = {}) {
    let requestUrl =
      typeof input === "string" ? input : clean(input?.url);
    const isRemovalInstallApi = requestUrl.includes("/api/removal-install/");
    if (isRemovalInstallApi && (!init.method || /GET/i.test(init.method))) {
      requestUrl = url(requestUrl);
      input = requestUrl;
    }
    if (isRemovalInstallApi && typeof init.body === "string") {
      try {
        const body = JSON.parse(init.body);
        const enrichedBody = enrich(body);
        if (enrichedBody.data && typeof enrichedBody.data === "object") {
          enrichedBody.data = enrich(enrichedBody.data);
        }
        if (enrichedBody.project && typeof enrichedBody.project === "object") {
          enrichedBody.project = enrich(enrichedBody.project);
        }
        init = { ...init, body: JSON.stringify(enrichedBody) };
      } catch (_) {}
    }
    return originalFetch(input, init);
  };

  document.addEventListener("click", event => {
    const anchor = event.target.closest("a[href]");
    if (!anchor || /^(mailto:|tel:|sms:|javascript:|#)/i.test(anchor.getAttribute("href") || "")) return;
    try {
      const target = new URL(anchor.href, location.href);
      if (target.origin === location.origin) anchor.href = url(target);
    } catch (_) {}
  }, true);

  document.addEventListener("DOMContentLoaded", () => {
    const existing = document.getElementById("espinOperationIdentity");
    if (existing || !context.operation_id) return;
    const strip = document.createElement("div");
    strip.id = "espinOperationIdentity";
    strip.style.cssText =
      "position:relative;z-index:20;margin:10px auto;padding:10px 14px;max-width:1100px;border:1px solid #9fb7cc;border-radius:10px;background:#eef6fc;color:#17324a;font:700 13px/1.4 system-ui,sans-serif";
    strip.textContent = [
      context.operation_type === "install" ? "INSTALL" : "DE-INSTALL",
      context.equipment_model || "Equipment",
      context.serial_number
        ? `S/N ${context.serial_number}`
        : context.asset_id
          ? `Asset ${context.asset_id}`
          : "",
      context.facility || context.facility_id
    ].filter(Boolean).join(" · ");
    document.body.insertBefore(strip, document.body.firstChild);
  });

  window.EspinOperation = {
    fields: CONTEXT_FIELDS,
    context,
    enrich,
    identity,
    matches,
    url,
    saveContext,
    upsertActiveProject
  };
})();
