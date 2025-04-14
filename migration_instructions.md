# Migration Instructions for Annzarro Server

This document outlines the steps to migrate from the legacy server in `server/` to the new implementation in `annzarro/server/`.

## Current State

The codebase currently has two server implementations:

1. **Legacy Server** (`server/`): The original implementation with various scripts and components.
2. **New Server** (`annzarro/server/`): The reorganized, modular implementation with improved architecture.

## Migration Steps

### 1. Authentication System

Copy the authentication system from `server/auth.py` to `annzarro/server/auth.py`:

```bash
cp server/auth.py annzarro/server/
```

Update imports in the new location to match the new package structure.

### 2. Configuration Files

Copy and adapt production configuration:

```bash
cp server/production_config.json annzarro/server/
```

Merge any custom settings from `server/config.json` to `annzarro/server/config.json`.

### 3. Deployment Scripts

Copy production deployment scripts:

```bash
cp server/gunicorn_config.py annzarro/server/
cp server/run_gunicorn.sh annzarro/server/
cp server/setup_production.sh annzarro/server/
cp server/annzarro.service annzarro/server/
```

Update paths and references in these files to use the new location.

### 4. User Data

Migrate user accounts:

```bash
cp server/users.json annzarro/server/
```

### 5. Update Client Code

Any client code that directly imports from the server module should be updated to use the new structure:

- Change `from server import X` to `from annzarro.server import X`
- Update configuration paths
- Update any hardcoded references to server paths

### 6. Testing

Test the migrated server by running:

```bash
python -m annzarro.server
```

Verify that all functionality works correctly, including:
- Authentication
- API endpoints
- Data access
- Production deployment with Gunicorn

### 7. Deprecation

Once the migration is complete and verified:

1. Update all documentation to refer to the new server location
2. Add deprecation warnings to any legacy code that's still being used
3. Plan for complete removal of the legacy server code in a future release

## Fallback Plan

If issues arise during migration, the legacy server can still be used temporarily while resolving migration issues.