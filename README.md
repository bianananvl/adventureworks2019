# JBABEWorks — AdventureWorks2019 BI Portal

A full-stack Business Intelligence (BI) web portal built with **Django**, **Microsoft SQL Server (AdventureWorks2019)**, **Bootstrap 5**, and **Chart.js**. Includes Role-Based Access Control (RBAC), Audit Logging, Global Currency Conversion, and Color-Blind-Safe visualization palettes (Protanopia, Deuteranopia, and Tritanopia).

---

## Platform Setup Overview

| Component | Windows Setup | macOS (MacBook) Setup |
| :--- | :--- | :--- |
| **Database Engine** | Native SQL Server + SSMS | Docker Desktop (`azure-sql-edge` / SQL Server) |
| **Database Backup** | `AdventureWorks2019.bak` (OLTP) | `AdventureWorks2019.bak` (OLTP) |
| **Authentication** | Windows Authentication (`Trusted_Connection`) | SQL Login (`sa` + Environment Variables in `~/.zshrc`) |
| **ODBC Driver** | ODBC Driver 17 or 18 for SQL Server *(Required)* | Homebrew `msodbcsql17` / `msodbcsql18` *(Required)* |
| **Config Edit Needed** | Update `HOST` in `backend/config/settings.py` | None (`~/.zshrc` overrides `settings.py` automatically) |
| **Recommended IDE** | PyCharm or VS Code | VS Code |

---

## Option A: Windows Setup Guide

### 1. Prerequisites & Database Restore

#### Download & Install Required Software (in order):
1. **Python 3.10+:** Search `"Download Python"` on `python.org`, click **Download Python**, open the downloaded file in **File Explorer > Downloads**, check the box **"Add Python to PATH"** at the bottom of the window, and click **Install Now**.
2. **Git for Windows *(Optional)*:** Search `"Download Git for Windows"` and install with default settings. *(Required if you want to pull/push updates in PyCharm or Terminal; optional if you only download a one-time ZIP from GitHub.)*
3. **Microsoft SQL Server:** Search `"SQL Server Downloads"` on Microsoft, scroll down to **Developer** or **Express**, click **Download now**, run the installer from **File Explorer > Downloads**, and choose **Basic** installation.
4. **SQL Server Management Studio (SSMS):** Click **Install SSMS** at the end of the SQL Server installer (or search `"Download SSMS"` on Microsoft Learn) and run the installer.
5. **ODBC Driver 17 for SQL Server *(Required)*:** Search `"Download ODBC Driver 17 for SQL Server"` on Microsoft Learn, download the `x64` installer, and double-click it in **File Explorer > Downloads** to install.
   > **Why this is required:** ODBC Driver 17 for SQL Server is needed because this project uses the standard `pyodbc` setup—it is the required bridge that lets your Python/Django app talk to Microsoft SQL Server. Without it, Django will crash with a `Data source name not found` or `IM002` driver error as soon as you run `python manage.py runserver`.

#### Download & Restore `AdventureWorks2019.bak`:
1. Search `"AdventureWorks sample databases Microsoft Learn"`, scroll down to the **OLTP** download table, and click `AdventureWorks2019.bak`.
2. Open **File Explorer** (yellow folder icon on your taskbar) > click **Downloads** on the left sidebar > right-click `AdventureWorks2019.bak` > click **Copy**.
3. In File Explorer, navigate to:
   ```text
   This PC > Local Disk (C:) > Program Files > Microsoft SQL Server > MSSQL16.MSSQLSERVER > MSSQL > Backup
   ```
   Right-click empty space and click **Paste**. *(If your folder says `MSSQL15` or `SQLEXPRESS`, open that folder instead.)*
4. Open **SSMS** from the Windows Start Menu and click **Connect**.
5. Write down your **Server Name** shown on the very top line of the left sidebar (**Object Explorer**), for example: `DESKTOP-ABC1234` or `DESKTOP-ABC1234\SQLEXPRESS`.
6. In SSMS, right-click **Databases** > click **Restore Database...** > select **Device** > click the **`...`** button > click **Add** > select `AdventureWorks2019.bak` > click **OK** twice.

