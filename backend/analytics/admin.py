from django.contrib import admin
from .models import SavedReportConfig, UserRoleProfile


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