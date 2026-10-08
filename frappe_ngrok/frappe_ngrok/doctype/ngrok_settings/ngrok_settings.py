import io
import json
import os
import platform
import shutil
import signal
import socket
import subprocess
import tarfile
import threading
import time
import urllib.error
import urllib.request
import zipfile

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import add_to_date, get_datetime, get_site_path, now, now_datetime


def get_local_ip() -> str:
	"""Return the primary local network IPv4 address."""
	s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
	try:
		# Does not send traffic; selects the outbound route interface
		s.connect(("10.255.255.255", 1))
		return s.getsockname()[0]
	except Exception:
		return "127.0.0.1"
	finally:
		s.close()


def get_mdns_hostname() -> str:
	"""Return local mDNS system hostname in lowercase e.g. bajrang-latitude-7480.local."""
	hostname = socket.gethostname().strip().lower()
	if not hostname.endswith(".local"):
		return f"{hostname}.local"
	return hostname


def get_current_site_port() -> int:
	"""Retrieve the webserver port configured for this bench/site."""
	port = frappe.conf.get("webserver_port")
	if port:
		return int(port)

	common_config = {}
	try:
		common_path = os.path.join(frappe.get_site_path(), "..", "common_site_config.json")
		if os.path.exists(common_path):
			with open(common_path) as f:
				common_config = json.load(f)
	except Exception:
		pass

	return int(common_config.get("webserver_port") or 8000)


def is_pid_alive(pid: int) -> bool:
	"""Check whether a process with given PID is alive."""
	if not pid or pid <= 0:
		return False
	try:
		os.kill(pid, 0)
		return True
	except OSError:
		return False


def query_ngrok_api(timeout: float = 2.0) -> dict | None:
	"""Query ngrok's local management API for active tunnels."""
	url = "http://127.0.0.1:4040/api/tunnels"
	req = urllib.request.Request(url, headers={"User-Agent": "FrappeNgrok"})
	try:
		with urllib.request.urlopen(req, timeout=timeout) as response:
			if response.status == 200:
				return json.loads(response.read().decode("utf-8"))
	except Exception:
		return None
	return None


def get_tunnel_log_path() -> str:
	"""Get path to the ngrok stdout/stderr log file."""
	log_dir = get_site_path("logs")
	os.makedirs(log_dir, exist_ok=True)
	return os.path.join(log_dir, "ngrok.log")


def find_ngrok_binary(configured_path: str | None = None) -> str | None:
	"""Discover ngrok binary across standard macOS, Linux, and bench paths."""
	if configured_path and os.path.exists(configured_path) and os.access(configured_path, os.X_OK):
		return configured_path

	from_path = shutil.which("ngrok")
	if from_path and os.path.exists(from_path):
		return from_path

	candidates = [
		os.path.join(frappe.get_app_path("frappe_ngrok"), "bin", "ngrok"),
		"/opt/homebrew/bin/ngrok",
		"/usr/local/bin/ngrok",
		"/usr/bin/ngrok",
		"/snap/bin/ngrok",
		os.path.expanduser("~/.local/bin/ngrok"),
		os.path.expanduser("~/bin/ngrok"),
	]

	for path in candidates:
		if os.path.exists(path) and os.access(path, os.X_OK):
			return path

	return None


def get_common_config_path() -> str:
	"""Retrieve path to common_site_config.json."""
	return os.path.abspath(os.path.join(frappe.get_site_path(), "..", "common_site_config.json"))


def ensure_site_alias_symlink(alias_domain: str, target_site: str):
	"""Create a symlink in sites/ so Frappe multi-tenant router recognizes the domain."""
	if not alias_domain or alias_domain == target_site:
		return

	sites_dir = os.path.abspath(os.path.join(frappe.get_site_path(), ".."))
	for domain in {alias_domain, alias_domain.lower()}:
		alias_path = os.path.join(sites_dir, domain)
		if not os.path.exists(alias_path) and not os.path.islink(alias_path):
			try:
				os.symlink(target_site, alias_path)
			except Exception as e:
				frappe.log_error(f"Failed to create site alias symlink {alias_path}: {e}")


