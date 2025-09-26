# Dynamic Ad Sets Backend

This is the backend for a Dynamic Ad Sets management tool. It allows users to automate the process of pausing or resuming ad sets on Meta (Facebook) and Google Ads based on weather conditions and user-defined rules.

## Features

-   User authentication (JWT-based).
-   Create, read, update, and delete automation rules.
-   Connect to Meta and Google accounts.
-   Automatically pause/resume ad campaigns based on weather data and rules.
-   Job scheduling to check conditions and execute actions.
-   Rate limiting and security middleware.

## Tech Stack

-   **Backend**: Node.js, Express, TypeScript
-   **Database**: PostgreSQL
-   **ORM**: Drizzle ORM
-   **Caching/Job Queue**: Redis
-   **Authentication**: JWT (jsonwebtoken), bcrypt
-   **Validation**: Zod
-   **Containerization**: Docker

## Prerequisites

-   Node.js (v20.x or higher recommended)
-   npm
-   Docker and Docker Compose (for containerized setup)
-   Git

## Getting Started

### Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/Vitaee/DynamicAdSetsBackend.git
    cd DynamicAdSetsBackend
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```

### Configuration

1.  Create a `.env` file in the root of the project.
2.  Add the necessary environment variables. You will need to configure database credentials, JWT secrets, and API keys for Google and Meta.

    ```env
    # PostgreSQL
    DB_HOST=localhost
    DB_PORT=5432
    DB_USER=your_db_user
    DB_PASSWORD=your_db_password
    DB_NAME=your_db_name

    # Redis
    REDIS_HOST=localhost
    REDIS_PORT=6379

    # JWT
    JWT_SECRET=your_jwt_secret
    JWT_EXPIRES_IN=1d

    # API Keys
    WEATHER_API_KEY=your_weather_api_key
    GOOGLE_CLIENT_ID=your_google_client_id
    GOOGLE_CLIENT_SECRET=your_google_client_secret
    META_APP_ID=your_meta_app_id
    META_APP_SECRET=your_meta_app_secret
    ```

### Running the Application

-   **Development mode:**
    ```bash
    npm run dev
    ```
    This will start the server with nodemon, which will automatically restart on file changes.

-   **Production mode:**
    First, build the TypeScript code:
    ```bash
    npm run build
    ```
    Then, start the application:
    ```bash
    npm start
    ```

### Running with Docker

The easiest way to get the application and its dependencies (PostgreSQL, Redis) running is with Docker Compose.

1.  Make sure you have a `.env` file configured as described above.
2.  Run the following command:
    ```bash
    docker-compose up --build
    ```
    This will build the backend image and start all services. The application will be available at `http://localhost:3001`.

## Available Scripts

-   `dev`: Starts the application in development mode with hot-reloading.
-   `build`: Compiles the TypeScript source code to JavaScript.
-   `start`: Starts the compiled application from the `dist` directory.
-   `lint`: Lints the source code using ESLint.
-   `typecheck`: Checks for TypeScript type errors without emitting files.
-   `test`: Runs tests using Jest.
-   `db:generate`: Generates a new database migration file with Drizzle Kit based on schema changes.
-   `db:push`: Pushes schema changes to the database without creating a migration file (useful for development).
-   `db:migrate`: Applies pending migrations to the database.
-   `db:studio`: Opens the Drizzle Studio to browse your database.

## API Endpoints

The following are the main API routes available:

-   **Auth**: `POST /api/auth/register`, `POST /api/auth/login`
-   **Automation Rules**: `GET /api/rules`, `POST /api/rules`, `GET /api/rules/:id`, `PUT /api/rules/:id`, `DELETE /api/rules/:id`
-   **Meta**: Routes for Meta Ads integration.
-   **Google**: Routes for Google Ads integration.
-   **Weather**: Routes for fetching weather data.

All protected routes require a `Bearer` token in the `Authorization` header.

## Database Migrations

This project uses `drizzle-kit` for database migrations.

1.  **Generate a migration:**
    After making changes to the schema in `src/db/schema.ts`, run:
    ```bash
    npm run db:generate
    ```
    This will create a new SQL migration file in the `drizzle` directory.

2.  **Apply migrations:**
    To apply the generated migrations to your database, run:
    ```bash
    npm run db:migrate
    ```
    When using Docker, migrations should be run inside the container or as part of an entrypoint script for production deployments.
