(function enforceRBAC() {
    const raw = localStorage.getItem('aw_session');
    const path = window.location.pathname.toLowerCase();
    const isLogin = path === '/' || path.endsWith('index.html');

    if (!raw) {
        if (!isLogin) {
            if (window.parent && window.parent !== window) window.parent.location.replace('/');
            else window.location.replace('/');
        }
        return;
    }

    const session = JSON.parse(raw);
    const uname = (session.user || session.username || '').toLowerCase();
    const role = (session.role || '').toUpperCase();

    const RBAC_MATRIX = {
        ADMINISTRATOR:     { label: 'System Administrator',             home: '/executive_central.html', pages: ['executive', 'sales', 'customers', 'revenue_loss', 'cost', 'audit', 'settings', 'profile'], canExport: true,  notes: 'full',   editSettings: true  },
        MANAGER:           { label: 'Executive Management (Manager)',   home: '/executive_central.html', pages: ['executive', 'sales', 'customers', 'revenue_loss', 'cost', 'audit', 'settings', 'profile'], canExport: true,  notes: 'edit',   editSettings: false },
        SUPERVISOR:        { label: 'Department Operations Supervisor', home: '/sales_analysis.html',    pages: ['sales', 'customers', 'profile'],                                                            canExport: true,  notes: 'create', editSettings: false },
        SALES_ANALYST:     { label: 'Sales Department Analyst',         home: '/sales_analysis.html',    pages: ['sales', 'profile'],                                                                         canExport: false, notes: 'view',   editSettings: false },
        CUSTOMER_ANALYST:  { label: 'Marketing & Customer Analyst',     home: '/customer_profile.html',  pages: ['customers', 'profile'],                                                                     canExport: false, notes: 'view',   editSettings: false },
        FINANCIAL_ANALYST: { label: 'Financial & Pricing Analyst',      home: '/revenue_loss.html',      pages: ['revenue_loss', 'profile'],                                                                  canExport: false, notes: 'view',   editSettings: false },
        COST_ANALYST:      { label: 'Manufacturing Cost Analyst',       home: '/cost_analysis.html',     pages: ['cost', 'profile'],                                                                          canExport: false, notes: 'view',   editSettings: false }
    };

    let roleKey = role;
    if (!RBAC_MATRIX[roleKey]) {
        if (uname === 'admin') roleKey = 'ADMINISTRATOR';
        else if (uname === 'manager') roleKey = 'MANAGER';
        else if (uname === 'supervisor') roleKey = 'SUPERVISOR';
        else if (uname === 'customer_analyst') roleKey = 'CUSTOMER_ANALYST';
        else if (uname === 'financial_analyst') roleKey = 'FINANCIAL_ANALYST';
        else if (uname === 'cost_analyst') roleKey = 'COST_ANALYST';
        else roleKey = 'SALES_ANALYST';
    }

    const rules = RBAC_MATRIX[roleKey];
    window.CURRENT_RBAC = rules;
    window.CURRENT_SESSION = session;

    // Immediate URL check for iframe pages (My Profile is always allowed for all 7 roles)
    const normalizedPath = path.replace('-', '_');
    if (!isLogin && !normalizedPath.includes('profile') && !rules.pages.some(p => normalizedPath.includes(p))) {
        window.location.replace(rules.home);
        return;
    }

    document.addEventListener('DOMContentLoaded', () => {
        const currentPage = (document.body.getAttribute('data-page') || '').toLowerCase();
        if (currentPage && currentPage !== 'profile' && !rules.pages.includes(currentPage)) {
            window.location.replace(rules.home);
            return;
        }

        // Lock Saved Snapshot Form for View-Only Analysts
        if (rules.notes === 'view') {
            const cfgForm = document.getElementById('save-config-form');
            if (cfgForm) {
                cfgForm.querySelectorAll('input, select, textarea, button').forEach(el => el.disabled = true);
            }
        }
    });
})();