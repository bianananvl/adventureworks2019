document.addEventListener('DOMContentLoaded', async () => {
    const chartInstances = {};
    const chartDataCache = {};

    // 1. Saved Preferences & Theme
    const savedTheme = localStorage.getItem('aw_theme') || 'light';
    let savedCurrency = localStorage.getItem('aw_currency') || 'USD';
    let savedPalette = localStorage.getItem('aw_palette') || 'Azure';
    const savedWidescreen = localStorage.getItem('aw_widescreen') === 'true';

    const palettes = {
        Azure: {
            primary: '#367ADF',
            fill: 'rgba(54, 122, 223, 0.18)',
            colors: ['#367ADF', '#4FACE5', '#394988', '#AED5F5', '#353A4C']
        },
        Ocean: { primary: '#0d9488', fill: 'rgba(13, 148, 136, 0.15)', colors: ['#0d9488', '#0284c7', '#38bdf8', '#2dd4bf', '#0f766e'] },
        Sunset: { primary: '#f97316', fill: 'rgba(249, 115, 22, 0.15)', colors: ['#f97316', '#ef4444', '#f59e0b', '#ec4899', '#d97706'] },
        Forest: { primary: '#16a34a', fill: 'rgba(22, 163, 74, 0.15)', colors: ['#16a34a', '#15803d', '#4ade80', '#84cc16', '#065f46'] },
        Mono: { primary: '#475569', fill: 'rgba(71, 85, 105, 0.15)', colors: ['#334155', '#64748b', '#94a3b8', '#475569', '#1e293b'] }
    };

    const rates = {
        USD: { rate: 1, symbol: '$' },
        PHP: { rate: 58.2, symbol: '₱' },
        EUR: { rate: 0.92, symbol: '€' },
        JPY: { rate: 154.5, symbol: '¥' }
    };

    applyTheme(savedTheme);
    applyPaletteToUI(savedPalette);
    if (savedWidescreen) document.body.classList.add('widescreen-mode');

    // Sync Settings Page Controls
    const setThemeEl = document.getElementById('set-theme');
    const setCurrencyEl = document.getElementById('set-currency');
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
    if (setCurrencyEl) {
        setCurrencyEl.value = savedCurrency;
        setCurrencyEl.addEventListener('change', (e) => {
            savedCurrency = e.target.value;
            localStorage.setItem('aw_currency', savedCurrency);
            convertAllCurrency(savedCurrency);
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

    // Enforce RBAC Settings Controls (Only Administrator can edit system settings)
    const activeSession = JSON.parse(localStorage.getItem('aw_session') || '{}');
    const sessionRole = (activeSession.role || '').toUpperCase();

    if (sessionRole !== 'ADMINISTRATOR') {
        [setThemeEl, setCurrencyEl, setPaletteEl, setWidescreenEl, setChartTypeEl].forEach(el => {
            if (el) el.disabled = true;
        });
        const settingsContainer = document.querySelector('[data-page="settings"] .container, [data-page="settings"] .container-fluid, [data-page="audit"] .container-fluid');
        if (settingsContainer) {
            const notice = document.createElement('div');
            notice.className = 'alert alert-warning py-2 small mb-3';
            notice.innerHTML = sessionRole === 'MANAGER'
                ? '<strong>Executive Management (Read-Only Access):</strong> You have full visibility into Governance, Audit Logs, and System Settings, but administrative RBAC and configuration edits are restricted to System Administrators.'
                : '<strong>Read-Only Configuration:</strong> System-wide configuration and RBAC governance are managed by System Administrators.';
            settingsContainer.prepend(notice);
        }
    }

    // Build & Enforce RBAC Export Controls (CSV & PDF) on Reporting Modules
    const exportEligiblePages = ['executive', 'sales', 'customers', 'revenue_loss', 'cost'];
    const currentPageKey = document.body.getAttribute('data-page') || '';
    const isExportAllowed = ['ADMINISTRATOR', 'MANAGER', 'SUPERVISOR'].includes(sessionRole);

    if (exportEligiblePages.includes(currentPageKey) && isExportAllowed) {
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

                const logs = JSON.parse(localStorage.getItem('aw_audit_logs') || '[]');
                logs.unshift({
                    timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
                    user: activeSession.user || 'User',
                    role: activeSession.role_display || sessionRole,
                    action: `Exported CSV Report (${currentPageKey})`,
                    module: pageHeader.innerText.trim(),
                    status: 'SUCCESS'
                });
                localStorage.setItem('aw_audit_logs', JSON.stringify(logs));
            });

            document.getElementById('btn-export-pdf').addEventListener('click', async () => {
                const logs = JSON.parse(localStorage.getItem('aw_audit_logs') || '[]');
                logs.unshift({
                    timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
                    user: activeSession.user || 'User',
                    role: activeSession.role_display || sessionRole,
                    action: `Exported PDF Report (${currentPageKey})`,
                    module: pageHeader.innerText.trim(),
                    status: 'SUCCESS'
                });
                localStorage.setItem('aw_audit_logs', JSON.stringify(logs));

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
        if (e.key === 'aw_currency') { savedCurrency = e.newValue; convertAllCurrency(savedCurrency); }
    });

    const currencyDropdown = document.getElementById('global-currency');
    if (currencyDropdown) {
        currencyDropdown.value = savedCurrency;
        currencyDropdown.addEventListener('change', (e) => {
            savedCurrency = e.target.value;
            localStorage.setItem('aw_currency', savedCurrency);
            convertAllCurrency(savedCurrency);
        });
    }

    function formatMoney(usdAmount, curr = savedCurrency) {
        const { rate, symbol } = rates[curr] || rates.USD;
        const val = Number(usdAmount || 0) * rate;
        if (Math.abs(val) >= 1000000) return `${symbol}${(val / 1000000).toFixed(2)}M`;
        if (Math.abs(val) >= 100000) return `${symbol}${(val / 1000).toFixed(1)}K`;
        return `${symbol}${val.toLocaleString('en-US', {
            minimumFractionDigits: curr === 'JPY' ? 0 : 2,
            maximumFractionDigits: curr === 'JPY' ? 0 : 2
        })}`;
    }

    function convertAllCurrency(curr = savedCurrency) {
        document.querySelectorAll('.money-val').forEach(el => {
            const baseUsd = parseFloat(el.getAttribute('data-usd'));
            if (!isNaN(baseUsd)) el.textContent = formatMoney(baseUsd, curr);
        });
    }

    function setMoneyEl(id, usdAmount) {
        const el = document.getElementById(id);
        if (!el) return;
        el.setAttribute('data-usd', Number(usdAmount || 0));
        el.textContent = formatMoney(usdAmount, savedCurrency);
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
                    ds.backgroundColor = pal.fill;
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

    function renderChart(canvasId, defaultType, labels, datasets) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        const switcher = document.querySelector(`.chart-type-switcher[data-target="${canvasId}"]`);
        const type = (switcher && switcher.value) ? switcher.value : defaultType;
        if (switcher) switcher.value = type;

        const pal = palettes[savedPalette] || palettes.Azure;
        const styledDatasets = datasets.map((ds, idx) => ({
            ...ds,
            borderColor: type === 'line' ? pal.colors[idx % pal.colors.length] : undefined,
            backgroundColor: type === 'line'
                ? pal.fill
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

    function logAuditEvent(action, moduleName, status = 'SUCCESS') {
        const userSession = JSON.parse(localStorage.getItem('aw_session') || '{}');
        const logs = JSON.parse(localStorage.getItem('aw_audit_logs') || '[]');
        logs.unshift({
            timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
            user: userSession.user || 'admin',
            role: userSession.role_display || 'Administrator',
            action,
            module: moduleName,
            status
        });
        localStorage.setItem('aw_audit_logs', JSON.stringify(logs.slice(0, 100)));
    }

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
    const custSearch = document.getElementById('cust-search');
    const custSegFilter = document.getElementById('cust-segment');

    async function initFilters() {
        if (!yearFilter && !categoryFilter) return;
        try {
            const meta = await apiGet('/api/filters/');
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
                    [{ label: 'Net Sales (USD)', data: trends.map(t => Number(t.sales_amount || 0)) }]
                );

                const cats = sales.sales_by_category || [];
                renderChart(
                    'execCategoryChart',
                    'doughnut',
                    cats.map(c => c.category_name),
                    [{ label: 'Category Sales (USD)', data: cats.map(c => Number(c.sales_amount || 0)) }]
                );

                await loadSavedConfigs();
                logAuditEvent(`Loaded Executive Central ${qs || '(All Data)'}`, 'Executive Central');
            }

            if (pageType === 'sales') {
                const sales = await apiGet(`/api/reports/sales/${qs}`);
                const k = sales.kpis || {};
                setMoneyEl('sales-kpi-revenue', k.total_sales_amount);
                const ordEl = document.getElementById('sales-kpi-orders');
                if (ordEl) ordEl.textContent = Number(k.total_orders || 0).toLocaleString();
                const unitEl = document.getElementById('sales-kpi-units');
                if (unitEl) unitEl.textContent = Number(k.total_units_sold || 0).toLocaleString();
                setMoneyEl('sales-kpi-avg-line', k.avg_line_value);

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
                                    <div class="money-val fw-semibold" data-usd="${c.sales_amount}">${formatMoney(c.sales_amount)}</div>
                                    <small>${share}% Share · ${Number(c.units_sold).toLocaleString()} units</small>
                                </div>
                            </div>`;
                    }).join('');
                }

                renderChart(
                    'salesCategoryChart',
                    'bar',
                    cats.map(c => c.category_name),
                    [{ label: 'Category Revenue (USD)', data: cats.map(c => Number(c.sales_amount || 0)) }]
                );

                renderChart(
                    'salesTrendChart',
                    'line',
                    (sales.sales_trends || []).map(t => t.period),
                    [{ label: 'Monthly Revenue (USD)', data: (sales.sales_trends || []).map(t => Number(t.sales_amount || 0)) }]
                );

                const topBody = document.getElementById('top-products-tbody');
                if (topBody) {
                    topBody.innerHTML = (sales.top_products || []).map((p, idx) => `
                        <tr>
                            <td>${idx + 1}</td>
                            <td class="fw-semibold">${p.product_name}</td>
                            <td><code>${p.ProductNumber}</code></td>
                            <td>${Number(p.units_sold).toLocaleString()}</td>
                            <td class="money-val fw-bold" data-usd="${p.total_sales}">${formatMoney(p.total_sales)}</td>
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
                            <td class="money-val" data-usd="${p.total_sales}">${formatMoney(p.total_sales)}</td>
                        </tr>
                    `).join('');
                }

                logAuditEvent(`Queried Sales Analysis ${qs || '(All Years)'}`, 'Sales Analysis');
            }

            if (pageType === 'customers') {
                const cust = await apiGet(`/api/reports/customers/${qs}`);
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
                                    <span class="fw-bold text-accent money-val" data-usd="${s.total_spend}">${formatMoney(s.total_spend)}</span>
                                </div>
                                <small class="text-muted mt-1">${Number(s.total_orders).toLocaleString()} orders · Avg Order: <span class="money-val" data-usd="${s.avg_order_value}">${formatMoney(s.avg_order_value)}</span></small>
                            </div>
                        </div>
                    `).join('');
                }

                renderChart(
                    'segmentChart',
                    'doughnut',
                    segs.map(s => s.customer_segment),
                    [{ label: 'Total Spend (USD)', data: segs.map(s => Number(s.total_spend || 0)) }]
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
                                <td class="money-val fw-bold" data-usd="${c.total_spend}">${formatMoney(c.total_spend)}</td>
                                <td class="money-val" data-usd="${c.avg_order_value}">${formatMoney(c.avg_order_value)}</td>
                                <td>${lastDate}</td>
                            </tr>
                        `;
                    }).join('');
                    filterVipTable();
                }

                logAuditEvent(`Queried Customer Profile ${qs || '(All Years)'}`, 'Customer Profile');
            }

            if (pageType === 'revenue_loss') {
                const rev = await apiGet(`/api/reports/revenue-loss/${qs}`);
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
                        { label: 'Net Revenue (USD)', data: trends.map(t => Number(t.net_revenue || 0)) },
                        { label: 'Estimated COGS (USD)', data: trends.map(t => Number(t.estimated_cogs || 0)) },
                        { label: 'Gross Profit (USD)', data: trends.map(t => Number(t.gross_profit || 0)) }
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
                                <td class="money-val" data-usd="${item.net_revenue}">${formatMoney(item.net_revenue)}</td>
                                <td class="money-val" data-usd="${item.standard_cogs}">${formatMoney(item.standard_cogs)}</td>
                                <td class="money-val text-danger fw-bold" data-usd="${item.net_margin_variance}">${formatMoney(item.net_margin_variance)}</td>
                            </tr>
                        `).join('');
                    }
                }

                logAuditEvent(`Queried Revenue & Loss ${qs || '(All Data)'}`, 'Revenue & Loss');
            }

            if (pageType === 'cost') {
                const cost = await apiGet(`/api/reports/cost/${qs}`);
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
                        { label: 'Total COGS (USD)', data: catCosts.map(c => Number(c.total_cogs || 0)) },
                        { label: 'Total Revenue (USD)', data: catCosts.map(c => Number(c.total_revenue || 0)) }
                    ]
                );

                const catBody = document.getElementById('cost-category-tbody');
                if (catBody) {
                    catBody.innerHTML = catCosts.map(c => `
                        <tr>
                            <td class="fw-semibold">${c.category_name}</td>
                            <td class="money-val" data-usd="${c.total_cogs}">${formatMoney(c.total_cogs)}</td>
                            <td class="money-val" data-usd="${c.total_revenue}">${formatMoney(c.total_revenue)}</td>
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
                            <td class="money-val" data-usd="${p.unit_standard_cost}">${formatMoney(p.unit_standard_cost)}</td>
                            <td>${Number(p.units_sold).toLocaleString()}</td>
                            <td class="money-val fw-bold" data-usd="${p.cumulative_cogs}">${formatMoney(p.cumulative_cogs)}</td>
                        </tr>
                    `).join('');
                }

                logAuditEvent(`Queried Cost Analysis ${qs || '(All Data)'}`, 'Cost Analysis');
            }

            if (pageType === 'audit') {
                renderAuditTable();
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
            logAuditEvent(`Saved report config: ${payload.title}`, 'Executive Central');
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
        logAuditEvent(`Deleted report config #${reportId}`, 'Executive Central');
        loadSavedConfigs();
    };

    // 5. Audit Logs & Profile Helpers (Available to ALL 7 Roles)
    function renderAuditTable() {
        const tbody = document.getElementById('audit-tbody');
        if (!tbody) return;
        const logs = JSON.parse(localStorage.getItem('aw_audit_logs') || '[]');
        if (logs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3">No session events recorded yet. Navigate through modules to generate live audit entries.</td></tr>';
            return;
        }
        tbody.innerHTML = logs.map(l => `
            <tr>
                <td><code>${l.timestamp}</code></td>
                <td class="fw-semibold">${l.user}</td>
                <td>${l.role}</td>
                <td>${l.action}</td>
                <td><span class="badge bg-primary">${l.module}</span></td>
                <td><span class="badge ${l.status === 'SUCCESS' ? 'bg-success' : 'bg-danger'}">${l.status}</span></td>
            </tr>
        `).join('');
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