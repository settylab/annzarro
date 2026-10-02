# Annzarro Configuration

The configuration system is designed to be flexible, layered, and secure.

## Configuration Files

The built-in defaults ship inside the Python package, in `annzarro/config/`, so
an installed AnnZarro finds them no matter which directory it is started from.
Do not edit them to configure a deployment; put overrides in your own file (see
"Configuration Precedence" below). This directory only holds `auth/`, the legacy
location of the user database in a source checkout.

- **base.yaml**: Base configuration with default values
- **development.yaml**: Development environment overrides
- **production.yaml**: Production environment overrides
- **schema.yaml**: Configuration schema documentation

## Quick Start

1. **View current configuration:**
   ```
   python -m annzarro.cli config show
   ```

2. **Initialize a new config file:**
   ```
   python -m annzarro.cli config init --output my-config.yaml
   ```

3. **Validate configuration:**
   ```
   python -m annzarro.cli config validate
   ```

4. **Show configuration sources:**
   ```
   python -m annzarro.cli config info
   ```

## Configuration Structure

The configuration is organized into several sections:

### Server Configuration
```yaml
server:
  host: 127.0.0.1
  port: 8000
  data_dir: data
  # Additional server settings...
```

### Authentication
```yaml
auth:
  enabled: false
  user_file: users.json
  secret_key: change-this-in-production
```

### Application Branding
```yaml
branding:
  app_name: Annzarro
  project_description: Zarr-based AnnData Visualization Tool
  contact_info:
    lab_name: Your Lab Name
    lab_url: https://example.com
    email: contact@example.com
    custom_html: "<p>Custom contact information</p>"
```

### UI Configuration
```yaml
ui:
  enabled_panel_types:
    - cell-plot
    - gene-plot
    - cell-table
    - gene-table
  defaults:
    max_cells: 10000
    max_genes: 10000
    # Additional UI defaults...
  cache:
    max_entries: 1000
    max_size_mb: 1024
  autosave:
    enabled: true
    interval_ms: 10000
    # Additional autosave settings...
```

### External Integrations
```yaml
integrations:
  string_db:
    base_url: https://string-db.org/api
    version: "11.5"
```

## Configuration Precedence

Annzarro uses a layered configuration system with the following precedence (highest to lowest):

1. **Command line arguments**: `--host` (`server.host`), `--port` (`server.port`),
   `--data-dir` (`server.data_dir`), `--auth-disabled` (`auth.enabled: false`)
2. **Environment variables** (prefixed with `ANNZARRO_`)
3. **User-provided configuration file** (specified with `--config`; it is an error if it does not exist)
4. **Local configuration file** (`config.yaml` in the directory annzarro is started from)
5. **User configuration file** (`~/.config/annzarro/config.yaml`, or `$XDG_CONFIG_HOME/annzarro/config.yaml`)
6. **System-wide configuration file** (`/etc/annzarro/config.yaml`)
7. **Environment-specific defaults** (`annzarro/config/production.yaml`, or `development.yaml` with `--development`)
8. **Base defaults** (`annzarro/config/base.yaml`)

Files 4-6 are optional. Validation runs once, on the merged result.

`annzarro config show` prints the effective configuration together with every
source that was considered and which one set each value. It accepts the same
override flags as `start`, so `annzarro config show --port 9000` shows exactly
what `annzarro start --port 9000` would run with.

## Runtime Files

AnnZarro never writes into the installed package or, unless you configure a
relative path, into the directory it was started from. Runtime state lives in
`~/.annzarro` (set `ANNZARRO_HOME` to move it):

- `logs/annzarro_server.log` when `server.log_file` is unset
- `server.pid` for `annzarro start --detach` / `annzarro stop`
- `auth/users.json` when `auth.user_file` is unset (a source checkout that
  already has `config/auth/users.json` keeps using it)
- `secret_key` (mode 0600), generated on first use when authentication is on
  and `auth.secret_key` is unset or still one of the shipped placeholders

Relative `server.log_file` and `server.data_dir` values are taken relative to
the working directory; a relative `auth.user_file` relative to the state
directory (or to the checkout root in a source checkout, as before).

## Environment Variables

Environment variables override configuration values. Use the prefix `ANNZARRO_` followed by the configuration key with underscores.
Keys that contain underscores themselves work as expected (`ANNZARRO_SERVER_DATA_DIR` sets `server.data_dir`).
A variable that does not name an existing key is ignored and listed as such by `config show`.

Examples:
- `ANNZARRO_SERVER_HOST=0.0.0.0`
- `ANNZARRO_SERVER_PORT=8080`
- `ANNZARRO_SERVER_DATA_DIR=/srv/datasets`
- `ANNZARRO_AUTH_ENABLED=true`

`ANNZARRO_AUTH_DISABLED=1` is a switch equivalent to `--auth-disabled`.

## Security Best Practices

1. **Production Mode**: Use `--production` flag to load production configuration
2. **Secret Key**: Always change the `auth.secret_key` in production
3. **Sensitive Data**: Avoid storing sensitive information in configuration files
4. **Environment Variables**: Use environment variables for sensitive settings
5. **File Permissions**: Restrict access to configuration files with sensitive information

## User Management

The authentication system uses a JSON file to store user credentials:

- **Development**: Located at `config/auth/users.json` by default (protected from web access)
- **Production**: Located at `/etc/annzarro/users.json` by default

You can manage users with the CLI:

```bash
# Add a new user
python -m annzarro.cli user add --username admin --admin

# List all users
python -m annzarro.cli user list

# Remove a user
python -m annzarro.cli user remove --username user1
```

You can customize the user file location by setting the `auth.user_file` configuration value.

## Security Levels

The configuration system uses security levels to control what information is exposed to different components:

1. **public**: Information safe to share with browser clients
2. **internal**: Information that should only be available to server components
3. **sensitive**: Security-critical information that should be protected

Each configuration property can have a security level set in the schema:

```yaml
server:
  properties:
    host:
      type: string
      security: public  # Visible to browser clients
    
    secret_key:
      type: string
      security: sensitive  # Never exposed via APIs
```

When configuring the application, consider the security implications of each setting.

## Frontend Configuration

The frontend automatically loads configuration from the server at startup. This includes branding, UI settings, and feature flags. You don't need to manually configure the frontend - it inherits its configuration from the server.

## Custom Configuration

For custom deployments, you can create your own configuration file:

```
python -m annzarro.cli config init --output custom-config.yaml
```

Then edit the file and start the server with:

```
python -m annzarro.cli start --config custom-config.yaml
```