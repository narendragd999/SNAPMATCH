"use client";

import { useState, useEffect } from "react";
import API from "@/services/api";
import {
  Mail, Send, CheckCircle, XCircle, 
  RefreshCw, AlertCircle, Settings, TestTube
} from "lucide-react";

interface EmailConfig {
  id: number;
  provider: string;
  from_name: string;
  from_email: string;
  reply_to: string | null;
  is_active: boolean;
  is_configured: boolean;
  last_test_at: string | null;
  last_test_status: string | null;
  last_test_error: string | null;
  updated_at: string | null;
}

interface ProviderInfo {
  provider: string;
  name: string;
  best_for: string;
  pros: string[];
  cons: string[];
  limits: string;
  pricing?: string;
  setup_difficulty: string;
}

const providerIcons: Record<string, string> = {
  smtp: "📧",
  sendgrid: "📮",
  brevo: "🚀",
  resend: "⚡",
  ses: "☁️",
  mailgun: "🔫"
};

export default function AdminEmailSettingsPage() {
  const [config, setConfig] = useState<EmailConfig | null>(null);
  const [providers, setProviders] = useState<Record<string, ProviderInfo>>({});
  const [selectedProvider, setSelectedProvider] = useState("smtp");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [message, setMessage] = useState({ type: "", text: "" });

  const [formData, setFormData] = useState({
    from_name: "SnapMatch",
    reply_to: "",
    smtp_host: "",
    smtp_port: 587,
    smtp_user: "",
    smtp_password: "",
    smtp_from: "",
    smtp_use_tls: true,
    sendgrid_api_key: "",
    sendgrid_from: "",
    brevo_api_key: "",
    brevo_from: "",
    resend_api_key: "",
    resend_from: "",
    ses_access_key: "",
    ses_secret_key: "",
    ses_region: "us-east-1",
    ses_from: "",
    mailgun_api_key: "",
    mailgun_domain: "",
    mailgun_from: ""
  });

  useEffect(() => {
    fetchConfig();
    fetchProviders();
  }, []);

  const fetchConfig = async () => {
    try {
      const res = await API.get("/admin/email/config");
      setConfig(res.data);
      setSelectedProvider(res.data.provider);
    } catch (error: any) {
      if (error.response?.status !== 404) {
        setMessage({ type: "error", text: "Failed to load email configuration" });
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchProviders = async () => {
    try {
      const res = await API.get("/admin/email/providers");
      setProviders(res.data.providers);
    } catch (error) {
      console.error("Failed to load providers:", error);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage({ type: "", text: "" });

    try {
      await API.put("/admin/email/config", {
        provider: selectedProvider,
        ...formData
      });

      setMessage({ type: "success", text: "Email configuration saved successfully!" });
      fetchConfig();
    } catch (error: any) {
      setMessage({ 
        type: "error", 
        text: error.response?.data?.detail || "Failed to save configuration" 
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setMessage({ type: "", text: "" });

    try {
      const res = await API.post("/admin/email/test");
      if (res.data.success) {
        setMessage({ type: "success", text: res.data.message });
      } else {
        setMessage({ type: "error", text: res.data.message });
      }
      fetchConfig();
    } catch (error: any) {
      setMessage({ 
        type: "error", 
        text: error.response?.data?.detail || "Test failed" 
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSendTestEmail = async () => {
    if (!testEmail) return;

    setSaving(true);
    try {
      const res = await API.post("/admin/email/test-send", { to_email: testEmail });
      setMessage({ type: "success", text: res.data.message });
    } catch (error: any) {
      setMessage({ 
        type: "error", 
        text: error.response?.data?.detail || "Failed to send test email" 
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100 flex items-center gap-2">
            <Mail className="w-6 h-6 text-blue-500" />
            Email Provider Settings
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Configure email service for OTP verification and notifications
          </p>
        </div>
        {config && (
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
            config.is_configured 
              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
              : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
          }`}>
            {config.is_configured ? (
              <>
                <CheckCircle className="w-3.5 h-3.5" />
                Configured
              </>
            ) : (
              <>
                <AlertCircle className="w-3.5 h-3.5" />
                Not Configured
              </>
            )}
          </div>
        )}
      </div>

      {message.text && (
        <div className={`p-4 rounded-lg flex items-center gap-2 ${
          message.type === "success" 
            ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
            : "bg-red-500/10 border border-red-500/20 text-red-400"
        }`}>
          {message.type === "success" ? (
            <CheckCircle className="w-4 h-4" />
          ) : (
            <XCircle className="w-4 h-4" />
          )}
          {message.text}
        </div>
      )}

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
        <h2 className="text-sm font-semibold text-zinc-300 mb-4">Select Email Provider</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {Object.entries(providers).map(([key, info]) => (
            <button
              key={key}
              onClick={() => setSelectedProvider(key)}
              className={`p-4 rounded-lg border transition-all ${
                selectedProvider === key
                  ? "border-blue-500 bg-blue-500/10"
                  : "border-zinc-700 bg-zinc-800/50 hover:border-zinc-600"
              }`}
            >
              <div className="text-2xl mb-2">{providerIcons[key] || "📧"}</div>
              <div className="text-xs font-medium text-zinc-300">{info.name}</div>
              <div className="text-[10px] text-zinc-500 mt-1">{info.limits}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-zinc-300 mb-4 flex items-center gap-2">
            <Settings className="w-4 h-4" />
            {providers[selectedProvider]?.name || "Email"} Configuration
          </h2>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-zinc-500 block mb-1">From Name</label>
                <input
                  type="text"
                  value={formData.from_name}
                  onChange={(e) => setFormData({ ...formData, from_name: e.target.value })}
                  placeholder="SnapMatch"
                  className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500 block mb-1">Reply-To (Optional)</label>
                <input
                  type="email"
                  value={formData.reply_to}
                  onChange={(e) => setFormData({ ...formData, reply_to: e.target.value })}
                  placeholder="support@yourdomain.com"
                  className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>

            {selectedProvider === "smtp" && (
              <div className="space-y-4 pt-4 border-t border-zinc-800">
                <h3 className="text-xs font-medium text-zinc-400">SMTP Settings</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-zinc-500 block mb-1">SMTP Host</label>
                    <input
                      type="text"
                      value={formData.smtp_host}
                      onChange={(e) => setFormData({ ...formData, smtp_host: e.target.value })}
                      placeholder="smtp.gmail.com"
                      className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 block mb-1">Port</label>
                    <input
                      type="number"
                      value={formData.smtp_port}
                      onChange={(e) => setFormData({ ...formData, smtp_port: parseInt(e.target.value) })}
                      placeholder="587"
                      className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-zinc-500 block mb-1">Username</label>
                    <input
                      type="text"
                      value={formData.smtp_user}
                      onChange={(e) => setFormData({ ...formData, smtp_user: e.target.value })}
                      placeholder="your-email@gmail.com"
                      className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 block mb-1">Password / App Password</label>
                    <input
                      type="password"
                      value={formData.smtp_password}
                      onChange={(e) => setFormData({ ...formData, smtp_password: e.target.value })}
                      placeholder="••••••••"
                      className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-zinc-500 block mb-1">From Email</label>
                    <input
                      type="email"
                      value={formData.smtp_from}
                      onChange={(e) => setFormData({ ...formData, smtp_from: e.target.value })}
                      placeholder="your-email@gmail.com"
                      className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div className="flex items-center gap-2 pt-6">
                    <input
                      type="checkbox"
                      id="smtp_tls"
                      checked={formData.smtp_use_tls}
                      onChange={(e) => setFormData({ ...formData, smtp_use_tls: e.target.checked })}
                      className="w-4 h-4 rounded border-zinc-600 bg-zinc-800"
                    />
                    <label htmlFor="smtp_tls" className="text-xs text-zinc-400">Use TLS</label>
                  </div>
                </div>
              </div>
            )}

            {selectedProvider === "sendgrid" && (
              <div className="space-y-4 pt-4 border-t border-zinc-800">
                <h3 className="text-xs font-medium text-zinc-400">SendGrid Settings</h3>
                <div>
                  <label className="text-xs text-zinc-500 block mb-1">API Key</label>
                  <input
                    type="password"
                    value={formData.sendgrid_api_key}
                    onChange={(e) => setFormData({ ...formData, sendgrid_api_key: e.target.value })}
                    placeholder="SG.xxxxxxxxxxxxxxxx"
                    className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs text-zinc-500 block mb-1">From Email (Verified)</label>
                  <input
                    type="email"
                    value={formData.sendgrid_from}
                    onChange={(e) => setFormData({ ...formData, sendgrid_from: e.target.value })}
                    placeholder="noreply@yourdomain.com"
                    className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>
            )}

            {selectedProvider === "brevo" && (
              <div className="space-y-4 pt-4 border-t border-zinc-800">
                <h3 className="text-xs font-medium text-zinc-400">Brevo (Sendinblue) Settings</h3>
                <div>
                  <label className="text-xs text-zinc-500 block mb-1">API Key</label>
                  <input
                    type="password"
                    value={formData.brevo_api_key}
                    onChange={(e) => setFormData({ ...formData, brevo_api_key: e.target.value })}
                    placeholder="xkeysib-xxxxxxxxxxxxxxxx"
                    className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs text-zinc-500 block mb-1">From Email</label>
                  <input
                    type="email"
                    value={formData.brevo_from}
                    onChange={(e) => setFormData({ ...formData, brevo_from: e.target.value })}
                    placeholder="noreply@yourdomain.com"
                    className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>
            )}

            {selectedProvider === "resend" && (
              <div className="space-y-4 pt-4 border-t border-zinc-800">
                <h3 className="text-xs font-medium text-zinc-400">Resend Settings</h3>
                <div>
                  <label className="text-xs text-zinc-500 block mb-1">API Key</label>
                  <input
                    type="password"
                    value={formData.resend_api_key}
                    onChange={(e) => setFormData({ ...formData, resend_api_key: e.target.value })}
                    placeholder="re_xxxxxxxxxxxxxxxx"
                    className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs text-zinc-500 block mb-1">From Email (Verified Domain)</label>
                  <input
                    type="email"
                    value={formData.resend_from}
                    onChange={(e) => setFormData({ ...formData, resend_from: e.target.value })}
                    placeholder="noreply@yourdomain.com"
                    className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 pt-4 border-t border-zinc-800">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-sm font-medium transition-colors"
              >
                {saving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                Save Configuration
              </button>
              <button
                onClick={handleTest}
                disabled={testing}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-60 text-zinc-200 text-sm font-medium transition-colors"
              >
                <TestTube className="w-3.5 h-3.5" />
                Test Connection
              </button>
            </div>
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-zinc-300 mb-4">Provider Info</h2>
          
          {providers[selectedProvider] && (
            <div className="space-y-4">
              <div>
                <div className="text-lg font-medium text-zinc-200 flex items-center gap-2">
                  <span className="text-2xl">{providerIcons[selectedProvider]}</span>
                  {providers[selectedProvider].name}
                </div>
                <p className="text-xs text-zinc-500 mt-1">
                  Best for: {providers[selectedProvider].best_for}
                </p>
              </div>

              <div>
                <p className="text-xs font-medium text-zinc-400 mb-1">Limits</p>
                <p className="text-xs text-zinc-500">{providers[selectedProvider].limits}</p>
              </div>

              {providers[selectedProvider].pricing && (
                <div>
                  <p className="text-xs font-medium text-zinc-400 mb-1">Pricing</p>
                  <p className="text-xs text-zinc-500">{providers[selectedProvider].pricing}</p>
                </div>
              )}

              <div>
                <p className="text-xs font-medium text-emerald-400 mb-1">✓ Pros</p>
                <ul className="text-xs text-zinc-500 space-y-0.5">
                  {providers[selectedProvider].pros.map((pro, i) => (
                    <li key={i}>• {pro}</li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="text-xs font-medium text-amber-400 mb-1">✗ Cons</p>
                <ul className="text-xs text-zinc-500 space-y-0.5">
                  {providers[selectedProvider].cons.map((con, i) => (
                    <li key={i}>• {con}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
        <h2 className="text-sm font-semibold text-zinc-300 mb-4 flex items-center gap-2">
          <Send className="w-4 h-4" />
          Send Test Email
        </h2>
        <div className="flex gap-3">
          <input
            type="email"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            placeholder="Enter email to send test"
            className="flex-1 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 focus:border-blue-500 focus:outline-none"
          />
          <button
            onClick={handleSendTestEmail}
            disabled={saving || !testEmail}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-sm font-medium transition-colors"
          >
            <Send className="w-3.5 h-3.5" />
            Send Test
          </button>
        </div>
      </div>
    </div>
  );
}