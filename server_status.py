#!/usr/bin/env python3

import os
import sys
import subprocess
import json
import signal
import time

def check_port(port):
    """Check if a port is in use"""
    try:
        # Cross-platform port checking
        if sys.platform.startswith('win'):
            cmd = f'netstat -ano | findstr :{port}'
            output = subprocess.check_output(cmd, shell=True, text=True)
            return len(output.strip()) > 0
        else:  # Unix-like
            cmd = f'lsof -i :{port} -P -n -sTCP:LISTEN'
            output = subprocess.check_output(cmd, shell=True, text=True)
            return len(output.strip()) > 0
    except subprocess.CalledProcessError:
        # Command returned non-zero exit status (port not in use)
        return False

def get_pid_for_port(port):
    """Get the PID of the process using a port"""
    try:
        if sys.platform.startswith('win'):
            cmd = f'netstat -ano | findstr :{port}'
            output = subprocess.check_output(cmd, shell=True, text=True)
            if output:
                # On Windows, the PID is the last column
                return output.strip().split()[-1]
        else:  # Unix-like
            cmd = f'lsof -i :{port} -P -n -sTCP:LISTEN -t'
            output = subprocess.check_output(cmd, shell=True, text=True)
            if output:
                return output.strip()
    except subprocess.CalledProcessError:
        pass
    return None

def read_pid_file(filename):
    """Read PID from a file"""
    try:
        with open(filename, 'r') as f:
            return int(f.read().strip())
    except (FileNotFoundError, ValueError):
        return None

def check_process_running(pid):
    """Check if a process with the given PID is running"""
    try:
        if pid is None:
            return False
        if sys.platform.startswith('win'):
            cmd = f'tasklist /FI "PID eq {pid}"'
            output = subprocess.check_output(cmd, shell=True, text=True)
            return f'PID: {pid}' in output
        else:  # Unix-like
            # Sending signal 0 checks if process exists
            os.kill(pid, 0)
            return True
    except (OSError, subprocess.CalledProcessError):
        return False

def check_server_config():
    """Check server configuration"""
    # Try multiple possible config locations
    config_paths = [
        os.path.join('annzarro', 'server', 'config.json'),
        os.path.join('server', 'config.json'),
        'config.json'
    ]
    
    for config_path in config_paths:
        if os.path.exists(config_path):
            try:
                with open(config_path, 'r') as f:
                    config = json.load(f)
                    
                    # Read configured port and host
                    backend_port = config.get('port', 8001)
                    host = config.get('host', '127.0.0.1')
                    
                    print(f"Found server config at {config_path}, port={backend_port}, host={host}")
                    
                    return {
                        'backend_port': backend_port,
                        'host': host,
                        'config_path': config_path
                    }
            except (json.JSONDecodeError, FileNotFoundError) as e:
                print(f"Error reading config from {config_path}: {e}")
                # Continue to try next config path
    
    # Default values if no config is found
    print("No valid server config found, using default values")
    return {
        'backend_port': 8001,  # Default port
        'host': '127.0.0.1',
        'config_path': None
    }

def get_server_status():
    """Get status of backend and frontend servers"""
    # Read stored PIDs
    backend_pid = read_pid_file('backend_pid.txt')
    frontend_pid = read_pid_file('frontend_pid.txt')
    
    # Get config
    config = check_server_config()
    backend_port = config['backend_port']
    frontend_port = 8080  # Default frontend port
    
    # Check if ports are in use
    backend_port_in_use = check_port(backend_port)
    frontend_port_in_use = check_port(frontend_port)
    
    # Check if processes are running
    backend_running = check_process_running(backend_pid)
    frontend_running = check_process_running(frontend_pid)
    
    # Get current PIDs for ports (might be different from stored ones)
    current_backend_pid = get_pid_for_port(backend_port)
    current_frontend_pid = get_pid_for_port(frontend_port)
    
    return {
        'backend': {
            'expected_pid': backend_pid,
            'current_pid': current_backend_pid,
            'port': backend_port,
            'port_in_use': backend_port_in_use,
            'process_running': backend_running,
            'status': 'running' if backend_port_in_use else 'stopped'
        },
        'frontend': {
            'expected_pid': frontend_pid,
            'current_pid': current_frontend_pid,
            'port': frontend_port,
            'port_in_use': frontend_port_in_use,
            'process_running': frontend_running,
            'status': 'running' if frontend_port_in_use else 'stopped'
        }
    }

