import csv
import json
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import Group, User
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Count, Q
from django.db.models.functions import TruncDate
from django.http import HttpResponse, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from .models import AuditLog, SavedReportConfig, SystemSettings
from .permissions import ROLE_PERMISSIONS, VALID_ROLES, get_user_role, require_permission
from . import services


def _client_ip(request):
    if request is None:
        return None
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
    if forwarded:
        return forwarded.split(",")[0].strip() or None
    return request.META.get("REMOTE_ADDR") or None


def _log_audit(user, action, module="", details="", request=None, status="SUCCESS", username=None):
    is_auth = bool(user and user.is_authenticated)
    AuditLog.objects.create(
        username=username or (user.username if is_auth else "anonymous"),
        role=get_user_role(user) if is_auth else "GUEST",
        action=action,
        module=module,
        details=details,
        ip_address=_client_ip(request),
        status=status,
    )


def _json_body(request):
    try:
        return json.loads(request.body.decode("utf-8") or "{}")
    except (ValueError, UnicodeDecodeError):
        return {}


def _parse_int_list(request, key):
    """Accepts ?year=2011,2012 or repeated ?year=2011&year=2012 (multi-select checkboxes)."""
    out = set()
    for item in request.GET.getlist(key) + request.GET.getlist(f"{key}[]"):
        for part in str(item).split(","):
            part = part.strip()
            if part.isdigit():
                out.add(int(part))
    return sorted(out)


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


DEFAULT_USERS = [
    ("admin", "admin123", "ADMINISTRATOR"),
    ("manager", "manager123", "MANAGER"),
    ("supervisor", "supervisor123", "SUPERVISOR"),
    ("sales_analyst", "sales123", "SALES_ANALYST"),
    ("customer_analyst", "customer123", "CUSTOMER_ANALYST"),
    ("financial_analyst", "financial123", "FINANCIAL_ANALYST"),
    ("cost_analyst", "cost123", "COST_ANALYST"),
]


def _assign_role(user, role):
    """Role = Django group; Administrators are also superusers so get_user_role resolves them."""
    grp, _ = Group.objects.get_or_create(name=role)
    is_admin = role == "ADMINISTRATOR"
    user.is_staff = is_admin
    user.is_superuser = is_admin
    user.save()
    user.groups.clear()
    user.groups.add(grp)


def ensure_rbac_users():
    """
    Seeds the demo role accounts exactly once. After that, accounts are managed from
    the User Management page, so deleted or edited users are never silently restored.
    """
    cfg = SystemSettings.get_solo()
    if cfg.default_users_seeded:
        return
    with transaction.atomic():
        for uname, pwd, role_name in DEFAULT_USERS:
            u, created = User.objects.get_or_create(username=uname)
            if created:
                u.set_password(pwd)
                _assign_role(u, role_name)
        cfg.default_users_seeded = True
        cfg.save(update_fields=["default_users_seeded"])


@csrf_exempt
def login_view(request):
    ensure_rbac_users()
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)
    body = _json_body(request)
    username = str(body.get("username", "")).strip()
    user = authenticate(
        request,
        username=username,
        password=body.get("password", ""),
    )
    if not user:
        inactive = User.objects.filter(username=username, is_active=False).exists()
        _log_audit(
            None,
            "LOGIN_FAILED",
            "Authentication",
            "Account is deactivated" if inactive else "Invalid username or password",
            request=request,
            status="FAILED",
            username=username[:150] or "unknown",
        )
        return JsonResponse(
            {
                "success": False,
                "error": "This account has been deactivated. Contact your administrator."
                if inactive
                else "Invalid username or password",
            },
            status=401,
        )
    login(request, user)
    role = get_user_role(user)
    perms = ROLE_PERMISSIONS.get(role, ROLE_PERMISSIONS["SALES_ANALYST"])
    _log_audit(user, "LOGIN", "Authentication", f"User signed in as {role}", request=request)
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
        _log_audit(request.user, "LOGOUT", "Authentication", "User signed out", request=request)
    logout(request)
    return JsonResponse({"success": True})


def filters_api(request):
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Authentication required"}, status=401)
    return JsonResponse(services.get_available_filters())


@require_permission("can_view_executive")
def executive_api(request):
    year = _parse_int_list(request, "year")
    category_id = _parse_int_list(request, "category_id")
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
            "prior_year": services.get_prior_year_kpis(year, category_id=category_id),
            "yearly_overview": services.get_yearly_overview(category_id=category_id, years=year),
        }
    )


