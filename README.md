# WhatsApp Logistics Bot

A WhatsApp-based data ingestion system for warehouse logistics. Workers submit structured warehouse information (and photos) through WhatsApp, powered by Twilio. Data is stored in Supabase (PostgreSQL) via Prisma and synced two-way with Google Sheets.

## Architecture

```
WhatsApp (Twilio) --> Express Server --> Prisma --> Supabase (PostgreSQL)
                                    |                    |
                                    v                    v
                              Cloudflare R2       Google Sheets
                              (media storage)     (two-way sync)
```

### Data Flow

1. **Inbound (WhatsApp -> DB -> Sheets):**
   User sends a structured message via WhatsApp. The server parses it, creates a `Draft` (if media is expected) or saves directly to the `Warehouse` table. A Supabase webhook triggers a Google Apps Script to update the linked Google Sheet.

2. **Outbound (Sheets -> DB):**
   Manual edits in Google Sheets fire an `onEdit` trigger that upserts the record back into Supabase.

### Submission Modes

- **Immediate save** (`Media Available: n`): Text data is parsed and saved in one step.
- **Draft flow** (`Media Available: y`): Text data is saved as a draft. User sends images, then replies `close` to finalize or `cancel` to discard. Drafts expire after 15 minutes of inactivity.

## Tech Stack

| Component | Technology |
|---|---|
| Messaging | Twilio API for WhatsApp |
| Server | Node.js, Express 5 |
| Database | Supabase (PostgreSQL) |
| ORM | Prisma |
| Media Storage | Cloudflare R2 (S3-compatible) |
| Sync | Google Sheets API / Apps Script |
| Text Matching | Fuse.js (fuzzy matching for field names) |

## Project Structure

```
.
├── server.js                     # Entry point
├── prisma/
│   └── schema.prisma             # Database schema
├── src/
│   ├── app.js                    # Express app setup
│   ├── routes/
│   │   └── whatsapp.js           # Twilio webhook handler (main logic)
│   ├── services/
│   │   ├── warehouseService.js   # Zone derivation, DB save, logging
│   │   └── storageService.js     # Cloudflare R2 media uploads
│   └── utils/
│       └── warehouseParser.js    # Message -> structured data parser
├── __tests__/
│   ├── setup.js
│   ├── unit/
│   │   ├── warehouseParser.test.js
│   │   └── warehouseService.test.js
│   └── integration/
│       └── whatsapp.test.js
└── package.json
```

## Setup

### Prerequisites

- Node.js >= 16
- A Supabase project
- A Twilio account with a WhatsApp-enabled number
- A Cloudflare R2 bucket (for media storage)

### Installation

```sh
git clone https://github.com/WareOnGo/whatsapp-logistics-bot
cd whatsapp-logistics-bot
npm install
```

### Environment Variables

Copy the example and fill in your values:

```sh
cp .env.example .env
```

| Variable | Description |
|---|---|
| `PORT` | Server port (default: 5000) |
| `DATABASE_URL` | Supabase PostgreSQL connection string |
| `TWILIO_ACCOUNT_SID` | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `R2_ACCOUNT_ID` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | R2 access key |
| `R2_SECRET_ACCESS_KEY` | R2 secret key |
| `R2_BUCKET_NAME` | R2 bucket name |
| `R2_PUBLIC_URL` | R2 public URL for uploaded media |

### Database

```sh
npx prisma db push
```

### Run

```sh
npm start
```

The server starts at `http://localhost:5000`. Point your Twilio WhatsApp webhook to `POST /api/whatsapp`.

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/whatsapp` | Twilio webhook for incoming WhatsApp messages |
| `GET` | `/api/health` | Health check / keep-alive endpoint |

## Testing

```sh
npm test              # Run all tests with coverage
npm run test:unit     # Unit tests only
npm run test:watch    # Watch mode for development
```

## License

MIT
