# Annzarro Server

A high-performance, secure web server for the Annzarro single-cell data visualization tool.

## Features

- **Security**: Strong user authentication with password hashing and token-based API access
- **Performance**: Multi-process architecture with Gunicorn to handle high demand
- **Scalability**: Configurable for various deployment scenarios
- **HTTPS Support**: Built-in SSL/TLS support for secure connections
- **Rate Limiting**: Protection against abuse and DoS attacks
- **Session Management**: Secure, HTTP-only session cookies with expiration

## Requirements

- Python 3.7+
- Flask (web framework)
- Gunicorn (production WSGI server)
- Additional Python packages (installed via setup script)

## Quick Start

1. Run the setup script:
   ```
   ./setup_server.sh
   ```

2. Start the server:
   ```
   ./run_annzarro.py --start
   ```

3. Access the application at:
   - http://localhost:8000 (if HTTPS is disabled)
   - https://localhost:8000 (if HTTPS is enabled)

## Configuration

The server can be configured by editing `server/config.json`. Key configuration options:

- `port`: Server port (default: 8000)
- `host`: Server host (default: 0.0.0.0, all interfaces)
- `https_enabled`: Enable HTTPS (default: true)
- `workers`: Number of worker processes (default: 2 × CPU cores + 1)
- `threads`: Number of threads per worker (default: 4)
- `max_upload_size`: Maximum file upload size in MB (default: 100)
- `rate_limits`: Rate limiting rules (default: ["120 per minute", "10 per second"])
- `use_gunicorn`: Use Gunicorn for production (default: true)

## User Management

### Creating a User

```
./run_annzarro.py --create-user
```

To create an admin user:

```
./run_annzarro.py --create-user --admin
```

### Managing Users

User accounts are stored in `server/users.json`. 

## Deployment

### Systemd (Linux)

1. Edit `server/annzarro.service` with your installation path
2. Copy the service file:
   ```
   sudo cp server/annzarro.service /etc/systemd/system/
   ```
3. Enable and start the service:
   ```
   sudo systemctl enable annzarro
   sudo systemctl start annzarro
   ```

### Behind a Reverse Proxy (Nginx)

For production environments, we recommend using Nginx as a reverse proxy:

1. Configure the Annzarro server to run on localhost:
   ```json
   {
     "host": "127.0.0.1",
     "behind_proxy": true
   }
   ```

2. Set up Nginx to proxy requests:
   ```nginx
   server {
       listen 80;
       server_name your-domain.com;
       
       # Redirect HTTP to HTTPS
       return 301 https://$host$request_uri;
   }

   server {
       listen 443 ssl;
       server_name your-domain.com;
       
       ssl_certificate /path/to/cert.pem;
       ssl_certificate_key /path/to/key.pem;
       
       location / {
           proxy_pass http://127.0.0.1:8000;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```

## Security Recommendations

1. Always use HTTPS in production
2. Use strong passwords for user accounts
3. Set up a firewall to restrict access to the server
4. Regularly update all components
5. Use a reverse proxy for additional security and performance
6. Consider setting up IP-based access restrictions for sensitive deployments

## Troubleshooting

### Server Won't Start

- Check the log file: `server/annzarro_server.log`
- Ensure required packages are installed
- Verify you have appropriate permissions

### Authentication Issues

- Reset a user's password with: 
  ```
  ./run_annzarro.py --create-user --username existing_user
  ```
- Check file permissions on `server/users.json`

### Performance Issues

- Adjust worker and thread count in `config.json`
- Monitor CPU and memory usage
- Consider using a reverse proxy for caching static content

## License

GPL-3.0-or-later - See main project LICENSE file