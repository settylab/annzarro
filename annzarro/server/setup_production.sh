#!/bin/bash
#
# Annzarro Production Setup Script
# This script prepares the Annzarro server for production use
#

# Ensure script is run as root
if [ "$EUID" -ne 0 ]; then
  echo "Please run as root or with sudo"
  exit 1
fi

# Set installation directory
INSTALL_DIR="/opt/annzarro"
LOG_DIR="/var/log/annzarro"
SERVICE_NAME="annzarro"
CONFIG_DIR="/etc/annzarro"
CONFIG_FILE="$CONFIG_DIR/site.yaml"
DATA_DIR="/srv/annzarro/data"
USER_FILE="/srv/annzarro/users.json"
USERNAME="www-data"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}===========================================================${NC}"
echo -e "${BLUE}  Annzarro Production Setup Script                        ${NC}"
echo -e "${BLUE}===========================================================${NC}"
echo ""

# Check if Python 3 is available
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}Error: Python 3 is required but not found.${NC}"
    echo "Please install Python 3 first."
    exit 1
fi

# Check if pip3 is available
if ! command -v pip3 &> /dev/null; then
    echo -e "${YELLOW}Warning: pip3 is not available. Installing...${NC}"
    apt-get update && apt-get install -y python3-pip
fi

# Create directories
echo -e "${GREEN}Creating directories...${NC}"
mkdir -p "$INSTALL_DIR"
mkdir -p "$LOG_DIR"
mkdir -p "$CONFIG_DIR"
mkdir -p "$DATA_DIR"

# Set permissions
echo -e "${GREEN}Setting permissions...${NC}"
# The service account writes panel sets (data_dir/sessions), the users file
# and the login key under /srv/annzarro, and its log; it never needs to
# write the code in $INSTALL_DIR.
chown -R "$USERNAME:$USERNAME" "/srv/annzarro"
chown -R "$USERNAME:$USERNAME" "$LOG_DIR"
chmod -R 755 "$INSTALL_DIR"
chmod -R 755 "$LOG_DIR"

# Copy files
echo -e "${GREEN}Copying files to installation directory...${NC}"
cp -R ./* "$INSTALL_DIR/"

# Site configuration (YAML, layered over the built-in defaults). An existing
# one is kept.
if [ ! -f "$CONFIG_FILE" ]; then
    cp "$INSTALL_DIR/annzarro/server/site.example.yaml" "$CONFIG_FILE"
    echo -e "${YELLOW}Wrote $CONFIG_FILE from the example; review it.${NC}"
fi

# No secret key to set: on first start the server generates one and keeps it
# (mode 0600) beside the users file as annzarro_secret_key.

# Create systemd service
echo -e "${GREEN}Setting up systemd service...${NC}"
cp "$INSTALL_DIR/annzarro/server/annzarro.service" "/etc/systemd/system/$SERVICE_NAME.service"
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

# Install AnnZarro and gunicorn into the venv the systemd unit runs from
echo -e "${GREEN}Installing Python dependencies...${NC}"
python3 -m venv "$INSTALL_DIR/venv"
"$INSTALL_DIR/venv/bin/pip" install "$INSTALL_DIR" gunicorn

# Create admin user
echo -e "${GREEN}Creating admin user...${NC}"
read -p "Enter admin username [admin]: " ADMIN_USER
ADMIN_USER=${ADMIN_USER:-admin}

read -s -p "Enter admin password: " ADMIN_PASS
echo ""
read -s -p "Confirm admin password: " ADMIN_PASS_CONFIRM
echo ""

if [ "$ADMIN_PASS" != "$ADMIN_PASS_CONFIRM" ]; then
    echo -e "${RED}Error: Passwords do not match.${NC}"
    exit 1
fi

# Create the user in the users file the site configuration names
cd "$INSTALL_DIR"
ANNZARRO_CONFIG="$CONFIG_FILE" "$INSTALL_DIR/venv/bin/python" -m annzarro.cli --config "$CONFIG_FILE" \
    user add --admin --username "$ADMIN_USER" --password "$ADMIN_PASS"

# Set correct permissions for user file
chown "$USERNAME:$USERNAME" "$USER_FILE"
chmod 600 "$USER_FILE"

echo -e "${GREEN}Admin user '$ADMIN_USER' created successfully.${NC}"

# Final instructions
echo ""
echo -e "${BLUE}===========================================================${NC}"
echo -e "${BLUE}  Installation Complete                                   ${NC}"
echo -e "${BLUE}===========================================================${NC}"
echo ""
echo -e "${GREEN}Annzarro has been installed to: $INSTALL_DIR${NC}"
echo -e "${GREEN}Configuration file: $CONFIG_FILE${NC}"
echo -e "${GREEN}Log directory: $LOG_DIR${NC}"
echo -e "${GREEN}Data directory: $DATA_DIR${NC}"
echo ""
echo -e "${YELLOW}Start the service with:${NC} sudo systemctl start $SERVICE_NAME"
echo -e "${YELLOW}Check status with:${NC} sudo systemctl status $SERVICE_NAME"
echo -e "${YELLOW}View logs with:${NC} sudo journalctl -u $SERVICE_NAME"
echo ""
echo -e "${YELLOW}The server listens on 127.0.0.1:8000; reach it through your reverse proxy.${NC}"
echo -e "${YELLOW}Username:${NC} $ADMIN_USER"
echo ""
echo -e "${RED}IMPORTANT: For production use, please configure HTTPS!${NC}"
echo -e "${RED}Put a TLS reverse proxy (nginx, apache) in front and keep${NC}"
echo -e "${RED}proxy_count: 1 in $CONFIG_FILE (see README).${NC}"
echo ""
echo "Thank you for using Annzarro!"