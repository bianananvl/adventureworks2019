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