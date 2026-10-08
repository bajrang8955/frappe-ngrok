// Copyright (c) 2026, SBMPL and contributors
// For license information, please see license.txt

frappe.ui.form.on("Ngrok Settings", {
	refresh(frm) {
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
	}
});

function setup_custom_buttons(frm) {
	frm.clear_custom_buttons();

	const isRunning = frm.doc.status === "Running";

	if (isRunning) {
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
	const ngrokUrl = doc.ngrok_url || "";
	const localUrl = doc.local_network_url || "";
	const localIp = doc.local_ip || "Unknown";

	const badgeHtml = isRunning
		? `<span class="indicator-pill green" style="font-size: 13px; font-weight: 600; padding: 4px 10px;">🟢 Tunnel Active</span>`
		: doc.status === "Error"
		? `<span class="indicator-pill red" style="font-size: 13px; font-weight: 600; padding: 4px 10px;">🔴 Error</span>`
		: `<span class="indicator-pill gray" style="font-size: 13px; font-weight: 600; padding: 4px 10px;">⚪ Tunnel Stopped</span>`;

	let qrNgrok = "";
	if (isRunning && ngrokUrl) {
		const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(ngrokUrl)}`;
		qrNgrok = `
			<div style="text-align: center; margin-top: 10px;">
				<img src="${qrUrl}" alt="QR Code" style="border-radius: 8px; border: 1px solid var(--border-color); background: #fff; padding: 6px; width: 140px; height: 140px;" />
				<div class="text-muted" style="font-size: 11px; margin-top: 4px;">Scan with Mobile Camera / App</div>
			</div>
		`;
	}

	let qrLocal = "";
	if (localUrl) {
		const qrLocalUrl = `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(localUrl)}`;
		qrLocal = `
			<div style="text-align: center; margin-top: 10px;">
				<img src="${qrLocalUrl}" alt="Local QR Code" style="border-radius: 8px; border: 1px solid var(--border-color); background: #fff; padding: 6px; width: 140px; height: 140px;" />
				<div class="text-muted" style="font-size: 11px; margin-top: 4px;">Scan to open on local Wi-Fi</div>
			</div>
		`;
	}

	const html = `
		<div style="background: var(--card-bg, #ffffff); border: 1px solid var(--border-color, #e2e8f0); border-radius: 10px; padding: 18px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
			<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
				<div>
					<h4 style="margin: 0; font-size: 16px; font-weight: 700; color: var(--text-color);">Frappe Mobile &amp; Remote Access Control</h4>
					<p class="text-muted" style="margin: 2px 0 0 0; font-size: 12px;">Test your Frappe/ERPNext apps on mobile devices over the Internet (ngrok) or Local Wi-Fi</p>
				</div>
				<div>${badgeHtml}</div>
			</div>

			<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px;">
				<!-- Ngrok Card -->
				<div style="background: var(--bg-light-gray, #f8fafc); border: 1px solid var(--border-color, #e2e8f0); border-radius: 8px; padding: 16px; display: flex; flex-direction: column; justify-content: space-between;">
					<div>
						<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
							<span style="font-size: 18px;">🌐</span>
							<strong style="font-size: 14px;">Public Ngrok URL (Anywhere)</strong>
						</div>
						${
							isRunning && ngrokUrl
								? `
							<div style="background: var(--control-bg, #ffffff); border: 1px dashed var(--border-color); border-radius: 6px; padding: 10px; margin-bottom: 10px; word-break: break-all; font-family: monospace; font-size: 13px; font-weight: 600; color: var(--primary-color, #2563eb);">
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
							<div class="text-muted" style="font-size: 11px; margin-top: 10px; background: rgba(37,99,235,0.06); padding: 6px 10px; border-radius: 4px;">
								💡 <strong>Tip for Mobile App:</strong> Enter this URL in your Frappe / ERPNext mobile app. If visiting via mobile browser, tap "Visit Site" on the ngrok prompt.
							</div>
						`
								: `
							<div class="text-muted" style="padding: 18px 0; text-align: center; font-size: 13px;">
								Tunnel is currently stopped.<br>Click <strong>Start Tunnel</strong> above to generate a public HTTPS URL.
							</div>
						`
						}
					</div>
				</div>

				<!-- Local Network Card -->
				<div style="background: var(--bg-light-gray, #f8fafc); border: 1px solid var(--border-color, #e2e8f0); border-radius: 8px; padding: 16px; display: flex; flex-direction: column; justify-content: space-between;">
					<div>
						<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
							<span style="font-size: 18px;">📶</span>
							<strong style="font-size: 14px;">Local Network URL (Same Wi-Fi)</strong>
						</div>
						<div style="background: var(--control-bg, #ffffff); border: 1px dashed var(--border-color); border-radius: 6px; padding: 10px; margin-bottom: 10px; word-break: break-all; font-family: monospace; font-size: 13px; font-weight: 600;">
							${localUrl || "Detecting..."}
						</div>
						<div style="display: flex; gap: 8px;">
							<button class="btn btn-xs btn-default" onclick="frappe.utils.copy_to_clipboard('${localUrl}'); frappe.show_alert(__('Copied Local URL!'), 3);">
								📋 Copy URL
							</button>
							<button class="btn btn-xs btn-default" onclick="window.open('${localUrl}', '_blank');">
								🚀 Open in Browser
							</button>
						</div>
						${qrLocal}
						<div class="text-muted" style="font-size: 11px; margin-top: 10px; background: rgba(0,0,0,0.03); padding: 6px 10px; border-radius: 4px;">
							📱 <strong>Local IP:</strong> <code>${localIp}</code> (Port <code>${doc.site_port || 8002}</code>). Any phone or laptop on your same Wi-Fi router can open this URL!
						</div>
					</div>
				</div>
			</div>
		</div>
	`;

	frm.set_df_property("status_card", "options", html);
	frm.refresh_field("status_card");
}
