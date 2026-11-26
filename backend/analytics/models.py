from decimal import Decimal
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
    can_view_sales = models.BooleanField(default=True)
    can_view_customers = models.BooleanField(default=False)
    can_view_revenue_loss = models.BooleanField(default=False)
    can_view_cost = models.BooleanField(default=False)
    can_edit_reports = models.BooleanField(default=False)
    can_delete_reports = models.BooleanField(default=False)

    def save(self, *args, **kwargs):
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


class SystemSettings(models.Model):
    """
    Admin-managed global settings (singleton row id=1), including the active
    currency multiplier applied across AdventureWorks USD figures.
    """

    currency_code = models.CharField(
        max_length=10,
        default="USD",
        help_text="Display currency code (e.g., USD, PHP, EUR).",
    )
    currency_symbol = models.CharField(
        max_length=5,
        default="$",
        help_text="Display symbol (e.g., $, ₱, €).",
    )
    currency_multiplier = models.DecimalField(
        max_digits=12,
        decimal_places=4,
        default=Decimal("1.0000"),
        help_text="Multiplier applied to base USD figures from AdventureWorks (e.g., 58.5000 for PHP).",
    )
    default_users_seeded = models.BooleanField(
        default=False,
        help_text="Set once the demo role accounts have been created, so deleted users are not re-created.",
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "System Settings"
        verbose_name_plural = "System Settings"

    @classmethod
    def get_solo(cls):
        obj, _ = cls.objects.get_or_create(
            pk=1,
            defaults={
                "currency_code": "USD",
                "currency_symbol": "$",
                "currency_multiplier": Decimal("1.0000"),
            },
        )
        return obj

    def __str__(self):
        return f"{self.currency_code} ({self.currency_symbol}) x {self.currency_multiplier}"


class AuditLog(models.Model):
    """
    Dedicated audit trail separated from RBAC user/role management.
    """

    timestamp = models.DateTimeField(auto_now_add=True)
    username = models.CharField(max_length=150)
    role = models.CharField(max_length=50, blank=True)
    action = models.CharField(max_length=100)
    module = models.CharField(max_length=100, blank=True)
    details = models.TextField(blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    status = models.CharField(
        max_length=10,
        default="SUCCESS",
        help_text="SUCCESS, FAILED or DENIED.",
    )

    class Meta:
        ordering = ["-timestamp"]

    def __str__(self):
        return f"[{self.timestamp:%Y-%m-%d %H:%M}] {self.username}: {self.action}"