def remove_site_alias_symlink(alias_domain: str):
	"""Remove a symlink in sites/ if present (handles case insensitivity)."""
	if not alias_domain:
		return

	sites_dir = os.path.abspath(os.path.join(frappe.get_site_path(), ".."))
	for domain in {alias_domain, alias_domain.lower()}:
		alias_path = os.path.join(sites_dir, domain)
		if os.path.islink(alias_path):
			try:
				os.unlink(alias_path)
			except Exception as e:
				frappe.log_error(f"Failed to remove site alias symlink {alias_path}: {e}")


def sync_symlinks(doc, current_site: str):
	"""Create or remove symlinks based on doc settings."""
	local_domain = doc.get("local_domain")
	system_mdns = get_mdns_hostname()
	local_ip = get_local_ip()

	# 1. Local Domain Symlink
	if doc.get("enable_local_domain_symlink") and local_domain:
		ensure_site_alias_symlink(local_domain, current_site)
	elif local_domain:
		remove_site_alias_symlink(local_domain)

	# 2. System Hostname Symlink
	if doc.get("enable_system_mdns_symlink") and system_mdns:
		ensure_site_alias_symlink(system_mdns, current_site)
	elif system_mdns:
		remove_site_alias_symlink(system_mdns)

	# 3. Direct Local IP Symlink
	if doc.get("enable_local_ip_symlink") and local_ip:
		ensure_site_alias_symlink(local_ip, current_site)
	elif local_ip:
		remove_site_alias_symlink(local_ip)


def sanitize_local_domain(name: str | None, current_site: str) -> str:
	"""Format a user-provided domain to a clean .local name."""
	if not name:
		prefix = current_site.replace(".localhost", "").replace(".", "-")
		return f"{prefix}.local"

	name = name.strip().lower()
	if not name.endswith(".local"):
		name = f"{name}.local"
	return name


def calculate_expiry_datetime(expiry_type: str | None, custom_minutes: int | None = None):
	"""Calculate future datetime when the tunnel should auto-expire."""
	if not expiry_type or expiry_type == "No Expiry":
		return None

	minutes_map = {
		"15 Minutes": 15,
		"30 Minutes": 30,
		"1 Hour": 60,
		"2 Hours": 120,
		"4 Hours": 240,
		"8 Hours": 480,
	}
	minutes = minutes_map.get(expiry_type)
	if not minutes and expiry_type == "Custom Minutes":
		try:
			minutes = int(custom_minutes or 0)
		except (ValueError, TypeError):
			minutes = 0

	if not minutes or minutes <= 0:
		return None

	dt = add_to_date(now_datetime(), minutes=minutes)
	# Strip microseconds so clean timestamps are stored and displayed
	return dt.replace(microsecond=0)


def get_clean_expiry_label(expiry_type: str | None, custom_minutes: int | None = None) -> str:
	"""Format human-readable label for expiry duration."""
	if not expiry_type or expiry_type == "No Expiry":
		return "No Expiry"
	if expiry_type == "Custom Minutes":
		mins = int(custom_minutes or 0)
		return f"{mins} Minutes"
	return expiry_type


def format_clean_datetime(dt) -> str:
	"""Format datetime cleanly as YYYY-MM-DD HH:mm:ss without microseconds."""
	if not dt:
		return ""
	try:
		return get_datetime(dt).strftime("%Y-%m-%d %H:%M:%S")
	except Exception:
		return str(dt).split(".")[0]


# In-process daemon timer for instantaneous background tunnel shutdown
_expiry_timer = None
_timer_lock = threading.Lock()


