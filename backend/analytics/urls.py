from django.urls import path
from . import views

urlpatterns = [
    # Authentication & Session RBAC
    path("auth/login/", views.api_login, name="api_login"),
    path("auth/logout/", views.api_logout, name="api_logout"),

    # Dynamic Database Metadata (Available Years & Categories)
    path("filters/", views.api_metadata_filters, name="api_metadata_filters"),

    # Centralized Dashboard & 4 Required Reporting Modules
    path("dashboard/", views.api_dashboard_overview, name="api_dashboard_overview"),
    path("reports/sales/", views.api_sales_report, name="api_sales_report"),
    path("reports/customers/", views.api_customer_report, name="api_customer_report"),
    path("reports/revenue-loss/", views.api_revenue_loss_report, name="api_revenue_loss_report"),
    path("reports/cost/", views.api_cost_report, name="api_cost_report"),

    # Application-Managed Report Configurations (RBAC Edit/Delete)
    path("configs/", views.api_saved_reports_list, name="api_saved_reports_list"),
    path("configs/create/", views.api_saved_report_upsert, name="api_saved_report_create"),
    path("configs/<int:report_id>/edit/", views.api_saved_report_upsert, name="api_saved_report_edit"),
    path("configs/<int:report_id>/delete/", views.api_saved_report_delete, name="api_saved_report_delete"),
]