# WhatsApp Logistics Bot

A WhatsApp-based data ingestion and management system for warehouse logistics. This bot allows workers to submit detailed warehouse information, including multiple photos, through a guided, multi-step conversation. The data is stored in a Supabase (PostgreSQL) database and kept in a two-way sync with a Google Sheet for easy viewing and manual edits.

## Key Features

- **Multi-Step Submissions**: A user-friendly, stateful process that first captures text details and then accepts multiple image uploads.
- **WhatsApp Interface**: All data entry and interaction happen directly within WhatsApp, powered by the Twilio API.
- **Centralized Database**: Uses Supabase (PostgreSQL) with a Prisma ORM for reliable data storage.
- **Two-Way Google Sheets Sync**: A Google Sheet provides a human-readable view of the database. Changes made in the sheet are synced back to Supabase, and vice-versa.
- **Message & Error Logging**: Every incoming message is logged with its success or failure state for easy debugging and tracking.
- **Keep-Alive Endpoint**: Includes a health check endpoint to work with uptime services, preventing cold starts on free hosting tiers.

## Tech Stack 🛠️

| Component | Technology Used |
| :--- | :--- |
| **Messaging Layer** | Twilio API for WhatsApp |
| **Backend Server** | Node.js, Express.js |
| **Database** | Supabase (PostgreSQL) |
| **ORM** | Prisma |
| **Sync Layer** | Google Sheets API, Google Apps Script |
| **State Management** | Supabase (using a `Draft` table) |
| **Deployment** | Render / Railway |

## Workflow

The system operates on two main data flows:

1.  **WhatsApp ➝ Supabase ➝ Google Sheets**
    - A user initiates a submission via a structured WhatsApp message.
    - The Node.js server creates a temporary `Draft` record in Supabase to manage the session state.
    - The user sends images, which are appended to the draft record.
    - The user sends "close" to finalize the submission.
    - The server creates a permanent `Warehouse` record and deletes the draft.
    - A Supabase Webhook triggers a Google Apps Script Web App, which updates the Google Sheet.

2.  **Google Sheets ➝ Supabase**
    - A user manually edits a row in the Google Sheet.
    - An `onEdit` trigger in Google Apps Script fires.
    - The script sends the updated row data to the Supabase API to `upsert` the record.

## Getting Started

To get a local copy up and running, follow these simple steps.

### Prerequisites

- Node.js (v16 or later)
- A Supabase account and project
- A Twilio account with a configured WhatsApp number
- A Google account

### Installation

1.  **Clone the repo**
    ```sh
    git clone https://github.com/WareOnGo/whatsapp-logistics-bot
    cd whatsapp-logistics-bot
    ```

2.  **Install NPM packages**
    ```sh
    npm install
    ```

3.  **Set up your environment variables**
    - Create a `.env` file in the root of the project.
    - Add your Supabase database connection string:
      ```env
      DATABASE_URL="postgresql://postgres:[YOUR-PASSWORD]@[HOST].supabase.co:5432/postgres"
      ```

4.  **Set up the database schema**
    - Run the Prisma command to sync your schema with your Supabase database.
    ```sh
    npx prisma db push
    ```

5.  **Run the application**
    ```sh
    npm start
    ```
    Your server will be running on `http://localhost:3000`.

## License

Distributed under the MIT License. See `LICENSE.txt` for more information.