def schedule_tunnel_auto_stop(site: str, expires_at):
	"""Schedule an in-process daemon timer to stop the tunnel when expires_at is reached."""
	global _expiry_timer
	with _timer_lock:
		if _expiry_timer and _expiry_timer.is_alive():
			_expiry_timer.cancel()
			_expiry_timer = None

		if not expires_at:
			return

		try:
			exp_dt = get_datetime(expires_at)
			now_dt = now_datetime()
			delay = (exp_dt - now_dt).total_seconds()
			if delay <= 0:
				delay = 0.5

			def _worker():
				try:
					import frappe
					if not frappe.local or not getattr(frappe.local, "site", None):
						frappe.init(site=site)
						frappe.connect()
					check_and_expire_tunnel()
				except Exception as e:
					try:
						frappe.log_error(f"Error in background tunnel auto_stop: {e}")
					except Exception:
						pass

			_expiry_timer = threading.Timer(delay, _worker)
			_expiry_timer.daemon = True
			_expiry_timer.start()
		except Exception as e:
			frappe.log_error(f"Failed to schedule tunnel auto stop: {e}")


def cancel_tunnel_auto_stop():
	"""Cancel active auto-stop timer."""
	global _expiry_timer
	with _timer_lock:
		if _expiry_timer and _expiry_timer.is_alive():
			_expiry_timer.cancel()
			_expiry_timer = None


