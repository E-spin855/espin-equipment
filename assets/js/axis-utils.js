(function () {
  const clean = (value) => String(value ?? "").trim();
  const lower = (value) => clean(value).toLowerCase();

  const FIELD_ALIASES = {
    project: ["project", "oem_project_id", "project_id", "asset_id", "equipment_id"],
    make: ["make", "manufacturer", "brand"],
    model: ["model"],
    modality: ["modality"],
    serial: ["serial", "serial_number", "system_serial"],
    dom: ["dom", "year", "manufacture_year"],
    site: ["site", "facility", "hospital", "hospital_name", "customer", "location"],
    rep: ["rep", "assigned_rep_name", "assigned_rep", "rep_owner", "sales_rep", "sales_rep_name"],
    manager: ["manager", "manager_name", "owner_group_name", "owner_group"],
    territory: ["territory", "manager_region", "manager_territory", "region"]
  };

  const CANONICAL_FIELDS = Object.keys(FIELD_ALIASES);

  function canonicalFieldName(field) {
    const normalized = lower(field).replace(/\s+/g, "_");

    for (const canonical of CANONICAL_FIELDS) {
      if (FIELD_ALIASES[canonical].includes(normalized)) return canonical;
    }

    return normalized;
  }

  function isBlankInstallBaseValue(value, canonicalField = "") {
    const normalized = lower(value);

    if (!normalized) return true;

    if ([
      "-",
      "n/a",
      "na",
      "none",
      "null",
      "unknown",
      "unknown_site",
      "unknown site",
      "unknown facility",
      "unassigned",
      "unassigned_owner_group",
      "unassigned owner group",
      "unassigned territory"
    ].includes(normalized)) {
      return true;
    }

    // IMPORTANT:
    // Do not treat OTHER as blank.
    // OTHER is a visible normalized value and should not trigger FIX everywhere.
    return false;
  }

  function getInstallBaseFieldValue(record, canonicalField) {
    if (!record || typeof record !== "object") return "";

    const canonical = canonicalFieldName(canonicalField);
    const aliases = FIELD_ALIASES[canonical] || [canonical];

    for (const alias of aliases) {
      const value = record[alias];

      if (!isBlankInstallBaseValue(value, canonical)) {
        return value;
      }
    }

    return "";
  }

  function setInstallBaseFieldValue(record, canonicalField, value) {
    if (!record || typeof record !== "object") return record;

    const canonical = canonicalFieldName(canonicalField);

    const primaryKey = {
      project: "oem_project_id",
      make: "make",
      model: "model",
      modality: "modality",
      serial: "serial_number",
      dom: "dom",
      site: "site",
      rep: "assigned_rep_name",
      manager: "manager_name",
      territory: "manager_region"
    }[canonical] || canonical;

    record[primaryKey] = value;

    // Keep common aliases aligned so Hub, Rep, and Manager all see the same correction.
    if (canonical === "project") {
      record.project = value;
      record.project_id = value;
      record.asset_id = value;
      record.equipment_id = value;
    }

    if (canonical === "make") {
      record.manufacturer = value;
      record.brand = value;
    }

    if (canonical === "model") {
      record.model = value;
    }

    if (canonical === "modality") {
      record.modality = value;
    }

    if (canonical === "serial") {
      record.serial = value;
      record.serial_number = value;
      record.system_serial = value;
    }

    if (canonical === "dom") {
      record.dom = value;
      record.year = value;
      record.manufacture_year = value;
    }

    if (canonical === "site") {
      record.site = value;
      record.facility = value;
      record.hospital = value;
      record.hospital_name = value;
      record.customer = value;
      record.location = value;
    }

    if (canonical === "rep") {
      record.rep = value;
      record.assigned_rep_name = value;
      record.assigned_rep = value;
      record.rep_owner = value;
      record.sales_rep = value;
      record.sales_rep_name = value;
    }

    if (canonical === "manager") {
      record.manager = value;
      record.manager_name = value;
      record.owner_group_name = value;
      record.owner_group = value;
    }

    if (canonical === "territory") {
      record.territory = value;
      record.manager_region = value;
      record.manager_territory = value;
      record.region = value;
    }

    return record;
  }

  function getCanonicalRecordKey(record) {
    if (!record || typeof record !== "object") return "";

    const stable = clean(record.key || record.axis_sync_key || record.original_key || "");
    if (stable) return stable;

    const project = clean(getInstallBaseFieldValue(record, "project"));
    const serial = clean(getInstallBaseFieldValue(record, "serial"));
    const site = clean(getInstallBaseFieldValue(record, "site"));

    if (project && serial) return `${project}_${serial}`;
    if (project && site) return `${project}_${site}`;
    if (serial && site) return `${serial}_${site}`;

    if (project || serial || site) {
      return `${project || "no_project"}_${serial || "no_serial"}_${site || "no_site"}`;
    }

    return clean(record.id || "");
  }

  function getMissingInstallBaseFields(record) {
    if (!record || typeof record !== "object") return [];

    return CANONICAL_FIELDS.filter((field) =>
      isBlankInstallBaseValue(getInstallBaseFieldValue(record, field), field)
    );
  }

  function getPresentInstallBaseFields(record) {
    if (!record || typeof record !== "object") return [];

    return CANONICAL_FIELDS.filter((field) =>
      !isBlankInstallBaseValue(getInstallBaseFieldValue(record, field), field)
    );
  }

  function hasMissingInstallBaseFields(record) {
    return getMissingInstallBaseFields(record).length > 0;
  }

  const existing = window.AxisUtils || {};

  window.AxisUtils = {
    ...existing,
    FIELD_ALIASES,
    CANONICAL_FIELDS,
    canonicalFieldName,
    getCanonicalRecordKey,
    getMissingInstallBaseFields,
    getPresentInstallBaseFields,
    getInstallBaseFieldValue,
    setInstallBaseFieldValue,
    isBlankInstallBaseValue,
    hasMissingInstallBaseFields
  };
})();