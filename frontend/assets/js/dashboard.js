document.addEventListener('DOMContentLoaded', async () => {
    const chartInstances = {};
    const chartDataCache = {};

    // 1. Saved Preferences & Theme
    const savedTheme = localStorage.getItem('aw_theme') || 'light';
    let savedPalette = localStorage.getItem('aw_palette') || 'Azure';
    const savedWidescreen = localStorage.getItem('aw_widescreen') === 'true';

    // Active backend currency configuration (already applied by backend SQL queries)
    let activeCurrency = {
        currency_code: 'USD',
        currency_symbol: '$',
        currency_multiplier: 1.0
    };

    const palettes = {
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

    // Build & Enforce RBAC Export Controls (CSV & PDF) on Reporting Modules
    const exportEligiblePages = ['executive', 'sales', 'customers', 'revenue_loss', 'cost'];
    const isBulkExportAllowed = ['ADMINISTRATOR', 'MANAGER', 'SUPERVISOR'].includes(sessionRole);

    if (exportEligiblePages.includes(currentPageKey) && isBulkExportAllowed) {
        const pageHeader = document.querySelector('.container-fluid h2, .container-fluid h3');
        if (pageHeader && !document.getElementById('rbac-export-toolbar')) {
            const headerRow = document.createElement('div');
            headerRow.className = 'd-flex flex-wrap justify-content-between align-items-center gap-2 mb-1';
            pageHeader.parentNode.insertBefore(headerRow, pageHeader);
            headerRow.appendChild(pageHeader);

            const toolbar = document.createElement('div');
            toolbar.id = 'rbac-export-toolbar';
            toolbar.className = 'd-flex gap-2';
            toolbar.innerHTML = `
                <button type="button" id="btn-export-csv" class="btn btn-sm btn-outline-primary fw-semibold px-3">
                    Export CSV
                </button>
                <button type="button" id="btn-export-pdf" class="btn btn-sm btn-primary fw-semibold px-3">
                    Export PDF
                </button>
            `;
            headerRow.appendChild(toolbar);

            document.getElementById('btn-export-csv').addEventListener('click', () => {
                const table = document.querySelector('table');
                if (!table) {
                    alert('No tabular dataset available on this view to export.');
                    return;
                }
                const rows = Array.from(table.querySelectorAll('tr')).filter(r => r.offsetParent !== null);
                const csvContent = rows.map(row =>
                    Array.from(row.querySelectorAll('th, td'))
                        .map(cell => `"${cell.innerText.replace(/\s+/g, ' ').trim().replace(/"/g, '""')}"`)
                        .join(',')
                ).join('\n');

                const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `JBABEWorks_${currentPageKey}_${new Date().toISOString().slice(0, 10)}.csv`;
                link.click();
                URL.revokeObjectURL(url);
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
                const kpiCards = Array.from(document.querySelectorAll('.card')).slice(0, 4);
                kpiCards.forEach(card => {
                    const text = cleanPdfText(card.innerText);
                    if (text && text.length < 130) {
                        doc.text(`- ${text}`, 14, y);
                        y += 6.5;
                    }
                });

                const table = document.querySelector('table');
                if (table) {
                    const headRows = Array.from(table.querySelectorAll('thead tr')).map(tr =>
                        Array.from(tr.querySelectorAll('th')).map(th => cleanPdfText(th.innerText))
                    );
                    const bodyRows = Array.from(table.querySelectorAll('tbody tr'))
                        .filter(tr => tr.offsetParent !== null)
                        .map(tr => Array.from(tr.querySelectorAll('td')).map(td => cleanPdfText(td.innerText)));

                    doc.autoTable({
                        startY: y + 4,
                        head: headRows.length ? headRows : undefined,
                        body: bodyRows,
                        theme: 'grid',
                        headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold', fontSize: 9 },
                        bodyStyles: { fontSize: 8.5, textColor: [30, 41, 59] },
                        alternateRowStyles: { fillColor: [248, 250, 252] },
                        margin: { left: 14, right: 14 }
                    });
                }

                doc.save(`JBABEWorks_${currentPageKey}_${new Date().toISOString().slice(0, 10)}.pdf`);
            });
        }
    }

    window.addEventListener('storage', (e) => {
        if (e.key === 'aw_theme') applyTheme(e.newValue);
        if (e.key === 'aw_palette') { savedPalette = e.newValue; applyPaletteToUI(savedPalette); }
    });

    // Backend already multiplies monetary values by SystemSettings.currency_multiplier
    function formatMoney(scaledAmount) {
        const symbol = activeCurrency.currency_symbol || '$';
        const code = activeCurrency.currency_code || 'USD';
        const val = Number(scaledAmount || 0);
        if (Math.abs(val) >= 1000000) return `${symbol}${(val / 1000000).toFixed(2)}M`;
        if (Math.abs(val) >= 100000) return `${symbol}${(val / 1000).toFixed(1)}K`;
        return `${symbol}${val.toLocaleString('en-US', {
            minimumFractionDigits: code === 'JPY' ? 0 : 2,
            maximumFractionDigits: code === 'JPY' ? 0 : 2
        })}`;
    }

    function setMoneyEl(id, scaledAmount) {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = formatMoney(scaledAmount);
    }

    function updateCurrencyBadge(currencyObj) {
        if (currencyObj) activeCurrency = currencyObj;
        const badge = document.getElementById('active-currency-badge');
        if (badge) {
            badge.textContent = `Currency: ${activeCurrency.currency_code} (${activeCurrency.currency_symbol}) × ${activeCurrency.currency_multiplier}`;
        }
    }

    function applyPaletteToUI(paletteName) {
        const pal = palettes[paletteName] || palettes.Azure;
        document.documentElement.style.setProperty('--primary-accent', pal.primary);
        Object.keys(chartInstances).forEach(id => {
            const chart = chartInstances[id];
            const cached = chartDataCache[id];
            if (!chart || !cached) return;
            chart.data.datasets.forEach((ds, idx) => {
                if (chart.config.type === 'line') {
                    ds.borderColor = pal.colors[idx % pal.colors.length];
                    ds.backgroundColor = cached.datasets.length === 1 ? pal.fill : 'transparent';
                } else {
                    ds.backgroundColor = cached.datasets.length > 1
                        ? pal.colors[idx % pal.colors.length]
                        : pal.colors;
                }
            });
            chart.update();
        });
    }

    function getChartOptions(chartType) {
        const isDark = document.body.classList.contains('dark-mode');
        const textColor = isDark ? '#AED5F5' : '#353A4C';
        const gridColor = isDark ? 'rgba(174, 213, 245, 0.1)' : 'rgba(53, 58, 76, 0.08)';
        const showAxes = chartType === 'bar' || chartType === 'line';
        return {
            responsive: true,
            maintainAspectRatio: false,
            scales: showAxes ? {
                x: { ticks: { color: textColor }, grid: { color: gridColor } },
                y: { ticks: { color: textColor }, grid: { color: gridColor } }
            } : {},
            plugins: { legend: { position: 'bottom', labels: { color: textColor } } }
        };
    }

    // Export specific Chart.js canvas as PNG + log in backend SQLite AuditLog
    async function exportSpecificChartPng(canvasId, chartTitle) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        // Paint white/theme background behind transparent canvas so PNG looks crisp
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

        try {
            await fetch('/api/audit/log-export/', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chart_name: chartTitle || canvasId,
                    module: currentPageKey || 'Dashboard'
                })
            });
        } catch (err) {}
    }

    function attachChartExportButton(canvas, canvasId) {
        const card = canvas.closest('.card');
        if (!card || card.querySelector(`.btn-export-png[data-canvas="${canvasId}"]`)) return;

        const heading = card.querySelector('h5');
        const chartTitle = heading ? heading.textContent.trim() : canvasId;
        const switcher = card.querySelector(`.chart-type-switcher[data-target="${canvasId}"]`);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-sm btn-outline-secondary btn-export-png ms-2';
        btn.setAttribute('data-canvas', canvasId);
        btn.textContent = 'Export PNG';
        btn.addEventListener('click', () => exportSpecificChartPng(canvasId, chartTitle));

        if (switcher && switcher.parentNode) {
            const group = document.createElement('div');
            group.className = 'd-flex align-items-center';
            switcher.parentNode.insertBefore(group, switcher);
            group.appendChild(switcher);
            group.appendChild(btn);
        } else if (heading) {
            const row = document.createElement('div');
            row.className = 'd-flex justify-content-between align-items-center mb-2';
            heading.parentNode.insertBefore(row, heading);
            row.appendChild(heading);
            row.appendChild(btn);
        }
    }

    function renderChart(canvasId, defaultType, labels, datasets) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        attachChartExportButton(canvas, canvasId);

        const switcher = document.querySelector(`.chart-type-switcher[data-target="${canvasId}"]`);
        const type = (switcher && switcher.value) ? switcher.value : defaultType;
        if (switcher) switcher.value = type;

        const pal = palettes[savedPalette] || palettes.Azure;
        const styledDatasets = datasets.map((ds, idx) => ({
            ...ds,
            borderColor: type === 'line' ? pal.colors[idx % pal.colors.length] : undefined,
            backgroundColor: type === 'line'
                ? (datasets.length === 1 ? pal.fill : 'transparent')
                : (datasets.length > 1 ? pal.colors[idx % pal.colors.length] : pal.colors),
            fill: type === 'line' && datasets.length === 1,
            tension: 0.35
        }));

        chartDataCache[canvasId] = { type, labels, datasets };
        if (chartInstances[canvasId]) chartInstances[canvasId].destroy();

        chartInstances[canvasId] = new Chart(canvas, {
            type,
            data: { labels, datasets: styledDatasets },
            options: getChartOptions(type)
        });
    }

    document.querySelectorAll('.chart-type-switcher').forEach(select => {
        select.addEventListener('change', (e) => {
            const targetId = e.target.getAttribute('data-target');
            const cached = chartDataCache[targetId];
            if (cached) renderChart(targetId, e.target.value, cached.labels, cached.datasets);
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
    const yearFilter = document.getElementById('global-year');
    const categoryFilter = document.getElementById('global-category');
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
                yearFilter.innerHTML = '<option value="">All Years (2011–2014)</option>' +
                    meta.available_years.map(y => `<option value="${y}">${y}</option>`).join('');
            }
            if (categoryFilter && Array.isArray(meta.categories)) {
                const session = JSON.parse(localStorage.getItem('aw_session') || '{}');
                const lockedCat = session.permissions?.assigned_category_id;
                categoryFilter.innerHTML = '<option value="">All Product Categories</option>' +
                    meta.categories.map(c => `<option value="${c.ProductCategoryID}">${c.Name}</option>`).join('');
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
                const totalCust = segs.reduce((sum, s) => sum + Number(s.customer_count || 0), 0);
                const avgOrder = sKpi.total_orders ? (sKpi.total_sales_amount / sKpi.total_orders) : 0;

                setMoneyEl('kpi-total-sales', sKpi.total_sales_amount);
                const ordersSub = document.getElementById('kpi-total-orders');
                if (ordersSub) ordersSub.textContent = `${Number(sKpi.total_orders || 0).toLocaleString()} orders · ${Number(sKpi.total_units_sold || 0).toLocaleString()} units`;

                const custEl = document.getElementById('kpi-active-customers');
                if (custEl) custEl.textContent = totalCust.toLocaleString();

                const marginEl = document.getElementById('kpi-gross-margin');
                if (marginEl) marginEl.textContent = `${Number(fSum.gross_margin_pct || 0).toFixed(2)}%`;

                setMoneyEl('kpi-avg-order', avgOrder);

                const trends = sales.sales_trends || [];
                renderChart(
                    'execTrendChart',
                    'line',
                    trends.map(t => t.period),
                    [{ label: `Net Sales (${activeCurrency.currency_code})`, data: trends.map(t => Number(t.sales_amount || 0)) }]
                );

                const cats = sales.sales_by_category || [];
                renderChart(
                    'execCategoryChart',
                    'doughnut',
                    cats.map(c => c.category_name),
                    [{ label: `Category Sales (${activeCurrency.currency_code})`, data: cats.map(c => Number(c.sales_amount || 0)) }]
                );

                await loadSavedConfigs();
            }

            if (pageType === 'sales') {
                const sales = await apiGet(`/api/reports/sales/${qs}`);
                if (sales.currency) updateCurrencyBadge(sales.currency);

                const k = sales.kpis || {};
                setMoneyEl('sales-kpi-revenue', k.total_sales_amount);
                const ordEl = document.getElementById('sales-kpi-orders');
                if (ordEl) ordEl.textContent = Number(k.total_orders || 0).toLocaleString();
                const unitEl = document.getElementById('sales-kpi-units');
                if (unitEl) unitEl.textContent = Number(k.total_units_sold || 0).toLocaleString();
                setMoneyEl('sales-kpi-avg-line', k.avg_line_value);

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
                renderChart('staffComparisonChart', 'bar', years.map(String), staffDatasets);

                const cats = sales.sales_by_category || [];
                const totalCatSales = cats.reduce((acc, c) => acc + Number(c.sales_amount || 0), 0);
                const tileGrid = document.getElementById('category-tile-grid');
                if (tileGrid) {
                    const pal = palettes[savedPalette] || palettes.Azure;
                    tileGrid.innerHTML = cats.map((c, idx) => {
                        const share = totalCatSales ? ((c.sales_amount / totalCatSales) * 100).toFixed(1) : '0.0';
                        const bg = pal.colors[idx % pal.colors.length];
                        const textClass = bg.toUpperCase() === '#AED5F5' ? 'text-dark' : 'text-white';
                        return `
                            <div class="col-6">
                                <div class="p-4 ${textClass} rounded shadow-sm territory-tile" style="background-color: ${bg};"
                                     data-bs-toggle="modal" data-bs-target="#detailModal"
                                     onclick="showCategoryDetail('${c.category_name}', '${formatMoney(c.sales_amount)}', '${share}%', ${c.units_sold})">
                                    <h5 class="fw-bold mb-1">${c.category_name}</h5>
                                    <div class="money-val fw-semibold">${formatMoney(c.sales_amount)}</div>
                                    <small>${share}% Share · ${Number(c.units_sold).toLocaleString()} units</small>
                                </div>
                            </div>`;
                    }).join('');
                }

                renderChart(
                    'salesCategoryChart',
                    'bar',
                    cats.map(c => c.category_name),
                    [{ label: `Category Revenue (${activeCurrency.currency_code})`, data: cats.map(c => Number(c.sales_amount || 0)) }]
                );

                renderChart(
                    'salesTrendChart',
                    'line',
                    (sales.sales_trends || []).map(t => t.period),
                    [{ label: `Monthly Revenue (${activeCurrency.currency_code})`, data: (sales.sales_trends || []).map(t => Number(t.sales_amount || 0)) }]
                );

                const topBody = document.getElementById('top-products-tbody');
                if (topBody) {
                    topBody.innerHTML = (sales.top_products || []).map((p, idx) => `
                        <tr>
                            <td>${idx + 1}</td>
                            <td class="fw-semibold">${p.product_name}</td>
                            <td><code>${p.ProductNumber}</code></td>
                            <td>${Number(p.units_sold).toLocaleString()}</td>
                            <td class="money-val fw-bold">${formatMoney(p.total_sales)}</td>
                        </tr>
                    `).join('');
                }

                const lowBody = document.getElementById('low-products-tbody');
                if (lowBody) {
                    lowBody.innerHTML = (sales.low_products || []).map((p, idx) => `
                        <tr>
                            <td>${idx + 1}</td>
                            <td>${p.product_name}</td>
                            <td><code>${p.ProductNumber}</code></td>
                            <td>${Number(p.units_sold).toLocaleString()}</td>
                            <td class="money-val">${formatMoney(p.total_sales)}</td>
                        </tr>
                    `).join('');
                }
            }

            if (pageType === 'customers') {
                const cust = await apiGet(`/api/reports/customers/${qs}`);
                if (cust.currency) updateCurrencyBadge(cust.currency);

                const segs = cust.segments || [];
                const freqs = cust.frequency_distribution || [];
                const vips = cust.high_value_customers || [];

                const segCards = document.getElementById('segment-summary-row');
                if (segCards) {
                    segCards.innerHTML = segs.map(s => `
                        <div class="col-md-6">
                            <div class="card p-3 border-0 shadow-sm">
                                <small class="text-muted">${s.customer_segment}</small>
                                <div class="d-flex justify-content-between align-items-baseline mt-1">
                                    <h3 class="fw-bold mb-0">${Number(s.customer_count).toLocaleString()} <small class="fs-6 fw-normal text-muted">customers</small></h3>
                                    <span class="fw-bold text-accent money-val">${formatMoney(s.total_spend)}</span>
                                </div>
                                <small class="text-muted mt-1">${Number(s.total_orders).toLocaleString()} orders · Avg Order: <span class="money-val">${formatMoney(s.avg_order_value)}</span></small>
                            </div>
                        </div>
                    `).join('');
                }

                renderChart(
                    'segmentChart',
                    'doughnut',
                    segs.map(s => s.customer_segment),
                    [{ label: `Total Spend (${activeCurrency.currency_code})`, data: segs.map(s => Number(s.total_spend || 0)) }]
                );

                renderChart(
                    'frequencyChart',
                    'bar',
                    freqs.map(f => f.frequency_tier),
                    [{ label: 'Customers', data: freqs.map(f => Number(f.customer_count || 0)) }]
                );

                const vipBody = document.getElementById('vip-tbody');
                if (vipBody) {
                    vipBody.innerHTML = vips.map((c, idx) => {
                        const lastDate = c.last_order_date ? String(c.last_order_date).slice(0, 10) : 'N/A';
                        const badgeClass = c.segment === 'Store' ? 'bg-primary' : 'bg-info text-dark';
                        return `
                            <tr style="cursor:pointer;" data-bs-toggle="modal" data-bs-target="#detailModal"
                                onclick="showCustomerDetail('${c.customer_name.replace(/'/g, "\\'")}', '${c.segment}', '${c.AccountNumber}', '${formatMoney(c.total_spend)}', ${c.order_frequency}, '${lastDate}')">
                                <td>${idx + 1}</td>
                                <td class="fw-semibold">${c.customer_name}</td>
                                <td><code>${c.AccountNumber}</code></td>
                                <td><span class="badge ${badgeClass}">${c.segment}</span></td>
                                <td>${Number(c.order_frequency).toLocaleString()}</td>
                                <td class="money-val fw-bold">${formatMoney(c.total_spend)}</td>
                                <td class="money-val">${formatMoney(c.avg_order_value)}</td>
                                <td>${lastDate}</td>
                            </tr>
                        `;
                    }).join('');
                    filterVipTable();
                }
            }

            if (pageType === 'revenue_loss') {
                const rev = await apiGet(`/api/reports/revenue-loss/${qs}`);
                if (rev.currency) updateCurrencyBadge(rev.currency);

                const s = rev.financial_summary || {};
                const leakageRate = s.gross_revenue_before_discount
                    ? ((s.discount_erosion / s.gross_revenue_before_discount) * 100).toFixed(2)
                    : '0.00';

                setMoneyEl('rev-gross-before', s.gross_revenue_before_discount);
                setMoneyEl('rev-discount-erosion', s.discount_erosion);
                const leakEl = document.getElementById('rev-leakage-rate');
                if (leakEl) leakEl.textContent = `${leakageRate}%`;
                setMoneyEl('rev-net-product', s.net_product_revenue);
                setMoneyEl('rev-gross-profit', s.gross_profit);
                const gmEl = document.getElementById('rev-gross-margin');
                if (gmEl) gmEl.textContent = `${Number(s.gross_margin_pct || 0).toFixed(2)}% Gross Margin`;

                const govNote = document.getElementById('rev-governance-note');
                if (govNote && rev.governance?.documented_limitation) {
                    govNote.textContent = rev.governance.documented_limitation;
                }

                const trends = rev.revenue_trends || [];
                renderChart(
                    'revProfitTrendChart',
                    'line',
                    trends.map(t => t.period),
                    [
                        { label: `Net Revenue (${activeCurrency.currency_code})`, data: trends.map(t => Number(t.net_revenue || 0)) },
                        { label: `Estimated COGS (${activeCurrency.currency_code})`, data: trends.map(t => Number(t.estimated_cogs || 0)) },
                        { label: `Gross Profit (${activeCurrency.currency_code})`, data: trends.map(t => Number(t.gross_profit || 0)) }
                    ]
                );

                const lossBody = document.getElementById('negative-margin-tbody');
                const negItems = rev.negative_margin_products || [];
                if (lossBody) {
                    if (negItems.length === 0) {
                        lossBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3">No negative-margin products recorded for this filter selection.</td></tr>';
                    } else {
                        lossBody.innerHTML = negItems.map(item => `
                            <tr>
                                <td class="fw-semibold">${item.product_name}</td>
                                <td>${item.category_name}</td>
                                <td>${Number(item.units_sold).toLocaleString()}</td>
                                <td class="money-val">${formatMoney(item.net_revenue)}</td>
                                <td class="money-val">${formatMoney(item.standard_cogs)}</td>
                                <td class="money-val text-danger fw-bold">${formatMoney(item.net_margin_variance)}</td>
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
                if (poSub) poSub.textContent = `${Number(pc.total_purchase_orders || 0).toLocaleString()} Purchase Orders`;

                const catCosts = cost.cost_by_category || [];
                renderChart(
                    'costCategoryChart',
                    'bar',
                    catCosts.map(c => c.category_name),
                    [
                        { label: `Total COGS (${activeCurrency.currency_code})`, data: catCosts.map(c => Number(c.total_cogs || 0)) },
                        { label: `Total Revenue (${activeCurrency.currency_code})`, data: catCosts.map(c => Number(c.total_revenue || 0)) }
                    ]
                );

                const catBody = document.getElementById('cost-category-tbody');
                if (catBody) {
                    catBody.innerHTML = catCosts.map(c => `
                        <tr>
                            <td class="fw-semibold">${c.category_name}</td>
                            <td class="money-val">${formatMoney(c.total_cogs)}</td>
                            <td class="money-val">${formatMoney(c.total_revenue)}</td>
                            <td><span class="badge ${c.cost_to_revenue_ratio_pct > 65 ? 'bg-warning text-dark' : 'bg-primary'}">${c.cost_to_revenue_ratio_pct}%</span></td>
                        </tr>
                    `).join('');
                }

                const prodBody = document.getElementById('top-cost-products-tbody');
                if (prodBody) {
                    prodBody.innerHTML = (cost.top_cost_products || []).map((p, idx) => `
                        <tr>
                            <td>${idx + 1}</td>
                            <td class="fw-semibold">${p.product_name}</td>
                            <td class="money-val">${formatMoney(p.unit_standard_cost)}</td>
                            <td>${Number(p.units_sold).toLocaleString()}</td>
                            <td class="money-val fw-bold">${formatMoney(p.cumulative_cogs)}</td>
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

    // 5. Separated RBAC, Audit Logs, Admin Settings & Profile Helpers
    async function renderRbacTable() {
        const tbody = document.getElementById('rbac-users-tbody');
        if (!tbody) return;
        const data = await apiGet('/api/rbac/');
        const users = data.users || [];
        tbody.innerHTML = users.map(u => `
            <tr>
                <td>${u.id}</td>
                <td class="fw-semibold">${u.username}</td>
                <td><code>${u.role}</code></td>
                <td>${u.role_display}</td>
                <td><span class="badge ${u.is_active ? 'bg-success' : 'bg-secondary'}">${u.is_active ? 'Active' : 'Inactive'}</span></td>
            </tr>
        `).join('');
    }

    async function renderAuditTable() {
        const tbody = document.getElementById('audit-tbody');
        if (!tbody) return;
        const data = await apiGet('/api/audit/');
        const logs = data.audit_logs || [];
        if (logs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3">No audit entries recorded in database yet.</td></tr>';
            return;
        }
        tbody.innerHTML = logs.map(l => `
            <tr>
                <td><code>${l.timestamp}</code></td>
                <td class="fw-semibold">${l.username}</td>
                <td>${l.role}</td>
                <td><span class="badge bg-info text-dark">${l.action}</span></td>
                <td><span class="badge bg-primary">${l.module || 'System'}</span></td>
                <td class="small">${l.details || '—'}</td>
            </tr>
        `).join('');
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

    const auditSearch = document.getElementById('audit-search');
    if (auditSearch) {
        auditSearch.addEventListener('input', (e) => {
            const q = e.target.value.toLowerCase();
            document.querySelectorAll('#audit-table tbody tr').forEach(row => {
                row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
            });
        });
    }

    [yearFilter, categoryFilter].forEach(el => {
        if (el) el.addEventListener('change', loadPageData);
    });

    await initFilters();
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
        <p class="mb-0"><strong>Total Units Sold:</strong> ${Number(units).toLocaleString()} units<br>
        <strong>Source Tables:</strong> Sales.SalesOrderDetail, Production.ProductCategory</p>
    `;
}

function showCustomerDetail(name, segment, accountNum, spend, orders, lastDate) {
    document.getElementById('modalTitle').textContent = `${name} (${accountNum})`;
    document.getElementById('modalBody').innerHTML = `
        <p><strong>Segment:</strong> ${segment} | <strong>Lifetime Spend:</strong> ${spend}</p>
        <p><strong>Order Frequency:</strong> ${orders} orders | <strong>Last Order Date:</strong> ${lastDate}</p>
        <div class="alert alert-info mb-0">
            <strong>Data Source:</strong> Live aggregation from <code>AdventureWorks2019.Sales.Customer</code> &amp; <code>SalesOrderHeader</code>.
        </div>
    `;
}