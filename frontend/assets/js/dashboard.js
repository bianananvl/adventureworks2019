document.addEventListener('DOMContentLoaded', async () => {
    const chartInstances = {};
    const chartDataCache = {};
    const registeredCharts = {};

    // 1. Saved Preferences & Theme
    const savedTheme = localStorage.getItem('aw_theme') || 'light';
    // Colour-blind-safe palette is the default; existing users are moved onto it once.
    try {
        if (!localStorage.getItem('aw_palette_cvd_migrated')) {
            localStorage.setItem('aw_palette', 'Accessible');
            localStorage.setItem('aw_palette_cvd_migrated', '1');
        }
    } catch (err) {}
    let savedPalette = localStorage.getItem('aw_palette') || 'Accessible';
    const savedWidescreen = localStorage.getItem('aw_widescreen') === 'true';

    // Active backend currency configuration (already applied by backend SQL queries)
    let activeCurrency = {
        currency_code: 'USD',
        currency_symbol: '$',
        currency_multiplier: 1.0
    };

    const palettes = {
        // Validated categorical order: passes colour-vision-deficiency separation in light and dark mode
        Accessible: {
            primary: '#257de0',
            fill: 'rgba(37, 125, 224, 0.15)',
            colors: ['#257de0', '#f47230', '#00b894', '#f2a600', '#ee7fac', '#008a17', '#6a4ce2', '#ec4647'],
            dark: ['#338ced', '#e76624', '#00a888', '#d28e05', '#e24d8b', '#0aac23', '#9887ef', '#eb6263']
        },
        Azure: {
            primary: '#367ADF',
            fill: 'rgba(54, 122, 223, 0.18)',
            colors: ['#367ADF', '#4FACE5', '#394988', '#AED5F5', '#353A4C', '#1D4ED8', '#0284C7']
        },
        Ocean: { primary: '#0d9488', fill: 'rgba(13, 148, 136, 0.15)', colors: ['#0d9488', '#0284c7', '#38bdf8', '#2dd4bf', '#0f766e'] },
        Sunset: { primary: '#f97316', fill: 'rgba(249, 115, 22, 0.15)', colors: ['#f97316', '#ef4444', '#f59e0b', '#ec4899', '#d97706'] },
        Forest: { primary: '#16a34a', fill: 'rgba(22, 163, 74, 0.15)', colors: ['#16a34a', '#15803d', '#4ade80', '#84cc16', '#065f46'] },
        Mono: { primary: '#475569', fill: 'rgba(71, 85, 105, 0.15)', colors: ['#334155', '#64748b', '#94a3b8', '#475569', '#1e293b'] }
    };

    const presetRates = {
        USD: { code: 'USD', symbol: '$', multiplier: 1.0 },
        PHP: { code: 'PHP', symbol: '₱', multiplier: 58.2 },
        EUR: { code: 'EUR', symbol: '€', multiplier: 0.92 },
        JPY: { code: 'JPY', symbol: '¥', multiplier: 154.5 }
    };

    applyTheme(savedTheme);
    applyPaletteToUI(savedPalette);
    if (savedWidescreen) document.body.classList.add('widescreen-mode');

    const activeSession = JSON.parse(localStorage.getItem('aw_session') || '{}');
    const sessionRole = (activeSession.role || '').toUpperCase();
    const currentPageKey = document.body.getAttribute('data-page') || '';

    // Sync Settings Page Controls
    const setThemeEl = document.getElementById('set-theme');
    const setCurrencyEl = document.getElementById('set-currency');
    const setCurrencyCodeEl = document.getElementById('set-currency-code');
    const setCurrencySymbolEl = document.getElementById('set-currency-symbol');
    const setCurrencyMultEl = document.getElementById('set-currency-multiplier');
    const btnSaveCurrency = document.getElementById('btn-save-currency');
    const setPaletteEl = document.getElementById('set-palette');
    const setWidescreenEl = document.getElementById('set-widescreen');
    const setChartTypeEl = document.getElementById('set-chart-type');

    if (setThemeEl) {
        setThemeEl.value = savedTheme;
        setThemeEl.addEventListener('change', (e) => {
            localStorage.setItem('aw_theme', e.target.value);
            applyTheme(e.target.value);
        });
    }
    if (setPaletteEl) {
        setPaletteEl.value = savedPalette;
        setPaletteEl.addEventListener('change', (e) => {
            savedPalette = e.target.value;
            localStorage.setItem('aw_palette', savedPalette);
            applyPaletteToUI(savedPalette);
        });
    }
    if (setWidescreenEl) {
        setWidescreenEl.checked = savedWidescreen;
        setWidescreenEl.addEventListener('change', (e) => {
            localStorage.setItem('aw_widescreen', e.target.checked);
            document.body.classList.toggle('widescreen-mode', e.target.checked);
        });
    }
    if (setChartTypeEl) {
        setChartTypeEl.value = localStorage.getItem('aw_default_chart') || 'bar';
        setChartTypeEl.addEventListener('change', (e) => {
            localStorage.setItem('aw_default_chart', e.target.value);
        });
    }

    if (setCurrencyEl) {
        setCurrencyEl.addEventListener('change', (e) => {
            const preset = presetRates[e.target.value];
            if (preset && setCurrencyCodeEl && setCurrencySymbolEl && setCurrencyMultEl) {
                setCurrencyCodeEl.value = preset.code;
                setCurrencySymbolEl.value = preset.symbol;
                setCurrencyMultEl.value = preset.multiplier;
            }
        });
    }

    if (btnSaveCurrency) {
        btnSaveCurrency.addEventListener('click', async () => {
            const feedback = document.getElementById('settings-feedback');
            try {
                const res = await fetch('/api/settings/', {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        currency_code: setCurrencyCodeEl?.value || 'USD',
                        currency_symbol: setCurrencySymbolEl?.value || '$',
                        currency_multiplier: setCurrencyMultEl?.value || 1.0
                    })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Failed to save settings');
                activeCurrency = data;
                if (feedback) {
                    feedback.className = 'alert alert-success py-2 small mb-3';
                    feedback.textContent = `Saved global currency: ${data.currency_code} (${data.currency_symbol}) × ${data.currency_multiplier}. All reports will now display scaled figures.`;
                    feedback.classList.remove('d-none');
                }
            } catch (err) {
                if (feedback) {
                    feedback.className = 'alert alert-danger py-2 small mb-3';
                    feedback.textContent = err.message;
                    feedback.classList.remove('d-none');
                }
            }
        });
    }

    // Enforce RBAC Settings Controls (Only Administrator can edit system settings)
    if (sessionRole !== 'ADMINISTRATOR') {
        [setThemeEl, setCurrencyEl, setCurrencyCodeEl, setCurrencySymbolEl, setCurrencyMultEl, btnSaveCurrency, setPaletteEl, setWidescreenEl, setChartTypeEl].forEach(el => {
            if (el) el.disabled = true;
        });
        const settingsContainer = document.querySelector('[data-page="settings"] .container, [data-page="settings"] .container-fluid');
        if (settingsContainer) {
            const notice = document.createElement('div');
            notice.className = 'alert alert-warning py-2 small mb-3';
            notice.innerHTML = '<strong>Read-Only Configuration:</strong> Global currency multipliers and system-wide configuration are managed exclusively by System Administrators.';
            settingsContainer.prepend(notice);
        }
    }

    // Build & Enforce Top Export Toolbar (Export CSV, Export PDF, and Single Export PNG Checkbox Dropdown)
    const exportEligiblePages = ['executive', 'sales', 'customers', 'revenue_loss', 'cost'];
    const isBulkExportAllowed = ['ADMINISTRATOR', 'MANAGER', 'SUPERVISOR'].includes(sessionRole);

    if (exportEligiblePages.includes(currentPageKey)) {
        const pageHeader = document.querySelector('.container-fluid h2, .container-fluid h3');
        if (pageHeader && !document.getElementById('rbac-export-toolbar')) {
            const headerRow = document.createElement('div');
            headerRow.className = 'd-flex flex-wrap justify-content-between align-items-center gap-2 mb-1';
            pageHeader.parentNode.insertBefore(headerRow, pageHeader);
            headerRow.appendChild(pageHeader);

            const toolbar = document.createElement('div');
            toolbar.id = 'rbac-export-toolbar';
            toolbar.className = 'd-flex flex-wrap align-items-center gap-2';

            const bulkButtonsHtml = isBulkExportAllowed ? `
                <button type="button" id="btn-export-csv" class="btn btn-sm btn-outline-primary fw-semibold px-3">
                    Export CSV
                </button>
                <button type="button" id="btn-export-pdf" class="btn btn-sm btn-primary fw-semibold px-3">
                    Export PDF
                </button>
            ` : '';

            toolbar.innerHTML = `
                ${bulkButtonsHtml}
                <div class="dropdown" id="png-export-dropdown">
                    <button class="btn btn-sm btn-outline-secondary fw-semibold px-3 dropdown-toggle" type="button" id="btn-export-png-menu" data-bs-toggle="dropdown" data-bs-auto-close="outside" aria-expanded="false">
                        Export PNG
                    </button>
                    <div class="dropdown-menu dropdown-menu-end p-3 shadow" style="min-width: 270px;" id="png-export-checklist">
                        <div class="text-muted small">Loading graphs...</div>
                    </div>
                </div>
            `;
            headerRow.appendChild(toolbar);

            if (isBulkExportAllowed) {
                document.getElementById('btn-export-csv').addEventListener('click', () => {
                    const sections = collectExportTables();
                    if (sections.length === 0) {
                        alert('No tabular dataset available on this view to export.');
                        return;
                    }
                    const esc = (t) => `"${String(t).replace(/"/g, '""')}"`;
                    const csvContent = sections.map(sec => [
                        esc(sec.title),
                        ...sec.head.map(r => r.map(esc).join(',')),
                        ...sec.body.map(r => r.map(esc).join(','))
                    ].join('\n')).join('\n\n');

                    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `JBABEWorks_${currentPageKey}_${new Date().toISOString().slice(0, 10)}.csv`;
                    link.click();
                    URL.revokeObjectURL(url);
                    logExport(`${pageHeader.innerText} tables`, 'CSV');
                });

                document.getElementById('btn-export-pdf').addEventListener('click', async () => {
                    const loadScript = (src) => new Promise((resolve, reject) => {
                        const s = document.createElement('script');
                        s.src = src;
                        s.onload = resolve;
                        s.onerror = reject;
                        document.head.appendChild(s);
                    });

                    if (!window.jspdf) {
                        await loadScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js');
                    }
                    if (!window.jspdf.jsPDF.API.autoTable) {
                        await loadScript('https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js');
                    }

                    const cleanPdfText = (str) => (str || '')
                        .replace(/₱\s*/g, 'PHP ')
                        .replace(/\s+/g, ' ')
                        .trim();

                    const { jsPDF } = window.jspdf;
                    const doc = new jsPDF({ orientation: 'landscape' });

                    doc.setFillColor(27, 42, 74);
                    doc.rect(0, 0, 297, 24, 'F');
                    doc.setTextColor(255, 255, 255);
                    doc.setFontSize(15);
                    doc.text(`JBABEWorks BI Portal - ${cleanPdfText(pageHeader.innerText)}`, 14, 11);
                    doc.setFontSize(9);
                    doc.text(
                        `Generated by: ${activeSession.user || 'User'} (${activeSession.role_display || sessionRole})  |  ${new Date().toLocaleString()}`,
                        14,
                        18
                    );

                    doc.setTextColor(30, 41, 59);
                    doc.setFontSize(10);
                    let y = 33;
                    const kpiCards = Array.from(document.querySelectorAll('.kpi-card, .stat-card')).slice(0, 8);
                    kpiCards.forEach(card => {
                        const text = cleanPdfText(card.innerText);
                        if (text && text.length < 160) {
                            doc.text(`- ${text}`, 14, y);
                            y += 6.5;
                        }
                    });

                    collectExportTables().forEach(sec => {
                        const startY = (doc.lastAutoTable ? doc.lastAutoTable.finalY : y) + 10;
                        doc.setFontSize(11);
                        doc.setTextColor(30, 41, 59);
                        doc.text(cleanPdfText(sec.title), 14, startY - 2);
                        doc.autoTable({
                            startY,
                            head: sec.head.length ? sec.head.map(r => r.map(cleanPdfText)) : undefined,
                            body: sec.body.map(r => r.map(cleanPdfText)),
                            theme: 'grid',
                            headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold', fontSize: 9 },
                            bodyStyles: { fontSize: 8.5, textColor: [30, 41, 59] },
                            alternateRowStyles: { fillColor: [248, 250, 252] },
                            margin: { left: 14, right: 14 }
                        });
                    });

                    doc.save(`JBABEWorks_${currentPageKey}_${new Date().toISOString().slice(0, 10)}.pdf`);
                    logExport(`${pageHeader.innerText} report`, 'PDF');
                });
            }
        }
    }

    function collectExportTables() {
        return Array.from(document.querySelectorAll('table'))
            .filter(t => t.offsetParent !== null && !t.closest('.noprint'))
            .map(table => {
                const card = table.closest('.card');
                const title = card?.querySelector('h5')?.innerText || 'Table';
                const cellText = (c) => c.innerText.replace(/\s+/g, ' ').trim();
                const head = Array.from(table.querySelectorAll('thead tr')).map(tr => Array.from(tr.querySelectorAll('th')).map(cellText));
                const body = Array.from(table.querySelectorAll('tbody tr'))
                    .filter(tr => tr.offsetParent !== null)
                    .map(tr => Array.from(tr.querySelectorAll('td, th')).map(cellText));
                return { title, head, body };
            })
            .filter(sec => sec.body.length);
    }

    window.addEventListener('storage', (e) => {
        if (e.key === 'aw_theme') applyTheme(e.newValue);
        if (e.key === 'aw_palette') { savedPalette = e.newValue; applyPaletteToUI(savedPalette); }
    });

    // ==========================================================================
    // CONSISTENT NUMBER FORMATTING (K / M / B everywhere)
    // Backend already multiplies monetary values by SystemSettings.currency_multiplier
    // ==========================================================================
    function compactNumber(value, decimals = 2) {
        const val = Number(value || 0);
        const abs = Math.abs(val);
        const sign = val < 0 ? '-' : '';
        if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(decimals)}B`;
        if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(decimals)}M`;
        if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(decimals)}K`;
        return null;
    }

    function formatMoney(scaledAmount) {
        const symbol = activeCurrency.currency_symbol || '$';
        const val = Number(scaledAmount || 0);
        const compact = compactNumber(val);
        if (compact) return compact.startsWith('-') ? `-${symbol}${compact.slice(1)}` : `${symbol}${compact}`;
        const fixed = Math.abs(val).toFixed(activeCurrency.currency_code === 'JPY' ? 0 : 2);
        return `${val < 0 ? '-' : ''}${symbol}${fixed}`;
    }

    function formatCount(value) {
        const val = Number(value || 0);
        return compactNumber(val) || Math.round(val).toLocaleString('en-US');
    }

    function formatPct(value, decimals = 1) {
        if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
        return `${Number(value).toFixed(decimals)}%`;
    }

    function deltaBadge(pct, { invert = false, suffix = 'vs prior' } = {}) {
        if (pct === null || pct === undefined || !Number.isFinite(Number(pct))) {
            return '<span class="delta-badge delta-flat">— n/a</span>';
        }
        const v = Number(pct);
        const good = invert ? v < 0 : v > 0;
        const cls = Math.abs(v) < 0.05 ? 'delta-flat' : (good ? 'delta-up' : 'delta-down');
        const arrow = v > 0 ? '▲' : (v < 0 ? '▼' : '■');
        return `<span class="delta-badge ${cls}">${arrow} ${Math.abs(v).toFixed(1)}%${suffix ? ` <span class="delta-suffix">${suffix}</span>` : ''}</span>`;
    }

    // Growth badge that switches to like-for-like (same months) for partial years
    function growthCell(rawPct, row, lflKey = 'lfl_pct') {
        if (row && row.partial && row[lflKey] !== null && row[lflKey] !== undefined) {
            return `<span title="Like-for-like: ${escapeHtml(row.lfl_label || 'same months as prior year')}">${deltaBadge(row[lflKey], { suffix: 'LFL' })}</span>`;
        }
        return rawPct === null || rawPct === undefined ? '—' : deltaBadge(rawPct, { suffix: '' });
    }

    function pctChange(curr, prev) {
        if (prev === null || prev === undefined || Number(prev) === 0) return null;
        return ((Number(curr) - Number(prev)) / Math.abs(Number(prev))) * 100;
    }

    function escapeHtml(str) {
        return String(str ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }

    // Safe for a single-quoted JS string inside an HTML attribute (onclick="fn('...')")
    function jsAttr(str) {
        return escapeHtml(String(str ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
    }

    function setMoneyEl(id, scaledAmount) {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = formatMoney(scaledAmount);
        el.title = `${activeCurrency.currency_symbol || '$'}${Number(scaledAmount || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
    }

    function setHtml(id, html) {
        const el = document.getElementById(id);
        if (el) el.innerHTML = html;
    }

    function updateCurrencyBadge(currencyObj) {
        if (currencyObj) activeCurrency = currencyObj;
        const badge = document.getElementById('active-currency-badge');
        if (badge) {
            badge.textContent = `Currency: ${activeCurrency.currency_code} (${activeCurrency.currency_symbol}) × ${activeCurrency.currency_multiplier}`;
        }
    }

    function applyPaletteToUI(paletteName) {
        const pal = palettes[paletteName] || palettes.Accessible;
        document.documentElement.style.setProperty('--primary-accent', pal.primary);
        Object.keys(chartDataCache).forEach(id => {
            const cached = chartDataCache[id];
            if (cached && chartInstances[id]) renderChart(id, cached.type, cached.labels, cached.datasets, cached.opts);
        });
    }

    const OTHER_COLOR = '#8a8f98';
    const colorRegistry = {};

    function activeColors() {
        const pal = palettes[savedPalette] || palettes.Accessible;
        return document.body.classList.contains('dark-mode') && pal.dark ? pal.dark : pal.colors;
    }

    // Dark ink on light fills (yellow, aqua, pink), white on dark fills
    function textOn(hex) {
        const n = parseInt(String(hex).replace('#', ''), 16);
        const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
            const c = v / 255;
            return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        return (lum + 0.05) / 0.05 > 1.05 / (lum + 0.05) ? 'text-dark' : 'text-white';
    }

    // Colour follows the entity (series / category name), not its rank, so filters never repaint survivors.
    function colorFor(scope, name) {
        if (/^Other\b/.test(String(name))) return OTHER_COLOR;
        const colors = activeColors();
        const reg = colorRegistry[scope] || (colorRegistry[scope] = {});
        if (reg[name] === undefined) {
            const used = new Set(Object.values(reg));
            let slot = 0;
            while (used.has(slot) && slot < colors.length) slot++;
            reg[name] = slot < colors.length ? slot : Object.keys(reg).length % colors.length;
        }
        return colors[reg[name] % colors.length];
    }

    // Draws value labels on bars/points and % share on pie/doughnut slices
    const valueLabelPlugin = {
        id: 'valueLabels',
        afterDatasetsDraw(chart, _args, pluginOpts) {
            if (!pluginOpts || !pluginOpts.enabled) return;
            const fmt = chart.$valueFormatter || (v => String(v));
            const { ctx } = chart;
            const type = chart.config.type;
            const isDark = document.body.classList.contains('dark-mode');
            const visible = chart.data.datasets.map((_, i) => chart.isDatasetVisible(i));
            const visibleCount = visible.filter(Boolean).length;
            ctx.save();
            ctx.font = '600 11px "Instrument Sans", sans-serif';
            ctx.textAlign = 'center';

            chart.data.datasets.forEach((ds, di) => {
                if (!visible[di]) return;
                const meta = chart.getDatasetMeta(di);
                if (type === 'doughnut' || type === 'pie') {
                    const values = ds.data.map((v, i) => (chart.getDataVisibility(i) ? Number(v) || 0 : 0));
                    const total = values.reduce((a, b) => a + b, 0);
                    ctx.textBaseline = 'middle';
                    meta.data.forEach((arc, i) => {
                        if (!total || values[i] / total < 0.05) return;
                        const pos = arc.tooltipPosition();
                        const bg = Array.isArray(ds.backgroundColor) ? ds.backgroundColor[i] : ds.backgroundColor;
                        ctx.fillStyle = textOn(bg) === 'text-dark' ? '#1a1e29' : '#ffffff';
                        const pct = `${((values[i] / total) * 100).toFixed(1)}%`;
                        if (chart.$sliceValues) {
                            ctx.fillText(fmt(values[i], ds), pos.x, pos.y - 7);
                            ctx.font = '500 10px "Instrument Sans", sans-serif';
                            ctx.fillText(pct, pos.x, pos.y + 7);
                            ctx.font = '600 11px "Instrument Sans", sans-serif';
                        } else {
                            ctx.fillText(pct, pos.x, pos.y);
                        }
                    });
                    if (chart.$centerLabel && type === 'doughnut' && meta.data[0]) {
                        const { x, y } = meta.data[0];
                        ctx.fillStyle = isDark ? '#AED5F5' : '#64748b';
                        ctx.font = '500 11px "Instrument Sans", sans-serif';
                        ctx.fillText(chart.$centerLabel.title, x, y - 9);
                        ctx.fillStyle = isDark ? '#f8fafc' : '#353A4C';
                        ctx.font = '700 15px "Instrument Sans", sans-serif';
                        ctx.fillText(chart.$centerLabel.value, x, y + 9);
                        ctx.font = '600 11px "Instrument Sans", sans-serif';
                    }
                    return;
                }
                if (meta.data.length * visibleCount > 48) return;
                if (meta.type !== 'line' && meta.data.length > 1 && Math.abs(meta.data[1].x - meta.data[0].x) / Math.max(visibleCount, 1) < 46 && visibleCount > 1) return;
                if (meta.type === 'line' && (meta.data.length > 16 || ds.yAxisID === 'y1')) return;
                ctx.textBaseline = 'bottom';
                ctx.fillStyle = isDark ? '#E2E8F0' : '#353A4C';
                meta.data.forEach((el, i) => {
                    const raw = ds.data[i];
                    if (raw === null || raw === undefined || Number(raw) === 0) return;
                    const neg = Number(raw) < 0 && meta.type !== 'line';
                    ctx.textBaseline = neg ? 'top' : 'bottom';
                    ctx.fillText(fmt(raw, ds), el.x, neg ? el.y + 4 : el.y - 4);
                });
            });
            ctx.restore();
        }
    };
    if (window.Chart) Chart.register(valueLabelPlugin);

    function getChartOptions(chartType, opts = {}) {
        const isDark = document.body.classList.contains('dark-mode');
        const textColor = isDark ? '#AED5F5' : '#353A4C';
        const gridColor = isDark ? 'rgba(174, 213, 245, 0.1)' : 'rgba(53, 58, 76, 0.08)';
        const showAxes = chartType === 'bar' || chartType === 'line';
        const valueFmt = opts.percent ? (v => formatPct(v)) : (opts.money === false ? formatCount : formatMoney);
        const axisTitle = (text) => text ? { display: true, text, color: textColor, font: { weight: '600' } } : { display: false };
        const scales = {};
        if (showAxes) {
            scales.x = { stacked: !!opts.stacked, ticks: { color: textColor }, grid: { color: gridColor }, title: axisTitle(opts.xTitle) };
            scales.y = { stacked: !!opts.stacked, ticks: { color: textColor, callback: v => valueFmt(v) }, grid: { color: gridColor }, title: axisTitle(opts.yTitle) };
            if (opts.secondaryPercent) {
                scales.y1 = { position: 'right', grid: { drawOnChartArea: false }, ticks: { color: textColor, callback: v => formatPct(v, 0) }, title: axisTitle(opts.y1Title || 'Margin %') };
            }
        }
        return {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { top: opts.valueLabels ? 18 : 4 } },
            scales,
            plugins: {
                legend: { position: 'bottom', labels: { color: textColor } },
                valueLabels: { enabled: !!opts.valueLabels && !opts.stacked },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const ds = ctx.dataset;
                            const raw = ctx.raw;
                            if (raw === null || raw === undefined) return `${ds.label}: —`;
                            const isPct = ds.yAxisID === 'y1' || opts.percent;
                            let text = `${ds.label || ctx.label}: ${isPct ? formatPct(raw) : valueFmt(raw)}`;
                            if (chartType === 'doughnut' || chartType === 'pie') {
                                const total = ds.data.reduce((a, b) => a + (Number(b) || 0), 0);
                                text = `${ctx.label}: ${valueFmt(raw)} (${total ? ((raw / total) * 100).toFixed(1) : 0}%)`;
                            }
                            return text;
                        }
                    }
                }
            }
        };
    }

    // Export specific Chart.js canvas as PNG + log in backend SQLite AuditLog
    async function exportSpecificChartPng(canvasId, chartTitle) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = canvas.width;
        exportCanvas.height = canvas.height;
        const ctx = exportCanvas.getContext('2d');
        ctx.fillStyle = document.body.classList.contains('dark-mode') ? '#1e293b' : '#ffffff';
        ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
        ctx.drawImage(canvas, 0, 0);

        const slug = (chartTitle || canvasId).toLowerCase().replace(/[^a-z0-9]+/g, '_');
        const link = document.createElement('a');
        link.download = `JBABEWorks_${slug}_${new Date().toISOString().slice(0, 10)}.png`;
        link.href = exportCanvas.toDataURL('image/png');
        link.click();
        logExport(chartTitle || canvasId, 'PNG');
    }

    function logExport(name, format) {
        fetch('/api/audit/log-export/', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chart_name: name, module: currentPageKey || 'Dashboard', format })
        }).catch(() => {});
    }

    function refreshPngExportDropdown() {
        const container = document.getElementById('png-export-checklist');
        if (!container) return;

        const entries = Object.entries(registeredCharts);
        if (entries.length === 0) {
            container.innerHTML = '<div class="text-muted small">No graphs available on this view.</div>';
            return;
        }

        container.innerHTML = `
            <div class="d-flex justify-content-between align-items-center pb-2 mb-2 border-bottom">
                <small class="fw-bold text-muted">Select Graph(s) to Export</small>
                <button type="button" class="btn btn-link btn-sm p-0 text-decoration-none" id="btn-png-select-all">Select All</button>
            </div>
            <div class="d-flex flex-column gap-1 mb-3">
                ${entries.map(([id, title]) => `
                    <div class="form-check">
                        <input class="form-check-input png-chart-checkbox" type="checkbox" value="${id}" data-title="${escapeHtml(title)}" id="png-chk-${id}">
                        <label class="form-check-label small" for="png-chk-${id}">${escapeHtml(title)}</label>
                    </div>
                `).join('')}
            </div>
            <button type="button" class="btn btn-sm btn-primary w-100 fw-semibold" id="btn-download-selected-pngs">
                Download Selected PNG(s)
            </button>
        `;

        document.getElementById('btn-png-select-all')?.addEventListener('click', () => {
            const boxes = container.querySelectorAll('.png-chart-checkbox');
            const allChecked = Array.from(boxes).every(b => b.checked);
            boxes.forEach(b => { b.checked = !allChecked; });
        });

        document.getElementById('btn-download-selected-pngs')?.addEventListener('click', async () => {
            const selected = Array.from(container.querySelectorAll('.png-chart-checkbox:checked'));
            if (selected.length === 0) {
                alert('Please check at least one graph to download.');
                return;
            }
            for (let i = 0; i < selected.length; i++) {
                const box = selected[i];
                await exportSpecificChartPng(box.value, box.getAttribute('data-title'));
                if (i < selected.length - 1) {
                    await new Promise(r => setTimeout(r, 250));
                }
            }
        });
    }

    function registerChartForExport(canvas, canvasId) {
        const card = canvas.closest('.card');
        const heading = card ? card.querySelector('h5') : null;
        registeredCharts[canvasId] = heading ? heading.textContent.trim() : canvasId;
        refreshPngExportDropdown();
    }

    /**
     * opts: { money (default true), percent, valueLabels, stacked, xTitle, yTitle, secondaryPercent, y1Title }
     * datasets may carry { type: 'line', yAxisID: 'y1' } to mix a % line into a bar chart.
     */
    function renderChart(canvasId, defaultType, labels, datasets, opts = {}) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        registerChartForExport(canvas, canvasId);

        const switcher = document.querySelector(`.chart-type-switcher[data-target="${canvasId}"]`);
        const type = (switcher && switcher.value) ? switcher.value : defaultType;
        if (switcher) switcher.value = type;

        const stackToggle = document.querySelector(`.chart-stack-toggle[data-target="${canvasId}"]`);
        const effectiveOpts = { ...opts, stacked: stackToggle ? stackToggle.checked && type === 'bar' : !!opts.stacked };

        const pal = palettes[savedPalette] || palettes.Accessible;
        const isRound = type === 'pie' || type === 'doughnut';
        const perCategory = isRound || (datasets.length === 1 && opts.colorByCategory);
        const keyOf = (ds) => String(ds.label || '').replace(/\s*\([A-Z]{3}\)$/, '');
        const surface = document.body.classList.contains('dark-mode') ? '#252a38' : '#ffffff';
        const styledDatasets = datasets.map((ds) => {
            const color = datasets.length === 1 && !perCategory ? activeColors()[0] : colorFor(canvasId, keyOf(ds));
            const dsType = ds.type || type;
            if (dsType === 'line') {
                return {
                    ...ds,
                    borderColor: color,
                    backgroundColor: datasets.length === 1 ? pal.fill : color,
                    pointBackgroundColor: color,
                    pointBorderColor: surface,
                    pointRadius: 3,
                    borderWidth: 2,
                    borderDash: ds.yAxisID === 'y1' ? [6, 4] : undefined,
                    fill: datasets.length === 1 && !ds.type,
                    tension: 0.3,
                    spanGaps: true,
                    order: ds.type ? 0 : 1
                };
            }
            return {
                ...ds,
                backgroundColor: perCategory ? labels.map(l => colorFor(`${canvasId}:cat`, l)) : color,
                borderColor: surface,
                borderWidth: isRound ? 2 : { top: 0, right: 2, bottom: 0, left: 2 },
                borderRadius: type === 'bar' ? 4 : 0,
                borderSkipped: 'start',
                order: 1
            };
        });

        chartDataCache[canvasId] = { type, labels, datasets, opts };
        if (chartInstances[canvasId]) chartInstances[canvasId].destroy();

        const chart = new Chart(canvas, {
            type,
            data: { labels, datasets: styledDatasets },
            options: getChartOptions(type, effectiveOpts)
        });
        const baseFmt = effectiveOpts.percent ? (v => formatPct(v)) : (effectiveOpts.money === false ? formatCount : formatMoney);
        chart.$valueFormatter = (v, ds) => (ds && ds.yAxisID === 'y1' ? formatPct(v) : baseFmt(v));
        chart.$sliceValues = !!effectiveOpts.sliceValues;
        chart.$centerLabel = isRound ? effectiveOpts.centerLabel : null;
        if (effectiveOpts.legendValues && isRound) {
            const gen = Chart.overrides[type].plugins.legend.labels.generateLabels;
            chart.options.plugins.legend.labels.generateLabels = (c) => gen(c).map(item => {
                const v = c.data.datasets[0].data[item.index];
                return { ...item, text: `${item.text}: ${baseFmt(v)}` };
            });
            chart.update();
        }
        chartInstances[canvasId] = chart;
    }

    document.querySelectorAll('.chart-type-switcher, .chart-stack-toggle').forEach(control => {
        control.addEventListener('change', (e) => {
            const targetId = e.target.getAttribute('data-target');
            const cached = chartDataCache[targetId];
            if (!cached) return;
            const type = e.target.classList.contains('chart-type-switcher') ? e.target.value : cached.type;
            renderChart(targetId, type, cached.labels, cached.datasets, cached.opts);
        });
    });

    async function apiGet(url) {
        const res = await fetch(url, { credentials: 'same-origin' });
        if (res.status === 401) {
            localStorage.removeItem('aw_session');
            if (window.parent && window.parent !== window) {
                window.parent.location.href = '/';
            } else {
                window.location.href = '/';
            }
            throw new Error('Session expired');
        }
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || data.error || `HTTP ${res.status}`);
        return data;
    }

    function showPageError(msg) {
        const banner = document.getElementById('api-error-banner');
        if (banner) {
            banner.textContent = msg;
            banner.classList.remove('d-none');
        }
    }

    function hidePageError() {
        const banner = document.getElementById('api-error-banner');
        if (banner) banner.classList.add('d-none');
    }

    // 2. Populate Live Filters from AdventureWorks2019 (/api/filters/)
    let yearFilter = document.getElementById('global-year');
    let categoryFilter = document.getElementById('global-category');

    /**
     * Replaces a <select> with a checkbox dropdown so users can pick one, several or all values
     * (e.g. 2011 + 2012 only). The returned wrapper exposes `.value` as a comma-separated list and
     * fires a 'change' event, so the rest of the code treats it like the old <select>.
     */
    function buildMultiSelect(selectEl, items, { allLabel, noun }) {
        const id = selectEl.id;
        const wrap = document.createElement('div');
        wrap.className = 'dropdown multi-select';
        wrap.id = id;
        wrap.innerHTML = `
            <button class="btn btn-sm btn-outline-secondary dropdown-toggle multi-select-btn" type="button" data-bs-toggle="dropdown" data-bs-auto-close="outside" aria-expanded="false">${escapeHtml(allLabel)}</button>
            <div class="dropdown-menu p-2 shadow multi-select-menu">
                <div class="d-flex justify-content-between px-2 pb-1 mb-1 border-bottom">
                    <small class="fw-bold text-muted">Select one or more ${escapeHtml(noun)}</small>
                    <button type="button" class="btn btn-link btn-sm p-0 text-decoration-none ms-3 ms-clear">All</button>
                </div>
                ${items.map(it => `
                    <div class="form-check mx-2 my-1">
                        <input class="form-check-input ms-check" type="checkbox" value="${escapeHtml(it.value)}" id="${id}-cb-${escapeHtml(it.value)}">
                        <label class="form-check-label small" for="${id}-cb-${escapeHtml(it.value)}">${escapeHtml(it.label)}</label>
                    </div>`).join('')}
            </div>`;
        selectEl.replaceWith(wrap);

        const btn = wrap.querySelector('.multi-select-btn');
        const boxes = Array.from(wrap.querySelectorAll('.ms-check'));
        const labelFor = v => (items.find(i => String(i.value) === String(v)) || {}).label || v;
        const refreshLabel = () => {
            const sel = boxes.filter(b => b.checked).map(b => b.value);
            btn.textContent = sel.length === 0 || sel.length === boxes.length
                ? allLabel
                : (sel.length <= 2 ? sel.map(labelFor).join(', ') : `${sel.length} ${noun} selected`);
        };
        const emit = () => { refreshLabel(); wrap.dispatchEvent(new Event('change')); };
        boxes.forEach(b => b.addEventListener('change', emit));
        wrap.querySelector('.ms-clear').addEventListener('click', () => { boxes.forEach(b => { b.checked = false; }); emit(); });

        Object.defineProperty(wrap, 'value', {
            get: () => {
                const sel = boxes.filter(b => b.checked).map(b => b.value);
                return sel.length === boxes.length ? '' : sel.join(',');
            },
            set: (v) => {
                const want = String(v || '').split(',').filter(Boolean);
                boxes.forEach(b => { b.checked = want.includes(b.value); });
                refreshLabel();
            }
        });
        Object.defineProperty(wrap, 'disabled', {
            set: (d) => { btn.disabled = !!d; },
            get: () => btn.disabled
        });
        return wrap;
    }
    const staffCheckboxList = document.getElementById('staff-checkbox-list');
    const staffDropdownBtn = document.getElementById('staffDropdownBtn');
    const custSearch = document.getElementById('cust-search');
    const custSegFilter = document.getElementById('cust-segment');

    function getSelectedStaffIds() {
        if (!staffCheckboxList) return [];
        return Array.from(staffCheckboxList.querySelectorAll('input.staff-checkbox:checked'))
            .map(cb => cb.value);
    }

    function updateStaffDropdownLabel() {
        if (!staffDropdownBtn) return;
        const checked = Array.from(staffCheckboxList?.querySelectorAll('input.staff-checkbox:checked') || []);
        if (checked.length === 0) {
            staffDropdownBtn.textContent = 'All Sales Staff';
        } else if (checked.length === 1) {
            staffDropdownBtn.textContent = checked[0].getAttribute('data-name');
        } else {
            staffDropdownBtn.textContent = `${checked.length} Staff Selected (Comparing)`;
        }
    }

    async function initFilters() {
        if (!yearFilter && !categoryFilter && !staffCheckboxList) return;
        try {
            const meta = await apiGet('/api/filters/');
            if (meta.currency) updateCurrencyBadge(meta.currency);

            if (yearFilter && Array.isArray(meta.available_years)) {
                const ys = meta.available_years;
                yearFilter = buildMultiSelect(yearFilter, ys.map(y => ({ value: String(y), label: String(y) })),
                    { allLabel: ys.length ? `All Years (${ys[0]}–${ys[ys.length - 1]})` : 'All Years', noun: 'years' });
            }
            if (categoryFilter && Array.isArray(meta.categories)) {
                const session = JSON.parse(localStorage.getItem('aw_session') || '{}');
                const lockedCat = session.permissions?.assigned_category_id;
                categoryFilter = buildMultiSelect(categoryFilter,
                    meta.categories.map(c => ({ value: String(c.ProductCategoryID), label: c.Name })),
                    { allLabel: 'All Product Categories', noun: 'categories' });
                if (lockedCat) {
                    categoryFilter.value = String(lockedCat);
                    categoryFilter.disabled = true;
                }
            }
            if (staffCheckboxList && Array.isArray(meta.sales_staff)) {
                staffCheckboxList.innerHTML = `
                    <div class="d-flex justify-content-between px-2 pb-1 mb-1 border-bottom">
                        <small class="fw-bold text-muted">Select 2+ to compare</small>
                        <button type="button" class="btn btn-link btn-sm p-0 text-decoration-none" id="btn-clear-staff">Clear</button>
                    </div>
                ` + meta.sales_staff.map(s => `
                    <div class="form-check mx-2 my-1">
                        <input class="form-check-input staff-checkbox" type="checkbox" value="${s.staff_id}" data-name="${s.staff_name}" id="staff-cb-${s.staff_id}">
                        <label class="form-check-label small" for="staff-cb-${s.staff_id}">${s.staff_name}</label>
                    </div>
                `).join('');

                staffCheckboxList.querySelectorAll('input.staff-checkbox').forEach(cb => {
                    cb.addEventListener('change', () => {
                        updateStaffDropdownLabel();
                        loadPageData();
                    });
                });

                const clearBtn = document.getElementById('btn-clear-staff');
                if (clearBtn) {
                    clearBtn.addEventListener('click', () => {
                        staffCheckboxList.querySelectorAll('input.staff-checkbox').forEach(cb => { cb.checked = false; });
                        updateStaffDropdownLabel();
                        loadPageData();
                    });
                }
            }
        } catch (err) {
            showPageError(`Filter load error: ${err.message}`);
        }
    }

    function buildQueryString() {
        const params = new URLSearchParams();
        if (yearFilter && yearFilter.value) params.set('year', yearFilter.value);
        if (categoryFilter && categoryFilter.value) params.set('category_id', categoryFilter.value);
        if (custSegFilter && custSegFilter.value && custSegFilter.value !== 'All') {
            params.set('segment', custSegFilter.value);
        }
        const custLimit = document.getElementById('cust-limit');
        if (custLimit) params.set('limit', custLimit.value);
        const staffIds = getSelectedStaffIds();
        if (staffIds.length > 0) {
            params.set('staff_ids', staffIds.join(','));
        }
        const qs = params.toString();
        return qs ? `?${qs}` : '';
    }

    function filterVipTable() {
        const q = (custSearch?.value || '').trim().toLowerCase();
        document.querySelectorAll('#vip-table tbody tr').forEach(row => {
            const text = row.textContent.toLowerCase();
            row.style.display = text.includes(q) ? '' : 'none';
        });
    }

    // 3. Page-Specific Live Data Loaders
    const pageType = document.body.getAttribute('data-page');

    function yearLabel() {
        // A single selected year enables "vs prior year" comparisons
        const v = yearFilter ? String(yearFilter.value || '') : '';
        return v && !v.includes(',') ? v : null;
    }

    function priorSuffix() {
        const y = yearLabel();
        return y ? `vs ${Number(y) - 1}` : '';
    }

    // ---- Comparative Sales Analysis (year / quarter / month x domain) ----
    const cmpGranularity = document.getElementById('cmp-granularity');
    const cmpDimension = document.getElementById('cmp-dimension');
    const cmpMetric = document.getElementById('cmp-metric');

    async function loadSalesComparison() {
        if (!cmpGranularity) return;
        const params = new URLSearchParams(buildQueryString().replace(/^\?/, ''));
        params.set('granularity', cmpGranularity.value);
        params.set('dimension', cmpDimension?.value || 'total');
        params.set('metric', cmpMetric?.value || 'sales_amount');
        const data = await apiGet(`/api/reports/sales/compare/?${params.toString()}`);

        const isMoney = data.is_money;
        const fmt = isMoney ? formatMoney : formatCount;
        const metricLabel = cmpMetric?.selectedOptions[0]?.textContent || 'Revenue';
        const granLabel = { year: 'Year', quarter: 'Quarter', month: 'Month' }[data.granularity];

        const sub = document.getElementById('cmp-subtitle');
        if (sub) {
            sub.textContent = `${metricLabel} by ${granLabel.toLowerCase()}, compared across ${data.dimension === 'total' ? 'all sales' : data.dimension_label.toLowerCase()}`
                + (yearFilter && yearFilter.value ? ` · ${String(yearFilter.value).split(',').join(', ')} only` : ' · all years');
        }

        renderChart(
            'salesCompareChart',
            data.periods.length > 16 ? 'line' : 'bar',
            data.periods,
            data.series.map(s => ({ label: s.name, data: s.data })),
            { money: isMoney, valueLabels: data.periods.length * data.series.length <= 16, xTitle: granLabel, yTitle: `${metricLabel}${isMoney ? ` (${activeCurrency.currency_code})` : ''}` }
        );

        // YoY overlay (same quarter / month across years)
        const yoyCard = document.getElementById('sales-yoy-card');
        if (yoyCard) {
            const show = !!data.yoy_overlay && data.yoy_overlay.series.length > 1;
            yoyCard.classList.toggle('d-none', !show);
            if (show) {
                renderChart(
                    'salesYoyChart',
                    'line',
                    data.yoy_overlay.labels,
                    data.yoy_overlay.series.map(s => ({ label: String(s.year), data: s.data })),
                    { money: isMoney, xTitle: granLabel, yTitle: metricLabel }
                );
            }
        }

        setHtml('cmp-period-head', `<tr><th>${granLabel}</th><th class="text-end">${escapeHtml(metricLabel)}</th><th class="text-end">Change</th><th class="text-end">vs Prev ${granLabel}</th>${data.granularity !== 'year' ? '<th class="text-end">vs Same Period LY</th>' : ''}</tr>`);
        setHtml('cmp-period-tbody', data.period_table.map(r => `
            <tr>
                <td class="fw-semibold">${r.period}${r.partial ? ` <span class="badge bg-warning text-dark">${r.months} mo</span>` : ''}</td>
                <td class="text-end">${fmt(r.value)}</td>
                <td class="text-end">${r.change === null ? '—' : (r.change >= 0 ? '+' : '') + fmt(r.change)}</td>
                <td class="text-end">${growthCell(r.change_pct, r)}</td>
                ${data.granularity !== 'year' ? `<td class="text-end">${r.yoy_pct === null ? '—' : deltaBadge(r.yoy_pct, { suffix: '' })}</td>` : ''}
            </tr>`).join('') || '<tr><td colspan="5" class="text-center text-muted">No data for this selection.</td></tr>');

        const periods = data.periods;
        const lastP = periods[periods.length - 1] || '—';
        const prevP = periods[periods.length - 2] || '—';
        setHtml('cmp-member-head', `<tr><th>${escapeHtml(data.dimension_label)}</th><th class="text-end">Total</th><th class="text-end">Share</th><th class="text-end">${prevP}</th><th class="text-end">${lastP}</th><th class="text-end">Growth</th><th>Best ${granLabel}</th></tr>`);
        setHtml('cmp-member-tbody', data.member_table.map(m => `
            <tr>
                <td class="fw-semibold">${escapeHtml(m.name)}</td>
                <td class="text-end">${fmt(m.total)}</td>
                <td class="text-end"><div class="share-bar"><span style="width:${Math.min(m.share_pct, 100)}%"></span></div>${formatPct(m.share_pct)}</td>
                <td class="text-end">${m.previous_value === null ? '—' : fmt(m.previous_value)}</td>
                <td class="text-end">${fmt(m.latest_value)}</td>
                <td class="text-end">${m.growth_pct === null ? '—' : deltaBadge(m.growth_pct, { suffix: '' })}</td>
                <td><span class="badge bg-light text-dark border">${m.best_period}</span> ${fmt(m.best_value)}</td>
            </tr>`).join('') || '<tr><td colspan="7" class="text-center text-muted">No data for this selection.</td></tr>');
    }

    [cmpGranularity, cmpDimension, cmpMetric].forEach(el => {
        if (el) el.addEventListener('change', () => loadSalesComparison().catch(err => showPageError(`Comparison error: ${err.message}`)));
    });

    // ---- Comparative Revenue & Loss ----
    const revGranularity = document.getElementById('rev-granularity');
    const revCatMetric = document.getElementById('rev-cat-metric');
    let revCompareCache = null;

    function renderRevenueCategoryByYear() {
        if (!revCompareCache) return;
        const metric = revCatMetric?.value || 'gross_profit';
        const isPct = metric === 'margin_pct';
        const years = revCompareCache.category_years;
        const cats = revCompareCache.category_by_year;
        const partialYears = revCompareCache.partial_years || [];
        const fullIdx = years.map((y, i) => (partialYears.includes(y) ? -1 : i)).filter(i => i >= 0);
        const [ia, ib] = fullIdx.length >= 2 ? fullIdx.slice(-2) : [years.length - 2, years.length - 1];
        renderChart(
            'revCategoryYearChart',
            'bar',
            cats.map(c => c.category_name),
            years.map((y, i) => ({ label: `${y}${partialYears.includes(y) ? '*' : ''}`, data: cats.map(c => c.years[i][metric]) })),
            { money: !isPct, percent: isPct, valueLabels: cats.length * years.length <= 20, xTitle: 'Product Category', yTitle: revCatMetric?.selectedOptions[0]?.textContent }
        );
        setHtml('rev-cat-year-head', `<tr><th>Category</th>${years.map(y => `<th class="text-end">${y}${partialYears.includes(y) ? '*' : ''}</th>`).join('')}<th class="text-end">${years[ib] ?? ''} vs ${years[ia] ?? ''}</th></tr>`);
        setHtml('rev-cat-year-note', partialYears.length ? `* Partial year (${partialYears.join(', ')}); the growth column compares the latest two full years.` : '');
        setHtml('rev-cat-year-tbody', cats.map(c => {
            const vals = c.years.map(y => y[metric]);
            const ok = ia >= 0 && ib >= 0;
            const yoy = ok && !isPct ? pctChange(vals[ib], vals[ia]) : null;
            const ppDiff = ok && isPct && vals[ib] !== null && vals[ia] !== null ? vals[ib] - vals[ia] : null;
            return `<tr>
                <td class="fw-semibold">${escapeHtml(c.category_name)}</td>
                ${vals.map(v => `<td class="text-end ${!isPct && v < 0 ? 'text-danger' : ''}">${v === null ? '—' : (isPct ? formatPct(v) : formatMoney(v))}</td>`).join('')}
                <td class="text-end">${isPct ? (ppDiff === null ? '—' : `${ppDiff >= 0 ? '+' : ''}${ppDiff.toFixed(1)} pp`) : (yoy === null ? '—' : deltaBadge(yoy, { suffix: '' }))}</td>
            </tr>`;
        }).join(''));
    }

    async function loadRevenueComparison() {
        if (!revGranularity) return;
        const params = new URLSearchParams(buildQueryString().replace(/^\?/, ''));
        params.set('granularity', revGranularity.value);
        const data = await apiGet(`/api/reports/revenue-loss/compare/?${params.toString()}`);
        revCompareCache = data;
        const granLabel = { year: 'Year', quarter: 'Quarter', month: 'Month' }[data.granularity];
        const rows = data.period_table;
        const code = activeCurrency.currency_code;

        const sub = document.getElementById('rev-cmp-subtitle');
        if (sub) {
            sub.textContent = `Net revenue, COGS and gross profit by ${granLabel.toLowerCase()} with margin % (dashed) on the right axis`
                + (yearFilter && yearFilter.value ? ` · ${String(yearFilter.value).split(',').join(', ')} only` : ' · all years');
        }

        renderChart(
            'revCompareChart',
            'bar',
            rows.map(r => r.period),
            [
                { label: `Net Revenue (${code})`, data: rows.map(r => r.net_revenue) },
                { label: `COGS (${code})`, data: rows.map(r => r.cogs) },
                { label: `Gross Profit (${code})`, data: rows.map(r => r.gross_profit) },
                { label: 'Gross Margin %', data: rows.map(r => r.margin_pct), type: 'line', yAxisID: 'y1' }
            ],
            { valueLabels: rows.length <= 4, secondaryPercent: true, xTitle: granLabel, yTitle: `Amount (${code})` }
        );

        const yoyCard = document.getElementById('rev-yoy-card');
        if (yoyCard) {
            const show = !!data.yoy_overlay && data.yoy_overlay.series.length > 1;
            yoyCard.classList.toggle('d-none', !show);
            if (show) {
                renderChart('revYoyChart', 'line', data.yoy_overlay.labels,
                    data.yoy_overlay.series.map(s => ({ label: String(s.year), data: s.data })),
                    { xTitle: granLabel, yTitle: `Net Revenue (${code})` });
            }
        }

        const showYoy = data.granularity !== 'year';
        setHtml('rev-period-head', `<tr><th>${granLabel}</th><th class="text-end">Gross (Pre-Discount)</th><th class="text-end">Discounts</th><th class="text-end">Net Revenue</th><th class="text-end">COGS</th><th class="text-end">Gross Profit</th><th class="text-end">Margin</th><th class="text-end">Revenue vs Prev</th><th class="text-end">Profit vs Prev</th>${showYoy ? '<th class="text-end">Revenue vs LY</th>' : ''}</tr>`);
        setHtml('rev-period-tbody', rows.map(r => `
            <tr>
                <td class="fw-semibold">${r.period}${r.partial ? ` <span class="badge bg-warning text-dark">${r.months} mo</span>` : ''}</td>
                <td class="text-end">${formatMoney(r.gross_revenue)}</td>
                <td class="text-end text-danger">${formatMoney(r.discount_erosion)} <small class="text-muted">(${formatPct(r.discount_rate_pct)})</small></td>
                <td class="text-end">${formatMoney(r.net_revenue)}</td>
                <td class="text-end">${formatMoney(r.cogs)}</td>
                <td class="text-end ${r.gross_profit < 0 ? 'text-danger' : 'text-success'} fw-semibold">${formatMoney(r.gross_profit)}</td>
                <td class="text-end">${formatPct(r.margin_pct)}</td>
                <td class="text-end">${growthCell(r.revenue_change_pct, r, 'revenue_lfl_pct')}</td>
                <td class="text-end">${growthCell(r.profit_change_pct, r, 'profit_lfl_pct')}</td>
                ${showYoy ? `<td class="text-end">${r.revenue_yoy_pct === null ? '—' : deltaBadge(r.revenue_yoy_pct, { suffix: '' })}</td>` : ''}
            </tr>`).join('') || '<tr><td colspan="10" class="text-center text-muted">No data for this selection.</td></tr>');

        renderRevenueCategoryByYear();
    }

    if (revGranularity) revGranularity.addEventListener('change', () => loadRevenueComparison().catch(err => showPageError(`Comparison error: ${err.message}`)));
    if (revCatMetric) revCatMetric.addEventListener('change', renderRevenueCategoryByYear);

    // ---- Executive insights ----
    function buildExecutiveInsights({ sales, revLoss, yearly, selectedYear }) {
        const insights = [];
        const full = yearly.filter(y => !y.partial_year);
        const partial = yearly.filter(y => y.partial_year);

        if (selectedYear) {
            const curr = yearly.find(y => String(y.year) === String(selectedYear));
            const prev = yearly.find(y => Number(y.year) === Number(selectedYear) - 1);
            if (curr && prev) {
                if (curr.partial_year && curr.revenue_lfl_pct !== null) {
                    const g = curr.revenue_lfl_pct;
                    insights.push({ tone: g >= 0 ? 'up' : 'down', text: `<strong>${selectedYear}</strong> (${curr.active_months} months) revenue ${g >= 0 ? 'is up' : 'is down'} <strong>${formatPct(Math.abs(g))}</strong> like-for-like (${escapeHtml(curr.lfl_label)}).` });
                } else {
                    const g = pctChange(curr.net_revenue, prev.net_revenue);
                    insights.push({ tone: g >= 0 ? 'up' : 'down', text: `<strong>${selectedYear}</strong> revenue ${g >= 0 ? 'grew' : 'fell'} <strong>${formatPct(Math.abs(g))}</strong> vs ${prev.year} (${formatMoney(curr.net_revenue)} vs ${formatMoney(prev.net_revenue)}).` });
                }
            }
        } else if (full.length >= 2) {
            const a = full[full.length - 2], b = full[full.length - 1];
            const g = pctChange(b.net_revenue, a.net_revenue);
            insights.push({ tone: g >= 0 ? 'up' : 'down', text: `Latest full year <strong>${b.year}</strong> revenue ${g >= 0 ? 'grew' : 'fell'} <strong>${formatPct(Math.abs(g))}</strong> vs ${a.year} (${formatMoney(b.net_revenue)}).` });
        }
        const latest = yearly[yearly.length - 1];
        if (!selectedYear && latest && latest.partial_year && latest.revenue_lfl_pct !== null) {
            const g = latest.revenue_lfl_pct;
            insights.push({ tone: g >= 0 ? 'up' : 'down', text: `Year-to-date <strong>${latest.year}</strong> is ${g >= 0 ? 'up' : 'down'} <strong>${formatPct(Math.abs(g))}</strong> like-for-like (${escapeHtml(latest.lfl_label)}).` });
        }

        const cats = sales.sales_by_category || [];
        const catTotal = cats.reduce((acc, c) => acc + Number(c.sales_amount || 0), 0);
        if (cats.length && catTotal) {
            insights.push({ tone: 'info', text: `<strong>${escapeHtml(cats[0].category_name)}</strong> drives <strong>${formatPct((cats[0].sales_amount / catTotal) * 100)}</strong> of sales${cats.length > 1 ? `; the smallest category, ${escapeHtml(cats[cats.length - 1].category_name)}, contributes ${formatPct((cats[cats.length - 1].sales_amount / catTotal) * 100)}` : ''}.` });
        }

        const trends = sales.sales_trends || [];
        if (trends.length) {
            const peak = trends.reduce((m, t) => (Number(t.sales_amount) > Number(m.sales_amount) ? t : m), trends[0]);
            insights.push({ tone: 'info', text: `Peak month was <strong>${peak.period}</strong> at <strong>${formatMoney(peak.sales_amount)}</strong>.` });
        }

        const fs = revLoss.financial_summary || {};
        if (fs.gross_revenue_before_discount) {
            const leak = (fs.discount_erosion / fs.gross_revenue_before_discount) * 100;
            insights.push({ tone: leak > 2 ? 'down' : 'info', text: `Discounts eroded <strong>${formatMoney(fs.discount_erosion)}</strong> (${formatPct(leak)} of gross revenue); gross margin stands at <strong>${formatPct(fs.gross_margin_pct)}</strong>.` });
        }

        const neg = revLoss.negative_margin_products || [];
        if (neg.length) {
            const lossTotal = neg.reduce((acc, p) => acc + Number(p.net_margin_variance || 0), 0);
            insights.push({ tone: 'down', text: `<strong>${neg.length}</strong> product${neg.length > 1 ? 's' : ''} sold below standard cost, losing <strong>${formatMoney(Math.abs(lossTotal))}</strong>. See Revenue &amp; Loss for details.` });
        }

        if (partial.length) {
            insights.push({ tone: 'warn', text: `${partial.map(p => `${p.year} (${p.active_months} mo)`).join(', ')} ${partial.length > 1 ? 'are' : 'is'} partial — compare year-over-year with caution.` });
        }
        return insights;
    }

    function renderInsights(list) {
        const el = document.getElementById('exec-insights');
        if (!el) return;
        const icons = { up: '▲', down: '▼', info: '●', warn: '!' };
        el.innerHTML = list.length
            ? list.map(i => `<li class="insight insight-${i.tone}"><span class="insight-icon">${icons[i.tone]}</span><span>${i.text}</span></li>`).join('')
            : '<li class="text-muted small">No insights available for this selection.</li>';
    }

    async function loadPageData() {
        hidePageError();
        const qs = buildQueryString();
        try {
            if (pageType === 'executive') {
                const [overview, sales, revLoss] = await Promise.all([
                    apiGet(`/api/dashboard/${qs}`),
                    apiGet(`/api/reports/sales/${qs}`),
                    apiGet(`/api/reports/revenue-loss/${qs}`)
                ]);
                if (sales.currency) updateCurrencyBadge(sales.currency);

                const sKpi = sales.kpis || {};
                const fSum = revLoss.financial_summary || {};
                const segs = overview.modules?.customers || [];
                const yearly = overview.yearly_overview || [];
                const selectedYear = yearLabel();
                const totalCust = segs.reduce((sum, s) => sum + Number(s.customer_count || 0), 0);
                const avgOrder = sKpi.total_orders ? (sKpi.total_sales_amount / sKpi.total_orders) : 0;

                setMoneyEl('kpi-total-sales', sKpi.total_sales_amount);
                setHtml('kpi-total-orders', `${formatCount(sKpi.total_orders)} orders · ${formatCount(sKpi.total_units_sold)} units`);
                const custEl = document.getElementById('kpi-active-customers');
                if (custEl) custEl.textContent = formatCount(totalCust);
                const marginEl = document.getElementById('kpi-gross-margin');
                if (marginEl) marginEl.textContent = formatPct(fSum.gross_margin_pct);
                setMoneyEl('kpi-avg-order', avgOrder);

                // YoY deltas: exactly one year selected; partial years compare the same months (like-for-like)
                const prior = overview.prior_year;
                const curr = selectedYear ? yearly.find(y => String(y.year) === String(selectedYear)) : null;
                const hint = selectedYear ? '<span class="delta-badge delta-flat">No prior-year data</span>' : '<span class="delta-badge delta-flat">Select one year to compare</span>';
                const sfx = prior?.comparison_label || priorSuffix();
                if (prior) {
                    setHtml('kpi-sales-delta', deltaBadge(pctChange(sKpi.total_sales_amount, prior.total_sales_amount), { suffix: sfx }));
                    setHtml('kpi-cust-delta', curr ? deltaBadge(pctChange(curr.customers, prior.customers), { suffix: sfx }) : hint);
                    setHtml('kpi-aov-delta', deltaBadge(pctChange(avgOrder, prior.avg_order_value), { suffix: sfx }));
                    const pp = Number(fSum.gross_margin_pct || 0) - Number(prior.gross_margin_pct || 0);
                    setHtml('kpi-margin-delta', `<span class="delta-badge ${Math.abs(pp) < 0.05 ? 'delta-flat' : (pp > 0 ? 'delta-up' : 'delta-down')}">${pp > 0 ? '▲' : (pp < 0 ? '▼' : '■')} ${Math.abs(pp).toFixed(1)} pp <span class="delta-suffix">${sfx}</span></span>`);
                } else {
                    ['kpi-sales-delta', 'kpi-cust-delta', 'kpi-aov-delta', 'kpi-margin-delta'].forEach(id => setHtml(id, hint));
                }

                const trends = sales.sales_trends || [];
                renderChart(
                    'execTrendChart',
                    'line',
                    trends.map(t => t.period),
                    [{ label: `Net Sales (${activeCurrency.currency_code})`, data: trends.map(t => Number(t.sales_amount || 0)) }],
                    { xTitle: 'Month', yTitle: `Net Sales (${activeCurrency.currency_code})` }
                );

                const cats = sales.sales_by_category || [];
                renderChart(
                    'execCategoryChart',
                    'doughnut',
                    cats.map(c => c.category_name),
                    [{ label: `Category Sales (${activeCurrency.currency_code})`, data: cats.map(c => Number(c.sales_amount || 0)) }],
                    { valueLabels: true }
                );

                renderChart(
                    'execYearlyChart',
                    'bar',
                    yearly.map(y => y.partial_year ? `${y.year}*` : String(y.year)),
                    [
                        { label: `Net Revenue (${activeCurrency.currency_code})`, data: yearly.map(y => y.net_revenue) },
                        { label: `Gross Profit (${activeCurrency.currency_code})`, data: yearly.map(y => y.gross_profit) },
                        { label: 'Gross Margin %', data: yearly.map(y => y.margin_pct), type: 'line', yAxisID: 'y1' }
                    ],
                    { valueLabels: true, secondaryPercent: true, xTitle: 'Year (* partial year)', yTitle: `Amount (${activeCurrency.currency_code})` }
                );

                setHtml('exec-yearly-tbody', yearly.map(y => `
                    <tr class="${String(y.year) === String(selectedYear) ? 'table-active' : ''}">
                        <td class="fw-semibold">${y.year}${y.partial_year ? ` <span class="badge bg-warning text-dark">${y.active_months} mo</span>` : ''}</td>
                        <td class="text-end">${formatMoney(y.net_revenue)}</td>
                        <td class="text-end">${growthCell(y.revenue_growth_pct, { ...y, partial: y.partial_year, lfl_label: y.lfl_label }, 'revenue_lfl_pct')}</td>
                        <td class="text-end">${formatMoney(y.gross_profit)}</td>
                        <td class="text-end">${formatPct(y.margin_pct)}</td>
                        <td class="text-end">${formatCount(y.total_orders)}</td>
                        <td class="text-end">${formatCount(y.customers)}</td>
                    </tr>`).join(''));

                renderInsights(buildExecutiveInsights({ sales, revLoss, yearly, selectedYear }));
                await loadSavedConfigs();
            }

            if (pageType === 'sales') {
                const [sales] = await Promise.all([
                    apiGet(`/api/reports/sales/${qs}`),
                    loadSalesComparison()
                ]);
                if (sales.currency) updateCurrencyBadge(sales.currency);

                const k = sales.kpis || {};
                const prior = sales.prior_year;
                setMoneyEl('sales-kpi-revenue', k.total_sales_amount);
                const ordEl = document.getElementById('sales-kpi-orders');
                if (ordEl) ordEl.textContent = formatCount(k.total_orders);
                const unitEl = document.getElementById('sales-kpi-units');
                if (unitEl) unitEl.textContent = formatCount(k.total_units_sold);
                setMoneyEl('sales-kpi-avg-line', k.avg_line_value);
                const sfx = prior?.comparison_label || priorSuffix();
                const noCmp = yearLabel() ? (getSelectedStaffIds().length ? '<span class="delta-badge delta-flat">Staff filter active</span>' : '<span class="delta-badge delta-flat">No prior-year data</span>') : '<span class="delta-badge delta-flat">Select one year to compare</span>';
                setHtml('sales-kpi-revenue-delta', prior ? deltaBadge(pctChange(k.total_sales_amount, prior.total_sales_amount), { suffix: sfx }) : noCmp);
                setHtml('sales-kpi-orders-delta', prior ? deltaBadge(pctChange(k.total_orders, prior.total_orders), { suffix: sfx }) : noCmp);
                setHtml('sales-kpi-units-delta', prior ? deltaBadge(pctChange(k.total_units_sold, prior.total_units_sold), { suffix: sfx }) : noCmp);
                setHtml('sales-kpi-aov-delta', prior ? deltaBadge(pctChange(k.total_orders ? k.total_sales_amount / k.total_orders : 0, prior.avg_order_value), { suffix: `AOV ${sfx}` }) : noCmp);

                // Multi-Staff Year-over-Year Comparison Chart
                const compRows = sales.staff_comparison || [];
                const selectedIds = getSelectedStaffIds();
                const compSub = document.getElementById('staff-comp-subtitle');
                if (compSub) {
                    compSub.textContent = selectedIds.length >= 2
                        ? `Comparing ${selectedIds.length} selected sales staff across all recorded years (${activeCurrency.currency_code}).`
                        : selectedIds.length === 1
                            ? 'Showing yearly performance for 1 selected staff member. Check 1+ more to compare side-by-side.'
                            : 'Showing all sales staff across years. Use the Compare Sales Staff filter above to isolate 2+ staff.';
                }

                const years = Array.from(new Set(compRows.map(r => r.year))).sort((a, b) => a - b);
                const staffNames = Array.from(new Set(compRows.map(r => r.staff_name)));
                const staffDatasets = staffNames.map(name => ({
                    label: name,
                    data: years.map(yr => {
                        const match = compRows.find(r => r.year === yr && r.staff_name === name);
                        return match ? Number(match.sales_amount || 0) : 0;
                    })
                }));
                renderChart('staffComparisonChart', 'bar', years.map(String), staffDatasets,
                    { valueLabels: selectedIds.length > 0 && selectedIds.length <= 4, xTitle: 'Year', yTitle: `Sales (${activeCurrency.currency_code})` });

                const cats = sales.sales_by_category || [];
                const totalCatSales = cats.reduce((acc, c) => acc + Number(c.sales_amount || 0), 0);
                const tileGrid = document.getElementById('category-tile-grid');
                if (tileGrid) {
                    tileGrid.innerHTML = cats.map((c) => {
                        const share = totalCatSales ? ((c.sales_amount / totalCatSales) * 100).toFixed(1) : '0.0';
                        const bg = colorFor('salesCategoryChart:cat', c.category_name);
                        const textClass = textOn(bg);
                        return `
                            <div class="col-6">
                                <div class="p-4 ${textClass} rounded shadow-sm territory-tile" style="background-color: ${bg};"
                                     data-bs-toggle="modal" data-bs-target="#detailModal"
                                     onclick="showCategoryDetail('${jsAttr(c.category_name)}', '${formatMoney(c.sales_amount)}', '${share}%', '${formatCount(c.units_sold)}')">
                                    <h5 class="fw-bold mb-1">${escapeHtml(c.category_name)}</h5>
                                    <div class="money-val fw-semibold">${formatMoney(c.sales_amount)}</div>
                                    <small>${share}% Share · ${formatCount(c.units_sold)} units</small>
                                </div>
                            </div>`;
                    }).join('');
                }

                renderChart(
                    'salesCategoryChart',
                    'bar',
                    cats.map(c => c.category_name),
                    [{ label: `Category Revenue (${activeCurrency.currency_code})`, data: cats.map(c => Number(c.sales_amount || 0)) }],
                    { valueLabels: true, colorByCategory: true, xTitle: 'Product Category', yTitle: `Revenue (${activeCurrency.currency_code})` }
                );

                const productRow = (p, idx, strong) => `
                    <tr>
                        <td>${idx + 1}</td>
                        <td class="${strong ? 'fw-semibold' : ''}">${escapeHtml(p.product_name)}</td>
                        <td><code>${p.ProductNumber}</code></td>
                        <td class="text-end">${formatCount(p.units_sold)}</td>
                        <td class="text-end money-val ${strong ? 'fw-bold' : ''}">${formatMoney(p.total_sales)}</td>
                    </tr>`;
                setHtml('top-products-tbody', (sales.top_products || []).map((p, i) => productRow(p, i, true)).join(''));
                setHtml('low-products-tbody', (sales.low_products || []).map((p, i) => productRow(p, i, false)).join(''));
            }

            if (pageType === 'customers') {
                const cust = await apiGet(`/api/reports/customers/${qs}`);
                if (cust.currency) updateCurrencyBadge(cust.currency);

                const segs = cust.segments || [];
                const freqs = cust.frequency_distribution || [];
                const vips = cust.high_value_customers || [];
                setHtml('cust-top-n', String(cust.top_limit || vips.length));
                const totalSpend = segs.reduce((a, s) => a + Number(s.total_spend || 0), 0);
                const totalCust = segs.reduce((a, s) => a + Number(s.customer_count || 0), 0);

                const segCards = document.getElementById('segment-summary-row');
                if (segCards) {
                    segCards.innerHTML = segs.map(s => {
                        const isStore = s.customer_segment.startsWith('B2B');
                        return `
                        <div class="col-md-6">
                            <div class="card p-3 border-0 shadow-sm stat-card">
                                <div class="d-flex justify-content-between align-items-center">
                                    <small class="text-muted">${escapeHtml(s.customer_segment)}</small>
                                    <span class="badge ${isStore ? 'bg-primary' : 'bg-info text-dark'}">${isStore ? 'B2B Store' : 'B2C Individual'}</span>
                                </div>
                                <div class="d-flex justify-content-between align-items-baseline mt-1">
                                    <h3 class="fw-bold mb-0">${formatCount(s.customer_count)} <small class="fs-6 fw-normal text-muted">customers</small></h3>
                                    <span class="fw-bold text-accent money-val">${formatMoney(s.total_spend)}</span>
                                </div>
                                <div class="d-flex flex-wrap gap-2 mt-2">
                                    <span class="label-chip">Orders: ${formatCount(s.total_orders)}</span>
                                    <span class="label-chip">Avg Order: ${formatMoney(s.avg_order_value)}</span>
                                    <span class="label-chip">Customer Share: ${formatPct(totalCust ? (s.customer_count / totalCust) * 100 : 0)}</span>
                                    <span class="label-chip">Revenue Share: ${formatPct(totalSpend ? (s.total_spend / totalSpend) * 100 : 0)}</span>
                                </div>
                            </div>
                        </div>`;
                    }).join('');
                }

                renderChart(
                    'segmentChart',
                    'doughnut',
                    segs.map(s => s.customer_segment),
                    [{ label: `Total Spend (${activeCurrency.currency_code})`, data: segs.map(s => Number(s.total_spend || 0)) }],
                    { valueLabels: true, sliceValues: true, legendValues: true, centerLabel: { title: 'Total Spend', value: formatMoney(totalSpend) }, xTitle: 'Segment', yTitle: `Total Spend (${activeCurrency.currency_code})` }
                );

                const tierOrder = ['1 Order (One-Time)', '2-4 Orders (Repeat)', '5-9 Orders (Loyal)', '10+ Orders (VIP)'];
                const sortedFreqs = [...freqs].sort((a, b) => tierOrder.indexOf(a.frequency_tier) - tierOrder.indexOf(b.frequency_tier));
                renderChart(
                    'frequencyChart',
                    'bar',
                    sortedFreqs.map(f => f.frequency_tier),
                    [{ label: 'Customers', data: sortedFreqs.map(f => Number(f.customer_count || 0)) }],
                    { money: false, valueLabels: true, xTitle: 'Order Frequency Tier', yTitle: 'Number of Customers' }
                );

                const loyaltyClass = { VIP: 'label-vip', Loyal: 'label-loyal', Repeat: 'label-repeat', 'One-Time': 'label-onetime' };
                const valueClass = { Platinum: 'label-platinum', Gold: 'label-gold', Silver: 'label-silver' };
                const vipBody = document.getElementById('vip-tbody');
                if (vipBody) {
                    vipBody.innerHTML = vips.map((c, idx) => {
                        const lastDate = c.last_order_date ? String(c.last_order_date).slice(0, 10) : 'N/A';
                        const badgeClass = c.segment === 'Store' ? 'bg-primary' : 'bg-info text-dark';
                        return `
                            <tr style="cursor:pointer;" data-bs-toggle="modal" data-bs-target="#detailModal"
                                onclick="showCustomerDetail('${jsAttr(c.customer_name)}', '${c.segment_label}', '${c.AccountNumber}', '${formatMoney(c.total_spend)}', ${c.order_frequency}, '${lastDate}', '${c.loyalty_label}', '${c.value_label}', '${formatMoney(c.avg_order_value)}')">
                                <td>${idx + 1}</td>
                                <td class="fw-semibold">${escapeHtml(c.customer_name)}</td>
                                <td><code>${c.AccountNumber}</code></td>
                                <td><span class="badge ${badgeClass}">${c.segment_label}</span></td>
                                <td>
                                    <span class="cust-label ${valueClass[c.value_label] || ''}">${c.value_label}</span>
                                    <span class="cust-label ${loyaltyClass[c.loyalty_label] || ''}">${c.loyalty_label}</span>
                                </td>
                                <td class="text-end">${formatCount(c.order_frequency)}</td>
                                <td class="text-end money-val fw-bold">${formatMoney(c.total_spend)}</td>
                                <td class="text-end money-val">${formatMoney(c.avg_order_value)}</td>
                                <td>${lastDate}</td>
                            </tr>
                        `;
                    }).join('');
                    filterVipTable();
                }
            }

            if (pageType === 'revenue_loss') {
                const [rev] = await Promise.all([
                    apiGet(`/api/reports/revenue-loss/${qs}`),
                    loadRevenueComparison()
                ]);
                if (rev.currency) updateCurrencyBadge(rev.currency);

                const s = rev.financial_summary || {};
                const prior = rev.prior_year;
                const leakageRate = s.gross_revenue_before_discount
                    ? (s.discount_erosion / s.gross_revenue_before_discount) * 100
                    : 0;

                setMoneyEl('rev-gross-before', s.gross_revenue_before_discount);
                setMoneyEl('rev-discount-erosion', s.discount_erosion);
                const leakEl = document.getElementById('rev-leakage-rate');
                if (leakEl) leakEl.textContent = `${formatPct(leakageRate)} of gross revenue`;
                setMoneyEl('rev-net-product', s.net_product_revenue);
                setMoneyEl('rev-gross-profit', s.gross_profit);
                const gmEl = document.getElementById('rev-gross-margin');
                if (gmEl) gmEl.textContent = `${formatPct(s.gross_margin_pct)} Gross Margin`;

                const sfx = prior?.comparison_label || priorSuffix();
                const hint = yearLabel() ? '<span class="delta-badge delta-flat">No prior-year data</span>' : '<span class="delta-badge delta-flat">Select one year to compare</span>';
                setHtml('rev-gross-delta', prior ? deltaBadge(pctChange(s.gross_revenue_before_discount, prior.gross_revenue_before_discount), { suffix: sfx }) : hint);
                setHtml('rev-discount-delta', prior ? deltaBadge(pctChange(s.discount_erosion, prior.discount_erosion), { suffix: sfx, invert: true }) : hint);
                setHtml('rev-net-delta', prior ? deltaBadge(pctChange(s.net_product_revenue, prior.total_sales_amount), { suffix: sfx }) : hint);
                setHtml('rev-profit-delta', prior ? deltaBadge(pctChange(s.gross_profit, prior.gross_profit), { suffix: sfx }) : hint);

                const govNote = document.getElementById('rev-governance-note');
                if (govNote && rev.governance?.documented_limitation) {
                    govNote.textContent = rev.governance.documented_limitation;
                }

                const lossBody = document.getElementById('negative-margin-tbody');
                const negItems = rev.negative_margin_products || [];
                if (lossBody) {
                    if (negItems.length === 0) {
                        lossBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3">No negative-margin products recorded for this filter selection.</td></tr>';
                    } else {
                        lossBody.innerHTML = negItems.map(item => `
                            <tr>
                                <td class="fw-semibold">${escapeHtml(item.product_name)}</td>
                                <td>${escapeHtml(item.category_name)}</td>
                                <td class="text-end">${formatCount(item.units_sold)}</td>
                                <td class="text-end money-val">${formatMoney(item.net_revenue)}</td>
                                <td class="text-end money-val">${formatMoney(item.standard_cogs)}</td>
                                <td class="text-end money-val text-danger fw-bold">${formatMoney(item.net_margin_variance)}</td>
                            </tr>
                        `).join('');
                    }
                }
            }

            if (pageType === 'cost') {
                const cost = await apiGet(`/api/reports/cost/${qs}`);
                if (cost.currency) updateCurrencyBadge(cost.currency);

                const sc = cost.sales_side_costs || {};
                const pc = cost.procurement_costs || {};

                setMoneyEl('cost-standard-cogs', sc.total_standard_cogs);
                setMoneyEl('cost-outbound-freight', sc.outbound_freight_cost);
                setMoneyEl('cost-tax-amount', sc.tax_amount);
                setMoneyEl('cost-procurement-spend', pc.total_procurement_spend);
                const poSub = document.getElementById('cost-po-count');
                if (poSub) poSub.textContent = `${formatCount(pc.total_purchase_orders)} Purchase Orders`;

                const catCosts = cost.cost_by_category || [];
                renderChart(
                    'costCategoryChart',
                    'bar',
                    catCosts.map(c => c.category_name),
                    [
                        { label: `Total COGS (${activeCurrency.currency_code})`, data: catCosts.map(c => Number(c.total_cogs || 0)) },
                        { label: `Total Revenue (${activeCurrency.currency_code})`, data: catCosts.map(c => Number(c.total_revenue || 0)) }
                    ],
                    { valueLabels: true, xTitle: 'Product Category', yTitle: `Amount (${activeCurrency.currency_code})` }
                );

                const catBody = document.getElementById('cost-category-tbody');
                if (catBody) {
                    catBody.innerHTML = catCosts.map(c => `
                        <tr>
                            <td class="fw-semibold">${c.category_name}</td>
                            <td class="text-end money-val">${formatMoney(c.total_cogs)}</td>
                            <td class="text-end money-val">${formatMoney(c.total_revenue)}</td>
                            <td class="text-end"><span class="badge ${c.cost_to_revenue_ratio_pct > 65 ? 'bg-warning text-dark' : 'bg-primary'}">${formatPct(c.cost_to_revenue_ratio_pct)}</span></td>
                        </tr>
                    `).join('');
                }

                const prodBody = document.getElementById('top-cost-products-tbody');
                if (prodBody) {
                    prodBody.innerHTML = (cost.top_cost_products || []).map((p, idx) => `
                        <tr>
                            <td>${idx + 1}</td>
                            <td class="fw-semibold">${p.product_name}</td>
                            <td class="text-end money-val">${formatMoney(p.unit_standard_cost)}</td>
                            <td class="text-end">${formatCount(p.units_sold)}</td>
                            <td class="text-end money-val fw-bold">${formatMoney(p.cumulative_cogs)}</td>
                        </tr>
                    `).join('');
                }
            }

            if (pageType === 'rbac') {
                await renderRbacTable();
            }

            if (pageType === 'audit') {
                await renderAuditTable();
            }

            if (pageType === 'settings') {
                await loadAdminSettings();
            }

            if (pageType === 'profile') {
                renderLiveProfile();
            }
        } catch (err) {
            showPageError(`Database / API Error: ${err.message}`);
        }
    }

    // 4. Saved Report Configurations (Live CRUD with RBAC)
    async function loadSavedConfigs() {
        const listEl = document.getElementById('saved-configs-tbody');
        if (!listEl) return;
        const session = JSON.parse(localStorage.getItem('aw_session') || '{}');
        const canDelete = Boolean(session.permissions?.can_delete_reports);

        try {
            const data = await apiGet('/api/configs/');
            const reports = data.saved_reports || [];
            if (reports.length === 0) {
                listEl.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3">No saved report configurations yet. Create one above!</td></tr>';
                return;
            }
            listEl.innerHTML = reports.map(r => `
                <tr>
                    <td class="fw-semibold">${r.title}</td>
                    <td><span class="badge bg-primary">${r.module}</span></td>
                    <td><code>${JSON.stringify(r.filter_params)}</code></td>
                    <td>${r.consultant_notes || '—'}</td>
                    <td class="text-end">
                        ${canDelete ? `<button class="btn btn-sm btn-outline-danger" onclick="deleteSavedConfig(${r.id})">Delete</button>` : '<span class="text-muted small">View Only</span>'}
                    </td>
                </tr>
            `).join('');
        } catch (err) {
            listEl.innerHTML = `<tr><td colspan="5" class="text-danger">${err.message}</td></tr>`;
        }
    }

    const configForm = document.getElementById('save-config-form');
    if (configForm) {
        configForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const payload = {
                title: document.getElementById('cfg-title').value.trim(),
                module: document.getElementById('cfg-module').value,
                filter_params: {
                    year: yearFilter?.value || 'All',
                    category_id: categoryFilter?.value || 'All'
                },
                consultant_notes: document.getElementById('cfg-notes').value.trim()
            };
            const res = await fetch('/api/configs/create/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!res.ok) {
                alert(data.error || 'Permission denied.');
                return;
            }
            configForm.reset();
            loadSavedConfigs();
        });
    }

    window.deleteSavedConfig = async function(reportId) {
        const res = await fetch(`/api/configs/${reportId}/delete/`, {
            method: 'DELETE',
            credentials: 'same-origin'
        });
        const data = await res.json();
        if (!res.ok) {
            alert(data.error || 'Delete permission denied.');
            return;
        }
        loadSavedConfigs();
    };

    // 5. User Management & RBAC (Administrator) — separate from Audit Logs
    let rbacCache = { users: [], roles: [], matrix: {} };

    async function apiSend(url, body, method = 'POST') {
        const res = await fetch(url, {
            method,
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body || {})
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return data;
    }

    function roleOptions(selected) {
        return rbacCache.roles.map(r => `<option value="${r.key}" ${r.key === selected ? 'selected' : ''}>${escapeHtml(r.label)}</option>`).join('');
    }

    function showRbacFeedback(msg, ok = true) {
        const el = document.getElementById('rbac-feedback');
        if (!el) return;
        el.className = `alert ${ok ? 'alert-success' : 'alert-danger'} py-2 small mb-3`;
        el.textContent = msg;
        clearTimeout(showRbacFeedback._t);
        showRbacFeedback._t = setTimeout(() => el.classList.add('d-none'), 5000);
    }

    function renderUserRows() {
        const tbody = document.getElementById('rbac-users-tbody');
        if (!tbody) return;
        const q = (document.getElementById('user-search')?.value || '').trim().toLowerCase();
        const roleF = document.getElementById('user-role-filter')?.value || '';
        const statusF = document.getElementById('user-status-filter')?.value || '';
        const me = (activeSession.user || activeSession.username || '').toLowerCase();
        const rows = rbacCache.users.filter(u =>
            (!q || `${u.username} ${u.full_name} ${u.email}`.toLowerCase().includes(q)) &&
            (!roleF || u.role === roleF) &&
            (!statusF || (statusF === 'active') === u.is_active)
        );
        tbody.innerHTML = rows.map(u => {
            const isMe = u.username.toLowerCase() === me;
            return `
            <tr class="${u.is_active ? '' : 'row-inactive'}">
                <td>
                    <div class="d-flex align-items-center gap-2">
                        <span class="user-avatar">${escapeHtml(u.username.slice(0, 2).toUpperCase())}</span>
                        <div>
                            <div class="fw-semibold">${escapeHtml(u.username)}${isMe ? ' <span class="badge bg-secondary">You</span>' : ''}</div>
                            <small class="text-muted">${escapeHtml(u.full_name || '—')}${u.email ? ` · ${escapeHtml(u.email)}` : ''}</small>
                        </div>
                    </div>
                </td>
                <td><span class="badge role-badge role-${u.role.toLowerCase()}">${escapeHtml(u.role_display)}</span></td>
                <td><span class="badge ${u.is_active ? 'bg-success' : 'bg-secondary'}">${u.is_active ? 'Active' : 'Inactive'}</span></td>
                <td class="small">${u.last_login || '<span class="text-muted">Never</span>'}</td>
                <td class="small">${u.date_joined}</td>
                <td class="text-end text-nowrap">
                    <button class="btn btn-sm btn-outline-primary" onclick="openUserModal(${u.id})">Edit</button>
                    <button class="btn btn-sm btn-outline-secondary" onclick="openPasswordModal(${u.id})">Reset Password</button>
                    <button class="btn btn-sm ${u.is_active ? 'btn-outline-warning' : 'btn-outline-success'}" ${isMe ? 'disabled' : ''} onclick="toggleUserActive(${u.id})">${u.is_active ? 'Deactivate' : 'Activate'}</button>
                    <button class="btn btn-sm btn-outline-danger" ${isMe ? 'disabled' : ''} onclick="deleteUser(${u.id})">Delete</button>
                </td>
            </tr>`;
        }).join('') || '<tr><td colspan="6" class="text-center text-muted py-3">No users match your filters.</td></tr>';
    }

    function renderPermissionMatrix() {
        const head = document.getElementById('rbac-matrix-head');
        const body = document.getElementById('rbac-matrix-tbody');
        if (!head || !body) return;
        const permLabels = {
            can_view_executive: 'Executive', can_view_sales: 'Sales', can_view_customers: 'Customers',
            can_view_revenue_loss: 'Revenue & Loss', can_view_cost: 'Cost', can_view_audit: 'Audit Logs',
            can_view_rbac: 'RBAC', can_manage_users: 'Manage Users', can_edit_settings: 'Settings',
            can_export: 'Export', can_edit_reports: 'Create Notes', can_delete_reports: 'Delete Notes'
        };
        const keys = Object.keys(permLabels);
        head.innerHTML = `<tr><th>Role</th><th class="text-center">Users</th>${keys.map(k => `<th class="text-center small">${permLabels[k]}</th>`).join('')}</tr>`;
        body.innerHTML = rbacCache.roles.map(r => {
            const perms = rbacCache.matrix[r.key] || {};
            return `<tr>
                <td class="fw-semibold text-nowrap">${escapeHtml(r.label)}<br><code class="small">${r.key}</code></td>
                <td class="text-center">${r.user_count}</td>
                ${keys.map(k => `<td class="text-center">${perms[k] ? '<span class="perm-yes" title="Allowed">✓</span>' : '<span class="perm-no" title="Denied">✕</span>'}</td>`).join('')}
            </tr>`;
        }).join('');
    }

    async function renderRbacTable() {
        const tbody = document.getElementById('rbac-users-tbody');
        if (!tbody) return;
        const data = await apiGet('/api/rbac/');
        rbacCache = { users: data.users || [], roles: data.roles || [], matrix: data.rbac_matrix || {} };

        const s = data.summary || {};
        setHtml('rbac-stat-total', formatCount(s.total));
        setHtml('rbac-stat-active', formatCount(s.active));
        setHtml('rbac-stat-inactive', formatCount(s.inactive));
        setHtml('rbac-stat-admins', formatCount(s.administrators));

        const roleFilter = document.getElementById('user-role-filter');
        if (roleFilter && roleFilter.options.length <= 1) {
            roleFilter.innerHTML = '<option value="">All Roles</option>' + roleOptions('');
        }
        renderUserRows();
        renderPermissionMatrix();
    }

    ['user-search', 'user-role-filter', 'user-status-filter'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', renderUserRows);
    });

    function getModal(id) {
        const el = document.getElementById(id);
        return el && window.bootstrap ? bootstrap.Modal.getOrCreateInstance(el) : null;
    }

    window.openUserModal = function(userId) {
        const u = rbacCache.users.find(x => x.id === userId);
        const isNew = !u;
        document.getElementById('user-modal-title').textContent = isNew ? 'Add New User' : `Edit User · ${u.username}`;
        document.getElementById('um-id').value = isNew ? '' : u.id;
        const unameEl = document.getElementById('um-username');
        unameEl.value = isNew ? '' : u.username;
        unameEl.disabled = !isNew;
        document.getElementById('um-first').value = isNew ? '' : u.first_name;
        document.getElementById('um-last').value = isNew ? '' : u.last_name;
        document.getElementById('um-email').value = isNew ? '' : u.email;
        document.getElementById('um-role').innerHTML = roleOptions(isNew ? 'SALES_ANALYST' : u.role);
        document.getElementById('um-active').checked = isNew ? true : u.is_active;
        document.getElementById('um-password-group').classList.toggle('d-none', !isNew);
        document.getElementById('um-password').value = '';
        document.getElementById('um-password').required = isNew;
        document.getElementById('um-error').classList.add('d-none');
        updateRolePreview();
        getModal('userModal')?.show();
    };

    function updateRolePreview() {
        const el = document.getElementById('um-role-preview');
        const role = document.getElementById('um-role')?.value;
        if (!el || !role) return;
        const p = rbacCache.matrix[role] || {};
        const modules = [['can_view_executive', 'Executive'], ['can_view_sales', 'Sales'], ['can_view_customers', 'Customers'], ['can_view_revenue_loss', 'Revenue & Loss'], ['can_view_cost', 'Cost'], ['can_view_audit', 'Audit Logs'], ['can_manage_users', 'User Management'], ['can_edit_settings', 'Settings']]
            .filter(([k]) => p[k]).map(([, l]) => `<span class="label-chip">${l}</span>`).join(' ');
        el.innerHTML = `<small class="text-muted d-block mb-1">This role can access:</small>${modules || '<span class="text-muted small">Profile only</span>'}`;
    }
    document.getElementById('um-role')?.addEventListener('change', updateRolePreview);

    document.getElementById('user-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const errEl = document.getElementById('um-error');
        errEl.classList.add('d-none');
        const id = document.getElementById('um-id').value;
        const payload = {
            first_name: document.getElementById('um-first').value.trim(),
            last_name: document.getElementById('um-last').value.trim(),
            email: document.getElementById('um-email').value.trim(),
            role: document.getElementById('um-role').value,
            is_active: document.getElementById('um-active').checked
        };
        try {
            if (id) {
                await apiSend(`/api/rbac/users/${id}/`, payload);
                showRbacFeedback(`User updated successfully.`);
            } else {
                payload.username = document.getElementById('um-username').value.trim();
                payload.password = document.getElementById('um-password').value;
                await apiSend('/api/rbac/users/', payload);
                showRbacFeedback(`User '${payload.username}' created.`);
            }
            getModal('userModal')?.hide();
            await renderRbacTable();
        } catch (err) {
            errEl.textContent = err.message;
            errEl.classList.remove('d-none');
        }
    });

    window.openPasswordModal = function(userId) {
        const u = rbacCache.users.find(x => x.id === userId);
        if (!u) return;
        document.getElementById('pw-user-id').value = u.id;
        document.getElementById('pw-username').textContent = u.username;
        document.getElementById('pw-new').value = '';
        document.getElementById('pw-confirm').value = '';
        document.getElementById('pw-error').classList.add('d-none');
        getModal('passwordModal')?.show();
    };

    document.getElementById('password-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const errEl = document.getElementById('pw-error');
        const pw = document.getElementById('pw-new').value;
        if (pw !== document.getElementById('pw-confirm').value) {
            errEl.textContent = 'Passwords do not match.';
            errEl.classList.remove('d-none');
            return;
        }
        try {
            await apiSend(`/api/rbac/users/${document.getElementById('pw-user-id').value}/reset-password/`, { password: pw });
            getModal('passwordModal')?.hide();
            showRbacFeedback(`Password reset for '${document.getElementById('pw-username').textContent}'.`);
        } catch (err) {
            errEl.textContent = err.message;
            errEl.classList.remove('d-none');
        }
    });

    window.toggleUserActive = async function(userId) {
        const u = rbacCache.users.find(x => x.id === userId);
        if (!u) return;
        try {
            await apiSend(`/api/rbac/users/${u.id}/`, { role: u.role, is_active: !u.is_active });
            showRbacFeedback(`${u.username} ${u.is_active ? 'deactivated' : 'activated'}.`);
            await renderRbacTable();
        } catch (err) {
            showRbacFeedback(err.message, false);
        }
    };

    window.deleteUser = async function(userId) {
        const u = rbacCache.users.find(x => x.id === userId);
        if (!u || !confirm(`Permanently delete user '${u.username}'? This cannot be undone.\n\nTip: deactivate instead to keep their history.`)) return;
        try {
            await apiSend(`/api/rbac/users/${u.id}/delete/`, {});
            showRbacFeedback(`User '${u.username}' deleted.`);
            await renderRbacTable();
        } catch (err) {
            showRbacFeedback(err.message, false);
        }
    };

    document.getElementById('btn-add-user')?.addEventListener('click', () => window.openUserModal(null));

    // 6. Audit Logs (separate page: filters, pagination, activity charts, CSV export)
    let auditPage = 1;
    const auditFilterIds = ['audit-user', 'audit-action', 'audit-module', 'audit-status', 'audit-from', 'audit-to'];

    function auditQuery(extra = {}) {
        const params = new URLSearchParams();
        const map = { 'audit-user': 'username', 'audit-action': 'action', 'audit-module': 'module', 'audit-status': 'status', 'audit-from': 'date_from', 'audit-to': 'date_to' };
        auditFilterIds.forEach(id => {
            const el = document.getElementById(id);
            if (el && el.value) params.set(map[id], el.value);
        });
        const q = document.getElementById('audit-search')?.value.trim();
        if (q) params.set('q', q);
        const size = document.getElementById('audit-page-size')?.value;
        if (size) params.set('page_size', size);
        Object.entries(extra).forEach(([k, v]) => params.set(k, v));
        return params.toString();
    }

    function fillSelect(id, values, allLabel) {
        const el = document.getElementById(id);
        if (!el) return;
        const current = el.value;
        el.innerHTML = `<option value="">${allLabel}</option>` + values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
        el.value = values.includes(current) ? current : '';
    }

    function actionBadgeClass(action, status) {
        if (status === 'FAILED' || status === 'DENIED') return 'bg-danger';
        if (action.startsWith('USER_')) return 'bg-warning text-dark';
        if (action.startsWith('EXPORT')) return 'bg-success';
        if (action.startsWith('LOGIN') || action === 'LOGOUT') return 'bg-info text-dark';
        return 'bg-primary';
    }

    async function renderAuditTable() {
        const tbody = document.getElementById('audit-tbody');
        if (!tbody) return;
        const data = await apiGet(`/api/audit/?${auditQuery({ page: auditPage })}`);
        const logs = data.audit_logs || [];
        const pg = data.pagination || { page: 1, pages: 1, total: logs.length };
        const sm = data.summary || {};
        const fo = data.filter_options || {};

        fillSelect('audit-user', fo.usernames || [], 'All Users');
        fillSelect('audit-action', fo.actions || [], 'All Actions');
        fillSelect('audit-module', fo.modules || [], 'All Modules');

        setHtml('audit-stat-total', formatCount(sm.total_events));
        setHtml('audit-stat-users', formatCount(sm.unique_users));
        setHtml('audit-stat-failed', formatCount(sm.failed_logins));
        setHtml('audit-stat-admin', formatCount(sm.admin_changes));

        tbody.innerHTML = logs.length ? logs.map(l => `
            <tr class="${l.status !== 'SUCCESS' ? 'row-alert' : ''}">
                <td class="text-nowrap"><code>${l.timestamp}</code></td>
                <td class="fw-semibold">${escapeHtml(l.username)}</td>
                <td class="small">${escapeHtml(l.role)}</td>
                <td><span class="badge ${actionBadgeClass(l.action, l.status)}">${escapeHtml(l.action)}</span></td>
                <td><span class="badge bg-light text-dark border">${escapeHtml(l.module || 'System')}</span></td>
                <td><span class="badge ${l.status === 'SUCCESS' ? 'bg-success' : 'bg-danger'}">${l.status}</span></td>
                <td class="small text-muted">${escapeHtml(l.ip_address || '—')}</td>
                <td class="small">${escapeHtml(l.details || '—')}</td>
            </tr>`).join('') : '<tr><td colspan="8" class="text-center text-muted py-3">No audit entries match these filters.</td></tr>';

        const start = pg.total ? (pg.page - 1) * pg.page_size + 1 : 0;
        const end = Math.min(pg.page * pg.page_size, pg.total);
        setHtml('audit-page-info', `Showing ${start}–${end} of ${pg.total.toLocaleString('en-US')} entries · Page ${pg.page} of ${pg.pages}`);
        const prevBtn = document.getElementById('audit-prev');
        const nextBtn = document.getElementById('audit-next');
        if (prevBtn) prevBtn.disabled = pg.page <= 1;
        if (nextBtn) nextBtn.disabled = pg.page >= pg.pages;
        auditPage = pg.page;

        const daily = sm.daily || [];
        renderChart('auditDailyChart', 'bar', daily.map(d => d.day.slice(5)), [{ label: 'Events', data: daily.map(d => d.count) }],
            { money: false, valueLabels: true, xTitle: 'Date (last 14 days)', yTitle: 'Events' });
        const byAction = sm.by_action || [];
        renderChart('auditActionChart', 'doughnut', byAction.map(a => a.action), [{ label: 'Events', data: byAction.map(a => a.count) }],
            { money: false, valueLabels: true });
    }

    function reloadAudit(resetPage = true) {
        if (resetPage) auditPage = 1;
        renderAuditTable().catch(err => showPageError(`Audit log error: ${err.message}`));
    }

    if (pageType === 'audit') {
        auditFilterIds.concat(['audit-page-size']).forEach(id => document.getElementById(id)?.addEventListener('change', () => reloadAudit()));
        let searchTimer;
        document.getElementById('audit-search')?.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => reloadAudit(), 300);
        });
        document.getElementById('audit-prev')?.addEventListener('click', () => { auditPage -= 1; reloadAudit(false); });
        document.getElementById('audit-next')?.addEventListener('click', () => { auditPage += 1; reloadAudit(false); });
        document.getElementById('audit-reset')?.addEventListener('click', () => {
            auditFilterIds.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
            const s = document.getElementById('audit-search');
            if (s) s.value = '';
            reloadAudit();
        });
        document.getElementById('audit-export-csv')?.addEventListener('click', () => {
            window.location.href = `/api/audit/export/?${auditQuery()}`;
        });
        document.querySelectorAll('[data-audit-range]').forEach(btn => btn.addEventListener('click', () => {
            const days = Number(btn.getAttribute('data-audit-range'));
            const to = new Date();
            const from = new Date(Date.now() - (days - 1) * 86400000);
            const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            document.getElementById('audit-from').value = iso(from);
            document.getElementById('audit-to').value = iso(to);
            reloadAudit();
        }));
    }

    async function loadAdminSettings() {
        const cfg = await apiGet('/api/settings/');
        activeCurrency = cfg;
        if (setCurrencyCodeEl) setCurrencyCodeEl.value = cfg.currency_code;
        if (setCurrencySymbolEl) setCurrencySymbolEl.value = cfg.currency_symbol;
        if (setCurrencyMultEl) setCurrencyMultEl.value = cfg.currency_multiplier;
        if (setCurrencyEl) {
            setCurrencyEl.value = presetRates[cfg.currency_code] ? cfg.currency_code : 'CUSTOM';
        }
        const metaEl = document.getElementById('currency-updated-meta');
        if (metaEl && cfg.updated_by) {
            metaEl.textContent = `Last updated by ${cfg.updated_by} at ${cfg.updated_at}`;
        }
    }

    function renderLiveProfile() {
        const session = JSON.parse(localStorage.getItem('aw_session') || '{}');
        const rules = window.CURRENT_RBAC || {};
        const username = session.user || 'admin';
        const roleDisplay = session.role_display || rules.label || 'System Administrator';
        const perms = session.permissions || {};

        const initialsEl = document.getElementById('prof-initials');
        if (initialsEl) initialsEl.textContent = username.slice(0, 2).toUpperCase();
        const nameEl = document.getElementById('prof-name');
        if (nameEl) nameEl.textContent = username;
        const roleEl = document.getElementById('prof-role');
        if (roleEl) roleEl.textContent = `${roleDisplay} · AdventureWorks2019 SQL Server`;
        const handleEl = document.getElementById('prof-username');
        if (handleEl) handleEl.textContent = username;
        const scopeEl = document.getElementById('prof-scope');
        if (scopeEl) scopeEl.textContent = perms.assigned_category_id
            ? `Restricted to Category ID #${perms.assigned_category_id}`
            : `${roleDisplay} Access Scope`;

        const permMap = {
            'perm-sales': perms.can_view_sales,
            'perm-customers': perms.can_view_customers,
            'perm-revloss': perms.can_view_revenue_loss,
            'perm-cost': perms.can_view_cost,
            'perm-export': perms.can_export,
            'perm-edit': perms.can_edit_reports,
            'perm-delete': perms.can_delete_reports
        };
        Object.entries(permMap).forEach(([id, allowed]) => {
            const badge = document.getElementById(id);
            if (!badge) return;
            badge.textContent = allowed ? 'Allowed' : 'Restricted';
            badge.className = `badge rounded-pill px-3 py-2 ${allowed ? 'bg-success' : 'bg-secondary'}`;
        });
    }

    if (custSearch) custSearch.addEventListener('input', filterVipTable);
    if (custSegFilter) custSegFilter.addEventListener('change', loadPageData);
    document.getElementById('cust-limit')?.addEventListener('change', loadPageData);

    await initFilters();
    [yearFilter, categoryFilter].forEach(el => {
        if (el) el.addEventListener('change', loadPageData);
    });
    await loadPageData();
});

