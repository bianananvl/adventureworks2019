import json
from django.contrib.auth import authenticate, login, logout
from django.db import DatabaseError
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from .models import SavedReportConfig
from .permissions import (
    get_or_create_profile,
    require_module_view,
    require_report_action,
)
from .services import (
    get_available_filters,
    get_cost_report,
    get_customer_profile_report,
    get_revenue_and_loss_report,
    get_sales_report,
)


def _resolve_scope(request):
    """
    Validates query filters and enforces category scope if the user's RBAC profile
    restricts them to a specific ProductCategoryID.
    """
    year = request.GET.get("year")
    category_id = request.GET.get("category_id")

    if year and not year.isdigit():
        raise ValueError("Invalid 'year' filter. Must be numeric.")
    if category_id and not category_id.isdigit():
        raise ValueError("Invalid 'category_id' filter. Must be numeric.")

    profile = getattr(request, "rbac_profile", None)
    if profile and profile.assigned_category_id:
        # Enforce assigned scope regardless of what the user passes in query params
        category_id = str(profile.assigned_category_id)

    return year, category_id


@csrf_exempt
@require_http_methods(["POST"])
def api_login(request):
    try:
        body = json.loads(request.body.decode("utf-8"))
        username = body.get("username", "").strip()
        password = body.get("password", "")
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JsonResponse({"error": "Invalid JSON payload."}, status=400)

    user = authenticate(request, username=username, password=password)
    if user is None:
        return JsonResponse({"error": "Invalid username or password."}, status=401)

    login(request, user)
    profile = get_or_create_profile(user)
    return JsonResponse(
        {
            "message": "Login successful.",
            "user": user.username,
            "role": profile.role,
            "role_display": profile.get_role_display(),
            "permissions": {
                "can_view_sales": profile.can_view_sales,
                "can_view_customers": profile.can_view_customers,
                "can_view_revenue_loss": profile.can_view_revenue_loss,
                "can_view_cost": profile.can_view_cost,
                "can_edit_reports": profile.can_edit_reports,
                "can_delete_reports": profile.can_delete_reports,
                "assigned_category_id": profile.assigned_category_id,
            },
        }
    )


@csrf_exempt
@require_http_methods(["POST"])
def api_logout(request):
    logout(request)
    return JsonResponse({"message": "Logged out successfully."})


@require_GET
def api_metadata_filters(request):
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Authentication required."}, status=401)
    try:
        return JsonResponse(get_available_filters())
    except DatabaseError as exc:
        return JsonResponse(
            {"error": "Database connection error.", "detail": str(exc)}, status=503
        )


@require_GET
def api_dashboard_overview(request):
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Authentication required."}, status=401)

    profile = get_or_create_profile(request.user)
    request.rbac_profile = profile

    try:
        year, category_id = _resolve_scope(request)
        payload = {"role": profile.get_role_display(), "modules": {}}

        if profile.can_view_sales:
            payload["modules"]["sales"] = get_sales_report(year, category_id)["kpis"]
        if profile.can_view_revenue_loss:
            payload["modules"]["financials"] = get_revenue_and_loss_report(
                year, category_id
            )["financial_summary"]
        if profile.can_view_cost:
            payload["modules"]["costs"] = get_cost_report(year, category_id)[
                "sales_side_costs"
            ]
        if profile.can_view_customers:
            payload["modules"]["customers"] = get_customer_profile_report(year)[
                "segments"
            ]

        return JsonResponse(payload)
    except ValueError as ve:
        return JsonResponse({"error": str(ve)}, status=400)
    except DatabaseError as de:
        return JsonResponse({"error": "SQL query failure.", "detail": str(de)}, status=500)


@require_GET
@require_module_view("can_view_sales")
def api_sales_report(request):
    try:
        year, category_id = _resolve_scope(request)
        return JsonResponse(get_sales_report(year, category_id))
    except ValueError as ve:
        return JsonResponse({"error": str(ve)}, status=400)
    except DatabaseError as de:
        return JsonResponse({"error": "SQL query failure.", "detail": str(de)}, status=500)


@require_GET
@require_module_view("can_view_customers")
def api_customer_report(request):
    try:
        year, _ = _resolve_scope(request)
        return JsonResponse(get_customer_profile_report(year))
    except ValueError as ve:
        return JsonResponse({"error": str(ve)}, status=400)
    except DatabaseError as de:
        return JsonResponse({"error": "SQL query failure.", "detail": str(de)}, status=500)


@require_GET
@require_module_view("can_view_revenue_loss")
def api_revenue_loss_report(request):
    try:
        year, category_id = _resolve_scope(request)
        return JsonResponse(get_revenue_and_loss_report(year, category_id))
    except ValueError as ve:
        return JsonResponse({"error": str(ve)}, status=400)
    except DatabaseError as de:
        return JsonResponse({"error": "SQL query failure.", "detail": str(de)}, status=500)


@require_GET
@require_module_view("can_view_cost")
def api_cost_report(request):
    try:
        year, category_id = _resolve_scope(request)
        return JsonResponse(get_cost_report(year, category_id))
    except ValueError as ve:
        return JsonResponse({"error": str(ve)}, status=400)
    except DatabaseError as de:
        return JsonResponse({"error": "SQL query failure.", "detail": str(de)}, status=500)


# ==============================================================================
# APPLICATION-MANAGED REPORT CONFIGURATIONS (VIEW / EDIT / DELETE RBAC)
# ==============================================================================
@require_GET
def api_saved_reports_list(request):
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Authentication required."}, status=401)

    configs = SavedReportConfig.objects.all().order_by("-updated_at")
    data = [
        {
            "id": c.id,
            "title": c.title,
            "module": c.module,
            "filter_params": c.filter_params,
            "consultant_notes": c.consultant_notes,
            "updated_at": c.updated_at.isoformat(),
        }
        for c in configs
    ]
    return JsonResponse({"saved_reports": data})


@csrf_exempt
@require_http_methods(["POST", "PUT"])
@require_report_action("edit")
def api_saved_report_upsert(request, report_id=None):
    try:
        body = json.loads(request.body.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JsonResponse({"error": "Invalid JSON payload."}, status=400)

    title = body.get("title", "").strip()
    module = body.get("module", "").strip()
    if not title or not module:
        return JsonResponse({"error": "'title' and 'module' are required."}, status=400)

    if report_id:
        report = get_object_or_404(SavedReportConfig, id=report_id)
        report.title = title
        report.module = module
        report.filter_params = body.get("filter_params", report.filter_params)
        report.consultant_notes = body.get("consultant_notes", report.consultant_notes)
        report.save()
    else:
        report = SavedReportConfig.objects.create(
            title=title,
            module=module,
            filter_params=body.get("filter_params", {}),
            consultant_notes=body.get("consultant_notes", ""),
            created_by=request.user,
        )

    return JsonResponse({"message": "Report configuration saved.", "id": report.id})


@csrf_exempt
@require_http_methods(["DELETE"])
@require_report_action("delete")
def api_saved_report_delete(request, report_id):
    report = get_object_or_404(SavedReportConfig, id=report_id)
    report.delete()
    return JsonResponse({"message": "Report configuration deleted."})