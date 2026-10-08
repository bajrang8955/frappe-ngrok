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

	expires_at(frm) {
		render_status_card(frm);
	},

	expiry_type(frm) {
		render_status_card(frm);
	},

	ngrok_url(frm) {
		render_status_card(frm);
	},

	local_network_url(frm) {
		render_status_card(frm);
	},

	local_domain(frm) {
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

	// 1. Ngrok Start/Stop buttons
	if (!isInstalled) {
		frm.add_custom_button(__("Install Ngrok Automatically"), () => {
			trigger_auto_install(frm);
		}).addClass("btn-primary");
	} else if (isRunning) {
		frm.add_custom_button(__("Stop Ngrok Tunnel"), () => {
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
		frm.add_custom_button(__("Start Ngrok Tunnel"), () => {
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

	// 2. Set Expiry Timer Button
	frm.add_custom_button(__("Set Expiry Timer"), () => {
		show_set_expiry_dialog(frm);
	});

	// 3. Set Local Domain Name Button
	frm.add_custom_button(__("Change Local Domain Name"), () => {
		show_change_domain_dialog(frm);
	});

	// 4. Update Ngrok Authtoken Button
	frm.add_custom_button(__("Update Ngrok Token"), () => {
		show_update_token_dialog(frm);
	});

	// 5. Refresh Status Button
	frm.add_custom_button(__("Refresh Status"), () => {
		frappe.call({
			method: "frappe_ngrok.frappe_ngrok.doctype.ngrok_settings.ngrok_settings.get_tunnel_status",
			freeze: true,
			freeze_message: __("Refreshing Access Status..."),
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
}

function show_set_expiry_dialog(frm) {
	frm = frm || cur_frm;
	let currentType = (frm && frm.doc && frm.doc.expiry_type) || "No Expiry";
	let currentCustom = (frm && frm.doc && frm.doc.custom_expiry_minutes) || 30;

	let d = new frappe.ui.Dialog({
		title: __("Set Ngrok Tunnel Expiry Timer"),
		fields: [
			{
				label: __("Expiry Duration"),
				fieldname: "expiry_type",
				fieldtype: "Select",
				options: [
					"No Expiry",
					"15 Minutes",
					"30 Minutes",
					"1 Hour",
					"2 Hours",
					"4 Hours",
					"8 Hours",
					"Custom Minutes"
				],
				default: currentType,
				description: __(
					"Select 'No Expiry' to keep tunnel alive continuously, or choose a timer to auto-stop it."
				),
				change() {
					let val = d.get_value("expiry_type");
					d.set_df_property("custom_expiry_minutes", "hidden", val !== "Custom Minutes");
				}
			},
			{
				label: __("Custom Minutes"),
				fieldname: "custom_expiry_minutes",
				fieldtype: "Int",
				default: currentCustom,
				hidden: currentType !== "Custom Minutes",
				description: __("Duration in minutes (e.g. 45)")
			}
		],
		primary_action_label: __("Save Timer"),
		primary_action(values) {
			d.hide();
			frappe.call({
				method: "frappe_ngrok.frappe_ngrok.doctype.ngrok_settings.ngrok_settings.set_tunnel_expiry",
				args: {
					expiry_type: values.expiry_type,
					custom_minutes: values.custom_expiry_minutes
				},
				freeze: true,
				freeze_message: __("Updating Tunnel Timer..."),
				callback: function (r) {
					if (!r.exc) {
						frappe.show_alert({
							message: r.message.message || __("Timer updated!"),
							indicator: "green"
						});
						if (frm) frm.reload_doc();
					}
				}
			});
		}
	});
	d.show();
}

function show_change_domain_dialog(frm) {
	frm = frm || cur_frm;
	let currentDomain = (frm && frm.doc && frm.doc.local_domain) || "sbmpl.local";
	frappe.prompt(
		[
			{
				label: __("Local Domain Name"),
				fieldname: "domain_name",
				fieldtype: "Data",
				reqd: 1,
				default: currentDomain,
				description: __(
					"e.g. <code>sbmpl.local</code> or <code>sbmpldemo.local</code>. Frappe will create a site symlink and broadcast it over mDNS on Wi-Fi."
				)
			}
		],
		function (values) {
			frappe.call({
				method: "frappe_ngrok.frappe_ngrok.doctype.ngrok_settings.ngrok_settings.set_local_domain",
				args: {
					domain_name: values.domain_name
				},
				freeze: true,
				freeze_message: __("Updating Local Domain & mDNS..."),
				callback: function (r) {
					if (!r.exc) {
						frappe.show_alert({
							message: r.message.message || __("Local domain updated!"),
							indicator: "green"
						});
						if (frm) frm.reload_doc();
					}
				}
			});
		},
		__("Configure Local Domain Name"),
		__("Save Domain")
	);
}

function show_update_token_dialog(frm) {
	frm = frm || cur_frm;
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
						if (frm) frm.reload_doc();
					}
				}
			});
		}
	});
	d.show();
}

function trigger_auto_install(frm) {
	frm = frm || cur_frm;
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
				if (frm) frm.reload_doc();
			}
		}
	});
}