---

### 2. Download the Project & Install Python Libraries

1. **Get the Project Folder:**
   * **If using Terminal / Git:** Open Command Prompt (press `Windows Key`, type `cmd`, press `Enter`) and run:
     ```bash
     git clone https://github.com/bianananvi/adventureworks2019.git
     ```
   * **If downloading ZIP:** Open our GitHub repository (`github.com/bianananvi/adventureworks2019`), click the green **`<> Code`** button > click **Download ZIP** > open **File Explorer > Downloads** > right-click the ZIP file > click **Extract All...**
2. **Open the Project in PyCharm or VS Code:** Click **File > Open** and select the `adventureworks2019` folder.
3. **Install Django & SQL Server Connectors:** Open the **Terminal** tab at the bottom of PyCharm or VS Code, type these commands, and press `Enter`:
   ```bash
   cd adventureworks2019
   pip install django mssql-django pyodbc
   ```

---

### 3. Configure Your SQL Server Host Name

1. In the left file sidebar of PyCharm or VS Code, expand `backend` > expand `config` > click `settings.py`.
2. Find the `AW_DB_HOST` line inside `DATABASES` and replace the default host string with your own Windows Server Name from Step 1 *(leave `USER` and `PASSWORD` blank so Django uses Windows Authentication)*:
   ```python
   "HOST": os.environ.get("AW_DB_HOST", "YOUR-WINDOWS-SERVER-NAME"),
   ```
3. Press `Ctrl + S` to save `settings.py`.

---

### 4. Initialize, Run & Test

1. In your terminal, move into the `backend` folder, set up the local governance database, and start the server:
   ```bash
   cd backend
   python manage.py migrate
   python manage.py runserver
   ```
2. Open Chrome or Edge and go to `http://127.0.0.1:8000/`.
3. Sign in with your Django admin/user credentials and verify that KPIs and charts load properly from `AdventureWorks2019`.

---

## Option B: macOS (MacBook) Setup Guide

### 1. Prerequisites & Docker SQL Server Setup

#### Open MacBook Terminal:
Press `Command (⌘) + Spacebar`, type `Terminal`, and press `Return` *(or open Finder > Applications > Utilities > Terminal)*.

#### Install Homebrew (Mac's command-line installer):
Paste this into MacBook Terminal and press `Return`. When prompted for your MacBook password, type it *(nothing appears on screen as you type)* and press `Return`:
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

#### Install Microsoft ODBC Driver 17 in MacBook Terminal *(Required)*:
> **Why this is required:** ODBC Driver 17 for SQL Server is needed because this project uses the standard `pyodbc` setup—it is the required bridge that lets your Python/Django app talk to Microsoft SQL Server. Without it, Django will crash with a `Data source name not found` or `IM002` driver error as soon as you run `python manage.py runserver`.

Paste these 3 lines into MacBook Terminal and press `Return`:
```bash
brew tap microsoft/mssql-release https://github.com/Microsoft/homebrew-mssql-release
brew update
HOMEBREW_ACCEPT_EULA=Y brew install msodbcsql17 mssql-tools
```

#### Install & Start Docker Desktop:
1. Search `"Download Docker Desktop for Mac"`, click **Download for Mac** *(choose **Apple Silicon** for M1/M2/M3/M4 Macs, or **Intel Chip** for older Macs)*.
2. Open **Finder > Downloads**, double-click `Docker.dmg`, and drag the **Docker** icon into **Applications**.
3. Open **Finder > Applications**, double-click **Docker**, and wait until the bottom-left indicator turns green and says **Engine running**.
4. Paste this command into MacBook Terminal to create and start your SQL Server container *(replace `YourStrong!Passw0rd` with your preferred password)*:
   ```bash
   docker run -e "ACCEPT_EULA=Y" -e "MSSQL_SA_PASSWORD=YourStrong!Passw0rd" -p 1433:1433 --name sqlserver -d mcr.microsoft.com/azure-sql-edge
   ```

