// Copyright (c) 2026, SBMPL and contributors
// For license information, please see license.txt

frappe.ui.form.on("Ngrok Settings", {
	refresh(frm) {
		frappe.call({
			method: "frappe_ngrok.frappe_ngrok.doctype.ngrok_settings.ngrok_settings.get_tunnel_status",
			callback: function (r) {
				if (r.message) {
					frm.doc.__ngrok_installed = r.message.ngrok_installed;
					frm.doc.__os_name = r.message.os_name;
					render_status_card(frm);
					setup_custom_buttons(frm);
				}
			}
		});
		render_status_card(frm);
		setup_custom_buttons(frm);
	},

	status(frm) {
		render_status_card(frm);
		setup_custom_buttons(frm);
	},

	ngrok_url(frm) {
		render_status_card(frm);
	},

	local_network_url(frm) {
		render_status_card(frm);
	},

	local_domain_url(frm) {
		render_status_card(frm);
	}
});

function setup_custom_buttons(frm) {
	frm.clear_custom_buttons();

	const isInstalled = frm.doc.__ngrok_installed !== false;
	const isRunning = frm.doc.status === "Running";

	if (!isInstalled) {
		frm.add_custom_button(__("Install Ngrok Automatically"), () => {
			trigger_auto_install(frm);
		}).addClass("btn-primary");
	} else if (isRunning) {
		frm.add_custom_button(__("Stop Tunnel"), () => {
			frappe.confirm(__("Are you sure you want to stop the ngrok tunnel?"), () => {
				frappe.call({
					method: "frappe_ngrok.frappe_ngrok.doctype.ngrok_settings.ngrok_settings.stop_tunnel",
					freeze: true,
					freeze_message: __("Stopping Ngrok Tunnel..."),
					callback: function (r) {
						if (!r.exc) {
							frappe.show_alert({
								message: __("Ngrok tunnel stopped"),
								indicator: "orange"
							});
							frm.reload_doc();
						}
					}
				});
			});
		}).addClass("btn-danger");

		if (frm.doc.ngrok_url) {
			frm.add_custom_button(__("Open Ngrok URL"), () => {
				window.open(frm.doc.ngrok_url, "_blank");
			});
		}
	} else {
		frm.add_custom_button(__("Start Tunnel"), () => {
			frappe.call({
				method: "frappe_ngrok.frappe_ngrok.doctype.ngrok_settings.ngrok_settings.start_tunnel",
				freeze: true,
				freeze_message: __("Starting Ngrok Tunnel..."),
				callback: function (r) {
					if (!r.exc) {
						frappe.show_alert({
							message: __("Ngrok tunnel started!"),
							indicator: "green"
						});
						frm.reload_doc();
					}
				}
			});
		}).addClass("btn-primary");
	}

	// Utility Actions
	frm.add_custom_button(__("Refresh Status"), () => {
		frappe.call({
			method: "frappe_ngrok.frappe_ngrok.doctype.ngrok_settings.ngrok_settings.get_tunnel_status",
			freeze: true,
			freeze_message: __("Checking Tunnel Status..."),
			callback: function (r) {
				if (!r.exc) {
					if (r.message) {
						frm.doc.__ngrok_installed = r.message.ngrok_installed;
						frm.doc.__os_name = r.message.os_name;
					}
					frappe.show_alert({
						message: __("Status refreshed"),
						indicator: "blue"
					});
					frm.reload_doc();
				}
			}
		});
	});

	frm.add_custom_button(__("Update Ngrok Token"), () => {
		show_update_token_dialog(frm);
	});
}

function trigger_auto_install(frm) {
	frappe.call({
		method: "frappe_ngrok.frappe_ngrok.doctype.ngrok_settings.ngrok_settings.auto_install_ngrok",
		freeze: true,
		freeze_message: __("Downloading & Installing Ngrok for your OS..."),
		callback: function (r) {
			if (!r.exc && r.message) {
				frappe.msgprint({
					title: __("Ngrok Installed"),
					indicator: "green",
					message: r.message.message || __("Ngrok installed successfully!")
				});
				frm.reload_doc();
			}
		}
	});
}