// Global Helpers (Theme & Modals)
function applyTheme(theme) {
    const isDark = theme === 'dark';
    document.documentElement.classList.toggle('dark-mode', isDark);
    document.body.classList.toggle('dark-mode', isDark);
    try {
        if (window.parent && window.parent !== window) {
            window.parent.document.documentElement.classList.toggle('dark-mode', isDark);
            window.parent.document.body.classList.toggle('dark-mode', isDark);
        }
    } catch (err) {}
}

function showCategoryDetail(name, sales, share, units) {
    document.getElementById('modalTitle').textContent = `${name} — Category Performance`;
    document.getElementById('modalBody').innerHTML = `
        <p><strong>Total Category Revenue:</strong> ${sales} (${share} of filtered sales)</p>
        <p class="mb-0"><strong>Total Units Sold:</strong> ${units} units</p>
    `;
}

function showCustomerDetail(name, segment, accountNum, spend, orders, lastDate, loyalty, valueTier, avgOrder) {
    document.getElementById('modalTitle').textContent = `${name} (${accountNum})`;
    document.getElementById('modalBody').innerHTML = `
        <div class="d-flex flex-wrap gap-2 mb-3">
            <span class="badge bg-primary">${segment}</span>
            ${valueTier ? `<span class="cust-label label-${valueTier.toLowerCase()}">${valueTier}</span>` : ''}
            ${loyalty ? `<span class="cust-label label-${loyalty.toLowerCase().replace(/[^a-z]/g, '')}">${loyalty}</span>` : ''}
        </div>
        <p><strong>Lifetime Spend:</strong> ${spend} | <strong>Avg Order:</strong> ${avgOrder || '—'}</p>
        <p><strong>Order Frequency:</strong> ${orders} orders | <strong>Last Order Date:</strong> ${lastDate}</p>
        <div class="alert alert-info mb-0 small">
            <strong>Label rules:</strong> Value tier = rank by lifetime spend in this list (Top 3 Platinum, 4–8 Gold, rest Silver).
            Loyalty = order count (1 One-Time, 2–4 Repeat, 5–9 Loyal, 10+ VIP).
        </div>
    `;
}
