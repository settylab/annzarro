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
    """Get status of unified server"""
    # Read stored PID - try multiple filename options
    server_pid = read_pid_file('server_pid.txt')
    
    # For backward compatibility, also check backend_pid.txt
    if server_pid is None:
        server_pid = read_pid_file('backend_pid.txt')
    
    # Get config
    config = check_server_config()
    server_port = config['backend_port']  # We use the same port for the unified server
    host = config.get('host', '127.0.0.1')
    
    # Check if port is in use
    port_in_use = check_port(server_port)
    
    # Check if process is running
    process_running = check_process_running(server_pid)
    
    # Get current PID for port (might be different from stored one)
    current_pid = get_pid_for_port(server_port)
    
    # Check if config indicates unified server
    is_unified = False
    try:
        with open(config['config_path'], 'r') as f:
            full_config = json.load(f)
            is_unified = full_config.get('unified_server', False)
    except (FileNotFoundError, json.JSONDecodeError, KeyError, TypeError):
        # Default to unified server if we can't determine
        is_unified = True
    
    return {
        'unified': is_unified,
        'server': {
            'expected_pid': server_pid,
            'current_pid': current_pid,
            'port': server_port,
            'host': host,
            'port_in_use': port_in_use,
            'process_running': process_running,
            'status': 'running' if port_in_use else 'stopped'
        },
        # Keep these for backward compatibility
        'backend': {
            'expected_pid': server_pid,
            'current_pid': current_pid,
            'port': server_port,
            'host': host,
            'port_in_use': port_in_use,
            'process_running': process_running,
            'status': 'running' if port_in_use else 'stopped'
        },
        'frontend': {
            'expected_pid': None,
            'current_pid': None,
            'port': server_port,  # Same port in unified server
            'port_in_use': False,  # Always false for separate frontend in unified mode
            'process_running': False,
            'status': 'unified' if is_unified else 'stopped'
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
    
    # Check if we're using unified server
    is_unified = status.get('unified', False)
    
    if is_unified:
        # Unified server status
        server = status['server']
        print(f"Unified Server (API + UI):\n" +
              f"  Status: {server['status'].upper()}\n" +
              f"  Port: {server['port']}" + 
              (f" (IN USE by PID {server['current_pid']})" if server['port_in_use'] else "") + "\n" +
              f"  Host: {server.get('host', '127.0.0.1')}\n" +
              f"  Expected PID: {server['expected_pid'] or 'Not found'}\n" +
              f"  Actual Process: {'Running' if server['process_running'] else 'Not running'}\n")
        
        # Recommendations for unified server
        print("Recommendations:")
        
        if server['port_in_use']:
            print(f"✅ Unified server is running. You can access the application at:")
            print(f"   http://{server.get('host', '127.0.0.1')}:{server['port']}")
        else:
            print("❌ Unified server is stopped. Start it with:")
            print("   python run_annzarro.py --start")
        
        # Port conflict recommendations
        if server['port_in_use'] and server['current_pid'] != server['expected_pid']:
            print(f"\n⚠️ Port {server['port']} is being used by another process (PID {server['current_pid']}).")
            print("   You can:")
            print(f"   1. Stop the process: kill {server['current_pid']} (Unix) or taskkill /F /PID {server['current_pid']} (Windows)")
            print("   2. Change the server port in annzarro/server/config.json")
    else:
        # Legacy dual-server status
        backend = status['backend']
        frontend = status['frontend']
        
        print(f"Backend Server (API):\n" +
              f"  Status: {backend['status'].upper()}\n" +
              f"  Port: {backend['port']}" + 
              (f" (IN USE by PID {backend['current_pid']})" if backend['port_in_use'] else "") + "\n" +
              f"  Expected PID: {backend['expected_pid'] or 'Not found'}\n" +
              f"  Actual Process: {'Running' if backend['process_running'] else 'Not running'}\n")
        
        print(f"Frontend Server (UI):\n" +
              f"  Status: {frontend['status'].upper()}\n" +
              f"  Port: {frontend['port']}" + 
              (f" (IN USE by PID {frontend['current_pid']})" if frontend['port_in_use'] else "") + "\n" +
              f"  Expected PID: {frontend['expected_pid'] or 'Not found'}\n" +
              f"  Actual Process: {'Running' if frontend['process_running'] else 'Not running'}\n")
        
        # Legacy recommendations
        print("Recommendations:")
        
        if backend['port_in_use'] and frontend['port_in_use']:
            print("✅ Both servers are running. You can access the application at:")
            print(f"   http://{backend.get('host', '127.0.0.1')}:{frontend['port']}")
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
    print("1. Start server: python run_annzarro.py --start")
    print("2. Stop server: python run_annzarro.py --stop")
    print("3. Check status: python server_status.py")

def main():
    """Main function"""
    import argparse
    parser = argparse.ArgumentParser(description='Check or manage AnnZarro server status')
    parser.add_argument('--json', action='store_true', help='Output in JSON format')
    parser.add_argument('--stop-server', action='store_true', help='Stop the unified server')
    parser.add_argument('--stop-backend', action='store_true', help='Stop the backend server (legacy)')
    parser.add_argument('--stop-frontend', action='store_true', help='Stop the frontend server (legacy)')
    parser.add_argument('--stop-all', action='store_true', help='Stop all servers')
    
    args = parser.parse_args()
    
    status = get_server_status()
    is_unified = status.get('unified', False)
    
    if is_unified:
        # Unified server mode
        if args.stop_server or args.stop_all or args.stop_backend:
            pid = status['server']['current_pid']
            if pid:
                print(f"Stopping unified server (PID {pid})...")
                try:
                    success = stop_server(pid)
                    print("Success" if success else "Failed")
                except Exception as e:
                    print(f"Failed: {e}")
            else:
                print("No running server to stop")
    else:
        # Legacy dual-server mode
        if args.stop_backend or args.stop_all:
            pid = status['backend']['current_pid']
            if pid:
                print(f"Stopping backend server (PID {pid})...")
                success = stop_server(pid)
                print("Success" if success else "Failed")
        
        if args.stop_frontend or args.stop_all:
            pid = status['frontend']['current_pid']
            if pid:
                print(f"Stopping frontend server (PID {pid})...")
                success = stop_server(pid)
                print("Success" if success else "Failed")
    
    # Refresh status after stopping servers
    status = get_server_status()
    
    if args.json:
        print(json.dumps(status, indent=2))
    else:
        print_status_and_recommendations()

if __name__ == '__main__':
    main()
