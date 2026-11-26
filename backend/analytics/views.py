import json
from decimal import Decimal, InvalidOperation
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import Group, User
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from .models import AuditLog, SavedReportConfig, SystemSettings
from .permissions import ROLE_PERMISSIONS, get_user_role, require_permission
from . import services


def _log_audit(user, action, module="", details=""):
    username = user.username if user and user.is_authenticated else "anonymous"
    role = get_user_role(user) if user and user.is_authenticated else "GUEST"
    AuditLog.objects.create(
        username=username,
        role=role,
        action=action,
        module=module,
        details=details,
    )


def _parse_staff_ids(request):
    """
    Accepts either ?staff_ids=274,275 or repeated ?staff_ids=274&staff_ids=275
    from multi-select checkboxes on the frontend.
    """
    raw_list = request.GET.getlist("staff_ids") or request.GET.getlist("staff_ids[]")
    ids = []
    for item in raw_list:
        for part in str(item).split(","):
            part = part.strip()
            if part.isdigit():
                ids.append(int(part))
    return ids


def ensure_rbac_users():
    if User.objects.filter(username="cost_analyst").exists():
        return
    users = [
        ("admin", "admin123", "ADMINISTRATOR", True),
        ("manager", "manager123", "MANAGER", False),
        ("supervisor", "supervisor123", "SUPERVISOR", False),
        ("sales_analyst", "sales123", "SALES_ANALYST", False),
        ("customer_analyst", "customer123", "CUSTOMER_ANALYST", False),
        ("financial_analyst", "financial123", "FINANCIAL_ANALYST", False),
        ("cost_analyst", "cost123", "COST_ANALYST", False),
    ]
    for uname, pwd, role_name, is_super in users:
        grp, _ = Group.objects.get_or_create(name=role_name)
        u, _ = User.objects.get_or_create(username=uname)
        u.set_password(pwd)
        u.is_staff = is_super
        u.is_superuser = is_super
        u.save()
        u.groups.clear()
        u.groups.add(grp)


@csrf_exempt
def login_view(request):
    ensure_rbac_users()
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)
    body = json.loads(request.body.decode("utf-8"))
    user = authenticate(
        request,
        username=body.get("username", "").strip(),
        password=body.get("password", ""),
    )
    if not user:
        return JsonResponse(
            {"success": False, "error": "Invalid username or password"}, status=401
        )
    login(request, user)
    role = get_user_role(user)
    perms = ROLE_PERMISSIONS[role]
    _log_audit(user, "LOGIN", "Authentication", f"User signed in as {role}")
    return JsonResponse(
        {
            "success": True,
            "user": user.username,
            "username": user.username,
            "role": role,
            "role_display": perms["role_display"],
            "permissions": perms,
        }
    )


@csrf_exempt
def logout_view(request):
    if request.user.is_authenticated:
        _log_audit(request.user, "LOGOUT", "Authentication", "User signed out")
    logout(request)
    return JsonResponse({"success": True})


def filters_api(request):
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Authentication required"}, status=401)
    return JsonResponse(services.get_available_filters())


@require_permission("can_view_executive")
def executive_api(request):
    year = request.GET.get("year")
    category_id = request.GET.get("category_id")
    staff_ids = _parse_staff_ids(request)
    cust_data = services.get_customer_profile_report(year=year)
    return JsonResponse(
        {
            "filters": services.get_available_filters(),
            "modules": {
                "customers": cust_data.get("segments", []),
            },
            "sales": services.get_sales_report(
                year=year, category_id=category_id, staff_ids=staff_ids
            ),
            "customers": cust_data,
            "revenue_loss": services.get_revenue_and_loss_report(
                year=year, category_id=category_id
            ),
            "cost": services.get_cost_report(year=year, category_id=category_id),
        }
    )


@require_permission("can_view_sales")
def sales_api(request):
    year = request.GET.get("year")
    category_id = request.GET.get("category_id")
    staff_ids = _parse_staff_ids(request)
    return JsonResponse(
        services.get_sales_report(
            year=year, category_id=category_id, staff_ids=staff_ids
        )
    )


@require_permission("can_view_customers")
def customer_api(request):
    year = request.GET.get("year")
    segment = request.GET.get("segment")
    return JsonResponse(
        services.get_customer_profile_report(year=year, segment=segment)
    )


@require_permission("can_view_revenue_loss")
def revenue_loss_api(request):
    year = request.GET.get("year")
    category_id = request.GET.get("category_id")
    return JsonResponse(
        services.get_revenue_and_loss_report(year=year, category_id=category_id)
    )


@require_permission("can_view_cost")
def cost_api(request):
    year = request.GET.get("year")
    category_id = request.GET.get("category_id")
    return JsonResponse(
        services.get_cost_report(year=year, category_id=category_id)
    )


# ==============================================================================
# SEPARATED RBAC VS. AUDIT LOG ENDPOINTS
# ==============================================================================
@require_permission("can_view_rbac")
def rbac_api(request):
    users_list = []
    for u in User.objects.all().order_by("id"):
        role = get_user_role(u)
        users_list.append(
            {
                "id": u.id,
                "username": u.username,
                "role": role,
                "role_display": ROLE_PERMISSIONS.get(role, {}).get(
                    "role_display", role
                ),
                "is_active": u.is_active,
            }
        )
    return JsonResponse({"users": users_list, "rbac_matrix": ROLE_PERMISSIONS})


