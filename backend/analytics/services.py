from decimal import Decimal
from django.db import connections
from .models import SystemSettings


def _dictfetchall(cursor):
    columns = [col[0] for col in cursor.description]
    return [
        {
            col: float(val) if isinstance(val, Decimal) else val
            for col, val in zip(columns, row)
        }
        for row in cursor.fetchall()
    ]


def get_currency_config():
    cfg = SystemSettings.get_solo()
    return {
        "currency_code": cfg.currency_code,
        "currency_symbol": cfg.currency_symbol,
        "currency_multiplier": float(cfg.currency_multiplier),
    }


def _scale_money(rows_or_dict, fields, multiplier):
    if multiplier == 1.0:
        return rows_or_dict
    if isinstance(rows_or_dict, dict):
        for f in fields:
            if f in rows_or_dict and rows_or_dict[f] is not None:
                rows_or_dict[f] = round(float(rows_or_dict[f]) * multiplier, 2)
        return rows_or_dict
    for row in rows_or_dict:
        for f in fields:
            if f in row and row[f] is not None:
                row[f] = round(float(row[f]) * multiplier, 2)
    return rows_or_dict


def get_available_filters():
    """
    Dynamically inspects AdventureWorks for available years, product categories,
    active sales staff (Sales.SalesPerson), and active admin currency settings.
    """
    with connections["adventureworks"].cursor() as cursor:
        cursor.execute(
            """
            SELECT DISTINCT YEAR(OrderDate) AS sales_year
            FROM Sales.SalesOrderHeader
            WHERE OrderDate IS NOT NULL
            ORDER BY sales_year ASC;
            """
        )
        years = [row[0] for row in cursor.fetchall()]

        cursor.execute(
            """
            SELECT ProductCategoryID, Name
            FROM Production.ProductCategory
            ORDER BY Name ASC;
            """
        )
        categories = _dictfetchall(cursor)

        cursor.execute(
            """
            SELECT DISTINCT
                sp.BusinessEntityID AS staff_id,
                LTRIM(RTRIM(p.FirstName + ' ' + p.LastName)) AS staff_name
            FROM Sales.SalesPerson sp
            INNER JOIN Person.Person p ON sp.BusinessEntityID = p.BusinessEntityID
            INNER JOIN Sales.SalesOrderHeader soh ON sp.BusinessEntityID = soh.SalesPersonID
            ORDER BY staff_name ASC;
            """
        )
        sales_staff = _dictfetchall(cursor)

    return {
        "available_years": years,
        "categories": categories,
        "sales_staff": sales_staff,
        "currency": get_currency_config(),
    }


def _build_where_clause(
    year=None,
    category_id=None,
    staff_ids=None,
    table_alias_header="soh",
    table_alias_cat="pc",
):
    clauses = ["1=1"]
    params = []
    if year:
        clauses.append(f"YEAR({table_alias_header}.OrderDate) = %s")
        params.append(int(year))
    if category_id:
        clauses.append(f"{table_alias_cat}.ProductCategoryID = %s")
        params.append(int(category_id))
    if staff_ids:
        clean_ids = [int(sid) for sid in staff_ids if str(sid).strip().isdigit()]
        if clean_ids:
            placeholders = ", ".join(["%s"] * len(clean_ids))
            clauses.append(f"{table_alias_header}.SalesPersonID IN ({placeholders})")
            params.extend(clean_ids)
    return " AND ".join(clauses), params


