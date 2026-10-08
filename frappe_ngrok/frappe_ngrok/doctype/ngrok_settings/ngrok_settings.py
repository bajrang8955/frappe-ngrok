# Copyright (c) 2026, SBMPL and contributors
# For license information, please see license.txt

import json
import os
import shutil
import signal
import socket
import subprocess
import time
import urllib.error
import urllib.request

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import get_site_path, now


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


class NgrokSettings(Document):
	def onload(self):
		self.refresh_runtime_values()

	def refresh_runtime_values(self):
		"""Detect and update live URLs, local IP, and tunnel state."""
		local_ip = get_local_ip()
		port = self.site_port or get_current_site_port()
		self.local_ip = local_ip
		self.local_network_url = f"http://{local_ip}:{port}"

		if not self.host_header:
			self.host_header = frappe.local.site or "localhost"

		if not self.site_port:
			self.site_port = port

		if not self.ngrok_path:
			self.ngrok_path = shutil.which("ngrok") or "/usr/local/bin/ngrok"

		# Check live ngrok daemon status
		api_data = query_ngrok_api()
		if api_data and api_data.get("tunnels"):
			tunnels = api_data.get("tunnels", [])
			# Prefer HTTPS tunnel
			https_tunnel = next((t for t in tunnels if t.get("proto") == "https"), tunnels[0])
			self.ngrok_url = https_tunnel.get("public_url")
			self.status = "Running"
		else:
			if self.tunnel_pid and not is_pid_alive(self.tunnel_pid):
				self.tunnel_pid = 0
			if self.status == "Running" and not api_data:
				self.status = "Stopped"
				self.ngrok_url = ""

	def validate(self):
		if not self.host_header:
			self.host_header = frappe.local.site or "localhost"
		if not self.site_port:
			self.site_port = get_current_site_port()
		if not self.ngrok_path:
			self.ngrok_path = shutil.which("ngrok") or "/usr/local/bin/ngrok"

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


@frappe.whitelist()
def get_tunnel_status() -> dict:
	"""Fetch live status of the ngrok tunnel and local network info."""
	doc = frappe.get_single("Ngrok Settings")
	doc.refresh_runtime_values()
	doc.save(ignore_permissions=True)
	frappe.db.commit()

	return {
		"status": doc.status,
		"ngrok_url": doc.ngrok_url or "",
		"local_network_url": doc.local_network_url or "",
		"local_ip": doc.local_ip or "",
		"site_port": doc.site_port,
		"tunnel_pid": doc.tunnel_pid,
		"started_at": str(doc.started_at or ""),
		"last_error": doc.last_error or "",
	}


@frappe.whitelist()
def start_tunnel() -> dict:
	"""Start ngrok tunnel for this Frappe site."""
	doc = frappe.get_single("Ngrok Settings")
	doc.refresh_runtime_values()

	# 1. Check if tunnel is already active
	api_data = query_ngrok_api()
	if api_data and api_data.get("tunnels"):
		tunnels = api_data.get("tunnels", [])
		https_tunnel = next((t for t in tunnels if t.get("proto") == "https"), tunnels[0])
		doc.status = "Running"
		doc.ngrok_url = https_tunnel.get("public_url")
		doc.save(ignore_permissions=True)
		frappe.db.commit()
		return {
			"status": "Running",
			"ngrok_url": doc.ngrok_url,
			"local_network_url": doc.local_network_url,
			"local_ip": doc.local_ip,
			"message": _("Ngrok tunnel is already running."),
		}

	# 2. Check binary
	ngrok_bin = doc.ngrok_path or shutil.which("ngrok") or "/usr/local/bin/ngrok"
	if not os.path.exists(ngrok_bin):
		frappe.throw(_("Ngrok executable not found at '{0}'. Please install ngrok or check path.").format(ngrok_bin))

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

		# Check if process terminated early
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
		doc.save(ignore_permissions=True)
		frappe.db.commit()

		return {
			"status": "Running",
			"ngrok_url": public_url,
			"local_network_url": doc.local_network_url,
			"local_ip": doc.local_ip,
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

		# Clean up dead process if still hanging
		if proc.poll() is None:
			try:
				proc.terminate()
			except Exception:
				pass

		doc.status = "Error"
		doc.tunnel_pid = 0
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
	"""Stop the active ngrok tunnel."""
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

	# Also attempt to gracefully kill any local ngrok process
	try:
		subprocess.run(["pkill", "-f", "ngrok http"], capture_output=True)
	except Exception:
		pass

	doc.status = "Stopped"
	doc.ngrok_url = ""
	doc.tunnel_pid = 0
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
	doc.set_password("auth_token", token.strip())
	doc.save(ignore_permissions=True)
	frappe.db.commit()

	return {
		"message": _("Ngrok authtoken updated successfully!"),
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
		doc.refresh_runtime_values()
		doc.save(ignore_permissions=True)
		frappe.db.commit()
	except Exception:
		frappe.log_error("Failed to setup default Ngrok Settings")
