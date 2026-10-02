"""
Authentication module for Annzarro Server
-----------------------------------------
Provides user authentication for login sessions.
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
        self.last_login = None
        self.login_attempts = 0
        self.locked_until = None
        # Failed logins per client address: {ip: [count, locked_until, last_failure]}
        self.failed_logins = {}
        # When the password last changed; logins from before it are void
        self.password_changed_at = None
    
    def to_dict(self):
        """Convert user to dictionary for storage"""
        return {
            'id': self.id,
            'username': self.username,
            'password_hash': self.password_hash,
            'is_admin': self.is_admin,
            'last_login': self.last_login,
            'login_attempts': self.login_attempts,
            'locked_until': self.locked_until,
            'failed_logins': self.failed_logins,
            'password_changed_at': self.password_changed_at
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
        user.last_login = data.get('last_login')
        user.login_attempts = data.get('login_attempts', 0)
        user.locked_until = data.get('locked_until')
        user.password_changed_at = data.get('password_changed_at')
        user.failed_logins = data.get('failed_logins') or {}
        return user

def resolve_user_file(user_file):
    """Absolute path of the users file; relative paths are taken from the package root."""
    if os.path.isabs(user_file):
        return user_file
    package_root = Path(__file__).resolve().parent.parent.parent
    return os.path.join(package_root, user_file)


class AuthManager:
    """Authentication manager for Annzarro"""
    
    def __init__(self, user_file='users.json', session_timeout=3600,
                 max_login_attempts=5, lockout_time=900):
        """
        Initialize authentication manager
        
        Args:
            user_file (str, optional): Path to user credentials file. Defaults to 'users.json'.
            session_timeout (int, optional): Session timeout in seconds. Defaults to 3600.
            max_login_attempts (int, optional): Max failed login attempts before lockout. Defaults to 5.
            lockout_time (int, optional): Account lockout time in seconds. Defaults to 900.
        """
        # Handle relative paths by making them absolute from package root
        self.user_file = resolve_user_file(user_file)
            
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
            
        # Create user
        self.users[username] = User(username, self._new_hash(password), is_admin)
        self._save_users(created=[username])
        logging.info(f"Created user: {username} (admin: {is_admin})")
        return True
    
    def authenticate(self, username, password, client_ip=None):
        """
        Authenticate a user with username and password

        Failed attempts are counted per (user, client address): after
        ``max_login_attempts`` failures from one address, that address is
        locked out of that account for ``lockout_time`` seconds. Counting per
        user alone let anyone who knew a user name lock its owner out by
        failing on purpose; now they only lock themselves out.
        
        Args:
            username (str): Username
            password (str): Password
            client_ip (str, optional): The client's address (``None`` for
                callers without one, e.g. the CLI)
            
        Returns:
            bool: Authentication success
        """
        logging.info(f"Authentication attempt for user: {username}")
        
        self._reload_if_changed()
        if username not in self.users:
            logging.warning(f"Authentication failed: User {username} not found")
            return False
            
        user = self.users[username]
        source = client_ip or "unknown"
        now = time.time()
        # Forget lockouts that ran out and failures older than lockout_time,
        # so the record does not grow without bound
        def live(rec):
            count, locked_until, last = (list(rec) + [None, None, None])[:3]
            if locked_until:
                return float(locked_until) > now
            return last is not None and now - float(last) < self.lockout_time
        user.failed_logins = {ip: rec for ip, rec in user.failed_logins.items() if live(rec)}
        count, locked_until = (list(user.failed_logins.get(source, [0, None])) + [None])[:2]
        
        # Check if this address is locked out of the account
        if locked_until and float(locked_until) > now:
            lock_remaining = int(float(locked_until) - now)
            logging.warning(f"Authentication failed: {username} is locked for {source} "
                            f"for {lock_remaining} seconds")
            return False
        
        # Verify password
        is_valid = self._verify_password(password, user.password_hash)
        
        if is_valid:
            # Reset this address's failures on success
            user.failed_logins.pop(source, None)
            user.last_login = datetime.now().isoformat()
            self._save_users(changed=[username])
            logging.info(f"User {username} authenticated successfully")
            return True
        else:
            count = (count or 0) + 1
            locked_until = None
            if count >= self.max_login_attempts:
                locked_until = now + self.lockout_time
                logging.warning(f"Account {username} locked for {source} for {self.lockout_time} "
                                f"seconds after {count} failed attempts")
            user.failed_logins[source] = [count, locked_until, now]
            self._save_users(changed=[username])
            logging.warning(f"Authentication failed for user {username} from {source}: Invalid password "
                           f"(attempt {count}/{self.max_login_attempts})")
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
        
    def _new_hash(self, password):
        """Hash a new password (Werkzeug's default method, else PBKDF2)."""
        try:
            from werkzeug.security import generate_password_hash
            return generate_password_hash(password)
        except ImportError:
            salt = secrets.token_hex(8)
            return f"pbkdf2:sha256:150000${salt}${self._hash_password(password, salt)}"

    def set_password(self, username, password):
        """Replace a user's password in place.

        Clears a lockout and failed attempts, and records the time so that
        logins made with the old password stop working (see
        ``session_is_current``).

        Returns:
            bool: False if the user does not exist
        """
        self._reload_if_changed()
        user = self.users.get(username)
        if user is None:
            logging.warning(f"Cannot change password: User {username} not found")
            return False
        user.password_hash = self._new_hash(password)
        user.login_attempts = 0
        user.locked_until = None
        user.failed_logins = {}
        user.password_changed_at = time.time()
        self._save_users(changed=[username])
        logging.info(f"Changed password of user: {username}")
        return True

    def set_admin(self, username, is_admin):
        """Grant or revoke admin in place. Returns False if the user does not exist."""
        self._reload_if_changed()
        user = self.users.get(username)
        if user is None:
            logging.warning(f"Cannot change admin flag: User {username} not found")
            return False
        user.is_admin = bool(is_admin)
        self._save_users(changed=[username])
        logging.info(f"User {username} admin: {user.is_admin}")
        return True

    def session_is_current(self, username, logged_in_at):
        """Whether a login of ``username`` made at ``logged_in_at`` still counts:
        the user exists and has not changed password since."""
        user = self.get_user(username)
        if user is None:
            return False
        changed = user.password_changed_at
        if changed is None:
            return True
        try:
            return float(logged_in_at) >= float(changed)
        except (TypeError, ValueError):
            return False

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