# ==============================================================================
# MODULE 1: SALES REPORT (WITH MULTI-STAFF YEAR-OVER-YEAR COMPARISON)
# ==============================================================================
def get_sales_report(year=None, category_id=None, staff_ids=None):
    currency = get_currency_config()
    mult = currency["currency_multiplier"]
    clean_staff_ids = (
        [int(sid) for sid in staff_ids if str(sid).strip().isdigit()]
        if staff_ids
        else []
    )
    where_sql, params = _build_where_clause(year, category_id, clean_staff_ids)

    with connections["adventureworks"].cursor() as cursor:
        # 1. KPI Summary
        cursor.execute(
            f"""
            SELECT
                COUNT(DISTINCT soh.SalesOrderID) AS total_orders,
                COALESCE(SUM(sod.OrderQty), 0) AS total_units_sold,
                COALESCE(SUM(sod.LineTotal), 0) AS total_sales_amount,
                COALESCE(AVG(sod.LineTotal), 0) AS avg_line_value
            FROM Sales.SalesOrderDetail sod
            INNER JOIN Sales.SalesOrderHeader soh ON sod.SalesOrderID = soh.SalesOrderID
            LEFT JOIN Production.Product p ON sod.ProductID = p.ProductID
            LEFT JOIN Production.ProductSubcategory psc ON p.ProductSubcategoryID = psc.ProductSubcategoryID
            LEFT JOIN Production.ProductCategory pc ON psc.ProductCategoryID = pc.ProductCategoryID
            WHERE {where_sql};
            """,
            params,
        )
        kpis = _scale_money(
            _dictfetchall(cursor)[0], ["total_sales_amount", "avg_line_value"], mult
        )

        # 2. Sales Trends across available periods (Year-Month)
        cursor.execute(
            f"""
            SELECT
                YEAR(soh.OrderDate) AS year,
                MONTH(soh.OrderDate) AS month,
                CAST(YEAR(soh.OrderDate) AS VARCHAR(4)) + '-' + RIGHT('0' + CAST(MONTH(soh.OrderDate) AS VARCHAR(2)), 2) AS period,
                SUM(sod.LineTotal) AS sales_amount,
                SUM(sod.OrderQty) AS units_sold
            FROM Sales.SalesOrderDetail sod
            INNER JOIN Sales.SalesOrderHeader soh ON sod.SalesOrderID = soh.SalesOrderID
            LEFT JOIN Production.Product p ON sod.ProductID = p.ProductID
            LEFT JOIN Production.ProductSubcategory psc ON p.ProductSubcategoryID = psc.ProductSubcategoryID
            LEFT JOIN Production.ProductCategory pc ON psc.ProductCategoryID = pc.ProductCategoryID
            WHERE {where_sql}
            GROUP BY YEAR(soh.OrderDate), MONTH(soh.OrderDate)
            ORDER BY year ASC, month ASC;
            """,
            params,
        )
        trends = _scale_money(_dictfetchall(cursor), ["sales_amount"], mult)

        # 3. Sales by Product Category
        cursor.execute(
            f"""
            SELECT
                COALESCE(pc.Name, 'Uncategorized') AS category_name,
                SUM(sod.LineTotal) AS sales_amount,
                SUM(sod.OrderQty) AS units_sold
            FROM Sales.SalesOrderDetail sod
            INNER JOIN Sales.SalesOrderHeader soh ON sod.SalesOrderID = soh.SalesOrderID
            LEFT JOIN Production.Product p ON sod.ProductID = p.ProductID
            LEFT JOIN Production.ProductSubcategory psc ON p.ProductSubcategoryID = psc.ProductSubcategoryID
            LEFT JOIN Production.ProductCategory pc ON psc.ProductCategoryID = pc.ProductCategoryID
            WHERE {where_sql}
            GROUP BY COALESCE(pc.Name, 'Uncategorized')
            ORDER BY sales_amount DESC;
            """,
            params,
        )
        by_category = _scale_money(_dictfetchall(cursor), ["sales_amount"], mult)

        # 4. Top 10 High-Performing Products
        cursor.execute(
            f"""
            SELECT TOP 10
                p.ProductID,
                p.Name AS product_name,
                p.ProductNumber,
                SUM(sod.OrderQty) AS units_sold,
                SUM(sod.LineTotal) AS total_sales
            FROM Sales.SalesOrderDetail sod
            INNER JOIN Sales.SalesOrderHeader soh ON sod.SalesOrderID = soh.SalesOrderID
            INNER JOIN Production.Product p ON sod.ProductID = p.ProductID
            LEFT JOIN Production.ProductSubcategory psc ON p.ProductSubcategoryID = psc.ProductSubcategoryID
            LEFT JOIN Production.ProductCategory pc ON psc.ProductCategoryID = pc.ProductCategoryID
            WHERE {where_sql}
            GROUP BY p.ProductID, p.Name, p.ProductNumber
            ORDER BY total_sales DESC;
            """,
            params,
        )
        top_products = _scale_money(_dictfetchall(cursor), ["total_sales"], mult)

        # 5. Bottom 10 Low-Performing Products
        cursor.execute(
            f"""
            SELECT TOP 10
                p.ProductID,
                p.Name AS product_name,
                p.ProductNumber,
                SUM(sod.OrderQty) AS units_sold,
                SUM(sod.LineTotal) AS total_sales
            FROM Sales.SalesOrderDetail sod
            INNER JOIN Sales.SalesOrderHeader soh ON sod.SalesOrderID = soh.SalesOrderID
            INNER JOIN Production.Product p ON sod.ProductID = p.ProductID
            LEFT JOIN Production.ProductSubcategory psc ON p.ProductSubcategoryID = psc.ProductSubcategoryID
            LEFT JOIN Production.ProductCategory pc ON psc.ProductCategoryID = pc.ProductCategoryID
            WHERE {where_sql}
            GROUP BY p.ProductID, p.Name, p.ProductNumber
            HAVING SUM(sod.LineTotal) > 0
            ORDER BY total_sales ASC;
            """,
            params,
        )
        low_products = _scale_money(_dictfetchall(cursor), ["total_sales"], mult)

        # 6. Multi-Staff Yearly Comparison (for 2+ checked staff across years)
        # Note: deliberately excludes single-year filter so users see differences across all years
        comp_where, comp_params = _build_where_clause(
            year=None, category_id=category_id, staff_ids=clean_staff_ids
        )
        cursor.execute(
            f"""
            SELECT
                soh.SalesPersonID AS staff_id,
                LTRIM(RTRIM(per.FirstName + ' ' + per.LastName)) AS staff_name,
                YEAR(soh.OrderDate) AS year,
                COUNT(DISTINCT soh.SalesOrderID) AS total_orders,
                SUM(sod.OrderQty) AS units_sold,
                SUM(sod.LineTotal) AS sales_amount
            FROM Sales.SalesOrderDetail sod
            INNER JOIN Sales.SalesOrderHeader soh ON sod.SalesOrderID = soh.SalesOrderID
            INNER JOIN Person.Person per ON soh.SalesPersonID = per.BusinessEntityID
            LEFT JOIN Production.Product p ON sod.ProductID = p.ProductID
            LEFT JOIN Production.ProductSubcategory psc ON p.ProductSubcategoryID = psc.ProductSubcategoryID
            LEFT JOIN Production.ProductCategory pc ON psc.ProductCategoryID = pc.ProductCategoryID
            WHERE soh.SalesPersonID IS NOT NULL AND {comp_where}
            GROUP BY soh.SalesPersonID, per.FirstName, per.LastName, YEAR(soh.OrderDate)
            ORDER BY year ASC, staff_name ASC;
            """,
            comp_params,
        )
        staff_comparison = _scale_money(_dictfetchall(cursor), ["sales_amount"], mult)

    return {
        "module": "Sales Report",
        "currency": currency,
        "selected_staff_ids": clean_staff_ids,
        "kpis": kpis,
        "sales_trends": trends,
        "sales_by_category": by_category,
        "staff_comparison": staff_comparison,
        "top_products": top_products,
        "low_products": low_products,
        "governance": {
            "source_tables": [
                "Sales.SalesOrderHeader",
                "Sales.SalesOrderDetail",
                "Sales.SalesPerson",
                "Person.Person",
                "Production.Product",
                "Production.ProductSubcategory",
                "Production.ProductCategory",
            ],
            "formula": "LineTotal = UnitPrice * (1 - UnitPriceDiscount) * OrderQty",
        },
    }


