"""
Authentication module for Annzarro Server
-----------------------------------------
Provides secure user authentication and token management.
"""

import os
import json
import time
import secrets
import logging
import hashlib
import base64
import uuid
import tempfile
from contextlib import contextmanager
from datetime import datetime, timedelta
from threading import Lock
from pathlib import Path
from flask import session

# Cross-process file locking (POSIX). Without it, two processes (gunicorn
# workers, or the server and `annzarro user add`) can interleave their
# read-modify-write of users.json; the thread lock alone cannot see them.
try:
    import fcntl
except ImportError:  # Windows: the desktop app is single-process
    fcntl = None

# JWT support (if available)
try:
    import jwt
    JWT_AVAILABLE = True
except ImportError:
    JWT_AVAILABLE = False

# Constants
TOKEN_EXPIRY_HOURS = 24  # Tokens expire after 24 hours by default

class User:
    """User class for authentication"""
    
    def __init__(self, username, password_hash=None, is_admin=False, id=None):
        """
        Initialize a user
        
        Args:
            username (str): User's username
            password_hash (str, optional): Hashed password. Defaults to None.
            is_admin (bool, optional): Whether user has admin privileges. Defaults to False.
            id (str, optional): User ID. Defaults to generated UUID.
        """
        self.username = username
        self.password_hash = password_hash
        self.is_admin = is_admin
        self.id = id or str(uuid.uuid4())
        self.tokens = {}  # {token: expiry_timestamp}
        self.last_login = None
        self.login_attempts = 0
        self.locked_until = None
    
    def to_dict(self):
        """Convert user to dictionary for storage"""
        return {
            'id': self.id,
            'username': self.username,
            'password_hash': self.password_hash,
            'is_admin': self.is_admin,
            'tokens': self.tokens,
            'last_login': self.last_login,
            'login_attempts': self.login_attempts,
            'locked_until': self.locked_until
        }
    
    @classmethod
    def from_dict(cls, data):
        """Create user from dictionary"""
        user = cls(
            username=data['username'],
            password_hash=data['password_hash'],
            is_admin=data.get('is_admin', False),
            id=data.get('id')
        )
        user.tokens = data.get('tokens', {})
        user.last_login = data.get('last_login')
        user.login_attempts = data.get('login_attempts', 0)
        user.locked_until = data.get('locked_until')
        return user

def resolve_user_file(user_file):
    """Absolute path of the users file; relative paths are taken from the package root."""
    if os.path.isabs(user_file):
        return user_file
    package_root = Path(__file__).resolve().parent.parent.parent
    return os.path.join(package_root, user_file)