def stop_server(pid):
    """Stop a server by PID"""
    if pid is None:
        return False
    
    try:
        if sys.platform.startswith('win'):
            subprocess.run(f'taskkill /F /PID {pid}', shell=True, check=True)
        else:  # Unix-like
            os.kill(int(pid), signal.SIGTERM)
            # Wait a moment and check if it's still running
            time.sleep(0.5)
            try:
                os.kill(int(pid), 0)
                # If we get here, process is still running, try SIGKILL
                os.kill(int(pid), signal.SIGKILL)
            except OSError:
                # Process already terminated
                pass
        return True
    except (OSError, subprocess.SubprocessError):
        return False

def print_status_and_recommendations():
    """Print server status and recommendations"""
    status = get_server_status()
    
    print("\n===== AnnZarro Server Status =====\n")
    
    # Backend status
    backend = status['backend']
    print(f"Backend Server (API):\n" +
          f"  Status: {backend['status'].upper()}\n" +
          f"  Port: {backend['port']}" + 
          (f" (IN USE by PID {backend['current_pid']})" if backend['port_in_use'] else "") + "\n" +
          f"  Expected PID: {backend['expected_pid'] or 'Not found'}\n" +
          f"  Actual Process: {'Running' if backend['process_running'] else 'Not running'}\n")
    
    # Frontend status
    frontend = status['frontend']
    print(f"Frontend Server (UI):\n" +
          f"  Status: {frontend['status'].upper()}\n" +
          f"  Port: {frontend['port']}" + 
          (f" (IN USE by PID {frontend['current_pid']})" if frontend['port_in_use'] else "") + "\n" +
          f"  Expected PID: {frontend['expected_pid'] or 'Not found'}\n" +
          f"  Actual Process: {'Running' if frontend['process_running'] else 'Not running'}\n")
    
    # Recommendations
    print("Recommendations:")
    
    if backend['port_in_use'] and frontend['port_in_use']:
        print("✅ Both servers are running. You can access the application at:")
        print(f"   http://{status['backend']['host'] if 'host' in status['backend'] else '127.0.0.1'}:{frontend['port']}")
    elif not backend['port_in_use'] and not frontend['port_in_use']:
        print("❌ Both servers are stopped. Start them with:")
        print("   python run_annzarro.py --start")
    else:
        if backend['port_in_use'] and not frontend['port_in_use']:
            print("⚠️ Backend server is running but frontend server is stopped.")
            print("   This might cause connectivity issues.")
        else:  # frontend running but backend stopped
            print("⚠️ Frontend server is running but backend server is stopped.")
            print("   The UI will load but data operations will fail.")
        
        print("\nTo fix this issue:")
        print("1. Stop all servers: python run_annzarro.py --stop")
        print("2. Restart both servers: python run_annzarro.py --start")
    
    # Port conflict recommendations
    if backend['port_in_use'] and backend['current_pid'] != backend['expected_pid']:
        print(f"\n⚠️ Port {backend['port']} is being used by another process (PID {backend['current_pid']}).")
        print("   You can:")
        print(f"   1. Stop the process: kill {backend['current_pid']} (Unix) or taskkill /F /PID {backend['current_pid']} (Windows)")
        print("   2. Change the backend port in annzarro/server/config.json")
    
    if frontend['port_in_use'] and frontend['current_pid'] != frontend['expected_pid']:
        print(f"\n⚠️ Port {frontend['port']} is being used by another process (PID {frontend['current_pid']}).")
        print("   You can:")
        print(f"   1. Stop the process: kill {frontend['current_pid']} (Unix) or taskkill /F /PID {frontend['current_pid']} (Windows)")
    
    print("\nFor detailed server management:")
    print("1. Start servers: python run_annzarro.py --start")
    print("2. Stop servers: python run_annzarro.py --stop")
    print("3. Check status: python server_status.py")

def main():
    """Main function"""
    import argparse
    parser = argparse.ArgumentParser(description='Check or manage AnnZarro server status')
    parser.add_argument('--json', action='store_true', help='Output in JSON format')
    parser.add_argument('--stop-backend', action='store_true', help='Stop the backend server')
    parser.add_argument('--stop-frontend', action='store_true', help='Stop the frontend server')
    parser.add_argument('--stop-all', action='store_true', help='Stop all servers')
    
    args = parser.parse_args()
    
    if args.stop_backend or args.stop_all:
        status = get_server_status()
        pid = status['backend']['current_pid']
        if pid:
            print(f"Stopping backend server (PID {pid})...")
            success = stop_server(pid)
            print("Success" if success else "Failed")
    
    if args.stop_frontend or args.stop_all:
        status = get_server_status()
        pid = status['frontend']['current_pid']
        if pid:
            print(f"Stopping frontend server (PID {pid})...")
            success = stop_server(pid)
            print("Success" if success else "Failed")
    
    status = get_server_status()
    
    if args.json:
        print(json.dumps(status, indent=2))
    else:
        print_status_and_recommendations()

if __name__ == '__main__':
    main()