# ==============================================================================
# MODULE 2: CUSTOMER PROFILE
# ==============================================================================
def get_customer_profile_report(year=None, segment=None):
    currency = get_currency_config()
    mult = currency["currency_multiplier"]
    year_int = int(year) if year else None
    seg_clean = (segment or "").strip()

    base_clauses = ["1=1"]
    base_params = []
    if year_int:
        base_clauses.append("YEAR(soh.OrderDate) = %s")
        base_params.append(year_int)

    vip_clauses = list(base_clauses)
    vip_params = list(base_params)
    if seg_clean == "Store":
        vip_clauses.append("c.StoreID IS NOT NULL")
    elif seg_clean == "Individual":
        vip_clauses.append("c.StoreID IS NULL")

    base_where = " AND ".join(base_clauses)
    vip_where = " AND ".join(vip_clauses)

    with connections["adventureworks"].cursor() as cursor:
        cursor.execute(
            f"""
            SELECT
                CASE
                    WHEN c.StoreID IS NOT NULL THEN 'B2B Reseller / Store'
                    ELSE 'B2C Individual Consumer'
                END AS customer_segment,
                COUNT(DISTINCT c.CustomerID) AS customer_count,
                COUNT(DISTINCT soh.SalesOrderID) AS total_orders,
                COALESCE(SUM(soh.SubTotal), 0) AS total_spend,
                COALESCE(AVG(soh.SubTotal), 0) AS avg_order_value
            FROM Sales.Customer c
            INNER JOIN Sales.SalesOrderHeader soh ON c.CustomerID = soh.CustomerID
            WHERE {base_where}
            GROUP BY CASE WHEN c.StoreID IS NOT NULL THEN 'B2B Reseller / Store' ELSE 'B2C Individual Consumer' END;
            """,
            base_params,
        )
        segments = _scale_money(
            _dictfetchall(cursor), ["total_spend", "avg_order_value"], mult
        )

        cursor.execute(
            f"""
            SELECT TOP 15
                c.CustomerID,
                c.AccountNumber,
                COALESCE(
                    s.Name,
                    NULLIF(LTRIM(RTRIM(COALESCE(p.FirstName, '') + ' ' + COALESCE(p.LastName, ''))), ''),
                    'Unknown Customer'
                ) AS customer_name,
                CASE WHEN c.StoreID IS NOT NULL THEN 'Store' ELSE 'Individual' END AS segment,
                COUNT(soh.SalesOrderID) AS order_frequency,
                SUM(soh.SubTotal) AS total_spend,
                AVG(soh.SubTotal) AS avg_order_value,
                CONVERT(VARCHAR(10), MAX(soh.OrderDate), 23) AS last_order_date
            FROM Sales.Customer c
            INNER JOIN Sales.SalesOrderHeader soh ON c.CustomerID = soh.CustomerID
            LEFT JOIN Sales.Store s ON c.StoreID = s.BusinessEntityID
            LEFT JOIN Person.Person p ON c.PersonID = p.BusinessEntityID
            WHERE {vip_where}
            GROUP BY c.CustomerID, c.AccountNumber, s.Name, p.FirstName, p.LastName, c.StoreID
            ORDER BY total_spend DESC;
            """,
            vip_params,
        )
        high_value_customers = _scale_money(
            _dictfetchall(cursor), ["total_spend", "avg_order_value"], mult
        )

        cursor.execute(
            f"""
            SELECT
                t.frequency_tier,
                COUNT(t.CustomerID) AS customer_count
            FROM (
                SELECT
                    soh.CustomerID,
                    CASE
                        WHEN COUNT(soh.SalesOrderID) = 1 THEN '1 Order (One-Time)'
                        WHEN COUNT(soh.SalesOrderID) BETWEEN 2 AND 4 THEN '2-4 Orders (Repeat)'
                        WHEN COUNT(soh.SalesOrderID) BETWEEN 5 AND 9 THEN '5-9 Orders (Loyal)'
                        ELSE '10+ Orders (VIP)'
                    END AS frequency_tier
                FROM Sales.SalesOrderHeader soh
                INNER JOIN Sales.Customer c ON soh.CustomerID = c.CustomerID
                WHERE {vip_where}
                GROUP BY soh.CustomerID
            ) t
            GROUP BY t.frequency_tier
            ORDER BY customer_count DESC;
            """,
            vip_params,
        )
        frequency_distribution = _dictfetchall(cursor)

    # Descriptive labels for each high-value account
    for idx, c in enumerate(high_value_customers):
        orders = int(c.get("order_frequency") or 0)
        if orders >= 10:
            c["loyalty_label"] = "VIP"
        elif orders >= 5:
            c["loyalty_label"] = "Loyal"
        elif orders >= 2:
            c["loyalty_label"] = "Repeat"
        else:
            c["loyalty_label"] = "One-Time"
        c["value_label"] = "Platinum" if idx < 3 else ("Gold" if idx < 8 else "Silver")
        c["segment_label"] = "B2B Store" if c.get("segment") == "Store" else "B2C Individual"

    return {
        "module": "Customer Profile",
        "currency": currency,
        "segments": segments,
        "high_value_customers": high_value_customers,
        "frequency_distribution": frequency_distribution,
        "governance": {
            "source_tables": [
                "Sales.Customer",
                "Sales.SalesOrderHeader",
                "Sales.Store",
                "Person.Person",
            ],
            "segmentation_rule": "StoreID NOT NULL => B2B Store; StoreID IS NULL => B2C Individual.",
        },
    }


