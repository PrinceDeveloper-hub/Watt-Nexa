# ⚡ WattNexa

### Know exactly where your electricity bill is going.

**WattNexa** is a modern IoT-powered electricity monitoring and energy management platform designed to help households understand, monitor, and optimize their electricity consumption.

Combining IoT hardware, real-time data monitoring, energy analytics, and AI-powered assistance, WattNexa aims to make electricity consumption more transparent, accessible, and manageable.

<p align="center">
  <strong>Monitor Smarter. Understand Better. Save Energy.</strong>
</p>

---

## 🌟 Overview

Electricity consumption is often difficult to understand. Traditional electricity bills show the total amount consumed but provide limited insight into when, how, and why electricity is being used.

WattNexa addresses this problem through an integrated hardware and software ecosystem.

The platform is designed to provide:

- Real-time electricity monitoring.
- Historical energy consumption analytics.
- Electricity expense estimation.
- Smart notifications and alerts.
- IoT device management.
- AI-powered energy assistance through WattBot.
- Household energy insights.
- Personalized energy-saving recommendations.

WattNexa focuses on making energy monitoring easier for everyday households while providing an extensible architecture for future smart energy applications.

## ✨ Key Features

### 📊 Energy Monitoring

- Real-time power consumption monitoring.
- Voltage and current monitoring where supported by hardware.
- Active power and power factor measurements where available.
- Daily, weekly, monthly, and yearly consumption.
- Historical consumption graphs.
- Live dashboard updates.

### 📈 Energy Analytics

- Consumption trend analysis.
- Peak consumption identification.
- Historical comparisons.
- Energy usage summaries.
- Monthly consumption forecasting.
- Household energy efficiency insights.

### 💰 Electricity Bill Management

- Electricity tariff configuration.
- Estimated electricity expenses.
- Monthly bill projections.
- Cost-per-unit configuration.
- Historical expense tracking.
- Actual versus estimated bill comparisons.

### 📱 IoT Device Management

- ESP32 device integration.
- Secure device pairing.
- Device status monitoring.
- Device health information.
- Sensor telemetry collection.
- Device connectivity tracking.
- Firmware information.

### 🤖 WattBot — AI Energy Assistant

WattBot is the intelligent assistant within WattNexa.

It is designed to help users:

- Understand electricity consumption.
- Analyze energy usage patterns.
- Understand estimated electricity expenses.
- Compare historical consumption.
- Identify unusual usage patterns.
- Receive personalized energy recommendations.
- Troubleshoot supported device issues.

### 🔔 Smart Notifications

- High consumption alerts.
- Unusual energy usage alerts.
- Device offline notifications.
- High temperature alerts.
- Configurable energy thresholds.
- In-app notifications.

### 🏠 Household Management

- Multiple household support.
- Household device organization.
- Room-based device management.
- Household consumption overview.
- Shared access with household members.

### 📄 Reports and Exports

- Daily energy reports.
- Weekly and monthly reports.
- Yearly consumption reports.
- PDF reports.
- CSV exports.
- Electricity expense summaries.

### 🛡️ Administration

- User management.
- Device management.
- Subscription management.
- Platform analytics.
- Support management.
- Audit logs.
- System configuration.

---

## 🛠️ Technology Stack

| Category | Technology |
|---|---|
| Frontend | React |
| Language | TypeScript |
| Build Tool | Vite |
| Styling | Tailwind CSS |
| UI Components | shadcn/ui |
| Animations | Framer Motion |
| Charts | Recharts |
| Data Fetching | TanStack Query |
| Backend | Node.js + Express.js |
| Backend Language | TypeScript |
| Database | MariaDB |
| ORM | Drizzle ORM |
| Package Manager | pnpm |
| Real-time Communication | Socket.IO |
| IoT Integration | ESP32, MQTT, HTTP |
| Validation | Zod |
| API Documentation | Swagger / OpenAPI |
| Testing | Vitest |

---

## 🏗️ System Architecture

WattNexa follows a modular full-stack architecture.

```text
                     WATTNEXA
                         |
           +-------------+-------------+
           |                           |
       FRONTEND                    IoT HARDWARE
           |                           |
    React + TypeScript                ESP32
           |                           |
           +-------------+-------------+
                         |
                    EXPRESS API
                         |
           +-------------+-------------+
           |             |             |
        REST API      Socket.IO       MQTT
           |             |             |
           +-------------+-------------+
                         |
                    DRIZZLE ORM
                         |
                      MARIADB
                         |
           +-------------+-------------+
           |             |             |
       Analytics       Users       Telemetry
```

The architecture separates the frontend, backend, database, and IoT integration layers to support maintainability and future expansion.

---

## 📁 Project Structure

```text
wattnexa/
│
├── apps/
│   ├── web/                  # React frontend
│   │   └── src/
│   │       ├── app/
│   │       ├── components/
│   │       ├── features/
│   │       ├── hooks/
│   │       ├── layouts/
│   │       ├── lib/
│   │       ├── routes/
│   │       ├── services/
│   │       └── styles/
│   │
│   └── api/                  # Express backend
│       └── src/
│           ├── config/
│           ├── controllers/
│           ├── middleware/
│           ├── modules/
│           ├── routes/
│           ├── services/
│           ├── sockets/
│           ├── integrations/
│           └── server.ts
│
├── packages/
│   ├── shared/
│   ├── database/
│   ├── config/
│   └── types/
│
├── docker/
├── docs/
├── scripts/
├── pnpm-workspace.yaml
├── package.json
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## 🚀 Getting Started

### Prerequisites

Install the following tools before starting:

- Node.js (LTS)
- pnpm
- MariaDB
- Git

Optional:

- Docker
- MQTT broker for hardware integration

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/wattnexa.git

cd wattnexa
```