class NgrokSettings(Document):
	def onload(self):
		self.refresh_runtime_values()

	def refresh_runtime_values(self):
		"""Detect and update live URLs, local IP, .local domain, expiry state, and tunnel state."""
		current_site = frappe.local.site or "localhost"
		port = self.site_port or get_current_site_port()
		local_ip = get_local_ip()
		system_mdns = get_mdns_hostname()

		self.site_port = port
		self.local_ip = local_ip
		self.local_network_url = f"http://{local_ip}:{port}"
		self.system_mdns_hostname = system_mdns.lower()
		self.system_mdns_url = f"http://{system_mdns}:{port}".lower()

		if not self.host_header:
			self.host_header = current_site

		# Ensure clean local_domain name
		current_domain = self.get("local_domain")
		if not current_domain or ".sslip.io" in current_domain:
			site_prefix = current_site.replace(".localhost", "").replace(".", "-")
			current_domain = f"{site_prefix}.local"
			self.local_domain = current_domain

		self.local_domain_url = f"http://{self.local_domain}:{port}"

		# Sync symlinks based on enable toggles
		sync_symlinks(self, current_site)

		# Check if this site is currently the default_site
		common_path = get_common_config_path()
		if os.path.exists(common_path):
			try:
				with open(common_path) as f:
					common_cfg = json.load(f)
					self.set_as_default_site = 1 if common_cfg.get("default_site") == current_site else 0
			except Exception:
				pass

		discovered = find_ngrok_binary(self.ngrok_path)
		if discovered:
			self.ngrok_path = discovered
		elif not self.ngrok_path:
			self.ngrok_path = shutil.which("ngrok") or "/usr/local/bin/ngrok"

		# Check mDNS broadcast daemon status
		if self.mdns_pid and not is_pid_alive(self.mdns_pid):
			self.mdns_pid = 0

		# Check live ngrok daemon status
		api_data = query_ngrok_api()
		if api_data and api_data.get("tunnels"):
			tunnels = api_data.get("tunnels", [])
			https_tunnel = next((t for t in tunnels if t.get("proto") == "https"), tunnels[0])
			self.ngrok_url = https_tunnel.get("public_url")
			self.status = "Running"

			# Check if tunnel has expired
			if self.expires_at and now_datetime() >= get_datetime(self.expires_at):
				stop_tunnel()
				self.status = "Stopped"
				self.ngrok_url = ""
				self.expires_at = None
				self.last_error = _("Tunnel automatically closed on expiry.")
		else:
			if self.tunnel_pid and not is_pid_alive(self.tunnel_pid):
				self.tunnel_pid = 0
			if self.status == "Running" and not api_data:
				self.status = "Stopped"
				self.ngrok_url = ""
				self.expires_at = None

	def validate(self):
		current_site = frappe.local.site or "localhost"
		if not self.host_header:
			self.host_header = current_site
		if not self.site_port:
			self.site_port = get_current_site_port()
		if not self.ngrok_path:
			self.ngrok_path = shutil.which("ngrok") or "/usr/local/bin/ngrok"

		# Format local_domain
		if self.local_domain:
			self.local_domain = sanitize_local_domain(self.local_domain, current_site)
		else:
			self.local_domain = sanitize_local_domain(None, current_site)

		port = self.site_port or get_current_site_port()
		self.local_domain_url = f"http://{self.local_domain}:{port}"
		self.system_mdns_hostname = get_mdns_hostname().lower()
		self.system_mdns_url = f"http://{self.system_mdns_hostname}:{port}".lower()

		# Sync symlinks based on toggles
		sync_symlinks(self, current_site)

		# Restart mDNS broadcast if local_domain changed
		if self.has_value_changed("local_domain"):
			self.broadcast_mdns()

		# Recalculate expiry when user modifies expiry_type or custom_expiry_minutes
		if not self.expiry_type or self.expiry_type == "No Expiry":
			self.expires_at = None
			cancel_tunnel_auto_stop()
		elif self.status == "Running":
			old_doc = self.get_doc_before_save()
			old_type = old_doc.expiry_type if old_doc else None
			old_mins = old_doc.custom_expiry_minutes if old_doc else None
			if (
				self.expiry_type != old_type
				or self.custom_expiry_minutes != old_mins
				or not self.expires_at
			):
				self.expires_at = calculate_expiry_datetime(self.expiry_type, self.custom_expiry_minutes)

			if self.expires_at:
				schedule_tunnel_auto_stop(current_site, self.expires_at)
		else:
			self.expires_at = None
			cancel_tunnel_auto_stop()

		# Update bench default site if requested
		if self.has_value_changed("set_as_default_site"):
			common_path = get_common_config_path()
			if os.path.exists(common_path):
				try:
					with open(common_path) as f:
						common_cfg = json.load(f)
					if self.set_as_default_site:
						common_cfg["default_site"] = current_site
						common_cfg["serve_default_site"] = True
					elif common_cfg.get("default_site") == current_site:
						common_cfg["default_site"] = ""
					with open(common_path, "w") as f:
						json.dump(common_cfg, f, indent=1)
				except Exception as e:
					frappe.log_error(f"Failed to update default_site in common_site_config.json: {e}")

		# If user modified the auth_token field in the form, apply it to the ngrok config
		token = self.get_password("auth_token", raise_exception=False)
		if self.has_value_changed("auth_token") and token:
			self.apply_auth_token(token)

	def apply_auth_token(self, token: str):
		"""Configure the ngrok CLI with the provided authtoken."""
		ngrok_bin = self.ngrok_path or shutil.which("ngrok") or "/usr/local/bin/ngrok"
		if not os.path.exists(ngrok_bin):
			frappe.throw(_("Ngrok executable not found at {0}").format(ngrok_bin))

		try:
			res = subprocess.run(
				[ngrok_bin, "config", "add-authtoken", token.strip()],
				check=True,
				capture_output=True,
				text=True,
			)
			frappe.msgprint(_("Ngrok authtoken successfully configured!"), alert=True)
		except subprocess.CalledProcessError as e:
			err = e.stderr or e.stdout
			frappe.throw(_("Failed to update ngrok token: {0}").format(err))

	def broadcast_mdns(self):
		"""Broadcast the custom .local domain over mDNS using avahi-publish on Linux."""
		if platform.system().lower() != "linux":
			return

		avahi_bin = shutil.which("avahi-publish")
		if not avahi_bin:
			return

		domain = self.local_domain
		if not domain or domain == get_mdns_hostname():
			return

		# Stop previous publisher if running
		if self.mdns_pid and is_pid_alive(self.mdns_pid):
			try:
				os.kill(self.mdns_pid, signal.SIGTERM)
			except Exception:
				pass

		local_ip = get_local_ip()
		try:
			proc = subprocess.Popen(
				[avahi_bin, "-a", "-R", domain, local_ip],
				stdout=subprocess.DEVNULL,
				stderr=subprocess.DEVNULL,
				start_new_session=True,
			)
			self.mdns_pid = proc.pid
		except Exception as e:
			frappe.log_error(f"Failed to start avahi-publish for {domain}: {e}")