# ==============================================================================
# MODULE 3: REVENUE AND LOSS REPORT
# ==============================================================================
def get_revenue_and_loss_report(year=None, category_id=None):
    currency = get_currency_config()
    mult = currency["currency_multiplier"]
    where_sql, params = _build_where_clause(year, category_id)

    with connections["adventureworks"].cursor() as cursor:
        cursor.execute(
            f"""
            SELECT
                COALESCE(SUM(sod.UnitPrice * sod.OrderQty), 0) AS gross_revenue_before_discount,
                COALESCE(SUM(sod.UnitPrice * sod.UnitPriceDiscount * sod.OrderQty), 0) AS discount_erosion,
                COALESCE(SUM(sod.LineTotal), 0) AS net_product_revenue,
                COALESCE(SUM(p.StandardCost * sod.OrderQty), 0) AS estimated_cogs,
                COALESCE(SUM(sod.LineTotal - (p.StandardCost * sod.OrderQty)), 0) AS gross_profit
            FROM Sales.SalesOrderDetail sod
            INNER JOIN Sales.SalesOrderHeader soh ON sod.SalesOrderID = soh.SalesOrderID
            INNER JOIN Production.Product p ON sod.ProductID = p.ProductID
            LEFT JOIN Production.ProductSubcategory psc ON p.ProductSubcategoryID = psc.ProductSubcategoryID
            LEFT JOIN Production.ProductCategory pc ON psc.ProductCategoryID = pc.ProductCategoryID
            WHERE {where_sql};
            """,
            params,
        )
        summary = _scale_money(
            _dictfetchall(cursor)[0],
            [
                "gross_revenue_before_discount",
                "discount_erosion",
                "net_product_revenue",
                "estimated_cogs",
                "gross_profit",
            ],
            mult,
        )
        net_rev = summary["net_product_revenue"]
        summary["gross_margin_pct"] = (
            round((summary["gross_profit"] / net_rev) * 100, 2) if net_rev else 0.0
        )

        cursor.execute(
            f"""
            SELECT
                YEAR(soh.OrderDate) AS year,
                MONTH(soh.OrderDate) AS month,
                CAST(YEAR(soh.OrderDate) AS VARCHAR(4)) + '-' + RIGHT('0' + CAST(MONTH(soh.OrderDate) AS VARCHAR(2)), 2) AS period,
                SUM(sod.LineTotal) AS net_revenue,
                SUM(p.StandardCost * sod.OrderQty) AS estimated_cogs,
                SUM(sod.LineTotal - (p.StandardCost * sod.OrderQty)) AS gross_profit
            FROM Sales.SalesOrderDetail sod
            INNER JOIN Sales.SalesOrderHeader soh ON sod.SalesOrderID = soh.SalesOrderID
            INNER JOIN Production.Product p ON sod.ProductID = p.ProductID
            LEFT JOIN Production.ProductSubcategory psc ON p.ProductSubcategoryID = psc.ProductSubcategoryID
            LEFT JOIN Production.ProductCategory pc ON psc.ProductCategoryID = pc.ProductCategoryID
            WHERE {where_sql}
            GROUP BY YEAR(soh.OrderDate), MONTH(soh.OrderDate)
            ORDER BY year ASC, month ASC;
            """,
            params,
        )
        trends = _scale_money(
            _dictfetchall(cursor), ["net_revenue", "estimated_cogs", "gross_profit"], mult
        )

        cursor.execute(
            f"""
            SELECT TOP 15
                p.ProductID,
                p.Name AS product_name,
                COALESCE(pc.Name, 'Uncategorized') AS category_name,
                SUM(sod.OrderQty) AS units_sold,
                SUM(sod.LineTotal) AS net_revenue,
                SUM(p.StandardCost * sod.OrderQty) AS standard_cogs,
                SUM(sod.LineTotal - (p.StandardCost * sod.OrderQty)) AS net_margin_variance
            FROM Sales.SalesOrderDetail sod
            INNER JOIN Sales.SalesOrderHeader soh ON sod.SalesOrderID = soh.SalesOrderID
            INNER JOIN Production.Product p ON sod.ProductID = p.ProductID
            LEFT JOIN Production.ProductSubcategory psc ON p.ProductSubcategoryID = psc.ProductSubcategoryID
            LEFT JOIN Production.ProductCategory pc ON psc.ProductCategoryID = pc.ProductCategoryID
            WHERE {where_sql}
            GROUP BY p.ProductID, p.Name, pc.Name
            HAVING SUM(sod.LineTotal - (p.StandardCost * sod.OrderQty)) < 0
            ORDER BY net_margin_variance ASC;
            """,
            params,
        )
        negative_margin_products = _scale_money(
            _dictfetchall(cursor),
            ["net_revenue", "standard_cogs", "net_margin_variance"],
            mult,
        )

    return {
        "module": "Revenue and Loss Report",
        "currency": currency,
        "financial_summary": summary,
        "revenue_trends": trends,
        "negative_margin_products": negative_margin_products,
        "governance": {
            "source_tables": [
                "Sales.SalesOrderDetail",
                "Sales.SalesOrderHeader",
                "Production.Product",
            ],
            "calculations": {
                "net_product_revenue": "SUM(SalesOrderDetail.LineTotal)",
                "estimated_cogs": "SUM(Product.StandardCost * SalesOrderDetail.OrderQty)",
                "gross_profit": "net_product_revenue - estimated_cogs",
            },
            "documented_limitation": (
                "AdventureWorks does not store general ledger operating expenses (OpEx), "
                "payroll overhead, or marketing expenses. Therefore, Net Income / Net Operating Loss "
                "cannot be calculated without fabricating data. This report measures Gross Margin "
                "and Discount-Driven Gross Margin Losses using recorded LineTotal vs. StandardCost."
            ),
        },
    }


# ==============================================================================
# MODULE 4: COST REPORT
# ==============================================================================
def get_cost_report(year=None, category_id=None):
    currency = get_currency_config()
    mult = currency["currency_multiplier"]
    where_sql, params = _build_where_clause(year, category_id)
    po_where = "YEAR(poh.OrderDate) = %s" if year else "1=1"
    po_params = [int(year)] if year else []

    with connections["adventureworks"].cursor() as cursor:
        cursor.execute(
            f"""
            SELECT
                COALESCE(SUM(p.StandardCost * sod.OrderQty), 0) AS total_standard_cogs,
                COALESCE(SUM(soh.Freight), 0) AS outbound_freight_cost,
                COALESCE(SUM(soh.TaxAmt), 0) AS tax_amount
            FROM Sales.SalesOrderDetail sod
            INNER JOIN Sales.SalesOrderHeader soh ON sod.SalesOrderID = soh.SalesOrderID
            INNER JOIN Production.Product p ON sod.ProductID = p.ProductID
            LEFT JOIN Production.ProductSubcategory psc ON p.ProductSubcategoryID = psc.ProductSubcategoryID
            LEFT JOIN Production.ProductCategory pc ON psc.ProductCategoryID = pc.ProductCategoryID
            WHERE {where_sql};
            """,
            params,
        )
        sales_side_costs = _scale_money(
            _dictfetchall(cursor)[0],
            ["total_standard_cogs", "outbound_freight_cost", "tax_amount"],
            mult,
        )

        cursor.execute(
            f"""
            SELECT
                COUNT(DISTINCT poh.PurchaseOrderID) AS total_purchase_orders,
                COALESCE(SUM(poh.SubTotal), 0) AS procurement_subtotal,
                COALESCE(SUM(poh.Freight), 0) AS inbound_freight,
                COALESCE(SUM(poh.TotalDue), 0) AS total_procurement_spend
            FROM Purchasing.PurchaseOrderHeader poh
            WHERE {po_where};
            """,
            po_params,
        )
        procurement_costs = _scale_money(
            _dictfetchall(cursor)[0],
            ["procurement_subtotal", "inbound_freight", "total_procurement_spend"],
            mult,
        )

        cursor.execute(
            f"""
            SELECT
                COALESCE(pc.Name, 'Uncategorized') AS category_name,
                SUM(p.StandardCost * sod.OrderQty) AS total_cogs,
                SUM(sod.LineTotal) AS total_revenue,
                CASE
                    WHEN SUM(sod.LineTotal) > 0
                    THEN ROUND((SUM(p.StandardCost * sod.OrderQty) / SUM(sod.LineTotal)) * 100, 2)
                    ELSE 0
                END AS cost_to_revenue_ratio_pct
            FROM Sales.SalesOrderDetail sod
            INNER JOIN Sales.SalesOrderHeader soh ON sod.SalesOrderID = soh.SalesOrderID
            INNER JOIN Production.Product p ON sod.ProductID = p.ProductID
            LEFT JOIN Production.ProductSubcategory psc ON p.ProductSubcategoryID = psc.ProductSubcategoryID
            LEFT JOIN Production.ProductCategory pc ON psc.ProductCategoryID = pc.ProductCategoryID
            WHERE {where_sql}
            GROUP BY COALESCE(pc.Name, 'Uncategorized')
            ORDER BY total_cogs DESC;
            """,
            params,
        )
        cost_by_category = _scale_money(
            _dictfetchall(cursor), ["total_cogs", "total_revenue"], mult
        )

        cursor.execute(
            f"""
            SELECT TOP 10
                p.ProductID,
                p.Name AS product_name,
                p.StandardCost AS unit_standard_cost,
                SUM(sod.OrderQty) AS units_sold,
                SUM(p.StandardCost * sod.OrderQty) AS cumulative_cogs
            FROM Sales.SalesOrderDetail sod
            INNER JOIN Sales.SalesOrderHeader soh ON sod.SalesOrderID = soh.SalesOrderID
            INNER JOIN Production.Product p ON sod.ProductID = p.ProductID
            LEFT JOIN Production.ProductSubcategory psc ON p.ProductSubcategoryID = psc.ProductSubcategoryID
            LEFT JOIN Production.ProductCategory pc ON psc.ProductCategoryID = pc.ProductCategoryID
            WHERE {where_sql}
            GROUP BY p.ProductID, p.Name, p.StandardCost
            ORDER BY cumulative_cogs DESC;
            """,
            params,
        )
        top_cost_products = _scale_money(
            _dictfetchall(cursor), ["unit_standard_cost", "cumulative_cogs"], mult
        )

    return {
        "module": "Cost Report",
        "currency": currency,
        "sales_side_costs": sales_side_costs,
        "procurement_costs": procurement_costs,
        "cost_by_category": cost_by_category,
        "top_cost_products": top_cost_products,
        "governance": {
            "source_tables": [
                "Production.Product",
                "Sales.SalesOrderHeader",
                "Sales.SalesOrderDetail",
                "Purchasing.PurchaseOrderHeader",
            ],
            "documented_limitation": (
                "Products with StandardCost = 0.00 (such as non-manufactured or accessory items) "
                "are excluded from cost inflation and documented as uncosted catalog items."
            ),
        },
    }

