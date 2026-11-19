from functools import wraps
from django.http import JsonResponse
from .models import UserRoleProfile


def get_or_create_profile(user):
    profile, _ = UserRoleProfile.objects.get_or_create(user=user)
    return profile


def require_module_view(module_flag: str):
    """
    Backend RBAC enforcement for viewing reporting modules.
    """
    def decorator(view_func):
        @wraps(view_func)
        def _wrapped_view(request, *args, **kwargs):
            if not request.user.is_authenticated:
                return JsonResponse({"error": "Authentication required."}, status=401)

            profile = get_or_create_profile(request.user)
            if not getattr(profile, module_flag, False):
                return JsonResponse(
                    {
                        "error": "Access Denied (RBAC Violation).",
                        "detail": f"Role '{profile.get_role_display()}' lacks '{module_flag}' permission.",
                    },
                    status=403,
                )

            request.rbac_profile = profile
            return view_func(request, *args, **kwargs)

        return _wrapped_view

    return decorator


def require_report_action(action: str):
    """
    Backend RBAC enforcement for 'edit' or 'delete' on SavedReportConfig.
    """
    def decorator(view_func):
        @wraps(view_func)
        def _wrapped_view(request, *args, **kwargs):
            if not request.user.is_authenticated:
                return JsonResponse({"error": "Authentication required."}, status=401)

            profile = get_or_create_profile(request.user)
            allowed = (
                profile.can_edit_reports
                if action == "edit"
                else profile.can_delete_reports
            )
            if not allowed:
                return JsonResponse(
                    {
                        "error": f"Permission Denied: Cannot {action} report configurations.",
                        "role": profile.get_role_display(),
                    },
                    status=403,
                )

            request.rbac_profile = profile
            return view_func(request, *args, **kwargs)

        return _wrapped_view

    return decorator