@frappe.whitelist()
def get_tunnel_status() -> dict:
	"""Fetch live status of local IP, .local domain, ngrok tunnel, and expiry timer without modifying document timestamp."""
	doc = frappe.get_single("Ngrok Settings")
	doc.refresh_runtime_values()

	ngrok_bin = find_ngrok_binary(doc.ngrok_path)

	clean_label = get_clean_expiry_label(doc.expiry_type, doc.custom_expiry_minutes)
	clean_expires = format_clean_datetime(doc.expires_at)

	return {
		"status": doc.status,
		"ngrok_url": doc.ngrok_url or "",
		"local_network_url": doc.local_network_url or "",
		"local_domain_url": doc.local_domain_url or "",
		"local_domain": doc.local_domain or "",
		"system_mdns_hostname": doc.system_mdns_hostname or "",
		"system_mdns_url": doc.system_mdns_url or "",
		"local_ip": doc.local_ip or "",
		"site_port": doc.site_port,
		"tunnel_pid": doc.tunnel_pid,
		"mdns_pid": doc.mdns_pid,
		"started_at": str(doc.started_at or ""),
		"expiry_type": doc.expiry_type or "No Expiry",
		"expiry_label": clean_label,
		"custom_expiry_minutes": doc.custom_expiry_minutes or 0,
		"expires_at": clean_expires,
		"last_error": doc.last_error or "",
		"ngrok_installed": bool(ngrok_bin),
		"ngrok_path": ngrok_bin or doc.ngrok_path or "",
		"os_name": platform.system(),
		"set_as_default_site": doc.set_as_default_site or 0,
		"enable_local_domain_symlink": doc.enable_local_domain_symlink,
		"enable_system_mdns_symlink": doc.enable_system_mdns_symlink,
		"enable_local_ip_symlink": doc.enable_local_ip_symlink,
	}


@frappe.whitelist()
def set_local_domain(domain_name: str) -> dict:
	"""Set and broadcast a custom local domain name (e.g. sbmpl.local)."""
	if not domain_name or not domain_name.strip():
		frappe.throw(_("Domain name cannot be empty."))

	current_site = frappe.local.site or "localhost"
	formatted_domain = sanitize_local_domain(domain_name, current_site)

	doc = frappe.get_single("Ngrok Settings")
	old_domain = doc.local_domain

	# Clean up previous symlink if changing domain
	if old_domain and old_domain != formatted_domain:
		remove_site_alias_symlink(old_domain)

	doc.local_domain = formatted_domain
	doc.refresh_runtime_values()
	doc.broadcast_mdns()
	doc.save(ignore_permissions=True)
	frappe.db.commit()

	return {
		"local_domain": doc.local_domain,
		"local_domain_url": doc.local_domain_url,
		"message": _("Local domain updated to {0}").format(doc.local_domain),
	}


@frappe.whitelist()
def set_tunnel_expiry(expiry_type: str, custom_minutes: int | None = None) -> dict:
	"""Set or update auto-expiry duration for the ngrok tunnel."""
	doc = frappe.get_single("Ngrok Settings")
	current_site = frappe.local.site or "localhost"
	doc.expiry_type = expiry_type or "No Expiry"
	if custom_minutes is not None:
		try:
			doc.custom_expiry_minutes = int(custom_minutes)
		except ValueError:
			doc.custom_expiry_minutes = 0

	if doc.status == "Running":
		if doc.expiry_type != "No Expiry":
			doc.expires_at = calculate_expiry_datetime(doc.expiry_type, doc.custom_expiry_minutes)
			schedule_tunnel_auto_stop(current_site, doc.expires_at)
		else:
			doc.expires_at = None
			cancel_tunnel_auto_stop()
	else:
		doc.expires_at = None
		cancel_tunnel_auto_stop()

	doc.save(ignore_permissions=True)
	frappe.db.commit()

	clean_label = get_clean_expiry_label(doc.expiry_type, doc.custom_expiry_minutes)
	clean_expires = format_clean_datetime(doc.expires_at)

	return {
		"expiry_type": doc.expiry_type,
		"expiry_label": clean_label,
		"custom_expiry_minutes": doc.custom_expiry_minutes,
		"expires_at": clean_expires,
		"message": _("Tunnel timer set to {0}").format(clean_label),
	}