@require_permission("can_view_sales")
def sales_api(request):
    year = _parse_int_list(request, "year")
    category_id = _parse_int_list(request, "category_id")
    staff_ids = _parse_staff_ids(request)
    data = services.get_sales_report(
        year=year, category_id=category_id, staff_ids=staff_ids
    )
    if not staff_ids:
        data["prior_year"] = services.get_prior_year_kpis(year, category_id=category_id)
    return JsonResponse(data)


@require_permission("can_view_sales")
def sales_compare_api(request):
    return JsonResponse(
        services.get_sales_comparison(
            granularity=request.GET.get("granularity", "month"),
            dimension=request.GET.get("dimension", "total"),
            metric=request.GET.get("metric", "sales_amount"),
            year=_parse_int_list(request, "year"),
            category_id=_parse_int_list(request, "category_id"),
            staff_ids=_parse_staff_ids(request),
        )
    )


@require_permission("can_view_customers")
def customer_api(request):
    year = _parse_int_list(request, "year")
    segment = request.GET.get("segment")
    return JsonResponse(
        services.get_customer_profile_report(
            year=year, segment=segment, limit=request.GET.get("limit", 10)
        )
    )


@require_permission("can_view_revenue_loss")
def revenue_loss_api(request):
    year = _parse_int_list(request, "year")
    category_id = _parse_int_list(request, "category_id")
    data = services.get_revenue_and_loss_report(year=year, category_id=category_id)
    data["prior_year"] = services.get_prior_year_kpis(year, category_id=category_id)
    return JsonResponse(data)


@require_permission("can_view_revenue_loss")
def revenue_compare_api(request):
    return JsonResponse(
        services.get_revenue_comparison(
            granularity=request.GET.get("granularity", "year"),
            year=_parse_int_list(request, "year"),
            category_id=_parse_int_list(request, "category_id"),
        )
    )


@require_permission("can_view_cost")
def cost_api(request):
    year = _parse_int_list(request, "year")
    category_id = _parse_int_list(request, "category_id")
    return JsonResponse(
        services.get_cost_report(year=year, category_id=category_id)
    )


# ==============================================================================
# USER MANAGEMENT & RBAC (ADMINISTRATOR ONLY)
# ==============================================================================
def _serialize_user(u):
    role = get_user_role(u)
    return {
        "id": u.id,
        "username": u.username,
        "first_name": u.first_name,
        "last_name": u.last_name,
        "full_name": u.get_full_name(),
        "email": u.email,
        "role": role,
        "role_display": ROLE_PERMISSIONS.get(role, {}).get("role_display", role),
        "is_active": u.is_active,
        "last_login": u.last_login.strftime("%Y-%m-%d %H:%M") if u.last_login else None,
        "date_joined": u.date_joined.strftime("%Y-%m-%d"),
    }


def _active_admin_count(exclude_id=None):
    qs = User.objects.filter(is_active=True).filter(
        Q(is_superuser=True) | Q(groups__name="ADMINISTRATOR")
    )
    if exclude_id:
        qs = qs.exclude(id=exclude_id)
    return qs.distinct().count()


def _password_errors(password, user=None):
    try:
        validate_password(password, user=user)
    except ValidationError as exc:
        return " ".join(exc.messages)
    return None


@require_permission("can_view_rbac")
def rbac_api(request):
    users_list = [_serialize_user(u) for u in User.objects.all().order_by("id")]
    role_counts = {}
    for u in users_list:
        role_counts[u["role"]] = role_counts.get(u["role"], 0) + 1
    return JsonResponse(
        {
            "users": users_list,
            "rbac_matrix": ROLE_PERMISSIONS,
            "roles": [
                {"key": k, "label": v["role_display"], "user_count": role_counts.get(k, 0)}
                for k, v in ROLE_PERMISSIONS.items()
            ],
            "summary": {
                "total": len(users_list),
                "active": sum(1 for u in users_list if u["is_active"]),
                "inactive": sum(1 for u in users_list if not u["is_active"]),
                "administrators": role_counts.get("ADMINISTRATOR", 0),
            },
        }
    )