@require_permission("can_view_audit")
def audit_api(request):
    logs = [
        {
            "id": entry.id,
            "timestamp": entry.timestamp.strftime("%Y-%m-%d %H:%M:%S"),
            "username": entry.username,
            "role": entry.role,
            "action": entry.action,
            "module": entry.module,
            "details": entry.details,
        }
        for entry in AuditLog.objects.all()[:100]
    ]
    return JsonResponse({"audit_logs": logs})


@csrf_exempt
@require_permission("can_export")
def log_export_api(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)
    body = json.loads(request.body.decode("utf-8") or "{}")
    chart_name = body.get("chart_name", "Chart")
    module = body.get("module", "Dashboard")
    _log_audit(
        request.user,
        "EXPORT_GRAPH",
        module,
        f"Exported graph '{chart_name}' as PNG",
    )
    return JsonResponse({"success": True})


# ==============================================================================
# ADMIN CURRENCY MULTIPLIER & SYSTEM SETTINGS ENDPOINT
# ==============================================================================
@csrf_exempt
def settings_api(request):
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Authentication required"}, status=401)

    cfg = SystemSettings.get_solo()

    if request.method == "GET":
        return JsonResponse(
            {
                "currency_code": cfg.currency_code,
                "currency_symbol": cfg.currency_symbol,
                "currency_multiplier": float(cfg.currency_multiplier),
                "updated_by": cfg.updated_by.username if cfg.updated_by else None,
                "updated_at": cfg.updated_at.strftime("%Y-%m-%d %H:%M:%S"),
            }
        )

    if request.method == "POST":
        role = get_user_role(request.user)
        if not ROLE_PERMISSIONS.get(role, {}).get("can_edit_settings", False):
            return JsonResponse(
                {"error": "HTTP 403: Only Administrator can update currency settings"},
                status=403,
            )
        body = json.loads(request.body.decode("utf-8"))
        try:
            mult = Decimal(str(body.get("currency_multiplier", cfg.currency_multiplier)))
            if mult <= 0:
                raise InvalidOperation()
        except InvalidOperation:
            return JsonResponse(
                {"error": "Currency multiplier must be a positive number"}, status=400
            )

        cfg.currency_code = str(body.get("currency_code", cfg.currency_code)).strip().upper() or "USD"
        cfg.currency_symbol = str(body.get("currency_symbol", cfg.currency_symbol)).strip() or "$"
        cfg.currency_multiplier = mult
        cfg.updated_by = request.user
        cfg.save()

        _log_audit(
            request.user,
            "UPDATE_SETTINGS",
            "Admin Settings",
            f"Set currency to {cfg.currency_code} ({cfg.currency_symbol}) x {cfg.currency_multiplier}",
        )
        return JsonResponse(
            {
                "success": True,
                "currency_code": cfg.currency_code,
                "currency_symbol": cfg.currency_symbol,
                "currency_multiplier": float(cfg.currency_multiplier),
            }
        )

    return JsonResponse({"error": "GET or POST required"}, status=405)


# ==============================================================================
# SAVED REPORT CONFIGURATIONS (PERSISTED IN SQLITE)
# ==============================================================================
def configs_list_api(request):
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Authentication required"}, status=401)
    items = [
        {
            "id": r.id,
            "title": r.title,
            "module": r.module,
            "filter_params": r.filter_params,
            "consultant_notes": r.consultant_notes,
            "created_by": r.created_by.username if r.created_by else "system",
            "updated_at": r.updated_at.strftime("%Y-%m-%d %H:%M"),
        }
        for r in SavedReportConfig.objects.all().order_by("-updated_at")
    ]
    return JsonResponse({"saved_reports": items})


@csrf_exempt
@require_permission("can_edit_reports")
def configs_create_api(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)
    body = json.loads(request.body.decode("utf-8"))
    obj = SavedReportConfig.objects.create(
        title=body.get("title", "Untitled Snapshot"),
        module=body.get("module", "sales"),
        filter_params=body.get("filter_params", {}),
        consultant_notes=body.get("consultant_notes", ""),
        created_by=request.user,
    )
    _log_audit(
        request.user,
        "CREATE_REPORT_CONFIG",
        obj.module,
        f"Saved report preset '{obj.title}'",
    )
    return JsonResponse(
        {
            "success": True,
            "report": {
                "id": obj.id,
                "title": obj.title,
                "module": obj.module,
                "filter_params": obj.filter_params,
                "consultant_notes": obj.consultant_notes,
                "created_by": request.user.username,
            },
        }
    )


@csrf_exempt
@require_permission("can_delete_reports")
def configs_delete_api(request, report_id):
    deleted, _ = SavedReportConfig.objects.filter(id=report_id).delete()
    if deleted:
        _log_audit(
            request.user,
            "DELETE_REPORT_CONFIG",
            "Saved Reports",
            f"Deleted report preset ID {report_id}",
        )
    return JsonResponse({"success": True})