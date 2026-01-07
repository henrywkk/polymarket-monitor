# Polymarket Real-Time Dashboard

A full-stack application that monitors Polymarket events, calculates implied probabilities, and provides users with a searchable, categorized interface for real-time forecasting.

## Tech Stack

- **Frontend**: React (Vite), Tailwind CSS, Lucide Icons, Recharts
- **Backend**: Node.js, Express, TypeScript
- **Database**: PostgreSQL (Metadata/Historical), Redis (Caching)
- **Infrastructure**: Docker, Railway (Backend), Vercel (Frontend)

## Project Structure

```
polymarket-monitor/
├── backend/          # Node.js/Express backend
├── frontend/         # React/Vite frontend
├── docker-compose.yml # Local development setup
└── README.md
```

## Getting Started

### Prerequisites

- Node.js 18+
- Docker & Docker Compose
- PostgreSQL (or use Docker)
- Redis (or use Docker)

### Local Development

1. Clone the repository
2. Copy `.env.example` to `.env` and configure
3. Start services with Docker Compose:
   ```bash
   docker-compose up
   ```
4. Backend will be available at `http://localhost:3000`
5. Frontend will be available at `http://localhost:5173`

## Development

### Backend

```bash
cd backend
npm install
npm run dev
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Deployment

- **Backend**: Deployed on Railway
- **Frontend**: Deployed on Vercel

See Phase 5 of the implementation plan for detailed deployment instructions.

## License

MIT

