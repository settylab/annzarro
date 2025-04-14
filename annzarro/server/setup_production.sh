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
CONFIG_DIR="$INSTALL_DIR/server"
CONFIG_FILE="$CONFIG_DIR/production_config.json"
DATA_DIR="$INSTALL_DIR/data"
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
chown -R "$USERNAME:$USERNAME" "$INSTALL_DIR"
chown -R "$USERNAME:$USERNAME" "$LOG_DIR"
chmod -R 755 "$INSTALL_DIR"
chmod -R 755 "$LOG_DIR"

# Copy files
echo -e "${GREEN}Copying files to installation directory...${NC}"
cp -R ./* "$INSTALL_DIR/"

# Update configuration with secure key
echo -e "${GREEN}Generating secure secret key...${NC}"
RANDOM_KEY=$(openssl rand -hex 32)
sed -i "s/change-this-to-a-secure-random-value/$RANDOM_KEY/g" "$CONFIG_FILE"

# Create systemd service
echo -e "${GREEN}Setting up systemd service...${NC}"
cp "$INSTALL_DIR/server/annzarro.service" "/etc/systemd/system/$SERVICE_NAME.service"
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

# Install Python dependencies
echo -e "${GREEN}Installing Python dependencies...${NC}"
pip3 install -r "$INSTALL_DIR/requirements.txt"

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

# Create the user
cd "$INSTALL_DIR"
python3 -c "
import sys
sys.path.append('.')
from server.auth import AuthManager
auth = AuthManager('$CONFIG_DIR/users.json')
auth.create_user('$ADMIN_USER', '$ADMIN_PASS', is_admin=True)
"

# Set correct permissions for user file
chown "$USERNAME:$USERNAME" "$CONFIG_DIR/users.json"
chmod 600 "$CONFIG_DIR/users.json"

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
echo -e "${YELLOW}Access the web interface at:${NC} http://your-server-ip:8000"
echo -e "${YELLOW}Username:${NC} $ADMIN_USER"
echo ""
echo -e "${RED}IMPORTANT: For production use, please configure HTTPS!${NC}"
echo -e "${RED}Edit $CONFIG_FILE and set https_enabled to true${NC}"
echo -e "${RED}and provide valid cert_file and key_file paths.${NC}"
echo ""
echo "Thank you for using Annzarro!"