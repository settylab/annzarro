#!/usr/bin/env python
"""
Test runner script for Annzarro application.

This script provides a unified way to run all tests, including unit tests,
integration tests, and end-to-end tests for the application.
"""

import os
import sys
import argparse
import subprocess
import multiprocessing
import tempfile
import time
import json
import shutil
import signal
from pathlib import Path


def run_server(port=8000, data_dir=None, static_dir=None, pid_file=None):
    """Run the Annzarro server as a subprocess."""
    # Get the path to the server entry point
    server_cmd = [
        sys.executable,
        "-m", "annzarro.server",
        "--port", str(port)
    ]
    
    # Add data directory if specified
    if data_dir:
        server_cmd.extend(["--data-dir", data_dir])
        
    # Add static directory if specified
    if static_dir:
        server_cmd.extend(["--static-dir", static_dir])
    
    # Start the server
    server_process = subprocess.Popen(
        server_cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )
    
    # Write PID to file if requested
    if pid_file:
        with open(pid_file, "w") as f:
            f.write(str(server_process.pid))
    
    return server_process


def stop_server(server_process, timeout=5):
    """Stop the server process."""
    if server_process:
        server_process.terminate()
        try:
            server_process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            server_process.kill()


def run_integration_tests():
    """Run integration tests."""
    print("Running integration tests...")
    
    # Run the integration tests with pytest
    test_cmd = [
        sys.executable,
        "-m", "pytest",
        "annzarro/tests/integration/",
        "-v"
    ]
    
    try:
        subprocess.run(test_cmd, check=True)
        return 0
    except subprocess.CalledProcessError as e:
        return e.returncode


def run_unit_tests():
    """Run unit tests."""
    print("Running unit tests...")
    
    # Run the unit tests with pytest
    test_cmd = [
        sys.executable,
        "-m", "pytest",
        "annzarro/tests/",
        "-v"
    ]
    
    try:
        subprocess.run(test_cmd, check=True)
        return 0
    except subprocess.CalledProcessError as e:
        return e.returncode


def run_js_tests():
    """Run JavaScript tests."""
    print("Running JavaScript tests...")
    
    # Run the JavaScript tests
    test_cmd = [
        "npm", "test"
    ]
    
    try:
        subprocess.run(test_cmd, check=True)
        return 0
    except subprocess.CalledProcessError as e:
        return e.returncode


def run_e2e_tests():
    """Run end-to-end tests that need a running server."""
    print("Running end-to-end tests...")
    
    # Create temporary directories for test data
    temp_dir = tempfile.mkdtemp()
    data_dir = os.path.join(temp_dir, "data")
    os.makedirs(data_dir, exist_ok=True)
    
    # Create a sample zarr dataset
    sample_zarr = os.path.join(data_dir, "sample.zarr")
    os.makedirs(sample_zarr, exist_ok=True)
    with open(os.path.join(sample_zarr, ".zgroup"), "w") as f:
        f.write(json.dumps({"zarr_format": 2}))
    
    # Check if real data directory exists and copy aging.zarr if available
    project_root = Path(__file__).resolve().parent
    real_data_dir = os.path.join(project_root, "data")
    real_dataset = os.path.join(real_data_dir, "aging.zarr")
    
    if os.path.exists(real_dataset):
        print("Found aging.zarr dataset - Adding to test data directory for comprehensive testing")
        # Create a symlink to the real dataset in the temp directory
        # This is more efficient than copying and works for testing
        os.symlink(real_dataset, os.path.join(data_dir, "aging.zarr"))
    else:
        print("No aging.zarr dataset found - some real data tests will be skipped")
        
    # Use project root as static directory
    static_dir = str(project_root)
    
    # Start server
    server_process = None
    try:
        server_process = run_server(
            port=8888,
            data_dir=data_dir,
            static_dir=static_dir
        )
        
        # Wait for server to start
        time.sleep(2)
        
        # Set environment variable for test server URL
        os.environ["ANNZARRO_TEST_SERVER_URL"] = "http://localhost:8888"
        
        # Run the tests with pytest
        test_cmd = [
            sys.executable,
            "-m", "pytest",
            "annzarro/tests/e2e/",
            "-v"
        ]
        
        try:
            subprocess.run(test_cmd, check=True)
            return 0
        except subprocess.CalledProcessError as e:
            return e.returncode
            
    finally:
        # Stop server
        if server_process:
            stop_server(server_process)
            
        # Clean up
        shutil.rmtree(temp_dir, ignore_errors=True)
        
        # Clear environment variable
        if "ANNZARRO_TEST_SERVER_URL" in os.environ:
            del os.environ["ANNZARRO_TEST_SERVER_URL"]


def main():
    """Run tests based on command line arguments."""
    parser = argparse.ArgumentParser(description="Run Annzarro tests")
    parser.add_argument("--unit", action="store_true", help="Run unit tests")
    parser.add_argument("--integration", action="store_true", help="Run integration tests")
    parser.add_argument("--js", action="store_true", help="Run JavaScript tests")
    parser.add_argument("--e2e", action="store_true", help="Run end-to-end tests")
    parser.add_argument("--all", action="store_true", help="Run all tests")
    parser.add_argument("--ci", action="store_true", help="Run in CI mode (skip certain tests)")
    parser.add_argument("--coverage", action="store_true", help="Generate coverage reports")
    
    args = parser.parse_args()
    
    # Default to all tests if no specific test type is specified
    run_all = args.all or not (args.unit or args.integration or args.js or args.e2e)
    
    # Print test environment info
    print("\n=== Annzarro Test Runner ===")
    print(f"Python version: {sys.version}")
    print(f"Running on: {os.name} {sys.platform}")
    if args.ci:
        print("Running in CI mode - some tests may be skipped")
    
    if os.path.exists(os.path.join(os.path.dirname(__file__), "data", "aging.zarr")):
        print("✓ Real data available: aging.zarr (mouse hematopoiesis)")
    else:
        print("ℹ️ No real data found: Some tests will be skipped")
    print("============================\n")
    
    # Run tests based on arguments
    try:
        results = []
        
        if args.unit or run_all:
            print("\n📋 RUNNING UNIT TESTS")
            unit_result = run_unit_tests()
            results.append(("Unit Tests", unit_result == 0))
            
        if args.integration or run_all:
            print("\n📋 RUNNING INTEGRATION TESTS")
            integration_result = run_integration_tests()
            results.append(("Integration Tests", integration_result == 0))
            
        if args.js or run_all:
            print("\n📋 RUNNING JAVASCRIPT TESTS")
            js_result = run_js_tests()
            results.append(("JavaScript Tests", js_result == 0))
            
        if args.e2e or run_all:
            print("\n📋 RUNNING END-TO-END TESTS")
            e2e_result = run_e2e_tests()
            results.append(("End-to-End Tests", e2e_result == 0))
            
        # Print summary
        print("\n=== Test Results Summary ===")
        all_passed = True
        for name, passed in results:
            status = "✅ PASSED" if passed else "❌ FAILED"
            print(f"{name}: {status}")
            if not passed:
                all_passed = False
        
        if all_passed:
            print("\n🎉 All tests completed successfully!")
            return 0
        else:
            print("\n❌ Some tests failed")
            return 1
            
    except subprocess.CalledProcessError as e:
        print(f"❌ Tests failed with error code: {e.returncode}")
        return e.returncode


if __name__ == "__main__":
    # Handle interrupts gracefully
    def signal_handler(sig, frame):
        print("\nTest run interrupted. Cleaning up...")
        sys.exit(1)
        
    signal.signal(signal.SIGINT, signal_handler)
    
    main()