#### Download & Restore `AdventureWorks2019.bak` into Docker:
1. Search `"AdventureWorks sample databases Microsoft Learn"`, scroll down to the **OLTP** table, and click `AdventureWorks2019.bak`.
2. Open **Finder > Downloads** and confirm that `AdventureWorks2019.bak` is inside your Downloads folder.
3. Paste these 3 commands into MacBook Terminal to copy the file from **Finder > Downloads** into Docker and restore the database:
   ```bash
   docker exec -it sqlserver mkdir -p /var/opt/mssql/backup
   docker cp ~/Downloads/AdventureWorks2019.bak sqlserver:/var/opt/mssql/backup/
   docker exec -it sqlserver /opt/mssql-tools/bin/sqlcmd -S localhost -U sa -P "YourStrong!Passw0rd" -Q "RESTORE DATABASE [AdventureWorks2019] FROM DISK = N'/var/opt/mssql/backup/AdventureWorks2019.bak' WITH FILE = 1, MOVE N'AdventureWorks2017' TO N'/var/opt/mssql/data/AdventureWorks2019.mdf', MOVE N'AdventureWorks2017_log' TO N'/var/opt/mssql/data/AdventureWorks2019_log.ldf', NOUNLOAD, STATS = 5"
   ```

---

### 2. Set Environment Variables (Keeps `settings.py` Cross-Platform)

Paste these 4 lines into MacBook Terminal so your Mac automatically logs into Docker without editing or overwriting your Windows teammates' host name in `settings.py`:

> **Important:** Replace `YourStrong!Passw0rd` with the exact same Docker password you used in Step 1.

```bash
echo 'export AW_DB_HOST="localhost"' >> ~/.zshrc
echo 'export AW_DB_USER="sa"' >> ~/.zshrc
echo 'export AW_DB_PASSWORD="YourStrong!Passw0rd"' >> ~/.zshrc
source ~/.zshrc
```

---

### 3. Clone, Run & Test

1. Download the project folder into your Home folder and install Python packages:
   ```bash
   cd ~
   git clone https://github.com/bianananvi/adventureworks2019.git
   cd adventureworks2019
   pip install django mssql-django pyodbc
   ```
   *(You can view this folder anytime by opening **Finder > Go > Home** and opening `adventureworks2019`, or by opening it in VS Code.)*

2. Apply migrations and launch the server:
   ```bash
   cd backend
   python manage.py migrate
   python manage.py runserver
   ```

3. **Verify in Browser:** Open Safari or Chrome, go to `http://127.0.0.1:8000/`, sign in, and test **Executive Central**, **Sales Analysis**, and **Settings** (including the Protanopia, Deuteranopia, and Tritanopia color palettes).

---

## Daily Git Workflow (Pulling & Pushing Safely)

To avoid merge conflicts with the local SQLite governance database (`app_governance.sqlite3`), run these commands from the root `adventureworks2019` folder in your Terminal:

* **Pull teammate updates:**
  ```bash
  git checkout -- backend/app_governance.sqlite3 2>/dev/null; git pull
  ```

* **Push your changes:**
  ```bash
  git checkout -- backend/app_governance.sqlite3 2>/dev/null; git add . && git commit -m "Describe your changes" && git push
  ```

---

## Demo Usernames & Passwords

| Role | Username | Password |
| :--- | :--- | :--- |
| **ADMIN** | `admin` | `admin123` |
| **MANAGER** | `manager` | `manager123` |
| **SUPERVISOR** | `supervisor` | `supervisor123` |
| **SALES ANALYST** | `sales_analyst` | `sales123` |
| **CUSTOMER ANALYST** | `customer_analyst` | `customer123` |
| **FINANCIAL ANALYST** | `financial_analyst` | `financial123` |
| **COST ANALYST** | `cost_analysis` | `cost123` |
