document.addEventListener('DOMContentLoaded', () => {
   // 1. Saved Preferences & State
    const chartInstances = {};
    const savedTheme = localStorage.getItem('aw_theme') || 'light';
    const savedCurrency = localStorage.getItem('aw_currency') || 'USD';
    const savedPalette = localStorage.getItem('aw_palette') || 'Azure';
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

    applyTheme(savedTheme);
    applyPaletteToUI(savedPalette);
    if (savedWidescreen) document.body.classList.add('widescreen-mode');

   // Sync Settings Page Controls if present
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
            localStorage.setItem('aw_currency', e.target.value);
            convertAllCurrency(e.target.value);
        });
    }

    if (setPaletteEl) {
        setPaletteEl.value = savedPalette;
        setPaletteEl.addEventListener('change', (e) => {
            localStorage.setItem('aw_palette', e.target.value);
            applyPaletteToUI(e.target.value);
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

   // Sync changes across iframe and parent shell
    window.addEventListener('storage', (e) => {
        if (e.key === 'aw_theme') applyTheme(e.newValue);
        if (e.key === 'aw_palette') applyPaletteToUI(e.newValue);
        if (e.key === 'aw_currency') convertAllCurrency(e.newValue);
    });

    function applyPaletteToUI(paletteName) {
        const pal = palettes[paletteName] || palettes.Azure;
        document.documentElement.style.setProperty('--primary-accent', pal.primary);

       // Update Territory Performance Map tiles
        document.querySelectorAll('.territory-tile').forEach((tile, idx) => {
            const bg = pal.colors[idx % pal.colors.length];
            tile.style.setProperty('background-color', bg, 'important');
            tile.style.opacity = '1';
            if (bg.toUpperCase() === '#AED5F5') {
                tile.classList.remove('text-white');
                tile.style.color = '#353A4C';
            } else {
                tile.classList.add('text-white');
                tile.style.color = '#ffffff';
            }
        });

       // Update live Chart.js instances if initialized
        Object.keys(chartInstances).forEach(id => {
            const chart = chartInstances[id];
            const updatedConfigs = buildChartConfigs(pal);
            chart.data.datasets = updatedConfigs[id].datasets;
            chart.update();
        });
    }

   // 2. Multi-Currency Switcher (USD, PHP, EUR, JPY)
    const rates = {
        USD: { rate: 1, symbol: '$' },
        PHP: { rate: 58.2, symbol: '₱' },
        EUR: { rate: 0.92, symbol: '€' },
        JPY: { rate: 154.5, symbol: '¥' }
    };

    const currencyDropdown = document.getElementById('global-currency');
    if (currencyDropdown) {
        currencyDropdown.value = savedCurrency;
        currencyDropdown.addEventListener('change', (e) => {
            localStorage.setItem('aw_currency', e.target.value);
            convertAllCurrency(e.target.value);
        });
    }

    function convertAllCurrency(curr) {
        const { rate, symbol } = rates[curr] || rates.USD;
        document.querySelectorAll('.money-val').forEach(el => {
            const baseUsd = parseFloat(el.getAttribute('data-usd'));
            if (isNaN(baseUsd)) return;
            const converted = baseUsd * rate;

            if (converted >= 1000000) {
                el.textContent = `${symbol}${(converted / 1000000).toFixed(2)}M`;
            } else if (converted >= 100000) {
                el.textContent = `${symbol}${(converted / 1000).toFixed(1)}K`;
            } else {
                el.textContent = `${symbol}${converted.toLocaleString('en-US', {
                    minimumFractionDigits: curr === 'JPY' ? 0 : 2,
                    maximumFractionDigits: curr === 'JPY' ? 0 : 2
                })}`;
            }
        });
    }

    convertAllCurrency(savedCurrency);

    // 3. Color Palettes & Chart.js Engine
    const activePal = palettes[savedPalette] || palettes.Azure;

    function buildChartConfigs(pal) {
        const colors = pal.colors;
        return {
            execRegionChart: {
                type: 'bar',
                labels: ['NCR', 'Luzon', 'Visayas', 'Mindanao'],
                datasets: [{ label: 'Sales ($M)', data: [12.50, 8.40, 4.20, 2.05], backgroundColor: colors }]
            },
            execCategoryChart: {
                type: 'doughnut',
                labels: ['Bikes', 'Components', 'Clothing', 'Accessories'],
                datasets: [{ label: 'Revenue Share (%)', data: [58, 22, 12, 8], backgroundColor: colors }]
            },
            salesCategoryChart: {
                type: 'bar',
                labels: ['Mountain Bikes', 'Road Bikes', 'Touring Bikes', 'Components', 'Accessories'],
                datasets: [{ label: 'Revenue ($M)', data: [7.8, 6.4, 3.1, 5.9, 3.95], backgroundColor: colors }]
            },
            tierChart: {
                type: 'pie',
                labels: ['Gold Tier (VIP)', 'Silver Tier', 'Bronze Tier'],
                datasets: [{ label: 'Customers', data: [1420, 5840, 12560], backgroundColor: [colors[0], colors[1], colors[2]] }]
            },
            seasonalityChart: {
                type: 'line',
                labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
                datasets: [{
                    label: 'Monthly Orders',
                    data: [1100, 1050, 1240, 1310, 1450, 1520, 1480, 1590, 1680, 1950, 2890, 3240],
                    borderColor: pal.primary,
                    backgroundColor: pal.fill,
                    fill: true,
                    tension: 0.35
                }]
            },
            revCategoryChart: {
                type: 'bar',
                labels: ['Bikes', 'Components', 'Clothing', 'Accessories'],
                datasets: [{ label: 'Discounts Conceded ($M)', data: [2.51, 0.84, 0.42, 0.28], backgroundColor: colors }]
            },
            revTierChart: {
                type: 'bar',
                labels: ['0% (None)', '1–5% Promo', '6–10% Volume', '11–20% Clearance'],
                datasets: [{ label: 'Leakage ($K)', data: [0, 470, 432, 504], backgroundColor: colors }]
            },
            costTrendChart: {
                type: 'line',
                labels: ['Q1', 'Q2', 'Q3', 'Q4'],
                datasets: [
                    { label: 'Avg List Price ($)', data: [1820, 1850, 1890, 1940], borderColor: colors[0], backgroundColor: colors[0], tension: 0.3 },
                    { label: 'Avg Standard Cost ($)', data: [1040, 1065, 1090, 1135], borderColor: colors[1], backgroundColor: colors[1], tension: 0.3 }
                ]
            }
        };
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
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: textColor }
                }
            }
        };
    }

    const chartConfigs = buildChartConfigs(activePal);

    Object.keys(chartConfigs).forEach(canvasId => {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const cfg = chartConfigs[canvasId];
        chartInstances[canvasId] = new Chart(canvas, {
            type: cfg.type,
            data: { labels: cfg.labels, datasets: cfg.datasets },
            options: getChartOptions(cfg.type)
        });
    });

    // Dynamic Chart Type Switchers (Bar / Line / Pie / Doughnut)
    document.querySelectorAll('.chart-type-switcher').forEach(select => {
        select.addEventListener('change', (e) => {
            const targetId = e.target.getAttribute('data-target');
            const newType = e.target.value;
            const canvas = document.getElementById(targetId);
            if (!canvas || !chartInstances[targetId]) return;

            chartInstances[targetId].destroy();
            const currentPal = palettes[localStorage.getItem('aw_palette') || 'Azure'];
            const cfg = buildChartConfigs(currentPal)[targetId];
            chartInstances[targetId] = new Chart(canvas, {
                type: newType,
                data: { labels: cfg.labels, datasets: cfg.datasets },
                options: getChartOptions(newType)
            });
        });
    });

    // 4. Global Year & Region Filter Simulation
    const yearFilter = document.getElementById('global-year');
    const regionFilter = document.getElementById('global-region');
    [yearFilter, regionFilter].forEach(filter => {
        if (!filter) return;
        filter.addEventListener('change', () => {
            const multiplier = (yearFilter?.value === '2025' ? 0.46 : yearFilter?.value === '2026' ? 0.54 : 1) *
                                (regionFilter?.value !== 'All' ? 0.35 : 1);
            const currentPal = palettes[localStorage.getItem('aw_palette') || 'Azure'];
            const baseConfigs = buildChartConfigs(currentPal);
            Object.keys(chartInstances).forEach(id => {
                const chart = chartInstances[id];
                chart.data.datasets.forEach((ds, idx) => {
                    ds.data = baseConfigs[id].datasets[idx].data.map(v => +(v * multiplier).toFixed(2));
                });
                chart.update();
            });
        });
    });

    // 5. Table Search & Tier Filters (Customer Profile & Audit Logs)
    const custSearch = document.getElementById('cust-search');
    const custTier = document.getElementById('cust-tier');
    function filterVipTable() {
        const query = (custSearch?.value || '').toLowerCase();
        const tier = custTier?.value || 'All';
        document.querySelectorAll('#vip-table tbody tr').forEach(row => {
            const text = row.textContent.toLowerCase();
            const matchesQuery = text.includes(query);
            const matchesTier = tier === 'All' || text.includes(tier.toLowerCase());
            row.style.display = matchesQuery && matchesTier ? '' : 'none';
        });
    }
    if (custSearch) custSearch.addEventListener('input', filterVipTable);
    if (custTier) custTier.addEventListener('change', filterVipTable);

    const auditSearch = document.getElementById('audit-search');
    if (auditSearch) {
        auditSearch.addEventListener('input', (e) => {
            const q = e.target.value.toLowerCase();
            document.querySelectorAll('#audit-table tbody tr').forEach(row => {
                row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
            });
        });
    }
    });

    // Helper: Theme Applier (Syncs iframe and parent index.html)
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

    // Helper: Interactive Pop-up Modals
    function showKpiDetail(title, value) {
    document.getElementById('modalTitle').textContent = `${title} — Detailed Breakdown`;
    document.getElementById('modalBody').innerHTML = `
        <p class="mb-2">Current Selected Metric Value: <strong>${value}</strong></p>
        <ul class="mb-0">
            <li><strong>NCR Contribution:</strong> 46.0% of total volume</li>
            <li><strong>Luzon Contribution:</strong> 30.9% of total volume</li>
            <li><strong>Visayas & Mindanao:</strong> 23.1% combined</li>
            <li><strong>Data Source:</strong> AdventureWorks2019 SalesOrderHeader DW</li>
        </ul>
    `;
    }

    function showTerritoryDetail(region, sales, share) {
    document.getElementById('modalTitle').textContent = `${region} Territory Performance`;
    document.getElementById('modalBody').innerHTML = `
        <p><strong>Total Territory Sales:</strong> ${sales} (${share} of national revenue)</p>
        <p class="mb-0"><strong>Top Performing Category:</strong> Mountain & Road Bikes<br>
        <strong>Lead Territory Rep:</strong> A. Reyes</p>
    `;
    }

    function showCustomerDetail(name, tier, peakMonth, spend) {
    document.getElementById('modalTitle').textContent = `${name} — VIP Account Profile`;
    document.getElementById('modalBody').innerHTML = `
        <p><strong>Account Tier:</strong> ${tier} | <strong>Lifetime Spend:</strong> ${spend}</p>
        <p><strong>Peak Buying Season:</strong> ${peakMonth}</p>
        <div class="alert alert-success mb-0">
            <strong>Recommended Action:</strong> Schedule pre-season inventory allocation and offer 5% loyalty bundle prior to <strong>${peakMonth}</strong>.
        </div>
    `;
    }