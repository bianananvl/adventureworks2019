from django.contrib import admin
from django.urls import path, include
from django.views.generic import TemplateView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("analytics.urls")),
    path("", TemplateView.as_view(template_name="index.html"), name="home"),
    path("executive_central.html", TemplateView.as_view(template_name="executive_central.html")),
    path("sales_analysis.html", TemplateView.as_view(template_name="sales_analysis.html")),
    path("customer_profile.html", TemplateView.as_view(template_name="customer_profile.html")),
    path("revenue_loss.html", TemplateView.as_view(template_name="revenue_loss.html")),
    path("cost_analysis.html", TemplateView.as_view(template_name="cost_analysis.html")),
    path("audit_logs.html", TemplateView.as_view(template_name="audit_logs.html")),
    path("settings.html", TemplateView.as_view(template_name="settings.html")),
    path("profile.html", TemplateView.as_view(template_name="profile.html")),
]