function show_update_token_dialog(frm) {
	let d = new frappe.ui.Dialog({
		title: __("Configure Ngrok Authtoken"),
		fields: [
			{
				label: __("Ngrok Authtoken"),
				fieldname: "token",
				fieldtype: "Password",
				reqd: 1,
				description: __(
					"Copy your authtoken from your <a href='https://dashboard.ngrok.com/get-started/your-authtoken' target='_blank'>Ngrok Dashboard</a>."
				)
			}
		],
		primary_action_label: __("Save Token"),
		primary_action(values) {
			d.hide();
			frappe.call({
				method: "frappe_ngrok.frappe_ngrok.doctype.ngrok_settings.ngrok_settings.update_ngrok_token",
				args: {
					token: values.token
				},
				freeze: true,
				freeze_message: __("Saving token in ngrok..."),
				callback: function (r) {
					if (!r.exc) {
						frappe.show_alert({
							message: __("Authtoken updated successfully!"),
							indicator: "green"
						});
						frm.reload_doc();
					}
				}
			});
		}
	});
	d.show();
}

function render_status_card(frm) {
	const doc = frm.doc;
	const isRunning = doc.status === "Running";
	const isInstalled = doc.__ngrok_installed !== false;
	const osName = doc.__os_name || "Linux / macOS";
	const ngrokUrl = doc.ngrok_url || "";
	const localDomainUrl = doc.local_domain_url || "";
	const localUrl = doc.local_network_url || "";
	const localIp = doc.local_ip || "Unknown";
	const isDefaultSite = doc.set_as_default_site ? true : false;

	const badgeHtml = isRunning
		? `<span class="indicator-pill green" style="font-size: 13px; font-weight: 600; padding: 4px 10px;">🟢 Tunnel Active</span>`
		: doc.status === "Error"
		? `<span class="indicator-pill red" style="font-size: 13px; font-weight: 600; padding: 4px 10px;">🔴 Error</span>`
		: `<span class="indicator-pill gray" style="font-size: 13px; font-weight: 600; padding: 4px 10px;">⚪ Tunnel Stopped</span>`;

	let installNotice = "";
	if (!isInstalled) {
		installNotice = `
			<div style="background: #fffbeb; border: 1px solid #fef3c7; border-left: 4px solid #f59e0b; border-radius: 6px; padding: 14px; margin-bottom: 16px;">
				<div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
					<div>
						<strong style="color: #92400e; font-size: 14px;">⚠️ Ngrok is not detected on this system (${osName})</strong>
						<p style="margin: 4px 0 0 0; font-size: 12px; color: #b45309;">
							Click the button to download and configure ngrok automatically without terminal access, or run:
							<br><strong>macOS:</strong> <code>brew install ngrok</code> | <strong>Ubuntu/Debian:</strong> <code>sudo snap install ngrok</code>
						</p>
					</div>
					<button class="btn btn-sm btn-primary" onclick="cur_frm.cscript.trigger_auto_install ? cur_frm.cscript.trigger_auto_install() : frappe.call({method: 'frappe_ngrok.frappe_ngrok.doctype.ngrok_settings.ngrok_settings.auto_install_ngrok', freeze: true, freeze_message: 'Installing Ngrok...', callback: () => cur_frm.reload_doc()});">
						🚀 Install Ngrok Automatically
					</button>
				</div>
			</div>
		`;
	}

	let qrNgrok = "";
	if (isRunning && ngrokUrl) {
		const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=130x130&data=${encodeURIComponent(ngrokUrl)}`;
		qrNgrok = `
			<div style="text-align: center; margin-top: 10px;">
				<img src="${qrUrl}" alt="QR Code" style="border-radius: 8px; border: 1px solid var(--border-color); background: #fff; padding: 5px; width: 130px; height: 130px;" />
				<div class="text-muted" style="font-size: 11px; margin-top: 4px;">Scan with Mobile Camera / App</div>
			</div>
		`;
	}

	let qrMultiSite = "";
	if (localDomainUrl) {
		const qrMultiSiteUrl = `https://api.qrserver.com/v1/create-qr-code/?size=130x130&data=${encodeURIComponent(localDomainUrl)}`;
		qrMultiSite = `
			<div style="text-align: center; margin-top: 10px;">
				<img src="${qrMultiSiteUrl}" alt="Multi-Site QR Code" style="border-radius: 8px; border: 1px solid var(--border-color); background: #fff; padding: 5px; width: 130px; height: 130px;" />
				<div class="text-muted" style="font-size: 11px; margin-top: 4px;">Scan to open on Wi-Fi (Multi-Site)</div>
			</div>
		`;
	}

	const html = `
		<div style="background: var(--card-bg, #ffffff); border: 1px solid var(--border-color, #e2e8f0); border-radius: 10px; padding: 18px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
			${installNotice}

			<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
				<div>
					<h4 style="margin: 0; font-size: 16px; font-weight: 700; color: var(--text-color);">Frappe Mobile &amp; Remote Access Control</h4>
					<p class="text-muted" style="margin: 2px 0 0 0; font-size: 12px;">Access your specific Frappe site across the Internet (ngrok) or Local Network (multi-site supported)</p>
				</div>
				<div>${badgeHtml}</div>
			</div>

			<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px;">
				<!-- Card 1: Multi-Site Local Domain (Wi-Fi) -->
				<div style="background: var(--bg-light-gray, #f8fafc); border: 1px solid #93c5fd; border-radius: 8px; padding: 16px; display: flex; flex-direction: column; justify-content: space-between;">
					<div>
						<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
							<div style="display: flex; align-items: center; gap: 8px;">
								<span style="font-size: 18px;">🏠</span>
								<strong style="font-size: 14px;">Local Multi-Site URL (Wi-Fi)</strong>
							</div>
							<span class="badge" style="background: #dbeafe; color: #1e40af; font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px;">✨ Multi-Site Supported</span>
						</div>
						<div style="background: var(--control-bg, #ffffff); border: 1px solid #bfdbfe; border-radius: 6px; padding: 10px; margin-bottom: 10px; word-break: break-all; font-family: monospace; font-size: 12.5px; font-weight: 600; color: #1d4ed8;">
							${localDomainUrl || "Configuring..."}
						</div>
						<div style="display: flex; gap: 8px;">
							<button class="btn btn-xs btn-default" onclick="frappe.utils.copy_to_clipboard('${localDomainUrl}'); frappe.show_alert(__('Copied Local Multi-Site URL!'), 3);">
								📋 Copy URL
							</button>
							<button class="btn btn-xs btn-default" onclick="window.open('${localDomainUrl}', '_blank');">
								🚀 Open in Browser
							</button>
						</div>
						${qrMultiSite}
						<div class="text-muted" style="font-size: 11px; margin-top: 10px; background: rgba(37,99,235,0.06); padding: 8px 10px; border-radius: 4px; line-height: 1.4;">
							💡 <strong>Why this works for multiple sites:</strong> Uses wildcard DNS (<code>sslip.io</code>) to resolve to your local IP (<code>${localIp}</code>) while sending the exact site name header to Frappe so other bench sites don't conflict!
						</div>
					</div>
				</div>

				<!-- Card 2: Ngrok Public Tunnel (Internet) -->
				<div style="background: var(--bg-light-gray, #f8fafc); border: 1px solid var(--border-color, #e2e8f0); border-radius: 8px; padding: 16px; display: flex; flex-direction: column; justify-content: space-between;">
					<div>
						<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
							<span style="font-size: 18px;">🌐</span>
							<strong style="font-size: 14px;">Public Ngrok URL (Anywhere)</strong>
						</div>
						${
							isRunning && ngrokUrl
								? `
							<div style="background: var(--control-bg, #ffffff); border: 1px dashed var(--border-color); border-radius: 6px; padding: 10px; margin-bottom: 10px; word-break: break-all; font-family: monospace; font-size: 12.5px; font-weight: 600; color: var(--primary-color, #2563eb);">
								${ngrokUrl}
							</div>
							<div style="display: flex; gap: 8px;">
								<button class="btn btn-xs btn-default copy-ngrok-btn" onclick="frappe.utils.copy_to_clipboard('${ngrokUrl}'); frappe.show_alert(__('Copied Ngrok URL!'), 3);">
									📋 Copy URL
								</button>
								<button class="btn btn-xs btn-default" onclick="window.open('${ngrokUrl}', '_blank');">
									🚀 Open in Browser
								</button>
							</div>
							${qrNgrok}
							<div class="text-muted" style="font-size: 11px; margin-top: 10px; background: rgba(0,0,0,0.03); padding: 8px 10px; border-radius: 4px; line-height: 1.4;">
								📱 <strong>Mobile App (Internet):</strong> Enter this URL into your Frappe/ERPNext mobile app. If visiting via mobile browser, tap "Visit Site" on the ngrok prompt.
							</div>
						`
								: `
							<div class="text-muted" style="padding: 24px 0; text-align: center; font-size: 13px;">
								Tunnel is currently stopped.<br>Click <strong>Start Tunnel</strong> above to generate a public HTTPS URL.
							</div>
						`
						}
					</div>
				</div>

				<!-- Card 3: Direct IP Access (Default Site) -->
				<div style="background: var(--bg-light-gray, #f8fafc); border: 1px solid var(--border-color, #e2e8f0); border-radius: 8px; padding: 16px; display: flex; flex-direction: column; justify-content: space-between;">
					<div>
						<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
							<div style="display: flex; align-items: center; gap: 8px;">
								<span style="font-size: 18px;">📶</span>
								<strong style="font-size: 14px;">Direct Local IP</strong>
							</div>
							<span class="badge" style="background: ${isDefaultSite ? "#dcfce7" : "#f1f5f9"}; color: ${isDefaultSite ? "#15803d" : "#64748b"}; font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px;">
								${isDefaultSite ? "Default Site: Active" : "Default Site: Off"}
							</span>
						</div>
						<div style="background: var(--control-bg, #ffffff); border: 1px dashed var(--border-color); border-radius: 6px; padding: 10px; margin-bottom: 10px; word-break: break-all; font-family: monospace; font-size: 12.5px; font-weight: 600;">
							${localUrl || "Detecting..."}
						</div>
						<div style="display: flex; gap: 8px;">
							<button class="btn btn-xs btn-default" onclick="frappe.utils.copy_to_clipboard('${localUrl}'); frappe.show_alert(__('Copied Direct IP URL!'), 3);">
								📋 Copy URL
							</button>
							<button class="btn btn-xs btn-default" onclick="window.open('${localUrl}', '_blank');">
								🚀 Open in Browser
							</button>
						</div>
						<div class="text-muted" style="font-size: 11px; margin-top: 14px; background: rgba(0,0,0,0.03); padding: 8px 10px; border-radius: 4px; line-height: 1.4;">
							ℹ️ <strong>Direct IP note:</strong> Raw IP requests have no site domain header. If you have multiple sites, check <em>"Set As Bench Default Site"</em> below to route raw IP to this site, or use the <strong>Multi-Site URL</strong> above.
						</div>
					</div>
				</div>
			</div>
		</div>
	`;

	frm.set_df_property("status_card", "options", html);
	frm.refresh_field("status_card");
}
