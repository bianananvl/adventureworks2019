from django.conf import settings
from django.db import models


class UserRoleProfile(models.Model):
    class RoleChoices(models.TextChoices):
        ADMINISTRATOR = "ADMINISTRATOR", "Administrator"
        MANAGER = "MANAGER", "Manager"
        SUPERVISOR = "SUPERVISOR", "Supervisor"
        EMPLOYEE = "EMPLOYEE", "Employee"

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="role_profile",
    )
    role = models.CharField(
        max_length=20,
        choices=RoleChoices.choices,
        default=RoleChoices.EMPLOYEE,
    )
    assigned_category_id = models.IntegerField(
        null=True,
        blank=True,
        help_text="Optional ProductCategoryID scope for Supervisor/Manager roles.",
    )
    # Granular module-level view permissions (especially useful for Employee scoping)
    can_view_sales = models.BooleanField(default=True)
    can_view_customers = models.BooleanField(default=False)
    can_view_revenue_loss = models.BooleanField(default=False)
    can_view_cost = models.BooleanField(default=False)

    # Action permissions on application-managed report configurations
    can_edit_reports = models.BooleanField(default=False)
    can_delete_reports = models.BooleanField(default=False)

    def save(self, *args, **kwargs):
        # Enforce baseline RBAC matrix defaults on save
        if self.role == self.RoleChoices.ADMINISTRATOR:
            self.can_view_sales = True
            self.can_view_customers = True
            self.can_view_revenue_loss = True
            self.can_view_cost = True
            self.can_edit_reports = True
            self.can_delete_reports = True
        elif self.role == self.RoleChoices.MANAGER:
            self.can_view_sales = True
            self.can_view_customers = True
            self.can_view_revenue_loss = True
            self.can_view_cost = True
            self.can_edit_reports = True
            self.can_delete_reports = False
        elif self.role == self.RoleChoices.SUPERVISOR:
            self.can_view_sales = True
            self.can_view_customers = True
            self.can_view_revenue_loss = False
            self.can_view_cost = False
            self.can_edit_reports = False
            self.can_delete_reports = False
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.user.username} ({self.get_role_display()})"


class SavedReportConfig(models.Model):
    """
    Application-managed report presets/annotations.
    Supports Edit and Delete RBAC operations without modifying read-only AdventureWorks data.
    """

    MODULE_CHOICES = [
        ("dashboard", "Centralized Dashboard"),
        ("sales", "Sales Report"),
        ("customers", "Customer Profile"),
        ("revenue_loss", "Revenue & Loss Report"),
        ("cost", "Cost Report"),
    ]

    title = models.CharField(max_length=150)
    module = models.CharField(max_length=30, choices=MODULE_CHOICES)
    filter_params = models.JSONField(default=dict, blank=True)
    consultant_notes = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True
    )
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"[{self.module}] {self.title}"