Replace `YOUR_USERNAME` with your GitHub username.

### 2. Install dependencies

```bash
pnpm install
```

### 3. Configure environment variables

Create your environment file using the provided example:

```bash
cp .env.example .env
```

Configure the database, authentication, application URLs, and other required settings.

Example configuration:

```env
NODE_ENV=development

PORT=5000

DATABASE_URL=mysql://root:password@localhost:3306/wattnexa

JWT_SECRET=replace_with_a_secure_secret
JWT_REFRESH_SECRET=replace_with_another_secure_secret

FRONTEND_URL=http://localhost:5173

MQTT_BROKER_URL=mqtt://localhost:1883
```

Use strong, unique secrets. Never commit actual credentials to GitHub.

### 4. Create the database

Create a MariaDB database:

```sql
CREATE DATABASE wattnexa;
```

Make sure the configured database user has the required permissions.

### 5. Run database migrations

```bash
pnpm db:generate

pnpm db:migrate
```

### 6. Start development servers

```bash
pnpm dev
```

If the monorepo uses separate application scripts, start the frontend and backend independently:

```bash
pnpm --filter web dev
```

```bash
pnpm --filter api dev
```

The exact commands should match the scripts configured in the repository.

### 7. Access the application

| Service | Local URL |
|---|---|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:5000 |
| API Documentation | http://localhost:5000/api/docs |

---

## 🔌 Hardware Integration

WattNexa is designed to integrate with an ESP32-based electricity monitoring device.

### Hardware Components

| Component | Purpose |
|---|---|
| ESP32 | Main microcontroller |
| CT Sensor | Non-invasive current measurement |
| Voltage Measurement Module | Voltage measurement where implemented |
| Temperature Sensor | Device temperature monitoring |
| LED Ring | Visual device status |
| Local Memory | Local data storage |
| USB Interface | Power and device connectivity |

### Data Flow

1. The device collects sensor readings.
2. The ESP32 processes available measurements.
3. Data is transmitted through an authenticated HTTP or MQTT connection.
4. The backend validates incoming telemetry.
5. Readings are stored in MariaDB.
6. Socket.IO distributes authorized updates.
7. The dashboard displays the latest measurements.

**Development mode:** A sensor simulator can provide clearly labeled sample readings before physical hardware is connected.

Only actual measurements and validated calculations should be represented as real hardware data.

---

## 🤖 WattBot

WattBot is WattNexa's AI-powered energy assistant.

Its goal is to turn complex electricity consumption information into understandable insights.

Example interactions:

```text
User: How much electricity did I use today?

WattBot: Your dashboard recorded today's
available energy consumption data.

User: Compare this month with last month.

WattBot: I can compare the two periods using
your stored historical consumption records.
```

AI integration is designed to be configurable through backend provider settings.

---

## 🔐 Security

Security is an important part of WattNexa's architecture.

Planned security measures include:

- Secure password hashing.
- JWT-based authentication.
- HTTP-only authentication cookies.
- Role-based access control.
- Device-level authentication.
- API rate limiting.
- Request validation.
- Secure database access.
- Environment-based secrets.
- Audit logging.
- User data isolation.

---

## 🗺️ Development Roadmap

WattNexa is being developed as a modular platform.

- [ ] Project foundation and monorepo setup
- [ ] Database architecture
- [ ] Authentication and authorization
- [ ] Public website and design system
- [ ] User dashboard
- [ ] Energy monitoring and analytics
- [ ] ESP32 hardware integration
- [ ] Real-time monitoring
- [ ] Electricity tariff and billing system
- [ ] WattBot AI assistant
- [ ] Smart alerts and notifications
- [ ] Household management
- [ ] Appliance management
- [ ] Energy forecasting
- [ ] Reports and exports
- [ ] Subscription management
- [ ] Admin dashboard
- [ ] Support center
- [ ] Testing and security hardening
- [ ] Production deployment

*Roadmap checkboxes should be updated as features are actually implemented and verified.*

---

## 🌱 Future Possibilities

WattNexa is designed with future expansion in mind.

Potential future capabilities include:

- Solar energy monitoring.
- Grid import/export analysis.
- Smart meter integrations.
- Advanced energy forecasting.
- Multi-property energy management.
- Smart home integrations.
- Advanced anomaly detection.
- Mobile application.
- Advanced energy automation.

---

## 🤝 Contributing

Contributions, ideas, and suggestions are welcome.

If you would like to contribute:

1. Fork the repository.
2. Create a feature branch.
3. Make your changes.
4. Run tests and checks.
5. Submit a pull request.

Please maintain consistent coding standards and include tests for new functionality.

---

## 📄 License

This project is currently under development.

A license will be added when the project owner selects the appropriate licensing model.

---

## 👨‍💻 Project

**WattNexa**

*Know exactly where your electricity bill is going.*

Built with a vision to make electricity monitoring smarter, simpler, and more accessible.

**Website:** https://watt-nexa.vercel.app

**GitHub:** Add your repository URL here.

---

<p align="center">
  ⚡ <strong>WattNexa — Monitor Smarter. Live Better.</strong>
</p>