@csrf_exempt
@require_permission("can_manage_users")
def user_create_api(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)
    body = _json_body(request)
    username = str(body.get("username", "")).strip()
    password = str(body.get("password", ""))
    role = str(body.get("role", "")).strip().upper()

    if not username or len(username) > 150:
        return JsonResponse({"error": "Username is required (max 150 characters)."}, status=400)
    if User.objects.filter(username__iexact=username).exists():
        return JsonResponse({"error": f"Username '{username}' is already taken."}, status=400)
    if role not in VALID_ROLES:
        return JsonResponse({"error": "Please choose a valid role."}, status=400)
    candidate = User(username=username, email=str(body.get("email", "")).strip())
    pw_err = _password_errors(password, candidate)
    if pw_err:
        return JsonResponse({"error": pw_err}, status=400)

    with transaction.atomic():
        u = User.objects.create_user(
            username=username,
            password=password,
            email=str(body.get("email", "")).strip(),
            first_name=str(body.get("first_name", "")).strip()[:150],
            last_name=str(body.get("last_name", "")).strip()[:150],
        )
        u.is_active = bool(body.get("is_active", True))
        _assign_role(u, role)

    _log_audit(request.user, "USER_CREATED", "User Management",
               f"Created user '{u.username}' with role {role}", request=request)
    return JsonResponse({"success": True, "user": _serialize_user(u)})


@csrf_exempt
@require_permission("can_manage_users")
def user_update_api(request, user_id):
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)
    u = User.objects.filter(id=user_id).first()
    if not u:
        return JsonResponse({"error": "User not found."}, status=404)
    body = _json_body(request)
    changes = []
    old_role = get_user_role(u)

    new_role = str(body.get("role", old_role)).strip().upper()
    if new_role not in VALID_ROLES:
        return JsonResponse({"error": "Please choose a valid role."}, status=400)
    new_active = bool(body.get("is_active", u.is_active))

    losing_admin = old_role == "ADMINISTRATOR" and (new_role != "ADMINISTRATOR" or not new_active)
    if losing_admin and _active_admin_count(exclude_id=u.id) == 0:
        return JsonResponse(
            {"error": "At least one active Administrator must remain."}, status=400
        )
    if u.id == request.user.id and (not new_active or new_role != old_role):
        return JsonResponse(
            {"error": "You cannot change your own role or deactivate your own account."},
            status=400,
        )

    for field in ("first_name", "last_name", "email"):
        if field in body:
            val = str(body.get(field, "")).strip()[:150]
            if val != getattr(u, field):
                setattr(u, field, val)
                changes.append(field)
    if new_active != u.is_active:
        u.is_active = new_active
        changes.append("activated" if new_active else "deactivated")

    with transaction.atomic():
        u.save()
        if new_role != old_role:
            _assign_role(u, new_role)
            changes.append(f"role {old_role} -> {new_role}")

    if changes:
        action = "USER_ROLE_CHANGED" if new_role != old_role else "USER_UPDATED"
        _log_audit(request.user, action, "User Management",
                   f"Updated '{u.username}': {', '.join(changes)}", request=request)
    return JsonResponse({"success": True, "user": _serialize_user(u)})


@csrf_exempt
@require_permission("can_manage_users")
def user_reset_password_api(request, user_id):
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)
    u = User.objects.filter(id=user_id).first()
    if not u:
        return JsonResponse({"error": "User not found."}, status=404)
    password = str(_json_body(request).get("password", ""))
    pw_err = _password_errors(password, u)
    if pw_err:
        return JsonResponse({"error": pw_err}, status=400)
    u.set_password(password)
    u.save()
    _log_audit(request.user, "USER_PASSWORD_RESET", "User Management",
               f"Reset password for '{u.username}'", request=request)
    return JsonResponse({"success": True})


@csrf_exempt
@require_permission("can_manage_users")
def user_delete_api(request, user_id):
    if request.method not in ("POST", "DELETE"):
        return JsonResponse({"error": "POST or DELETE required"}, status=405)
    u = User.objects.filter(id=user_id).first()
    if not u:
        return JsonResponse({"error": "User not found."}, status=404)
    if u.id == request.user.id:
        return JsonResponse({"error": "You cannot delete your own account."}, status=400)
    if get_user_role(u) == "ADMINISTRATOR" and _active_admin_count(exclude_id=u.id) == 0:
        return JsonResponse({"error": "At least one active Administrator must remain."}, status=400)
    uname = u.username
    u.delete()
    _log_audit(request.user, "USER_DELETED", "User Management",
               f"Deleted user '{uname}'", request=request)
    return JsonResponse({"success": True})


