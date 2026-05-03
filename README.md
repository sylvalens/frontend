# SylvaLens - Frontend

The user interface for the SylvaLens forest analytics platform, built with **Next.js (App Router)** and **Mapbox GL JS**.

## Features
- **Interactive Map:** Explore administrative boundaries, cadastre parcels, and BD Forêt classifications.
- **Custom Analytics:** Draw polygons to trigger spatial analytics (FORMS-T, Hansen, LiDAR).
- **Report Generation:** Download CSV and PDF reports.
- **Contract-Driven API:** Uses `openapi-typescript` for end-to-end type safety with the backend services.

## Development Setup

### Prerequisites
- Node.js (v20+)
- pnpm
- Mapbox Access Token

### 1. Configuration
Copy the `.env.example` file to `.env.local` and add your Mapbox token:
```bash
cp .env.example .env.local
```
Fill in:
`NEXT_PUBLIC_MAPBOX_TOKEN=pk.your_token_here`

### 2. Generate API Types
To ensure type safety with the backend and raster services (which must be running locally):
```bash
pnpm run generate:api
```

### 3. Run Development Server
```bash
pnpm install
pnpm run dev
```
The application will be available at `http://localhost:3000`.

## Production Build
This Next.js application is configured to build as `standalone` for optimized Docker deployments.
```bash
pnpm run build
```
See the `sylvalens/infra` repository for production deployment orchestration.