// Expose on global window object to prevent any ReferenceErrors
window.frappe_ngrok = {
	show_change_domain_dialog: show_change_domain_dialog,
	show_update_token_dialog: show_update_token_dialog,
	show_set_expiry_dialog: show_set_expiry_dialog,
	trigger_auto_install: trigger_auto_install
};
window.show_change_domain_dialog = show_change_domain_dialog;
window.show_update_token_dialog = show_update_token_dialog;
window.show_set_expiry_dialog = show_set_expiry_dialog;

function render_status_card(frm) {
	if (!frm || !frm.doc) return;
	const doc = frm.doc;
	const isRunning = doc.status === "Running";
	const isInstalled = doc.__ngrok_installed !== false;
	const osName = doc.__os_name || "Linux / macOS";
	const ngrokUrl = doc.ngrok_url || "";
	const localDomain = doc.local_domain || "sbmpl.local";
	const localDomainUrl = doc.local_domain_url || `http://${localDomain}:${doc.site_port || 8002}`;
	const systemMdnsUrl = doc.system_mdns_url || "";
	const localIp = doc.local_ip || "127.0.0.1";
	const localIpUrl = doc.local_network_url || `http://${localIp}:${doc.site_port || 8002}`;
	const expiresAt = doc.expires_at || "";
	const expiryType = doc.expiry_type || "No Expiry";

	const badgeHtml = isRunning
		? `<span class="indicator-pill green" style="font-size: 13px; font-weight: 600; padding: 4px 10px;">🟢 Ngrok Active</span>`
		: doc.status === "Error"
		? `<span class="indicator-pill red" style="font-size: 13px; font-weight: 600; padding: 4px 10px;">🔴 Ngrok Error</span>`
		: `<span class="indicator-pill gray" style="font-size: 13px; font-weight: 600; padding: 4px 10px;">⚪ Ngrok Stopped</span>`;

	let installNotice = "";
	if (!isInstalled) {
		installNotice = `
			<div style="background: #fffbeb; border: 1px solid #fef3c7; border-left: 4px solid #f59e0b; border-radius: 6px; padding: 14px; margin-bottom: 16px;">
				<div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
					<div>
						<strong style="color: #92400e; font-size: 14px;">⚠️ Ngrok is not detected on this system (${osName})</strong>
						<p style="margin: 4px 0 0 0; font-size: 12px; color: #b45309;">
							Click the button below to download and configure ngrok automatically without root access.
						</p>
					</div>
					<button class="btn btn-sm btn-primary btn-auto-install">
						🚀 Install Ngrok Automatically
					</button>
				</div>
			</div>
		`;
	}

	// QR Codes
	const qrLocalDomain = `https://api.qrserver.com/v1/create-qr-code/?size=125x125&data=${encodeURIComponent(localDomainUrl)}`;
	const qrLocalIp = `https://api.qrserver.com/v1/create-qr-code/?size=125x125&data=${encodeURIComponent(localIpUrl)}`;
	const qrNgrok = isRunning && ngrokUrl
		? `https://api.qrserver.com/v1/create-qr-code/?size=125x125&data=${encodeURIComponent(ngrokUrl)}`
		: "";

	// Static Expiry Banner (NO live ticking countdown)
	let timerHtml = "";
	if (isRunning) {
		if (expiresAt) {
			timerHtml = `
				<div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 7px 10px; margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between;">
					<span style="font-size: 11.5px; color: #92400e; font-weight: 600;">
						⏱️ Auto-Expires: <strong>${expiryType}</strong> (at ${expiresAt})
					</span>
					<button class="btn btn-xs btn-default btn-set-timer" style="padding: 1px 7px; font-size: 10.5px;">
						⚙️ Change
					</button>
				</div>
			`;
		} else {
			timerHtml = `
				<div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 7px 10px; margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between;">
					<span style="font-size: 11.5px; color: #166534; font-weight: 600;">
						♾️ Expiry: <strong>No Expiry</strong> (Runs continuously)
					</span>
					<button class="btn btn-xs btn-default btn-set-timer" style="padding: 1px 7px; font-size: 10.5px;">
						⏱️ Set Timer
					</button>
				</div>
			`;
		}
	} else {
		timerHtml = `
			<div style="background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 6px; padding: 7px 10px; margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between;">
				<span style="font-size: 11.5px; color: #64748b; font-weight: 500;">
					⏱️ Timer Config: <strong>${expiryType === "No Expiry" ? "No Expiry" : expiryType}</strong>
				</span>
				<button class="btn btn-xs btn-default btn-set-timer" style="padding: 1px 7px; font-size: 10.5px;">
					⚙️ Config
				</button>
			</div>
		`;
	}

	const html = `
		<div style="background: var(--card-bg, #ffffff); border: 1px solid var(--border-color, #e2e8f0); border-radius: 12px; padding: 20px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.06);">
			${installNotice}

			<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid var(--border-color, #f1f5f9); padding-bottom: 14px;">
				<div>
					<h3 style="margin: 0; font-size: 17px; font-weight: 700; color: var(--text-color);">Frappe Site Access Hub</h3>
					<p class="text-muted" style="margin: 3px 0 0 0; font-size: 12.5px;">Connect your phone and devices via <strong>Local Domain</strong>, <strong>Direct IP</strong>, or <strong>Ngrok Internet Tunnel</strong></p>
				</div>
				<div>${badgeHtml}</div>
			</div>

			<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 18px;">
				
				<!-- 1. LOCAL DOMAIN (.local) CARD -->
				<div style="background: var(--bg-light-gray, #f8fafc); border: 1.5px solid #60a5fa; border-radius: 10px; padding: 16px; display: flex; flex-direction: column; justify-content: space-between;">
					<div>
						<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
							<div style="display: flex; align-items: center; gap: 7px;">
								<span style="font-size: 18px;">🏠</span>
								<strong style="font-size: 14px; color: #1e3a8a;">1. .local Domain (Wi-Fi)</strong>
							</div>
							<span class="badge" style="background: #dbeafe; color: #1e40af; font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 4px;">Recommended</span>
						</div>

						<div style="background: var(--control-bg, #ffffff); border: 1px solid #93c5fd; border-radius: 6px; padding: 9px 12px; margin-bottom: 8px; word-break: break-all; font-family: monospace; font-size: 12.5px; font-weight: 600; color: #1d4ed8;">
							${localDomainUrl}
						</div>

						<div style="display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px;">
							<button class="btn btn-xs btn-default btn-copy-domain">
								📋 Copy
							</button>
							<button class="btn btn-xs btn-default btn-open-domain">
								🚀 Open
							</button>
							<button class="btn btn-xs btn-primary btn-set-domain">
								✏️ Set Domain Name
							</button>
						</div>

						<div style="text-align: center; margin: 10px 0;">
							<img src="${qrLocalDomain}" alt="Local Domain QR Code" style="border-radius: 8px; border: 1px solid var(--border-color); background: #fff; padding: 4px; width: 110px; height: 110px;" />
							<div class="text-muted" style="font-size: 11px; margin-top: 3px;">Scan with mobile camera on Wi-Fi</div>
						</div>

						<div class="text-muted" style="font-size: 11px; background: rgba(59,130,246,0.06); padding: 8px 10px; border-radius: 5px; line-height: 1.4;">
							✨ <strong>Multi-Site Isolation:</strong> Accesses this specific site without conflicting with other sites on the same bench.
							${systemMdnsUrl && systemMdnsUrl !== localDomainUrl ? `<br><span style="opacity: 0.85;">Host fallback: <code>${systemMdnsUrl}</code></span>` : ""}
						</div>
					</div>
				</div>

				<!-- 2. DIRECT LOCAL IP CARD -->
				<div style="background: var(--bg-light-gray, #f8fafc); border: 1px solid var(--border-color, #e2e8f0); border-radius: 10px; padding: 16px; display: flex; flex-direction: column; justify-content: space-between;">
					<div>
						<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
							<div style="display: flex; align-items: center; gap: 7px;">
								<span style="font-size: 18px;">📶</span>
								<strong style="font-size: 14px; color: var(--text-color);">2. Direct Local IP (LAN)</strong>
							</div>
							<span class="badge" style="background: #e2e8f0; color: #475569; font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 4px;">Direct IP</span>
						</div>

						<div style="background: var(--control-bg, #ffffff); border: 1px solid var(--border-color); border-radius: 6px; padding: 9px 12px; margin-bottom: 8px; word-break: break-all; font-family: monospace; font-size: 12.5px; font-weight: 600; color: #334155;">
							${localIpUrl}
						</div>

						<div style="display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px;">
							<button class="btn btn-xs btn-default btn-copy-ip">
								📋 Copy
							</button>
							<button class="btn btn-xs btn-default btn-open-ip">
								🚀 Open
							</button>
						</div>

						<div style="text-align: center; margin: 10px 0;">
							<img src="${qrLocalIp}" alt="Local IP QR Code" style="border-radius: 8px; border: 1px solid var(--border-color); background: #fff; padding: 4px; width: 110px; height: 110px;" />
							<div class="text-muted" style="font-size: 11px; margin-top: 3px;">Direct IP QR code</div>
						</div>

						<div class="text-muted" style="font-size: 11px; background: rgba(0,0,0,0.03); padding: 8px 10px; border-radius: 5px; line-height: 1.4;">
							ℹ️ <strong>Direct IP:</strong> Mapped via <code>sites/${localIp}</code> symlink. If unreachable on mobile, your router may have AP isolation enabled (use the <strong>.local Domain</strong> above).
						</div>
					</div>
				</div>

				<!-- 3. NGROK PUBLIC TUNNEL CARD -->
				<div style="background: var(--bg-light-gray, #f8fafc); border: 1.5px solid ${isRunning ? '#10b981' : 'var(--border-color)'}; border-radius: 10px; padding: 16px; display: flex; flex-direction: column; justify-content: space-between;">
					<div>
						<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
							<div style="display: flex; align-items: center; gap: 7px;">
								<span style="font-size: 18px;">🌐</span>
								<strong style="font-size: 14px; color: ${isRunning ? '#065f46' : 'var(--text-color)'};">3. Ngrok URL (Anywhere)</strong>
							</div>
							<span class="badge" style="background: ${isRunning ? '#d1fae5' : '#e2e8f0'}; color: ${isRunning ? '#047857' : '#475569'}; font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 4px;">
								${isRunning ? 'Active Tunnel' : 'Stopped'}
							</span>
						</div>

						<div style="background: var(--control-bg, #ffffff); border: 1px solid ${isRunning ? '#6ee7b7' : 'var(--border-color)'}; border-radius: 6px; padding: 9px 12px; margin-bottom: 8px; word-break: break-all; font-family: monospace; font-size: 12.5px; font-weight: 600; color: ${isRunning ? '#059669' : '#94a3b8'};">
							${isRunning && ngrokUrl ? ngrokUrl : "Tunnel is currently stopped"}
						</div>

						${timerHtml}

						<div style="display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px;">
							${
								isRunning && ngrokUrl
									? `
								<button class="btn btn-xs btn-default btn-copy-ngrok">
									📋 Copy
								</button>
								<button class="btn btn-xs btn-default btn-open-ngrok">
									🚀 Open
								</button>
								<button class="btn btn-xs btn-danger btn-stop-tunnel">
									⏹️ Stop
								</button>
							`
									: `
								<button class="btn btn-xs btn-primary btn-start-tunnel">
									▶️ Start Tunnel
								</button>
								<button class="btn btn-xs btn-default btn-set-token">
									🔑 Set Token
								</button>
							`
							}
						</div>

						${
							isRunning && qrNgrok
								? `
							<div style="text-align: center; margin: 10px 0;">
								<img src="${qrNgrok}" alt="Ngrok QR Code" style="border-radius: 8px; border: 1px solid var(--border-color); background: #fff; padding: 4px; width: 110px; height: 110px;" />
								<div class="text-muted" style="font-size: 11px; margin-top: 3px;">Scan to open over Cellular / Internet</div>
							</div>
						`
								: `
							<div style="height: 110px; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.02); border-radius: 8px; margin: 10px 0; border: 1px dashed var(--border-color);">
								<span class="text-muted" style="font-size: 12px;">Click 'Start Tunnel' to generate URL &amp; QR</span>
							</div>
						`
						}

						<div class="text-muted" style="font-size: 11px; background: rgba(16,185,129,0.06); padding: 8px 10px; border-radius: 5px; line-height: 1.4;">
							🌍 <strong>Remote Access:</strong> Accessible anywhere over mobile data/internet and within ERPNext/Frappe mobile apps.
						</div>
					</div>
				</div>

			</div>
		</div>
	`;

	const field = frm.get_field("status_card");
	if (!field || !field.$wrapper) return;
	const $wrap = field.$wrapper;
	$wrap.html(html);

	// Safe jQuery Event Bindings
	$wrap.find(".btn-copy-domain").off("click").on("click", function () {
		frappe.utils.copy_to_clipboard(localDomainUrl);
		frappe.show_alert(__("Copied Local Domain URL!"), 2);
	});

	$wrap.find(".btn-open-domain").off("click").on("click", function () {
		window.open(localDomainUrl, "_blank");
	});

	$wrap.find(".btn-set-domain").off("click").on("click", function () {
		show_change_domain_dialog(frm);
	});

	$wrap.find(".btn-copy-ip").off("click").on("click", function () {
		frappe.utils.copy_to_clipboard(localIpUrl);
		frappe.show_alert(__("Copied Local IP URL!"), 2);
	});

	$wrap.find(".btn-open-ip").off("click").on("click", function () {
		window.open(localIpUrl, "_blank");
	});

	$wrap.find(".btn-copy-ngrok").off("click").on("click", function () {
		frappe.utils.copy_to_clipboard(ngrokUrl);
		frappe.show_alert(__("Copied Ngrok URL!"), 2);
	});

	$wrap.find(".btn-open-ngrok").off("click").on("click", function () {
		window.open(ngrokUrl, "_blank");
	});

	$wrap.find(".btn-set-timer").off("click").on("click", function () {
		show_set_expiry_dialog(frm);
	});

	$wrap.find(".btn-start-tunnel").off("click").on("click", function () {
		frappe.call({
			method: "frappe_ngrok.frappe_ngrok.doctype.ngrok_settings.ngrok_settings.start_tunnel",
			freeze: true,
			freeze_message: __("Starting Ngrok Tunnel..."),
			callback: function (r) {
				if (!r.exc) {
					frappe.show_alert({ message: __("Ngrok tunnel started!"), indicator: "green" });
					frm.reload_doc();
				}
			}
		});
	});

	$wrap.find(".btn-stop-tunnel").off("click").on("click", function () {
		frappe.call({
			method: "frappe_ngrok.frappe_ngrok.doctype.ngrok_settings.ngrok_settings.stop_tunnel",
			freeze: true,
			freeze_message: __("Stopping Ngrok Tunnel..."),
			callback: function (r) {
				if (!r.exc) {
					frappe.show_alert({ message: __("Ngrok tunnel stopped"), indicator: "orange" });
					frm.reload_doc();
				}
			}
		});
	});

	$wrap.find(".btn-set-token").off("click").on("click", function () {
		show_update_token_dialog(frm);
	});

	$wrap.find(".btn-auto-install").off("click").on("click", function () {
		trigger_auto_install(frm);
	});
}
