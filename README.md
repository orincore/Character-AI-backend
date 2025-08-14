# Character AI Backend

A backend service for a Character AI application, featuring user authentication, conversation management, and AI integration.

## Features

- User authentication and authorization
- Conversation management
- AI response generation
- Rate limiting and request queuing
- Redis integration for caching and rate limiting
- File uploads to S3

## Prerequisites

- Node.js 16+
- npm or yarn
- Redis (local or cloud)
- Supabase account
- AWS S3 bucket (for file storage)
- Together AI API key

## Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
# App Settings
PORT=3000
NODE_ENV=development
CORS_ORIGIN=*

# Supabase
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# AWS S3
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_REGION=your_aws_region
AWS_S3_BUCKET=your_s3_bucket_name

# Together AI
TOGETHER_API_KEY=your_together_ai_api_key

# JWT Configuration
JWT_SECRET=your_jwt_secret
JWT_EXPIRES_IN=90d
JWT_COOKIE_EXPIRES_IN=90

# Redis
REDIS_HOST=your_redis_host
REDIS_PORT=your_redis_port
REDIS_USERNAME=your_redis_username
REDIS_PASSWORD=your_redis_password
REDIS_TLS=true
```

## Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   # or
   yarn
   ```
3. Set up your environment variables in `.env`
4. Start the development server:
   ```bash
   npm run dev
   # or
   yarn dev
   ```

## API Documentation

API documentation is available at `/api-docs` when the server is running in development mode.

## Deployment

### Prerequisites
- Set up a production database
- Configure environment variables in your hosting platform
- Set up a process manager (PM2, systemd, etc.)

### Using PM2
```bash
# Install PM2 globally
npm install -g pm2

# Start the application
pm2 start src/server.js --name "character-ai-backend"

# Save the process list
pm2 save

# Set up startup script
pm2 startup

# Restart PM2 on system reboot
pm2 save
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