# ==============================================================================
# AUDIT LOGS (SEPARATE FROM RBAC)
# ==============================================================================
def _filtered_audit_qs(request):
    qs = AuditLog.objects.all()
    g = request.GET
    if g.get("username"):
        qs = qs.filter(username=g["username"])
    if g.get("action"):
        qs = qs.filter(action=g["action"])
    if g.get("module"):
        qs = qs.filter(module=g["module"])
    if g.get("status"):
        qs = qs.filter(status=g["status"])
    for key, lookup in (("date_from", "timestamp__date__gte"), ("date_to", "timestamp__date__lte")):
        if g.get(key):
            try:
                qs = qs.filter(**{lookup: datetime.strptime(g[key], "%Y-%m-%d").date()})
            except ValueError:
                pass
    q = (g.get("q") or "").strip()
    if q:
        qs = qs.filter(
            Q(username__icontains=q) | Q(role__icontains=q) | Q(action__icontains=q)
            | Q(module__icontains=q) | Q(details__icontains=q)
        )
    return qs


def _serialize_log(entry):
    return {
        "id": entry.id,
        "timestamp": timezone.localtime(entry.timestamp).strftime("%Y-%m-%d %H:%M:%S"),
        "username": entry.username,
        "role": entry.role,
        "action": entry.action,
        "module": entry.module,
        "details": entry.details,
        "ip_address": entry.ip_address,
        "status": entry.status,
    }


@require_permission("can_view_audit")
def audit_api(request):
    qs = _filtered_audit_qs(request)
    try:
        page = max(int(request.GET.get("page", 1)), 1)
        page_size = min(max(int(request.GET.get("page_size", 25)), 5), 200)
    except ValueError:
        page, page_size = 1, 25
    total = qs.count()
    pages = max((total + page_size - 1) // page_size, 1)
    page = min(page, pages)
    start = (page - 1) * page_size
    logs = [_serialize_log(e) for e in qs[start:start + page_size]]

    since = timezone.now() - timedelta(days=13)
    daily = (
        qs.filter(timestamp__gte=since.replace(hour=0, minute=0, second=0, microsecond=0))
        .annotate(day=TruncDate("timestamp"))
        .values("day")
        .annotate(count=Count("id"))
        .order_by("day")
    )
    daily_map = {str(d["day"]): d["count"] for d in daily}
    today = timezone.localdate()
    daily_series = [
        {"day": str(today - timedelta(days=i)), "count": daily_map.get(str(today - timedelta(days=i)), 0)}
        for i in range(13, -1, -1)
    ]

    all_logs = AuditLog.objects.all()
    return JsonResponse(
        {
            "audit_logs": logs,
            "pagination": {"page": page, "pages": pages, "page_size": page_size, "total": total},
            "summary": {
                "total_events": total,
                "unique_users": qs.values("username").distinct().count(),
                "failed_logins": qs.filter(action="LOGIN_FAILED").count(),
                "admin_changes": qs.filter(module__in=["User Management", "Admin Settings"]).count(),
                "by_action": list(qs.values("action").annotate(count=Count("id")).order_by("-count")[:10]),
                "daily": daily_series,
            },
            "filter_options": {
                "usernames": sorted(set(all_logs.values_list("username", flat=True))),
                "actions": sorted(set(all_logs.values_list("action", flat=True))),
                "modules": sorted(m for m in set(all_logs.values_list("module", flat=True)) if m),
                "statuses": ["SUCCESS", "FAILED", "DENIED"],
            },
        }
    )


@require_permission("can_view_audit")
def audit_export_api(request):
    qs = _filtered_audit_qs(request)[:10000]
    response = HttpResponse(content_type="text/csv; charset=utf-8")
    stamp = timezone.localdate().isoformat()
    response["Content-Disposition"] = f'attachment; filename="JBABEWorks_audit_logs_{stamp}.csv"'
    response.write("﻿")
    writer = csv.writer(response)
    writer.writerow(["Timestamp", "User", "Role", "Action", "Module", "Status", "IP Address", "Details"])
    for e in qs:
        r = _serialize_log(e)
        writer.writerow([r["timestamp"], r["username"], r["role"], r["action"], r["module"],
                         r["status"], r["ip_address"] or "", r["details"]])
    _log_audit(request.user, "EXPORT_AUDIT_LOG", "Audit Logs",
               f"Exported {qs.count()} audit entries as CSV", request=request)
    return response


@csrf_exempt
@require_permission("can_export")
def log_export_api(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)
    body = _json_body(request)
    chart_name = str(body.get("chart_name", "Chart"))[:200]
    module = str(body.get("module", "Dashboard"))[:100]
    fmt = str(body.get("format", "PNG")).upper()[:10]
    _log_audit(
        request.user,
        "EXPORT_GRAPH" if fmt == "PNG" else f"EXPORT_{fmt}",
        module,
        f"Exported '{chart_name}' as {fmt}",
        request=request,
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
        body = _json_body(request)
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
            request=request,
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
        request=request,
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
            request=request,
        )
    return JsonResponse({"success": True})