@frappe.whitelist()
def check_and_expire_tunnel():
	"""Scheduled cron task to automatically stop expired ngrok tunnels."""
	try:
		doc = frappe.get_single("Ngrok Settings")
		if doc.status == "Running" and doc.expires_at:
			if now_datetime() >= get_datetime(doc.expires_at):
				stop_tunnel()
				doc = frappe.get_single("Ngrok Settings")
				doc.last_error = _("Tunnel automatically closed on expiry.")
				doc.expires_at = None
				doc.save(ignore_permissions=True)
				frappe.db.commit()
	except Exception as e:
		frappe.log_error(f"Error checking ngrok tunnel expiry: {e}")


@frappe.whitelist()
def start_tunnel(expiry_type: str | None = None, custom_minutes: int | None = None) -> dict:
	"""Start ngrok tunnel for this Frappe site with optional auto-expiry timer."""
	doc = frappe.get_single("Ngrok Settings")
	doc.refresh_runtime_values()

	# Apply expiry timer options if passed
	if expiry_type is not None:
		doc.expiry_type = expiry_type
	if custom_minutes is not None:
		try:
			doc.custom_expiry_minutes = int(custom_minutes)
		except ValueError:
			pass

	# 1. Check if tunnel is already active
	api_data = query_ngrok_api()
	if api_data and api_data.get("tunnels"):
		tunnels = api_data.get("tunnels", [])
		https_tunnel = next((t for t in tunnels if t.get("proto") == "https"), tunnels[0])
		doc.status = "Running"
		doc.ngrok_url = https_tunnel.get("public_url")
		if doc.expiry_type and doc.expiry_type != "No Expiry":
			doc.expires_at = calculate_expiry_datetime(doc.expiry_type, doc.custom_expiry_minutes)
			schedule_tunnel_auto_stop(frappe.local.site or "localhost", doc.expires_at)
		else:
			doc.expires_at = None
			cancel_tunnel_auto_stop()
		doc.save(ignore_permissions=True)
		frappe.db.commit()
		return {
			"status": "Running",
			"ngrok_url": doc.ngrok_url,
			"local_network_url": doc.local_network_url,
			"local_domain_url": doc.local_domain_url,
			"local_ip": doc.local_ip,
			"expiry_type": doc.expiry_type or "No Expiry",
			"expires_at": format_clean_datetime(doc.expires_at),
			"message": _("Ngrok tunnel is already running."),
		}

	# 2. Check binary
	ngrok_bin = find_ngrok_binary(doc.ngrok_path)
	if not ngrok_bin:
		frappe.throw(
			_(
				"Ngrok executable not found. Please click 'Install Ngrok' to install automatically or install via terminal."
			)
		)

	# 3. Ensure authtoken configured if provided
	token = doc.get_password("auth_token", raise_exception=False)
	if token:
		doc.apply_auth_token(token)

	# 4. Prepare parameters
	port = doc.site_port or get_current_site_port()
	host_header = doc.host_header or frappe.local.site or "localhost"

	cmd = [
		ngrok_bin,
		"http",
		str(port),
		f"--host-header={host_header}",
		"--log=stdout",
		"--log-format=term",
	]

	if doc.custom_domain:
		cmd.append(f"--domain={doc.custom_domain.strip()}")

	# 5. Launch process
	log_file_path = get_tunnel_log_path()
	log_file = open(log_file_path, "w")

	try:
		proc = subprocess.Popen(
			cmd,
			stdout=log_file,
			stderr=subprocess.STDOUT,
			start_new_session=True,
		)
	except Exception as e:
		log_file.close()
		frappe.throw(_("Failed to start ngrok process: {0}").format(str(e)))

	# 6. Wait for tunnel to come online via ngrok local API (poll for up to 8s)
	public_url = None
	for attempt in range(16):
		time.sleep(0.5)

		if proc.poll() is not None:
			break

		data = query_ngrok_api(timeout=1.0)
		if data and data.get("tunnels"):
			tunnels = data.get("tunnels", [])
			https_tunnel = next((t for t in tunnels if t.get("proto") == "https"), tunnels[0])
			public_url = https_tunnel.get("public_url")
			if public_url:
				break

	log_file.close()

	if public_url:
		doc.status = "Running"
		doc.ngrok_url = public_url
		doc.tunnel_pid = proc.pid
		doc.started_at = now()
		doc.last_error = ""

		# Calculate expiry timestamp
		if doc.expiry_type and doc.expiry_type != "No Expiry":
			doc.expires_at = calculate_expiry_datetime(doc.expiry_type, doc.custom_expiry_minutes)
			schedule_tunnel_auto_stop(frappe.local.site or "localhost", doc.expires_at)
		else:
			doc.expires_at = None
			cancel_tunnel_auto_stop()

		doc.save(ignore_permissions=True)
		frappe.db.commit()

		return {
			"status": "Running",
			"ngrok_url": public_url,
			"local_network_url": doc.local_network_url,
			"local_domain_url": doc.local_domain_url,
			"local_ip": doc.local_ip,
			"expiry_type": doc.expiry_type or "No Expiry",
			"expires_at": format_clean_datetime(doc.expires_at),
			"message": _("Ngrok tunnel started successfully!"),
		}
	else:
		# Process failed or timed out
		err_text = ""
		try:
			with open(log_file_path) as f:
				err_text = f.read().strip()
		except Exception:
			pass

		if proc.poll() is None:
			try:
				proc.terminate()
			except Exception:
				pass

		doc.status = "Error"
		doc.tunnel_pid = 0
		doc.expires_at = None
		doc.last_error = err_text or _("Tunnel failed to open or authenticate.")
		doc.save(ignore_permissions=True)
		frappe.db.commit()

		frappe.throw(
			_("Could not establish ngrok tunnel. Log output:<br><pre>{0}</pre>").format(
				err_text or _("No output received. Check authtoken and network.")
			)
		)


