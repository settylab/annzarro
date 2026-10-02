# Annzarro Configuration

This directory contains the configuration files for Annzarro. The configuration system is designed to be flexible, layered, and secure.

## Configuration Files

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
  # secret_key: leave unset; generated and stored beside user_file
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

1. **Command line arguments**
2. **Environment variables** (prefixed with `ANNZARRO_`)
3. **User-provided configuration file** (specified with `--config`)
4. **Local configuration file** (`config.yaml` in current directory)
5. **User configuration file** (`~/.config/annzarro/config.yaml`)
6. **System-wide configuration file** (`/etc/annzarro/config.yaml`)
7. **Environment-specific configuration** (`development.yaml` or `production.yaml`)
8. **Base configuration** (`base.yaml`)

## Environment Variables

Environment variables override configuration values. Use the prefix `ANNZARRO_` followed by the configuration key with underscores.

Examples:
- `ANNZARRO_SERVER_HOST=0.0.0.0`
- `ANNZARRO_SERVER_PORT=8080`
- `ANNZARRO_AUTH_ENABLED=true`

## Security Best Practices

1. **Production Mode**: Use `--production` flag to load production configuration
2. **Secret Key**: Leave `auth.secret_key` unset and a random key is generated once and stored (mode 0600) beside the users file as `annzarro_secret_key`; or set your own long random value. The old placeholder values are refused
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