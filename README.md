# Frappe Ngrok 🌐

Ngrok & Local Network Tunnel Manager for Frappe Framework. Easily expose local sites to your team, mobile devices, and clients without complex reverse proxies or router port-forwarding.

---

### Features

- **🏠 Custom .local Domains**: Access multi-tenant bench sites on your local Wi-Fi network (e.g. `http://sbmpl.local:8002`) with zero hostname collisions.
- **📶 Direct LAN IP Access**: Accessible via `http://<local_ip>:<port>` with optional bench default site routing.
- **🌐 Secure Ngrok Internet Tunnels**: Public HTTPS URLs generated via ngrok CLI with QR code scanning for phone testing.
- **⏱️ Auto-Expiry Timer**: Configurable tunnel lifetimes (15m, 30m, 1h, 2h, or Custom Minutes) with background shutdown.
- **⚡ Independent Symlink Toggles**: Selectively enable or disable multi-tenant routing symlinks (`sites/<local_domain>`, `sites/<hostname>.local`, `sites/<local_ip>`) with automatic cleanup on uncheck.
- **🚀 Automated Ngrok Installation**: One-click download & installation of the official ngrok binary for Linux (amd64/arm64) and macOS without root/sudo privileges.

---

### Installation

You can install this app using the [bench](https://github.com/frappe/bench) CLI:

```bash
cd /path/to/your/bench
bench get-app https://github.com/bajrang8955/frappe-ngrok --branch version-16
bench --site <your-site> install-app frappe_ngrok
bench --site <your-site> migrate
```

---

### Configuration

1. In Frappe Desk, navigate to **Frappe Ngrok** or search for **Ngrok Settings**.
2. Add your ngrok authtoken (if using Ngrok internet tunnels) or click **Install Ngrok Automatically**.
3. Choose your desired access method:
   - **.local Domain (Wi-Fi)**: Recommended for local devices on the same Wi-Fi.
   - **Direct Local IP**: Accessible by entering your LAN IP.
   - **Ngrok Public Tunnel**: Accessible from anywhere in the world.
4. Set an auto-expiry timer if you want the tunnel to automatically shut down after a set duration.

---

### Contributing

This app uses `pre-commit` for code formatting and linting:

```bash
cd apps/frappe_ngrok
pre-commit install
```

---

### License

MIT License. See [license.txt](license.txt) for details.