class AuthManager:
    """Authentication manager for Annzarro"""
    
    def __init__(self, user_file='users.json', token_secret=None, session_timeout=3600,
                 max_login_attempts=5, lockout_time=900):
        """
        Initialize authentication manager
        
        Args:
            user_file (str, optional): Path to user credentials file. Defaults to 'users.json'.
            token_secret (str, optional): Secret for token signing. Defaults to None.
            session_timeout (int, optional): Session timeout in seconds. Defaults to 3600.
            max_login_attempts (int, optional): Max failed login attempts before lockout. Defaults to 5.
            lockout_time (int, optional): Account lockout time in seconds. Defaults to 900.
        """
        # Handle relative paths by making them absolute from package root
        self.user_file = resolve_user_file(user_file)
            
        self.token_secret = token_secret or secrets.token_hex(32)
        self.session_timeout = session_timeout
        self.max_login_attempts = max_login_attempts
        self.lockout_time = lockout_time
        self.users = {}  # {username: User}
        self.file_lock = Lock()  # For thread safety
        self._file_stamp = None  # (mtime_ns, size) of users.json as last read
        
        # Create directory if needed
        os.makedirs(os.path.dirname(os.path.abspath(self.user_file)), exist_ok=True)
        
        # Log the absolute path being used
        logging.info(f"Auth using user file: {os.path.abspath(self.user_file)}")
        
        # Load existing users
        self._load_users()
    
    def _stamp(self):
        """(mtime_ns, size) of the users file, or None if it does not exist."""
        try:
            st = os.stat(self.user_file)
            return (st.st_mtime_ns, st.st_size)
        except FileNotFoundError:
            return None

    def _read_users_file(self):
        """Parse the users file into {username: User}; {} if it does not exist."""
        if not os.path.exists(self.user_file):
            return {}
        with open(self.user_file, 'r') as f:
            data = json.load(f)
        return {username: User.from_dict(user_data) for username, user_data in data.items()}

    def _load_users(self):
        """Load users from file"""
        try:
            stamp = self._stamp()
            self.users = self._read_users_file()
            self._file_stamp = stamp
            if stamp is None:
                logging.info(f"User file {self.user_file} not found, starting with empty user list")
            else:
                logging.info(f"Loaded {len(self.users)} users from {self.user_file}")
        except Exception as e:
            logging.error(f"Error loading users: {e}")

    def _reload_if_changed(self):
        """Pick up changes another process made to the users file.

        `annzarro user add/remove` edits the file while the server runs; this
        makes a new user, a removed user or a new admin take effect without a
        restart. One stat() per call.
        """
        if self._stamp() != self._file_stamp:
            with self.file_lock:
                self._load_users()

    @contextmanager
    def _locked_file(self):
        """Hold the thread lock and, where available, an exclusive file lock."""
        with self.file_lock:
            if fcntl is None:
                yield
                return
            with open(self.user_file + ".lock", "a") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
                try:
                    yield
                finally:
                    fcntl.flock(lock, fcntl.LOCK_UN)

    def _save_users(self, changed=(), created=(), removed=()):
        """Write this process's changes to the users file without losing anyone else's.

        The file is re-read under an exclusive lock and only the named users
        are applied on top of it: ``created`` are added, ``changed`` replace
        their on-disk record only if it still exists (so a user removed
        meanwhile is not resurrected by their own failed login), ``removed``
        are deleted. Everything else comes from disk. Previously the whole
        in-memory table was dumped, so a user added by the CLI while the
        server ran vanished at the next login.

        The write goes to a temporary file that replaces users.json in one
        step, so a crash or a concurrent reader never sees half a file.
        """
        try:
            with self._locked_file():
                merged = self._read_users_file()
                for username in created:
                    merged[username] = self.users[username]
                for username in changed:
                    if username in merged and username in self.users:
                        merged[username] = self.users[username]
                for username in removed:
                    merged.pop(username, None)

                directory = os.path.dirname(os.path.abspath(self.user_file))
                fd, tmp = tempfile.mkstemp(prefix=".users_", suffix=".json", dir=directory)
                try:
                    with os.fdopen(fd, 'w') as f:
                        json.dump({u: user.to_dict() for u, user in merged.items()}, f, indent=2)
                        f.flush()
                        os.fsync(f.fileno())
                    # Keep the existing file's permissions; a new one stays 0600
                    if os.path.exists(self.user_file):
                        os.chmod(tmp, os.stat(self.user_file).st_mode & 0o777)
                    os.replace(tmp, self.user_file)
                except BaseException:
                    if os.path.exists(tmp):
                        os.unlink(tmp)
                    raise

                self.users = merged
                self._file_stamp = self._stamp()
            logging.debug(f"Saved {len(self.users)} users to {self.user_file}")
        except Exception as e:
            logging.error(f"Error saving users: {e}")

    def create_user(self, username, password, is_admin=False):
        """
        Create a new user
        
        Args:
            username (str): Username
            password (str): Plain text password
            is_admin (bool, optional): Whether user is admin. Defaults to False.
            
        Returns:
            bool: Success status
        """
        self._reload_if_changed()
        if username in self.users:
            logging.warning(f"Cannot create user: Username {username} already exists")
            return False
            
        # Hash password using Werkzeug's method
        try:
            from werkzeug.security import generate_password_hash
            password_hash = generate_password_hash(password)
        except ImportError:
            # Fallback to custom hash
            salt = secrets.token_hex(8)
            password_hash = f"pbkdf2:sha256:150000${salt}${self._hash_password(password, salt)}"
            
        # Create user
        self.users[username] = User(username, password_hash, is_admin)
        self._save_users(created=[username])
        logging.info(f"Created user: {username} (admin: {is_admin})")
        return True
    
    def authenticate(self, username, password):
        """
        Authenticate a user with username and password
        
        Args:
            username (str): Username
            password (str): Password
            
        Returns:
            bool: Authentication success
        """
        logging.info(f"Authentication attempt for user: {username}")
        
        self._reload_if_changed()
        if username not in self.users:
            logging.warning(f"Authentication failed: User {username} not found")
            return False
            
        user = self.users[username]
        
        # Check if account is locked
        if user.locked_until and float(user.locked_until) > time.time():
            lock_remaining = int(float(user.locked_until) - time.time())
            logging.warning(f"Authentication failed: Account {username} is locked for {lock_remaining} seconds")
            return False
        
        # Verify password
        is_valid = self._verify_password(password, user.password_hash)
        
        if is_valid:
            # Reset login attempts on success
            user.login_attempts = 0
            user.last_login = datetime.now().isoformat()
            self._save_users(changed=[username])
            logging.info(f"User {username} authenticated successfully")
            return True
        else:
            # Increment failed attempts
            user.login_attempts += 1
            
            # Lock account if too many failed attempts
            if user.login_attempts >= self.max_login_attempts:
                user.locked_until = time.time() + self.lockout_time
                logging.warning(f"Account {username} locked for {self.lockout_time} seconds after "
                               f"{user.login_attempts} failed attempts")
            
            self._save_users(changed=[username])
            logging.warning(f"Authentication failed for user {username}: Invalid password "
                           f"(attempt {user.login_attempts}/{self.max_login_attempts})")
            return False
    
    def create_token(self, username):
        """
        Create an authentication token for a user
        
        Args:
            username (str): Username
            
        Returns:
            str: Authentication token or None if user not found
        """
        if username not in self.users:
            return None
            
        user = self.users[username]
        
        # Clean up expired tokens first
        self._clean_expired_tokens(user)
        
        # Generate a new token
        if JWT_AVAILABLE:
            # Use JWT if available
            expires = datetime.now() + timedelta(hours=TOKEN_EXPIRY_HOURS)
            token_data = {
                'sub': user.id,
                'username': username,
                'admin': user.is_admin,
                'exp': int(expires.timestamp())
            }
            token = jwt.encode(token_data, self.token_secret, algorithm='HS256')
        else:
            # Simple token otherwise
            token = secrets.token_hex(32)
            
        # Store token with expiration
        expiry = time.time() + (TOKEN_EXPIRY_HOURS * 3600)
        user.tokens[token] = expiry
        self._save_users(changed=[username])
        
        logging.info(f"Created token for user {username}, expires in {TOKEN_EXPIRY_HOURS} hours")
        return token
    
    def validate_token(self, token):
        """
        Validate an authentication token
        
        Args:
            token (str): Authentication token
            
        Returns:
            bool: True if token is valid
        """
        if JWT_AVAILABLE:
            try:
                # Decode and verify JWT
                data = jwt.decode(token, self.token_secret, algorithms=['HS256'])
                username = data.get('username')
                
                if username not in self.users:
                    logging.warning(f"Token validation failed: User not found")
                    return False
                    
                # If we got here, token is valid
                return True
            except jwt.ExpiredSignatureError:
                logging.warning(f"Token validation failed: Token expired")
                return False
            except jwt.InvalidTokenError:
                logging.warning(f"Token validation failed: Invalid token")
                return False
        else:
            # Simple token validation
            for username, user in self.users.items():
                if token in user.tokens:
                    expiry = user.tokens[token]
                    if expiry > time.time():
                        # Token is valid
                        return True
                    else:
                        # Token expired
                        self._clean_expired_tokens(user)
                        self._save_users(changed=[username])
                        logging.warning(f"Token validation failed: Token expired")
                        return False
            
            logging.warning(f"Token validation failed: Token not found")
            return False
    
    def validate_session(self):
        """
        Validate the current session
        
        Returns:
            bool: True if session is valid
        """
        if 'user_id' not in session:
            return False
            
        # Check if session has timed out
        last_activity = session.get('last_activity', 0)
        if time.time() - last_activity > self.session_timeout:
            # Session expired
            session.clear()
            logging.warning(f"Session validation failed: Session expired")
            return False
            
        # Update last activity
        session['last_activity'] = time.time()
        return True
    
    def get_user(self, username):
        """
        Get a user by username
        
        Args:
            username (str): Username
            
        Returns:
            User: User object or None if not found
        """
        self._reload_if_changed()
        return self.users.get(username)
        
    def get_users(self):
        """
        Get all users
        
        Returns:
            dict: Dictionary of username to User objects
        """
        self._reload_if_changed()
        return self.users
        
    def add_user(self, username, password, is_admin=False):
        """
        Add a new user
        
        Args:
            username (str): Username
            password (str): Plain text password
            is_admin (bool, optional): Whether user is admin. Defaults to False.
            
        Returns:
            bool: Success status
        """
        return self.create_user(username, password, is_admin)
        
    def remove_user(self, username):
        """
        Remove a user
        
        Args:
            username (str): Username
            
        Returns:
            bool: Success status
        """
        self._reload_if_changed()
        if username not in self.users:
            logging.warning(f"Cannot remove user: User {username} not found")
            return False
            
        # Remove user
        del self.users[username]
        self._save_users(removed=[username])
        logging.info(f"Removed user: {username}")
        return True
    
    def _clean_expired_tokens(self, user):
        """
        Remove expired tokens for a user
        
        Args:
            user (User): User object
        """
        now = time.time()
        user.tokens = {token: exp for token, exp in user.tokens.items() if exp > now}
    
    def _hash_password(self, password, salt):
        """
        Custom password hashing if Werkzeug is not available
        
        Args:
            password (str): Plain text password
            salt (str): Salt
            
        Returns:
            str: Hashed password
        """
        key = hashlib.pbkdf2_hmac(
            'sha256',
            password.encode('utf-8'),
            salt.encode('utf-8'),
            150000
        )
        return base64.b64encode(key).decode('utf-8')
    
    def _verify_password(self, password, stored_hash):
        """
        Verify a password against a hash
        
        Args:
            password (str): Plain text password
            stored_hash (str): Stored password hash
            
        Returns:
            bool: True if password matches
        """
        try:
            from werkzeug.security import check_password_hash
            result = check_password_hash(stored_hash, password)
            return result
        except ImportError as e:
            logging.warning(f"Werkzeug not available for password verification: {e}")
            # Fallback to custom verification
            if not stored_hash.startswith('pbkdf2:sha256:'):
                logging.warning("Password hash format not recognized")
                return False
                
            parts = stored_hash.split('$')
            if len(parts) != 3:
                logging.warning(f"Hash parts incorrect (expected 3, got {len(parts)})")
                return False
                
            salt = parts[1]
            hash_value = parts[2]
            
            calculated_hash = self._hash_password(password, salt)
            result = hash_value == calculated_hash
            return result
        except Exception as e:
            logging.error(f"Unexpected error in password verification: {e}")
            return False