# ==============================================================================
# COMPARATIVE ANALYTICS (YEAR / QUARTER / MONTH x DOMAIN)
# ==============================================================================
GRANULARITIES = ("year", "quarter", "month")
MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

# Each comparison domain maps to a SQL label expression plus the extra joins it needs.
SALES_DIMENSIONS = {
    "total": {"label": "All Sales", "expr": "'All Sales'", "joins": ""},
    "category": {
        "label": "Product Category",
        "expr": "COALESCE(pc.Name, 'Uncategorized')",
        "joins": "",
    },
    "subcategory": {
        "label": "Product Subcategory",
        "expr": "COALESCE(psc.Name, 'Uncategorized')",
        "joins": "",
    },
    "territory": {
        "label": "Sales Territory",
        "expr": "COALESCE(st.Name, 'Unassigned')",
        "joins": "LEFT JOIN Sales.SalesTerritory st ON soh.TerritoryID = st.TerritoryID",
    },
    "region": {
        "label": "Region",
        "expr": "COALESCE(st.[Group], 'Unassigned')",
        "joins": "LEFT JOIN Sales.SalesTerritory st ON soh.TerritoryID = st.TerritoryID",
    },
    "staff": {
        "label": "Sales Staff",
        "expr": "COALESCE(LTRIM(RTRIM(sper.FirstName + ' ' + sper.LastName)), 'Online (No Rep)')",
        "joins": "LEFT JOIN Person.Person sper ON soh.SalesPersonID = sper.BusinessEntityID",
    },
    "channel": {
        "label": "Sales Channel",
        "expr": "CASE WHEN soh.OnlineOrderFlag = 1 THEN 'Online (B2C)' ELSE 'Reseller (B2B)' END",
        "joins": "",
    },
}

MAX_SERIES = 8


def _clean_granularity(granularity):
    g = (granularity or "month").lower()
    return g if g in GRANULARITIES else "month"


def _period_select(granularity, alias="soh"):
    """Returns (select_sql, group_sql) for the period columns of the chosen granularity."""
    year = f"YEAR({alias}.OrderDate)"
    if granularity == "year":
        return f"{year} AS yr, 0 AS qtr, 0 AS mon", year
    if granularity == "quarter":
        q = f"DATEPART(QUARTER, {alias}.OrderDate)"
        return f"{year} AS yr, {q} AS qtr, 0 AS mon", f"{year}, {q}"
    m = f"MONTH({alias}.OrderDate)"
    return f"{year} AS yr, 0 AS qtr, {m} AS mon", f"{year}, {m}"


def _period_key(granularity, row):
    y, q, m = int(row["yr"]), int(row["qtr"] or 0), int(row["mon"] or 0)
    if granularity == "year":
        return (y, 0), str(y), "FY"
    if granularity == "quarter":
        return (y, q), f"{y}-Q{q}", f"Q{q}"
    return (y, m), f"{y}-{m:02d}", MONTH_LABELS[m - 1]


def _pct_change(current, previous):
    if previous in (None, 0):
        return None
    return round(((current - previous) / abs(previous)) * 100, 2)


def _monthly_values(cursor, where_sql, params, value_sql, mult=None):
    """{(year, month): value} used for like-for-like comparisons of partial years."""
    cursor.execute(
        f"""
        SELECT YEAR(soh.OrderDate) AS yr, MONTH(soh.OrderDate) AS mon, {value_sql} AS val
        FROM Sales.SalesOrderDetail sod
        INNER JOIN Sales.SalesOrderHeader soh ON sod.SalesOrderID = soh.SalesOrderID
        LEFT JOIN Production.Product p ON sod.ProductID = p.ProductID
        LEFT JOIN Production.ProductSubcategory psc ON p.ProductSubcategoryID = psc.ProductSubcategoryID
        LEFT JOIN Production.ProductCategory pc ON psc.ProductCategoryID = pc.ProductCategoryID
        WHERE {where_sql}
        GROUP BY YEAR(soh.OrderDate), MONTH(soh.OrderDate);
        """,
        params,
    )
    out = {}
    for yr, mon, val in cursor.fetchall():
        v = float(val or 0)
        out[(int(yr), int(mon))] = v * mult if mult else v
    return out


def _like_for_like(monthly):
    """
    For each year: number of months with data, and growth vs the SAME months of the prior year.
    AdventureWorks 2011 starts in May and 2014 ends in June, so raw yearly growth is misleading.
    """
    years = sorted({y for y, _ in monthly})
    result = {}
    for y in years:
        months = sorted(m for yy, m in monthly if yy == y)
        curr = sum(monthly[(y, m)] for m in months)
        prior_months = [m for m in months if (y - 1, m) in monthly]
        prior = sum(monthly[(y - 1, m)] for m in prior_months)
        result[y] = {
            "months": len(months),
            "partial": len(months) < 12,
            "lfl_pct": _pct_change(curr, prior) if prior_months else None,
            "lfl_label": (
                f"{MONTH_LABELS[months[0] - 1]}–{MONTH_LABELS[months[-1] - 1]} vs same months {y - 1}"
                if prior_months else None
            ),
        }
    return result


