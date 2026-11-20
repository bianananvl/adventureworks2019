import json
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import User, Group
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from .permissions import ROLE_PERMISSIONS, get_user_role, require_permission
from . import services


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
    cust_data = services.get_customer_profile_report(year=year)
    return JsonResponse(
        {
            "filters": services.get_available_filters(),
            "modules": {
                "customers": cust_data.get("segments", []),
            },
            "sales": services.get_sales_report(year=year, category_id=category_id),
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
    return JsonResponse(
        services.get_sales_report(year=year, category_id=category_id)
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


@require_permission("can_view_audit")
def audit_api(request):
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


_SAVED_SNAPSHOTS = []
_NEXT_SNAPSHOT_ID = 1


def configs_list_api(request):
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Authentication required"}, status=401)
    return JsonResponse({"saved_reports": _SAVED_SNAPSHOTS})


@csrf_exempt
@require_permission("can_edit_reports")
def configs_create_api(request):
    global _NEXT_SNAPSHOT_ID
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)
    body = json.loads(request.body.decode("utf-8"))
    item = {
        "id": _NEXT_SNAPSHOT_ID,
        "title": body.get("title", "Untitled Snapshot"),
        "module": body.get("module", "Sales Report"),
        "filter_params": body.get("filter_params", {}),
        "consultant_notes": body.get("consultant_notes", ""),
        "created_by": request.user.username,
    }
    _NEXT_SNAPSHOT_ID += 1
    _SAVED_SNAPSHOTS.insert(0, item)
    return JsonResponse({"success": True, "report": item})


@csrf_exempt
@require_permission("can_delete_reports")
def configs_delete_api(request, report_id):
    global _SAVED_SNAPSHOTS
    _SAVED_SNAPSHOTS = [r for r in _SAVED_SNAPSHOTS if r["id"] != report_id]
    return JsonResponse({"success": True})