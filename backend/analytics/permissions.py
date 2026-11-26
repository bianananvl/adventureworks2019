from functools import wraps
from django.http import JsonResponse

ROLE_PERMISSIONS = {
    "ADMINISTRATOR": {
        "role_display": "System Administrator",
        "can_view_executive": True,
        "can_view_sales": True,
        "can_view_customers": True,
        "can_view_revenue_loss": True,
        "can_view_cost": True,
        "can_view_rbac": True,
        "can_manage_users": True,
        "can_view_audit": True,
        "can_edit_settings": True,
        "can_view_profile": True,
        "can_export": True,
        "can_edit_reports": True,
        "can_delete_reports": True,
    },
    "MANAGER": {
        "role_display": "Executive Management (Manager)",
        "can_view_executive": True,
        "can_view_sales": True,
        "can_view_customers": True,
        "can_view_revenue_loss": True,
        "can_view_cost": True,
        "can_view_rbac": False,
        "can_manage_users": False,
        "can_view_audit": True,
        "can_edit_settings": False,
        "can_view_profile": True,
        "can_export": True,
        "can_edit_reports": True,
        "can_delete_reports": False,
    },
    "SUPERVISOR": {
        "role_display": "Department Operations Supervisor",
        "can_view_executive": False,
        "can_view_sales": True,
        "can_view_customers": True,
        "can_view_revenue_loss": False,
        "can_view_cost": False,
        "can_view_rbac": False,
        "can_manage_users": False,
        "can_view_audit": False,
        "can_edit_settings": False,
        "can_view_profile": True,
        "can_export": True,
        "can_edit_reports": True,
        "can_delete_reports": False,
    },
    "SALES_ANALYST": {
        "role_display": "Sales Department Analyst",
        "can_view_executive": False,
        "can_view_sales": True,
        "can_view_customers": False,
        "can_view_revenue_loss": False,
        "can_view_cost": False,
        "can_view_rbac": False,
        "can_manage_users": False,
        "can_view_audit": False,
        "can_edit_settings": False,
        "can_view_profile": True,
        "can_export": True,
        "can_edit_reports": False,
        "can_delete_reports": False,
    },
    "CUSTOMER_ANALYST": {
        "role_display": "Marketing & Customer Analyst",
        "can_view_executive": False,
        "can_view_sales": False,
        "can_view_customers": True,
        "can_view_revenue_loss": False,
        "can_view_cost": False,
        "can_view_rbac": False,
        "can_manage_users": False,
        "can_view_audit": False,
        "can_edit_settings": False,
        "can_view_profile": True,
        "can_export": True,
        "can_edit_reports": False,
        "can_delete_reports": False,
    },
    "FINANCIAL_ANALYST": {
        "role_display": "Financial & Pricing Analyst",
        "can_view_executive": False,
        "can_view_sales": False,
        "can_view_customers": False,
        "can_view_revenue_loss": True,
        "can_view_cost": False,
        "can_view_rbac": False,
        "can_manage_users": False,
        "can_view_audit": False,
        "can_edit_settings": False,
        "can_view_profile": True,
        "can_export": True,
        "can_edit_reports": False,
        "can_delete_reports": False,
    },
    "COST_ANALYST": {
        "role_display": "Manufacturing Cost Analyst",
        "can_view_executive": False,
        "can_view_sales": False,
        "can_view_customers": False,
        "can_view_revenue_loss": False,
        "can_view_cost": True,
        "can_view_rbac": False,
        "can_manage_users": False,
        "can_view_audit": False,
        "can_edit_settings": False,
        "can_view_profile": True,
        "can_export": True,
        "can_edit_reports": False,
        "can_delete_reports": False,
    },
}


VALID_ROLES = list(ROLE_PERMISSIONS.keys())


def get_user_role(user):
    if user.is_superuser:
        return "ADMINISTRATOR"
    grp = user.groups.first()
    return grp.name.upper() if grp else "SALES_ANALYST"


def require_permission(perm_key):
    def decorator(view_func):
        @wraps(view_func)
        def _wrapped(request, *args, **kwargs):
            if not request.user.is_authenticated:
                return JsonResponse({"error": "Authentication required"}, status=401)
            role = get_user_role(request.user)
            if not ROLE_PERMISSIONS.get(role, {}).get(perm_key, False):
                from .models import AuditLog  # local import avoids an app-loading cycle

                AuditLog.objects.create(
                    username=request.user.username,
                    role=role,
                    action="ACCESS_DENIED",
                    module=request.path[:100],
                    details=f"Missing permission: {perm_key}",
                    ip_address=request.META.get("REMOTE_ADDR") or None,
                    status="DENIED",
                )
                return JsonResponse(
                    {"error": f"HTTP 403: {role} is denied access ({perm_key})"},
                    status=403,
                )
            return view_func(request, *args, **kwargs)

        return _wrapped

    return decorator