def _period_table(granularity, period_keys, period_labels, totals):
    """Builds a per-period aggregate table with period-over-period and year-over-year growth."""
    lookup = dict(zip(period_keys, totals))
    rows = []
    prev_val = None
    for key, label, val in zip(period_keys, period_labels, totals):
        same_last_year = lookup.get((key[0] - 1, key[1])) if granularity != "year" else None
        rows.append(
            {
                "period": label,
                "value": round(val, 2),
                "change": round(val - prev_val, 2) if prev_val is not None else None,
                "change_pct": _pct_change(val, prev_val) if prev_val is not None else None,
                "yoy_pct": _pct_change(val, same_last_year) if same_last_year is not None else None,
            }
        )
        prev_val = val
    return rows


def _yoy_overlay(granularity, period_keys, totals):
    """Year-on-year overlay: x = Q1..Q4 or Jan..Dec, one series per year."""
    if granularity == "year":
        return None
    slots = 4 if granularity == "quarter" else 12
    labels = [f"Q{i}" for i in range(1, 5)] if granularity == "quarter" else MONTH_LABELS
    years = sorted({k[0] for k in period_keys})
    lookup = dict(zip(period_keys, totals))
    series = [
        {
            "year": y,
            "data": [
                round(lookup[(y, s)], 2) if (y, s) in lookup else None
                for s in range(1, slots + 1)
            ],
        }
        for y in years
    ]
    return {"labels": labels, "series": series}


def get_sales_comparison(
    granularity="month",
    dimension="total",
    metric="sales_amount",
    year=None,
    category_id=None,
    staff_ids=None,
):
    """
    Aggregates sales by period (year / quarter / month) and compares a chosen domain
    (category, subcategory, territory, region, staff, channel) across those periods.
    """
    currency = get_currency_config()
    mult = currency["currency_multiplier"]
    granularity = _clean_granularity(granularity)
    dim_key = dimension if dimension in SALES_DIMENSIONS else "total"
    dim = SALES_DIMENSIONS[dim_key]
    metric = metric if metric in ("sales_amount", "total_orders", "units_sold") else "sales_amount"

    # A yearly comparison always spans every year so there is something to compare.
    effective_year = None if granularity == "year" else year
    where_sql, params = _build_where_clause(effective_year, category_id, staff_ids)
    period_sql, period_group = _period_select(granularity)

    with connections["adventureworks"].cursor() as cursor:
        cursor.execute(
            f"""
            SELECT
                {period_sql},
                {dim['expr']} AS member,
                COUNT(DISTINCT soh.SalesOrderID) AS total_orders,
                SUM(sod.OrderQty) AS units_sold,
                SUM(sod.LineTotal) AS sales_amount
            FROM Sales.SalesOrderDetail sod
            INNER JOIN Sales.SalesOrderHeader soh ON sod.SalesOrderID = soh.SalesOrderID
            LEFT JOIN Production.Product p ON sod.ProductID = p.ProductID
            LEFT JOIN Production.ProductSubcategory psc ON p.ProductSubcategoryID = psc.ProductSubcategoryID
            LEFT JOIN Production.ProductCategory pc ON psc.ProductCategoryID = pc.ProductCategoryID
            {dim['joins']}
            WHERE {where_sql}
            GROUP BY {period_group}, {dim['expr']};
            """,
            params,
        )
        rows = _scale_money(_dictfetchall(cursor), ["sales_amount"], mult)

        # Period totals are queried separately because DISTINCT order counts do not add up across members.
        cursor.execute(
            f"""
            SELECT
                {period_sql},
                COUNT(DISTINCT soh.SalesOrderID) AS total_orders,
                SUM(sod.OrderQty) AS units_sold,
                SUM(sod.LineTotal) AS sales_amount
            FROM Sales.SalesOrderDetail sod
            INNER JOIN Sales.SalesOrderHeader soh ON sod.SalesOrderID = soh.SalesOrderID
            LEFT JOIN Production.Product p ON sod.ProductID = p.ProductID
            LEFT JOIN Production.ProductSubcategory psc ON p.ProductSubcategoryID = psc.ProductSubcategoryID
            LEFT JOIN Production.ProductCategory pc ON psc.ProductCategoryID = pc.ProductCategoryID
            WHERE {where_sql}
            GROUP BY {period_group};
            """,
            params,
        )
        total_rows = _scale_money(_dictfetchall(cursor), ["sales_amount"], mult)

        lfl = None
        if granularity == "year":
            value_sql = {
                "sales_amount": "SUM(sod.LineTotal)",
                "total_orders": "COUNT(DISTINCT soh.SalesOrderID)",
                "units_sold": "SUM(sod.OrderQty)",
            }[metric]
            lfl = _like_for_like(_monthly_values(cursor, where_sql, params, value_sql))

    # Ordered period axis
    period_info = {}
    for r in total_rows:
        key, label, slot = _period_key(granularity, r)
        period_info[key] = label
    period_keys = sorted(period_info)
    period_labels = [period_info[k] for k in period_keys]
    totals_by_key = {_period_key(granularity, r)[0]: float(r[metric] or 0) for r in total_rows}
    totals = [totals_by_key.get(k, 0.0) for k in period_keys]

    # Member series: keep the biggest members, fold the rest into "Other"
    member_totals = {}
    cell = {}
    for r in rows:
        key = _period_key(granularity, r)[0]
        val = float(r[metric] or 0)
        member_totals[r["member"]] = member_totals.get(r["member"], 0.0) + val
        cell[(r["member"], key)] = cell.get((r["member"], key), 0.0) + val
    ranked = sorted(member_totals, key=lambda m: member_totals[m], reverse=True)
    kept = ranked[:MAX_SERIES]
    folded = ranked[MAX_SERIES:]

    series = []
    for m in kept:
        series.append(
            {"name": m, "data": [round(cell.get((m, k), 0.0), 2) for k in period_keys]}
        )
    if folded:
        series.append(
            {
                "name": f"Other ({len(folded)})",
                "data": [
                    round(sum(cell.get((m, k), 0.0) for m in folded), 2) for k in period_keys
                ],
            }
        )

    grand_total = sum(member_totals.values()) or 0.0
    members = []
    for s in series:
        data = s["data"]
        last = data[-1] if data else 0.0
        prev = data[-2] if len(data) > 1 else None
        nonzero = [(v, lbl) for v, lbl in zip(data, period_labels)]
        best = max(nonzero, key=lambda x: x[0]) if nonzero else (0, "—")
        total = sum(data)
        members.append(
            {
                "name": s["name"],
                "total": round(total, 2),
                "share_pct": round((total / grand_total) * 100, 2) if grand_total else 0.0,
                "latest_value": round(last, 2),
                "previous_value": round(prev, 2) if prev is not None else None,
                "growth_pct": _pct_change(last, prev) if prev is not None else None,
                "best_period": best[1],
                "best_value": round(best[0], 2),
            }
        )

    period_table = _period_table(granularity, period_keys, period_labels, totals)
    if lfl:
        for row, key in zip(period_table, period_keys):
            info = lfl.get(key[0], {})
            row.update({k: info.get(k) for k in ("months", "partial", "lfl_pct", "lfl_label")})

    return {
        "module": "Sales Comparison",
        "currency": currency,
        "granularity": granularity,
        "dimension": dim_key,
        "dimension_label": dim["label"],
        "metric": metric,
        "is_money": metric == "sales_amount",
        "year_filter_applied": effective_year is not None,
        "periods": period_labels,
        "series": series,
        "totals": [round(t, 2) for t in totals],
        "period_table": period_table,
        "member_table": members,
        "yoy_overlay": _yoy_overlay(granularity, period_keys, totals),
        "dimensions": {k: v["label"] for k, v in SALES_DIMENSIONS.items()},
    }


