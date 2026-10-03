(() => {
  "use strict";

  const state = { datasets: [], activeId: null, filters: { type: "all", from: "", to: "" } };
  const $ = (selector) => document.querySelector(selector);
  const palette = ["#3478f6", "#28a879", "#e5a13b", "#8070d8", "#e36c69", "#26a6a1", "#6b83a6", "#d37a43"];
  const numberFormat = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 });
  const integerFormat = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 });
  const currencyFormat = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 });

  const aliases = {
    ot: ["ot", "orden", "orden_de_trabajo"],
    created: ["fecha_creacion", "fecha_creación"],
    start: ["fecha_inicio"],
    end: ["fecha_fin"],
    equipment: ["equipo", "activo"],
    unit: ["unidad", "area"],
    equipmentType: ["tipo_equipo", "familia_equipo"],
    criticality: ["criticidad"],
    maintenance: ["tipo_mantenimiento", "tipo_de_mantenimiento"],
    planned: ["planificado"],
    failure: ["modo_falla", "modo_de_falla"],
    state: ["estado", "status_usuario", "status_sistema"],
    downtime: ["downtime_h", "downtime", "horas_indisponibilidad"],
    labor: ["horas_mano_obra", "horas_hombre", "hh"],
    cost: ["costo_total_clp", "costo_total", "costo_directo_clp"],
    repair: ["tiempo_reparacion_h", "tiempo_reparacion", "duracion_ot_h"]
  };

  function canonical(value) {
    return String(value ?? "").replace(/^\uFEFF/, "").replace(/^'+/, "").trim().normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[\s.-]+/g, "_");
  }

  function field(row, key) {
    const keys = Object.keys(row);
    const found = keys.find((item) => aliases[key].includes(canonical(item)));
    return found ? row[found] : "";
  }

  function cleanText(value) {
    return String(value ?? "").replace(/^'+/, "").trim();
  }

  function parseNumber(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    let text = cleanText(value).replace(/\s/g, "").replace(/[^\d,.-]/g, "");
    if (!text || text === "-" || text === ".") return null;
    const comma = text.lastIndexOf(",");
    const dot = text.lastIndexOf(".");
    if (comma >= 0 && dot >= 0) {
      const decimal = comma > dot ? "," : ".";
      text = text.replace(/[,.]/g, (separator, index) => separator === decimal && index === Math.max(comma, dot) ? "." : "");
    } else if (comma >= 0) {
      text = text.replace(/\./g, "").replace(",", ".");
    }
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
  }

  function parseDate(value) {
    if (value instanceof Date && Number.isFinite(value.getTime())) return value;
    const text = cleanText(value);
    if (!text) return null;
    let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (match) {
      const date = new Date(+match[1], +match[2] - 1, +match[3], +(match[4] || 0), +(match[5] || 0), +(match[6] || 0));
      return Number.isFinite(date.getTime()) ? date : null;
    }
    match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (match) {
      const date = new Date(+match[3], +match[2] - 1, +match[1], +(match[4] || 0), +(match[5] || 0), +(match[6] || 0));
      return Number.isFinite(date.getTime()) ? date : null;
    }
    const parsed = new Date(text);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }

  function parseCsv(text) {
    const input = text.replace(/^\uFEFF/, "");
    const firstLine = input.split(/\r?\n/, 1)[0] || "";
    const candidates = [",", ";", "\t"];
    const delimiter = candidates.map((char) => {
      let count = 0;
      let quoted = false;
      for (let i = 0; i < firstLine.length; i += 1) {
        if (firstLine[i] === '"') {
          if (quoted && firstLine[i + 1] === '"') i += 1;
          else quoted = !quoted;
        } else if (firstLine[i] === char && !quoted) count += 1;
      }
      return { char, count };
    }).sort((a, b) => b.count - a.count)[0].char;
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < input.length; i += 1) {
      const char = input[i];
      if (char === '"') {
        if (quoted && input[i + 1] === '"') { cell += '"'; i += 1; }
        else quoted = !quoted;
      } else if (char === delimiter && !quoted) {
        row.push(cell); cell = "";
      } else if ((char === "\n" || char === "\r") && !quoted) {
        if (char === "\r" && input[i + 1] === "\n") i += 1;
        row.push(cell); cell = "";
        if (row.some((item) => item.trim() !== "")) rows.push(row);
        row = [];
      } else cell += char;
    }
    if (cell.length || row.length) {
      row.push(cell);
      if (row.some((item) => item.trim() !== "")) rows.push(row);
    }
    if (rows.length < 2) throw new Error("El archivo CSV no contiene filas de datos.");
    const headers = rows.shift().map((header) => header.trim().replace(/^'+/, ""));
    return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
  }

  function validateRows(rows, filename) {
    if (!Array.isArray(rows) || rows.length === 0) throw new Error(`${filename}: no se encontraron filas de datos.`);
    const columns = Object.keys(rows[0]);
    const hasEquipment = columns.some((key) => aliases.equipment.includes(canonical(key)));
    const hasMaintenance = columns.some((key) => aliases.maintenance.includes(canonical(key)));
    const hasOrder = columns.some((key) => aliases.ot.includes(canonical(key)));
    if (!hasEquipment || !hasMaintenance || !hasOrder) {
      throw new Error(`${filename}: se requieren las columnas OT, Equipo y Tipo_mantenimiento.`);
    }
    return rows;
  }

  async function loadFile(file) {
    const extension = file.name.split(".").pop().toLowerCase();
    let rows;
    if (extension === "csv") rows = parseCsv(await file.text());
    else if (extension === "xlsx" || extension === "xls") {
      if (!window.XLSX) throw new Error("No se pudo cargar el lector Excel. Revisa tu conexión y vuelve a intentarlo; también puedes cargar CSV.");
      const workbook = window.XLSX.read(await file.arrayBuffer(), { cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) throw new Error(`${file.name}: el libro no contiene hojas.`);
      rows = window.XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false, dateNF: "yyyy-mm-dd hh:mm:ss" });
    } else throw new Error(`${file.name}: formato no compatible.`);
    return addDataset(validateRows(rows, file.name), file.name);
  }

  function addDataset(rows, name) {
    const dataset = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name, rows };
    state.datasets.push(dataset);
    state.activeId = dataset.id;
    state.filters = { type: "all", from: "", to: "" };
    $("#date-from").value = "";
    $("#date-to").value = "";
    renderDatasetOptions();
    render();
    return dataset;
  }

  function activeDataset() {
    return state.datasets.find((dataset) => dataset.id === state.activeId) || null;
  }

  function getDate(row) {
    return parseDate(field(row, "created")) || parseDate(field(row, "start"));
  }

  function normalizeMaintenance(value) {
    const text = cleanText(value).toLowerCase();
    if (text.includes("correct")) return "Correctivo";
    if (text.includes("prevent")) return "Preventivo";
    if (text.includes("predict")) return "Predictivo";
    return cleanText(value) || "Sin clasificar";
  }

  function filteredRows() {
    const dataset = activeDataset();
    if (!dataset) return [];
    return dataset.rows.filter((row) => {
      const date = getDate(row);
      const type = normalizeMaintenance(field(row, "maintenance"));
      if (state.filters.type !== "all" && type !== state.filters.type) return false;
      if (state.filters.from && (!date || date < new Date(`${state.filters.from}T00:00:00`))) return false;
      if (state.filters.to && (!date || date > new Date(`${state.filters.to}T23:59:59`))) return false;
      return true;
    });
  }

  function distinctOrderCount(rows) {
    return new Set(rows.map((row) => cleanText(field(row, "ot"))).filter(Boolean)).size;
  }

  function sumField(rows, key) {
    return rows.reduce((total, row) => total + (parseNumber(field(row, key)) || 0), 0);
  }

  function correctives(rows) {
    return rows.filter((row) => normalizeMaintenance(field(row, "maintenance")) === "Correctivo");
  }

  function repairDuration(row) {
    const start = parseDate(field(row, "start"));
    const end = parseDate(field(row, "end"));
    if (start && end && end > start) return (end - start) / 3600000;
    const fallback = parseNumber(field(row, "repair"));
    return fallback > 0 ? fallback : null;
  }

  function isClosed(row) {
    const status = cleanText(field(row, "state")).toLowerCase();
    return !status || /cerrad|close|teco|completad|finaliz/.test(status);
  }

  function validRepairs(rows) {
    return correctives(rows).filter((row) => isClosed(row) && repairDuration(row) > 0);
  }

  function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    if (!sorted.length) return 0;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function groupRows(rows, keyFn) {
    const groups = new Map();
    rows.forEach((row) => {
      const key = cleanText(keyFn(row)) || "Sin clasificar";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });
    return groups;
  }

  function sumByType(rows, fieldKey) {
    const groups = groupRows(rows, (row) => normalizeMaintenance(field(row, "maintenance")));
    return [...groups].map(([label, items]) => ({
      label, value: fieldKey === "orders" ? distinctOrderCount(items) : sumField(items, fieldKey)
    })).sort((a, b) => b.value - a.value);
  }

  function computeJackknife(rows) {
    const repairs = validRepairs(rows);
    const grouped = groupRows(repairs, (row) => field(row, "equipment"));
    const assets = [...grouped].map(([equipment, items]) => {
      const downtime = items.reduce((sum, row) => sum + Math.max(0, parseNumber(field(row, "downtime")) || 0), 0);
      const orders = distinctOrderCount(items) || items.length;
      return {
        equipment, items, downtime, orders,
        type: cleanText(field(items[0], "equipmentType")) || "Sin clasificar",
        criticality: cleanText(field(items[0], "criticality")) || "—",
        mttr: downtime > 0 ? downtime / orders : items.reduce((sum, row) => sum + repairDuration(row), 0) / orders
      };
    }).filter((asset) => asset.orders > 0);
    const totalOrders = assets.reduce((sum, asset) => sum + asset.orders, 0);
    const totalDowntime = assets.reduce((sum, asset) => sum + asset.downtime, 0);
    const frequencyLimit = assets.length ? totalOrders / assets.length : 0;
    const mttrLimit = totalOrders ? totalDowntime / totalOrders : 0;
    assets.forEach((asset) => {
      asset.frequencyNorm = frequencyLimit ? asset.orders / frequencyLimit : 0;
      asset.mttrNorm = mttrLimit ? asset.mttr / mttrLimit : 0;
      asset.risk = asset.frequencyNorm * asset.mttrNorm;
      asset.classification = asset.frequencyNorm < 1
        ? (asset.mttrNorm < 1 ? "Bajo control" : "Agudo")
        : (asset.mttrNorm < 1 ? "Crónico" : "Grave");
    });
    return assets.sort((a, b) => b.risk - a.risk);
  }

  function renderDatasetOptions() {
    const select = $("#dataset-select");
    select.replaceChildren(...state.datasets.map((dataset) => {
      const option = document.createElement("option");
      option.value = dataset.id;
      option.textContent = dataset.name;
      option.selected = dataset.id === state.activeId;
      return option;
    }));
    const dataset = activeDataset();
    $("#dataset-meta").textContent = dataset
      ? `${integerFormat.format(dataset.rows.length)} registros · ${dataset.rows[0] ? Object.keys(dataset.rows[0]).length : 0} campos`
      : "Carga un archivo para comenzar.";
  }

  function renderTypeFilter(rows) {
    const select = $("#maintenance-filter");
    const current = state.filters.type;
    const types = [...new Set(rows.map((row) => normalizeMaintenance(field(row, "maintenance"))))].sort();
    select.replaceChildren(new Option("Todos los tipos", "all"), ...types.map((type) => new Option(type, type)));
    select.value = types.includes(current) ? current : "all";
    state.filters.type = select.value;
  }

  function htmlEscape(text) {
    return String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }

  function svgText(text, x, y, options = {}) {
    const { size = 10, fill = "#8491a1", anchor = "start", weight = 400 } = options;
    return `<text x="${x}" y="${y}" text-anchor="${anchor}" fill="${fill}" font-size="${size}" font-weight="${weight}" font-family="DM Sans,Segoe UI,sans-serif">${htmlEscape(text)}</text>`;
  }

  function emptyChart(container, message = "No hay datos para los filtros seleccionados.") {
    container.innerHTML = `<div class="chart-empty">${htmlEscape(message)}</div>`;
  }

  function renderBars(containerId, entries, options = {}) {
    const container = $(`#${containerId}`);
    if (!entries.length) return emptyChart(container);
    const items = entries.slice(0, options.limit || 8);
    const width = 680; const rowHeight = options.rowHeight || 27;
    const height = Math.max(150, 28 + items.length * rowHeight);
    const labelWidth = options.labelWidth || 190;
    const valueWidth = 55;
    const barWidth = width - labelWidth - valueWidth - 18;
    const max = Math.max(...items.map((item) => item.value), 1);
    const barColor = options.color || palette[0];
    let svg = `<svg viewBox="0 0 ${width} ${height}" role="presentation">`;
    const tickCount = 4;
    for (let tick = 0; tick <= tickCount; tick += 1) {
      const x = labelWidth + (barWidth * tick / tickCount);
      svg += `<line x1="${x}" y1="12" x2="${x}" y2="${height - 12}" stroke="#edf0f4" stroke-width="1"/>`;
      if (tick < tickCount) svg += svgText(numberFormat.format(max * tick / tickCount), x, 10, { size: 8, fill: "#a1aab5", anchor: "middle" });
    }
    items.forEach((item, index) => {
      const y = 27 + index * rowHeight;
      const bar = Math.max(item.value > 0 ? 2 : 0, barWidth * item.value / max);
      const label = item.label.length > 27 ? `${item.label.slice(0, 26)}…` : item.label;
      svg += svgText(label, labelWidth - 10, y + 10, { size: 9, fill: "#607187", anchor: "end" });
      svg += `<rect x="${labelWidth}" y="${y}" width="${bar}" height="12" rx="4" fill="${options.colorByIndex ? palette[index % palette.length] : barColor}"><title>${htmlEscape(item.label)}: ${htmlEscape(options.format ? options.format(item.value) : numberFormat.format(item.value))}</title></rect>`;
      svg += svgText(options.format ? options.format(item.value) : numberFormat.format(item.value), labelWidth + bar + 7, y + 10, { size: 8, fill: "#53647a", weight: 600 });
    });
    svg += "</svg>";
    container.innerHTML = svg;
  }

  function renderImpact(rows) {
    const types = [...new Set(rows.map((row) => normalizeMaintenance(field(row, "maintenance"))))].sort();
    if (!types.length) return emptyChart($("#chart-impact"));
    const metrics = [
      { label: "Horas-hombre", key: "labor" },
      { label: "Downtime", key: "downtime" },
      { label: "Costo directo", key: "cost" }
    ];
    const width = 680; const height = 180; const labelWidth = 115; const chartWidth = 510;
    let svg = `<svg viewBox="0 0 ${width} ${height}" role="presentation">`;
    metrics.forEach((metric, index) => {
      const y = 35 + index * 45;
      const total = sumField(rows, metric.key);
      svg += svgText(metric.label, labelWidth - 9, y + 13, { size: 9, fill: "#68788b", anchor: "end" });
      let x = labelWidth;
      types.forEach((type, typeIndex) => {
        const value = rows.filter((row) => normalizeMaintenance(field(row, "maintenance")) === type)
          .reduce((sum, row) => sum + (parseNumber(field(row, metric.key)) || 0), 0);
        const portion = total > 0 ? value / total : 0;
        const segmentWidth = chartWidth * portion;
        if (segmentWidth > 0) {
          svg += `<rect x="${x}" y="${y}" width="${segmentWidth}" height="18" rx="3" fill="${palette[typeIndex % palette.length]}"><title>${htmlEscape(type)}: ${numberFormat.format(portion * 100)}%</title></rect>`;
          if (portion > 0.1) svg += svgText(`${numberFormat.format(portion * 100)}%`, x + segmentWidth / 2, y + 12, { size: 8, fill: "#fff", anchor: "middle", weight: 700 });
          x += segmentWidth;
        }
      });
    });
    types.forEach((type, index) => {
      const x = labelWidth + index * 133;
      svg += `<rect x="${x}" y="171" width="7" height="7" rx="2" fill="${palette[index % palette.length]}"/>`;
      svg += svgText(type.length > 16 ? `${type.slice(0, 15)}…` : type, x + 11, 178, { size: 8, fill: "#758397" });
    });
    svg += "</svg>";
    $("#chart-impact").innerHTML = svg;
  }

  function renderPareto(rows) {
    const groups = groupRows(correctives(rows), (row) => field(row, "failure"));
    const items = [...groups].map(([label, records]) => ({ label, value: distinctOrderCount(records) || records.length }))
      .sort((a, b) => b.value - a.value).slice(0, 8);
    const container = $("#chart-failures");
    if (!items.length) return emptyChart(container, "No se encontraron modos de falla correctivos.");
    const width = 680; const height = 225; const left = 45; const bottom = 42; const top = 22;
    const plotW = width - left - 12; const plotH = height - bottom - top;
    const max = Math.max(...items.map((item) => item.value), 1);
    const total = items.reduce((sum, item) => sum + item.value, 0);
    let cumulative = 0;
    const points = [];
    let svg = `<svg viewBox="0 0 ${width} ${height}" role="presentation">`;
    [0, .5, 1].forEach((ratio) => {
      const y = top + plotH * (1 - ratio);
      svg += `<line x1="${left}" y1="${y}" x2="${width - 8}" y2="${y}" stroke="#edf0f4"/>`;
      svg += svgText(`${Math.round(max * ratio)}`, left - 8, y + 3, { size: 8, anchor: "end", fill: "#9aa5b2" });
    });
    const slot = plotW / items.length;
    items.forEach((item, index) => {
      const barW = Math.min(34, slot * .55);
      const x = left + slot * index + (slot - barW) / 2;
      const barH = plotH * item.value / max;
      const y = top + plotH - barH;
      svg += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="3" fill="${palette[0]}"><title>${htmlEscape(item.label)}: ${item.value} OT</title></rect>`;
      svg += svgText(`${item.value}`, x + barW / 2, y - 5, { size: 8, fill: "#53647a", anchor: "middle", weight: 600 });
      const label = item.label.length > 13 ? `${item.label.slice(0, 12)}…` : item.label;
      svg += `<text transform="translate(${x + barW / 2},${height - 8}) rotate(-28)" text-anchor="end" fill="#8390a0" font-size="8" font-family="DM Sans,Segoe UI,sans-serif">${htmlEscape(label)}</text>`;
      cumulative += item.value;
      points.push(`${x + barW / 2},${top + plotH * (1 - cumulative / total)}`);
    });
    if (points.length > 1) svg += `<polyline points="${points.join(" ")}" fill="none" stroke="#e5a13b" stroke-width="2"/>`;
    points.forEach((point) => {
      const [x, y] = point.split(",");
      svg += `<circle cx="${x}" cy="${y}" r="3" fill="#e5a13b"/>`;
    });
    svg += svgText("Órdenes correctivas únicas", left, height - 1, { size: 8, fill: "#9aa5b2" });
    svg += "</svg>";
    container.innerHTML = svg;
  }

  function renderJackknife(assets) {
    const container = $("#chart-jackknife");
    if (!assets.length) return emptyChart(container, "No hay reparaciones correctivas válidas para construir la matriz.");
    const width = 680; const height = 275; const margin = { left: 52, right: 20, top: 18, bottom: 38 };
    const plotW = width - margin.left - margin.right; const plotH = height - margin.top - margin.bottom;
    const maxX = Math.max(2, ...assets.map((asset) => asset.frequencyNorm)) * 1.06;
    const maxY = Math.max(2, ...assets.map((asset) => asset.mttrNorm)) * 1.06;
    const xAt = (value) => margin.left + plotW * value / maxX;
    const yAt = (value) => margin.top + plotH * (1 - value / maxY);
    let svg = `<svg viewBox="0 0 ${width} ${height}" role="presentation">`;
    svg += `<rect x="${xAt(1)}" y="${margin.top}" width="${width - margin.right - xAt(1)}" height="${yAt(1) - margin.top}" fill="#fff4f2"/>`;
    svg += `<rect x="${margin.left}" y="${margin.top}" width="${xAt(1) - margin.left}" height="${yAt(1) - margin.top}" fill="#fff8ed"/>`;
    svg += `<rect x="${margin.left}" y="${yAt(1)}" width="${xAt(1) - margin.left}" height="${height - margin.bottom - yAt(1)}" fill="#eff8f4"/>`;
    svg += `<rect x="${xAt(1)}" y="${yAt(1)}" width="${width - margin.right - xAt(1)}" height="${height - margin.bottom - yAt(1)}" fill="#f4f1ff"/>`;
    [0, .5, 1].forEach((ratio) => {
      const x = margin.left + plotW * ratio;
      const y = margin.top + plotH * (1 - ratio);
      svg += `<line x1="${x}" y1="${margin.top}" x2="${x}" y2="${height - margin.bottom}" stroke="#e5eaf0"/>`;
      svg += `<line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" stroke="#e5eaf0"/>`;
      svg += svgText(numberFormat.format(maxX * ratio), x, height - 16, { size: 8, anchor: "middle" });
      svg += svgText(numberFormat.format(maxY * ratio), margin.left - 8, y + 3, { size: 8, anchor: "end" });
    });
    svg += `<line x1="${xAt(1)}" y1="${margin.top}" x2="${xAt(1)}" y2="${height - margin.bottom}" stroke="#aeb8c4" stroke-dasharray="4 4"/>`;
    svg += `<line x1="${margin.left}" y1="${yAt(1)}" x2="${width - margin.right}" y2="${yAt(1)}" stroke="#aeb8c4" stroke-dasharray="4 4"/>`;
    const colors = { "Grave": "#e36c69", "Agudo": "#e5a13b", "Crónico": "#8070d8", "Bajo control": "#35ad82" };
    assets.forEach((asset, index) => {
      const x = xAt(asset.frequencyNorm); const y = yAt(asset.mttrNorm);
      const radius = Math.min(8, 3 + Math.sqrt(asset.orders));
      svg += `<circle cx="${x}" cy="${y}" r="${radius}" fill="${colors[asset.classification]}" fill-opacity=".78" stroke="#fff" stroke-width="1"><title>${htmlEscape(asset.equipment)} · ${asset.classification} · ${asset.orders} fallas · MTTR ${numberFormat.format(asset.mttr)} h · R* ${numberFormat.format(asset.risk)}</title></circle>`;
      if (index < 7) svg += svgText(asset.equipment, x + 6, y - 5, { size: 7, fill: "#56677d" });
    });
    svg += svgText("Frecuencia normalizada · N*", margin.left + plotW / 2, height - 1, { size: 8, anchor: "middle", fill: "#718095" });
    svg += `<text transform="translate(12,${margin.top + plotH / 2}) rotate(-90)" text-anchor="middle" fill="#718095" font-size="8" font-family="DM Sans,Segoe UI,sans-serif">MTTR normalizado</text>`;
    svg += svgText("Agudo", margin.left + 5, margin.top + 12, { size: 8, fill: "#b8812f", weight: 600 });
    svg += svgText("Grave", width - margin.right - 35, margin.top + 12, { size: 8, fill: "#c35c59", weight: 600 });
    svg += svgText("Bajo control", margin.left + 5, height - margin.bottom - 5, { size: 8, fill: "#258861", weight: 600 });
    svg += svgText("Crónico", width - margin.right - 40, height - margin.bottom - 5, { size: 8, fill: "#7162bf", weight: 600 });
    svg += "</svg>";
    container.innerHTML = svg;
  }

  function renderPriority(assets) {
    const container = $("#priority-list");
    if (!assets.length) return emptyChart(container, "Sin reparaciones válidas.");
    const rows = assets.slice(0, 8).map((asset) => {
      const badgeClass = asset.classification.toLowerCase().replace(/\s/g, "-");
      return `<div class="priority-row"><span class="priority-equipment" title="${htmlEscape(asset.equipment)}">${htmlEscape(asset.equipment)}</span><span class="priority-number">${integerFormat.format(asset.orders)} fallas</span><span class="priority-number">${numberFormat.format(asset.mttr)} h</span><span class="priority-class ${badgeClass}">${htmlEscape(asset.classification)}</span></div>`;
    }).join("");
    container.innerHTML = `<div class="priority-row priority-head"><span>ACTIVO</span><span>FRECUENCIA</span><span>MTTR</span><span>SECTOR</span></div>${rows}`;
  }

  function render() {
    const dataset = activeDataset();
    if (!dataset) return;
    const allRows = dataset.rows;
    renderTypeFilter(allRows);
    const rows = filteredRows();
    const repairs = validRepairs(rows);
    const durations = repairs.map(repairDuration).filter((value) => value > 0);
    const repairMean = durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0;
    const uniqueOrders = distinctOrderCount(rows);
    const cost = sumField(rows, "cost");
    const labor = sumField(rows, "labor");
    const downtime = sumField(rows, "downtime");
    const dates = rows.map(getDate).filter(Boolean).sort((a, b) => a - b);

    $("#kpi-orders").textContent = integerFormat.format(uniqueOrders);
    $("#kpi-labor").textContent = `${numberFormat.format(labor)} h`;
    $("#kpi-downtime").textContent = `${numberFormat.format(downtime)} h`;
    $("#kpi-cost").textContent = `$${currencyFormat.format(cost)}`;
    $("#kpi-mttr").textContent = durations.length ? `${numberFormat.format(repairMean)} h` : "—";
    $("#kpi-mttr-foot").textContent = `${integerFormat.format(durations.length)} reparaciones válidas · mediana ${numberFormat.format(median(durations))} h`;
    $("#period-label").textContent = dates.length
      ? `${dates[0].toLocaleDateString("es-CL")} — ${dates[dates.length - 1].toLocaleDateString("es-CL")}`
      : "Período del dataset";
    $("#dataset-meta").textContent = `${integerFormat.format(allRows.length)} registros · ${Object.keys(allRows[0] || {}).length} campos · ${integerFormat.format(rows.length)} en filtro`;
    $("#updated-at").textContent = `Actualizado ${new Date().toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}`;
    $("#footer-date").textContent = new Date().toLocaleDateString("es-CL", { year: "numeric", month: "long", day: "numeric" });

    const orderEntries = sumByType(rows, "orders");
    renderBars("chart-orders", orderEntries, { format: (value) => integerFormat.format(value), colorByIndex: true, rowHeight: 30, labelWidth: 180 });
    renderImpact(rows);

    const byEquipmentType = groupRows(repairs, (row) => field(row, "equipmentType"));
    const mttrEntries = [...byEquipmentType].map(([label, items]) => {
      const values = items.map(repairDuration).filter((value) => value > 0);
      return { label, value: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0 };
    }).sort((a, b) => b.value - a.value);
    renderBars("chart-mttr", mttrEntries, { format: (value) => `${numberFormat.format(value)} h`, color: "#8070d8", rowHeight: 26, labelWidth: 190 });
    renderPareto(rows);
    const assets = computeJackknife(rows);
    renderJackknife(assets);
    renderPriority(assets);
  }

  function showStatus(message, isError = false) {
    const status = $("#status-message");
    status.textContent = message;
    status.classList.toggle("error", isError);
  }

  function wireEvents() {
    $("#file-input").addEventListener("change", async (event) => {
      const files = [...event.target.files];
      if (!files.length) return;
      showStatus(`Cargando ${files.length} archivo${files.length === 1 ? "" : "s"}…`);
      let loaded = 0;
      const failures = [];
      for (const file of files) {
        try { await loadFile(file); loaded += 1; }
        catch (error) { failures.push(error.message || `No se pudo procesar ${file.name}.`); }
      }
      if (failures.length) {
        const prefix = loaded ? `${loaded} dataset${loaded === 1 ? "" : "s"} cargado${loaded === 1 ? "" : "s"}. ` : "";
        showStatus(`${prefix}${failures.join(" ")}`, true);
      } else if (loaded) showStatus(`${loaded} dataset${loaded === 1 ? "" : "s"} cargado${loaded === 1 ? "" : "s"} correctamente.`);
      event.target.value = "";
    });
    $("#dataset-select").addEventListener("change", (event) => {
      state.activeId = event.target.value;
      state.filters = { type: "all", from: "", to: "" };
      $("#date-from").value = "";
      $("#date-to").value = "";
      render();
    });
    $("#maintenance-filter").addEventListener("change", (event) => {
      state.filters.type = event.target.value;
      render();
    });
    $("#date-from").addEventListener("change", (event) => { state.filters.from = event.target.value; render(); });
    $("#date-to").addEventListener("change", (event) => { state.filters.to = event.target.value; render(); });
    $("#reset-filters").addEventListener("click", () => {
      state.filters = { type: "all", from: "", to: "" };
      $("#date-from").value = "";
      $("#date-to").value = "";
      render();
    });
    $("#print-report").addEventListener("click", () => window.print());
  }

  async function loadSample() {
    try {
      const response = await fetch("./data/CMMS_grupo_A_tratada.csv");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const rows = validateRows(parseCsv(await response.text()), "Dataset de ejemplo");
      addDataset(rows, "CMMS_grupo_A_tratada.csv · Ejemplo");
      showStatus("Dataset de ejemplo listo. Puedes añadir otros archivos.");
    } catch {
      showStatus("Selecciona un archivo CSV o Excel para comenzar. Si usas file://, el navegador no permite cargar el ejemplo automáticamente.");
      renderDatasetOptions();
    }
  }

  wireEvents();
  loadSample();
})();