@frappe.whitelist()
def stop_tunnel() -> dict:
	"""Stop the active ngrok tunnel and clear timer."""
	cancel_tunnel_auto_stop()
	doc = frappe.get_single("Ngrok Settings")

	# Terminate tracked PID if alive
	if doc.tunnel_pid and is_pid_alive(doc.tunnel_pid):
		try:
			os.kill(doc.tunnel_pid, signal.SIGTERM)
			time.sleep(0.5)
			if is_pid_alive(doc.tunnel_pid):
				os.kill(doc.tunnel_pid, signal.SIGKILL)
		except Exception:
			pass

	try:
		subprocess.run(["pkill", "-f", "ngrok http"], capture_output=True)
	except Exception:
		pass

	doc.status = "Stopped"
	doc.ngrok_url = ""
	doc.tunnel_pid = 0
	doc.expires_at = None
	doc.refresh_runtime_values()
	doc.save(ignore_permissions=True)
	frappe.db.commit()

	return {
		"status": "Stopped",
		"message": _("Ngrok tunnel stopped successfully."),
	}


@frappe.whitelist()
def update_ngrok_token(token: str) -> dict:
	"""Update ngrok authtoken from UI prompt."""
	if not token or not token.strip():
		frappe.throw(_("Token cannot be empty."))

	doc = frappe.get_single("Ngrok Settings")
	doc.apply_auth_token(token.strip())
	# Store the token in the Password field; save() encrypts it automatically.
	doc.auth_token = token.strip()
	doc.save(ignore_permissions=True)
	frappe.db.commit()

	return {
		"message": _("Ngrok authtoken updated successfully!"),
	}


