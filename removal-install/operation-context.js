(function () {
  "use strict";

  const CONTEXT_FIELDS = [
    "operation_id",
    "operation_type",
    "project_group_id",
    "facility_id",
    "facility_name",
    "facility",
    "asset_id",
    "serial_number",
    "make",
    "model",
    "modality",
    "source_record_id",
    "equipment_source",
    "equipment_verified",
    "created_at",
    "created_by",
    "equipment_model",
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
    facility_name: clean(params.get("facility_name") || params.get("facility")),
    facility: clean(params.get("facility") || params.get("facility_name")),
    asset_id: clean(params.get("asset_id")),
    serial_number: clean(params.get("serial_number")),
    make: clean(params.get("make")),
    model: clean(params.get("model") || params.get("equipment_model")),
    modality: clean(params.get("modality")),
    source_record_id: clean(
      params.get("source_record_id") ||
      params.get("axis_record_id")
    ),
    equipment_model: clean(
      params.get("equipment_model") ||
      params.get("model")
    ),
    equipment_source: clean(params.get("equipment_source")),
    equipment_verified: clean(params.get("equipment_verified")),
    created_at: clean(params.get("created_at")),
    created_by: clean(params.get("created_by"))
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
  const intakePath = /EspinConnectHandoff|project_type|EquipmentSelection/i.test(location.pathname);
  if (!context.operation_id && reliable && !intakePath) {
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
      if (clean(context[field]) && !target.searchParams.has(field)) {
        target.searchParams.set(field, context[field]);
      }
    });
    if (activeProjectId) {
      target.searchParams.set("projectId", activeProjectId);
      target.searchParams.set("id", activeProjectId);
    }
    return target.toString();
  }

  function newOperationId(type = context.operation_type) {
    const suffix = window.crypto?.randomUUID
      ? window.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return `op-${normalizeType(type)}-${suffix}`;
  }

  function hasReliableEquipmentId(record = context) {
    return Boolean(clean(
      record.source_record_id ||
      record.asset_id ||
      record.serial_number
    ));
  }

  function hasValidOperationId(record = context) {
    return /^(?:op|legacy)-(?:install|deinstall)-[a-z0-9._-]+$/i.test(
      clean(record.operation_id)
    );
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

  window.EspinOperation = {
    fields: CONTEXT_FIELDS,
    context,
    enrich,
    identity,
    matches,
    url,
    newOperationId,
    hasReliableEquipmentId,
    hasValidOperationId,
    saveContext,
    upsertActiveProject
  };
})();
