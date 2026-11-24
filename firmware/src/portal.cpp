#include "portal.h"

#include <Arduino.h>
#include <DNSServer.h>
#include <WebServer.h>
#include <WiFi.h>

#include <memory>

#include "api.h"
#include "clock.h"
#include "generated/portal_strings.h"
#include "led.h"
#include "net.h"
#include "setup.h"

namespace portal {
namespace {
constexpr uint64_t kRestartDelayMs = 3000;

WebServer server(80);
DNSServer dns;
std::unique_ptr<SetupFlow> flow;
std::vector<std::string> networks;
bool hasToken = false;
SetupStatus reported = SetupStatus::Idle;
uint64_t doneAtMs = 0;
bool saved = false;

String htmlEscape(const std::string& text) {
  String out;
  for (char c : text) {
    switch (c) {
      case '&': out += "&amp;"; break;
      case '<': out += "&lt;"; break;
      case '>': out += "&gt;"; break;
      case '"': out += "&quot;"; break;
      default: out += c;
    }
  }
  return out;
}

void messages(String& page, const PortalStrings& s) {
  struct Message {
    const char* key;
    const char* text;
  } list[] = {
      {"CONNECTING", s.statusConnecting},
      {"WIFI_NOT_FOUND", s.statusWifiNotFound},
      {"WIFI_AUTH_FAILED", s.statusWifiAuthFailed},
      {"WIFI_FAILED", s.statusWifiFailed},
      {"CLAIMING", s.statusClaiming},
      {"CODE_INVALID", s.statusCodeInvalid},
      {"CODE_EXPIRED", s.statusCodeExpired},
      {"SERVER_UNREACHABLE", s.statusServerUnreachable},
      {"DONE", s.statusDone},
      {"SSID_REQUIRED", s.errorsSsidRequired},
      {"PASSWORD_TOO_LONG", s.errorsPasswordTooLong},
      {"CODE_FORMAT", s.errorsCodeFormat},
      {"CODE_REQUIRED", s.errorsCodeRequired},
  };
  page += "<div hidden>";
  for (const Message& m : list) {
    page += "<span data-k=\"";
    page += m.key;
    page += "\">";
    page += m.text;
    page += "</span>";
  }
  page += "</div>";
}

const char* kStyle =
    "body{font-family:system-ui,sans-serif;max-width:26rem;margin:1.5rem auto;padding:0 1rem}"
    "label{display:block;margin-top:1rem;font-weight:600}"
    "input{width:100%;box-sizing:border-box;padding:.6rem;font-size:1rem;margin-top:.3rem;"
    "border:1px solid #888;border-radius:6px}"
    "input[aria-invalid]{border:2px solid #b3261e}"
    "button{margin-top:1.5rem;width:100%;padding:.8rem;font-size:1rem}"
    "small{display:block;color:#555;margin-top:.3rem}.err{color:#b3261e;font-weight:600}"
    "#m{margin-top:1rem;font-weight:600}nav a{margin-right:.8rem}";

const char* kScript =
    "const f=document.getElementById('f'),m=document.getElementById('m'),b=f.querySelector('button');"
    "const fields=['ssid','password','code'];"
    "const owner={SSID_REQUIRED:'ssid',WIFI_NOT_FOUND:'ssid',PASSWORD_TOO_LONG:'password',"
    "WIFI_AUTH_FAILED:'password',CODE_FORMAT:'code',CODE_REQUIRED:'code',CODE_INVALID:'code',"
    "CODE_EXPIRED:'code'};"
    "function text(k){const e=document.querySelector('[data-k=\"'+k+'\"]');return e?e.textContent:''}"
    "function clearField(n){const i=document.getElementById(n),e=document.getElementById('e-'+n);"
    "i.removeAttribute('aria-invalid');e.textContent='';e.hidden=true}"
    "function show(k){m.textContent='';fields.forEach(clearField);const n=owner[k];"
    "if(!n){m.textContent=text(k);return}"
    "const i=document.getElementById(n),e=document.getElementById('e-'+n);"
    "i.setAttribute('aria-invalid','true');e.textContent=text(k);e.hidden=false;i.focus()}"
    "fields.forEach(n=>document.getElementById(n).addEventListener('input',()=>clearField(n)));"
    "const busy=['CONNECTING','CLAIMING'];"
    "async function poll(){const r=await fetch('/status').then(r=>r.json()).catch(()=>null);"
    "if(!r){setTimeout(poll,1000);return}show(r.status);"
    "if(busy.includes(r.status)){setTimeout(poll,1000)}else if(r.status!=='DONE'){b.disabled=false}}"
    "f.onsubmit=async e=>{e.preventDefault();b.disabled=true;"
    "const r=await fetch('/setup',{method:'POST',body:new URLSearchParams(new FormData(f))})"
    ".then(r=>r.json()).catch(()=>({error:'WIFI_FAILED'}));"
    "if(r.error){show(r.error);b.disabled=false}else{show(r.status);poll()}};";

void fieldError(String& page, const char* name) {
  page += "<small class=\"err\" id=\"e-";
  page += name;
  page += "\" hidden></small>";
}

void handleRoot() {
  size_t lang = pickLanguage(server.arg("lang").c_str(), server.header("Accept-Language").c_str());
  const PortalStrings& s = kPortalStrings[lang];

  String page;
  page.reserve(6000);
  page += "<!doctype html><html lang=\"";
  page += kPortalLanguages[lang];
  page += "\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" "
          "content=\"width=device-width,initial-scale=1\"><title>";
  page += s.title;
  page += "</title><style>";
  page += kStyle;
  page += "</style></head><body><nav aria-label=\"";
  page += s.language;
  page += "\">";
  for (size_t i = 0; i < 3; i++) {
    page += "<a href=\"/?lang=";
    page += kPortalLanguages[i];
    page += "\">";
    page += kPortalLanguages[i];
    page += "</a>";
  }
  page += "</nav><h1>";
  page += s.title;
  page += "</h1><form id=\"f\"><label for=\"ssid\">";
  page += s.wifiName;
  page += "</label><input id=\"ssid\" name=\"ssid\" list=\"nets\" maxlength=\"32\" "
          "autocomplete=\"off\" aria-describedby=\"h-ssid e-ssid\">";
  fieldError(page, "ssid");
  page += "<small id=\"h-ssid\">";
  page += s.wifiHint;
  page += "</small><datalist id=\"nets\" aria-label=\"";
  page += s.wifiScan;
  page += "\">";
  for (const std::string& ssid : networks) {
    page += "<option value=\"";
    page += htmlEscape(ssid);
    page += "\">";
  }
  page += "</datalist><label for=\"password\">";
  page += s.wifiPassword;
  page += "</label><input id=\"password\" name=\"password\" type=\"password\" "
          "maxlength=\"63\" aria-describedby=\"e-password\">";
  fieldError(page, "password");
  page += "<label for=\"code\">";
  page += s.pairingCode;
  page += "</label><input id=\"code\" name=\"code\" autocapitalize=\"characters\" "
          "autocomplete=\"off\" maxlength=\"16\" aria-describedby=\"e-code h-code\">";
  fieldError(page, "code");
  page += "<small id=\"h-code\">";
  page += hasToken ? s.pairingCodeKeep : s.pairingCodeHint;
  page += "</small><button type=\"submit\">";
  page += s.save;
  page += "</button></form><p id=\"m\" role=\"status\"></p>";
  messages(page, s);
  page += "<script>";
  page += kScript;
  page += "</script></body></html>";

  server.sendHeader("Cache-Control", "no-store");
  server.send(200, "text/html; charset=utf-8", page);
}

void sendJson(int code, const char* key, const char* value) {
  server.sendHeader("Cache-Control", "no-store");
  server.send(code, "application/json", String("{\"") + key + "\":\"" + value + "\"}");
}

void handleSetup() {
  SetupForm form{server.arg("ssid").c_str(), server.arg("password").c_str(),
                 server.arg("code").c_str()};
  SetupError error = validateSetupForm(form, hasToken);
  if (error != SetupError::None) {
    sendJson(400, "error", setupErrorName(error));
    return;
  }
  if (!flow->submit(form, devclock::nowMs())) {
    sendJson(409, "status", setupStatusName(flow->status()));
    return;
  }
  net::discardEvents();
  net::connectFromSetup(flow->form().ssid, flow->form().password);
  sendJson(202, "status", setupStatusName(flow->status()));
}

void handleStatus() { sendJson(200, "status", setupStatusName(flow->status())); }

void redirectToPortal() {
  server.sendHeader("Location", String("http://") + WiFi.softAPIP().toString() + "/", true);
  server.send(302, "text/plain", "");
}

bool wifiFailed(SetupStatus status) {
  return status == SetupStatus::WifiNotFound || status == SetupStatus::WifiAuthFailed ||
         status == SetupStatus::WifiFailed;
}

void onStatusChange() {
  SetupStatus status = flow->status();
  if (status == reported) return;
  reported = status;
  if (wifiFailed(status)) {
    Serial.printf("setup wifi -> %s (reason %u)\n", setupStatusName(status),
                  flow->lastWifiReason());
  } else if (status == SetupStatus::Claiming) {
    Serial.printf("setup wifi -> %s\n", setupStatusName(status));
  }
  if (wifiFailed(status)) net::stopStation();
}
}  // namespace

void begin(const StoredConfig& config, bool byButton, uint64_t nowMs) {
  hasToken = !config.token.empty();
  flow = std::make_unique<SetupFlow>(hasToken);
  if (byButton) flow->enableIdleExit(nowMs);

  std::string name = net::apName();
  net::beginAccessPoint(name);
  networks = net::scan();
  Serial.printf("setup mode %s (%s)\n", name.c_str(), byButton ? "button" : "no config");

  dns.setErrorReplyCode(DNSReplyCode::NoError);
  dns.start(53, "*", WiFi.softAPIP());

  const char* headers[] = {"Accept-Language"};
  server.collectHeaders(headers, 1);
  server.on("/", HTTP_GET, handleRoot);
  server.on("/setup", HTTP_POST, handleSetup);
  server.on("/status", HTTP_GET, handleStatus);
  for (const char* probe : {"/generate_204", "/gen_204", "/hotspot-detect.html", "/connecttest.txt",
                            "/ncsi.txt", "/success.txt", "/canonical.html"}) {
    server.on(probe, redirectToPortal);
  }
  server.onNotFound(redirectToPortal);
  server.begin();
}

void loop(uint64_t nowMs) {
  dns.processNextRequest();
  server.handleClient();

  for (const net::Event& event : net::poll(nowMs)) {
    if (event.kind == net::EventKind::GotIp) flow->onWifiConnected();
    if (event.kind == net::EventKind::Disconnected) flow->onWifiFailed(event.reason);
  }
  if (flow->takeWifiRetry()) {
    Serial.printf("setup wifi retry (reason %u)\n", flow->lastWifiReason());
    net::connectFromSetup(flow->form().ssid, flow->form().password);
  }
  flow->tick(nowMs);
  onStatusChange();

  if (flow->shouldClaim() && net::linkReady()) {
    api::ClaimResponse response = api::claim(flow->form().pairingCode);
    Serial.printf("claim -> %d\n", response.status);
    flow->onClaimResult(response.status, response.result);
  }

  if (flow->shouldSave() && !saved) {
    store::saveSetup(flow->form(), flow->claim());
    saved = true;
    doneAtMs = nowMs;
    Serial.println("setup done, restarting");
  }
  if (saved && nowMs - doneAtMs >= kRestartDelayMs) ESP.restart();

  if (flow->shouldExit(nowMs)) {
    Serial.println("setup timed out, restarting");
    ESP.restart();
  }

  led::show(LedPattern::Setup, nowMs);
}
}  // namespace portal