def get_revenue_comparison(granularity="year", year=None, category_id=None):
    """
    Comparative revenue & loss: net revenue, COGS, gross profit, discount erosion and margin
    per period with period-over-period / year-over-year change, plus category profitability by year.
    """
    currency = get_currency_config()
    mult = currency["currency_multiplier"]
    granularity = _clean_granularity(granularity)
    effective_year = None if granularity == "year" else year
    where_sql, params = _build_where_clause(effective_year, category_id)
    period_sql, period_group = _period_select(granularity)
    money = ["gross_revenue", "discount_erosion", "net_revenue", "cogs", "gross_profit"]

    with connections["adventureworks"].cursor() as cursor:
        cursor.execute(
            f"""
            SELECT
                {period_sql},
                SUM(sod.UnitPrice * sod.OrderQty) AS gross_revenue,
                SUM(sod.UnitPrice * sod.UnitPriceDiscount * sod.OrderQty) AS discount_erosion,
                SUM(sod.LineTotal) AS net_revenue,
                SUM(p.StandardCost * sod.OrderQty) AS cogs,
                SUM(sod.LineTotal - (p.StandardCost * sod.OrderQty)) AS gross_profit
            FROM Sales.SalesOrderDetail sod
            INNER JOIN Sales.SalesOrderHeader soh ON sod.SalesOrderID = soh.SalesOrderID
            INNER JOIN Production.Product p ON sod.ProductID = p.ProductID
            LEFT JOIN Production.ProductSubcategory psc ON p.ProductSubcategoryID = psc.ProductSubcategoryID
            LEFT JOIN Production.ProductCategory pc ON psc.ProductCategoryID = pc.ProductCategoryID
            WHERE {where_sql}
            GROUP BY {period_group};
            """,
            params,
        )
        period_rows = _scale_money(_dictfetchall(cursor), money, mult)

        # Category profitability across years (respects category filter, ignores year so years can be compared)
        cat_where, cat_params = _build_where_clause(None, category_id)
        cursor.execute(
            f"""
            SELECT
                YEAR(soh.OrderDate) AS yr,
                COALESCE(pc.Name, 'Uncategorized') AS category_name,
                SUM(sod.LineTotal) AS net_revenue,
                SUM(p.StandardCost * sod.OrderQty) AS cogs,
                SUM(sod.LineTotal - (p.StandardCost * sod.OrderQty)) AS gross_profit
            FROM Sales.SalesOrderDetail sod
            INNER JOIN Sales.SalesOrderHeader soh ON sod.SalesOrderID = soh.SalesOrderID
            INNER JOIN Production.Product p ON sod.ProductID = p.ProductID
            LEFT JOIN Production.ProductSubcategory psc ON p.ProductSubcategoryID = psc.ProductSubcategoryID
            LEFT JOIN Production.ProductCategory pc ON psc.ProductCategoryID = pc.ProductCategoryID
            WHERE {cat_where}
            GROUP BY YEAR(soh.OrderDate), COALESCE(pc.Name, 'Uncategorized');
            """,
            cat_params,
        )
        cat_rows = _scale_money(_dictfetchall(cursor), ["net_revenue", "cogs", "gross_profit"], mult)

        lfl_rev = lfl_gp = None
        if granularity == "year":
            lfl_rev = _like_for_like(_monthly_values(cursor, where_sql, params, "SUM(sod.LineTotal)"))
            lfl_gp = _like_for_like(
                _monthly_values(cursor, where_sql, params, "SUM(sod.LineTotal - (p.StandardCost * sod.OrderQty))")
            )
        all_months = _like_for_like(
            _monthly_values(cursor, cat_where, cat_params, "COUNT(DISTINCT soh.SalesOrderID)")
        )

    by_key = {}
    labels = {}
    for r in period_rows:
        key, label, _ = _period_key(granularity, r)
        by_key[key] = r
        labels[key] = label
    keys = sorted(by_key)

    table = []
    prev = None
    for k in keys:
        r = by_key[k]
        net = float(r["net_revenue"] or 0)
        gp = float(r["gross_profit"] or 0)
        gross = float(r["gross_revenue"] or 0)
        disc = float(r["discount_erosion"] or 0)
        ly = by_key.get((k[0] - 1, k[1])) if granularity != "year" else None
        entry = {
            "period": labels[k],
            "gross_revenue": round(gross, 2),
            "discount_erosion": round(disc, 2),
            "discount_rate_pct": round((disc / gross) * 100, 2) if gross else 0.0,
            "net_revenue": round(net, 2),
            "cogs": round(float(r["cogs"] or 0), 2),
            "gross_profit": round(gp, 2),
            "margin_pct": round((gp / net) * 100, 2) if net else 0.0,
            "revenue_change_pct": _pct_change(net, float(prev["net_revenue"] or 0)) if prev else None,
            "profit_change_pct": _pct_change(gp, float(prev["gross_profit"] or 0)) if prev else None,
            "revenue_yoy_pct": _pct_change(net, float(ly["net_revenue"] or 0)) if ly else None,
            "profit_yoy_pct": _pct_change(gp, float(ly["gross_profit"] or 0)) if ly else None,
        }
        if lfl_rev:
            info = lfl_rev.get(k[0], {})
            entry.update(
                {
                    "months": info.get("months"),
                    "partial": info.get("partial"),
                    "revenue_lfl_pct": info.get("lfl_pct"),
                    "profit_lfl_pct": lfl_gp.get(k[0], {}).get("lfl_pct"),
                    "lfl_label": info.get("lfl_label"),
                }
            )
        table.append(entry)
        prev = r

    years = sorted({int(r["yr"]) for r in cat_rows})
    categories = sorted({r["category_name"] for r in cat_rows})
    cat_lookup = {(r["category_name"], int(r["yr"])): r for r in cat_rows}
    category_by_year = []
    for c in categories:
        cells = []
        for y in years:
            r = cat_lookup.get((c, y))
            net = float(r["net_revenue"] or 0) if r else 0.0
            gp = float(r["gross_profit"] or 0) if r else 0.0
            cells.append(
                {
                    "year": y,
                    "net_revenue": round(net, 2),
                    "gross_profit": round(gp, 2),
                    "margin_pct": round((gp / net) * 100, 2) if net else None,
                }
            )
        category_by_year.append({"category_name": c, "years": cells})

    net_totals = [float(by_key[k]["net_revenue"] or 0) for k in keys]
    return {
        "module": "Revenue Comparison",
        "currency": currency,
        "granularity": granularity,
        "year_filter_applied": effective_year is not None,
        "period_table": table,
        "yoy_overlay": _yoy_overlay(granularity, keys, net_totals),
        "category_years": years,
        "partial_years": [y for y in years if all_months.get(y, {}).get("partial")],
        "category_by_year": category_by_year,
    }


