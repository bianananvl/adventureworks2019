from django.urls import path
from . import views

urlpatterns = [
    path("auth/login/", views.login_view, name="login"),
    path("auth/logout/", views.logout_view, name="logout"),
    path("login/", views.login_view, name="login_alias"),
    path("logout/", views.logout_view, name="logout_alias"),
    path("filters/", views.filters_api, name="filters_api"),
    path("dashboard/", views.executive_api, name="dashboard_api"),
    path("executive/", views.executive_api, name="executive_api"),
    path("reports/sales/", views.sales_api, name="sales_report_api"),
    path("sales/", views.sales_api, name="sales_api"),
    path("reports/customers/", views.customer_api, name="customer_report_api"),
    path("customers/", views.customer_api, name="customer_api"),
    path("reports/revenue-loss/", views.revenue_loss_api, name="revenue_loss_report_api"),
    path("revenue-loss/", views.revenue_loss_api, name="revenue_loss_api"),
    path("reports/cost/", views.cost_api, name="cost_report_api"),
    path("cost/", views.cost_api, name="cost_api"),
    path("rbac/", views.rbac_api, name="rbac_api"),
    path("audit/", views.audit_api, name="audit_api"),
    path("audit/log-export/", views.log_export_api, name="log_export_api"),
    path("settings/", views.settings_api, name="settings_api"),
    path("configs/", views.configs_list_api, name="configs_list_api"),
    path("configs/create/", views.configs_create_api, name="configs_create_api"),
    path("configs/<int:report_id>/delete/", views.configs_delete_api, name="configs_delete_api"),
]