from django.contrib import admin
from .models import AuditLog, SavedReportConfig, SystemSettings, UserRoleProfile


@admin.register(UserRoleProfile)
class UserRoleProfileAdmin(admin.ModelAdmin):
    list_display = (
        "user",
        "role",
        "assigned_category_id",
        "can_view_sales",
        "can_view_customers",
        "can_view_revenue_loss",
        "can_view_cost",
        "can_edit_reports",
        "can_delete_reports",
    )
    list_filter = ("role",)


@admin.register(SavedReportConfig)
class SavedReportConfigAdmin(admin.ModelAdmin):
    list_display = ("title", "module", "created_by", "updated_at")
    list_filter = ("module",)


@admin.register(SystemSettings)
class SystemSettingsAdmin(admin.ModelAdmin):
    list_display = (
        "currency_code",
        "currency_symbol",
        "currency_multiplier",
        "updated_by",
        "updated_at",
    )

    def has_add_permission(self, request):
        # Enforce single global settings row
        return not SystemSettings.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False

    def save_model(self, request, obj, form, change):
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ("timestamp", "username", "role", "action", "module", "details")
    list_filter = ("action", "module", "role")
    search_fields = ("username", "action", "details")
    readonly_fields = ("timestamp", "username", "role", "action", "module", "details")

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False