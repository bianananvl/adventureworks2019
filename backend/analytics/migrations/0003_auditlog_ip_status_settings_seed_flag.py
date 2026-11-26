from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("analytics", "0002_auditlog_systemsettings"),
    ]

    operations = [
        migrations.AddField(
            model_name="auditlog",
            name="ip_address",
            field=models.GenericIPAddressField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="auditlog",
            name="status",
            field=models.CharField(default="SUCCESS", help_text="SUCCESS, FAILED or DENIED.", max_length=10),
        ),
        migrations.AddField(
            model_name="systemsettings",
            name="default_users_seeded",
            field=models.BooleanField(
                default=False,
                help_text="Set once the demo role accounts have been created, so deleted users are not re-created.",
            ),
        ),
    ]
