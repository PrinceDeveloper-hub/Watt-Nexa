# Hardware integration

How a WattNexa ESP32 meter talks to the platform, what is proven to work, and what still
needs a physical device on the bench.

## Honest status

| Capability | State |
| --- | --- |
| Device registration, pairing, token issuance | **Working** — exercised by tests |
| Bearer-token telemetry ingest over HTTP | **Working** — exercised by tests |
| MQTT telemetry/status/command handling | **Implemented, not hardware-tested** — the broker client, topic parsing, validation and dedup are unit-tested through `handleMqttMessage`, but no physical ESP32 has been connected |
| Live dashboard over Socket.IO | **Working** with the simulator; the same events fire for MQTT traffic |
| Device simulator (`pnpm simulate`) | **Working** — always stored as `source='simulated'` |
| Real CT/VT calibration, firmware, OTA updates | **Not implemented** — belongs to the device firmware repository |
| MQTT broker deployment | **Not provisioned** — bring your own broker (see below) |

Nothing in this repository should be described as "ESP32 integration is live" until a unit has
been flashed, connected to a broker and observed reporting into the dashboard.

## 1. Provisioning and credentials

1. The user creates a pairing code in the app (`POST /api/v1/devices/pairing`).
2. `POST /api/v1/devices/pair` binds a device record to the account and returns:
   - `deviceToken` — `wnx_dev_…`, shown **once**, stored only as a SHA-256 hash;
   - `telemetryTopic` — the MQTT topic for that serial.
3. The device stores the token in NVS and sends it as `Authorization: Bearer <token>` for the
   HTTP transport, or uses it as the MQTT password (see ACL below).

The device starts in `not_configured`. It only becomes `online` after a valid reading arrives.
Rotating a token issues a new one and leaves the old hash in the table until you revoke it.

## 2. MQTT contract

Default prefix `wattnexa`, configurable with `MQTT_TOPIC_PREFIX`.

| Topic | Direction | Purpose |
| --- | --- | --- |
| `<prefix>/devices/<serial>/telemetry` | device → API | A reading. QoS 1 recommended. |
| `<prefix>/devices/<serial>/status` | device → API | `online` / `connecting` / `offline` / `error`. Publish `offline` as the **last will**, retained. |
| `<prefix>/devices/<serial>/commands` | API → device | `identify`, `reboot`, `sync_time`, `set_interval` |

The legacy short form `<prefix>/<serial>/telemetry` is still subscribed, so firmware flashed
before this contract keeps working.

The API subscribes with QoS 1. Reconnection is handled by the MQTT client with a 5 s backoff and
subscriptions are re-established on every `connect`. Devices must use `cleanSession = false` and
QoS 1 if they need delivery across their own reconnects — duplicate delivery is safe because of
idempotency (section 4).

### Telemetry payload

```json
{
  "timestamp": "2026-11-14T09:31:02.114Z",
  "message_id": "3f9c1a6e-2b7d-4a10-9d3f-0a7c2e5b8f41",
  "voltage": 231.4,
  "current": 1.82,
  "active_power": 416.5,
  "apparent_power": 438.4,
  "power_factor": 0.95,
  "energy_kwh": 128.442,
  "temperature": 32.2,
  "frequency": 50.01,
  "signal_strength": -61,
  "firmware_version": "1.4.2",
  "device_status": "online"
}
```

- Only send what the board actually measures. Omitted or `null` measurements are stored as
  `NULL` and displayed as "—", never as zero.
- `message_id` is the idempotency key. Without it the API deduplicates on the exact
  `(device, timestamp)` pair, which is weaker; include it when the firmware can.
- Timestamps more than 5 minutes in the future are replaced with server time.
- Out-of-range values are clamped (voltage 0–600 V, current 0–200 A, active power 0–120 kW,
  temperature −40–150 °C, frequency 40–70 Hz) and the reading is still stored.
- A payload with no measurement at all is rejected (`400`, or a `telemetry_rejected` event over MQTT).

### Status payload

```json
{ "status": "offline", "reason": "wifi lost", "firmware_version": "1.4.2", "signal_strength": -78 }
```

Register it as the broker last will so a power cut marks the device offline immediately instead
of waiting for `OFFLINE_THRESHOLD_SECONDS` (default 120 s).

### Commands

```json
{ "command": "identify", "issuedAt": "2026-11-14T09:40:00.000Z", "commandId": "…" }
```

Subscribe to the commands topic and act on `command`. The app exposes "Blink LED"
(`POST /api/v1/devices/:id/commands`), which answers `503 MQTT_DISABLED` when the API has no
broker connection — it never silently pretends a command was delivered.

## 3. Broker setup

Any MQTT 3.1.1/5 broker works. A minimal Mosquitto configuration with per-device authorization:

```conf
listener 8883
cafile   /etc/mosquitto/certs/ca.crt
certfile /etc/mosquitto/certs/server.crt
keyfile  /etc/mosquitto/certs/server.key
allow_anonymous false
password_file /etc/mosquitto/passwd

# Devices may only publish their own telemetry/status and read their commands.
pattern write  wattnexa/devices/%u/telemetry
pattern write  wattnexa/devices/%u/status
pattern read   wattnexa/devices/%u/commands

# The API reads everything and writes commands.
user wattnexa-api
topic read  wattnexa/#
topic write wattnexa/devices/+/commands
```

Use the serial as the MQTT username and the device token as the password
(`mosquitto_passwd`). Topic-level authorization therefore belongs to the broker; the API
additionally rejects messages from serials it does not know and from removed devices.

API-side configuration:

```dotenv
MQTT_ENABLED=true
MQTT_URL=mqtts://broker.example.com:8883
MQTT_USERNAME=wattnexa-api
MQTT_PASSWORD=<broker-password>
MQTT_TOPIC_PREFIX=wattnexa
SENSOR_MODE=hardware
```

MQTT always runs inside the long-lived API process — never inside a Vercel serverless function.

## 4. Duplicates, ordering and failures

- **Duplicate delivery**: a repeated `message_id` hits the unique index
  `uq_telemetry_device_message` and is answered with `duplicate: true`. No second row, no second
  alert, no second socket event.
- **Out-of-order readings** are stored with their own timestamp, so history stays correct.
- **Unknown serial**: logged as a warning, discarded, never stored.
- **Malformed JSON or failed schema**: logged without the payload body, and recorded as a
  `telemetry_rejected` device event so the user can see it in the connection history.
- **Disconnection**: the offline sweep runs every 60 s and moves devices with no traffic past
  `OFFLINE_THRESHOLD_SECONDS` to `offline`, writes a `disconnected` event and raises one alert
  (suppressed for 30 minutes).

## 5. HTTP fallback

Boards without MQTT, or during bring-up, can post directly:

```
POST /api/v1/telemetry
Authorization: Bearer wnx_dev_…
Content-Type: application/json
```

Same payload schema, same validation, same deduplication. `POST /api/v1/telemetry/status` sends a
status heartbeat without a reading.

## 6. Reference ESP32 sketch (skeleton)

```cpp
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>

const char* SERIAL = "WNX-ESP32-A1B2C3";
const char* DEVICE_TOKEN = "wnx_dev_…";           // from pairing, stored in NVS
String base = String("wattnexa/devices/") + SERIAL;

WiFiClientSecure net;
PubSubClient mqtt(net);

void connect() {
  net.setCACert(BROKER_CA);
  mqtt.setServer(BROKER_HOST, 8883);
  mqtt.setBufferSize(512);
  // Last will: broker publishes this if the board disappears.
  bool ok = mqtt.connect(SERIAL, SERIAL, DEVICE_TOKEN, base + "/status", 1, true,
                         "{\"status\":\"offline\",\"reason\":\"last will\"}");
  if (ok) {
    mqtt.publish((base + "/status").c_str(), "{\"status\":\"connecting\"}", false);
    mqtt.subscribe((base + "/commands").c_str(), 1);
  }
}

void loop() {
  if (!mqtt.connected()) connect();
  mqtt.loop();

  static unsigned long last = 0;
  if (millis() - last < 5000) return;
  last = millis();

  char payload[256];
  snprintf(payload, sizeof(payload),
           "{\"message_id\":\"%lu\",\"timestamp\":\"%s\",\"voltage\":%.1f,\"current\":%.3f,"
           "\"active_power\":%.1f,\"power_factor\":%.2f,\"temperature\":%.1f,\"firmware_version\":\"1.4.2\"}",
           millis(), iso8601Now(), readVoltage(), readCurrent(), readActivePower(),
           readPowerFactor(), readBoardTemperature());

  mqtt.publish((base + "/telemetry").c_str(), payload, false);
}
```

This is a shape reference, not a working firmware: calibration constants, the CT/VT sampling
loop and OTA updates are hardware-specific and out of scope for this repository.

## 7. Development simulator

```bash
pnpm simulate            # one reading per device every 5 s
pnpm simulate -- --fast  # every 2 s
```

Readings are stored with `source='simulated'`; the dashboard shows a **Simulated data** badge and
the raw API never promotes simulated rows to hardware. To exercise the hardware path without a
board, use the pairing flow's token and `curl` the HTTP endpoint, or publish to your broker.

## 8. Troubleshooting

| Symptom | Check |
| --- | --- |
| Device stays `not_configured` | Token correct? Topic exactly `<prefix>/devices/<serial>/telemetry`? `message_id` unique? |
| `401` on HTTP ingest | Token revoked, or serial belongs to a removed device |
| Stays `offline` while publishing | Reading timestamps in the future are discarded; also check the MQTT ACL grants publish on that topic |
| Commands return `MQTT_DISABLED` | `MQTT_ENABLED=true` and the API shows `MQTT connected` in its log |
| Duplicates in history | Firmware is not sending `message_id` |
| Wrong sensor list | Sensors are inferred from the last 20 readings; send the field at least once |