@frappe.whitelist()
def auto_install_ngrok() -> dict:
	"""Automatically download and install ngrok binary for the current OS/architecture."""
	system = platform.system().lower()  # 'linux' or 'darwin'
	machine = platform.machine().lower()  # 'x86_64', 'arm64', 'aarch64'

	arch = "amd64" if machine in ("x86_64", "amd64") else "arm64"

	if system == "linux":
		url = f"https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-{arch}.tgz"
		is_zip = False
	elif system == "darwin":
		url = f"https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-darwin-{arch}.zip"
		is_zip = True
	else:
		frappe.throw(_("Automated installation only supports Linux and macOS. Please install ngrok manually."))

	target_dir = os.path.join(frappe.get_app_path("frappe_ngrok"), "bin")
	os.makedirs(target_dir, exist_ok=True)
	target_bin = os.path.join(target_dir, "ngrok")

	try:
		req = urllib.request.Request(url, headers={"User-Agent": "FrappeNgrokInstaller"})
		with urllib.request.urlopen(req, timeout=60) as resp:
			content = resp.read()

		if is_zip:
			with zipfile.ZipFile(io.BytesIO(content)) as z:
				z.extract("ngrok", target_dir)
		else:
			with tarfile.open(fileobj=io.BytesIO(content), mode="r:gz") as t:
				t.extract("ngrok", target_dir)

		os.chmod(target_bin, 0o755)
	except Exception as e:
		frappe.throw(_("Failed to download or extract ngrok: {0}").format(str(e)))

	doc = frappe.get_single("Ngrok Settings")
	doc.ngrok_path = target_bin
	doc.refresh_runtime_values()
	doc.save(ignore_permissions=True)
	frappe.db.commit()

	return {
		"success": True,
		"path": target_bin,
		"message": _("Ngrok successfully installed and configured at {0}!").format(target_bin),
	}


def setup_default_settings():
	"""Initialize default values for Ngrok Settings on install/migrate."""
	try:
		if not frappe.db.exists("DocType", "Ngrok Settings"):
			return

		doc = frappe.get_single("Ngrok Settings")
		if not doc.site_port:
			doc.site_port = get_current_site_port()
		if not doc.host_header:
			doc.host_header = frappe.local.site or "localhost"
		if not doc.ngrok_path:
			doc.ngrok_path = shutil.which("ngrok") or "/usr/local/bin/ngrok"
		if not doc.expiry_type:
			doc.expiry_type = "No Expiry"
		if doc.enable_local_domain_symlink is None:
			doc.enable_local_domain_symlink = 1
		if doc.enable_system_mdns_symlink is None:
			doc.enable_system_mdns_symlink = 0
		if doc.enable_local_ip_symlink is None:
			doc.enable_local_ip_symlink = 0
		doc.refresh_runtime_values()
		doc.save(ignore_permissions=True)

		if frappe.db.exists("DocType", "Desktop Icon") and not frappe.db.exists("Desktop Icon", "Frappe Ngrok"):
			try:
				icon_doc = frappe.new_doc("Desktop Icon")
				icon_doc.label = "Frappe Ngrok"
				icon_doc.app = "frappe_ngrok"
				icon_doc.icon_type = "Link"
				icon_doc.link_type = "External"
				icon_doc.link = "/app/ngrok-settings"
				icon_doc.logo_url = "/assets/frappe_ngrok/logo.svg"
				icon_doc.hidden = 0
				icon_doc.standard = 1
				icon_doc.bg_color = "gray"
				icon_doc.insert(ignore_permissions=True)
			except Exception:
				pass

		frappe.db.commit()
	except Exception:
		frappe.log_error("Failed to setup default Ngrok Settings")