def get_prior_year_kpis(year, category_id=None):
    """KPIs for year-1 so the dashboards can show year-over-year deltas."""
    if not year:
        return None
    prior = int(year) - 1
    currency = get_currency_config()
    mult = currency["currency_multiplier"]
    where_sql, params = _build_where_clause(prior, category_id)
    with connections["adventureworks"].cursor() as cursor:
        # Like-for-like: if the selected year is partial, compare only the same months of the prior year.
        cursor.execute(
            "SELECT DISTINCT MONTH(OrderDate) FROM Sales.SalesOrderHeader WHERE YEAR(OrderDate) = %s;",
            [int(year)],
        )
        months = sorted(int(r[0]) for r in cursor.fetchall())
        like_for_like = 0 < len(months) < 12
        if like_for_like:
            where_sql += f" AND MONTH(soh.OrderDate) IN ({', '.join(['%s'] * len(months))})"
            params = params + months
        cursor.execute(
            f"""
            SELECT
                COUNT(DISTINCT soh.SalesOrderID) AS total_orders,
                COUNT(DISTINCT soh.CustomerID) AS customers,
                COALESCE(SUM(sod.OrderQty), 0) AS total_units_sold,
                COALESCE(SUM(sod.LineTotal), 0) AS total_sales_amount,
                COALESCE(SUM(sod.UnitPrice * sod.OrderQty), 0) AS gross_revenue_before_discount,
                COALESCE(SUM(sod.UnitPrice * sod.UnitPriceDiscount * sod.OrderQty), 0) AS discount_erosion,
                COALESCE(SUM(sod.LineTotal - (p.StandardCost * sod.OrderQty)), 0) AS gross_profit
            FROM Sales.SalesOrderDetail sod
            INNER JOIN Sales.SalesOrderHeader soh ON sod.SalesOrderID = soh.SalesOrderID
            INNER JOIN Production.Product p ON sod.ProductID = p.ProductID
            LEFT JOIN Production.ProductSubcategory psc ON p.ProductSubcategoryID = psc.ProductSubcategoryID
            LEFT JOIN Production.ProductCategory pc ON psc.ProductCategoryID = pc.ProductCategoryID
            WHERE {where_sql};
            """,
            params,
        )
        row = _scale_money(
            _dictfetchall(cursor)[0],
            ["total_sales_amount", "gross_revenue_before_discount", "discount_erosion", "gross_profit"],
            mult,
        )
    if not row.get("total_orders"):
        return None
    net = row["total_sales_amount"]
    row["gross_margin_pct"] = round((row["gross_profit"] / net) * 100, 2) if net else 0.0
    row["avg_order_value"] = round(net / row["total_orders"], 2) if row["total_orders"] else 0.0
    row["year"] = prior
    row["like_for_like"] = like_for_like
    row["months"] = months
    row["comparison_label"] = (
        f"vs {MONTH_LABELS[months[0] - 1]}–{MONTH_LABELS[months[-1] - 1]} {prior}" if like_for_like else f"vs {prior}"
    )
    return row


def get_yearly_overview(category_id=None):
    """Executive year-by-year snapshot: revenue, gross profit, orders, customers, margin."""
    currency = get_currency_config()
    mult = currency["currency_multiplier"]
    where_sql, params = _build_where_clause(None, category_id)
    with connections["adventureworks"].cursor() as cursor:
        cursor.execute(
            f"""
            SELECT
                YEAR(soh.OrderDate) AS year,
                COUNT(DISTINCT soh.SalesOrderID) AS total_orders,
                COUNT(DISTINCT soh.CustomerID) AS customers,
                COUNT(DISTINCT MONTH(soh.OrderDate)) AS active_months,
                SUM(sod.LineTotal) AS net_revenue,
                SUM(sod.LineTotal - (p.StandardCost * sod.OrderQty)) AS gross_profit
            FROM Sales.SalesOrderDetail sod
            INNER JOIN Sales.SalesOrderHeader soh ON sod.SalesOrderID = soh.SalesOrderID
            INNER JOIN Production.Product p ON sod.ProductID = p.ProductID
            LEFT JOIN Production.ProductSubcategory psc ON p.ProductSubcategoryID = psc.ProductSubcategoryID
            LEFT JOIN Production.ProductCategory pc ON psc.ProductCategoryID = pc.ProductCategoryID
            WHERE {where_sql}
            GROUP BY YEAR(soh.OrderDate)
            ORDER BY year ASC;
            """,
            params,
        )
        rows = _scale_money(_dictfetchall(cursor), ["net_revenue", "gross_profit"], mult)
        lfl = _like_for_like(_monthly_values(cursor, where_sql, params, "SUM(sod.LineTotal)"))
    prev = None
    for r in rows:
        info = lfl.get(int(r["year"]), {})
        r["revenue_lfl_pct"] = info.get("lfl_pct")
        r["lfl_label"] = info.get("lfl_label")
        net = float(r["net_revenue"] or 0)
        r["margin_pct"] = round((float(r["gross_profit"] or 0) / net) * 100, 2) if net else 0.0
        r["revenue_growth_pct"] = _pct_change(net, float(prev["net_revenue"] or 0)) if prev else None
        r["partial_year"] = int(r["active_months"] or 0) < 12
        prev = r
    return rows
